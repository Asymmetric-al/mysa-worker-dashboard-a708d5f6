import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { compareCodeUnits } from "@/lib/ordering";
import type { SourceReference } from "@/lib/ids";
import { failureFor, failurePlanOfDocument } from "@/modules/dev-runtime/failures";
import { isScenarioId, scenarioFlagsFor } from "@/modules/dev-runtime/scenario";
import { minorUnitsOf } from "@/modules/money/amount";
import { SUPPORT_BASIS, type GiftRow, type SupportProjection } from "@/modules/support/basis";
import { PAGE_SIZE_CAP, clampPageSize, runReport, type CurrencySummary, type PeriodState, type ReportPeriod, type ReportScope } from "@/modules/support/report";
import { instantAt } from "@/modules/time/clock";
import { serialiseCivilDate, todayInZone, type CivilDate } from "@/modules/time/civil";
import { REFERRAL_SOURCE_ZONE } from "@/modules/time/window";
import { canView, type AuthorizationTarget, type ResolvedSession, type SessionSource } from "../authorize";
import { commitmentRowRecordSchema, coverageSchema, giftRowRecordSchema, initiativeMemberRecordSchema, initiativeRecordSchema, interactionRecordSchema, partnerRecordSchema, principalIdSchema, privateNoteRecordSchema, project, recordRevisionSchema, referralCycleRecordSchema } from "../envelope";
import { sessionContextRecordSchema, supportProjectionRecordSchema, taskRecordSchema } from "../envelope";
import type { ContactMethodKind, Coverage, GiftRowRecord, InitiativeRecord, InteractionRecord, PartnerKind, PartnerRecord, PrivateNoteRecord, ReadAction, ReadEnvelope, RecordedValueState, ReferralCycleRecord, Scope, SupportProjectionRecord, TaskRecord, ValueState } from "../envelope";
import { LOCAL_STORE_SYSTEM, type ReadResult } from "../outcome";
import { answerOf, cachedDecoder, civilDateOf, commitmentRowsOf, countState, deniedRead, giftRowsOf, hashedRevision, mergedCoverage, openRead, readStoreDocument, recordedStateOf, sourceUnavailableRead, knownExponentsOf } from "./frame";
const PARTNERS_SOURCE_REFERENCE = "partners";
const ROSTER_DEFAULT_TIME_ZONE = "UTC";
export const PARTNER_FACET_IDS = ["contact-type", "preparation-state", "tag", "favourite", "relationship-label", "initiative-membership", "referral-status", "contact-method-availability", "geography", "recent-activity", "task-state", "last-received-gift-date", "giving-total", "commitment-status"] as const;
export type PartnerFacetId = (typeof PARTNER_FACET_IDS)[number];
export const PARTNER_REFERRAL_STATUSES = ["active", "incomplete-date", "expired"] as const;
export type PartnerReferralStatus = (typeof PARTNER_REFERRAL_STATUSES)[number];
export const PARTNER_SORT_FIELDS = ["displayName", "kind", "stage", "favourite", "lastActivityOn"] as const;
export type PartnerSortField = (typeof PARTNER_SORT_FIELDS)[number];
export const PARTNER_SORT_DIRECTIONS = ["asc", "desc"] as const;
export type PartnerSortDirection = (typeof PARTNER_SORT_DIRECTIONS)[number];
export const PARTNER_ROSTER_COLUMNS = ["displayName", "kind", "stage", "tags", "favourite", "contactMethods", "lastActivity", "openTasks", "referralStatus", "giving"] as const;
const CONTACT_TYPE_LABELS: Readonly<Record<PartnerKind, string>> = { person: "Person", household: "Household", church: "Church", organization: "Organization", "private-preparation": "Private preparation" };
const FAVOURITE_LABELS: Readonly<Record<"favourite" | "not-favourite", string>> = { favourite: "Favourites only", "not-favourite": "Not a favourite" };
// An archived preparation is one value of the preparation-state facet rather than a facet of its own: the archive takes the record out of the working list, and this is the value that names where it went.
const ARCHIVED_PREPARATION = "archived" as const;
const PREPARATION_LABELS: Readonly<Record<"private" | "shared" | typeof ARCHIVED_PREPARATION, string>> = { private: "Private record", shared: "Shared record", [ARCHIVED_PREPARATION]: "Archived record" };
const REFERRAL_STATUS_LABELS: Readonly<Record<PartnerReferralStatus, string>> = { active: "Active", "incomplete-date": "Date incomplete", expired: "Expired" };
const CONTACT_METHOD_AVAILABILITY_LABELS: Readonly<Record<"any-permitted" | "none-permitted", string>> = { "any-permitted": "Has a permitted contact method", "none-permitted": "No permitted contact method" };
const ACTIVITY_LABELS: Readonly<Record<"recorded" | "none-recorded", string>> = { recorded: "Activity recorded", "none-recorded": "No activity recorded" };
const TASK_STATE_LABELS: Readonly<Record<"open" | "overdue" | "no-date", string>> = { open: "Open task", overdue: "Overdue task", "no-date": "Task without a due date" };
const GIVING_PRESENCE_LABELS: Readonly<Record<"recorded" | "none-recorded", string>> = { recorded: "A gift is recorded", "none-recorded": "No gift is recorded" };
/** Whether one stored record is an archived private preparation: the roster is a working list, and an archived preparation is its one deliberate omission. */ const isArchivedPreparation = (record: StoredPartnerRecord): boolean => record.archived === true;
const NO_STATED_CAPABILITIES: readonly string[] = Object.freeze([]);
const STORE_UNAVAILABLE_GUIDANCE = "This session's records could not be read, so no list, count or amount is shown rather than an empty one. Retry the read; if it keeps failing, reset the seeded development data.";
const CALENDAR_SOURCE: SourceReference = { system: "time-zone-database", reference: "calendar" };
const CALENDAR_UNAVAILABLE_GUIDANCE =
  "No date in this roster was judged in an assumed time zone, so no overdue count, last-activity day or last-received-gift day is shown rather than one computed in a calendar you did not ask for. Choose a time zone this runtime resolves in Settings, or omit the zone and the read uses UTC, and read the roster again.";
const NO_PARTNER_ATTRIBUTION = "The source states this fact for the support subject and attributes it to no partner, so the roster cannot narrow by it. It is shown here rather than offered as a filter that would match nothing.";
const NO_SUPPORT_PROJECTION = "The source states no support projection for this subject, so no giving value can be offered or counted.";
const GIVING_UNAVAILABLE_WITHOUT_PERMISSION = "This context does not admit the support facts of the record set, so no giving value is offered here.";
const FINANCIAL_SOURCE_UNAVAILABLE = "The financial source behind this section is reported unavailable for this session, so no figure is stated here. Contact details, activity and work stay readable.";
const GIVING_OUTAGE_GUIDANCE = "Read this section again once the source is back: its figures are unavailable rather than absent, and an unavailable figure is never a zero.";
export type PartnerFacetValue = { readonly id: string; readonly label: string; readonly count: number; readonly countState: ValueState };
export type PartnerFacetState = "available" | "unavailable";
export type PartnerFacet = { readonly id: PartnerFacetId; readonly labelKey: PartnerFacetId; readonly operator: "OR"; readonly multi: boolean; readonly state: PartnerFacetState; readonly options: readonly PartnerFacetValue[]; readonly disabledReason?: string; readonly source?: SourceReference };
export type PartnerGivingSelection = { readonly currency?: string; readonly period?: { readonly from: string; readonly to: string }; readonly timeZone?: string };
export type PartnerRosterQuery = PartnerGivingSelection & { readonly search?: string; readonly applied?: Readonly<Record<string, readonly string[]>>; readonly sort?: { readonly field: PartnerSortField; readonly direction: PartnerSortDirection }; readonly page?: { readonly index: number; readonly size?: number } };
export type PartnerRosterRecord = Pick<StoredPartnerRecord, "partnerId" | "kind" | "displayName" | "tags" | "favourite" | "stage" | "audience" | "revision"> & { readonly archived: boolean };
export type PartnerRosterGivingScope = { readonly periodLabel: string; readonly coverage: Coverage; readonly currencies: readonly string[] };
export type PartnerRosterRow = { readonly partner: PartnerRosterRecord; readonly contactMethodKinds: readonly ContactMethodKind[]; readonly initiativeIds: readonly string[] } & { readonly referralStatus: PartnerReferralStatus | null; readonly openTaskCount: number; readonly overdueTaskCount: number } & {
  readonly undatedTaskCount: number;
  readonly lastActivityOn: string | null;
  readonly givingCurrencies?: readonly string[];
} & { readonly lastReceivedOn?: string | null };
export type PartnerUnappliedFacet = { readonly facet: string; readonly values: readonly string[]; readonly reason: string };
export interface PartnerRosterPage {
  readonly rows: readonly PartnerRosterRow[];
  readonly total: number;
  readonly page: { readonly index: number; readonly size: number; readonly totalPages: number };
  readonly timeZone: string;
  readonly giving?: PartnerRosterGivingScope;
  readonly applied: Readonly<Record<string, readonly string[]>>;
  readonly unappliedFacets: readonly PartnerUnappliedFacet[];
  readonly appliedSearch: string | null;
  readonly appliedPeriod: { readonly from: string; readonly to: string } | null;
  readonly facets: readonly PartnerFacet[];
}
export type PartnerSavedViewQuery = { readonly search: string; readonly applied: Readonly<Record<string, readonly string[]>>; readonly columnVisibility?: Readonly<Record<string, boolean>>; readonly sort?: { readonly field: string; readonly direction: PartnerSortDirection }; readonly pageSize?: number };
export type PartnerSavedViewDrift = { readonly drifted: boolean; readonly missing: readonly string[] };
export type PartnerSavedView = { readonly id: string; readonly name: string; readonly query: PartnerSavedViewQuery; readonly ownerPrincipalId: string; readonly revision: string; readonly drift: PartnerSavedViewDrift };
export type PartnerRelationship = { readonly label: string; readonly counterpart?: { readonly partnerId: string; readonly kind: PartnerKind; readonly displayName: string; readonly href?: string }; readonly detail?: string };
export type PartnerSupportFigure = { readonly path: string; readonly label: string; readonly amount: GiftRowRecord["amount"]; readonly href?: string };
export type PartnerSupportGift = { readonly gift: GiftRowRecord; readonly amountPath: string };
export interface PartnerSupportHistory {
  readonly basis: string;
  readonly periodLabel?: string;
  readonly figures: readonly PartnerSupportFigure[];
  readonly gifts?: readonly PartnerSupportGift[];
  readonly ledgerHref?: string;
  readonly outage?: { readonly system: string; readonly reference: string; readonly guidance: string };
}
// The accepted source zone an introduction recorded against this record is read in: the referral window rules own the value, and the surface that records an introduction states the zone from this read rather than choosing one of its own.
export type PartnerDetailData = { readonly partner: PartnerRecord; readonly relationshipContext: readonly PartnerRelationship[]; readonly openTasks: readonly TaskRecord[]; readonly supportHistory?: PartnerSupportHistory } & { readonly referralSourceZone: string };
export type PartnerPrivateData = { readonly notes: readonly PrivateNoteRecord[]; readonly preparation?: { readonly partnerId: string; readonly archived: boolean } };
type FacetValueCandidate = { readonly id: string; readonly label: string };
type FacetOutcome = { readonly kind: "values"; readonly values: readonly FacetValueCandidate[] } | { readonly kind: "unavailable"; readonly reason: string } | { readonly kind: "not-applicable"; readonly reason: string };
const storedPartnerRecordSchema = partnerRecordSchema.and(z.object({ archived: z.boolean().optional() }));
type StoredPartnerRecord = z.infer<typeof storedPartnerRecordSchema>;
const storedSavedViewSchema = z.object({
  viewId: z.string().min(1),
  name: z.string().min(1),
  query: z.object({
    search: z.string(),
    applied: z.record(z.string().min(1), z.array(z.string().min(1))),
    columnVisibility: z.record(z.string().min(1), z.boolean()).optional(),
    sort: z.object({ field: z.string().min(1), direction: z.enum(PARTNER_SORT_DIRECTIONS) }).optional(),
    pageSize: z.int().min(1).max(PAGE_SIZE_CAP).optional(),
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
// The generated workload document, decoded by the schemas the seeded document is already read with: its header states the coverage and the currencies its gift rows were generated over, and its partner half is the published roster this read admits under the same scope rules as the seed's own records. A session holding no workload document states nothing here and every read answers what it answered before the workload existed.
const workloadDocumentSchema = z.object({ header: z.object({ coverage: coverageSchema, currencies: z.array(z.string().min(1)) }).optional(), partners: z.array(storedPartnerRecordSchema), gifts: z.array(giftRowRecordSchema) });
type WorkloadDocument = z.infer<typeof workloadDocumentSchema>;
// One validation per document object, so a read that asks for the workload's partners and its gifts decodes neither twice on the same bytes.
const validatedWorkload = cachedDecoder(workloadDocumentSchema);
interface PartnerReadContext {
  readonly session: ResolvedSession;
  readonly scope: Scope;
  readonly document: PartnerStateDocument;
  /** The session's generated workload, or nothing where this session holds none: decoded once, then read by every partner read of the same request. */ readonly workload: WorkloadDocument | undefined;
}
type ContextOutcome = { readonly ok: true; readonly context: PartnerReadContext } | { readonly ok: false; readonly result: ReadResult<never> };
const PARTNER_SOURCE: SourceReference = Object.freeze({ system: LOCAL_STORE_SYSTEM, reference: PARTNERS_SOURCE_REFERENCE });
async function readContext(job: string, source?: SessionSource): Promise<ContextOutcome> {
  const opened = await openRead({ job, source, unselectedReason: "not-admitted", sessionFaultReason: "session-unavailable" });
  if (!opened.ok) return { ok: false, result: opened.result };
  const stored = await readStoreDocument({ session: opened.session, job, source: PARTNER_SOURCE, guidance: STORE_UNAVAILABLE_GUIDANCE });
  if (!stored.ok) return { ok: false, result: stored.result };
  if (failureFor(failurePlanOfDocument(stored.documents.meta), "read", job) === "denied") return { ok: false, result: deniedRead("no-permission") };
  const parsed = partnerStateDocumentSchema.safeParse(stored.documents.state);
  if (!parsed.success) return { ok: false, result: sourceUnavailableRead({ job, source: PARTNER_SOURCE, guidance: STORE_UNAVAILABLE_GUIDANCE }) };
  // A workload document this session holds but cannot decode refuses the read outright: the partner half of the roster would otherwise be answered as the whole of it.
  const workload = validatedWorkload(stored.documents.workload);
  if (stored.documents.workload !== undefined && !workload.success) return { ok: false, result: sourceUnavailableRead({ job, source: PARTNER_SOURCE, guidance: STORE_UNAVAILABLE_GUIDANCE }) };
  return { ok: true, context: { session: opened.session, scope: opened.scope, document: parsed.data, workload: workload.success ? workload.data : undefined } };
}
function mayReadPartner(context: PartnerReadContext, record: PartnerRecord): boolean {
  const target: AuthorizationTarget = { kind: "partner", scope: context.scope, audience: record.audience, authorPrincipalId: record.audience === "private" ? context.document.context.principalId : null };
  return canView(context.session, target).allowed;
}
/** Every record this module enumerates: the seeded document's own records, then the generated workload's partners it does not already state, each still to be admitted by the scope check. */ function partnerRecordsOf(context: PartnerReadContext): readonly StoredPartnerRecord[] {
  const workload = context.workload?.partners ?? [];
  if (workload.length === 0) return context.document.partners;
  const stated = new Set(context.document.partners.map((record) => record.partnerId));
  return [...context.document.partners, ...workload.filter((record) => !stated.has(record.partnerId))];
}
/** One record by its identifier: the seeded document answers first for the ids it states and the generated workload for the rest, so an interaction, an activity filter and a private preparation all resolve a workload partner exactly as they resolve a seeded one. */
const partnerRecordOf = (context: PartnerReadContext, partnerId: string): StoredPartnerRecord | undefined => context.document.partners.find((candidate) => candidate.partnerId === partnerId) ?? context.workload?.partners.find((candidate) => candidate.partnerId === partnerId);
const mayReadGiving = (context: PartnerReadContext): boolean => canView(context.session, { kind: "support-subject", scope: context.scope, capabilities: NO_STATED_CAPABILITIES }).allowed;
const sessionInstant = (session: ResolvedSession): Temporal.Instant => instantAt(session.clockOffsetMs);
function zoneOf(timeZone: string | undefined): string {
  const stated = timeZone === undefined ? "" : timeZone.trim();
  return stated === "" ? ROSTER_DEFAULT_TIME_ZONE : stated;
}
type GivingFacts = { readonly record: SupportProjectionRecord; readonly commitments: SupportProjection["commitments"] };
function givingFactsOf(context: PartnerReadContext): GivingFacts | undefined {
  const record = context.document.supportProjection;
  const commitments = record === null ? undefined : commitmentRowsOf(context.document.commitments);
  return record === null || commitments === undefined ? undefined : { record, commitments };
}
/** Every gift row the session holds: the seeded document's own rows, then the generated workload's rows it does not already state, so a workload partner's support history is reported over the same rows the giving ledger reports. */ function giftRecordsOf(context: PartnerReadContext): readonly GiftRowRecord[] {
  const workload = context.workload?.gifts ?? [];
  if (workload.length === 0) return context.document.gifts;
  const stated = new Set(context.document.gifts.map((row) => row.giftRowId));
  return [...context.document.gifts, ...workload.filter((row) => !stated.has(row.giftRowId))];
}
type MergedGiving = { readonly records: readonly GiftRowRecord[]; readonly rows: readonly GiftRow[]; readonly projection: SupportProjection };
const mergedGiving = new WeakMap<object, Map<string, MergedGiving>>();
/** The stored records, their conversion and the one projection these reads state figures from: the seeded record's own projection with the workload header's coverage and currency exponents merged over it as `reads/support.ts` merges them. */
function statedGiving(facts: GivingFacts, records: readonly GiftRowRecord[], rows: readonly GiftRow[], workload: WorkloadDocument | undefined): MergedGiving {
  const header = workload?.header;
  return {
    records,
    rows,
    projection: {
      supportSubjectId: facts.record.supportSubjectId,
      basis: facts.record.basis,
      currencyExponents: header === undefined ? facts.record.currencyExponents : { ...facts.record.currencyExponents, ...knownExponentsOf(header.currencies) },
      coverage: header === undefined ? facts.record.coverage : mergedCoverage(facts.record.coverage, header.coverage),
      asOf: facts.record.asOf,
      lastSourceUpdate: facts.record.lastSourceUpdate,
      source: facts.record.source,
      // The goal is deliberately not carried here: these reads state received support for a record or a currency partition and never goal progress, which belongs to the surface that owns the goal and its capability.
      gifts: rows,
      commitments: facts.commitments,
    },
  };
}
function mergedGivingOf(facts: GivingFacts, context: PartnerReadContext, asOf: string): MergedGiving | undefined {
  const workload = context.workload;
  if (workload === undefined) {
    const records = context.document.gifts;
    const rows = giftRowsOf(records);
    return rows === undefined ? undefined : statedGiving(facts, records, rows, undefined);
  }
  // One merge and one conversion per workload document version, keyed by the support record's revision and the read's as-of instant, so the generated rows are gathered and converted once for every read that shares these bytes while the report aggregation stays per read.
  let remembered = mergedGiving.get(workload);
  if (remembered === undefined) {
    remembered = new Map<string, MergedGiving>();
    mergedGiving.set(workload, remembered);
  }
  const key = `${facts.record.supportSubjectId}|${facts.record.revision}|${asOf}`;
  const cached = remembered.get(key);
  if (cached !== undefined) return cached;
  const records = giftRecordsOf(context);
  const rows = giftRowsOf(records);
  if (rows === undefined) return undefined;
  const built = statedGiving(facts, records, rows, workload);
  remembered.set(key, built);
  return built;
}
type GivingSnapshot = { readonly facts: GivingFacts; readonly records: readonly GiftRowRecord[]; readonly projection: SupportProjection } & { readonly period: { readonly from: CivilDate; readonly to: CivilDate; readonly state: PeriodState }; readonly periodLabel: string } & {
  readonly coverage: Coverage;
  readonly currencies: readonly string[];
};
type GivingOutcome = { readonly kind: "ready"; readonly snapshot: GivingSnapshot } | { readonly kind: "unavailable"; readonly reason: string; readonly outage?: SourceReference };
const GIVING_REPORT_ID = "received-period-and-year-to-date";
const reportScopeOf = (scope: Scope): ReportScope => ({ organizationId: scope.organizationId, ministryId: scope.ministryId, supportSubjectId: scope.supportSubjectId, principalId: scope.principalId });
function givingSnapshotOf(context: PartnerReadContext, selection: PartnerGivingSelection): GivingOutcome {
  const facts = givingFactsOf(context);
  if (facts === undefined) return { kind: "unavailable", reason: NO_SUPPORT_PROJECTION };
  const merged = mergedGivingOf(facts, context, sessionInstant(context.session).toString());
  if (merged === undefined) return { kind: "unavailable", reason: NO_SUPPORT_PROJECTION };
  if (!isScenarioId(context.session.scenarioId) || scenarioFlagsFor(context.session.scenarioId).financialSource === "unavailable") return { kind: "unavailable", reason: FINANCIAL_SOURCE_UNAVAILABLE, outage: facts.record.source };
  const period = reportPeriodOf(selection.period);
  if (period === undefined) return { kind: "unavailable", reason: "The stated period is not two calendar days, so no period is substituted for it and no figure is stated." };
  const projection = merged.projection;
  const zone = zoneOf(selection.timeZone);
  let whole: ReturnType<typeof runReport>;
  try {
    whole = runReport({ reportId: GIVING_REPORT_ID, scope: reportScopeOf(context.scope), period, currency: { kind: "all" }, timeZone: zone }, projection);
  } catch {
    return { kind: "unavailable", reason: NO_SUPPORT_PROJECTION };
  }
  const currencies = whole.summary.map((entry) => entry.currency);
  return {
    kind: "ready",
    snapshot: {
      facts,
      records: merged.records,
      projection,
      period: { from: whole.snapshot.period.from, to: whole.snapshot.period.to, state: whole.snapshot.period.state },
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
  if (period === undefined) return { kind: "preset", preset: "year-to-date" };
  const from = civilDateOf(period.from.trim());
  const to = civilDateOf(period.to.trim());
  return from === undefined || to === undefined ? undefined : Temporal.PlainDate.compare(from, to) > 0 ? undefined : { kind: "explicit", from, to };
}
const giftRowsOfPartner = (snapshot: GivingSnapshot, partnerId: string): readonly GiftRow[] => snapshot.projection.gifts.filter((row) => row.attribution.kind === "partner" && row.attribution.partnerId === partnerId);
function rowWithin(row: GiftRow, period: { readonly from: CivilDate; readonly to: CivilDate }): boolean {
  const day = row.originalGiftOn;
  return day === undefined ? false : Temporal.PlainDate.compare(day, period.from) >= 0 && Temporal.PlainDate.compare(day, period.to) <= 0;
}
type TaskFacts = { readonly open: number; readonly overdue: number; readonly undated: number };
type RosterFacts = { readonly partners: readonly StoredPartnerRecord[]; readonly initiatives: readonly InitiativeRecord[] } & { readonly lastActivity: ReadonlyMap<string, string>; readonly taskFacts: ReadonlyMap<string, TaskFacts> } & {
  readonly referralStatus: ReadonlyMap<string, PartnerReferralStatus>;
  readonly initiativeIds: ReadonlyMap<string, readonly string[]>;
} & { readonly givingCurrencies: ReadonlyMap<string, readonly string[]>; readonly lastReceivedOn: ReadonlyMap<string, string> } & { readonly givingPermitted: boolean; readonly giving: GivingOutcome; readonly givingPartition: readonly string[]; readonly today: CivilDate } & {
  readonly timeZone: string;
  readonly source: SourceReference;
};
type RosterFactsOutcome = { readonly kind: "ready"; readonly facts: RosterFacts } | { readonly kind: "unavailable"; readonly result: ReadResult<never> };
type ResolvedRosterDay = { readonly status: "resolved"; readonly date: CivilDate; readonly zone: string } | { readonly status: "unavailable"; readonly result: ReadResult<never> };
function todayIn(job: string, zone: string, at: Temporal.Instant): ResolvedRosterDay {
  const resolved = todayInZone(zone, at);
  return resolved.status === "resolved" ? { status: "resolved", date: resolved.date, zone } : { status: "unavailable", result: sourceUnavailableRead({ job, source: CALENDAR_SOURCE, guidance: CALENDAR_UNAVAILABLE_GUIDANCE }) };
}
function cycleStatusOf(cycle: ReferralCycleRecord, at: Temporal.Instant): PartnerReferralStatus {
  if (cycle.windowEnd === null) return "incomplete-date";
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
  if (mine.length === 0) return undefined;
  const states = mine.map((cycle) => cycleStatusOf(cycle, at));
  return states.includes("active") ? "active" : states.includes("incomplete-date") ? "incomplete-date" : "expired";
}
function appendTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing === undefined) {
    map.set(key, [value]);
    return;
  }
  if (!existing.includes(value)) existing.push(value);
}
const latestDay = (current: string | undefined, candidate: string): string => (current === undefined ? candidate : candidate > current ? candidate : current);
function rosterFactsOf(job: string, context: PartnerReadContext, selection: PartnerGivingSelection): RosterFactsOutcome {
  const { document } = context;
  const at = sessionInstant(context.session);
  const resolvedToday = todayIn(job, zoneOf(selection.timeZone), at);
  if (resolvedToday.status === "unavailable") return { kind: "unavailable", result: resolvedToday.result };
  const partners = partnerRecordsOf(context).filter((record) => mayReadPartner(context, record));
  const lastActivity = new Map<string, string>();
  for (const interaction of document.interactions) {
    if (interaction.occurredOn === null) continue;
    lastActivity.set(interaction.partnerId, latestDay(lastActivity.get(interaction.partnerId), interaction.occurredOn));
  }
  const taskFacts = new Map<string, TaskFacts>();
  for (const task of document.tasks) {
    const partnerId = task.partnerId;
    if (partnerId === null || (task.status !== "open" && task.status !== "reopened")) continue;
    const current = taskFacts.get(partnerId) ?? { open: 0, overdue: 0, undated: 0 };
    const undated = task.dueOn === null;
    const overdue = task.dueOn !== null && task.dueOn < serialiseCivilDate(resolvedToday.date);
    taskFacts.set(partnerId, { open: current.open + 1, overdue: current.overdue + (overdue ? 1 : 0), undated: current.undated + (undated ? 1 : 0) });
  }
  const referralStatus = new Map<string, PartnerReferralStatus>();
  for (const cycle of document.referrals) {
    const status = referralStatusOf(document.referrals, cycle.partnerId, at);
    if (status !== undefined) referralStatus.set(cycle.partnerId, status);
  }
  const includedMembers = new Map<string, string[]>();
  for (const member of document.initiativeMembers) if (member.state === "included") appendTo(includedMembers, member.partnerId, member.initiativeId);
  const givingPermitted = mayReadGiving(context);
  const giving: GivingOutcome = givingPermitted ? givingSnapshotOf(context, selection) : { kind: "unavailable", reason: GIVING_UNAVAILABLE_WITHOUT_PERMISSION };
  const givingPartition: readonly string[] = giving.kind === "ready" ? givingPartitionOf(giving.snapshot, selection.currency) : [];
  const openCurrencies = new Map<string, string[]>();
  const lastReceivedOn = new Map<string, string>();
  const givingCurrencies = new Map<string, readonly string[]>();
  if (giving.kind === "ready") {
    for (const row of giving.snapshot.projection.gifts) {
      if (row.attribution.kind !== "partner" || row.originalGiftOn === undefined) continue;
      const partnerId = row.attribution.partnerId;
      lastReceivedOn.set(partnerId, latestDay(lastReceivedOn.get(partnerId), serialiseCivilDate(row.originalGiftOn)));
      if (rowWithin(row, giving.snapshot.period) && givingPartition.includes(row.amount.currency)) appendTo(openCurrencies, partnerId, row.amount.currency);
    }
    for (const [partnerId, currencies] of openCurrencies) givingCurrencies.set(partnerId, [...currencies].sort(compareCodeUnits));
  }
  return {
    kind: "ready",
    facts: {
      partners,
      initiatives: document.initiatives,
      lastActivity,
      taskFacts,
      referralStatus,
      initiativeIds: new Map([...includedMembers].map(([partnerId, ids]) => [partnerId, [...ids].sort(compareCodeUnits)])),
      givingCurrencies,
      lastReceivedOn,
      givingPermitted,
      giving,
      givingPartition,
      today: resolvedToday.date,
      timeZone: resolvedToday.zone,
      source: PARTNER_SOURCE,
    },
  };
}
type FacetDeclaration = { readonly id: PartnerFacetId; readonly multi: boolean; readonly requires: "roster" | "giving" } & { readonly values: (facts: RosterFacts) => FacetOutcome } & { readonly matches: (record: StoredPartnerRecord, value: string, facts: RosterFacts) => boolean };
const closedValues =
  (labels: Readonly<Record<string, string>>) =>
  (ids: readonly string[]): FacetOutcome => ({ kind: "values", values: ids.map((id) => ({ id, label: labels[id] ?? id })) });
const openValues = (values: readonly string[]): FacetOutcome => ({ kind: "values", values: [...new Set(values)].sort(compareCodeUnits).map((value) => ({ id: value, label: value })) });
function contactKindsOf(record: PartnerRecord): readonly ContactMethodKind[] {
  const kinds: ContactMethodKind[] = [];
  for (const method of record.contactMethods) if (method.permitted && !kinds.includes(method.kind)) kinds.push(method.kind);
  return kinds;
}
const hasPermittedPostalValue = (record: PartnerRecord, value: string): boolean => record.contactMethods.some((method) => method.kind === "postal" && method.permitted && method.value === value);
const hasPermittedContact = (record: PartnerRecord): boolean => record.contactMethods.some((method) => method.permitted);
const taskFactsOrNone = (facts: RosterFacts, partnerId: string): TaskFacts => facts.taskFacts.get(partnerId) ?? { open: 0, overdue: 0, undated: 0 };
function distinctInOrder<T>(records: readonly T[], pick: (record: T) => string): readonly string[] {
  const values: string[] = [];
  for (const record of records) {
    const value = pick(record);
    if (!values.includes(value)) values.push(value);
  }
  return values;
}
function flatMapPartners(records: readonly PartnerRecord[], pick: (record: PartnerRecord) => readonly string[]): readonly string[] {
  const values: string[] = [];
  for (const record of records) values.push(...pick(record));
  return values;
}
/** Whether one record carries the task state a `task-state` filter names: an open task, an overdue one, or one with no due date at all. */ function taskStateMatches(record: PartnerRecord, value: string, facts: RosterFacts): boolean {
  const counts = taskFactsOrNone(facts, record.partnerId);
  return value === "open" ? counts.open > 0 : value === "overdue" ? counts.overdue > 0 : value === "no-date" ? counts.undated > 0 : false;
}
/** The values the preparation-state facet offers: every audience the authorised records are stated at, then the archived value when at least one of those records is archived. */
const preparationStateValues = (facts: RosterFacts): readonly string[] => [...distinctInOrder(facts.partners, (record) => record.audience), ...(facts.partners.some(isArchivedPreparation) ? [ARCHIVED_PREPARATION] : [])];
/** Whether one record carries the preparation state a `preparation-state` filter names: an archived preparation answers the archived value alone, so the audience value it left counts nothing that the working list does not hold. */
const preparationStateMatches = (record: StoredPartnerRecord, value: string): boolean => (value === ARCHIVED_PREPARATION ? isArchivedPreparation(record) : record.audience === value && !isArchivedPreparation(record));
const PARTNER_FACET_DECLARATIONS: readonly FacetDeclaration[] = [
  { id: "contact-type", multi: true, requires: "roster", values: (facts) => closedValues(CONTACT_TYPE_LABELS)(distinctInOrder(facts.partners, (r) => r.kind)), matches: (record, value) => record.kind === value },
  { id: "preparation-state", multi: false, requires: "roster", values: (facts) => closedValues(PREPARATION_LABELS)(preparationStateValues(facts)), matches: preparationStateMatches },
  { id: "tag", multi: true, requires: "roster", values: (facts) => openValues(flatMapPartners(facts.partners, (record) => record.tags)), matches: (record, value) => record.tags.includes(value) },
  { id: "favourite", multi: false, requires: "roster", values: () => closedValues(FAVOURITE_LABELS)(["favourite", "not-favourite"]), matches: (record, value) => record.favourite === (value === "favourite") },
  { id: "relationship-label", multi: true, requires: "roster", values: (facts) => openValues(facts.partners.map((record) => record.stage).filter((stage): stage is string => stage !== null)), matches: (record, value) => record.stage === value },
  { id: "initiative-membership", multi: true, requires: "roster", values: (facts) => ({ kind: "values", values: facts.initiatives.map((initiative) => ({ id: initiative.initiativeId, label: initiative.name })) }), matches: (record, value, facts) => (facts.initiativeIds.get(record.partnerId) ?? []).includes(value) },
  { id: "referral-status", multi: true, requires: "roster", values: () => closedValues(REFERRAL_STATUS_LABELS)(PARTNER_REFERRAL_STATUSES), matches: (record, value, facts) => facts.referralStatus.get(record.partnerId) === value },
  { id: "contact-method-availability", multi: false, requires: "roster", values: () => closedValues(CONTACT_METHOD_AVAILABILITY_LABELS)(["any-permitted", "none-permitted"]), matches: (record, value) => hasPermittedContact(record) === (value === "any-permitted") },
  { id: "geography", multi: true, requires: "roster", values: (facts) => openValues(flatMapPartners(facts.partners, (record) => record.contactMethods.filter((method) => method.kind === "postal" && method.permitted).map((method) => method.value))), matches: (record, value) => hasPermittedPostalValue(record, value) },
  { id: "recent-activity", multi: false, requires: "roster", values: () => closedValues(ACTIVITY_LABELS)(["recorded", "none-recorded"]), matches: (record, value, facts) => facts.lastActivity.has(record.partnerId) === (value === "recorded") },
  { id: "task-state", multi: true, requires: "roster", values: () => closedValues(TASK_STATE_LABELS)(["open", "overdue", "no-date"]), matches: taskStateMatches },
  { id: "last-received-gift-date", multi: false, requires: "giving", values: () => closedValues(GIVING_PRESENCE_LABELS)(["recorded", "none-recorded"]), matches: (record, value, facts) => facts.lastReceivedOn.has(record.partnerId) === (value === "recorded") },
  { id: "giving-total", multi: false, requires: "giving", values: (facts) => (facts.giving.kind === "ready" ? openValues(facts.givingPartition) : { kind: "unavailable", reason: facts.giving.reason }), matches: (record, value, facts) => (facts.givingCurrencies.get(record.partnerId) ?? []).includes(value) },
  { id: "commitment-status", multi: false, requires: "giving", values: () => ({ kind: "not-applicable", reason: NO_PARTNER_ATTRIBUTION }), matches: () => false },
];
const facetOutcomeOf = (declaration: FacetDeclaration, facts: RosterFacts): FacetOutcome => (declaration.requires === "giving" && facts.giving.kind === "unavailable" ? { kind: "unavailable", reason: facts.giving.reason } : declaration.values(facts));
function countOf(declaration: FacetDeclaration, value: string, facts: RosterFacts): number {
  // Each count describes the working list: an archived preparation is counted by the archived value that names it and by no other value, so no count offers a record the list does not hold.
  let count = 0;
  for (const record of facts.partners) {
    if (isArchivedPreparation(record) && value !== ARCHIVED_PREPARATION) continue;
    if (declaration.matches(record, value, facts)) count += 1;
  }
  return count;
}
function buildFacets(facts: RosterFacts): readonly PartnerFacet[] {
  const facets: PartnerFacet[] = [];
  for (const declaration of PARTNER_FACET_DECLARATIONS) {
    if (declaration.requires === "giving" && !facts.givingPermitted) continue;
    const outcome = facetOutcomeOf(declaration, facts);
    const identity = { id: declaration.id, labelKey: declaration.id, operator: "OR", multi: declaration.multi } as const;
    if (outcome.kind === "unavailable") {
      facets.push({ ...identity, state: "unavailable", options: [], disabledReason: outcome.reason, source: facts.source });
      continue;
    }
    if (outcome.kind === "not-applicable") {
      facets.push({ ...identity, state: "available", options: [], disabledReason: outcome.reason });
      continue;
    }
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
type AppliedFacet = { readonly declaration: FacetDeclaration; readonly values: readonly string[] };
type AppliedSelection = { readonly filters: readonly AppliedFacet[]; readonly applied: Readonly<Record<string, readonly string[]>> } & { readonly unapplied: readonly PartnerUnappliedFacet[] };
function appliedSelectionOf(facts: RosterFacts, applied: PartnerRosterQuery["applied"]): AppliedSelection {
  const filters: AppliedFacet[] = [];
  const echoed: Record<string, readonly string[]> = {};
  const unapplied: PartnerUnappliedFacet[] = [];
  if (applied === undefined) return { filters, applied: echoed, unapplied };
  for (const [facetId, values] of Object.entries(applied)) {
    if (!Array.isArray(values) || values.length === 0) continue;
    const declaration = PARTNER_FACET_DECLARATIONS.find((entry) => entry.id === facetId);
    if (declaration === undefined) {
      unapplied.push({ facet: facetId, values: [...values], reason: `The roster has no filter named ${JSON.stringify(facetId)}, so it was not applied: the filters it offers are ${PARTNER_FACET_IDS.join(", ")}.` });
      continue;
    }
    if (declaration.requires === "giving" && !facts.givingPermitted) {
      unapplied.push({ facet: facetId, values: [...values], reason: GIVING_UNAVAILABLE_WITHOUT_PERMISSION });
      continue;
    }
    const outcome = facetOutcomeOf(declaration, facts);
    if (outcome.kind !== "values") {
      unapplied.push({ facet: facetId, values: [...values], reason: outcome.reason });
      continue;
    }
    const admitted = new Set(outcome.values.map((candidate) => candidate.id));
    const kept: string[] = [];
    const refused: string[] = [];
    for (const value of values) {
      if (typeof value !== "string") continue;
      if (!admitted.has(value)) {
        if (!refused.includes(value)) refused.push(value);
        continue;
      }
      if (!kept.includes(value)) kept.push(value);
    }
    if (refused.length > 0) unapplied.push({ facet: facetId, values: refused, reason: `The ${JSON.stringify(facetId)} filter does not offer this value in this context, so it was not applied and the result is not narrowed by it.` });
    if (kept.length === 0) continue;
    filters.push({ declaration, values: kept });
    echoed[facetId] = kept;
  }
  return { filters, applied: echoed, unapplied };
}
function matchesFilters(record: StoredPartnerRecord, filters: readonly AppliedFacet[], facts: RosterFacts): boolean {
  for (const filter of filters) if (!filter.values.some((value) => filter.declaration.matches(record, value, facts))) return false;
  return true;
}
function matchesSearch(record: PartnerRecord, term: string): boolean {
  const parts: string[] = [record.displayName];
  if (record.nameParts !== null) {
    if (record.nameParts.given !== null) parts.push(record.nameParts.given);
    if (record.nameParts.family !== null) parts.push(record.nameParts.family);
    for (const additional of record.nameParts.additional) parts.push(additional);
  }
  for (const tag of record.tags) parts.push(tag);
  if (record.stage !== null) parts.push(record.stage);
  for (const method of record.contactMethods) if (method.permitted) parts.push(method.value);
  return parts.some((part) => part.toLowerCase().includes(term));
}
const SORT_KEYS: Readonly<Record<PartnerSortField, (record: PartnerRecord, facts: RosterFacts) => string | undefined>> = {
  displayName: (record) => record.displayName,
  kind: (record) => record.kind,
  stage: (record) => record.stage ?? undefined,
  favourite: (record) => (record.favourite ? "1" : "0"),
  lastActivityOn: (record, facts) => facts.lastActivity.get(record.partnerId),
};
const sortKeyOf = (field: PartnerSortField, record: PartnerRecord, facts: RosterFacts): string | undefined => SORT_KEYS[field](record, facts);
function compareRecords(left: PartnerRecord, right: PartnerRecord, query: PartnerRosterQuery, facts: RosterFacts): number {
  const sort = query.sort;
  const tiebreak = compareCodeUnits(left.partnerId, right.partnerId);
  if (sort === undefined) return tiebreak;
  const leftKey = sortKeyOf(sort.field, left, facts);
  const rightKey = sortKeyOf(sort.field, right, facts);
  if (leftKey === undefined || rightKey === undefined) return leftKey === undefined && rightKey === undefined ? tiebreak : leftKey === undefined ? 1 : -1;
  const primary = compareCodeUnits(leftKey, rightKey);
  return primary !== 0 ? (sort.direction === "desc" ? -primary : primary) : tiebreak;
}
const RECORD_SET_COVERAGE: Coverage = { from: null, to: null, state: "complete" };
type EnvelopeSubject<C extends Coverage> = { readonly coverage: C; readonly valueStates: Readonly<Record<string, RecordedValueState>>; readonly actions: readonly ReadAction[] };
const envelopeOf = <T, C extends Coverage = Coverage>(context: PartnerReadContext, data: T, revision: string, subject: EnvelopeSubject<C>): ReadResult<ReadEnvelope<T, C>> =>
  answerOf(context.scope, sessionInstant(context.session).toString(), { data, source: PARTNER_SOURCE, revision, coverage: subject.coverage, valueStates: subject.valueStates, actions: subject.actions });
const rosterRevisionOf = (context: PartnerReadContext, partners: readonly StoredPartnerRecord[]): string => hashedRevision("roster", [`context@${context.document.context.revision}`, ...partners.map((record) => `${record.partnerId}@${record.revision}`)].sort(compareCodeUnits));
function facetValueStatesOf(facets: readonly PartnerFacet[]): Record<string, RecordedValueState> {
  const valueStates: Record<string, RecordedValueState> = {};
  for (const facet of facets) for (const option of facet.options) valueStates[`facets.${facet.id}.${option.id}.count`] = countState(option.count);
  return valueStates;
}
const dayState = (day: string | null): RecordedValueState => (day === null ? "zero" : "value");
const givingStateOf = (giving: GivingOutcome, recorded: RecordedValueState): RecordedValueState => (giving.kind === "ready" ? recorded : giving.outage === undefined ? "unknown" : "unavailable");
function compareTasks(left: TaskRecord, right: TaskRecord): number {
  const leftDue = left.dueOn;
  const rightDue = right.dueOn;
  if (leftDue !== rightDue) return leftDue === null ? 1 : rightDue === null ? -1 : compareCodeUnits(leftDue, rightDue);
  const byTitle = compareCodeUnits(left.title, right.title);
  return byTitle !== 0 ? byTitle : compareCodeUnits(left.taskId, right.taskId);
}
const compareInteractions = (left: InteractionRecord, right: InteractionRecord): number => (left.occurredOn !== right.occurredOn ? (left.occurredOn === null ? 1 : right.occurredOn === null ? -1 : compareCodeUnits(right.occurredOn, left.occurredOn)) : compareCodeUnits(left.interactionId, right.interactionId));
function storedRowWithin(row: GiftRowRecord, period: { readonly from: CivilDate; readonly to: CivilDate }): boolean {
  const day = row.originalGiftOn;
  if (day === null) return false;
  const from = serialiseCivilDate(period.from);
  const to = serialiseCivilDate(period.to);
  return day >= from && day <= to;
}
function currenciesOfPartner(snapshot: GivingSnapshot, partnerId: string): readonly string[] {
  const currencies: string[] = [];
  for (const row of giftRowsOfPartner(snapshot, partnerId)) if (rowWithin(row, snapshot.period) && !currencies.includes(row.amount.currency)) currencies.push(row.amount.currency);
  return currencies.sort(compareCodeUnits);
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
    partner: { ...project(record, ["partnerId", "kind", "displayName", "tags", "favourite", "stage", "audience", "revision"]), archived: record.archived === true },
    contactMethodKinds: contactKindsOf(record),
    initiativeIds: facts.initiativeIds.get(record.partnerId) ?? [],
    referralStatus: facts.referralStatus.get(record.partnerId) ?? null,
    openTaskCount: tasks.open,
    overdueTaskCount: tasks.overdue,
    undatedTaskCount: tasks.undated,
    lastActivityOn,
  };
  if (!facts.givingPermitted) return row;
  const lastReceivedOn = facts.lastReceivedOn.get(record.partnerId) ?? null;
  const givingCurrencies = facts.givingCurrencies.get(record.partnerId) ?? [];
  valueStates[`${prefix}.lastReceivedOn`] = givingStateOf(facts.giving, dayState(lastReceivedOn));
  valueStates[`${prefix}.givingCurrencies`] = givingStateOf(facts.giving, countState(givingCurrencies.length));
  return { ...row, lastReceivedOn, givingCurrencies };
}
/** Reads the partner roster and the facet set describing it: the whole authorised set of people, households, churches, organisations and the worker's own preparation, searched, filtered, and reporting by name every facet expression it could not apply. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function findPartners(query: PartnerRosterQuery = {}, source?: SessionSource): Promise<ReadResult<ReadEnvelope<PartnerRosterPage>>> {
  const outcome = await readContext("findPartners", source);
  if (!outcome.ok) return outcome.result;
  const { context } = outcome;
  const factsOutcome = rosterFactsOf("findPartners", context, query);
  if (factsOutcome.kind !== "ready") return factsOutcome.result;
  const facts = factsOutcome.facts;
  const selection = appliedSelectionOf(facts, query.applied);
  const searchText = (query.search ?? "").trim();
  const term = searchText.toLowerCase();
  const matched: PartnerRecord[] = [];
  // The roster is a working list, so an archived preparation is left out of it unless the applied selection asks for the archived value by name: that value is the only way the archived record stays reachable, which is what keeps its Restore action reachable from the roster.
  const includesArchived = selection.applied["preparation-state"]?.includes(ARCHIVED_PREPARATION) === true;
  for (const record of facts.partners) {
    if (isArchivedPreparation(record) && !includesArchived) continue;
    if (!matchesFilters(record, selection.filters, facts)) continue;
    if (term !== "" && !matchesSearch(record, term)) continue;
    matched.push(record);
  }
  matched.sort((left, right) => compareRecords(left, right, query, facts));
  const size = clampPageSize(query.page?.size);
  const totalPages = Math.max(1, Math.ceil(matched.length / size));
  // The page window describes the rows this read returns, so a requested page past the last one the result holds is served as that last page rather than echoed beside a smaller totalPages, which would state a page the answer does not have. The total stays the whole result's count: an offset that moved it would let a caller measure what it cannot see.
  const requested = query.page?.index ?? 0;
  const index = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, totalPages - 1) : 0;
  const window = matched.slice(index * size, index * size + size);
  const valueStates: Record<string, RecordedValueState> = { total: countState(matched.length) };
  const rows = window.map((record, position) => rowOf(record, facts, position, valueStates));
  const facets = buildFacets(facts);
  Object.assign(valueStates, facetValueStatesOf(facets));
  const giving = facts.givingPermitted && facts.giving.kind === "ready" ? { periodLabel: facts.giving.snapshot.periodLabel, coverage: facts.giving.snapshot.coverage, currencies: facts.givingPartition } : undefined;
  const appliedPeriod = query.period !== undefined && facts.giving.kind === "ready" ? { from: serialiseCivilDate(facts.giving.snapshot.period.from), to: serialiseCivilDate(facts.giving.snapshot.period.to) } : null;
  const data: PartnerRosterPage = { rows, total: matched.length, page: { index, size, totalPages }, timeZone: facts.timeZone, ...(giving === undefined ? {} : { giving }), applied: selection.applied, unappliedFacets: selection.unapplied, appliedSearch: searchText === "" ? null : searchText, appliedPeriod, facets };
  const actions = [
    { name: "createPrivatePreparation", available: true },
    { name: "setFavourite", available: true },
    { name: "setTag", available: true },
    { name: "saveView", available: true },
  ];
  return envelopeOf(context, data, rosterRevisionOf(context, facts.partners), { coverage: RECORD_SET_COVERAGE, valueStates, actions });
}
/** Reads the roster's facet set: every filter the caller may use, with the values it admits and the whole-result count of records carrying each. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readFacets(query: PartnerGivingSelection = {}, source?: SessionSource): Promise<ReadResult<ReadEnvelope<readonly PartnerFacet[]>>> {
  const outcome = await readContext("readFacets", source);
  if (!outcome.ok) return outcome.result;
  const { context } = outcome;
  const factsOutcome = rosterFactsOf("readFacets", context, query);
  if (factsOutcome.kind !== "ready") return factsOutcome.result;
  const facts = factsOutcome.facts;
  const facets = buildFacets(facts);
  return envelopeOf(context, facets, rosterRevisionOf(context, facts.partners), { coverage: RECORD_SET_COVERAGE, valueStates: facetValueStatesOf(facets), actions: [{ name: "saveView", available: true }] });
}
function driftOf(view: StoredSavedView, facets: readonly PartnerFacet[]): PartnerSavedViewDrift {
  const missing: string[] = [];
  for (const [facetId, values] of Object.entries(view.query.applied)) {
    const facet = facets.find((candidate) => candidate.id === facetId);
    if (facet === undefined || facet.state !== "available" || facet.options.length === 0) {
      missing.push(facetId);
      continue;
    }
    const admittedOptionIds = new Set(facet.options.map((option) => option.id));
    for (const value of values) if (!admittedOptionIds.has(value)) missing.push(`${facetId}: ${value}`);
  }
  const visibility = view.query.columnVisibility;
  if (visibility !== undefined) for (const columnId of Object.keys(visibility)) if (!PARTNER_ROSTER_COLUMNS.some((column) => column === columnId)) missing.push(`column: ${columnId}`);
  return { drifted: missing.length > 0, missing };
}
/** Reads the saved views the caller owns, each with the drift the current facet set reports. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readSavedViews(source?: SessionSource): Promise<ReadResult<ReadEnvelope<readonly PartnerSavedView[]>>> {
  const outcome = await readContext("readSavedViews", source);
  if (!outcome.ok) return outcome.result;
  const { context } = outcome;
  const factsOutcome = rosterFactsOf("readSavedViews", context, {});
  if (factsOutcome.kind !== "ready") return factsOutcome.result;
  const facts = factsOutcome.facts;
  const facets = buildFacets(facts);
  const views: PartnerSavedView[] = [];
  for (const stored of context.document.savedViews) {
    if (stored.ownerPrincipalId !== context.session.principalId) continue;
    views.push({
      id: stored.viewId,
      name: stored.name,
      query: {
        search: stored.query.search,
        applied: stored.query.applied,
        ...(stored.query.columnVisibility === undefined ? {} : { columnVisibility: stored.query.columnVisibility }),
        ...(stored.query.sort === undefined ? {} : { sort: { field: stored.query.sort.field, direction: stored.query.sort.direction } }),
        ...(stored.query.pageSize === undefined ? {} : { pageSize: stored.query.pageSize }),
      },
      ownerPrincipalId: stored.ownerPrincipalId,
      revision: stored.revision,
      drift: driftOf(stored, facets),
    });
  }
  views.sort((left, right) => {
    const byName = compareCodeUnits(left.name, right.name);
    return byName !== 0 ? byName : compareCodeUnits(left.id, right.id);
  });
  return envelopeOf(context, views, context.document.context.revision, { coverage: RECORD_SET_COVERAGE, valueStates: { total: countState(views.length) }, actions: [{ name: "saveView", available: true }] });
}
const ONLY_PREPARATION_ARCHIVED = "Only the worker's own private preparation is archived or restored. A shared operational record is neither, and this action changes nothing on it.";
// An introduction names a shared partner record, so the record's own audience is the whole condition this advisory list states; the command re-checks it and no other referral rule is decided by this read.
const ONLY_SHARED_RECORDS_TAKE_AN_INTRODUCTION = "An introduction is recorded against a shared partner record. This record is the worker's own private preparation, so it carries no introduction.";
/** Reads one partner record for the record body: identity, the contact methods this caller may use, restrictions, relationship context, open work and the authorised support history — stated with the source it could not read when that source is reported unavailable. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readPartner(partnerId: string, query: PartnerGivingSelection = {}, source?: SessionSource): Promise<ReadResult<ReadEnvelope<PartnerDetailData>>> {
  const outcome = await readContext("readPartner", source);
  if (!outcome.ok) return outcome.result;
  const { context } = outcome;
  const record = partnerRecordOf(context, partnerId);
  if (record === undefined || !mayReadPartner(context, record)) return deniedRead("no-permission");
  const openTasks = context.document.tasks.filter((task) => task.partnerId === record.partnerId && (task.status === "open" || task.status === "reopened")).sort(compareTasks);
  const relationshipContext: PartnerRelationship[] = record.stage === null ? [] : [{ label: record.stage }];
  const valueStates: Record<string, RecordedValueState> = {};
  let coverage: Coverage = RECORD_SET_COVERAGE;
  let supportHistory: PartnerSupportHistory | undefined;
  if (mayReadGiving(context)) {
    const giving = givingSnapshotOf(context, query);
    if (giving.kind === "ready") {
      const { snapshot } = giving;
      // One report over this partner's rows states every currency the record gave in, because the engine's `summary` is already grouped by currency; asking it once per currency would run the whole engine again and re-derive the same totals once per currency.
      let perCurrency: readonly CurrencySummary[] = [];
      try {
        perCurrency = runReport(
          { reportId: GIVING_REPORT_ID, scope: reportScopeOf(context.scope), period: { kind: "explicit", from: snapshot.period.from, to: snapshot.period.to }, currency: { kind: "all" }, partner: { kind: "partner", partnerId: record.partnerId } },
          { ...snapshot.projection, gifts: giftRowsOfPartner(snapshot, record.partnerId) },
        ).summary;
      } catch {
        // A record whose rows the engine refuses states no figure at all: every figure carries the engine's own answer, and no total is derived here to stand in for one.
        perCurrency = [];
      }
      const summariesByCurrency = new Map<string, CurrencySummary>();
      for (const entry of perCurrency) summariesByCurrency.set(entry.currency, entry);
      const figures: PartnerSupportFigure[] = [];
      for (const currency of currenciesOfPartner(snapshot, record.partnerId)) {
        const summary = summariesByCurrency.get(currency);
        if (summary === undefined) continue;
        const path = `supportHistory.figures.${currency}.received`;
        valueStates[path] = recordedStateOf(summary.received.valueState);
        figures.push({ path, label: `Received gifts in ${currency}, ${snapshot.periodLabel}`, amount: { currency, minorUnits: summary.received.minorUnits ?? minorUnitsOf(0) } });
      }
      const gifts: PartnerSupportGift[] = [];
      for (const stored of snapshot.records) {
        if (stored.attribution.kind !== "partner" || stored.attribution.partnerId !== record.partnerId || !storedRowWithin(stored, snapshot.period)) continue;
        const amountPath = `supportHistory.gifts.${gifts.length}.amount`;
        valueStates[amountPath] = stored.amount.minorUnits === 0 ? "zero" : "value";
        gifts.push({ gift: stored, amountPath });
      }
      supportHistory = { basis: SUPPORT_BASIS, periodLabel: snapshot.periodLabel, figures, ...(gifts.length === 0 ? {} : { gifts }) };
      coverage = snapshot.coverage;
    } else if (giving.outage !== undefined) {
      supportHistory = { basis: SUPPORT_BASIS, figures: [], outage: { system: giving.outage.system, reference: giving.outage.reference, guidance: GIVING_OUTAGE_GUIDANCE } };
      valueStates["supportHistory"] = "unavailable";
    }
  }
  const archived = record.archived === true;
  const preparationActions: readonly ReadAction[] =
    record.kind === "private-preparation"
      ? [
          archived ? { name: "archivePreparation", available: false, reason: "This preparation is already archived." } : { name: "archivePreparation", available: true },
          archived ? { name: "restorePreparation", available: true } : { name: "restorePreparation", available: false, reason: "This preparation is not archived." },
        ]
      : [
          { name: "archivePreparation", available: false, reason: ONLY_PREPARATION_ARCHIVED },
          { name: "restorePreparation", available: false, reason: ONLY_PREPARATION_ARCHIVED },
        ];
  const introductionAction: ReadAction = record.audience === "shared" ? { name: "recordIntroduction", available: true } : { name: "recordIntroduction", available: false, reason: ONLY_SHARED_RECORDS_TAKE_AN_INTRODUCTION };
  const data: PartnerDetailData = { partner: { ...record, contactMethods: record.contactMethods.filter((method) => method.permitted) }, relationshipContext, openTasks, referralSourceZone: REFERRAL_SOURCE_ZONE, ...(supportHistory === undefined ? {} : { supportHistory }) };
  const actions = [
    { name: "saveContactEdits", available: true },
    { name: "savePrivateNote", available: true },
    { name: "logInteraction", available: true },
    { name: "createTask", available: true },
    { name: "setFavourite", available: true },
    { name: "setTag", available: true },
    introductionAction,
    ...preparationActions,
  ];
  return envelopeOf(context, data, record.revision, { coverage, valueStates, actions });
}
export type PartnerPrivateQuery = { readonly partnerId: string };
/** Reads the worker's own preparation for one record: the private note bodies it holds and whether the preparation is archived. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readPrivatePreparation(input: PartnerPrivateQuery, source?: SessionSource): Promise<ReadResult<ReadEnvelope<PartnerPrivateData>>> {
  const outcome = await readContext("readPrivatePreparation", source);
  if (!outcome.ok) return outcome.result;
  const { context } = outcome;
  const record = partnerRecordOf(context, input.partnerId);
  if (record === undefined || !mayReadPartner(context, record)) return deniedRead("no-permission");
  const notes: PrivateNoteRecord[] = [];
  for (const note of context.document.privateNotes) {
    if (note.partnerId !== record.partnerId) continue;
    if (canView(context.session, { kind: "private-note", scope: context.scope, authorPrincipalId: note.authorPrincipalId }).allowed) notes.push(note);
  }
  notes.sort((left, right) => {
    const byCreated = compareCodeUnits(right.createdAt, left.createdAt);
    return byCreated !== 0 ? byCreated : compareCodeUnits(left.noteId, right.noteId);
  });
  const preparation = record.kind === "private-preparation" ? { partnerId: record.partnerId, archived: record.archived === true } : undefined;
  const data: PartnerPrivateData = { notes, ...(preparation === undefined ? {} : { preparation }) };
  const actions = [{ name: "savePrivateNote", available: true }, preparation === undefined ? { name: "createPrivatePreparation", available: true } : { name: "createPrivatePreparation", available: false, reason: "A preparation record already exists for this partner." }];
  return envelopeOf(context, data, record.revision, { coverage: RECORD_SET_COVERAGE, valueStates: { notes: countState(notes.length) }, actions });
}
export type PartnerInteractionsQuery = { readonly partnerId?: string; readonly page?: { readonly index: number; readonly size?: number } };
export type PartnerInteractionPage = { readonly interactions: readonly InteractionRecord[]; readonly total: number; readonly page: { readonly index: number; readonly size: number; readonly totalPages: number } };
function interactionAsRead(context: PartnerReadContext, interaction: InteractionRecord): InteractionRecord {
  const note = interaction.note;
  return note === null || note.audience === "shared" ? interaction : note.authorPrincipalId === undefined ? { ...interaction, note: null } : canView(context.session, { kind: "private-note", scope: context.scope, authorPrincipalId: note.authorPrincipalId }).allowed ? interaction : { ...interaction, note: null };
}
/** Reads recorded activity: the interactions that actually happened, newest first, each carrying the note this caller may read — a shared one, or a private one whose recorded author is this caller. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readInteractions(query: PartnerInteractionsQuery = {}, source?: SessionSource): Promise<ReadResult<ReadEnvelope<PartnerInteractionPage>>> {
  const outcome = await readContext("readInteractions", source);
  if (!outcome.ok) return outcome.result;
  const { context } = outcome;
  if (!canView(context.session, { kind: "interaction", scope: context.scope }).allowed) return deniedRead("no-permission");
  let partnerId: string | undefined;
  if (query.partnerId !== undefined) {
    const record = partnerRecordOf(context, query.partnerId);
    if (record === undefined || !mayReadPartner(context, record)) return deniedRead("no-permission");
    partnerId = record.partnerId;
  }
  const seenIdentities = new Set<string>();
  const seenEvents = new Set<string>();
  const visible: InteractionRecord[] = [];
  for (const interaction of context.document.interactions) {
    if (partnerId !== undefined && interaction.partnerId !== partnerId) continue;
    if (seenIdentities.has(interaction.interactionId)) continue;
    seenIdentities.add(interaction.interactionId);
    const provenance = interaction.provenance;
    if (provenance !== null) {
      const key = `${provenance.system}\u0000${provenance.reference}`;
      if (seenEvents.has(key)) continue;
      seenEvents.add(key);
    }
    visible.push(interactionAsRead(context, interaction));
  }
  visible.sort(compareInteractions);
  const size = clampPageSize(query.page?.size);
  const totalPages = Math.max(1, Math.ceil(visible.length / size));
  // The page window describes the activity this read returns, so a requested page past the last one the activity holds is served as that last page rather than echoed beside a smaller totalPages, which would state a page the answer does not have. The total stays the whole record's count: an offset that moved it would let a caller measure activity it cannot see.
  const requested = query.page?.index ?? 0;
  const index = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, totalPages - 1) : 0;
  const window = visible.slice(index * size, index * size + size);
  const valueStates: Record<string, RecordedValueState> = { total: countState(visible.length) };
  window.forEach((interaction, position) => {
    valueStates[`rows.${position}.occurredOn`] = interaction.precision === "unknown" ? "unknown" : "value";
  });
  const data: PartnerInteractionPage = { interactions: Object.freeze([...window]), total: visible.length, page: { index, size, totalPages } };
  return envelopeOf(context, data, context.document.context.revision, {
    coverage: RECORD_SET_COVERAGE,
    valueStates,
    actions: [
      { name: "logInteraction", available: true },
      { name: "createTask", available: true },
    ],
  });
}
export type PartnerRecordBody = { readonly partner: PartnerDetailData; readonly interactions: PartnerInteractionPage; readonly privatePreparation?: PartnerPrivateData };
const COVERAGE_RANK: Readonly<Record<Coverage["state"], number>> = { complete: 0, partial: 1, unknown: 2 };
/** Reads one partner record as the one envelope the record body renders, so no caller has to compose the three reads itself. */ export async function readPartnerRecord(partnerId: string, query: PartnerGivingSelection = {}, source?: SessionSource): Promise<ReadResult<ReadEnvelope<PartnerRecordBody>>> {
  const partner = await readPartner(partnerId, query, source);
  if (partner.kind !== "envelope") return partner;
  const interactions = await readInteractions({ partnerId }, source);
  if (interactions.kind !== "envelope") return interactions;
  const preparation = await readPrivatePreparation({ partnerId }, source);
  if (preparation.kind === "unavailable") return preparation;
  let asOf = partner.envelope.asOf;
  let coverageState = partner.envelope.coverage.state;
  const valueStates: Record<string, ValueState> = {};
  const actions: ReadAction[] = [];
  const actionNames = new Set<string>();
  for (const section of [partner.envelope, interactions.envelope, ...(preparation.kind === "envelope" ? [preparation.envelope] : [])]) {
    if (section.asOf > asOf) asOf = section.asOf;
    if (COVERAGE_RANK[section.coverage.state] > COVERAGE_RANK[coverageState]) coverageState = section.coverage.state;
    for (const [path, state] of Object.entries(section.valueStates)) if (valueStates[path] === undefined) valueStates[path] = state;
    for (const action of section.actions) {
      if (actionNames.has(action.name)) continue;
      actionNames.add(action.name);
      actions.push(action);
    }
  }
  const data: PartnerRecordBody = { partner: partner.envelope.data, interactions: interactions.envelope.data, ...(preparation.kind === "envelope" ? { privatePreparation: preparation.envelope.data } : {}) };
  const envelope: ReadEnvelope<PartnerRecordBody> = { data, scope: partner.envelope.scope, source: partner.envelope.source, revision: partner.envelope.revision, asOf, coverage: { from: partner.envelope.coverage.from, to: partner.envelope.coverage.to, state: coverageState }, valueStates, actions };
  return { kind: "envelope", envelope };
}
