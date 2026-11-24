import type { CoverageState, GiftAttribution, GiftRowRecord, PartnerKind, PartnerRecord } from "@/modules/data-service/envelope";
import { allocateMinor, minorUnitsOf, negateMinor, type Money } from "@/modules/money/amount";
import { UNKNOWN_CURRENCY } from "@/modules/money/currency";
import { SUPPORT_BASIS, type SupportBasis } from "@/modules/support/basis";
import { DATA_ROOT, sessionPaths } from "@/modules/store/paths";
import { readSession, resetSession, StoreAbsentError, transact } from "@/modules/store/repository";
import { civilDateAt, serialiseCivilDate, type CivilDate } from "@/modules/time/civil";
import { SEED_INSTANT } from "@/modules/time/clock";
import type { SourceReference } from "@/lib/ids";
import { isSafeSessionId } from "@/lib/session-cookie";
import { DEFAULT_SESSION_ID, isSeededSessionId, seedSessionDocuments } from "./seed";
export const WORKLOAD_PARTNER_COUNT = 10_000;
export const WORKLOAD_GIFT_COUNT = 100_000;
export const WORKLOAD_DOCUMENT_VERSION = 1;
export const WORKLOAD_SEED = 20_261_120;
export const DEFAULT_WORKLOAD_SESSION_ID: string = DEFAULT_SESSION_ID;
const INITIAL_REVISION = "rev-1";
const WORKLOAD_ZONE = "UTC";
const HISTORY_YEARS = 4;
const ABSENT_MONTH = "2024-02";
const SPLIT_GIFT_STRIDE = 1_000;
const SPLIT_ALLOCATION_WEIGHTS = [40, 60] as const;
const REFUND_ROW_INDICES: readonly number[] = Object.freeze([2_500, 5_250, 7_750, 9_025]);
const ANONYMOUS_GIFT_ROW_INDEX: number = 8_503;
const UNIDENTIFIED_CURRENCY_STRIDE = 9_973;
const WORKLOAD_WITHHELD_PARTNER_INDEX = 4_242;
const WITHHELD_ATTRIBUTION_ROW_INDEX: number = 6_431;
const WORKLOAD_PARTNER_KINDS: readonly [PartnerKind, ...PartnerKind[]] = ["person", "person", "person", "person", "household", "household", "church", "organization"];
const WORKLOAD_CURRENCIES: readonly [string, ...string[]] = ["USD", "USD", "USD", "EUR", "EUR", "KWD", "JPY"];
const WORKLOAD_DESIGNATIONS: readonly [string | null, ...(string | null)[]] = ["Youth ministry", "Student ministry", null];
const WORKLOAD_GIVEN_NAMES: readonly [string, ...string[]] = ["Ada", "Bram", "Chidi", "Dalia", "Eero", "Fatima", "Grace", "Hana", "Iwan", "Jonas", "Keiko", "Lucas", "Marisol", "Nadia", "Owen", "Priya", "Ruth", "Sara", "Tobias", "Елена", "سارة"];
const WORKLOAD_FAMILY_NAMES: readonly [string, ...string[]] = ["Adeyemi", "Baptiste", "Costa", "Dubois", "Eriksen", "Fischer", "Gupta", "Hale", "Ito", "Jimenez", "Kern", "Lindqvist", "Mbeki", "Nakamura", "Okafor", "Pritchard", "Quinn", "Raman", "Sokolova", "Webb", "الحسن"];
const WORKLOAD_TAGS: readonly [string, ...string[]] = ["workload", "generated", "church", "volunteer", "newsletter", "follow-up"];
export type WorkloadCoverage = { readonly from: string; readonly to: string; readonly state: Extract<CoverageState, "partial"> };
export interface WorkloadBoundaryCases {
  readonly absentMonth: string;
  readonly withheldPartnerId: string;
  readonly withheldAttributionRowId: string;
  readonly anonymousGiftRowId: string;
  readonly splitGiftIds: readonly string[];
  readonly refundRowIds: readonly string[];
  readonly unidentifiedCurrencyGiftRowIds: readonly string[];
}
export interface WorkloadHeader {
  readonly version: number;
  readonly sessionId: string;
  readonly seed: number;
  readonly basis: SupportBasis;
  readonly generatedAt: string;
  readonly partnerCount: number;
  readonly giftCount: number;
  readonly currencies: readonly string[];
  readonly coverage: WorkloadCoverage;
  readonly source: SourceReference;
  readonly boundaryCases: WorkloadBoundaryCases;
}
export type WorkloadDocument = { readonly header: WorkloadHeader; readonly partners: readonly PartnerRecord[]; readonly gifts: readonly GiftRowRecord[] };
export type WorkloadSummary = { readonly sessionId: string; readonly partners: number; readonly gifts: number; readonly currencies: readonly string[]; readonly coverage: WorkloadCoverage; readonly generatedAt: string; readonly elapsedMs: number; readonly storePath: string; readonly workloadPath: string };
export type GenerateWorkloadOptions = { readonly elapsedMs?: number };
type Sequence = () => number;
function createSequence(seed: number): Sequence {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1) >>> 0;
    mixed = (mixed ^ (mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61))) >>> 0;
    return (mixed ^ (mixed >>> 14)) >>> 0;
  };
}
const pick = <Value>(values: readonly [Value, ...Value[]], next: Sequence): Value => values[next() % values.length] ?? values[0];
const padded = (index: number, width: number): string => String(index).padStart(width, "0");
const partnerIdOf = (index: number): string => `partner-workload-${padded(index, 5)}`;
const giftIdOf = (index: number): string => `gift-workload-${padded(index, 6)}`;
const giftRowIdOf = (index: number): string => `gift-row-workload-${padded(index, 6)}`;
const amountOf = (currency: string, minorUnits: number): Money => ({ currency, minorUnits: minorUnitsOf(minorUnits) });
type WorkloadWindow = { readonly days: readonly [CivilDate, ...CivilDate[]]; readonly coverage: WorkloadCoverage };
const monthKey = (day: CivilDate): string => serialiseCivilDate(day).slice(0, 7);
function seedDay(): CivilDate {
  const resolved = civilDateAt(SEED_INSTANT, WORKLOAD_ZONE);
  if (resolved.status !== "resolved") throw new RangeError(`The seed instant ${SEED_INSTANT.toString()} cannot be read as a civil date in the zone ${WORKLOAD_ZONE}, so the workload has no history to spread its gift dates over.`);
  return resolved.date;
}
function buildWindow(): WorkloadWindow {
  const today = seedDay();
  const firstDay = today.subtract({ years: HISTORY_YEARS });
  const lastDay = today.subtract({ days: 1 });
  const days: CivilDate[] = [];
  for (let day = firstDay; day.equals(lastDay) !== true; day = day.add({ days: 1 })) if (monthKey(day) !== ABSENT_MONTH) days.push(day);
  if (monthKey(lastDay) !== ABSENT_MONTH) days.push(lastDay);
  const [first, ...rest] = days;
  if (first === undefined) throw new Error(`The workload's history window (${serialiseCivilDate(firstDay)} to ${serialiseCivilDate(lastDay)}, excluding ${ABSENT_MONTH}) holds no day at all, so no gift date could be generated from it.`);
  return { days: [first, ...rest], coverage: { from: serialiseCivilDate(firstDay), to: serialiseCivilDate(today.with({ day: 1 }).subtract({ days: 1 })), state: "partial" } };
}
const isSplitParent = (index: number): boolean => index % SPLIT_GIFT_STRIDE === 0 && index + SPLIT_ALLOCATION_WEIGHTS.length <= WORKLOAD_GIFT_COUNT;
const isRefund = (index: number): boolean => REFUND_ROW_INDICES.includes(index);
const isUnidentifiedCurrency = (index: number): boolean => index % UNIDENTIFIED_CURRENCY_STRIDE === 0;
function assertBoundaryIndices(): void {
  const pinned = [ANONYMOUS_GIFT_ROW_INDEX, WITHHELD_ATTRIBUTION_ROW_INDEX];
  if (ANONYMOUS_GIFT_ROW_INDEX === WITHHELD_ATTRIBUTION_ROW_INDEX) throw new Error("The anonymous row and the withheld attribution row cannot be the same row.");
  for (const index of [...REFUND_ROW_INDICES, ...pinned]) if (isSplitParent(index) || isUnidentifiedCurrency(index)) throw new Error(`Gift row ${String(index)} carries a pinned boundary case and also falls on a split-gift or unidentified-currency row, so the case it names would not exist.`);
  for (const index of pinned) if (REFUND_ROW_INDICES.includes(index)) throw new Error(`Gift row ${String(index)} is both a refund row and a pinned attribution row.`);
  for (const index of REFUND_ROW_INDICES)
    if (index - 1 < 1 || isSplitParent(index - 1) || isUnidentifiedCurrency(index - 1) || isRefund(index - 1)) throw new Error(`The refund row ${String(index)} corrects gift row ${String(index - 1)}, which is not an ordinary gift row of a known currency, so the correction could not be stated.`);
}
const PARTNER_DISPLAY_NAME_BUILDERS: Readonly<Record<PartnerKind, (given: string, family: string, suffix: string) => string>> = {
  person: (given, family) => `${given} ${family}`,
  household: (_given, family) => `${family} household`,
  church: (_given, family) => `${family} Church`,
  organization: (_given, family) => `${family} Trust`,
  "private-preparation": (_given, family, suffix) => `${family} preparation ${suffix}`,
};
const displayNameOf = (kind: PartnerKind, given: string, family: string, suffix: string): string => PARTNER_DISPLAY_NAME_BUILDERS[kind](given, family, suffix);
function buildPartner(index: number, next: Sequence): PartnerRecord {
  const suffix = padded(index, 5);
  const given = pick(WORKLOAD_GIVEN_NAMES, next);
  const family = pick(WORKLOAD_FAMILY_NAMES, next);
  const favourite = next() % 50 === 0;
  const withheld = index === WORKLOAD_WITHHELD_PARTNER_INDEX;
  const kind: PartnerKind = withheld ? "person" : pick(WORKLOAD_PARTNER_KINDS, next);
  return {
    partnerId: partnerIdOf(index),
    kind,
    displayName: displayNameOf(kind, given, family, suffix),
    nameParts: kind === "person" ? { given, family, additional: [] } : null,
    contactMethods: withheld ? [] : [{ kind: "email", value: `workload-${suffix}@example.org`, permitted: true, verified: false }],
    restrictions: [],
    tags: [pick(WORKLOAD_TAGS, next)],
    favourite,
    stage: null,
    audience: withheld ? "private" : "shared",
    source: { system: "crm", reference: `workload-${suffix}` },
    revision: INITIAL_REVISION,
  };
}
type GiftRowFacts = { readonly index: number; readonly giftId: string; readonly allocationId: string | null; readonly amount: Money; readonly originalGiftOn: CivilDate; readonly designation: string | null; readonly attribution: GiftAttribution; readonly refundOf: string | null };
const buildGiftRow = (facts: GiftRowFacts): GiftRowRecord => ({
  giftRowId: giftRowIdOf(facts.index),
  giftId: facts.giftId,
  allocationId: facts.allocationId,
  amount: facts.amount,
  originalGiftOn: serialiseCivilDate(facts.originalGiftOn),
  datePrecision: "date",
  designation: facts.designation,
  attribution: facts.attribution,
  refundOf: facts.refundOf,
  provenance: { system: "finance", reference: facts.giftId },
  entryOn: serialiseCivilDate(facts.originalGiftOn),
  revision: INITIAL_REVISION,
});
function attributionOf(index: number, next: Sequence): GiftAttribution {
  const roll = next() % 1_000;
  if (index === WITHHELD_ATTRIBUTION_ROW_INDEX) return { kind: "partner", partnerId: partnerIdOf(WORKLOAD_WITHHELD_PARTNER_INDEX) };
  if (index === ANONYMOUS_GIFT_ROW_INDEX) return { kind: "anonymous" };
  return roll < 995 ? { kind: "partner", partnerId: partnerIdOf(1 + (next() % WORKLOAD_PARTNER_COUNT)) } : roll < 998 ? { kind: "anonymous" } : { kind: "unresolved" };
}
const donationAmount = (currency: string, next: Sequence): Money => amountOf(currency, 500 + (next() % 20_000) * 5);
function generateGiftRows(next: Sequence, window: WorkloadWindow): GiftRowRecord[] {
  const rows: GiftRowRecord[] = [];
  for (let index = 1; index <= WORKLOAD_GIFT_COUNT; index += 1) {
    const originalGiftOn = pick(window.days, next);
    const designation = pick(WORKLOAD_DESIGNATIONS, next);
    const attribution = attributionOf(index, next);
    if (isSplitParent(index)) {
      const giftId = giftIdOf(index);
      const total = donationAmount(pick(WORKLOAD_CURRENCIES, next), next);
      const parts = allocateMinor(total, SPLIT_ALLOCATION_WEIGHTS);
      rows.push(buildGiftRow({ index, giftId, allocationId: null, amount: total, originalGiftOn, designation, attribution, refundOf: null }));
      for (const [order, part] of parts.entries()) rows.push(buildGiftRow({ index: index + order + 1, giftId, allocationId: `alloc-workload-${padded(index, 6)}-${String(order + 1)}`, amount: part, originalGiftOn, designation, attribution, refundOf: null }));
      index += parts.length;
      continue;
    }
    if (isRefund(index)) {
      const corrected = rows[rows.length - 1];
      if (corrected === undefined) throw new Error(`The refund at gift row ${String(index)} corrects the row before it, and no row precedes it; the fixed indices in this module are inconsistent.`);
      rows.push(buildGiftRow({ index, giftId: giftIdOf(index), allocationId: null, amount: negateMinor(corrected.amount), originalGiftOn, designation: corrected.designation, attribution: corrected.attribution, refundOf: corrected.giftRowId }));
      continue;
    }
    const currency = isUnidentifiedCurrency(index) ? UNKNOWN_CURRENCY : pick(WORKLOAD_CURRENCIES, next);
    rows.push(buildGiftRow({ index, giftId: giftIdOf(index), allocationId: null, amount: donationAmount(currency, next), originalGiftOn, designation, attribution, refundOf: null }));
  }
  return rows;
}
const currenciesOf = (rows: readonly GiftRowRecord[]): readonly string[] => [...new Set(rows.map((row) => row.amount.currency))].sort();
const boundaryCasesOf = (rows: readonly GiftRowRecord[]): WorkloadBoundaryCases => ({
  absentMonth: ABSENT_MONTH,
  withheldPartnerId: partnerIdOf(WORKLOAD_WITHHELD_PARTNER_INDEX),
  withheldAttributionRowId: giftRowIdOf(WITHHELD_ATTRIBUTION_ROW_INDEX),
  anonymousGiftRowId: giftRowIdOf(ANONYMOUS_GIFT_ROW_INDEX),
  splitGiftIds: [...new Set(rows.filter((row) => row.allocationId !== null).map((row) => row.giftId))].sort(),
  refundRowIds: rows.filter((row) => row.refundOf !== null).map((row) => row.giftRowId),
  unidentifiedCurrencyGiftRowIds: rows.filter((row) => row.amount.currency === UNKNOWN_CURRENCY).map((row) => row.giftRowId),
});
const assertSeededSession = (sessionId: string): void => {
  if (!isSafeSessionId(sessionId) || !isSeededSessionId(sessionId)) throw new RangeError(`Cannot generate a workload for ${JSON.stringify(sessionId)}: the workload belongs to a seeded session, and the seed defines only its own rows.`);
};
export function buildWorkload(sessionId: string = DEFAULT_WORKLOAD_SESSION_ID): WorkloadDocument {
  assertSeededSession(sessionId);
  assertBoundaryIndices();
  const next = createSequence(WORKLOAD_SEED);
  const window = buildWindow();
  const partners = Array.from({ length: WORKLOAD_PARTNER_COUNT }, (_unused, offset) => buildPartner(offset + 1, next));
  const gifts = generateGiftRows(next, window);
  if (partners.length !== WORKLOAD_PARTNER_COUNT || gifts.length !== WORKLOAD_GIFT_COUNT)
    throw new Error(
      `The workload generator produced ${String(partners.length)} partners and ${String(gifts.length)} gift rows where the published workload is ${String(WORKLOAD_PARTNER_COUNT)} and ${String(WORKLOAD_GIFT_COUNT)}; a shortfall would invalidate the whole-query agreement and the measurements this dataset exists for.`,
    );
  const header: WorkloadHeader = {
    version: WORKLOAD_DOCUMENT_VERSION,
    sessionId,
    seed: WORKLOAD_SEED,
    basis: SUPPORT_BASIS,
    generatedAt: SEED_INSTANT.toString(),
    partnerCount: partners.length,
    giftCount: gifts.length,
    currencies: currenciesOf(gifts),
    coverage: window.coverage,
    source: { system: "finance", reference: `workload-seed-${String(WORKLOAD_SEED)}` },
    boundaryCases: boundaryCasesOf(gifts),
  };
  return { header, partners, gifts };
}
async function persistWorkload(sessionId: string, workload: WorkloadDocument): Promise<void> {
  let existing: Awaited<ReturnType<typeof readSession>>;
  try {
    existing = await readSession(sessionId);
  } catch (error) {
    if (!(error instanceof StoreAbsentError)) throw error;
    existing = undefined;
  }
  if (existing === undefined) return void (await resetSession(sessionId, { ...seedSessionDocuments(sessionId), workload }));
  await transact(sessionId, ["workload"], (draft) => (draft.workload = workload));
}
/** Generates the published workload into a seeded session's store document and reports what it did. */ export async function generateWorkload(sessionId: string = DEFAULT_WORKLOAD_SESSION_ID, options: GenerateWorkloadOptions = {}): Promise<WorkloadSummary> {
  const workload = buildWorkload(sessionId);
  await persistWorkload(sessionId, workload);
  return { sessionId, partners: workload.partners.length, gifts: workload.gifts.length, currencies: workload.header.currencies, coverage: workload.header.coverage, generatedAt: workload.header.generatedAt, elapsedMs: options.elapsedMs ?? 0, storePath: DATA_ROOT, workloadPath: sessionPaths(sessionId).workload };
}
