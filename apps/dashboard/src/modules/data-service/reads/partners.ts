/**
 * The partner roster, the one record body, the facet set, saved views, private preparation and
 * recorded activity: the six reads behind AAP 0.7.1's "Find and open a partner", "Prepare and
 * maintain a contact" and "Record what actually happened".
 *
 * One roster, one facet declaration, one paging contract, one support computation. `findPartners`,
 * `readFacets` and `readSavedViews` all read the single facet declaration below, so the values a
 * filter offers, the values it accepts and the values a stored view is judged against cannot drift
 * apart. Every money figure any of these reads returns comes from `modules/support/report`'s
 * `runReport`; this file selects which authorised rows a report sees and never sums, averages or
 * compares an amount itself. Every task, interaction, referral and initiative count is computed here,
 * over the whole authorised dataset, because a read that returned a page for someone else to total
 * would put the authority and the arithmetic in two places.
 *
 * Authorisation precedes enumeration. Scope is derived from the development session on every call and
 * never taken from an argument; a record is projected or dropped before it reaches an envelope; a
 * record outside the caller's documents and a record the caller may not read answer with the same
 * denial, because a distinguishable "not found" is an existence oracle. The giving facts are gated on
 * the support subject's own permission question, so a caller without it receives no giving facet, no
 * giving column and no option count from which one could be inferred.
 *
 * Three facts stay three. Contactability (`PartnerContactMethod.permitted`) is not communication
 * consent for one publisher and purpose, and neither is a protected-content reader grant: this file
 * states contactability only and never derives the other two. A household, a church, an organisation
 * and an organisation's representative are separate records, and no read here joins on a name, an
 * email address or a postal address — identity is the record's own identifier inside the scope.
 *
 * Worker-private preparation is a different record class. `readPrivatePreparation` is the only read
 * that returns a private note body; `findPartners` and `readPartner` carry shared operational facts
 * only, and an interaction note whose audience is `private` states no author anywhere in the stored
 * record, so it is withheld from the activity read instead of being attributed to whoever asked.
 *
 * Layering: a server-side module imported by Server Components and thin Route Handlers. It reads no
 * clock of its own (the session's scenario offset is the only time source), imports no component, no
 * feature and no application route, and reaches the synthetic store through `readSession` alone.
 */

import { Temporal } from "temporal-polyfill";
import { z } from "zod";

import type { SourceReference } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { failureFor, failurePlanOfDocument } from "@/modules/dev-runtime/failures";
import { minorUnitsOf } from "@/modules/money/amount";
import { readSession } from "@/modules/store/repository";
import { SUPPORT_BASIS, type GiftRow, type SupportProjection } from "@/modules/support/basis";
import {
  clampPageSize,
  runReport,
  type CurrencySummary,
  type PeriodState,
  type ReportPeriod,
  type ReportScope,
} from "@/modules/support/report";
import { instantAt } from "@/modules/time/clock";
import {
  parseCivilDate,
  serialiseCivilDate,
  todayInZone,
  type CivilDate,
} from "@/modules/time/civil";

import {
  assertScope,
  canView,
  resolveSession,
  type AuthorizationTarget,
  type ResolvedSession,
  type SessionSource,
} from "../authorize";
import {
  buildEnvelope,
  commitmentRowRecordSchema,
  giftRowRecordSchema,
  initiativeMemberRecordSchema,
  initiativeRecordSchema,
  interactionRecordSchema,
  partnerRecordSchema,
  principalIdSchema,
  privateNoteRecordSchema,
  project,
  recordRevisionSchema,
  referralCycleRecordSchema,
  sessionContextRecordSchema,
  supportProjectionRecordSchema,
  taskRecordSchema,
  type CommitmentRowRecord,
  type ContactMethodKind,
  type Coverage,
  type GiftRowRecord,
  type InitiativeRecord,
  type InteractionRecord,
  type PartnerKind,
  type PartnerRecord,
  type PrivateNoteRecord,
  type ReadAction,
  type ReadEnvelope,
  type RecordedValueState,
  type ReferralCycleRecord,
  type Scope,
  type SupportProjectionRecord,
  type TaskRecord,
  type ValueState,
} from "../envelope";
import {
  LOCAL_STORE_SYSTEM,
  denied,
  unavailable,
  type DenialReason,
  type DeniedOutcome,
  type ReadResult,
  type UnavailableOutcome,
} from "../outcome";

// ---------------------------------------------------------------------------------------------
// Constants: the vocabularies this file states once
// ---------------------------------------------------------------------------------------------

/**
 * The attempt identity a read refusal carries.
 *
 * A read has no attempt to replay, so it names no operation: the value exists because a denial's shape
 * is the same for a read and a write, and the only field that may differ between two refusals is the
 * reason code.
 */
const READ_ATTEMPT_ID = "read";

/** The zone a dated comparison resolves in when a request states none, so no host zone is ever used. */
const ROSTER_DEFAULT_TIME_ZONE = "UTC";

/**
 * The ordered facet keys of the roster's bounded facet set, exactly the order the family's copy lists
 * them in, so the toolbar's labels and the service's facets cannot enumerate different sets.
 *
 * The set is closed: this array is the whole of it, and no read here invents a fifteenth.
 */
export const PARTNER_FACET_IDS = [
  "contact-type",
  "preparation-state",
  "tag",
  "favourite",
  "relationship-label",
  "initiative-membership",
  "referral-status",
  "contact-method-availability",
  "geography",
  "recent-activity",
  "task-state",
  "last-received-gift-date",
  "giving-total",
  "commitment-status",
] as const;

/** One facet of the roster's bounded facet set. */
export type PartnerFacetId = (typeof PARTNER_FACET_IDS)[number];

/** Where a referral stands: judged from its preserved exclusive endpoint, never from an entry time. */
export const PARTNER_REFERRAL_STATUSES = ["active", "incomplete-date", "expired"] as const;

/** One referral state a partner can be in, derived from the cycles the source recorded. */
export type PartnerReferralStatus = (typeof PARTNER_REFERRAL_STATUSES)[number];

/** The fields the roster may sort by. Closed: an arbitrary field would be an ordering nothing states. */
export const PARTNER_SORT_FIELDS = [
  "displayName",
  "kind",
  "stage",
  "favourite",
  "lastActivityOn",
] as const;

/** One column the roster may sort by. */
export type PartnerSortField = (typeof PARTNER_SORT_FIELDS)[number];

/** The two directions a sort may take. */
export const PARTNER_SORT_DIRECTIONS = ["asc", "desc"] as const;

/** One direction a roster sort may take. */
export type PartnerSortDirection = (typeof PARTNER_SORT_DIRECTIONS)[number];

/**
 * The columns the roster may show, hide and store in a saved view.
 *
 * The list is the vocabulary a stored view is checked against: a visibility entry naming an
 * identifier absent from here refers to a column this build no longer offers, which is drift and not
 * a silent omission.
 */
export const PARTNER_ROSTER_COLUMNS = [
  "displayName",
  "kind",
  "stage",
  "tags",
  "favourite",
  "contactMethods",
  "lastActivity",
  "openTasks",
  "referralStatus",
  "giving",
] as const;

/** One column of the partner roster. */
export type PartnerRosterColumn = (typeof PARTNER_ROSTER_COLUMNS)[number];

/**
 * The five closed values the contact-type facet offers, in the record kind vocabulary's own order.
 *
 * Declared as records rather than literals so the facet labels are rendered exactly as the copy
 * module spells them and a kind added to the stored vocabulary fails to compile here.
 */
const CONTACT_TYPE_LABELS: Readonly<Record<PartnerKind, string>> = {
  person: "Person",
  household: "Household",
  church: "Church",
  organization: "Organization",
  "private-preparation": "Private preparation",
};

/** The words each closed facet value carries, so a facet never prints a stored token at a reader. */
const FAVOURITE_LABELS: Readonly<Record<"favourite" | "not-favourite", string>> = {
  favourite: "Favourites only",
  "not-favourite": "Not a favourite",
};

const PREPARATION_LABELS: Readonly<Record<"private" | "shared", string>> = {
  private: "Private record",
  shared: "Shared record",
};

const REFERRAL_STATUS_LABELS: Readonly<Record<PartnerReferralStatus, string>> = {
  active: "Active",
  "incomplete-date": "Date incomplete",
  expired: "Expired",
};

const CONTACT_METHOD_AVAILABILITY_LABELS: Readonly<
  Record<"any-permitted" | "none-permitted", string>
> = {
  "any-permitted": "Has a permitted contact method",
  "none-permitted": "No permitted contact method",
};

const ACTIVITY_LABELS: Readonly<Record<"recorded" | "none-recorded", string>> = {
  recorded: "Activity recorded",
  "none-recorded": "No activity recorded",
};

const TASK_STATE_LABELS: Readonly<Record<"open" | "overdue" | "no-date", string>> = {
  open: "Open task",
  overdue: "Overdue task",
  "no-date": "Task without a due date",
};

const GIVING_PRESENCE_LABELS: Readonly<Record<"recorded" | "none-recorded", string>> = {
  recorded: "A gift is recorded",
  "none-recorded": "No gift is recorded",
};

/**
 * The capabilities this read states when it asks whether the support subject may be viewed at all.
 *
 * The view question never consults a capability — only the goal's edit question does, and that
 * capability is derived and answered by the support read that owns the goal — so this read states an
 * empty set rather than inventing one, and no financial fact here depends on it.
 */
const NO_STATED_CAPABILITIES: readonly string[] = Object.freeze([]);

/**
 * The guidance an unavailable store answer carries.
 *
 * It names no path and no record: the caller can retry, and a persistent failure is the development
 * runtime's to reset. "Nothing was read" is stated because an empty roster and a zero are the two
 * answers this must never be mistaken for.
 */
const STORE_UNAVAILABLE_GUIDANCE =
  "This session's records could not be read, so no list, count or amount is shown rather than an empty one. Retry the read; if it keeps failing, reset the seeded development data.";

/**
 * The source a stated time zone is resolved against: the zone database this runtime reads a named
 * calendar from.
 *
 * The reference is opaque like every source reference, and it is deliberately not the zone string the
 * request carried: a request value is not a source identity, it is already reported back at the field
 * it arrived in, and a reference whose form a reader could parse would invite exactly the reading
 * `SourceReference` forbids.
 */
const CALENDAR_SOURCE: SourceReference = { system: "time-zone-database", reference: "calendar" };

/**
 * The guidance a roster read carries when the zone it was asked for cannot be resolved.
 *
 * "No date was judged" is stated because the counts and days this refusal stands in for are exactly
 * what it must never be mistaken for: an overdue count taken in UTC for a caller who named another
 * zone, or a last-received-gift day read off a calendar they never asked about, is a figure about the
 * wrong month. The correction it names is the one the caller can make: state a zone this runtime
 * resolves, or state none and take the declared UTC default.
 */
const CALENDAR_UNAVAILABLE_GUIDANCE =
  "No date in this roster was judged in an assumed time zone, so no overdue count, last-activity day or last-received-gift day is shown rather than one computed in a calendar you did not ask for. Choose a time zone this runtime resolves in Settings, or omit the zone and the read uses UTC, and read the roster again.";

/** The wording a facet uses when the source states no partner attribution for its fact. */
const NO_PARTNER_ATTRIBUTION =
  "The source states this fact for the support subject and attributes it to no partner, so the roster cannot narrow by it. It is shown here rather than offered as a filter that would match nothing.";

/** The wording a facet uses when the support source states no projection for this subject. */
const NO_SUPPORT_PROJECTION =
  "The source states no support projection for this subject, so no giving value can be offered or counted.";

/**
 * The wording a read carries when the caller may not state giving facts in this context.
 *
 * It never reaches a surface: a caller refused that authority receives no giving facet, column or
 * section at all, so this sentence exists only so the internal outcome has a reason to hold.
 */
const GIVING_UNAVAILABLE_WITHOUT_PERMISSION =
  "This context does not admit the support facts of the record set, so no giving value is offered here.";

// ---------------------------------------------------------------------------------------------
// The public read contract: facets, roster, saved views, detail
// ---------------------------------------------------------------------------------------------

/** One value a facet offers, with the whole-result count of records that carry it. */
export interface PartnerFacetValue {
  /** The identifier the filter matches and a stored view stores. */
  readonly id: string;
  /** The words a reader sees. An open value is rendered exactly as the source supplied it. */
  readonly label: string;
  /** How many records of the whole authorised result carry this value. A genuine `0` prints as `0`. */
  readonly count: number;
  /** The state of `count`; `unknown` when the count cannot be established rather than `0`. */
  readonly countState: ValueState;
}

/** The state a facet is offered in: usable, or unavailable with the source that did not answer. */
export type PartnerFacetState = "available" | "unavailable";

/**
 * One filter the roster offers.
 *
 * `operator` is the OR-inside-a-facet half of the release's one combination rule; the AND half is
 * stated by the roster read, which requires every selected facet to match. `disabledReason` is
 * visible text and never a silent disable, because a worker cannot tell an unavailable filter from a
 * broken one.
 */
export interface PartnerFacet {
  readonly id: PartnerFacetId;
  /** The key the family's copy maps to a sentence. The service states no display copy. */
  readonly labelKey: PartnerFacetId;
  readonly operator: "OR";
  /** Whether several values may be selected at once inside this facet. */
  readonly multi: boolean;
  readonly state: PartnerFacetState;
  readonly options: readonly PartnerFacetValue[];
  /** Why this facet cannot be applied now, present exactly when it cannot be. */
  readonly disabledReason?: string;
  /** The source that did not answer, present exactly when `state` is `unavailable`. */
  readonly source?: SourceReference;
}

/**
 * The period and currency a giving figure is stated in.
 *
 * A giving total is only ever stated in one currency and over one period: two currencies are never
 * added, and a period is never implied. `timeZone` decides which calendar day a preset period resolves
 * in, exactly as the report engine reads it.
 */
export interface PartnerGivingSelection {
  /**
   * The single currency every giving figure and giving facet option is stated in; absent states none.
   *
   * A stated currency is the whole partition, not a filter applied to an unfiltered figure: a period
   * holding no row in it is a genuine zero for that currency, never another currency's figure
   * presented under the statement. Absent, the partition is every currency the period's authorised
   * rows are recorded in.
   */
  readonly currency?: string;
  /** Two civil dates, inclusive at both ends; absent resolves to the year to date. */
  readonly period?: { readonly from: string; readonly to: string };
  /** The zone a preset period resolves in. Defaults to UTC, never to a host zone. */
  readonly timeZone?: string;
}

/** Everything one roster request states. */
export interface PartnerRosterQuery extends PartnerGivingSelection {
  /** The search text, matched over the whole authorised dataset rather than the loaded page. */
  readonly search?: string;
  /** The values selected per facet id. AND across facets; OR among the values of one facet. */
  readonly applied?: Readonly<Record<string, readonly string[]>>;
  readonly sort?: {
    readonly field: PartnerSortField;
    readonly direction: PartnerSortDirection;
  };
  /** The page window. Absent means the first page; the size is clamped to the served cap. */
  readonly page?: { readonly index: number; readonly size?: number };
}

/** The fields of one record the roster carries: identity and working labels, never contact values. */
export type PartnerRosterRecord = Pick<
  PartnerRecord,
  "partnerId" | "kind" | "displayName" | "tags" | "favourite" | "stage" | "audience" | "revision"
>;

/**
 * The giving facts a roster read states once for the whole list.
 *
 * A list envelope states one coverage for every value it carries, and this one carries exact record
 * counts that really are complete — so a partial financial subtotal is never stated inside it. The
 * list therefore states the giving facts it can state exactly: the period a row's currencies were
 * read in, the currencies the figures are stated in and the projection's own coverage, so a reader
 * knows how much of the past those facts reach. The amounts belong to the record's own read, whose
 * coverage is the projection's and which therefore carries every figure with the state the report
 * engine gave it.
 */
export interface PartnerRosterGivingScope {
  /** The period the currencies were read in, said in words rather than implied. */
  readonly periodLabel: string;
  /** How much of the past the support projection covers. */
  readonly coverage: Coverage;
  /**
   * The currencies the figures are stated in, ascending.
   *
   * The request's stated currency alone when it stated one — so a currency the period holds no row in
   * is stated as a genuine zero rather than replaced by another currency's figure — and otherwise
   * every currency the period's authorised rows are recorded in.
   */
  readonly currencies: readonly string[];
}

/**
 * One row of the roster.
 *
 * The row carries counts rather than lists: a list's own page belongs to the surface that shows it.
 * The giving facts here are the ones a list can state exactly — the currencies this record's received
 * gifts are recorded in inside the period, and the last day one is recorded — and never an amount,
 * because the amounts are stated by the record's own read with the coverage they were computed over.
 * A row with no recorded gift states an empty currency list and no last day: that is a genuine zero
 * of recorded gifts, which is a different fact from a value the read could not establish.
 */
export interface PartnerRosterRow {
  readonly partner: PartnerRosterRecord;
  /** The kinds of contact method the record permits this caller to use. */
  readonly contactMethodKinds: readonly ContactMethodKind[];
  /** The initiatives whose working list names this record as included. */
  readonly initiativeIds: readonly string[];
  /** Where this record's referral stands, or `null` when the source recorded no cycle for it. */
  readonly referralStatus: PartnerReferralStatus | null;
  readonly openTaskCount: number;
  readonly overdueTaskCount: number;
  readonly undatedTaskCount: number;
  /** The latest day an actual interaction is recorded for this record, or `null` when none is. */
  readonly lastActivityOn: string | null;
  /**
   * The currencies this record's received gifts are stated in inside the period, ascending.
   *
   * Only rows the read's currency partition admits are counted, so a stated currency this record holds
   * no gift in is a genuine empty list rather than this record's other currencies presented under the
   * statement. Absent — not empty — when the caller may not state giving facts, because an empty list
   * would claim that no gift is recorded rather than that this read may not say.
   */
  readonly givingCurrencies?: readonly string[];
  /** The last day a received gift is recorded, or `null` when none is; absent when not permitted. */
  readonly lastReceivedOn?: string | null;
}

/** What one roster read answers. */
export interface PartnerRosterPage {
  readonly rows: readonly PartnerRosterRow[];
  /** The whole-result count, never the count of the loaded page. */
  readonly total: number;
  readonly page: { readonly index: number; readonly size: number; readonly totalPages: number };
  /** The zone the dated comparisons resolved in, so "overdue" is never judged in an unstated zone. */
  readonly timeZone: string;
  /** The giving facts of the list, present exactly when the caller may state them. */
  readonly giving?: PartnerRosterGivingScope;
  /**
   * The facet selections that actually took effect, as the read admitted them.
   *
   * A value the facet no longer admits narrows nothing and is reported absent here rather than
   * silently shaping a different result, which is what lets a surface show that a stored view needs
   * repair instead of showing a roster nobody asked for. Only facet selections appear, each facet id
   * mapped to the values selected in it: the search text and the period are stated in
   * `appliedSearch` and `appliedPeriod` beside this map, because a facet selection map cannot hold a
   * text filter or a range without a reader mistaking one for a facet id.
   */
  readonly applied: Readonly<Record<string, readonly string[]>>;
  /**
   * The search text the read searched, trimmed, or `null` when the request stated none.
   *
   * Reported beside `applied` rather than inside it: `applied` is a facet id to values map that a
   * toolbar rebuilds its selection from, and a text filter stored under a key of its own would come
   * back as a facet nobody can select.
   */
  readonly appliedSearch: string | null;
  /**
   * The period the giving figures were read over, or `null` when the request stated no period or no
   * giving figure could be read.
   *
   * The two days are the period the report engine resolved, serialised as the civil dates
   * `giving.periodLabel` prints, so a preset the read substituted is reported as the days it resolved
   * to. A range is not a facet selection, so it is stated here rather than inside `applied`.
   */
  readonly appliedPeriod: { readonly from: string; readonly to: string } | null;
  /**
   * The filter set describing this same result, at this same instant.
   *
   * The rows and the facet set are answered together because they describe one filter set: one
   * `asOf`, one revision and one coverage describe both halves, and a second read of the same query
   * would state counts read at another moment beside rows read at this one.
   */
  readonly facets: readonly PartnerFacet[];
}

/** What a saved view stores: the choices, never records. */
export interface PartnerSavedViewQuery {
  readonly search: string;
  readonly applied: Readonly<Record<string, readonly string[]>>;
  readonly columnVisibility?: Readonly<Record<string, boolean>>;
}

/** What a stored view now refers to that this build no longer offers. */
export interface PartnerSavedViewDrift {
  readonly drifted: boolean;
  /** One phrase per missing reference, as the read states it. Never a record. */
  readonly missing: readonly string[];
}

/** One saved view the caller owns, with the drift the current facet set reports for it. */
export interface PartnerSavedView {
  readonly id: string;
  readonly name: string;
  readonly query: PartnerSavedViewQuery;
  readonly ownerPrincipalId: string;
  /** The stored revision, so an update or a delete can present the revision it expects. */
  readonly revision: string;
  readonly drift: PartnerSavedViewDrift;
}

/** One record this partner is related to, in the supported label the source itself supplied. */
export interface PartnerRelationship {
  readonly label: string;
  readonly counterpart?: {
    readonly partnerId: string;
    readonly kind: PartnerKind;
    readonly displayName: string;
    readonly href?: string;
  };
  readonly detail?: string;
}

/** One money figure of a record's support history, with the envelope key its state is under. */
export interface PartnerSupportFigure {
  readonly path: string;
  readonly label: string;
  readonly amount: GiftRowRecord["amount"];
  readonly href?: string;
}

/** One received gift or allocation row of a record's support history, at its own grain. */
export interface PartnerSupportGift {
  readonly gift: GiftRowRecord;
  readonly amountPath: string;
}

/** The authorised support history of one record. */
export interface PartnerSupportHistory {
  /** The one named received-support basis the figures are computed on. */
  readonly basis: string;
  /** The period the figures cover, said in words rather than implied. */
  readonly periodLabel: string;
  readonly figures: readonly PartnerSupportFigure[];
  readonly gifts?: readonly PartnerSupportGift[];
  readonly ledgerHref?: string;
}

/** What one partner read carries for the record body. */
export interface PartnerDetailData {
  readonly partner: PartnerRecord;
  readonly relationshipContext: readonly PartnerRelationship[];
  readonly openTasks: readonly TaskRecord[];
  /** Absent when the caller may not state giving for this context, so its section is omitted. */
  readonly supportHistory?: PartnerSupportHistory;
}

/** What the private read carries for one record: the worker's own preparation and note bodies. */
export interface PartnerPrivateData {
  readonly notes: readonly PrivateNoteRecord[];
  readonly preparation?: { readonly partnerId: string; readonly archived: boolean };
}

/**
 * One value a facet's builder admits, before its whole-result count is measured.
 *
 * A builder states which values the facet offers and how each reads; the count is measured once, from
 * the same match predicate the filter applies, so an option can never advertise a count the filter
 * would not produce.
 */
type FacetValueCandidate = {
  readonly id: string;
  readonly label: string;
};

/**
 * What one facet's value builder answered.
 *
 * The three outcomes are mutually exclusive and stay apart: `values` is a usable facet, `unavailable`
 * is a source that did not answer, and `not-applicable` is a facet the source cannot state a partner
 * fact for at all. None of them may be rendered as an empty option list, because an empty list claims
 * the data holds none.
 */
type FacetOutcome =
  | { readonly kind: "values"; readonly values: readonly FacetValueCandidate[] }
  | { readonly kind: "unavailable"; readonly reason: string }
  | { readonly kind: "not-applicable"; readonly reason: string };

// ---------------------------------------------------------------------------------------------
// The stored session document these reads parse
// ---------------------------------------------------------------------------------------------

/**
 * A stored partner record, plus the one archive flag a private-preparation record may carry.
 *
 * The record itself is validated by the envelope's own schema, which stays the single declaration of
 * its shape; `archived` is added here because archiving hides a preparation record from working lists
 * without deleting anything, so the flag belongs to storage rather than to the record's identity. A
 * record that states no flag has not been archived, and the flag can never make a shared record
 * private or a private one shared.
 */
const storedPartnerRecordSchema = partnerRecordSchema.and(
  z.object({ archived: z.boolean().optional() }),
);

/** One stored partner record as the roster and the record body read it. */
type StoredPartnerRecord = z.infer<typeof storedPartnerRecordSchema>;

/**
 * One stored saved view.
 *
 * A view stores choices and never records: the search text, the values selected per facet and the
 * visible column set. Sort, page and page size stay in the caller's query state, so a view can never
 * silently change the row a worker was reading. `ownerPrincipalId` is the principal whose choices
 * these are, which is why a read returns only the caller's own views.
 */
const storedSavedViewSchema = z.object({
  viewId: z.string().min(1),
  name: z.string().min(1),
  query: z.object({
    search: z.string(),
    applied: z.record(z.string().min(1), z.array(z.string().min(1))),
    columnVisibility: z.record(z.string().min(1), z.boolean()).optional(),
  }),
  ownerPrincipalId: principalIdSchema,
  revision: recordRevisionSchema,
});

/** One stored saved view as the saved-view read returns it. */
type StoredSavedView = z.infer<typeof storedSavedViewSchema>;

/**
 * The members of the session's state document these reads consume.
 *
 * The four families the roster, the record body and the activity read enumerate are required: a
 * document without them cannot honestly be read as "this scope holds none", so a missing collection
 * is refused as an unreadable source rather than answered as an empty result. The remaining families
 * are defaulted, because each is an enrichment of a fact the requiring families already carry — an
 * absent referral collection genuinely states that the source recorded no cycle, and an absent
 * `savedViews` collection states that no view has been stored for this surface.
 */
const partnerStateDocumentSchema = z.object({
  context: sessionContextRecordSchema,
  partners: z.array(storedPartnerRecordSchema),
  privateNotes: z.array(privateNoteRecordSchema),
  interactions: z.array(interactionRecordSchema),
  tasks: z.array(taskRecordSchema),
  initiatives: z.array(initiativeRecordSchema).default([]),
  initiativeMembers: z.array(initiativeMemberRecordSchema).default([]),
  referrals: z.array(referralCycleRecordSchema).default([]),
  supportProjection: supportProjectionRecordSchema.nullable().default(null),
  gifts: z.array(giftRowRecordSchema).default([]),
  commitments: z.array(commitmentRowRecordSchema).default([]),
  savedViews: z.array(storedSavedViewSchema).default([]),
});

/** The state document members these reads consume. */
type PartnerStateDocument = z.infer<typeof partnerStateDocumentSchema>;

// ---------------------------------------------------------------------------------------------
// Resolving the caller, the scope and the document
// ---------------------------------------------------------------------------------------------

/** What every read here works from: the resolved session, its selected scope and the parsed records. */
interface PartnerReadContext {
  readonly session: ResolvedSession;
  readonly scope: Scope;
  readonly document: PartnerStateDocument;
}

/** The answer to "may this read start": the context, or the one refusal it returns. */
type ContextOutcome =
  | { readonly ok: true; readonly context: PartnerReadContext }
  | { readonly ok: false; readonly refusal: DeniedOutcome | UnavailableOutcome };

/** The store's own identity for a session's documents, used as a read's source and for diagnostics. */
function storeSource(session: ResolvedSession): SourceReference {
  return { system: LOCAL_STORE_SYSTEM, reference: session.sessionId };
}

/**
 * The one refusal a caller with no authority receives.
 *
 * Every denial in this file is built here, so the shape cannot vary between the two cases a caller
 * must not be able to tell apart — a record that does not exist and a record the caller may not read.
 */
function refused(reasonCode: DenialReason): DeniedOutcome {
  return denied({ operationId: READ_ATTEMPT_ID, reasonCode });
}

/**
 * The one answer a source that cannot be read produces.
 *
 * An unreadable or unparsable document is `unavailable` with the store named, never an empty roster
 * and never a zero: the two are the readings this path exists to prevent. Diagnostics carry the job
 * and the opaque source only, so nothing the read could not establish reaches a log line.
 */
function sourceUnavailable(job: string, session: ResolvedSession): UnavailableOutcome {
  const source = storeSource(session);
  logger.sourceUnavailable({ job, source });
  return unavailable({
    operationId: READ_ATTEMPT_ID,
    source,
    guidance: STORE_UNAVAILABLE_GUIDANCE,
  });
}

/**
 * The one answer a stated zone this runtime cannot resolve produces.
 *
 * A zone identifier is the caller's own naming of a calendar, so one the runtime cannot resolve is
 * refused rather than swapped for UTC: the overdue counts, last-activity days and last-received-gift
 * days below are all judged in that calendar, and a substituted one would report work and giving
 * against a zone nobody asked about. Diagnostics carry the job and the opaque source only, never the
 * string the request carried.
 */
function calendarUnavailable(job: string): UnavailableOutcome {
  logger.sourceUnavailable({ job, source: CALENDAR_SOURCE });
  return unavailable({
    operationId: READ_ATTEMPT_ID,
    source: CALENDAR_SOURCE,
    guidance: CALENDAR_UNAVAILABLE_GUIDANCE,
  });
}

/**
 * Resolves the session, asserts its selected scope and parses the records it holds.
 *
 * The order is the contract: the session first, because no request names a scope of its own; then the
 * selected scope, because a session that has chosen no context has no authority to read one; then the
 * store and the document. A session resolves `ok` even when it grants nothing — `expired`, `denied`,
 * `unavailable` and `no-access` are states of a real session — so the refusal always comes from
 * `assertScope`, which names the caller's relationship and nothing about a record.
 *
 * An armed scope-denial plan is answered the moment the session's documents are in hand and before the
 * state document is decoded, so the demonstration fires on the read it names while still disclosing
 * nothing the caller may not see.
 *
 * `source` names a session explicitly for the callers that hold an id and no request — the domain and
 * integration tests that prove isolation by naming a seeded session, and the operational scripts. It
 * is the identity the caller names, never a scope: scope is still derived here from the session's own
 * documents, and every permission question is still asked afresh.
 */
async function readContext(job: string, source?: SessionSource): Promise<ContextOutcome> {
  let resolution: Awaited<ReturnType<typeof resolveSession>>;
  try {
    resolution = await resolveSession(source);
  } catch {
    // A request context that cannot yield its cookie leaves no session to establish, which is the one
    // refusal the resolver names for that case: it discloses nothing about a record.
    return { ok: false, refusal: refused("session-unavailable") };
  }
  if (!resolution.ok) {
    return { ok: false, refusal: resolution.denial };
  }
  const { session } = resolution;

  const scope = session.selected;
  if (scope === null) {
    return { ok: false, refusal: refused("not-admitted") };
  }
  const scopeDecision = assertScope(session, scope);
  if (!scopeDecision.ok) {
    return { ok: false, refusal: scopeDecision.denial };
  }

  let state: unknown;
  let meta: unknown;
  try {
    const documents = await readSession(session.sessionId);
    if (documents === undefined) {
      return { ok: false, refusal: sourceUnavailable(job, session) };
    }
    state = documents.state;
    meta = documents.meta;
  } catch {
    return { ok: false, refusal: sourceUnavailable(job, session) };
  }

  // An armed scope-denial plan must take effect on the read it names, so it is answered here — after
  // the documents are read and before any record is decoded, projected or enumerated. The refusal is
  // this module's ordinary denial by its ordinary reason code, so the caller learns nothing about the
  // record it was refused: no count, title, existence flag or size.
  if (failureFor(failurePlanOfDocument(meta), "read", job) === "denied") {
    return { ok: false, refusal: refused("no-permission") };
  }

  const parsed = partnerStateDocumentSchema.safeParse(state);
  if (!parsed.success) {
    return { ok: false, refusal: sourceUnavailable(job, session) };
  }
  return { ok: true, context: { session, scope, document: parsed.data } };
}

/**
 * Reports whether the caller may read one partner record, and is the single place that question is
 * asked.
 *
 * A private-preparation record states no author of its own, and a private record exists only inside
 * one principal's own session documents, so the principal reading this session's records is its
 * author. That is the only author evidence available, and it is the evidence `authorize` documents:
 * a private record whose author is not stated is refused rather than treated as everyone's.
 */
function mayReadPartner(context: PartnerReadContext, record: PartnerRecord): boolean {
  const target: AuthorizationTarget = {
    kind: "partner",
    scope: context.scope,
    audience: record.audience,
    authorPrincipalId: record.audience === "private" ? context.session.principalId : null,
  };
  return canView(context.session, target).allowed;
}

/**
 * Reports whether the caller may state giving facts at all.
 *
 * One question, asked of the support subject the scope names: the roster's giving facets, its giving
 * column and a record's support history all ride on this single answer, so a surface can never show a
 * giving figure beside a facet it was refused.
 */
function mayReadGiving(context: PartnerReadContext): boolean {
  const target: AuthorizationTarget = {
    kind: "support-subject",
    scope: context.scope,
    capabilities: NO_STATED_CAPABILITIES,
  };
  return canView(context.session, target).allowed;
}

/** The session's own scenario instant: the offset it persists, never a clock this file reads. */
function sessionInstant(session: ResolvedSession): Temporal.Instant {
  return instantAt(session.clockOffsetMs);
}

/**
 * The zone a dated comparison resolves in: the request's own zone, or the declared UTC default when
 * the request names none.
 *
 * A stated zone is returned exactly as it was named and is never replaced. A zone this runtime cannot
 * resolve is refused by `todayIn` below, so the default here stays what it is documented to be — the
 * zone for a request that states none — and never a substitute for one that was stated.
 */
function zoneOf(timeZone: string | undefined): string {
  const stated = timeZone === undefined ? "" : timeZone.trim();
  return stated === "" ? ROSTER_DEFAULT_TIME_ZONE : stated;
}

// ---------------------------------------------------------------------------------------------
// The giving facts, which only the report engine computes
// ---------------------------------------------------------------------------------------------

/** The authorised gift rows of one support subject, in both the stored and the projection grain. */
interface GivingFacts {
  /** The stored projection: the basis, the coverage, the as-of instant and the source it came from. */
  readonly record: SupportProjectionRecord;
  /** Every authorised gift row at the grain `runReport` consumes. */
  readonly rows: readonly GiftRow[];
  /** Every authorised gift row in the stored form the record body renders. */
  readonly records: readonly GiftRowRecord[];
  /** Every commitment the source states, mapped into the projection's own row shape. */
  readonly commitments: SupportProjection["commitments"];
}

/** Reads one stored date, answering `undefined` when the value is not the storage form of a day. */
function civilDateOf(value: string): CivilDate | undefined {
  const parsed = parseCivilDate(value);
  return parsed.status === "parsed" ? parsed.date : undefined;
}

/**
 * Turns the stored commitments into the projection's own commitment rows.
 *
 * A commitment the source states once is one row here; its occurrences are never rows, and its
 * amounts are carried exactly as stored. A date that cannot be read makes the whole projection
 * unreadable, because a commitment whose last successful day is unknown cannot be presented as
 * though it had none.
 */
function commitmentRowsOf(
  records: readonly CommitmentRowRecord[],
  context: PartnerReadContext,
): SupportProjection["commitments"] {
  const rows: SupportProjection["commitments"][number][] = [];
  for (const record of records) {
    const lastSuccessfulOn =
      record.lastSuccessfulOn === null ? undefined : civilDateOf(record.lastSuccessfulOn);
    const nextEligibleOn =
      record.nextEligibleOn === null ? undefined : civilDateOf(record.nextEligibleOn);
    const resumeOn =
      record.pause.resumeOn === null ? undefined : civilDateOf(record.pause.resumeOn);
    if (
      (record.lastSuccessfulOn !== null && lastSuccessfulOn === undefined) ||
      (record.nextEligibleOn !== null && nextEligibleOn === undefined) ||
      (record.pause.resumeOn !== null && resumeOn === undefined)
    ) {
      throw new DateUnreadableError(record.commitmentRowId, context.scope.supportSubjectId);
    }
    rows.push({
      commitmentRowId: record.commitmentRowId,
      kind: record.kind,
      cadence: record.cadence,
      perOccurrence: record.perOccurrence,
      bucketState: record.bucketState,
      ...(lastSuccessfulOn === undefined ? {} : { lastSuccessfulOn }),
      ...(nextEligibleOn === undefined ? {} : { nextEligibleOn }),
      pause: {
        state: record.pause.state,
        ...(resumeOn === undefined ? {} : { resumeOn }),
      },
      ...(record.fixedTotal === null
        ? {}
        : {
            fixedTotal: {
              promised: record.fixedTotal.promised,
              fulfilled: record.fixedTotal.fulfilled,
              released: record.fixedTotal.released,
              remaining: record.fixedTotal.remaining,
            },
          }),
    });
  }
  return rows;
}

/** Raised inside this module when a stored day cannot be read; the read answers `unavailable`. */
class DateUnreadableError extends Error {
  constructor(rowId: string, supportSubjectId: string) {
    super(
      `A stored date on "${rowId}" in support subject "${supportSubjectId}" is not the storage form of a calendar day, so the projection it belongs to cannot be read.`,
    );
    this.name = "DateUnreadableError";
  }
}

/**
 * Builds the giving facts from the stored projection and its rows.
 *
 * `undefined` means the source states no support projection for this subject at all, which is a
 * different fact from a projection carrying no goal or no gifts: the first states nothing a read may
 * report, and the second states a genuine absence. A stored day that cannot be read makes the facts
 * unavailable in the same way, because a figure computed over a projection with a broken date would
 * be a figure nobody could check.
 */
function givingFactsOf(
  document: PartnerStateDocument,
  context: PartnerReadContext,
): GivingFacts | undefined {
  const record = document.supportProjection;
  if (record === null) {
    return undefined;
  }

  const rows: GiftRow[] = [];
  for (const stored of document.gifts) {
    const entryOn = civilDateOf(stored.entryOn);
    const originalGiftOn =
      stored.originalGiftOn === null ? undefined : civilDateOf(stored.originalGiftOn);
    if (entryOn === undefined || (stored.originalGiftOn !== null && originalGiftOn === undefined)) {
      return undefined;
    }
    rows.push({
      giftRowId: stored.giftRowId,
      giftId: stored.giftId,
      ...(stored.allocationId === null ? {} : { allocationId: stored.allocationId }),
      amount: stored.amount,
      ...(originalGiftOn === undefined ? {} : { originalGiftOn }),
      datePrecision: stored.datePrecision,
      ...(stored.designation === null ? {} : { designation: stored.designation }),
      attribution: stored.attribution,
      ...(stored.refundOf === null ? {} : { refundOf: stored.refundOf }),
      provenance: stored.provenance,
      entryOn,
    });
  }

  let commitments: SupportProjection["commitments"];
  try {
    commitments = commitmentRowsOf(document.commitments, context);
  } catch (error) {
    if (error instanceof DateUnreadableError) {
      return undefined;
    }
    throw error;
  }

  return { record, rows, records: document.gifts, commitments };
}

/**
 * The resolved period and coverage one giving read states its figures in, with the currencies the
 * period's authorised rows are recorded in.
 */
interface GivingSnapshot {
  readonly facts: GivingFacts;
  /** The whole authorised projection, as the report engine consumes it. */
  readonly projection: SupportProjection;
  readonly period: {
    readonly from: CivilDate;
    readonly to: CivilDate;
    readonly state: PeriodState;
  };
  /** The period said in words, so a figure never stands beside an implied period. */
  readonly periodLabel: string;
  readonly coverage: Coverage;
  /** The currencies the period's authorised rows are stated in, ascending. */
  readonly currencies: readonly string[];
}

/** What a giving read could establish: a usable snapshot, or why no figure may be stated. */
type GivingOutcome =
  | { readonly kind: "ready"; readonly snapshot: GivingSnapshot }
  | { readonly kind: "unavailable"; readonly reason: string };

/** The report identity every giving figure in this file is computed by. */
const GIVING_REPORT_ID = "received-period-and-year-to-date";

/** Builds the report scope the engine states its snapshot under, from the read's own scope. */
function reportScopeOf(scope: Scope): ReportScope {
  return {
    organizationId: scope.organizationId,
    ministryId: scope.ministryId,
    supportSubjectId: scope.supportSubjectId,
    principalId: scope.principalId,
  };
}

/**
 * Resolves the period and the coverage of one giving read, with the currencies its rows are stated in.
 *
 * Nothing here computes a figure. The period is resolved by the report engine itself — one call
 * against the whole authorised projection, whose own snapshot states the two civil dates a preset
 * resolved to — so a preset is never resolved twice, and a preset resolved against the projection's
 * as-of instant can never disagree with the figures computed beside it.
 */
function givingSnapshotOf(
  document: PartnerStateDocument,
  context: PartnerReadContext,
  selection: PartnerGivingSelection,
): GivingOutcome {
  const facts = givingFactsOf(document, context);
  if (facts === undefined) {
    return { kind: "unavailable", reason: NO_SUPPORT_PROJECTION };
  }

  const period = reportPeriodOf(selection.period);
  if (period === undefined) {
    return {
      kind: "unavailable",
      reason:
        "The stated period is not two calendar days, so no period is substituted for it and no figure is stated.",
    };
  }

  const projection: SupportProjection = {
    supportSubjectId: facts.record.supportSubjectId,
    basis: facts.record.basis,
    currencyExponents: facts.record.currencyExponents,
    coverage: facts.record.coverage,
    asOf: facts.record.asOf,
    lastSourceUpdate: facts.record.lastSourceUpdate,
    source: facts.record.source,
    // The goal is deliberately not carried here: these reads state received support for a record or a
    // currency partition and never goal progress, which belongs to the support surface that owns the
    // goal and its capability. Handing the engine a goal this read does not present would compute a
    // figure nothing here shows.
    gifts: facts.rows,
    commitments: facts.commitments,
  };

  const zone = zoneOf(selection.timeZone);
  let whole: ReturnType<typeof runReport>;
  try {
    whole = runReport(
      {
        reportId: GIVING_REPORT_ID,
        scope: reportScopeOf(context.scope),
        period,
        currency: { kind: "all" },
        timeZone: zone,
      },
      projection,
    );
  } catch {
    return { kind: "unavailable", reason: NO_SUPPORT_PROJECTION };
  }

  const currencies = whole.summary.map((entry) => entry.currency);

  return {
    kind: "ready",
    snapshot: {
      facts,
      projection,
      period: {
        from: whole.snapshot.period.from,
        to: whole.snapshot.period.to,
        state: whole.snapshot.period.state,
      },
      periodLabel: `${serialiseCivilDate(whole.snapshot.period.from)} to ${serialiseCivilDate(whole.snapshot.period.to)}${
        whole.snapshot.period.state === "in-progress" ? " (in progress)" : ""
      }`,
      coverage: whole.snapshot.coverage,
      currencies,
    },
  };
}

/**
 * The currencies one giving read states its figures in: the request's stated currency alone, or every
 * currency the period's rows are recorded in when it stated none.
 *
 * A stated currency is the whole partition rather than a filter applied afterwards, because a figure
 * read in one currency and a figure read across several are two different statements: a period that
 * holds no row in the stated currency is a genuine zero for it, never another currency's amount
 * presented under the stated one. With no currency stated, the partition is the summary's own set, so
 * nothing is hidden and no currency is invented.
 */
function givingPartitionOf(
  snapshot: GivingSnapshot,
  currency: string | undefined,
): readonly string[] {
  const stated = currency === undefined ? "" : currency.trim();
  return stated === "" ? snapshot.currencies : [stated];
}

/** Reads the two civil dates a request states, or `undefined` when it states none or not two days. */
function reportPeriodOf(period: PartnerGivingSelection["period"]): ReportPeriod | undefined {
  if (period === undefined) {
    return { kind: "preset", preset: "year-to-date" };
  }
  const from = civilDateOf(period.from.trim());
  const to = civilDateOf(period.to.trim());
  if (from === undefined || to === undefined) {
    return undefined;
  }
  if (Temporal.PlainDate.compare(from, to) > 0) {
    return undefined;
  }
  return { kind: "explicit", from, to };
}

/** The gift rows one partner is attributed, at the projection's grain. */
function giftRowsOfPartner(snapshot: GivingSnapshot, partnerId: string): readonly GiftRow[] {
  return snapshot.projection.gifts.filter(
    (row) => row.attribution.kind === "partner" && row.attribution.partnerId === partnerId,
  );
}

/** Whether one row's own gift day falls inside a period, mine to the rule the report engine applies. */
function rowWithin(
  row: GiftRow,
  period: { readonly from: CivilDate; readonly to: CivilDate },
): boolean {
  const day = row.originalGiftOn;
  if (day === undefined) {
    return false;
  }
  return (
    Temporal.PlainDate.compare(day, period.from) >= 0 &&
    Temporal.PlainDate.compare(day, period.to) <= 0
  );
}

/**
 * Computes one partner's received-support summary through the report engine.
 *
 * The projection handed over carries that partner's authorised rows and the subject's own coverage,
 * so the engine filters and sums exactly as it does for the Gifts page: this file narrows which rows
 * a report sees and never adds an amount. `undefined` means the engine refused the query, which
 * cannot happen for a query built here and is answered as "no figure stated" rather than thrown.
 */
function partnerSummaryOf(
  snapshot: GivingSnapshot,
  partnerId: string,
  currency: string,
  scope: Scope,
): CurrencySummary | undefined {
  const rows = giftRowsOfPartner(snapshot, partnerId);
  try {
    const result = runReport(
      {
        reportId: GIVING_REPORT_ID,
        scope: reportScopeOf(scope),
        period: { kind: "explicit", from: snapshot.period.from, to: snapshot.period.to },
        currency: { kind: "one", currency },
        partner: { kind: "partner", partnerId },
      },
      { ...snapshot.projection, gifts: rows },
    );
    return result.summary[0];
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------------------------
// The whole-dataset facts the roster, its facets and its saved views read
// ---------------------------------------------------------------------------------------------

/** One record's tasks, counted at their own grain and never added to another count. */
interface TaskFacts {
  readonly open: number;
  readonly overdue: number;
  readonly undated: number;
}

/**
 * Everything the roster needs, measured once per read over the whole authorised dataset.
 *
 * One pass builds every map here, so the filter, the sort, the counts and the page all read the same
 * facts: a value that decided whether a record matched and a value that decided its count can never
 * disagree, and the roster pays for one enumeration rather than one per facet.
 */
interface RosterFacts {
  /** The records this caller may read, in the document's own order. */
  readonly partners: readonly StoredPartnerRecord[];
  /** Every initiative the session holds, which is what an initiative facet enumerates. */
  readonly initiatives: readonly InitiativeRecord[];
  /** The latest day an actual interaction is recorded for a record. */
  readonly lastActivity: ReadonlyMap<string, string>;
  readonly taskFacts: ReadonlyMap<string, TaskFacts>;
  /** Where a record's referral stands, for records the source recorded a cycle for. */
  readonly referralStatus: ReadonlyMap<string, PartnerReferralStatus>;
  /** The initiatives whose working list names a record as included. */
  readonly initiativeIds: ReadonlyMap<string, readonly string[]>;
  /** The currencies a record's received gifts are stated in inside the giving period. */
  readonly givingCurrencies: ReadonlyMap<string, readonly string[]>;
  /** The last day a received gift is recorded for a record. */
  readonly lastReceivedOn: ReadonlyMap<string, string>;
  /** Whether the caller may state giving facts at all. */
  readonly givingPermitted: boolean;
  /** The giving snapshot, or why no giving fact can be stated. */
  readonly giving: GivingOutcome;
  /**
   * The currencies the giving figures and the giving facet options are stated in.
   *
   * Empty when no giving fact may be stated: an empty partition would claim that no currency carries
   * a figure, where the truth is that this read may not say.
   */
  readonly givingPartition: readonly string[];
  /** The calendar day the dated comparisons resolve against. */
  readonly today: CivilDate;
  /** The zone that day was resolved in: the request's own, or UTC when it names none. */
  readonly timeZone: string;
  /** The store's identity for this session's documents. */
  readonly source: SourceReference;
}

/** The answer to "can the roster's facts be built": the facts, or the one refusal the read returns. */
type RosterFactsOutcome =
  | { readonly kind: "ready"; readonly facts: RosterFacts }
  | { readonly kind: "unavailable"; readonly refusal: UnavailableOutcome };

/** Either the day a dated comparison resolves against, or the calendar that could not be read. */
type ResolvedRosterDay =
  | { readonly status: "resolved"; readonly date: CivilDate; readonly zone: string }
  | { readonly status: "unavailable"; readonly refusal: UnavailableOutcome };

/**
 * Resolves the calendar day the roster judges its dates against, in the zone the request states.
 *
 * The stated zone is never replaced. A zone this runtime cannot resolve refuses the read instead of
 * falling back to UTC, because every dated judgement made below — an overdue count, a last-activity
 * day, a last-received-gift day — is a statement about a calendar, and one made in a zone the caller
 * did not name is a statement about days they never asked about. Only a request that states no zone
 * takes the declared default, which `zoneOf` above supplies and documents as such.
 */
function todayIn(job: string, zone: string, at: Temporal.Instant): ResolvedRosterDay {
  const resolved = todayInZone(zone, at);
  if (resolved.status === "resolved") {
    return { status: "resolved", date: resolved.date, zone };
  }
  return { status: "unavailable", refusal: calendarUnavailable(job) };
}

/**
 * Judges one referral cycle at an instant, from the exclusive endpoint it preserved.
 *
 * Expired from the endpoint onwards and active strictly before it, so a read at the endpoint itself
 * already reports an expired cycle: the boundary belongs to expiry, which is the release's rule and
 * the reason the comparison is not `<=`. A cycle whose endpoint cannot be read is undecided rather
 * than expired, because a deadline that cannot be evaluated cannot be shown to have passed.
 */
function cycleStatusOf(cycle: ReferralCycleRecord, at: Temporal.Instant): PartnerReferralStatus {
  if (cycle.windowEnd === null) {
    return "incomplete-date";
  }
  let endpoint: Temporal.Instant;
  try {
    endpoint = Temporal.Instant.from(cycle.windowEnd);
  } catch {
    return "incomplete-date";
  }
  return Temporal.Instant.compare(at, endpoint) < 0 ? "active" : "expired";
}

/**
 * Summarises one record's referral cycles: the most actionable state it holds.
 *
 * Active outranks an incomplete date, which outranks expired, because a worker acts on the cycle that
 * can still be worked: an expired cycle beside a live one is not the record's state, and an undecided
 * date is something to resolve rather than something that has passed.
 */
function referralStatusOf(
  cycles: readonly ReferralCycleRecord[],
  partnerId: string,
  at: Temporal.Instant,
): PartnerReferralStatus | undefined {
  const mine = cycles.filter((cycle) => cycle.partnerId === partnerId);
  if (mine.length === 0) {
    return undefined;
  }
  const states = mine.map((cycle) => cycleStatusOf(cycle, at));
  if (states.includes("active")) {
    return "active";
  }
  return states.includes("incomplete-date") ? "incomplete-date" : "expired";
}

/** Adds one value to a list kept in a map, once, so a repeated fact never inflates a list. */
function appendTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing === undefined) {
    map.set(key, [value]);
    return;
  }
  if (!existing.includes(value)) {
    existing.push(value);
  }
}

/** Reads the latest of two stored `YYYY-MM-DD` days, which order chronologically as written. */
function latestDay(current: string | undefined, candidate: string): string {
  if (current === undefined) {
    return candidate;
  }
  return candidate > current ? candidate : current;
}

/** Orders two identifiers by code unit, so two runs over the same records agree exactly. */
function compareIdentifiers(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/**
 * Builds the roster's whole-dataset facts, or returns the refusal that keeps them from being built.
 *
 * Every record that reaches these maps has already passed the record-level permission question, so no
 * count below can disclose a record the caller may not read. Giving facts are measured only when the
 * support subject's own question permitted them, and they are measured at the report engine's
 * projection grain, so a row's currencies and last day come from the same rows the reports would sum.
 *
 * A zone this runtime cannot resolve refuses the whole read before a single map is built: the overdue
 * counts and the last-activity and last-received-gift days below are judgements made in that calendar,
 * and a judgement made in a substituted one is not a fact about the caller's records.
 */
function rosterFactsOf(
  job: string,
  context: PartnerReadContext,
  selection: PartnerGivingSelection,
): RosterFactsOutcome {
  const { document } = context;
  const at = sessionInstant(context.session);
  const resolvedToday = todayIn(job, zoneOf(selection.timeZone), at);
  if (resolvedToday.status === "unavailable") {
    return { kind: "unavailable", refusal: resolvedToday.refusal };
  }

  const partners = document.partners.filter((record) => mayReadPartner(context, record));

  const lastActivity = new Map<string, string>();
  for (const interaction of document.interactions) {
    if (interaction.occurredOn === null) {
      continue;
    }
    lastActivity.set(
      interaction.partnerId,
      latestDay(lastActivity.get(interaction.partnerId), interaction.occurredOn),
    );
  }

  const taskFacts = new Map<string, TaskFacts>();
  for (const task of document.tasks) {
    const partnerId = task.partnerId;
    if (partnerId === null || (task.status !== "open" && task.status !== "reopened")) {
      continue;
    }
    const current = taskFacts.get(partnerId) ?? { open: 0, overdue: 0, undated: 0 };
    const undated = task.dueOn === null;
    // Two stored `YYYY-MM-DD` days compare chronologically as they are written, so an overdue test
    // needs no date constructed from a value the document schema has already accepted.
    const overdue = task.dueOn !== null && task.dueOn < serialiseCivilDate(resolvedToday.date);
    taskFacts.set(partnerId, {
      open: current.open + 1,
      overdue: current.overdue + (overdue ? 1 : 0),
      undated: current.undated + (undated ? 1 : 0),
    });
  }

  const referralStatus = new Map<string, PartnerReferralStatus>();
  for (const cycle of document.referrals) {
    const status = referralStatusOf(document.referrals, cycle.partnerId, at);
    if (status !== undefined) {
      referralStatus.set(cycle.partnerId, status);
    }
  }

  const includedMembers = new Map<string, string[]>();
  for (const member of document.initiativeMembers) {
    if (member.state === "included") {
      appendTo(includedMembers, member.partnerId, member.initiativeId);
    }
  }

  const givingPermitted = mayReadGiving(context);
  const giving: GivingOutcome = givingPermitted
    ? givingSnapshotOf(document, context, selection)
    : { kind: "unavailable", reason: GIVING_UNAVAILABLE_WITHOUT_PERMISSION };

  // The partition is stated once here, so the list's currencies, every row's currencies and the
  // giving-total facet's options all read the request's stated currency from one decision rather than
  // each deciding which currencies its figures may be stated in.
  const givingPartition: readonly string[] =
    giving.kind === "ready" ? givingPartitionOf(giving.snapshot, selection.currency) : [];

  const openCurrencies = new Map<string, string[]>();
  const lastReceivedOn = new Map<string, string>();
  const givingCurrencies = new Map<string, readonly string[]>();
  if (giving.kind === "ready") {
    for (const row of giving.snapshot.projection.gifts) {
      if (row.attribution.kind !== "partner" || row.originalGiftOn === undefined) {
        continue;
      }
      const partnerId = row.attribution.partnerId;
      lastReceivedOn.set(
        partnerId,
        latestDay(lastReceivedOn.get(partnerId), serialiseCivilDate(row.originalGiftOn)),
      );
      if (rowWithin(row, giving.snapshot.period) && givingPartition.includes(row.amount.currency)) {
        appendTo(openCurrencies, partnerId, row.amount.currency);
      }
    }
    for (const [partnerId, currencies] of openCurrencies) {
      givingCurrencies.set(partnerId, [...currencies].sort(compareIdentifiers));
    }
  }

  return {
    kind: "ready",
    facts: {
      partners,
      initiatives: document.initiatives,
      lastActivity,
      taskFacts,
      referralStatus,
      initiativeIds: new Map(
        [...includedMembers].map(([partnerId, ids]) => [
          partnerId,
          [...ids].sort(compareIdentifiers),
        ]),
      ),
      givingCurrencies,
      lastReceivedOn,
      givingPermitted,
      giving,
      givingPartition,
      today: resolvedToday.date,
      timeZone: resolvedToday.zone,
      source: storeSource(context.session),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The facet set, declared once
// ---------------------------------------------------------------------------------------------

/**
 * One facet of the roster's bounded facet set.
 *
 * `requires` states the authority the facet needs before it may appear at all: a facet requiring
 * giving is absent from the envelope for a caller refused that authority, so no option, count or
 * disabled sentence can disclose that giving facts exist in this context. `values` states which values
 * the facet offers and how each reads; `matches` states whether one record carries a value, and is the
 * single predicate behind both the filter and the count, so an option can never advertise a count the
 * filter would not produce.
 */
interface FacetDeclaration {
  readonly id: PartnerFacetId;
  /** Whether several values may be selected at once inside this facet, combined with OR. */
  readonly multi: boolean;
  readonly requires: "roster" | "giving";
  readonly values: (facts: RosterFacts) => FacetOutcome;
  readonly matches: (record: PartnerRecord, value: string, facts: RosterFacts) => boolean;
}

/** Builds the values of a closed vocabulary, each with the words a reader sees. */
function closedValues(
  labels: Readonly<Record<string, string>>,
  ids: readonly string[],
): FacetOutcome {
  return {
    kind: "values",
    values: ids.map((id) => ({ id, label: labels[id] ?? id })),
  };
}

/** Builds the values of an open vocabulary, each rendered exactly as the source supplied it. */
function openValues(values: readonly string[]): FacetOutcome {
  const distinct = [...new Set(values)].sort(compareIdentifiers);
  return { kind: "values", values: distinct.map((value) => ({ id: value, label: value })) };
}

/** The contact method kinds a record permits this caller to use, in the order the record holds them. */
function contactKindsOf(record: PartnerRecord): readonly ContactMethodKind[] {
  const kinds: ContactMethodKind[] = [];
  for (const method of record.contactMethods) {
    if (method.permitted && !kinds.includes(method.kind)) {
      kinds.push(method.kind);
    }
  }
  return kinds;
}

/** Whether a record states a permitted postal value exactly equal to one the facet offers. */
function hasPermittedPostalValue(record: PartnerRecord, value: string): boolean {
  return record.contactMethods.some(
    (method) => method.kind === "postal" && method.permitted && method.value === value,
  );
}

/** Whether a record carries any permitted contact method at all. */
function hasPermittedContact(record: PartnerRecord): boolean {
  return record.contactMethods.some((method) => method.permitted);
}

/** The task facts a record states, or the genuine zero of a record with no open work. */
function taskFactsOrNone(facts: RosterFacts, partnerId: string): TaskFacts {
  return facts.taskFacts.get(partnerId) ?? { open: 0, overdue: 0, undated: 0 };
}

/** The distinct values one record field states, in the order the records hold them. */
function distinctInOrder<T>(records: readonly T[], pick: (record: T) => string): readonly string[] {
  const values: string[] = [];
  for (const record of records) {
    const value = pick(record);
    if (!values.includes(value)) {
      values.push(value);
    }
  }
  return values;
}

/** Every value a record states in a list field, gathered into one list. */
function flatMapPartners(
  records: readonly PartnerRecord[],
  pick: (record: PartnerRecord) => readonly string[],
): readonly string[] {
  const values: string[] = [];
  for (const record of records) {
    values.push(...pick(record));
  }
  return values;
}

/**
 * The roster's bounded facet set: fourteen declarations, in the copy module's own order.
 *
 * The set is closed. Each entry names the fact it reads, and no facet here derives a value the source
 * does not state: a relationship label is the record's own recorded label, a geography is a permitted
 * postal value rendered verbatim, and an initiative is a working list that explicitly includes the
 * record. The one facet the source cannot attribute to a partner — recurring support status, which the
 * source states for the support subject and for no partner — is declared so it can say exactly that
 * rather than disappear or offer a filter that would match nothing.
 */
const PARTNER_FACET_DECLARATIONS: readonly FacetDeclaration[] = [
  {
    id: "contact-type",
    multi: true,
    requires: "roster",
    values: (facts) =>
      closedValues(
        CONTACT_TYPE_LABELS,
        distinctInOrder(facts.partners, (r) => r.kind),
      ),
    matches: (record, value) => record.kind === value,
  },
  {
    id: "preparation-state",
    multi: false,
    requires: "roster",
    values: (facts) =>
      closedValues(
        PREPARATION_LABELS,
        distinctInOrder(facts.partners, (r) => r.audience),
      ),
    matches: (record, value) => record.audience === value,
  },
  {
    id: "tag",
    multi: true,
    requires: "roster",
    values: (facts) => openValues(flatMapPartners(facts.partners, (record) => record.tags)),
    matches: (record, value) => record.tags.includes(value),
  },
  {
    id: "favourite",
    multi: false,
    requires: "roster",
    values: () => closedValues(FAVOURITE_LABELS, ["favourite", "not-favourite"]),
    matches: (record, value) => record.favourite === (value === "favourite"),
  },
  {
    id: "relationship-label",
    multi: true,
    requires: "roster",
    values: (facts) =>
      openValues(
        facts.partners
          .map((record) => record.stage)
          .filter((stage): stage is string => stage !== null),
      ),
    matches: (record, value) => record.stage === value,
  },
  {
    id: "initiative-membership",
    multi: true,
    requires: "roster",
    values: (facts) => ({
      kind: "values",
      values: facts.initiatives.map((initiative) => ({
        id: initiative.initiativeId,
        label: initiative.name,
      })),
    }),
    matches: (record, value, facts) =>
      (facts.initiativeIds.get(record.partnerId) ?? []).includes(value),
  },
  {
    id: "referral-status",
    multi: true,
    requires: "roster",
    values: () => closedValues(REFERRAL_STATUS_LABELS, PARTNER_REFERRAL_STATUSES),
    matches: (record, value, facts) => facts.referralStatus.get(record.partnerId) === value,
  },
  {
    id: "contact-method-availability",
    multi: false,
    requires: "roster",
    values: () =>
      closedValues(CONTACT_METHOD_AVAILABILITY_LABELS, ["any-permitted", "none-permitted"]),
    matches: (record, value) => hasPermittedContact(record) === (value === "any-permitted"),
  },
  {
    id: "geography",
    multi: true,
    requires: "roster",
    values: (facts) =>
      openValues(
        flatMapPartners(facts.partners, (record) =>
          record.contactMethods
            .filter((method) => method.kind === "postal" && method.permitted)
            .map((method) => method.value),
        ),
      ),
    matches: (record, value) => hasPermittedPostalValue(record, value),
  },
  {
    id: "recent-activity",
    multi: false,
    requires: "roster",
    values: () => closedValues(ACTIVITY_LABELS, ["recorded", "none-recorded"]),
    matches: (record, value, facts) =>
      facts.lastActivity.has(record.partnerId) === (value === "recorded"),
  },
  {
    id: "task-state",
    multi: true,
    requires: "roster",
    values: () => closedValues(TASK_STATE_LABELS, ["open", "overdue", "no-date"]),
    matches: (record, value, facts) => {
      const counts = taskFactsOrNone(facts, record.partnerId);
      switch (value) {
        case "open":
          return counts.open > 0;
        case "overdue":
          return counts.overdue > 0;
        case "no-date":
          return counts.undated > 0;
        default:
          return false;
      }
    },
  },
  {
    id: "last-received-gift-date",
    multi: false,
    requires: "giving",
    values: () => closedValues(GIVING_PRESENCE_LABELS, ["recorded", "none-recorded"]),
    matches: (record, value, facts) =>
      facts.lastReceivedOn.has(record.partnerId) === (value === "recorded"),
  },
  {
    id: "giving-total",
    multi: false,
    requires: "giving",
    values: (facts) =>
      facts.giving.kind === "ready"
        ? openValues(facts.givingPartition)
        : { kind: "unavailable", reason: facts.giving.reason },
    matches: (record, value, facts) =>
      (facts.givingCurrencies.get(record.partnerId) ?? []).includes(value),
  },
  {
    id: "commitment-status",
    multi: false,
    requires: "giving",
    values: () => ({ kind: "not-applicable", reason: NO_PARTNER_ATTRIBUTION }),
    matches: () => false,
  },
];

/**
 * Evaluates one facet, honouring the authority it requires and the source it reads.
 *
 * A giving facet is answered before its own builder runs, so a caller permitted the facts receives
 * the source's honest state rather than an empty option list, and a caller refused them never reaches
 * this function at all.
 */
function facetOutcomeOf(declaration: FacetDeclaration, facts: RosterFacts): FacetOutcome {
  if (declaration.requires === "giving" && facts.giving.kind === "unavailable") {
    return { kind: "unavailable", reason: facts.giving.reason };
  }
  return declaration.values(facts);
}

/** Counts the records of the whole authorised result that carry one facet value. */
function countOf(declaration: FacetDeclaration, value: string, facts: RosterFacts): number {
  let count = 0;
  for (const record of facts.partners) {
    if (declaration.matches(record, value, facts)) {
      count += 1;
    }
  }
  return count;
}

/**
 * Builds the facet set one caller receives.
 *
 * The order is the declaration's own, the values are the declaration's own and the counts are the
 * whole-result counts. Three states stay apart: an available facet with its options, an unavailable
 * facet naming the source that did not answer, and a facet the source cannot attribute to a partner,
 * which states that in visible words instead of offering a filter that would match nothing.
 */
function buildFacets(facts: RosterFacts): readonly PartnerFacet[] {
  const facets: PartnerFacet[] = [];
  for (const declaration of PARTNER_FACET_DECLARATIONS) {
    if (declaration.requires === "giving" && !facts.givingPermitted) {
      continue;
    }
    const outcome = facetOutcomeOf(declaration, facts);
    const identity = {
      id: declaration.id,
      labelKey: declaration.id,
      operator: "OR",
      multi: declaration.multi,
    } as const;

    if (outcome.kind === "unavailable") {
      facets.push({
        ...identity,
        state: "unavailable",
        options: [],
        disabledReason: outcome.reason,
        source: facts.source,
      });
      continue;
    }
    if (outcome.kind === "not-applicable") {
      facets.push({
        ...identity,
        state: "available",
        options: [],
        disabledReason: outcome.reason,
      });
      continue;
    }

    // A giving facet's counts are counts of records, and its source's coverage decides whether they
    // can be presented as the period's own: over coverage the source did not state, the count is not
    // established rather than zero.
    const countUnknown =
      declaration.requires === "giving" &&
      facts.giving.kind === "ready" &&
      facts.giving.snapshot.coverage.state === "unknown";

    facets.push({
      ...identity,
      state: "available",
      options: outcome.values.map((candidate) => {
        const count = countOf(declaration, candidate.id, facts);
        const countState: ValueState = countUnknown ? "unknown" : count > 0 ? "value" : "zero";
        return { id: candidate.id, label: candidate.label, count, countState };
      }),
    });
  }
  return facets;
}

/** One facet filter that actually took effect, with the values it admits. */
interface AppliedFacet {
  readonly declaration: FacetDeclaration;
  readonly values: readonly string[];
}

/** The admitted filters of a request, and the echo of the values that took effect. */
interface AppliedSelection {
  readonly filters: readonly AppliedFacet[];
  readonly applied: Readonly<Record<string, readonly string[]>>;
}

/**
 * Reduces a request's selections to the filters the current facet set admits.
 *
 * A facet the caller may not use, a facet whose source did not answer and a value the facet no longer
 * offers all narrow nothing and are reported absent from the echo. That is deliberate: the
 * alternative — a filter that silently matches nothing — would show a worker an empty roster for a
 * view whose references have retired, which is the confusion the saved-view drift flag exists to
 * prevent.
 */
function appliedSelectionOf(
  facts: RosterFacts,
  applied: PartnerRosterQuery["applied"],
): AppliedSelection {
  const filters: AppliedFacet[] = [];
  const echoed: Record<string, readonly string[]> = {};
  if (applied === undefined) {
    return { filters, applied: echoed };
  }

  for (const [facetId, values] of Object.entries(applied)) {
    if (!Array.isArray(values) || values.length === 0) {
      continue;
    }
    const declaration = PARTNER_FACET_DECLARATIONS.find((entry) => entry.id === facetId);
    if (declaration === undefined) {
      continue;
    }
    if (declaration.requires === "giving" && !facts.givingPermitted) {
      continue;
    }
    const outcome = facetOutcomeOf(declaration, facts);
    if (outcome.kind !== "values") {
      continue;
    }
    const admitted = new Set(outcome.values.map((candidate) => candidate.id));
    const kept: string[] = [];
    for (const value of values) {
      if (typeof value === "string" && admitted.has(value) && !kept.includes(value)) {
        kept.push(value);
      }
    }
    if (kept.length === 0) {
      continue;
    }
    filters.push({ declaration, values: kept });
    echoed[facetId] = kept;
  }
  return { filters, applied: echoed };
}

/** Whether a record satisfies every filter: AND across facets, OR among the values of one facet. */
function matchesFilters(
  record: PartnerRecord,
  filters: readonly AppliedFacet[],
  facts: RosterFacts,
): boolean {
  for (const filter of filters) {
    if (!filter.values.some((value) => filter.declaration.matches(record, value, facts))) {
      return false;
    }
  }
  return true;
}

/**
 * Whether one record matches the search text.
 *
 * The search runs over the whole authorised dataset rather than the loaded page, and over the facts a
 * list may state: the display name, the recorded name parts, the record's own working labels, and the
 * contact values this caller may use. A contact value the caller may not use is never searched,
 * because a match on it would disclose that it is there. No name, address or number is ever compared
 * across records: a match narrows a list and never links two records.
 */
function matchesSearch(record: PartnerRecord, term: string): boolean {
  const parts: string[] = [record.displayName];
  if (record.nameParts !== null) {
    if (record.nameParts.given !== null) {
      parts.push(record.nameParts.given);
    }
    if (record.nameParts.family !== null) {
      parts.push(record.nameParts.family);
    }
    for (const additional of record.nameParts.additional) {
      parts.push(additional);
    }
  }
  for (const tag of record.tags) {
    parts.push(tag);
  }
  if (record.stage !== null) {
    parts.push(record.stage);
  }
  for (const method of record.contactMethods) {
    if (method.permitted) {
      parts.push(method.value);
    }
  }
  return parts.some((part) => part.toLowerCase().includes(term));
}

/** The comparable key one sort field states for a record. */
function sortKeyOf(
  field: PartnerSortField,
  record: PartnerRecord,
  facts: RosterFacts,
): string | undefined {
  switch (field) {
    case "displayName":
      return record.displayName;
    case "kind":
      return record.kind;
    case "stage":
      return record.stage ?? undefined;
    case "favourite":
      return record.favourite ? "1" : "0";
    case "lastActivityOn":
      return facts.lastActivity.get(record.partnerId);
  }
}

/**
 * Orders two records by the request's sort, with the record identifier as the one tiebreak.
 *
 * The comparison is by code unit rather than by locale, so the same records always sort the same way
 * on every machine and the page a worker reopens is the page they left. A record with no value for
 * the sorted field stays last in both directions: an absent day is neither an early nor a late one,
 * and reversing a sort must not turn "no activity" into "the most recent activity".
 */
function compareRecords(
  left: PartnerRecord,
  right: PartnerRecord,
  query: PartnerRosterQuery,
  facts: RosterFacts,
): number {
  const sort = query.sort;
  const tiebreak = compareIdentifiers(left.partnerId, right.partnerId);
  if (sort === undefined) {
    return tiebreak;
  }
  const leftKey = sortKeyOf(sort.field, left, facts);
  const rightKey = sortKeyOf(sort.field, right, facts);
  if (leftKey === undefined || rightKey === undefined) {
    if (leftKey === undefined && rightKey === undefined) {
      return tiebreak;
    }
    return leftKey === undefined ? 1 : -1;
  }
  const primary = compareIdentifiers(leftKey, rightKey);
  if (primary !== 0) {
    return sort.direction === "desc" ? -primary : primary;
  }
  return tiebreak;
}

// ---------------------------------------------------------------------------------------------
// Building the answer
// ---------------------------------------------------------------------------------------------

/**
 * The coverage a read of records states: it enumerates every record the session holds, so its
 * coverage of that set is complete, and a boundary is absent because the source states none.
 *
 * A read that states a financial figure declares the support projection's own coverage instead, so a
 * subtotal computed over partial history is derived as an incomplete subtotal by `buildEnvelope`
 * rather than presented as whole.
 */
const RECORD_SET_COVERAGE: Coverage = { from: null, to: null, state: "complete" };

/** The facts every read states about its answer besides its data. */
interface EnvelopeSubject<C extends Coverage> {
  readonly coverage: C;
  readonly valueStates: Readonly<Record<string, RecordedValueState>>;
  readonly actions: readonly ReadAction[];
}

/** Wraps one answer in the envelope every read returns, with the eight fields populated. */
function envelopeOf<T, C extends Coverage = Coverage>(
  context: PartnerReadContext,
  data: T,
  revision: string,
  subject: EnvelopeSubject<C>,
): ReadResult<ReadEnvelope<T, C>> {
  return {
    kind: "envelope",
    envelope: buildEnvelope<T, C>({
      data,
      scope: context.scope,
      source: storeSource(context.session),
      revision,
      asOf: sessionInstant(context.session).toString(),
      coverage: subject.coverage,
      valueStates: subject.valueStates,
      actions: subject.actions,
    }),
  };
}

/**
 * The revision of the partner collection a roster read reflects.
 *
 * The store keeps no collection revision, and the session-context document's own token does not move
 * when a partner record is created, edited or archived — so a roster carrying that token would answer
 * the same revision for a different set of records and a stale view would be undetectable. This token
 * is derived from the records the read actually reflects: the same records at the same revisions under
 * the same context always produce the same value, and any creation, edit or archive of a record the
 * caller may read produces a different one. Only the records `rosterFactsOf` returned are folded, so
 * the token never changes because of a record the caller cannot see.
 *
 * It is a change-detection token, not a concurrency key: no mutation compares it as
 * `expectedRevision` — a creation compares no revision, and a per-record edit presents the row's own
 * record revision — so presenting this token to a mutation would offer a value nothing wrote.
 *
 * The fold is a 32-bit FNV-1a hash over the sorted parts, written as eight hexadecimal characters; it
 * uses integer operations only, so it is identical on every host and reads no clock.
 */
function rosterRevisionOf(
  context: PartnerReadContext,
  partners: readonly StoredPartnerRecord[],
): string {
  const parts = [
    `context@${context.document.context.revision}`,
    ...partners.map((record) => `${record.partnerId}@${record.revision}`),
  ].sort(compareIdentifiers);
  let hash = 0x811c9dc5;
  for (const part of parts) {
    for (const character of `${part}\u001f`) {
      hash ^= character.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return `roster-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/** Re-expresses a refusal as the failing half of a read result, with no envelope beside it. */
function refusalOf<T>(refusal: DeniedOutcome | UnavailableOutcome): ReadResult<T> {
  return refusal.outcome === "denied"
    ? { kind: "denied", denied: refusal }
    : { kind: "unavailable", unavailable: refusal };
}

/** Records one count's state: a count of zero is a genuine zero, not a missing value. */
function countState(count: number): RecordedValueState {
  return count > 0 ? "value" : "zero";
}

/**
 * Records every facet option's count state under the path the facet set is read at.
 *
 * One derivation for both reads that answer a facet set: `readFacets` answers the set alone and
 * `findPartners` carries the same set inside the roster's answer, so an option's count is stated
 * under one path and derived from one rule whichever read published it.
 */
function facetValueStatesOf(facets: readonly PartnerFacet[]): Record<string, RecordedValueState> {
  const valueStates: Record<string, RecordedValueState> = {};
  for (const facet of facets) {
    for (const option of facet.options) {
      valueStates[`facets.${facet.id}.${option.id}.count`] = countState(option.count);
    }
  }
  return valueStates;
}

/** Records one date's state: a stated day is a value, and no recorded day is a genuine zero. */
function dayState(day: string | null): RecordedValueState {
  return day === null ? "zero" : "value";
}

/**
 * Maps a report's value state onto a recorded one.
 *
 * `incomplete-subtotal` is the state the envelope derives, so a figure the report marked incomplete
 * for partial coverage is recorded as the known value it is: the read declares that coverage, and
 * `buildEnvelope` derives the incompleteness again rather than trusting a caller to state it.
 */
function recordedStateOf(state: ValueState): RecordedValueState {
  switch (state) {
    case "value":
    case "zero":
    case "unknown":
    case "withheld":
    case "unavailable":
      return state;
    case "incomplete-subtotal":
      return "value";
  }
}

/** Orders two tasks the way work is read: earliest due day first, undated last, then by title. */
function compareTasks(left: TaskRecord, right: TaskRecord): number {
  const leftDue = left.dueOn;
  const rightDue = right.dueOn;
  if (leftDue !== rightDue) {
    if (leftDue === null) {
      return 1;
    }
    if (rightDue === null) {
      return -1;
    }
    return compareIdentifiers(leftDue, rightDue);
  }
  const byTitle = compareIdentifiers(left.title, right.title);
  return byTitle !== 0 ? byTitle : compareIdentifiers(left.taskId, right.taskId);
}

/**
 * Orders two interactions newest first, with the record identifier as the one tiebreak.
 *
 * An interaction whose day the source did not establish has no place in a dated order, so it sorts
 * last rather than being given a fabricated day: the record states its precision and a reader sees it.
 */
function compareInteractions(left: InteractionRecord, right: InteractionRecord): number {
  if (left.occurredOn !== right.occurredOn) {
    if (left.occurredOn === null) {
      return 1;
    }
    if (right.occurredOn === null) {
      return -1;
    }
    return compareIdentifiers(right.occurredOn, left.occurredOn);
  }
  return compareIdentifiers(left.interactionId, right.interactionId);
}

/** Whether a stored gift row's own day falls inside a period; an undated row falls in none. */
function storedRowWithin(
  row: GiftRowRecord,
  period: { readonly from: CivilDate; readonly to: CivilDate },
): boolean {
  const day = row.originalGiftOn;
  if (day === null) {
    return false;
  }
  const from = serialiseCivilDate(period.from);
  const to = serialiseCivilDate(period.to);
  return day >= from && day <= to;
}

/** The currencies one record's received gifts are stated in inside the period, ascending. */
function currenciesOfPartner(snapshot: GivingSnapshot, partnerId: string): readonly string[] {
  const currencies: string[] = [];
  for (const row of giftRowsOfPartner(snapshot, partnerId)) {
    if (rowWithin(row, snapshot.period) && !currencies.includes(row.amount.currency)) {
      currencies.push(row.amount.currency);
    }
  }
  return currencies.sort(compareIdentifiers);
}

/**
 * Builds one roster row from the facts already measured for it.
 *
 * The row is the projection of the record a list needs — its identity and working labels, never a
 * contact value and never the record's own source reference — so a list cannot become a second,
 * wider record body. Each count and each day records its own state, so a genuine zero and a value the
 * read could not establish never render alike.
 */
function rowOf(
  record: StoredPartnerRecord,
  facts: RosterFacts,
  position: number,
  valueStates: Record<string, RecordedValueState>,
): PartnerRosterRow {
  const tasks = taskFactsOrNone(facts, record.partnerId);
  const lastActivityOn = facts.lastActivity.get(record.partnerId) ?? null;
  const prefix = `rows.${position}`;

  valueStates[`${prefix}.openTaskCount`] = countState(tasks.open);
  valueStates[`${prefix}.overdueTaskCount`] = countState(tasks.overdue);
  valueStates[`${prefix}.undatedTaskCount`] = countState(tasks.undated);
  valueStates[`${prefix}.lastActivityOn`] = dayState(lastActivityOn);

  const row: PartnerRosterRow = {
    partner: project(record, [
      "partnerId",
      "kind",
      "displayName",
      "tags",
      "favourite",
      "stage",
      "audience",
      "revision",
    ]),
    contactMethodKinds: contactKindsOf(record),
    initiativeIds: facts.initiativeIds.get(record.partnerId) ?? [],
    referralStatus: facts.referralStatus.get(record.partnerId) ?? null,
    openTaskCount: tasks.open,
    overdueTaskCount: tasks.overdue,
    undatedTaskCount: tasks.undated,
    lastActivityOn,
  };

  if (!facts.givingPermitted) {
    return row;
  }

  const lastReceivedOn = facts.lastReceivedOn.get(record.partnerId) ?? null;
  const givingCurrencies = facts.givingCurrencies.get(record.partnerId) ?? [];
  valueStates[`${prefix}.lastReceivedOn`] = dayState(lastReceivedOn);
  valueStates[`${prefix}.givingCurrencies`] = countState(givingCurrencies.length);
  return { ...row, lastReceivedOn, givingCurrencies };
}

// ---------------------------------------------------------------------------------------------
// findPartners: the roster
// ---------------------------------------------------------------------------------------------

/**
 * Reads the partner roster and the facet set describing it: the whole authorised set of people,
 * households, churches, organisations and the worker's own preparation, searched, filtered, sorted
 * and paged, answered together with every filter the caller may use over that same result.
 *
 * The outcome set is `envelope` with one page of rows, the whole-result total and the facet set —
 * all under one `asOf`, one revision and one coverage, because they describe one filter set read at
 * one instant — `denied` when the session, the context or the request is not admitted, and
 * `unavailable` when the records cannot be read or the stated time zone cannot be resolved.
 *
 * The answer also states which filters took effect: the facet selections it admitted in `applied`,
 * the search text it searched in `appliedSearch` and the period its giving figures were read over in
 * `appliedPeriod`. A surface that rebuilt its filters from the request instead would show a chip for
 * a value the read dropped, and none for a filter the read applied.
 */
export async function findPartners(
  query: PartnerRosterQuery = {},
  source?: SessionSource,
): Promise<ReadResult<ReadEnvelope<PartnerRosterPage>>> {
  const outcome = await readContext("findPartners", source);
  if (!outcome.ok) {
    return refusalOf(outcome.refusal);
  }
  const { context } = outcome;
  const factsOutcome = rosterFactsOf("findPartners", context, query);
  if (factsOutcome.kind !== "ready") {
    return refusalOf(factsOutcome.refusal);
  }
  const facts = factsOutcome.facts;
  const selection = appliedSelectionOf(facts, query.applied);
  const searchText = (query.search ?? "").trim();
  const term = searchText.toLowerCase();

  const matched: PartnerRecord[] = [];
  for (const record of facts.partners) {
    if (!matchesFilters(record, selection.filters, facts)) {
      continue;
    }
    if (term !== "" && !matchesSearch(record, term)) {
      continue;
    }
    matched.push(record);
  }
  matched.sort((left, right) => compareRecords(left, right, query, facts));

  const size = clampPageSize(query.page?.size);
  const requested = query.page?.index ?? 0;
  const index = Number.isSafeInteger(requested) && requested > 0 ? requested : 0;
  const totalPages = Math.max(1, Math.ceil(matched.length / size));
  const window = matched.slice(index * size, index * size + size);

  const valueStates: Record<string, RecordedValueState> = { total: countState(matched.length) };
  const rows = window.map((record, position) => rowOf(record, facts, position, valueStates));

  // The facet set is built from the facts already measured for these rows, so its counts describe the
  // result they are published beside rather than a second enumeration of the same query.
  const facets = buildFacets(facts);
  Object.assign(valueStates, facetValueStatesOf(facets));

  const giving =
    facts.givingPermitted && facts.giving.kind === "ready"
      ? {
          periodLabel: facts.giving.snapshot.periodLabel,
          coverage: facts.giving.snapshot.coverage,
          currencies: facts.givingPartition,
        }
      : undefined;

  // The period is stated beside the facet selections because it is what the figures were read over: a
  // preset the report engine resolved is reported as the days it resolved to, never as the request's
  // own words.
  const appliedPeriod =
    query.period !== undefined && facts.giving.kind === "ready"
      ? {
          from: serialiseCivilDate(facts.giving.snapshot.period.from),
          to: serialiseCivilDate(facts.giving.snapshot.period.to),
        }
      : null;

  const data: PartnerRosterPage = {
    rows,
    total: matched.length,
    page: { index, size, totalPages },
    timeZone: facts.timeZone,
    ...(giving === undefined ? {} : { giving }),
    applied: selection.applied,
    appliedSearch: searchText === "" ? null : searchText,
    appliedPeriod,
    facets,
  };

  return envelopeOf(context, data, rosterRevisionOf(context, facts.partners), {
    coverage: RECORD_SET_COVERAGE,
    valueStates,
    actions: [
      { name: "createPrivatePreparation", available: true },
      { name: "setFavourite", available: true },
      { name: "setTag", available: true },
      { name: "saveView", available: true },
    ],
  });
}

// ---------------------------------------------------------------------------------------------
// readFacets: the filter set the caller may use
// ---------------------------------------------------------------------------------------------

/**
 * Reads the roster's facet set: every filter the caller may use, with the values it admits and the
 * whole-result count of records carrying each.
 *
 * The outcome set is `envelope` with the facet set, `denied` when the session or the context is not
 * admitted, and `unavailable` when the records cannot be read or the stated time zone cannot be
 * resolved. A facet whose own source did not answer is reported inside the envelope as `unavailable`
 * rather than as an empty facet.
 */
export async function readFacets(
  query: PartnerGivingSelection = {},
  source?: SessionSource,
): Promise<ReadResult<ReadEnvelope<readonly PartnerFacet[]>>> {
  const outcome = await readContext("readFacets", source);
  if (!outcome.ok) {
    return refusalOf(outcome.refusal);
  }
  const { context } = outcome;
  const factsOutcome = rosterFactsOf("readFacets", context, query);
  if (factsOutcome.kind !== "ready") {
    return refusalOf(factsOutcome.refusal);
  }
  const facts = factsOutcome.facts;
  const facets = buildFacets(facts);

  return envelopeOf(context, facets, rosterRevisionOf(context, facts.partners), {
    coverage: RECORD_SET_COVERAGE,
    valueStates: facetValueStatesOf(facets),
    actions: [{ name: "saveView", available: true }],
  });
}

// ---------------------------------------------------------------------------------------------
// readSavedViews: the caller's stored choices, with the drift they now carry
// ---------------------------------------------------------------------------------------------

/**
 * The references a stored view holds that this build no longer offers.
 *
 * Drift is a comparison with the current facet set and the current column set, never with the
 * selection on screen: applying a view is how those are made to agree. Nothing is rewritten and
 * nothing is dropped — a view that needs repair keeps every choice it holds, which is what lets a
 * worker repair it deliberately rather than discover that their filters quietly changed.
 */
function driftOf(view: StoredSavedView, facets: readonly PartnerFacet[]): PartnerSavedViewDrift {
  const missing: string[] = [];

  for (const [facetId, values] of Object.entries(view.query.applied)) {
    const facet = facets.find((candidate) => candidate.id === facetId);
    if (facet === undefined || facet.state !== "available" || facet.options.length === 0) {
      missing.push(facetId);
      continue;
    }
    const admitted = new Set(facet.options.map((option) => option.id));
    for (const value of values) {
      if (!admitted.has(value)) {
        missing.push(`${facetId}: ${value}`);
      }
    }
  }

  const visibility = view.query.columnVisibility;
  if (visibility !== undefined) {
    for (const columnId of Object.keys(visibility)) {
      if (!PARTNER_ROSTER_COLUMNS.some((column) => column === columnId)) {
        missing.push(`column: ${columnId}`);
      }
    }
  }

  return { drifted: missing.length > 0, missing };
}

/**
 * Reads the saved views the caller owns, each with the drift the current facet set reports.
 *
 * The outcome set is `envelope` with the views, `denied` when the session or the context is not
 * admitted, and `unavailable` when the records cannot be read. Only the caller's own views are
 * returned: a view is one principal's choices, and another principal's choices are not a record this
 * read may enumerate.
 */
export async function readSavedViews(
  source?: SessionSource,
): Promise<ReadResult<ReadEnvelope<readonly PartnerSavedView[]>>> {
  const outcome = await readContext("readSavedViews", source);
  if (!outcome.ok) {
    return refusalOf(outcome.refusal);
  }
  const { context } = outcome;

  // The facet set a view is judged against is the one this caller receives now, so a view is flagged
  // against exactly the filters the surface would offer. This read states no zone, so the day it
  // resolves against is the declared default and a calendar refusal cannot arise here; the union is
  // still handled, because a refusal is never dropped on the way out.
  const factsOutcome = rosterFactsOf("readSavedViews", context, {});
  if (factsOutcome.kind !== "ready") {
    return refusalOf(factsOutcome.refusal);
  }
  const facts = factsOutcome.facts;
  const facets = buildFacets(facts);

  const views: PartnerSavedView[] = [];
  for (const stored of context.document.savedViews) {
    if (stored.ownerPrincipalId !== context.session.principalId) {
      continue;
    }
    views.push({
      id: stored.viewId,
      name: stored.name,
      query: {
        search: stored.query.search,
        applied: stored.query.applied,
        ...(stored.query.columnVisibility === undefined
          ? {}
          : { columnVisibility: stored.query.columnVisibility }),
      },
      ownerPrincipalId: stored.ownerPrincipalId,
      revision: stored.revision,
      drift: driftOf(stored, facets),
    });
  }
  views.sort((left, right) => {
    const byName = compareIdentifiers(left.name, right.name);
    return byName !== 0 ? byName : compareIdentifiers(left.id, right.id);
  });

  return envelopeOf(context, views, context.document.context.revision, {
    coverage: RECORD_SET_COVERAGE,
    valueStates: { total: countState(views.length) },
    actions: [{ name: "saveView", available: true }],
  });
}

// ---------------------------------------------------------------------------------------------
// readPartner: the one record body
// ---------------------------------------------------------------------------------------------

/** The reason an archive action is absent on a record that is not the worker's own preparation. */
const ONLY_PREPARATION_ARCHIVED =
  "Only the worker's own private preparation is archived or restored. A shared operational record is neither, and this action changes nothing on it.";

/**
 * Reads one partner record for the record body: identity, the contact methods this caller may use,
 * restrictions, relationship context, open work and the authorised support history.
 *
 * The outcome set is `envelope` with the record, `denied` for a record outside this caller's scope or
 * outside its permission — with nothing else in the payload, so a denied record and an absent one
 * answer alike — and `unavailable` when the records cannot be read.
 */
export async function readPartner(
  partnerId: string,
  query: PartnerGivingSelection = {},
  source?: SessionSource,
): Promise<ReadResult<ReadEnvelope<PartnerDetailData>>> {
  const outcome = await readContext("readPartner", source);
  if (!outcome.ok) {
    return refusalOf(outcome.refusal);
  }
  const { context } = outcome;

  const record = context.document.partners.find((candidate) => candidate.partnerId === partnerId);
  if (record === undefined || !mayReadPartner(context, record)) {
    return refusalOf(refused("no-permission"));
  }

  const openTasks = context.document.tasks
    .filter(
      (task) =>
        task.partnerId === record.partnerId &&
        (task.status === "open" || task.status === "reopened"),
    )
    .sort(compareTasks);

  // The record's own recorded relationship label, rendered verbatim. Nothing is derived from a name,
  // a household, a church or an organisation: those are other records with their own identifiers.
  const relationshipContext: PartnerRelationship[] =
    record.stage === null ? [] : [{ label: record.stage }];

  const valueStates: Record<string, RecordedValueState> = {};
  let coverage: Coverage = RECORD_SET_COVERAGE;
  let supportHistory: PartnerSupportHistory | undefined;

  if (mayReadGiving(context)) {
    const giving = givingSnapshotOf(context.document, context, query);
    if (giving.kind === "ready") {
      const { snapshot } = giving;
      const figures: PartnerSupportFigure[] = [];
      for (const currency of currenciesOfPartner(snapshot, record.partnerId)) {
        const summary = partnerSummaryOf(snapshot, record.partnerId, currency, context.scope);
        if (summary === undefined) {
          continue;
        }
        const path = `supportHistory.figures.${currency}.received`;
        valueStates[path] = recordedStateOf(summary.received.valueState);
        figures.push({
          path,
          label: `Received gifts in ${currency}, ${snapshot.periodLabel}`,
          // The amount is present because the figure's shape states one; the state above decides
          // whether a number may be printed, and `formatMinor` never reads an amount whose state
          // carries none.
          amount: { currency, minorUnits: summary.received.minorUnits ?? minorUnitsOf(0) },
        });
      }

      const gifts: PartnerSupportGift[] = [];
      for (const stored of snapshot.facts.records) {
        if (
          stored.attribution.kind !== "partner" ||
          stored.attribution.partnerId !== record.partnerId ||
          !storedRowWithin(stored, snapshot.period)
        ) {
          continue;
        }
        const amountPath = `supportHistory.gifts.${gifts.length}.amount`;
        valueStates[amountPath] = stored.amount.minorUnits === 0 ? "zero" : "value";
        gifts.push({ gift: stored, amountPath });
      }

      supportHistory = {
        basis: SUPPORT_BASIS,
        periodLabel: snapshot.periodLabel,
        figures,
        ...(gifts.length === 0 ? {} : { gifts }),
      };
      // The read states the coverage its figures were computed over, so a subtotal over partial
      // history is derived as an incomplete subtotal rather than presented as a whole period.
      coverage = snapshot.coverage;
    }
  }

  const archived = record.archived === true;
  const isPreparation = record.kind === "private-preparation";
  const preparationActions: readonly ReadAction[] = isPreparation
    ? [
        archived
          ? {
              name: "archivePreparation",
              available: false,
              reason: "This preparation is already archived.",
            }
          : { name: "archivePreparation", available: true },
        archived
          ? { name: "restorePreparation", available: true }
          : {
              name: "restorePreparation",
              available: false,
              reason: "This preparation is not archived.",
            },
      ]
    : [
        { name: "archivePreparation", available: false, reason: ONLY_PREPARATION_ARCHIVED },
        { name: "restorePreparation", available: false, reason: ONLY_PREPARATION_ARCHIVED },
      ];

  const data: PartnerDetailData = {
    // A contact method this caller may not use is absent rather than shown blank: the restriction
    // records on the same record state why it may not be used, and a value that is not offered
    // cannot be copied out of a list.
    partner: {
      ...record,
      contactMethods: record.contactMethods.filter((method) => method.permitted),
    },
    relationshipContext,
    openTasks,
    ...(supportHistory === undefined ? {} : { supportHistory }),
  };

  return envelopeOf(context, data, record.revision, {
    coverage,
    valueStates,
    actions: [
      { name: "saveContactEdits", available: true },
      { name: "savePrivateNote", available: true },
      { name: "logInteraction", available: true },
      { name: "createTask", available: true },
      { name: "setFavourite", available: true },
      { name: "setTag", available: true },
      ...preparationActions,
    ],
  });
}

// ---------------------------------------------------------------------------------------------
// readPrivatePreparation: the worker's own preparation and note bodies
// ---------------------------------------------------------------------------------------------

/** Which record the private read is about. */
export interface PartnerPrivateQuery {
  /** The record whose preparation and private notes are read. */
  readonly partnerId: string;
}

/**
 * Reads the worker's own preparation for one record: the private note bodies it holds and whether the
 * preparation is archived.
 *
 * The outcome set is `envelope` with the private data, `denied` for any caller who is not this
 * record's author or is not admitted to its context — with no count, title or existence flag, so a
 * colleague cannot learn that another principal's preparation exists — and `unavailable` when the
 * records cannot be read. Private note text appears in this envelope and in no other read.
 */
export async function readPrivatePreparation(
  input: PartnerPrivateQuery,
  source?: SessionSource,
): Promise<ReadResult<ReadEnvelope<PartnerPrivateData>>> {
  const outcome = await readContext("readPrivatePreparation", source);
  if (!outcome.ok) {
    return refusalOf(outcome.refusal);
  }
  const { context } = outcome;

  const record = context.document.partners.find(
    (candidate) => candidate.partnerId === input.partnerId,
  );
  if (record === undefined || !mayReadPartner(context, record)) {
    return refusalOf(refused("no-permission"));
  }

  const notes: PrivateNoteRecord[] = [];
  for (const note of context.document.privateNotes) {
    if (note.partnerId !== record.partnerId) {
      continue;
    }
    const decision = canView(context.session, {
      kind: "private-note",
      scope: context.scope,
      authorPrincipalId: note.authorPrincipalId,
    });
    if (decision.allowed) {
      notes.push(note);
    }
  }
  notes.sort((left, right) => {
    const byCreated = compareIdentifiers(right.createdAt, left.createdAt);
    return byCreated !== 0 ? byCreated : compareIdentifiers(left.noteId, right.noteId);
  });

  const preparation =
    record.kind === "private-preparation"
      ? { partnerId: record.partnerId, archived: record.archived === true }
      : undefined;

  const data: PartnerPrivateData = {
    notes,
    ...(preparation === undefined ? {} : { preparation }),
  };

  return envelopeOf(context, data, record.revision, {
    coverage: RECORD_SET_COVERAGE,
    valueStates: { notes: countState(notes.length) },
    actions: [
      { name: "savePrivateNote", available: true },
      preparation === undefined
        ? { name: "createPrivatePreparation", available: true }
        : {
            name: "createPrivatePreparation",
            available: false,
            reason: "A preparation record already exists for this partner.",
          },
    ],
  });
}

// ---------------------------------------------------------------------------------------------
// readInteractions: what actually happened
// ---------------------------------------------------------------------------------------------

/** What one activity read may narrow to and how much of it it returns. */
export interface PartnerInteractionsQuery {
  /** One record's activity, or every record's when absent. */
  readonly partnerId?: string;
  readonly page?: { readonly index: number; readonly size?: number };
}

/**
 * One page of recorded activity.
 *
 * The page travels beside the whole-result total because a list of one page that reported only its own
 * length would let a surface state "50 interactions" about a record that holds two hundred. The
 * record body renders `interactions`; the total and the page tell it how much it is not showing.
 */
export interface PartnerInteractionPage {
  readonly interactions: readonly InteractionRecord[];
  /** The whole-result count, never the count of the loaded page. */
  readonly total: number;
  readonly page: { readonly index: number; readonly size: number; readonly totalPages: number };
}

/**
 * Reads recorded activity: the interactions that actually happened, newest first.
 *
 * The outcome set is `envelope` with one page of activity, `denied` when the session, the context or
 * the requested record is outside this caller's scope, and `unavailable` when the records cannot be
 * read.
 *
 * Four things are never an interaction and none of them is manufactured here: a gift, a scheduled
 * task, the act of opening a mail or dialer app, and completing a task. A record whose source states
 * an event appears once, because an event that arrived twice would otherwise be reported as two
 * conversations. A note whose audience is `private` states no author anywhere in the stored record, so
 * it is withheld rather than attributed to whoever asked.
 */
export async function readInteractions(
  query: PartnerInteractionsQuery = {},
  source?: SessionSource,
): Promise<ReadResult<ReadEnvelope<PartnerInteractionPage>>> {
  const outcome = await readContext("readInteractions", source);
  if (!outcome.ok) {
    return refusalOf(outcome.refusal);
  }
  const { context } = outcome;

  if (!canView(context.session, { kind: "interaction", scope: context.scope }).allowed) {
    return refusalOf(refused("no-permission"));
  }

  let partnerId: string | undefined;
  if (query.partnerId !== undefined) {
    const record = context.document.partners.find(
      (candidate) => candidate.partnerId === query.partnerId,
    );
    if (record === undefined || !mayReadPartner(context, record)) {
      return refusalOf(refused("no-permission"));
    }
    partnerId = record.partnerId;
  }

  const seenIdentities = new Set<string>();
  const seenEvents = new Set<string>();
  const visible: InteractionRecord[] = [];
  for (const interaction of context.document.interactions) {
    if (partnerId !== undefined && interaction.partnerId !== partnerId) {
      continue;
    }
    if (seenIdentities.has(interaction.interactionId)) {
      continue;
    }
    seenIdentities.add(interaction.interactionId);

    const provenance = interaction.provenance;
    if (provenance !== null) {
      const key = `${provenance.system}\u0000${provenance.reference}`;
      if (seenEvents.has(key)) {
        continue;
      }
      seenEvents.add(key);
    }

    visible.push(
      interaction.note === null || interaction.note.audience === "shared"
        ? interaction
        : { ...interaction, note: null },
    );
  }
  visible.sort(compareInteractions);

  const size = clampPageSize(query.page?.size);
  const requested = query.page?.index ?? 0;
  const index = Number.isSafeInteger(requested) && requested > 0 ? requested : 0;
  const totalPages = Math.max(1, Math.ceil(visible.length / size));
  const window = visible.slice(index * size, index * size + size);

  const valueStates: Record<string, RecordedValueState> = {
    total: countState(visible.length),
  };
  window.forEach((interaction, position) => {
    valueStates[`rows.${position}.occurredOn`] =
      interaction.precision === "unknown" ? "unknown" : "value";
  });

  const data: PartnerInteractionPage = {
    interactions: Object.freeze([...window]),
    total: visible.length,
    page: { index, size, totalPages },
  };

  return envelopeOf(context, data, context.document.context.revision, {
    coverage: RECORD_SET_COVERAGE,
    valueStates,
    actions: [
      { name: "logInteraction", available: true },
      { name: "createTask", available: true },
    ],
  });
}
