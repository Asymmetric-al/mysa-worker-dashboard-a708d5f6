/**
 * The Referrals family's browser-side payload schemas — recording an original introduction date, and
 * continuing one expired cycle — plus the one normaliser for the three referral lists' query state.
 *
 * Scope. This is the client-side counterpart of `POST /api/referrals` and
 * `POST /api/referrals/continue` (AAP 0.6.3), the referral rules of AAP 0.8.3, the New and
 * continuation windows AAP 0.8.7 fixes, the tree rows AAP 0.9.1 `features/referrals/` and AAP 0.11.1
 * `features/referrals/**`, and family 5 of AAP 0.10.1. Success criterion 15 is the behaviour it
 * serves: an introduction date with the precision it is known to, an Active list ending at an
 * exclusive endpoint, expired history with its narrow fields, and a continuation ending at the
 * acceptance instant plus elapsed seconds.
 *
 * Shape and vocabulary only. Every schema here validates the **payload alone**: the four-field
 * mutation input `{ operationId, scope, expectedRevision, payload }` is composed by the family's
 * hooks, so nothing below declares an attempt identity, a context or an expected revision, reads a
 * clock, compares a revision or asks a permission question. Whether the named partner is visible,
 * whether the cycle is ordinarily expired, whether the worker-continuation setting is on, whether
 * this session already continued the cycle, and what instant a continuation ends at are the
 * service's questions, answered against the record as it stands in
 * `@/modules/data-service/mutations/outreach.ts`.
 *
 * The service stays the authority on the shapes. Its own schemas for `recordIntroduction` and
 * `continueReferral` are strict objects, so a key it does not accept cannot be added here: every
 * request carrying one would be refused as an unknown key. Those payload types are not exported
 * through `@/modules/data-service`, so the parity this file can prove at compile time is the
 * precision vocabulary, anchored on the stored `ReferralCycleRecord`; the members are transcribed
 * from the service file, and a divergence between the two surfaces as an `invalid` outcome whose
 * messages are keyed by field path — the shape `@/components/form-field` already renders.
 *
 * The four distinctions these schemas must not blur, because the workflow's meaning depends on each:
 *
 * - **The original introduction date is evidence, not an entry time.** The field is the date the
 *   introduction happened on. Import, first view, reassignment, merge and a retry are never a new
 *   introduction, and no schema below offers an instant, a "recorded at" member or a way to state
 *   today in its place. Nothing here adds a day, starts a clock or derives a deadline: a late first
 *   entry may already be expired, and the window is the service's to resolve and persist.
 * - **Precision is chosen, never defaulted.** `date`, `approximate` and `unknown` are three states
 *   with three different consequences — only a date-precise introduction yields an exclusive
 *   endpoint and an Active/Expired judgement — so `datePrecision` is required and a payload that
 *   omits it is refused rather than filed as if the date were exact.
 * - **A source reference is an opaque identity, never a person.** A reference is the pair
 *   `{ system, reference }` the owning system issued: carried, never parsed, never compared across
 *   systems and never a join key. Neither payload has a member for an address or a display name, so
 *   a payload asserting one is refused by the strict object instead of quietly becoming an identity.
 * - **A continuation acts on one consumed cycle.** The payload names that cycle and nothing else: the
 *   cycle's index, its predecessor and the instant the continuation ends are facts the service reads
 *   from the record and resolves at acceptance (`A + N × 86,400 seconds`), and a client-computed
 *   deadline would be a second owner of a boundary AAP 0.8.7 fixes.
 *
 * The list query state is normalisation only. `parseReferralListQuery` turns a URL's search
 * parameters into the state the referral read executes — which of the three lists, a whole-dataset
 * search, a page and a page size — and never filters, sorts or paginates a row itself: the read
 * owns those, so one query yields the rows, the count and the page every surface shows (AAP 0.3.4).
 * The page size is clamped to the 200 ceiling exactly as the read clamps it, and an unreadable page
 * falls back to 1 rather than erroring the screen. Both of those members are therefore total: a page
 * and a page size are normalised from whatever the address or the table carries, so neither ever
 * raises a refusal and no refusal sentence exists for either. The ordering is not normalised: the
 * read presents every list newest first, so descending is the only direction admitted, and any other
 * is refused at the direction that named it.
 *
 * Plan items: AAP 0.6.1 "Mutations: initiatives and referrals", AAP 0.6.3's `GET/POST /api/referrals`
 * and `POST /api/referrals/continue` rows, AAP 0.7.1's outcome set, AAP 0.8.3 (an introduction date
 * with precision, a New window with an exclusive endpoint, a consumed cycle with at most one
 * successor), AAP 0.8.7 (the New and continuation windows, and the 50/200 list page sizes), and
 * AAP 0.10.1 family 5. Rule 1 clause 1 is why this file holds exactly two payloads and one query
 * state, with no field for a deferred capability; clause 2 is why there is one schema per payload and
 * no second query-state parser; clause 3 is why the distinctions above are enforced here rather than
 * left to a screen.
 */
import { z } from "zod";

import type { ReferralCycleRecord } from "@/modules/data-service";

// ---------------------------------------------------------------------------------------------
// Wording
//
// Each sentence below is a refusal a field shows, written once so a schema and the control that
// renders it cannot drift apart. Guidance about referrals themselves belongs to the family's copy;
// these are validation messages only, and each names the value that was refused and the remedy.
// ---------------------------------------------------------------------------------------------

/**
 * The refusals the `recordIntroduction` payload states, exported so the introduction form and the
 * schema cannot word the same refusal two ways.
 */
export const INTRODUCTION_MESSAGES = {
  partnerRequired: "Choose the person this introduction refers to.",
  partnerTooLong: "A partner reference is at most 200 characters.",
  dateRequired: "Choose the date this introduction actually happened.",
  dateInvalid: "Enter the date as year, month and day, such as 2026-02-28.",
  unknownStatesNoDate:
    "An unknown introduction date states no date at all, so clear the date rather than entering a guess a later reader would treat as evidence.",
  precisionRequired:
    "Record how precisely the introduction date is known: the date itself, an approximation, or unknown.",
  zoneRequired: "State the time zone this introduction date is known in, such as Europe/London.",
  zoneInvalid: "Use a time zone name such as Europe/London, or an offset such as +05:30.",
  sourceSystemRequired: "Name the source system that issued this reference.",
  sourceReferenceRequired: "Enter the reference the source issued.",
  systemTooLong: "A source system name is at most 64 characters.",
  referenceTooLong: "A source reference is at most 200 characters.",
} as const;

/**
 * The refusals the `continueReferral` payload states, exported so the Continue confirmation and the
 * schema cannot word the same refusal two ways.
 */
export const CONTINUE_MESSAGES = {
  referralRequired:
    "This change is missing the referral it belongs to, so reload the referral and try again.",
  referralTooLong: "A referral reference is at most 200 characters.",
} as const;

/**
 * The refusals the referral list query state states, exported so the toolbar that shows them and the
 * normaliser that raises them cannot drift apart.
 */
export const LIST_QUERY_MESSAGES = {
  viewInvalid: "Choose one of the referral lists: Active, Incomplete date or Expired.",
  searchTooLong: "Shorten the search to 120 characters or fewer.",
  sortFieldInvalid:
    "The referral lists are ordered by the end of their window or by their introduction date, so choose one of those.",
  sortAscendingUnavailable:
    "The referral lists are presented newest first, so the end of the window and the introduction date are shown descending.",
  statedOnce:
    "State this filter once; this address carries more than one value for it, so the list cannot tell which was meant.",
  formLevel:
    "This address does not describe a referral list the application can show, so the default list is shown.",
} as const;

// ---------------------------------------------------------------------------------------------
// The precision an introduction date is known to
// ---------------------------------------------------------------------------------------------

/**
 * The three precisions an introduction date is recorded with, in the fixed order the release states
 * them (AAP 0.8.3).
 *
 * Declared against the stored record's own union, so a precision this list named and the record did
 * not would fail to compile rather than reach a request body. `@/modules/time/civil` declares the
 * same three as its `DatePrecision`; it is deliberately not imported, because a schema module has no
 * business pulling the calendar implementation into a browser bundle to restate a literal list.
 */
export const DATE_PRECISION_VALUES = [
  "date",
  "approximate",
  "unknown",
] as const satisfies readonly ReferralCycleRecord["datePrecision"][];

/** One date precision, derived from {@link DATE_PRECISION_VALUES}. */
export type DatePrecisionValue = (typeof DATE_PRECISION_VALUES)[number];

/**
 * Validates the precision an introduction date is known to.
 *
 * No default, deliberately: `date` yields an exclusive endpoint and an Active/Expired judgement that
 * `approximate` and `unknown` withhold, so the choice is the worker's to state rather than something
 * a form may assume. `satisfies` proves the enum covers the record's whole vocabulary, so the two
 * cannot drift in either direction.
 */
export const datePrecisionSchema = z.enum(DATE_PRECISION_VALUES, {
  error: INTRODUCTION_MESSAGES.precisionRequired,
}) satisfies z.ZodType<ReferralCycleRecord["datePrecision"]>;

// ---------------------------------------------------------------------------------------------
// A civil date, checked against the calendar
// ---------------------------------------------------------------------------------------------

/**
 * The shape of a stored civil date: a four-digit year, a two-digit month and a two-digit day.
 *
 * Shape alone is not enough — `2026-02-30` has the shape of a date and names no day — so
 * {@link isRealCivilDate} checks the calendar too. That check is arithmetic on the three numbers and
 * nothing else: no clock is read, no midnight is invented and no instant is produced, which is what
 * keeps the boundary arithmetic in `@/modules/time/window` the one place a window is resolved.
 */
const CIVIL_DATE_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** Reports whether `year` is a leap year in the Gregorian calendar a civil date names. */
function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** The number of days `month` has in `year`. Callers have already refused a month outside 1–12. */
function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/**
 * Reports whether a `YYYY-MM-DD` string names a day the calendar has.
 *
 * Refuses the wrong shape, a month outside 1–12 and a day the month does not hold, so `2026-02-30`
 * and `2026-13-01` are rejected instead of being rolled forward into a day nobody chose.
 */
function isRealCivilDate(value: string): boolean {
  const match = CIVIL_DATE_SHAPE.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1] ?? "");
  const month = Number(match[2] ?? "");
  const day = Number(match[3] ?? "");
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  return day <= daysInMonth(year, month);
}

/**
 * Validates one civil date as it travels in a payload: the stored `YYYY-MM-DD` form, trimmed, naming
 * a day the calendar holds.
 *
 * The value stays a string. The service parses it into the date its window functions take, and JSON
 * carries a string, so a client that sent a richer shape would be sending one nothing reads.
 */
const civilDateSchema = z
  .string({ error: INTRODUCTION_MESSAGES.dateInvalid })
  .trim()
  .refine((value) => isRealCivilDate(value), INTRODUCTION_MESSAGES.dateInvalid);

// ---------------------------------------------------------------------------------------------
// The opaque identities and the zone a payload carries
// ---------------------------------------------------------------------------------------------

/** The longest reference to a record this application holds, matching the length the service accepts. */
const MAX_REFERENCE_LENGTH = 200;

/** The longest source-system name, which is a name and never a URL. */
const MAX_SYSTEM_LENGTH = 64;

/** The longest time-zone identifier accepted; longer than every zone name the tz database holds. */
const MAX_ZONE_LENGTH = 64;

/**
 * A reference to a record this application holds: trimmed, non-empty and bounded.
 *
 * Opaque in the same way a source reference is — the value travels to the service, is never parsed
 * and is never widened into an identity — and bounded so a malformed value is refused at its own
 * field instead of arriving as a late refusal of the whole request.
 */
function referenceFieldSchema(required: string, tooLong: string): z.ZodString {
  return z.string({ error: required }).trim().min(1, required).max(MAX_REFERENCE_LENGTH, tooLong);
}

/**
 * Validates an opaque, source-qualified reference: `{ system, reference }`.
 *
 * Both members are carried, never read: `reference` is not parsed, not split on a separator, not
 * compared across systems and never used as a join key, while `system` names the owner that issued
 * it. Two references whose `reference` strings look identical denote different records when their
 * systems differ, and an equal name, email address or postal address establishes nothing — which is
 * why no payload in this family offers a member that could stand in for one.
 */
export const sourceReferenceSchema = z.strictObject({
  system: z
    .string({ error: INTRODUCTION_MESSAGES.sourceSystemRequired })
    .trim()
    .min(1, INTRODUCTION_MESSAGES.sourceSystemRequired)
    .max(MAX_SYSTEM_LENGTH, INTRODUCTION_MESSAGES.systemTooLong),
  reference: z
    .string({ error: INTRODUCTION_MESSAGES.sourceReferenceRequired })
    .trim()
    .min(1, INTRODUCTION_MESSAGES.sourceReferenceRequired)
    .max(MAX_REFERENCE_LENGTH, INTRODUCTION_MESSAGES.referenceTooLong),
});

/**
 * The shape of a time-zone identifier: a zone name such as `Europe/London` or `Asia/Kolkata`, or a
 * UTC offset such as `+05:30`.
 *
 * A shape check only. Whether the zone can actually be resolved — and therefore whether this
 * introduction date has an exclusive endpoint at all — is answered where the arithmetic lives: the
 * service refuses a zone it cannot resolve with a message on this field, so a schema here never
 * pretends to have resolved one.
 */
const ZONE_SHAPE = /^(?:[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*|[+-]\d{2}:\d{2})$/u;

/**
 * Validates the time zone an introduction date is known in.
 *
 * Required rather than defaulted: a civil date is a day in a stated zone, and a zone this
 * application assumed would put an exclusive endpoint on a day nobody chose (AAP 0.8.7).
 */
const sourceZoneSchema = z
  .string({ error: INTRODUCTION_MESSAGES.zoneRequired })
  .trim()
  .min(1, INTRODUCTION_MESSAGES.zoneRequired)
  .max(MAX_ZONE_LENGTH, INTRODUCTION_MESSAGES.zoneInvalid)
  .regex(ZONE_SHAPE, INTRODUCTION_MESSAGES.zoneInvalid);

// ---------------------------------------------------------------------------------------------
// recordIntroduction: the original introduction date, with the precision it is known to
// ---------------------------------------------------------------------------------------------

/**
 * Validates the `recordIntroduction` payload: the partner, the original introduction date, the
 * precision that date is known to, the zone it is known in, and the source that issued it.
 *
 * Member for member the service's payload, which is the authority on the shape. The date is
 * optional-and-nullable there because `unknown` precision states no date while the other two
 * precisions require one; those two cross-field rules are the refinement below, so a payload stating
 * `unknown` with a date, or `date` with none, is refused here instead of after a round trip.
 *
 * The refinement decides shape only. The exclusive endpoint a date-precise introduction resolves to,
 * and whether its zone can be resolved at all, belong to the service (`newWindowEnd` in
 * `@/modules/time/window`), so nothing here adds a day, reads a clock or states a deadline.
 *
 * The transform normalises an absent date to `null`, so the payload that leaves the browser always
 * states the member: an `unknown` introduction says "no date" explicitly rather than leaving a key
 * out that a later reader has to interpret.
 */
export const introductionPayloadSchema = z
  .strictObject({
    partnerId: referenceFieldSchema(
      INTRODUCTION_MESSAGES.partnerRequired,
      INTRODUCTION_MESSAGES.partnerTooLong,
    ),
    originalIntroductionOn: civilDateSchema.nullable().optional(),
    datePrecision: datePrecisionSchema,
    sourceZone: sourceZoneSchema,
    sourceReference: sourceReferenceSchema,
  })
  .superRefine((payload, context) => {
    if (payload.datePrecision === "unknown") {
      if (payload.originalIntroductionOn !== null && payload.originalIntroductionOn !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["originalIntroductionOn"],
          message: INTRODUCTION_MESSAGES.unknownStatesNoDate,
        });
      }
      return;
    }
    if (payload.originalIntroductionOn === null || payload.originalIntroductionOn === undefined) {
      context.addIssue({
        code: "custom",
        path: ["originalIntroductionOn"],
        message: INTRODUCTION_MESSAGES.dateRequired,
      });
    }
  })
  .transform((payload) => ({
    partnerId: payload.partnerId,
    originalIntroductionOn: payload.originalIntroductionOn ?? null,
    datePrecision: payload.datePrecision,
    sourceZone: payload.sourceZone,
    sourceReference: payload.sourceReference,
  }));

/** The validated `recordIntroduction` payload: the original introduction date and its provenance. */
export type IntroductionPayload = z.infer<typeof introductionPayloadSchema>;

// ---------------------------------------------------------------------------------------------
// continueReferral: one consumed cycle, and nothing the service resolves
// ---------------------------------------------------------------------------------------------

/**
 * Validates the `continueReferral` payload: the expired cycle the continuation acts on.
 *
 * The service's payload names that cycle and nothing else, so this one does too, and the strict
 * object is what refuses every member a second owner of the boundary would need. No cycle index: the
 * record already holds the index of the occurrence being continued. No predecessor or
 * acknowledgement reference: the predecessor is a fact of the store, not of the request. No date: the
 * continuation ends at the acceptance instant plus `N × 86,400` seconds, resolved and persisted by the
 * service, so a client-stated deadline would be exactly the second owner AAP 0.8.7 rules out.
 * Whether the cycle is ordinarily expired, whether the worker-continuation setting is on and whether
 * it was already continued are answered by the service before it writes.
 */
export const continueReferralPayloadSchema = z.strictObject({
  referralId: referenceFieldSchema(
    CONTINUE_MESSAGES.referralRequired,
    CONTINUE_MESSAGES.referralTooLong,
  ),
});

/** The validated `continueReferral` payload: the identity of the one expired cycle to continue. */
export type ContinueReferralPayload = z.infer<typeof continueReferralPayloadSchema>;

// ---------------------------------------------------------------------------------------------
// The three lists, and the query state an address carries for them
// ---------------------------------------------------------------------------------------------

/**
 * The three referral lists, in the order the surface presents them: Active, the introductions whose
 * date is not precise enough for a deadline, and the narrow permitted Expired history.
 *
 * The literals are the referral read's own, hyphenated `incomplete-date` included, so an address
 * cannot name a fourth list no read would serve. The member is called `view` because that is what the
 * address and the surface call it; `readReferrals` takes the same choice as its `list` member. They are three distinct questions rather than one list filtered three ways: an
 * approximate or unknown date belongs to the second and is never briefly activated, and expired
 * history is a narrow permission rather than access to the partner behind it.
 */
export const REFERRAL_VIEWS = ["active", "incomplete-date", "expired"] as const;

/** One referral list, derived from {@link REFERRAL_VIEWS}. */
export type ReferralView = (typeof REFERRAL_VIEWS)[number];

/** The list a request that names none is shown: Active, the question the surface opens on. */
export const DEFAULT_REFERRAL_VIEW: ReferralView = "active";

/**
 * The two page sizes the referral pager offers, smallest first: the release's 50-row default and its
 * 200-row ceiling (AAP 0.8.7).
 *
 * An option list for the control, and the ceiling the normaliser clamps to. The read clamps to the
 * same 200 instead of refusing a larger request, so a hand-edited address yields a full first page
 * rather than an error the reader cannot clear.
 */
export const REFERRAL_PAGE_SIZES = [50, 200] as const;

/** The rows one page holds when a request states no size. */
export const DEFAULT_REFERRAL_PAGE_SIZE = 50;

/** The longest search text accepted: a name fragment, bounded so an address cannot carry a document. */
export const REFERRAL_SEARCH_MAX_LENGTH = 120;

/**
 * The two keys the referral lists are ordered by, most significant first: the end of the window, then
 * the introduction date. Both run newest first, with the referral's own identity as the final
 * tiebreak.
 *
 * Closed to what `readReferrals` applies. Sorting belongs to the service (AAP 0.3.4), so this state
 * may name the ordering the read produces and never one a component would have to produce by
 * re-sorting a page of a whole-dataset result — which would order the page, not the list.
 */
export const REFERRAL_SORT_FIELDS = ["windowEnd", "originalIntroductionOn"] as const;

/** One key a referral list may be ordered by, derived from {@link REFERRAL_SORT_FIELDS}. */
export type ReferralSortField = (typeof REFERRAL_SORT_FIELDS)[number];

/**
 * Validates one ordering of a referral list: a key from the closed set, and the one direction the
 * read honours.
 *
 * Strict, so an ordering naming a column the lists do not order by is a refusal at that field rather
 * than a choice the surface silently ignores. Descending is the direction enum's only member because
 * it is the only order the read applies — every list runs newest endpoint first and then newest
 * introduction (AAP 0.3.4) — so an ascending request is refused here, at the direction that stated
 * it, rather than admitted and rejected by a second check elsewhere.
 */
export const referralSortSchema = z.strictObject({
  field: z.enum(REFERRAL_SORT_FIELDS, { error: LIST_QUERY_MESSAGES.sortFieldInvalid }),
  direction: z.enum(["desc"], { error: LIST_QUERY_MESSAGES.sortAscendingUnavailable }),
});

/** The validated ordering of a referral list. */
export type ReferralSort = z.infer<typeof referralSortSchema>;

/**
 * Reads a whole number from a URL value: digits only, so `12`, `"12"` and a form control's string all
 * read as 12 while `"1.5"`, `"-3"` and `"ten"` read as nothing at all.
 *
 * Digits-only deliberately. A page is a count of pages and a page size a count of rows, and
 * `Number("1e3")`, `Number("0x10")` and a padded string would each turn a value nobody typed into a
 * plausible count.
 *
 * The value is `unknown` because an address, a table and a hand-built state hold different kinds, and
 * a count is normalised rather than refused: anything that is not a number or a string — absent,
 * `null`, an object, a list — reads as no number at all, so the caller falls back to the count the
 * read would apply instead of raising a refusal a reader cannot clear.
 */
function wholeNumberFrom(value: unknown): number | undefined {
  if (typeof value !== "number" && typeof value !== "string") {
    return undefined;
  }
  const text = typeof value === "number" ? String(value) : value.trim();
  if (!/^\d+$/u.test(text)) {
    return undefined;
  }
  const count = Number(text);
  return Number.isSafeInteger(count) ? count : undefined;
}

/**
 * The page a request asks for, or 1 when it asks for something no page can be.
 *
 * The read answers an unreadable page below 1 with the first page, so this normaliser does the same
 * instead of raising a refusal for a part of the address a reader cannot clear. It answers for every
 * value it can be handed: text that is not a count, a count below 1 and a value of another kind all
 * read as the first page, which is why the page field states no refusal at all.
 */
function pageFrom(value: unknown): number {
  const page = wholeNumberFrom(value);
  return page === undefined || page < 1 ? 1 : page;
}

/**
 * The page size a request asks for: {@link DEFAULT_REFERRAL_PAGE_SIZE} when it asks for nothing a
 * page can hold, and clamped to {@link REFERRAL_PAGE_SIZES}' ceiling rather than refused — which is
 * how the read treats the same value. It answers for every value it can be handed, so text that is
 * not a count, a count below 1 and a value of another kind all read as the default size.
 */
function pageSizeFrom(value: unknown): number {
  const size = wholeNumberFrom(value);
  if (size === undefined || size < 1) {
    return DEFAULT_REFERRAL_PAGE_SIZE;
  }
  return size > REFERRAL_PAGE_SIZES[1] ? REFERRAL_PAGE_SIZES[1] : size;
}

/**
 * A page as an address or a table carries it: a number, the text of one, or any other value the
 * caller holds, read as the page {@link pageFrom} answers.
 *
 * Total by construction, because `unknown` refuses nothing: a malformed page reads as the first page
 * at the field itself, so no schema library wording and no refusal reaches the surface for it.
 */
const pageFieldSchema = z.unknown().transform(pageFrom);

/**
 * A page size as an address or a table carries it: a number, the text of one, or any other value the
 * caller holds, clamped by {@link pageSizeFrom}.
 *
 * Total for the same reason as the page: nothing an address can carry is refused, so a malformed size
 * reads as the default size rather than as a refusal.
 */
const pageSizeFieldSchema = z.unknown().transform(pageSizeFrom);

/**
 * The query state one referral list is read with: which list, the whole-dataset search text, the
 * ordering the list is presented in, the page and the page size.
 *
 * The members the read needs are required once parsed, because the defaults are applied here rather
 * than left to each surface: a list rendering a row count without stating its page size, or a page
 * without stating which list it belongs to, is how two surfaces come to disagree about one query.
 * `sort` is present only when the address names an ordering, because the read applies its own when
 * none is named.
 */
export interface ReferralListQuery {
  /** Which of the three lists: the read's `list` member, named here as the address names it. */
  readonly view: ReferralView;
  /** Matched by the read against the partner's display name only, never against a reference. */
  readonly search: string;
  readonly sort?: ReferralSort;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * Validates and normalises a referral list query, whether it arrives as an address's strings or as
 * the numbers a table already holds.
 *
 * Normalisation, not execution: nothing here filters a row, orders a row or slices a page, and the
 * parsed state is what `readReferrals` runs. The page size is clamped and an unreadable page falls
 * back, exactly as the read does, so the state a surface shows and the rows it receives describe the
 * same request.
 *
 * An ascending direction is refused rather than accepted and ignored. The read presents every list
 * newest endpoint first and then newest introduction, and no surface may re-order a page it was given
 * (AAP 0.3.4), so a state asking for oldest first would have nothing that could honour it; the
 * ordering schema refuses it at `sort.direction`, which is why this schema states no second check.
 */
export const referralListQuerySchema = z
  .strictObject({
    view: z.enum(REFERRAL_VIEWS, { error: LIST_QUERY_MESSAGES.viewInvalid }).optional(),
    search: z
      .string({ error: LIST_QUERY_MESSAGES.searchTooLong })
      .trim()
      .max(REFERRAL_SEARCH_MAX_LENGTH, LIST_QUERY_MESSAGES.searchTooLong)
      .optional(),
    sort: referralSortSchema.optional(),
    page: pageFieldSchema.optional(),
    pageSize: pageSizeFieldSchema.optional(),
  })
  .transform((raw): ReferralListQuery => ({
    view: raw.view ?? DEFAULT_REFERRAL_VIEW,
    search: raw.search ?? "",
    sort: raw.sort,
    page: raw.page ?? 1,
    pageSize: raw.pageSize ?? DEFAULT_REFERRAL_PAGE_SIZE,
  }));

/**
 * Messages keyed by field path, the shape the service's `invalid` outcome also carries, so a control
 * renders a refusal this file raised and a refusal the service returned identically.
 */
export type ReferralListQueryFieldErrors = Readonly<Record<string, readonly string[]>>;

/**
 * The result of reading an address into referral query state: the normalised query, or messages keyed
 * by the field path a control shows them against.
 *
 * Two branches and no third, and neither throws: a malformed address is a link someone pasted, so the
 * caller decides how far to degrade — the default list, for instance — rather than the page failing.
 */
export type ReferralListQueryParse =
  | { readonly ok: true; readonly query: ReferralListQuery }
  | { readonly ok: false; readonly fieldErrors: ReferralListQueryFieldErrors };

/**
 * The key a message that names no field is reported under, matching the service's own key for a
 * form-level issue so a summary renders both kinds from one map.
 */
const FORM_LEVEL_FIELD = "_root";

/** The parameters this normaliser reads. Every other parameter in an address is left alone. */
const QUERY_KEYS = ["view", "search", "sort", "page", "pageSize"] as const;

/**
 * Reads one address parameter as a single value.
 *
 * A repeated parameter is ambiguous rather than additive — `view=active&view=expired` names two lists
 * — so it is reported against its own field instead of one of the values being picked, and the field's
 * other rules are skipped because there is nothing to judge.
 */
function singleValue(
  searchParams: Record<string, string | string[] | undefined>,
  key: string,
  fieldErrors: Record<string, readonly string[]>,
): string | undefined {
  const raw = searchParams[key];
  if (raw === undefined) {
    return undefined;
  }
  const distinct = [...new Set(Array.isArray(raw) ? raw : [raw])];
  if (distinct.length === 0) {
    return undefined;
  }
  if (distinct.length > 1) {
    fieldErrors[key] = [LIST_QUERY_MESSAGES.statedOnce];
    return undefined;
  }
  return distinct[0];
}

/**
 * Splits a `sort` parameter into the ordering it names: `<field>:<direction>`, the direction
 * defaulting to descending because that is the order the lists are presented in.
 *
 * Both halves go to the schema rather than being judged here, so an unknown key or an unknown
 * direction is refused with the same message a hand-built state receives.
 */
function sortFromText(text: string): { field: string; direction: string } {
  const separator = text.indexOf(":");
  if (separator < 0) {
    return { field: text.trim(), direction: "desc" };
  }
  return {
    field: text.slice(0, separator).trim(),
    direction: text.slice(separator + 1).trim(),
  };
}

/**
 * Normalises a referral list's address parameters into the query state the read executes.
 *
 * Reads `view`, `search`, `sort`, `page` and `pageSize` and ignores every other parameter, so a
 * campaign or analytics parameter in a pasted link does not become a refusal. The answer is the state
 * the service will run, or per-field messages in the shape an `invalid` outcome carries.
 *
 * @param searchParams A route's `searchParams`: a value per parameter, an array where the parameter
 *   repeats, and absent where it does not appear.
 */
export function parseReferralListQuery(
  searchParams: Record<string, string | string[] | undefined>,
): ReferralListQueryParse {
  const fieldErrors: Record<string, readonly string[]> = {};
  const candidate: Record<string, unknown> = {};

  for (const key of QUERY_KEYS) {
    const value = singleValue(searchParams, key, fieldErrors);
    if (value === undefined) {
      continue;
    }
    candidate[key] = key === "sort" ? sortFromText(value) : value;
  }

  const parsed = referralListQuerySchema.safeParse(candidate);
  if (parsed.success && Object.keys(fieldErrors).length === 0) {
    return { ok: true, query: parsed.data };
  }
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.length === 0 ? FORM_LEVEL_FIELD : issue.path.map(String).join(".");
      fieldErrors[path] = [...(fieldErrors[path] ?? []), issue.message];
    }
  }
  return { ok: false, fieldErrors };
}
