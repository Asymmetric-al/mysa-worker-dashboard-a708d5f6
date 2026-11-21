/**
 * The published validation workload: 10,000 partners and 100,000 gift rows, generated deterministically
 * from one fixed seed and written into a session's `<sessionId>.workload.json` document.
 *
 * Plan items that put this file in scope:
 * - AAP 0.7.2 "Generator" — `scripts/generate-workload.ts` "deterministically produces 10,000 partners
 *   and 100,000 gifts from a fixed seed for the whole-query and performance work. Fixtures are
 *   generated from a compact source; no large repeated dataset is checked in."
 * - AAP 0.7.2 — "The generated large workload lives in `<sessionId>.workload.json`, so the readable
 *   seed stays small": this module writes that document and no other.
 * - AAP 0.8.7 "Validation workload" (10,000 partners, 100,000 gifts) and AAP 0.12.3's two
 *   measurements, which are taken on this dataset.
 * - AAP 0.12.1 criteria 1 and 6, and AAP 0.11.1's row `modules/dev-runtime/generate.ts`.
 *
 * The dataset serves criterion 1 (chart, table, drilldown, CSV and print agreeing on one query) and
 * criterion 6 (reading a month and a year of support), and nothing beyond them. Every deliberate case
 * below exists because one of those criteria asserts it: a gift split into two allocations with its
 * parent row beside them, a refund that names the row it corrects, anonymous support, a record this
 * context may not show, amounts whose currency the source never identified, and one month with no gift
 * at all. Each is placed at a fixed row index rather than found by luck, so a verifier asserts on a
 * named case instead of scanning a hundred thousand rows.
 *
 * Determinism is what makes a measurement an observation rather than a one-off: every row comes from
 * one integer sequence seeded by {@link WORKLOAD_SEED}, every date is a civil date derived from
 * {@link SEED_INSTANT}, and nothing here reads the machine clock, the pseudo-random global, the
 * environment or a file. Two runs therefore write byte-identical documents, and the store sorts keys,
 * so the whole document is stable down to its bytes.
 *
 * Layering: a development-runtime module, one of the two places the lint configuration allows to reach
 * the store (the other is the data service). It writes only through the store's own document surface —
 * `transact` for an existing session, `resetSession` as the creating path — never through the
 * filesystem directly and never through the store's atomic helper. The record shapes are imported from
 * `data-service/envelope` FOR TYPES ONLY, so no runtime edge runs back into the data service and the
 * import graph stays acyclic.
 */
import type {
  CoverageState,
  GiftAttribution,
  GiftRowRecord,
  PartnerKind,
  PartnerRecord,
} from "@/modules/data-service/envelope";
import { allocateMinor, minorUnitsOf, negateMinor, type Money } from "@/modules/money/amount";
import { UNKNOWN_CURRENCY } from "@/modules/money/currency";
import { SUPPORT_BASIS, type SupportBasis } from "@/modules/support/basis";
import { DATA_ROOT, isSafeSessionId, sessionPaths } from "@/modules/store/paths";
import { readSession, resetSession, transact } from "@/modules/store/repository";
import { civilDateAt, serialiseCivilDate, type CivilDate } from "@/modules/time/civil";
import { SEED_INSTANT } from "@/modules/time/clock";
import type { SourceReference } from "@/lib/ids";

import { DEFAULT_SESSION_ID, isSeededSessionId, seedSessionDocuments } from "./seed";

// ---------------------------------------------------------------------------------------------
// The volume, the seed and the document version
// ---------------------------------------------------------------------------------------------

/**
 * The volume AAP 0.8.7 fixes: 10,000 partners and 100,000 gift rows.
 *
 * They are constants rather than options because the published workload is the workload the criteria
 * name: a report over a differently sized dataset would not be comparable with the measurements it
 * serves. A generator bug that changed either count is thrown from `buildWorkload` instead of being
 * written, because a shortfall would silently weaken criterion 1.
 */
export const WORKLOAD_PARTNER_COUNT = 10_000;
export const WORKLOAD_GIFT_COUNT = 100_000;

/** The version of the workload document this module writes, so a reader can tell its shape. */
export const WORKLOAD_DOCUMENT_VERSION = 1;

/** The fixed seed of the one integer sequence every generated row derives from. */
export const WORKLOAD_SEED = 20_261_120;

/**
 * The seeded session the workload is written into when the caller names none: the established worker,
 * whose readable seed is the one the journeys and the giving investigation start from.
 *
 * It is the seed module's own default rather than a second literal, so the session the generator fills
 * and the session a reset lays down cannot drift apart.
 */
export const DEFAULT_WORKLOAD_SESSION_ID: string = DEFAULT_SESSION_ID;

/** The revision every generated row carries: the first revision, as the readable seed's records do. */
const INITIAL_REVISION = "rev-1";

/**
 * The zone civil dates are read in. It is stated rather than assumed, and one zone serves the whole
 * document so a generated date can never depend on where the process happens to run.
 */
const WORKLOAD_ZONE = "UTC";

/** How many years of gift history the window holds, counted back from the seed day. */
const HISTORY_YEARS = 4;

/**
 * The one month the workload deliberately has no gift in, so a monthly history has a gap to show as a
 * gap. A month with no rows is missing data, and a surface that rendered it as a zero would be stating
 * that supporters gave nothing rather than that the source holds nothing for it.
 */
const ABSENT_MONTH = "2024-02";

// ---------------------------------------------------------------------------------------------
// The deliberate cases, at fixed row indices
// ---------------------------------------------------------------------------------------------

/** Every thousandth gift row is the parent of a gift split across two allocations. */
const SPLIT_GIFT_STRIDE = 1_000;

/** The weights one split gift is apportioned by; `allocateMinor` makes the parts sum to the total. */
const SPLIT_ALLOCATION_WEIGHTS = [40, 60] as const;

/** The rows that refund the gift row before them, each naming the row it corrects. */
const REFUND_ROW_INDICES: readonly number[] = Object.freeze([2_500, 5_250, 7_750, 9_025]);

/** The one row whose donation is anonymous, over and above the anonymous share of the sequence. */
const ANONYMOUS_GIFT_ROW_INDEX: number = 8_503;

/** Every n-th plain row carries an amount whose currency the source never identified. */
const UNIDENTIFIED_CURRENCY_STRIDE = 9_973;

/** The one partner record whose identity a context that may not read private preparation withholds. */
const WORKLOAD_WITHHELD_PARTNER_INDEX = 4_242;

/** The one gift row attributed to that record, so the withheld identity is reachable by a read. */
const WITHHELD_ATTRIBUTION_ROW_INDEX: number = 6_431;

/** What a partner record is, weighted towards people as a real roster is; the withheld record is a person. */
const WORKLOAD_PARTNER_KINDS: readonly [PartnerKind, ...PartnerKind[]] = [
  "person",
  "person",
  "person",
  "person",
  "household",
  "household",
  "church",
  "organization",
];

/** The currencies the gifts are spread over, weighted as a ministry's support usually is. */
const WORKLOAD_CURRENCIES: readonly [string, ...string[]] = [
  "USD",
  "USD",
  "USD",
  "EUR",
  "EUR",
  "KWD",
  "JPY",
];

/** The designations a gift may carry; `null` is a gift the source recorded no designation for. */
const WORKLOAD_DESIGNATIONS: readonly [string | null, ...(string | null)[]] = [
  "Youth ministry",
  "Student ministry",
  null,
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

/** Family names for the generated records, drawn independently of the given names. */
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

// ---------------------------------------------------------------------------------------------
// What the document and a run state about themselves
// ---------------------------------------------------------------------------------------------

/**
 * How much of the past the workload's gift history covers.
 *
 * `state` is the literal `partial`, not a caller's choice: the source's history begins after the
 * ministry's records do and the month the scenario clock sits in is not finished, so every subtotal
 * over this history is an incomplete subtotal and every surface must say so. `to` is the last day of
 * complete evidence — the end of the last finished month — which is what lets a read label the current
 * month *In progress* instead of treating it as a month with less giving in it.
 */
export interface WorkloadCoverage {
  readonly from: string;
  readonly to: string;
  readonly state: Extract<CoverageState, "partial">;
}

/**
 * The deliberate cases the dataset holds, named by the row or record that carries each one.
 *
 * A verifier — the report agreement test, the export parity test, the giving investigation spec —
 * asserts on these names rather than on a position it recomputes: the boundary cases are the point of
 * the dataset, and a second copy of their indices would be a second place to keep them right.
 */
export interface WorkloadBoundaryCases {
  /** The month no gift falls in, so a monthly history has a genuine gap. */
  readonly absentMonth: string;
  /** The private-audience partner record a context that may not read preparation withholds. */
  readonly withheldPartnerId: string;
  /** The gift row attributed to that record. */
  readonly withheldAttributionRowId: string;
  /** The gift row whose donation is anonymous. */
  readonly anonymousGiftRowId: string;
  /** Every split gift, each held as its parent row plus the allocation rows it is split into. */
  readonly splitGiftIds: readonly string[];
  /** Every refund row, each naming the row it corrects. */
  readonly refundRowIds: readonly string[];
  /** Every row whose currency the source never identified, so it is never summed or defaulted. */
  readonly unidentifiedCurrencyGiftRowIds: readonly string[];
}

/**
 * What the workload document states about itself, so a reader never has to infer its provenance.
 *
 * `basis` is the one named received-support basis the gift rows are stated on, `currencies` is every
 * code in use including the one the currency table does not hold, and `coverage` is the window above.
 * A support read merging these rows builds its projection from these facts instead of inventing a
 * basis, a coverage or an exponent of its own.
 */
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

/** The generated dataset: the header that describes it, the partners and the gift rows. */
export interface WorkloadDocument {
  readonly header: WorkloadHeader;
  readonly partners: readonly PartnerRecord[];
  readonly gifts: readonly GiftRowRecord[];
}

/** What one generation did, stated in the terms the calling script prints and a measurement records. */
export interface WorkloadSummary {
  readonly sessionId: string;
  /** How many partner records the document holds: {@link WORKLOAD_PARTNER_COUNT}. */
  readonly partners: number;
  /** How many gift rows the document holds: {@link WORKLOAD_GIFT_COUNT}, the row count a whole-query CSV exports. */
  readonly gifts: number;
  /** Every currency in use, in code-unit order, including one the currency table does not hold. */
  readonly currencies: readonly string[];
  readonly coverage: WorkloadCoverage;
  /** The scenario instant the document was generated for, which is the seed instant and never a clock read. */
  readonly generatedAt: string;
  /** The duration the caller measured for the run; `0` when it measured nothing. */
  readonly elapsedMs: number;
  /** The store directory the run wrote into. */
  readonly storePath: string;
  /** The absolute path of the session document this run wrote. */
  readonly workloadPath: string;
}

/** Options a caller supplies for a run it has already measured from the outside. */
export interface GenerateWorkloadOptions {
  /**
   * The wall-clock duration of the run, measured by the caller.
   *
   * It is injected rather than measured here because this module reads no clock at all: a generation
   * whose output depended on when it ran could not be compared with the run before it.
   */
  readonly elapsedMs?: number;
}

// ---------------------------------------------------------------------------------------------
// The one integer sequence
// ---------------------------------------------------------------------------------------------

/** The next unsigned 32-bit integer of the generator's sequence. */
type Sequence = () => number;

/**
 * Starts the generator's integer sequence (mulberry32), returning one step at a time.
 *
 * It is written here rather than added as a dependency because the sequence must produce the same rows
 * on every machine, and a thirty-line deterministic function is the whole requirement. State in,
 * unsigned integer out: no value it returns is a float, so no amount built from it can drift.
 */
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

/** Picks one entry of a non-empty list from the sequence; the list type guarantees an entry exists. */
function pick<Value>(values: readonly [Value, ...Value[]], next: Sequence): Value {
  return values[next() % values.length] ?? values[0];
}

/** Zero-pads an index so two generated identities never collide and sort in creation order. */
function padded(index: number, width: number): string {
  return String(index).padStart(width, "0");
}

/** The identity of the partner at one 1-based index. */
function partnerIdOf(index: number): string {
  return `partner-workload-${padded(index, 5)}`;
}

/** The identity of the gift at one 1-based index, shared by that gift's allocation rows. */
function giftIdOf(index: number): string {
  return `gift-workload-${padded(index, 6)}`;
}

/** The identity of the gift row at one 1-based index. */
function giftRowIdOf(index: number): string {
  return `gift-row-workload-${padded(index, 6)}`;
}

/** Builds one exact amount from a currency code and integer minor units. */
function amountOf(currency: string, minorUnits: number): Money {
  return { currency, minorUnits: minorUnitsOf(minorUnits) };
}

// ---------------------------------------------------------------------------------------------
// The history window the gift dates come from
// ---------------------------------------------------------------------------------------------

/** The days a gift may carry, and the coverage those days constitute. */
interface WorkloadWindow {
  /** Every eligible day in ascending order: the whole window with the absent month removed. */
  readonly days: readonly [CivilDate, ...CivilDate[]];
  readonly coverage: WorkloadCoverage;
}

/** The month one civil date falls in, as `YYYY-MM`, for the absent-month comparison. */
function monthKey(day: CivilDate): string {
  return serialiseCivilDate(day).slice(0, 7);
}

/** Reads the seed instant as the calendar day the scenario clock starts on, in the workload's zone. */
function seedDay(): CivilDate {
  const resolved = civilDateAt(SEED_INSTANT, WORKLOAD_ZONE);
  if (resolved.status !== "resolved") {
    throw new RangeError(
      `The seed instant ${SEED_INSTANT.toString()} cannot be read as a civil date in the zone ${WORKLOAD_ZONE}, so the workload has no history to spread its gift dates over.`,
    );
  }
  return resolved.date;
}

/**
 * Builds the history window: {@link HISTORY_YEARS} back from the seed day up to the day before it, with
 * the absent month removed, and the coverage those rows constitute.
 *
 * Deriving the window instead of writing dates down is what keeps the dataset honest about time. No
 * generated gift can carry a date in the future relative to the scenario clock, the month the clock
 * sits in is present but unfinished, and the coverage the header states is the window the rows came
 * from rather than a claim about it.
 */
function buildWindow(): WorkloadWindow {
  const today = seedDay();
  const firstDay = today.subtract({ years: HISTORY_YEARS });
  const lastDay = today.subtract({ days: 1 });

  const days: CivilDate[] = [];
  for (let day = firstDay; day.equals(lastDay) !== true; day = day.add({ days: 1 })) {
    if (monthKey(day) !== ABSENT_MONTH) {
      days.push(day);
    }
  }
  // The loop stops before the last day so the comparison stays a simple equality; it joins here,
  // unless it is the one day the absent month would have covered.
  if (monthKey(lastDay) !== ABSENT_MONTH) {
    days.push(lastDay);
  }

  const [first, ...rest] = days;
  if (first === undefined) {
    throw new Error(
      `The workload's history window (${serialiseCivilDate(firstDay)} to ${serialiseCivilDate(lastDay)}, excluding ${ABSENT_MONTH}) holds no day at all, so no gift date could be generated from it.`,
    );
  }

  return {
    days: [first, ...rest],
    coverage: {
      from: serialiseCivilDate(firstDay),
      // The end of the last finished month: complete evidence stops there, which is what lets a read
      // label the current month *In progress* rather than treating it as a month with less giving in it.
      to: serialiseCivilDate(today.with({ day: 1 }).subtract({ days: 1 })),
      state: "partial",
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Which row carries which deliberate case
// ---------------------------------------------------------------------------------------------

/** Whether one gift row index is the parent of a gift that is split across allocation rows. */
function isSplitParent(index: number): boolean {
  return (
    index % SPLIT_GIFT_STRIDE === 0 &&
    index + SPLIT_ALLOCATION_WEIGHTS.length <= WORKLOAD_GIFT_COUNT
  );
}

/** Whether one gift row index refunds the row before it. */
function isRefund(index: number): boolean {
  return REFUND_ROW_INDICES.includes(index);
}

/** Whether one plain gift row carries an amount whose currency the source never identified. */
function isUnidentifiedCurrency(index: number): boolean {
  return index % UNIDENTIFIED_CURRENCY_STRIDE === 0;
}

/**
 * Refuses a generation whose fixed indices would collide, because a case that was meant to exist would
 * silently be a different case.
 *
 * Every index above is a literal in this module, so a collision can only come from editing one of them
 * without editing the others. Throwing is the honest answer: the dataset's value is that each case is
 * present and findable, and a generation that quietly lost one would weaken the criteria it serves.
 */
function assertBoundaryIndices(): void {
  const pinned = [ANONYMOUS_GIFT_ROW_INDEX, WITHHELD_ATTRIBUTION_ROW_INDEX];
  if (ANONYMOUS_GIFT_ROW_INDEX === WITHHELD_ATTRIBUTION_ROW_INDEX) {
    throw new Error("The anonymous row and the withheld attribution row cannot be the same row.");
  }

  for (const index of [...REFUND_ROW_INDICES, ...pinned]) {
    if (isSplitParent(index) || isUnidentifiedCurrency(index)) {
      throw new Error(
        `Gift row ${String(index)} carries a pinned boundary case and also falls on a split-gift or unidentified-currency row, so the case it names would not exist.`,
      );
    }
  }

  for (const index of pinned) {
    if (REFUND_ROW_INDICES.includes(index)) {
      throw new Error(
        `Gift row ${String(index)} is both a refund row and a pinned attribution row.`,
      );
    }
  }

  // A refund corrects the row before it, so that row must be an ordinary gift row of a known currency:
  // a refund of an amount whose currency the source never identified cannot be stated at all.
  for (const index of REFUND_ROW_INDICES) {
    const corrected = index - 1;
    if (
      corrected < 1 ||
      isSplitParent(corrected) ||
      isUnidentifiedCurrency(corrected) ||
      isRefund(corrected)
    ) {
      throw new Error(
        `The refund row ${String(index)} corrects gift row ${String(corrected)}, which is not an ordinary gift row of a known currency, so the correction could not be stated.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The builders
// ---------------------------------------------------------------------------------------------

/** The display name a record of one kind carries; a person's name is never derived from its parts. */
function displayNameOf(kind: PartnerKind, given: string, family: string, suffix: string): string {
  switch (kind) {
    case "person":
      return `${given} ${family}`;
    case "household":
      return `${family} household`;
    case "church":
      return `${family} Church`;
    case "organization":
      return `${family} Trust`;
    default:
      return `${family} preparation ${suffix}`;
  }
}

/**
 * Builds one generated partner record.
 *
 * The sequence decides every field a row varies, so the roster is stable across runs. `source` carries
 * an opaque reference and no join key: two generated records that looked alike would still be two
 * records, because identity here is the generated identifier and nothing else.
 *
 * One record is the withheld case. It is a person the worker keeps private — `audience: "private"`,
 * with no contact method — so a context that may not read private preparation withholds its identity
 * rather than showing it, and a gift attributed to it is what makes that withholding observable in a
 * financial surface.
 */
function buildPartner(index: number, next: Sequence): PartnerRecord {
  const suffix = padded(index, 5);
  const drawnKind = pick(WORKLOAD_PARTNER_KINDS, next);
  const given = pick(WORKLOAD_GIVEN_NAMES, next);
  const family = pick(WORKLOAD_FAMILY_NAMES, next);
  const tag = pick(WORKLOAD_TAGS, next);
  const favourite = next() % 50 === 0;
  const withheld = index === WORKLOAD_WITHHELD_PARTNER_INDEX;
  const kind: PartnerKind = withheld ? "person" : drawnKind;

  return {
    partnerId: partnerIdOf(index),
    kind,
    displayName: displayNameOf(kind, given, family, suffix),
    nameParts: kind === "person" ? { given, family, additional: [] } : null,
    contactMethods: withheld
      ? []
      : [
          {
            kind: "email",
            value: `workload-${suffix}@example.org`,
            permitted: true,
            verified: false,
          },
        ],
    restrictions: [],
    tags: [tag],
    favourite,
    stage: null,
    audience: withheld ? "private" : "shared",
    source: { system: "crm", reference: `workload-${suffix}` },
    revision: INITIAL_REVISION,
  };
}

/** The facts one gift row is assembled from, so a parent, an allocation and a refund share one shape. */
interface GiftRowFacts {
  readonly index: number;
  readonly giftId: string;
  readonly allocationId: string | null;
  readonly amount: Money;
  readonly originalGiftOn: CivilDate;
  readonly designation: string | null;
  readonly attribution: GiftAttribution;
  readonly refundOf: string | null;
}

/** Builds one gift row from its facts; the row id is the index, so a row's identity never drifts. */
function buildGiftRow(facts: GiftRowFacts): GiftRowRecord {
  const day = serialiseCivilDate(facts.originalGiftOn);
  return {
    giftRowId: giftRowIdOf(facts.index),
    giftId: facts.giftId,
    allocationId: facts.allocationId,
    amount: facts.amount,
    originalGiftOn: day,
    datePrecision: "date",
    designation: facts.designation,
    attribution: facts.attribution,
    refundOf: facts.refundOf,
    provenance: { system: "finance", reference: facts.giftId },
    entryOn: day,
    revision: INITIAL_REVISION,
  };
}

/**
 * Chooses who one gift row is attributed to.
 *
 * Both draws happen on every row whatever the outcome, so one row's attribution cannot shift the rest
 * of the sequence. Most rows name a partner; a small share are anonymous donations and a smaller share
 * are source rows that supplied no attribution at all — three different facts about a donation, never
 * one field that is usually empty. The withheld identity and one anonymous row are pinned by index, so
 * each case exists whether or not the sequence happens to reach it.
 */
function attributionOf(index: number, next: Sequence): GiftAttribution {
  const partnerIndex = 1 + (next() % WORKLOAD_PARTNER_COUNT);
  const roll = next() % 1_000;

  if (index === WITHHELD_ATTRIBUTION_ROW_INDEX) {
    return { kind: "partner", partnerId: partnerIdOf(WORKLOAD_WITHHELD_PARTNER_INDEX) };
  }
  if (index === ANONYMOUS_GIFT_ROW_INDEX) {
    return { kind: "anonymous" };
  }
  if (roll < 995) {
    return { kind: "partner", partnerId: partnerIdOf(partnerIndex) };
  }
  return roll < 998 ? { kind: "anonymous" } : { kind: "unresolved" };
}

/** One ordinary amount: a whole number of minor units inside a plausible per-gift range. */
function donationAmount(currency: string, next: Sequence): Money {
  return amountOf(currency, 500 + (next() % 20_000) * 5);
}

/**
 * Generates the gift rows in ascending row index, exactly {@link WORKLOAD_GIFT_COUNT} of them.
 *
 * The row index is the dataset's spine: every row at index `i` carries `gift-row-workload-<i>`, and a
 * deliberate case is one that a named index produces. A split gift spends three of those indices — the
 * parent row and the two allocations it is split into — so the array stays exactly the row count a
 * whole-query CSV exports, while the gift itself is one gift counted once. `allocateMinor` splits the
 * amount, so the allocations sum to the parent exactly and no unit is created or lost.
 *
 * A refund is its own row carrying the source's negative amount and naming the row it corrects, rather
 * than a gift that quietly disappears from a period already reported. A row whose currency the source
 * never identified keeps that state: it is generated only where the currency is never needed for a
 * split or a negation, and nothing here defaults it to two decimals.
 */
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
      rows.push(
        buildGiftRow({
          index,
          giftId,
          allocationId: null,
          amount: total,
          originalGiftOn,
          designation,
          attribution,
          refundOf: null,
        }),
      );
      for (const [order, part] of parts.entries()) {
        rows.push(
          buildGiftRow({
            index: index + order + 1,
            giftId,
            allocationId: `alloc-workload-${padded(index, 6)}-${String(order + 1)}`,
            amount: part,
            originalGiftOn,
            designation,
            attribution,
            refundOf: null,
          }),
        );
      }
      // The allocation rows occupy the next indices, so the row count stays exactly the fixed volume.
      index += parts.length;
      continue;
    }

    if (isRefund(index)) {
      const corrected = rows[rows.length - 1];
      if (corrected === undefined) {
        throw new Error(
          `The refund at gift row ${String(index)} corrects the row before it, and no row precedes it; the fixed indices in this module are inconsistent.`,
        );
      }
      rows.push(
        buildGiftRow({
          index,
          giftId: giftIdOf(index),
          allocationId: null,
          amount: negateMinor(corrected.amount),
          originalGiftOn,
          designation: corrected.designation,
          attribution: corrected.attribution,
          refundOf: corrected.giftRowId,
        }),
      );
      continue;
    }

    const currency = isUnidentifiedCurrency(index)
      ? UNKNOWN_CURRENCY
      : pick(WORKLOAD_CURRENCIES, next);
    rows.push(
      buildGiftRow({
        index,
        giftId: giftIdOf(index),
        allocationId: null,
        amount: donationAmount(currency, next),
        originalGiftOn,
        designation,
        attribution,
        refundOf: null,
      }),
    );
  }

  return rows;
}

/** Every currency the gift rows are actually in, in code-unit order, including an unidentified one. */
function currenciesOf(rows: readonly GiftRowRecord[]): readonly string[] {
  return [...new Set(rows.map((row) => row.amount.currency))].sort();
}

/**
 * Names every deliberate case by the row or record that carries it, read back off the generated rows so
 * the index the document reports is the index the rows actually have.
 */
function boundaryCasesOf(rows: readonly GiftRowRecord[]): WorkloadBoundaryCases {
  return {
    absentMonth: ABSENT_MONTH,
    withheldPartnerId: partnerIdOf(WORKLOAD_WITHHELD_PARTNER_INDEX),
    withheldAttributionRowId: giftRowIdOf(WITHHELD_ATTRIBUTION_ROW_INDEX),
    anonymousGiftRowId: giftRowIdOf(ANONYMOUS_GIFT_ROW_INDEX),
    splitGiftIds: [
      ...new Set(rows.filter((row) => row.allocationId !== null).map((row) => row.giftId)),
    ].sort(),
    refundRowIds: rows.filter((row) => row.refundOf !== null).map((row) => row.giftRowId),
    unidentifiedCurrencyGiftRowIds: rows
      .filter((row) => row.amount.currency === UNKNOWN_CURRENCY)
      .map((row) => row.giftRowId),
  };
}

/** Refuses a session the workload cannot belong to, before anything is built or written. */
function assertSeededSession(sessionId: string): void {
  if (!isSafeSessionId(sessionId) || !isSeededSessionId(sessionId)) {
    throw new RangeError(
      `Cannot generate a workload for ${JSON.stringify(sessionId)}: the workload belongs to a seeded session, and the seed defines only its own rows.`,
    );
  }
}

// ---------------------------------------------------------------------------------------------
// The document, and the run that writes it
// ---------------------------------------------------------------------------------------------

/**
 * Builds the workload document for one session.
 *
 * It is a pure function of the session id and {@link WORKLOAD_SEED}: the same call produces the same
 * document on every run and every machine, and it writes nothing. The two counts are asserted before
 * the document exists, because a generator bug that changed either one would quietly weaken the
 * criteria this dataset exists for.
 */
export function buildWorkload(sessionId: string = DEFAULT_WORKLOAD_SESSION_ID): WorkloadDocument {
  assertSeededSession(sessionId);
  assertBoundaryIndices();

  const next = createSequence(WORKLOAD_SEED);
  const window = buildWindow();

  const partners: PartnerRecord[] = [];
  for (let index = 1; index <= WORKLOAD_PARTNER_COUNT; index += 1) {
    partners.push(buildPartner(index, next));
  }
  const gifts = generateGiftRows(next, window);

  if (partners.length !== WORKLOAD_PARTNER_COUNT || gifts.length !== WORKLOAD_GIFT_COUNT) {
    throw new Error(
      `The workload generator produced ${String(partners.length)} partners and ${String(gifts.length)} gift rows where the published workload is ${String(WORKLOAD_PARTNER_COUNT)} and ${String(WORKLOAD_GIFT_COUNT)}; a shortfall would invalidate the whole-query agreement and the measurements this dataset exists for.`,
    );
  }

  return {
    header: {
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
    },
    partners,
    gifts,
  };
}

/**
 * Writes the workload document into a session, and touches nothing else.
 *
 * A session the store already holds keeps every other document: `transact` takes the session's lock,
 * writes the workload and skips the documents whose bytes did not change, so a worker's accepted edits
 * and the operation ledger survive a regeneration. A clean checkout holds no session to add a document
 * to, so the store's creating path lays the readable seed down with the workload in the same call —
 * which is what makes `bun run seed:workload` work on a fresh clone without a reset first.
 *
 * The readable seed is otherwise untouched, which is why `reset` followed by `seed:workload` is a clean
 * two-step: the second command adds the large dataset and leaves the seed's records byte-identical.
 */
async function persistWorkload(sessionId: string, workload: WorkloadDocument): Promise<void> {
  const existing = await readSession(sessionId);
  if (existing === undefined) {
    await resetSession(sessionId, { ...seedSessionDocuments(sessionId), workload });
    return;
  }

  await transact(sessionId, (draft) => {
    draft.workload = workload;
  });
}

/**
 * Generates the published workload into a seeded session's store document and reports what it did.
 *
 * `sessionId` defaults to the established worker's seeded session, so `bun run seed:workload` names no
 * session; a measurement that wants another session states it. The elapsed time is the caller's own
 * measurement and is passed in, because this module reads no clock: a run whose output depended on the
 * moment it started could not be compared with the run before it.
 */
export async function generateWorkload(
  sessionId: string = DEFAULT_WORKLOAD_SESSION_ID,
  options: GenerateWorkloadOptions = {},
): Promise<WorkloadSummary> {
  const workload = buildWorkload(sessionId);
  await persistWorkload(sessionId, workload);

  return {
    sessionId,
    partners: workload.partners.length,
    gifts: workload.gifts.length,
    currencies: workload.header.currencies,
    coverage: workload.header.coverage,
    generatedAt: workload.header.generatedAt,
    elapsedMs: options.elapsedMs ?? 0,
    storePath: DATA_ROOT,
    workloadPath: sessionPaths(sessionId).workload,
  };
}
