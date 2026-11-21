/**
 * The partner roster, the one record body, the facet set, saved views, private preparation and
 * recorded activity: the six reads behind AAP 0.7.1's "Find and open a partner", "Prepare and maintain
 * a contact" and "Record what actually happened".
 */
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import type { SourceReference } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { failureFor, failurePlanOfDocument } from "@/modules/dev-runtime/failures";
import { minorUnitsOf } from "@/modules/money/amount";
import { readSession } from "@/modules/store/repository";
import { SUPPORT_BASIS, type GiftRow, type SupportProjection } from "@/modules/support/basis";
import { clampPageSize, runReport, type CurrencySummary, type PeriodState, type ReportPeriod, type ReportScope } from "@/modules/support/report";
import { instantAt } from "@/modules/time/clock";
import { parseCivilDate, serialiseCivilDate, todayInZone, type CivilDate } from "@/modules/time/civil";
import { assertScope, canView, outcomeOfRefusal, resolveSession, type AuthorizationTarget, type ResolvedSession, type SessionSource } from "../authorize";
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
import { LOCAL_STORE_SYSTEM, denied, unavailable, type DenialReason, type DeniedOutcome, type ReadResult, type UnavailableOutcome } from "../outcome";
// Constants: the vocabularies this file states once
const READ_ATTEMPT_ID = "read";

const PARTNERS_SOURCE_REFERENCE = "partners";

const ROSTER_DEFAULT_TIME_ZONE = "UTC";
/** The ordered facet keys of the roster's bounded facet set, exactly the order the family's copy lists them in, so the toolbar's labels and the service's facets cannot enumerate different sets. */
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
/** The fields the roster may sort by. */
export const PARTNER_SORT_FIELDS = ["displayName", "kind", "stage", "favourite", "lastActivityOn"] as const;
/** One column the roster may sort by. */
export type PartnerSortField = (typeof PARTNER_SORT_FIELDS)[number];
/** The two directions a sort may take. */
export const PARTNER_SORT_DIRECTIONS = ["asc", "desc"] as const;
/** One direction a roster sort may take. */
export type PartnerSortDirection = (typeof PARTNER_SORT_DIRECTIONS)[number];
/** The columns the roster may show, hide and store in a saved view. */
export const PARTNER_ROSTER_COLUMNS = ["displayName", "kind", "stage", "tags", "favourite", "contactMethods", "lastActivity", "openTasks", "referralStatus", "giving"] as const;
/** One column of the partner roster. */
export type PartnerRosterColumn = (typeof PARTNER_ROSTER_COLUMNS)[number];

const CONTACT_TYPE_LABELS: Readonly<Record<PartnerKind, string>> = {
  person: "Person",
  household: "Household",
  church: "Church",
  organization: "Organization",
  "private-preparation": "Private preparation",
};
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
const CONTACT_METHOD_AVAILABILITY_LABELS: Readonly<Record<"any-permitted" | "none-permitted", string>> = {
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
const NO_STATED_CAPABILITIES: readonly string[] = Object.freeze([]);

const STORE_UNAVAILABLE_GUIDANCE =
  "This session's records could not be read, so no list, count or amount is shown rather than an empty one. Retry the read; if it keeps failing, reset the seeded development data.";
const CALENDAR_SOURCE: SourceReference = { system: "time-zone-database", reference: "calendar" };

const CALENDAR_UNAVAILABLE_GUIDANCE =
  "No date in this roster was judged in an assumed time zone, so no overdue count, last-activity day or last-received-gift day is shown rather than one computed in a calendar you did not ask for. Choose a time zone this runtime resolves in Settings, or omit the zone and the read uses UTC, and read the roster again.";
const NO_PARTNER_ATTRIBUTION =
  "The source states this fact for the support subject and attributes it to no partner, so the roster cannot narrow by it. It is shown here rather than offered as a filter that would match nothing.";
const NO_SUPPORT_PROJECTION = "The source states no support projection for this subject, so no giving value can be offered or counted.";

const GIVING_UNAVAILABLE_WITHOUT_PERMISSION = "This context does not admit the support facts of the record set, so no giving value is offered here.";
// The public read contract: facets, roster, saved views, detail
/** One value a facet offers, with the whole-result count of records that carry it. */
export interface PartnerFacetValue {
  readonly id: string;
  readonly label: string;
  readonly count: number;
  readonly countState: ValueState;
}
/** The state a facet is offered in: usable, or unavailable with the source that did not answer. */
export type PartnerFacetState = "available" | "unavailable";
/** One filter the roster offers. */
export interface PartnerFacet {
  readonly id: PartnerFacetId;
  readonly labelKey: PartnerFacetId;
  readonly operator: "OR";
  readonly multi: boolean;
  readonly state: PartnerFacetState;
  readonly options: readonly PartnerFacetValue[];
  readonly disabledReason?: string;
  readonly source?: SourceReference;
}
/** The period and currency a giving figure is stated in. */
export interface PartnerGivingSelection {
  readonly currency?: string;
  readonly period?: { readonly from: string; readonly to: string };
  readonly timeZone?: string;
}
/** Everything one roster request states. */
export interface PartnerRosterQuery extends PartnerGivingSelection {
  readonly search?: string;
  readonly applied?: Readonly<Record<string, readonly string[]>>;
  readonly sort?: {
    readonly field: PartnerSortField;
    readonly direction: PartnerSortDirection;
  };
  readonly page?: { readonly index: number; readonly size?: number };
}
/** The fields of one record the roster carries: identity and working labels, never contact values. */
export type PartnerRosterRecord = Pick<PartnerRecord, "partnerId" | "kind" | "displayName" | "tags" | "favourite" | "stage" | "audience" | "revision">;
/** The giving facts a roster read states once for the whole list. */
export interface PartnerRosterGivingScope {
  readonly periodLabel: string;
  readonly coverage: Coverage;
  readonly currencies: readonly string[];
}
/** One row of the roster. */
export interface PartnerRosterRow {
  readonly partner: PartnerRosterRecord;
  readonly contactMethodKinds: readonly ContactMethodKind[];
  readonly initiativeIds: readonly string[];
  readonly referralStatus: PartnerReferralStatus | null;
  readonly openTaskCount: number;
  readonly overdueTaskCount: number;
  readonly undatedTaskCount: number;
  readonly lastActivityOn: string | null;
  readonly givingCurrencies?: readonly string[];
  readonly lastReceivedOn?: string | null;
}
/** What one roster read answers. */
export interface PartnerRosterPage {
  readonly rows: readonly PartnerRosterRow[];
  readonly total: number;
  readonly page: { readonly index: number; readonly size: number; readonly totalPages: number };
  readonly timeZone: string;
  readonly giving?: PartnerRosterGivingScope;
  readonly applied: Readonly<Record<string, readonly string[]>>;
  readonly appliedSearch: string | null;
  readonly appliedPeriod: { readonly from: string; readonly to: string } | null;
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
  readonly missing: readonly string[];
}
/** One saved view the caller owns, with the drift the current facet set reports for it. */
export interface PartnerSavedView {
  readonly id: string;
  readonly name: string;
  readonly query: PartnerSavedViewQuery;
  readonly ownerPrincipalId: string;
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
  readonly basis: string;
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
  readonly supportHistory?: PartnerSupportHistory;
}
/** What the private read carries for one record: the worker's own preparation and note bodies. */
export interface PartnerPrivateData {
  readonly notes: readonly PrivateNoteRecord[];
  readonly preparation?: { readonly partnerId: string; readonly archived: boolean };
}
type FacetValueCandidate = {
  readonly id: string;
  readonly label: string;
};
type FacetOutcome =
  | { readonly kind: "values"; readonly values: readonly FacetValueCandidate[] }
  | { readonly kind: "unavailable"; readonly reason: string }
  | { readonly kind: "not-applicable"; readonly reason: string };
// The stored session document these reads parse
const storedPartnerRecordSchema = partnerRecordSchema.and(z.object({ archived: z.boolean().optional() }));

type StoredPartnerRecord = z.infer<typeof storedPartnerRecordSchema>;

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
type StoredSavedView = z.infer<typeof storedSavedViewSchema>;

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
type PartnerStateDocument = z.infer<typeof partnerStateDocumentSchema>;
// Resolving the caller, the scope and the document
interface PartnerReadContext {
  readonly session: ResolvedSession;
  readonly scope: Scope;
  readonly document: PartnerStateDocument;
}
type ContextOutcome = { readonly ok: true; readonly context: PartnerReadContext } | { readonly ok: false; readonly refusal: DeniedOutcome | UnavailableOutcome };

function storeSource(): SourceReference {
  return { system: LOCAL_STORE_SYSTEM, reference: PARTNERS_SOURCE_REFERENCE };
}
function refused(reasonCode: DenialReason): DeniedOutcome {
  return denied({ operationId: READ_ATTEMPT_ID, reasonCode });
}
function sourceUnavailable(job: string): UnavailableOutcome {
  const source = storeSource();
  logger.sourceUnavailable({ job, source });
  return unavailable({
    operationId: READ_ATTEMPT_ID,
    source,
    guidance: STORE_UNAVAILABLE_GUIDANCE,
  });
}
function calendarUnavailable(job: string): UnavailableOutcome {
  logger.sourceUnavailable({ job, source: CALENDAR_SOURCE });
  return unavailable({
    operationId: READ_ATTEMPT_ID,
    source: CALENDAR_SOURCE,
    guidance: CALENDAR_UNAVAILABLE_GUIDANCE,
  });
}
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
    return { ok: false, refusal: outcomeOfRefusal(resolution.refusal, READ_ATTEMPT_ID) };
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
      return { ok: false, refusal: sourceUnavailable(job) };
    }
    state = documents.state;
    meta = documents.meta;
  } catch {
    return { ok: false, refusal: sourceUnavailable(job) };
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
    return { ok: false, refusal: sourceUnavailable(job) };
  }
  return { ok: true, context: { session, scope, document: parsed.data } };
}
function mayReadPartner(context: PartnerReadContext, record: PartnerRecord): boolean {
  const target: AuthorizationTarget = {
    kind: "partner",
    scope: context.scope,
    audience: record.audience,
    // A private record belongs to the principal whose world it was written in, which the document states.
    // Stating the caller instead would answer the author question with the caller and admit any admitted
    // colleague to another person's preparation — the leak `canView` refuses an unstated author to prevent.
    authorPrincipalId: record.audience === "private" ? context.document.context.principalId : null,
  };
  return canView(context.session, target).allowed;
}
function mayReadGiving(context: PartnerReadContext): boolean {
  const target: AuthorizationTarget = {
    kind: "support-subject",
    scope: context.scope,
    capabilities: NO_STATED_CAPABILITIES,
  };
  return canView(context.session, target).allowed;
}
function sessionInstant(session: ResolvedSession): Temporal.Instant {
  return instantAt(session.clockOffsetMs);
}
function zoneOf(timeZone: string | undefined): string {
  const stated = timeZone === undefined ? "" : timeZone.trim();
  return stated === "" ? ROSTER_DEFAULT_TIME_ZONE : stated;
}
// The giving facts, which only the report engine computes
interface GivingFacts {
  readonly record: SupportProjectionRecord;
  readonly rows: readonly GiftRow[];
  readonly records: readonly GiftRowRecord[];
  readonly commitments: SupportProjection["commitments"];
}
function civilDateOf(value: string): CivilDate | undefined {
  const parsed = parseCivilDate(value);
  return parsed.status === "parsed" ? parsed.date : undefined;
}
function commitmentRowsOf(records: readonly CommitmentRowRecord[], context: PartnerReadContext): SupportProjection["commitments"] {
  const rows: SupportProjection["commitments"][number][] = [];
  for (const record of records) {
    const lastSuccessfulOn = record.lastSuccessfulOn === null ? undefined : civilDateOf(record.lastSuccessfulOn);
    const nextEligibleOn = record.nextEligibleOn === null ? undefined : civilDateOf(record.nextEligibleOn);
    const resumeOn = record.pause.resumeOn === null ? undefined : civilDateOf(record.pause.resumeOn);
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
class DateUnreadableError extends Error {
  constructor(rowId: string, supportSubjectId: string) {
    super(`A stored date on "${rowId}" in support subject "${supportSubjectId}" is not the storage form of a calendar day, so the projection it belongs to cannot be read.`);
    this.name = "DateUnreadableError";
  }
}
function givingFactsOf(document: PartnerStateDocument, context: PartnerReadContext): GivingFacts | undefined {
  const record = document.supportProjection;
  if (record === null) {
    return undefined;
  }
  const rows: GiftRow[] = [];
  for (const stored of document.gifts) {
    const entryOn = civilDateOf(stored.entryOn);
    const originalGiftOn = stored.originalGiftOn === null ? undefined : civilDateOf(stored.originalGiftOn);
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
interface GivingSnapshot {
  readonly facts: GivingFacts;
  readonly projection: SupportProjection;
  readonly period: {
    readonly from: CivilDate;
    readonly to: CivilDate;
    readonly state: PeriodState;
  };
  readonly periodLabel: string;
  readonly coverage: Coverage;
  readonly currencies: readonly string[];
}
type GivingOutcome = { readonly kind: "ready"; readonly snapshot: GivingSnapshot } | { readonly kind: "unavailable"; readonly reason: string };

const GIVING_REPORT_ID = "received-period-and-year-to-date";

function reportScopeOf(scope: Scope): ReportScope {
  return {
    organizationId: scope.organizationId,
    ministryId: scope.ministryId,
    supportSubjectId: scope.supportSubjectId,
    principalId: scope.principalId,
  };
}
function givingSnapshotOf(document: PartnerStateDocument, context: PartnerReadContext, selection: PartnerGivingSelection): GivingOutcome {
  const facts = givingFactsOf(document, context);
  if (facts === undefined) {
    return { kind: "unavailable", reason: NO_SUPPORT_PROJECTION };
  }
  const period = reportPeriodOf(selection.period);
  if (period === undefined) {
    return {
      kind: "unavailable",
      reason: "The stated period is not two calendar days, so no period is substituted for it and no figure is stated.",
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
      periodLabel: `${serialiseCivilDate(whole.snapshot.period.from)} to ${serialiseCivilDate(whole.snapshot.period.to)}${whole.snapshot.period.state === "in-progress" ? " (in progress)" : ""}`,
      coverage: whole.snapshot.coverage,
      currencies,
    },
  };
}
function givingPartitionOf(snapshot: GivingSnapshot, currency: string | undefined): readonly string[] {
  const stated = currency === undefined ? "" : currency.trim();
  return stated === "" ? snapshot.currencies : [stated];
}
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
function giftRowsOfPartner(snapshot: GivingSnapshot, partnerId: string): readonly GiftRow[] {
  return snapshot.projection.gifts.filter((row) => row.attribution.kind === "partner" && row.attribution.partnerId === partnerId);
}
function rowWithin(row: GiftRow, period: { readonly from: CivilDate; readonly to: CivilDate }): boolean {
  const day = row.originalGiftOn;
  if (day === undefined) {
    return false;
  }
  return Temporal.PlainDate.compare(day, period.from) >= 0 && Temporal.PlainDate.compare(day, period.to) <= 0;
}
function partnerSummaryOf(snapshot: GivingSnapshot, partnerId: string, currency: string, scope: Scope): CurrencySummary | undefined {
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
// The whole-dataset facts the roster, its facets and its saved views read
interface TaskFacts {
  readonly open: number;
  readonly overdue: number;
  readonly undated: number;
}
interface RosterFacts {
  readonly partners: readonly StoredPartnerRecord[];
  readonly initiatives: readonly InitiativeRecord[];
  readonly lastActivity: ReadonlyMap<string, string>;
  readonly taskFacts: ReadonlyMap<string, TaskFacts>;
  readonly referralStatus: ReadonlyMap<string, PartnerReferralStatus>;
  readonly initiativeIds: ReadonlyMap<string, readonly string[]>;
  readonly givingCurrencies: ReadonlyMap<string, readonly string[]>;
  readonly lastReceivedOn: ReadonlyMap<string, string>;
  readonly givingPermitted: boolean;
  readonly giving: GivingOutcome;
  readonly givingPartition: readonly string[];
  readonly today: CivilDate;
  readonly timeZone: string;
  readonly source: SourceReference;
}
type RosterFactsOutcome = { readonly kind: "ready"; readonly facts: RosterFacts } | { readonly kind: "unavailable"; readonly refusal: UnavailableOutcome };

type ResolvedRosterDay = { readonly status: "resolved"; readonly date: CivilDate; readonly zone: string } | { readonly status: "unavailable"; readonly refusal: UnavailableOutcome };

function todayIn(job: string, zone: string, at: Temporal.Instant): ResolvedRosterDay {
  const resolved = todayInZone(zone, at);
  if (resolved.status === "resolved") {
    return { status: "resolved", date: resolved.date, zone };
  }
  return { status: "unavailable", refusal: calendarUnavailable(job) };
}
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
function referralStatusOf(cycles: readonly ReferralCycleRecord[], partnerId: string, at: Temporal.Instant): PartnerReferralStatus | undefined {
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
function latestDay(current: string | undefined, candidate: string): string {
  if (current === undefined) {
    return candidate;
  }
  return candidate > current ? candidate : current;
}
function compareIdentifiers(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}
function rosterFactsOf(job: string, context: PartnerReadContext, selection: PartnerGivingSelection): RosterFactsOutcome {
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
    lastActivity.set(interaction.partnerId, latestDay(lastActivity.get(interaction.partnerId), interaction.occurredOn));
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
  const giving: GivingOutcome = givingPermitted ? givingSnapshotOf(document, context, selection) : { kind: "unavailable", reason: GIVING_UNAVAILABLE_WITHOUT_PERMISSION };
  // The partition is stated once here, so the list's currencies, every row's currencies and the
  // giving-total facet's options all read the request's stated currency from one decision rather than
  // each deciding which currencies its figures may be stated in.
  const givingPartition: readonly string[] = giving.kind === "ready" ? givingPartitionOf(giving.snapshot, selection.currency) : [];
  const openCurrencies = new Map<string, string[]>();
  const lastReceivedOn = new Map<string, string>();
  const givingCurrencies = new Map<string, readonly string[]>();
  if (giving.kind === "ready") {
    for (const row of giving.snapshot.projection.gifts) {
      if (row.attribution.kind !== "partner" || row.originalGiftOn === undefined) {
        continue;
      }
      const partnerId = row.attribution.partnerId;
      lastReceivedOn.set(partnerId, latestDay(lastReceivedOn.get(partnerId), serialiseCivilDate(row.originalGiftOn)));
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
      initiativeIds: new Map([...includedMembers].map(([partnerId, ids]) => [partnerId, [...ids].sort(compareIdentifiers)])),
      givingCurrencies,
      lastReceivedOn,
      givingPermitted,
      giving,
      givingPartition,
      today: resolvedToday.date,
      timeZone: resolvedToday.zone,
      source: storeSource(),
    },
  };
}
// The facet set, declared once
interface FacetDeclaration {
  readonly id: PartnerFacetId;
  readonly multi: boolean;
  readonly requires: "roster" | "giving";
  readonly values: (facts: RosterFacts) => FacetOutcome;
  readonly matches: (record: PartnerRecord, value: string, facts: RosterFacts) => boolean;
}
function closedValues(labels: Readonly<Record<string, string>>, ids: readonly string[]): FacetOutcome {
  return {
    kind: "values",
    values: ids.map((id) => ({ id, label: labels[id] ?? id })),
  };
}
function openValues(values: readonly string[]): FacetOutcome {
  const distinct = [...new Set(values)].sort(compareIdentifiers);
  return { kind: "values", values: distinct.map((value) => ({ id: value, label: value })) };
}
function contactKindsOf(record: PartnerRecord): readonly ContactMethodKind[] {
  const kinds: ContactMethodKind[] = [];
  for (const method of record.contactMethods) {
    if (method.permitted && !kinds.includes(method.kind)) {
      kinds.push(method.kind);
    }
  }
  return kinds;
}
function hasPermittedPostalValue(record: PartnerRecord, value: string): boolean {
  return record.contactMethods.some((method) => method.kind === "postal" && method.permitted && method.value === value);
}
function hasPermittedContact(record: PartnerRecord): boolean {
  return record.contactMethods.some((method) => method.permitted);
}
function taskFactsOrNone(facts: RosterFacts, partnerId: string): TaskFacts {
  return facts.taskFacts.get(partnerId) ?? { open: 0, overdue: 0, undated: 0 };
}
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
function flatMapPartners(records: readonly PartnerRecord[], pick: (record: PartnerRecord) => readonly string[]): readonly string[] {
  const values: string[] = [];
  for (const record of records) {
    values.push(...pick(record));
  }
  return values;
}
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
    values: (facts) => openValues(facts.partners.map((record) => record.stage).filter((stage): stage is string => stage !== null)),
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
    matches: (record, value, facts) => (facts.initiativeIds.get(record.partnerId) ?? []).includes(value),
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
    values: () => closedValues(CONTACT_METHOD_AVAILABILITY_LABELS, ["any-permitted", "none-permitted"]),
    matches: (record, value) => hasPermittedContact(record) === (value === "any-permitted"),
  },
  {
    id: "geography",
    multi: true,
    requires: "roster",
    values: (facts) => openValues(flatMapPartners(facts.partners, (record) => record.contactMethods.filter((method) => method.kind === "postal" && method.permitted).map((method) => method.value))),
    matches: (record, value) => hasPermittedPostalValue(record, value),
  },
  {
    id: "recent-activity",
    multi: false,
    requires: "roster",
    values: () => closedValues(ACTIVITY_LABELS, ["recorded", "none-recorded"]),
    matches: (record, value, facts) => facts.lastActivity.has(record.partnerId) === (value === "recorded"),
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
    matches: (record, value, facts) => facts.lastReceivedOn.has(record.partnerId) === (value === "recorded"),
  },
  {
    id: "giving-total",
    multi: false,
    requires: "giving",
    values: (facts) => (facts.giving.kind === "ready" ? openValues(facts.givingPartition) : { kind: "unavailable", reason: facts.giving.reason }),
    matches: (record, value, facts) => (facts.givingCurrencies.get(record.partnerId) ?? []).includes(value),
  },
  {
    id: "commitment-status",
    multi: false,
    requires: "giving",
    values: () => ({ kind: "not-applicable", reason: NO_PARTNER_ATTRIBUTION }),
    matches: () => false,
  },
];
function facetOutcomeOf(declaration: FacetDeclaration, facts: RosterFacts): FacetOutcome {
  if (declaration.requires === "giving" && facts.giving.kind === "unavailable") {
    return { kind: "unavailable", reason: facts.giving.reason };
  }
  return declaration.values(facts);
}
function countOf(declaration: FacetDeclaration, value: string, facts: RosterFacts): number {
  let count = 0;
  for (const record of facts.partners) {
    if (declaration.matches(record, value, facts)) {
      count += 1;
    }
  }
  return count;
}
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
    const countUnknown = declaration.requires === "giving" && facts.giving.kind === "ready" && facts.giving.snapshot.coverage.state === "unknown";
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
interface AppliedFacet {
  readonly declaration: FacetDeclaration;
  readonly values: readonly string[];
}
interface AppliedSelection {
  readonly filters: readonly AppliedFacet[];
  readonly applied: Readonly<Record<string, readonly string[]>>;
}
function appliedSelectionOf(facts: RosterFacts, applied: PartnerRosterQuery["applied"]): AppliedSelection {
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
function matchesFilters(record: PartnerRecord, filters: readonly AppliedFacet[], facts: RosterFacts): boolean {
  for (const filter of filters) {
    if (!filter.values.some((value) => filter.declaration.matches(record, value, facts))) {
      return false;
    }
  }
  return true;
}
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
function sortKeyOf(field: PartnerSortField, record: PartnerRecord, facts: RosterFacts): string | undefined {
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
function compareRecords(left: PartnerRecord, right: PartnerRecord, query: PartnerRosterQuery, facts: RosterFacts): number {
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
// Building the answer
const RECORD_SET_COVERAGE: Coverage = { from: null, to: null, state: "complete" };

interface EnvelopeSubject<C extends Coverage> {
  readonly coverage: C;
  readonly valueStates: Readonly<Record<string, RecordedValueState>>;
  readonly actions: readonly ReadAction[];
}
function envelopeOf<T, C extends Coverage = Coverage>(context: PartnerReadContext, data: T, revision: string, subject: EnvelopeSubject<C>): ReadResult<ReadEnvelope<T, C>> {
  return {
    kind: "envelope",
    envelope: buildEnvelope<T, C>({
      data,
      scope: context.scope,
      source: storeSource(),
      revision,
      asOf: sessionInstant(context.session).toString(),
      coverage: subject.coverage,
      valueStates: subject.valueStates,
      actions: subject.actions,
    }),
  };
}
function rosterRevisionOf(context: PartnerReadContext, partners: readonly StoredPartnerRecord[]): string {
  const parts = [`context@${context.document.context.revision}`, ...partners.map((record) => `${record.partnerId}@${record.revision}`)].sort(compareIdentifiers);
  let hash = 0x811c9dc5;
  for (const part of parts) {
    for (const character of `${part}\u001f`) {
      hash ^= character.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return `roster-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
function refusalOf<T>(refusal: DeniedOutcome | UnavailableOutcome): ReadResult<T> {
  return refusal.outcome === "denied" ? { kind: "denied", denied: refusal } : { kind: "unavailable", unavailable: refusal };
}
function countState(count: number): RecordedValueState {
  return count > 0 ? "value" : "zero";
}
function facetValueStatesOf(facets: readonly PartnerFacet[]): Record<string, RecordedValueState> {
  const valueStates: Record<string, RecordedValueState> = {};
  for (const facet of facets) {
    for (const option of facet.options) {
      valueStates[`facets.${facet.id}.${option.id}.count`] = countState(option.count);
    }
  }
  return valueStates;
}
function dayState(day: string | null): RecordedValueState {
  return day === null ? "zero" : "value";
}
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
function storedRowWithin(row: GiftRowRecord, period: { readonly from: CivilDate; readonly to: CivilDate }): boolean {
  const day = row.originalGiftOn;
  if (day === null) {
    return false;
  }
  const from = serialiseCivilDate(period.from);
  const to = serialiseCivilDate(period.to);
  return day >= from && day <= to;
}
function currenciesOfPartner(snapshot: GivingSnapshot, partnerId: string): readonly string[] {
  const currencies: string[] = [];
  for (const row of giftRowsOfPartner(snapshot, partnerId)) {
    if (rowWithin(row, snapshot.period) && !currencies.includes(row.amount.currency)) {
      currencies.push(row.amount.currency);
    }
  }
  return currencies.sort(compareIdentifiers);
}
function rowOf(record: StoredPartnerRecord, facts: RosterFacts, position: number, valueStates: Record<string, RecordedValueState>): PartnerRosterRow {
  const tasks = taskFactsOrNone(facts, record.partnerId);
  const lastActivityOn = facts.lastActivity.get(record.partnerId) ?? null;
  const prefix = `rows.${position}`;
  valueStates[`${prefix}.openTaskCount`] = countState(tasks.open);
  valueStates[`${prefix}.overdueTaskCount`] = countState(tasks.overdue);
  valueStates[`${prefix}.undatedTaskCount`] = countState(tasks.undated);
  valueStates[`${prefix}.lastActivityOn`] = dayState(lastActivityOn);
  const row: PartnerRosterRow = {
    partner: project(record, ["partnerId", "kind", "displayName", "tags", "favourite", "stage", "audience", "revision"]),
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
// findPartners: the roster
/** Reads the partner roster and the facet set describing it: the whole authorised set of people, households, churches, organisations and the worker's own preparation, searched, filtered. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function findPartners(query: PartnerRosterQuery = {}, source?: SessionSource): Promise<ReadResult<ReadEnvelope<PartnerRosterPage>>> {
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
// readFacets: the filter set the caller may use
/** Reads the roster's facet set: every filter the caller may use, with the values it admits and the whole-result count of records carrying each. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readFacets(query: PartnerGivingSelection = {}, source?: SessionSource): Promise<ReadResult<ReadEnvelope<readonly PartnerFacet[]>>> {
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
// readSavedViews: the caller's stored choices, with the drift they now carry
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
/** Reads the saved views the caller owns, each with the drift the current facet set reports. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readSavedViews(source?: SessionSource): Promise<ReadResult<ReadEnvelope<readonly PartnerSavedView[]>>> {
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
        ...(stored.query.columnVisibility === undefined ? {} : { columnVisibility: stored.query.columnVisibility }),
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
// readPartner: the one record body
const ONLY_PREPARATION_ARCHIVED = "Only the worker's own private preparation is archived or restored. A shared operational record is neither, and this action changes nothing on it.";
/** Reads one partner record for the record body: identity, the contact methods this caller may use, restrictions, relationship context, open work and the authorised support history. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readPartner(partnerId: string, query: PartnerGivingSelection = {}, source?: SessionSource): Promise<ReadResult<ReadEnvelope<PartnerDetailData>>> {
  const outcome = await readContext("readPartner", source);
  if (!outcome.ok) {
    return refusalOf(outcome.refusal);
  }
  const { context } = outcome;
  const record = context.document.partners.find((candidate) => candidate.partnerId === partnerId);
  if (record === undefined || !mayReadPartner(context, record)) {
    return refusalOf(refused("no-permission"));
  }
  const openTasks = context.document.tasks.filter((task) => task.partnerId === record.partnerId && (task.status === "open" || task.status === "reopened")).sort(compareTasks);
  // The record's own recorded relationship label, rendered verbatim. Nothing is derived from a name,
  // a household, a church or an organisation: those are other records with their own identifiers.
  const relationshipContext: PartnerRelationship[] = record.stage === null ? [] : [{ label: record.stage }];
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
        if (stored.attribution.kind !== "partner" || stored.attribution.partnerId !== record.partnerId || !storedRowWithin(stored, snapshot.period)) {
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
// readPrivatePreparation: the worker's own preparation and note bodies
/** Which record the private read is about. */
export interface PartnerPrivateQuery {
  readonly partnerId: string;
}
/** Reads the worker's own preparation for one record: the private note bodies it holds and whether the preparation is archived. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readPrivatePreparation(input: PartnerPrivateQuery, source?: SessionSource): Promise<ReadResult<ReadEnvelope<PartnerPrivateData>>> {
  const outcome = await readContext("readPrivatePreparation", source);
  if (!outcome.ok) {
    return refusalOf(outcome.refusal);
  }
  const { context } = outcome;
  const record = context.document.partners.find((candidate) => candidate.partnerId === input.partnerId);
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
  const preparation = record.kind === "private-preparation" ? { partnerId: record.partnerId, archived: record.archived === true } : undefined;
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
// readInteractions: what actually happened
/** What one activity read may narrow to and how much of it it returns. */
export interface PartnerInteractionsQuery {
  readonly partnerId?: string;
  readonly page?: { readonly index: number; readonly size?: number };
}
/** One page of recorded activity. */
export interface PartnerInteractionPage {
  readonly interactions: readonly InteractionRecord[];
  readonly total: number;
  readonly page: { readonly index: number; readonly size: number; readonly totalPages: number };
}
/** Reads recorded activity: the interactions that actually happened, newest first. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readInteractions(query: PartnerInteractionsQuery = {}, source?: SessionSource): Promise<ReadResult<ReadEnvelope<PartnerInteractionPage>>> {
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
    const record = context.document.partners.find((candidate) => candidate.partnerId === query.partnerId);
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
    visible.push(interaction.note === null || interaction.note.audience === "shared" ? interaction : { ...interaction, note: null });
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
    valueStates[`rows.${position}.occurredOn`] = interaction.precision === "unknown" ? "unknown" : "value";
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
