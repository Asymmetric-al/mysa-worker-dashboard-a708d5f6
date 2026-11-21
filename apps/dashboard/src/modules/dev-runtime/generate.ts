/**
 * The deterministic large workload: 10,000 partners and 100,000 gifts generated from one fixed
 * numeric seed, written beside the readable seed in a single store call.
 *
 * Plan items that put this file in scope:
 * - AAP 0.7.2 "Generator" — `scripts/generate-workload.ts` "deterministically produces 10,000
 *   partners and 100,000 gifts from a fixed seed for the whole-query and performance work. Fixtures
 *   are generated from a compact source; no large repeated dataset is checked in."
 * - AAP 0.12 line 1338 — the dataset behind criterion 1's whole-query agreement and criterion 6's
 *   support reads, produced by `bun run seed:workload` and consumed by the measurements.
 * - AAP 0.6.1 "Development runtime" — the internal workload generator the script calls, and AAP
 *   0.7.2's `<sessionId>.workload.json`, which is why the readable seed stays small.
 *
 * Determinism is the whole point of the generator: the rows come from one integer pseudo-random
 * sequence seeded by {@link WORKLOAD_SEED}, the dates are civil dates built from integer fields, and
 * nothing reads the machine clock, `Math.random` or the environment. Two runs of the same session
 * therefore write byte-identical documents, which is what makes a measurement comparable.
 *
 * Layering: a development-runtime module that imports the store's document surface, the sibling seed
 * module and `data-service/envelope` FOR TYPES ONLY, so the record shapes it builds are the ones the
 * reads parse without a runtime edge into the data service.
 */
import type { GiftRowRecord, PartnerRecord } from "@/modules/data-service/envelope";
import { minorUnitsOf, type Money } from "@/modules/money/amount";
import { serialiseJson } from "@/modules/store/atomic";
import { DATA_ROOT, isSafeSessionId, sessionPaths } from "@/modules/store/paths";
import { resetSession } from "@/modules/store/repository";

import { isSeededSessionId, seedSessionDocuments } from "./seed";

/**
 * The volume AAP 0.7.2 line 775 and AAP 0.12 line 1338 fix: 10,000 partners and 100,000 gifts.
 *
 * They are constants rather than options because the published workload is the measurement's stated
 * workload: a report that named a different size would not be comparable with the criteria it serves.
 */
export const WORKLOAD_PARTNER_COUNT = 10_000;
export const WORKLOAD_GIFT_COUNT = 100_000;

/**
 * The session the workload is written into by default: the established worker, whose readable seed is
 * the one the journeys and the giving investigation start from.
 */
export const DEFAULT_WORKLOAD_SESSION_ID = "established-worker";

/** The version of the workload document this module writes. */
export const WORKLOAD_DOCUMENT_VERSION = 1;

/** The fixed seed of the integer pseudo-random sequence every generated row derives from. */
export const WORKLOAD_SEED = 20_261_120;

/** What the workload document states about itself, so a reader never has to infer its provenance. */
export interface WorkloadHeader {
  readonly version: number;
  readonly sessionId: string;
  readonly seed: number;
  readonly partnerCount: number;
  readonly giftCount: number;
}

/** The generated dataset: the header that describes it, the partners, and the gift rows. */
export interface WorkloadDocument {
  readonly header: WorkloadHeader;
  readonly partners: readonly PartnerRecord[];
  readonly gifts: readonly GiftRowRecord[];
}

/** What one workload run did, stated in the terms the script prints and nothing more. */
export interface WorkloadReport {
  readonly sessionId: string;
  readonly storePath: string;
  readonly workloadPath: string;
  readonly partnerCount: number;
  readonly giftCount: number;
  readonly bytes: number;
}

/** The currencies the generated gifts are spread over, in the proportions the sequence decides. */
const WORKLOAD_CURRENCIES: readonly [string, ...string[]] = ["USD", "USD", "USD", "EUR", "EUR", "KWD", "JPY"];

/** The one currency code that states an amount whose currency the source never identified. */
const UNIDENTIFIED_CURRENCY = "UNKNOWN";

/** Partner kinds the generated roster holds, weighted towards people as a real roster is. */
const WORKLOAD_PARTNER_KINDS: readonly [PartnerRecord["kind"], ...PartnerRecord["kind"][]] = [
  "person",
  "person",
  "person",
  "person",
  "household",
  "church",
  "organization",
  "private-preparation",
];

/** Given names for the generated people; mixed scripts are deliberate, as the product requires. */
const WORKLOAD_GIVEN_NAMES: readonly [string, ...string[]] = [
  "Ada",
  "Bram",
  "Chidi",
  "Dalia",
  "Eero",
  "Fatima",
  "Grace",
  "Hana",
  "Iwan",
  "Jonas",
  "Keiko",
  "Lucas",
  "Marisol",
  "Nadia",
  "Owen",
  "Priya",
  "Ruth",
  "Sara",
  "Tobias",
  "Елена",
  "سارة",
];

/** Family names for the generated people, drawn independently of the given names. */
const WORKLOAD_FAMILY_NAMES: readonly [string, ...string[]] = [
  "Adeyemi",
  "Baptiste",
  "Costa",
  "Dubois",
  "Eriksen",
  "Fischer",
  "Gupta",
  "Hale",
  "Ito",
  "Jimenez",
  "Kern",
  "Lindqvist",
  "Mbeki",
  "Nakamura",
  "Okafor",
  "Pritchard",
  "Quinn",
  "Raman",
  "Sokolova",
  "Webb",
  "الحسن",
];

/** The short tags a generated partner may carry; a tag is the worker's own label, not a taxonomy. */
const WORKLOAD_TAGS: readonly [string, ...string[]] = [
  "workload",
  "generated",
  "church",
  "volunteer",
  "newsletter",
  "follow-up",
];

/** The designations a generated gift may carry; `null` is a gift with no designation at all. */
const WORKLOAD_DESIGNATIONS: readonly [string | null, ...(string | null)[]] = [
  "Youth ministry",
  "Student ministry",
  null,
];

/**
 * One step of the generator's integer sequence (mulberry32), returned as an unsigned 32-bit integer.
 *
 * It is written here rather than added as a dependency because the generator must produce the same
 * rows on every machine, and a small deterministic function is the whole requirement. Integer state
 * in, integer out: no value here is a float, so no amount the generator builds can drift.
 */
function createSequence(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1) >>> 0;
    mixed = (mixed ^ (mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61))) >>> 0;
    return (mixed ^ (mixed >>> 14)) >>> 0;
  };
}

/** Picks one entry of a non-empty list from the sequence; the list type guarantees an entry exists. */
function pick<Value>(values: readonly [Value, ...Value[]], next: () => number): Value {
  return values[next() % values.length] ?? values[0];
}

/** Builds one exact amount from a currency code and integer minor units. */
function amount(currency: string, minorUnits: number): Money {
  return { currency, minorUnits: minorUnitsOf(minorUnits) };
}

/** Zero-pads an index so two generated ids never collide and sort in creation order. */
function padded(index: number, width: number): string {
  return String(index).padStart(width, "0");
}

/** Builds one civil date from integer fields only, keeping the day inside every month. */
function civilDate(year: number, month: number, day: number): string {
  return `${String(year)}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Builds one generated partner row; the sequence decides every field a row varies. */
function buildGeneratedPartner(index: number, next: () => number): PartnerRecord {
  const kind = pick(WORKLOAD_PARTNER_KINDS, next);
  const given = pick(WORKLOAD_GIVEN_NAMES, next);
  const family = pick(WORKLOAD_FAMILY_NAMES, next);
  const suffix = padded(index, 5);
  return {
    partnerId: `partner-workload-${suffix}`,
    kind,
    displayName: kind === "person" ? `${given} ${family}` : `${family} household ${suffix}`,
    nameParts: kind === "person" ? { given, family, additional: [] } : null,
    contactMethods: [
      { kind: "email", value: `workload-${suffix}@example.org`, permitted: true, verified: false },
    ],
    restrictions: [],
    tags: [pick(WORKLOAD_TAGS, next)],
    favourite: next() % 50 === 0,
    stage: null,
    audience: "shared",
    source: { system: "crm", reference: `workload-${suffix}` },
    revision: "rev-1",
  };
}

/**
 * Builds one generated gift row: an exact amount in one of several currencies, a date inside the
 * generated history, and an attribution that is a partner, anonymous support or an unresolved row.
 *
 * The amount is a whole number of minor units computed from integer values, so no generated amount is
 * ever a float. A slice of the rows carries the `UNKNOWN` currency, which states an amount whose
 * currency the source never identified and is therefore never defaulted to two decimals.
 */
function buildGeneratedGift(
  index: number,
  partnerCount: number,
  next: () => number,
): GiftRowRecord {
  const suffix = padded(index, 6);
  const currency = next() % 97 === 0 ? UNIDENTIFIED_CURRENCY : pick(WORKLOAD_CURRENCIES, next);
  const minorUnits = 500 + (next() % 20_000) * 5;
  const year = 2023 + (next() % 4);
  const month = 1 + (next() % 12);
  const day = 1 + (next() % 28);
  const attributionRoll = next() % 100;
  const partnerIndex = (next() % partnerCount) + 1;
  const attribution: GiftRowRecord["attribution"] =
    attributionRoll < 90
      ? { kind: "partner", partnerId: `partner-workload-${padded(partnerIndex, 5)}` }
      : attributionRoll < 96
        ? { kind: "anonymous" }
        : { kind: "unresolved" };

  return {
    giftRowId: `gift-row-workload-${suffix}`,
    giftId: `gift-workload-${suffix}`,
    allocationId: null,
    amount: amount(currency, minorUnits),
    originalGiftOn: civilDate(year, month, day),
    datePrecision: "date",
    designation: pick(WORKLOAD_DESIGNATIONS, next),
    attribution,
    refundOf: null,
    provenance: { system: "finance", reference: `workload-${suffix}` },
    entryOn: civilDate(year, month, day),
    revision: "rev-1",
  };
}

/**
 * Builds the workload document for one session: the header, the partner roster and the gift rows.
 *
 * It is a pure function of the session id and {@link WORKLOAD_SEED}, so the same call produces the
 * same document bytes on every run and every machine. It writes nothing.
 */
export function buildWorkload(sessionId: string): WorkloadDocument {
  if (!isSafeSessionId(sessionId) || !isSeededSessionId(sessionId)) {
    throw new RangeError(
      `Cannot generate a workload for ${JSON.stringify(sessionId)}: the workload belongs to a seeded session, and this seed defines only its own rows.`,
    );
  }

  const next = createSequence(WORKLOAD_SEED);
  const partners: PartnerRecord[] = [];
  for (let index = 1; index <= WORKLOAD_PARTNER_COUNT; index += 1) {
    partners.push(buildGeneratedPartner(index, next));
  }

  const gifts: GiftRowRecord[] = [];
  for (let index = 1; index <= WORKLOAD_GIFT_COUNT; index += 1) {
    gifts.push(buildGeneratedGift(index, WORKLOAD_PARTNER_COUNT, next));
  }

  return {
    header: {
      version: WORKLOAD_DOCUMENT_VERSION,
      sessionId,
      seed: WORKLOAD_SEED,
      partnerCount: partners.length,
      giftCount: gifts.length,
    },
    partners,
    gifts,
  };
}

/**
 * Generates the workload and writes it into the session in one store call, returning what the run did.
 *
 * The session's readable seed is written in the same call, so the large dataset never exists beside a
 * half-seeded session: `resetSession` is the store's only creating path and it makes the document set
 * exactly what it is given. A session id that is not a seeded session, or that could not name a
 * session at all, is refused before anything is built or written.
 */
export async function generateWorkload(sessionId: string): Promise<WorkloadReport> {
  const workload = buildWorkload(sessionId);
  // The store writes exactly `serialiseJson(document)`, so these are the bytes the file receives.
  const bytes = Buffer.byteLength(serialiseJson(workload), "utf8");

  await resetSession(sessionId, { ...seedSessionDocuments(sessionId), workload });

  return {
    sessionId,
    storePath: DATA_ROOT,
    workloadPath: sessionPaths(sessionId).workload,
    partnerCount: workload.partners.length,
    giftCount: workload.gifts.length,
    bytes,
  };
}
