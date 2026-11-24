import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import type { SourceReference } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { compareCodeUnits } from "@/lib/ordering";
import { REPORT_DEFAULT_TIME_ZONE, buildReportQuery, runReport, type PeriodState } from "@/modules/support/report";
import { instantAt } from "@/modules/time/clock";
import { civilDateAt, parseCivilDate, serialiseCivilDate, todayInZone, type CivilDate } from "@/modules/time/civil";
import { referralWindowState } from "@/modules/time/window";
import { assertScope, canView, type ResolvedSession } from "../authorize";
import { commitmentRowRecordSchema, contentDocumentRecordSchema, contentVariantRecordSchema, coachingTargetRecordSchema, giftRowRecordSchema, importProposalRecordSchema, interactionRecordSchema, notificationIntentRecordSchema, notificationSendResultRecordSchema, partnerRecordSchema } from "../envelope";
import { referralCycleRecordSchema, sessionContextRecordSchema, supportProjectionRecordSchema, taskRecordSchema, taskSeriesRecordSchema } from "../envelope";
import type { AdmittedMembership, CoachingTargetRecord, CommitmentRowRecord, ContentDocumentRecord, ContentVariantRecord, Coverage, GiftRowRecord, ImportProposalRecord, InteractionRecord, NotificationIntentRecord, NotificationSendResultRecord, PartnerRecord, ReadAction, ReadEnvelope } from "../envelope";
import type { RecordedValueState, ReferralCycleRecord, Scope, SessionContextRecord, SessionState, SupportProjectionRecord, TaskRecord, TaskSeriesRecord, ValueState } from "../envelope";
import type { ReadResult } from "../outcome";
import { resolveWorlds, scopeOf } from "./audience";
import { answerOf, deniedRead, instantOf, readAction, readDecodedState, resolveReading, sourceUnavailableRead, statedProjection, storeSource } from "./frame";
export type AdmissionGuidanceKey = "workspace-ready" | "account-recovery" | "request-access" | "sign-in-again" | "retry-later";
export type AdmissionContext = { readonly organizationId: string; readonly ministryId: string; readonly supportSubjectId: string };
export type AdmissionStateData = { readonly state: SessionState; readonly guidance: AdmissionGuidanceKey; readonly principalId: string | null; readonly context: AdmissionContext | null; readonly scenarioId: string | null };
export type AdmittedMinistryEntry = { readonly ministryId: string; readonly ministryLabel: string; readonly supportSubjectId: string; readonly selected: boolean };
export type ContextChooserGroup = { readonly organizationId: string; readonly organizationLabel: string; readonly ministries: readonly AdmittedMinistryEntry[] };
export type ContextChooserData = { readonly directEntry: boolean; readonly groups: readonly ContextChooserGroup[] };
export type HomeSection = "attention" | "information" | "unfinished-work";
export type HomeReasonKey =
  | "task-overdue"
  | "task-due-today"
  | "task-upcoming"
  | "task-undated"
  | "series-plan-needs-review"
  | "commitment-needs-attention"
  | "support-received-this-period"
  | "interaction-recorded"
  | "referral-window-active"
  | "referral-window-expired"
  | "target-placed-on-home"
  | "draft-saved"
  | "candidate-awaiting-review"
  | "import-awaiting-decisions"
  | "notification-needs-attention";
export type HomeItemStatus = "overdue" | "due-today" | "upcoming" | "undated" | "needs-review" | "needs-attention" | "active" | "expired" | "recorded" | "received" | "placed" | "paused" | "draft" | "awaiting-review";
export type HomeSupportAmount = { readonly currency: string; readonly exponent: number | null; readonly minorUnits: number | null; readonly valueState: ValueState };
export type HomeSupportPeriod = { readonly from: string; readonly to: string; readonly state: PeriodState };
export type HomeSupportFigure = { readonly state: "stated" | "unavailable"; readonly source: SourceReference; readonly asOf: string; readonly period: HomeSupportPeriod | null; readonly coverage: Coverage | null; readonly amounts: readonly HomeSupportAmount[] };
export type HomeItem = { readonly itemId: string; readonly section: HomeSection; readonly reason: HomeReasonKey; readonly destination: string; readonly label: string | null; readonly status: HomeItemStatus; readonly onDate: string | null; readonly locale: string | null; readonly figure?: HomeSupportFigure };
export type HomeData = { readonly items: readonly HomeItem[] };
const HOME_TIME_ZONE = REPORT_DEFAULT_TIME_ZONE;
const GUIDANCE_BY_STATE: Readonly<Record<SessionState, AdmissionGuidanceKey>> = Object.freeze({ "signed-in": "workspace-ready", "no-access": "account-recovery", denied: "request-access", expired: "sign-in-again", unavailable: "retry-later" });
const ADMISSION_SEED_REFERENCE = "session-admission";
const CHOOSER_SEED_REFERENCE = "session-contexts";
const HOME_SEED_REFERENCE = "home";
const SUPPORT_ITEM_ID = "support-received-this-period";
const RECENT_INTERACTION_LIMIT = 5;
const STORE_UNAVAILABLE_GUIDANCE = "This session's records could not be read. Nothing was changed; try again in a moment.";
const admissionDocumentSchema = z.object({ context: sessionContextRecordSchema });
const homeDocumentSchema = z.object({
  context: sessionContextRecordSchema,
  partners: z.array(partnerRecordSchema),
  tasks: z.array(taskRecordSchema),
  series: z.array(taskSeriesRecordSchema),
  interactions: z.array(interactionRecordSchema),
  referrals: z.array(referralCycleRecordSchema),
  contentDocuments: z.array(contentDocumentRecordSchema),
  contentVariants: z.array(contentVariantRecordSchema),
  importProposals: z.array(importProposalRecordSchema),
  notificationIntents: z.array(notificationIntentRecordSchema),
  notificationResults: z.array(notificationSendResultRecordSchema),
  coachingTargets: z.array(coachingTargetRecordSchema),
  supportProjection: supportProjectionRecordSchema.nullable(),
  gifts: z.array(giftRowRecordSchema),
  commitments: z.array(commitmentRowRecordSchema),
});
const workloadGiftDocumentSchema = z.object({ gifts: z.array(giftRowRecordSchema) });
const NO_CONTEXT_SCOPE: Scope = Object.freeze({ organizationId: "" as Scope["organizationId"], ministryId: "" as Scope["ministryId"], supportSubjectId: "" as Scope["supportSubjectId"], principalId: "" as Scope["principalId"] });
function todayFor(at: Temporal.Instant): CivilDate | undefined {
  const resolved = todayInZone(HOME_TIME_ZONE, at);
  return resolved.status === "resolved" ? resolved.date : undefined;
}
function statedSupportFigure(input: { readonly projectionRecord: SupportProjectionRecord; readonly gifts: readonly GiftRowRecord[]; readonly commitments: readonly CommitmentRowRecord[]; readonly scope: Scope; readonly asOf: string }): HomeSupportFigure {
  const built = buildReportQuery({
    reportId: "received-period-and-year-to-date",
    scope: { organizationId: input.scope.organizationId, ministryId: input.scope.ministryId, supportSubjectId: input.scope.supportSubjectId, principalId: input.scope.principalId },
    period: { kind: "preset", preset: "this-month" },
    currency: { kind: "all" },
    timeZone: HOME_TIME_ZONE,
  });
  if (!built.ok) throw new TypeError(`The Home support query was refused on ${built.problems.map((problem) => problem.field).join(", ")}, so no received-support figure is stated.`);
  const result = runReport(built.query, statedProjection({ record: input.projectionRecord, gifts: input.gifts, workloadGifts: [], commitments: input.commitments, asOf: input.asOf, withGoal: true }));
  return {
    state: "stated",
    source: result.snapshot.source,
    asOf: result.snapshot.asOf,
    period: { from: serialiseCivilDate(result.snapshot.period.from), to: serialiseCivilDate(result.snapshot.period.to), state: result.snapshot.period.state },
    coverage: result.snapshot.coverage,
    amounts: result.summary.map((summary) => ({ currency: summary.currency, exponent: summary.exponent ?? null, minorUnits: summary.received.minorUnits, valueState: summary.received.valueState })),
  };
}
const unavailableSupportFigure = (record: SupportProjectionRecord, asOf: string): HomeSupportFigure => ({ state: "unavailable", source: record.source, asOf, period: null, coverage: record.coverage, amounts: [] });
const recordedStateOf = (amount: HomeSupportAmount): RecordedValueState => (amount.valueState === "incomplete-subtotal" ? (amount.minorUnits === 0 ? "zero" : "value") : amount.valueState);
type HomeBuildContext = { readonly session: ResolvedSession; readonly scope: Scope; readonly today: CivilDate | undefined };
function homeItem(input: {
  readonly itemId: string;
  readonly section: HomeSection;
  readonly reason: HomeReasonKey;
  readonly destination: string;
  readonly label: string | null;
  readonly status: HomeItemStatus;
  readonly onDate?: string | null;
  readonly locale?: string | null;
  readonly figure?: HomeSupportFigure;
}): HomeItem {
  return { itemId: input.itemId, section: input.section, reason: input.reason, destination: input.destination, label: input.label, status: input.status, onDate: input.onDate ?? null, locale: input.locale ?? null, ...(input.figure === undefined ? {} : { figure: input.figure }) };
}
function compareByDayThenId(left: HomeItem, right: HomeItem): number {
  const leftDay = left.onDate ?? "";
  const rightDay = right.onDate ?? "";
  return leftDay === rightDay ? compareCodeUnits(left.itemId, right.itemId) : compareCodeUnits(leftDay, rightDay);
}
function seriesPlanReviewItems(series: readonly TaskSeriesRecord[], context: HomeBuildContext): readonly HomeItem[] {
  const items: HomeItem[] = [];
  for (const entry of [...series].sort((left, right) => compareCodeUnits(left.seriesId, right.seriesId))) {
    if (!entry.planNeedsReview || entry.state === "stopped") continue;
    if (!canView(context.session, { kind: "series", scope: context.scope, ownerPrincipalId: entry.ownerPrincipalId }).allowed) continue;
    items.push(homeItem({ itemId: `series:${entry.seriesId}`, section: "attention", reason: "series-plan-needs-review", destination: `/work/series/${entry.seriesId}`, label: entry.title, status: "needs-review" }));
  }
  return items;
}
function taskItems(tasks: readonly TaskRecord[], planReviewSeriesIds: ReadonlySet<string>, context: HomeBuildContext): { readonly attention: readonly HomeItem[]; readonly information: readonly HomeItem[]; readonly unfinished: readonly HomeItem[] } {
  const attention: HomeItem[] = [];
  const information: HomeItem[] = [];
  const unfinished: HomeItem[] = [];
  const dated: { readonly task: TaskRecord; readonly day: CivilDate }[] = [];
  for (const task of [...tasks].sort((left, right) => compareCodeUnits(left.taskId, right.taskId))) {
    if (task.status !== "open" && task.status !== "reopened") continue;
    if (task.seriesId !== null && planReviewSeriesIds.has(task.seriesId)) continue;
    if (!canView(context.session, { kind: "task", scope: context.scope, ownerPrincipalId: task.ownerPrincipalId }).allowed) continue;
    const parsed = task.dueOn === null ? undefined : parseCivilDate(task.dueOn);
    if (parsed === undefined || parsed.status === "refused") {
      unfinished.push(taskHomeItem(task, "unfinished-work", "task-undated", "undated", null));
      continue;
    }
    dated.push({ task, day: parsed.date });
  }
  const today = context.today;
  for (const { task, day } of dated) {
    const onDate = serialiseCivilDate(day);
    if (today === undefined) {
      information.push(taskHomeItem(task, "information", "task-upcoming", "upcoming", onDate));
      continue;
    }
    const order = Temporal.PlainDate.compare(day, today);
    if (order < 0) {
      attention.push(taskHomeItem(task, "attention", "task-overdue", "overdue", onDate));
    } else if (order === 0) {
      attention.push(taskHomeItem(task, "attention", "task-due-today", "due-today", onDate));
    } else information.push(taskHomeItem(task, "information", "task-upcoming", "upcoming", onDate));
  }
  attention.sort(compareByDayThenId);
  information.sort(compareByDayThenId);
  unfinished.sort(compareByDayThenId);
  return { attention, information, unfinished };
}
const taskHomeItem = (task: TaskRecord, section: HomeSection, reason: HomeReasonKey, status: HomeItemStatus, onDate: string | null): HomeItem => homeItem({ itemId: `task:${task.taskId}`, section, reason, destination: "/work", label: task.title, status, onDate });
function commitmentAttentionItems(commitments: readonly CommitmentRowRecord[], context: HomeBuildContext): readonly HomeItem[] {
  if (!canView(context.session, { kind: "support-subject", scope: context.scope, capabilities: [] }).allowed) return [];
  return commitments
    .filter((record) => record.bucketState === "recovery-needs-attention")
    .sort((left, right) => compareCodeUnits(left.commitmentRowId, right.commitmentRowId))
    .map((record) => homeItem({ itemId: `commitment:${record.commitmentRowId}`, section: "attention", reason: "commitment-needs-attention", destination: `/support/commitments/${record.commitmentRowId}`, label: record.cadence, status: "needs-attention" }));
}
/** The delivery surface reports one named notice, so the destination that opens it must name that notice. */ const deliveryDestinationOf = (intentId: string): string => `/communication/delivery?intentId=${encodeURIComponent(intentId)}`;
function notificationItems(intents: readonly NotificationIntentRecord[], results: readonly NotificationSendResultRecord[], context: HomeBuildContext): readonly HomeItem[] {
  if (!canView(context.session, { kind: "content-variant", scope: context.scope }).allowed) return [];
  const resultsByIntent = new Map<string, NotificationSendResultRecord[]>();
  for (const result of results) {
    const existing = resultsByIntent.get(result.intentId);
    if (existing === undefined) {
      resultsByIntent.set(result.intentId, [result]);
    } else existing.push(result);
  }
  const items: HomeItem[] = [];
  for (const intent of [...intents].sort((left, right) => compareCodeUnits(left.intentId, right.intentId))) {
    const outcomes = resultsByIntent.get(intent.intentId) ?? [];
    if (!(outcomes.length === 0 || outcomes.some((outcome) => outcome.recipients.some((copy) => copy.state !== "accepted")))) continue;
    const lastRecordedAt = outcomes.at(-1)?.recordedAt ?? null;
    items.push(homeItem({ itemId: `notification:${intent.intentId}`, section: "unfinished-work", reason: "notification-needs-attention", destination: deliveryDestinationOf(intent.intentId), label: null, status: "needs-attention", onDate: lastRecordedAt === null ? null : civilDayOf(lastRecordedAt) }));
  }
  return items;
}
function interactionItems(interactions: readonly InteractionRecord[], partners: readonly PartnerRecord[], context: HomeBuildContext): readonly HomeItem[] {
  if (!canView(context.session, { kind: "interaction", scope: context.scope }).allowed) return [];
  const partnersById = new Map(partners.map((partner) => [partner.partnerId, partner]));
  const items: HomeItem[] = [];
  for (const record of interactions) {
    const partner = partnersById.get(record.partnerId);
    if (partner === undefined) continue;
    if (!canView(context.session, { kind: "partner", scope: context.scope, audience: partner.audience, authorPrincipalId: context.session.principalId }).allowed) continue;
    items.push(homeItem({ itemId: `interaction:${record.interactionId}`, section: "information", reason: "interaction-recorded", destination: `/partners/${partner.partnerId}`, label: partner.displayName, status: "recorded", onDate: record.occurredOn }));
  }
  items.sort((left, right) => {
    const leftDay = left.onDate ?? "";
    const rightDay = right.onDate ?? "";
    return leftDay === rightDay ? compareCodeUnits(left.itemId, right.itemId) : compareCodeUnits(rightDay, leftDay);
  });
  return items.slice(0, RECENT_INTERACTION_LIMIT);
}
function referralItems(referrals: readonly ReferralCycleRecord[], partners: readonly PartnerRecord[], context: HomeBuildContext): readonly HomeItem[] {
  if (!canView(context.session, { kind: "referral", scope: context.scope }).allowed) return [];
  const partnersById = new Map(partners.map((partner) => [partner.partnerId, partner]));
  const now = instantAt(context.session.clockOffsetMs);
  const items: HomeItem[] = [];
  for (const cycle of [...referrals].sort((left, right) => compareCodeUnits(left.referralId, right.referralId))) {
    if (cycle.consumed) continue;
    const windowEnd = instantOf(cycle.windowEnd);
    if (windowEnd === undefined) continue;
    const state = referralWindowState({ windowEnd, now });
    if (state.status !== "active" && state.status !== "expired") continue;
    const partner = partnersById.get(cycle.partnerId);
    items.push(homeItem({ itemId: `referral:${cycle.referralId}`, section: "information", reason: state.status === "active" ? "referral-window-active" : "referral-window-expired", destination: `/partners/referrals/${cycle.referralId}`, label: partner?.displayName ?? null, status: state.status }));
  }
  return items;
}
function contentItems(documents: readonly ContentDocumentRecord[], variants: readonly ContentVariantRecord[], context: HomeBuildContext): readonly HomeItem[] {
  if (!canView(context.session, { kind: "content-variant", scope: context.scope }).allowed) return [];
  const documentsById = new Map(documents.map((document) => [document.documentId, document]));
  const items: HomeItem[] = [];
  for (const variant of [...variants].sort((left, right) => compareCodeUnits(left.variantId, right.variantId))) {
    const document = documentsById.get(variant.documentId);
    if (document === undefined) continue;
    const destination = document.family === "update" ? `/communication/${document.documentId}/${variant.variantId}` : `/pages/${document.documentId}`;
    if (variant.candidateId !== null) {
      items.push(homeItem({ itemId: `variant:${variant.variantId}`, section: "unfinished-work", reason: "candidate-awaiting-review", destination, label: document.kind, status: "awaiting-review", locale: variant.locale }));
      continue;
    }
    if (variant.draftRevisionId !== null) items.push(homeItem({ itemId: `variant:${variant.variantId}`, section: "unfinished-work", reason: "draft-saved", destination, label: document.kind, status: "draft", locale: variant.locale }));
  }
  return items;
}
function importItems(proposals: readonly ImportProposalRecord[], context: HomeBuildContext): readonly HomeItem[] {
  if (!canView(context.session, { kind: "partner", scope: context.scope, audience: "private", authorPrincipalId: context.session.principalId }).allowed) return [];
  return proposals
    .filter((proposal) => proposal.processedAt === null)
    .sort((left, right) => compareCodeUnits(left.importOperationId, right.importOperationId))
    .map((proposal) => homeItem({ itemId: `import:${proposal.importOperationId}`, section: "unfinished-work", reason: "import-awaiting-decisions", destination: "/partners/import", label: null, status: "awaiting-review" }));
}
function targetItems(targets: readonly CoachingTargetRecord[], context: HomeBuildContext): readonly HomeItem[] {
  return targets
    .filter((target) => target.workerPrincipalId === context.session.principalId && target.homePlacement === "placed" && target.state !== "ended")
    .sort((left, right) => compareCodeUnits(left.targetId, right.targetId))
    .map((target) => homeItem({ itemId: `target:${target.targetId}`, section: "information", reason: "target-placed-on-home", destination: "/coaching/targets", label: target.privateLabel, status: target.state === "paused" ? "paused" : "placed" }));
}
const supportItem = (figure: HomeSupportFigure): HomeItem => homeItem({ itemId: SUPPORT_ITEM_ID, section: "information", reason: "support-received-this-period", destination: "/support", label: null, status: "received", figure });
function civilDayOf(value: string): string | null {
  const instant = instantOf(value);
  if (instant === undefined) return null;
  const resolved = civilDateAt(instant, HOME_TIME_ZONE);
  return resolved.status === "resolved" ? serialiseCivilDate(resolved.date) : null;
}
type StoredSelection = { readonly context: AdmissionContext; readonly scope: Scope };
function selectionOf(record: SessionContextRecord): StoredSelection | undefined {
  const { selectedOrganizationId, selectedMinistryId, selectedSupportSubjectId } = record;
  if (selectedOrganizationId === null || selectedMinistryId === null || selectedSupportSubjectId === null) return undefined;
  return { context: { organizationId: selectedOrganizationId, ministryId: selectedMinistryId, supportSubjectId: selectedSupportSubjectId }, scope: { organizationId: selectedOrganizationId, ministryId: selectedMinistryId, supportSubjectId: selectedSupportSubjectId, principalId: record.principalId } };
}
function groupAdmissions(memberships: readonly AdmittedMembership[], selected: AdmissionContext | undefined): readonly ContextChooserGroup[] {
  const groups = new Map<string, { organizationLabel: string; ministries: AdmittedMinistryEntry[] }>();
  for (const membership of memberships) {
    const existing = groups.get(membership.organizationId) ?? { organizationLabel: "", ministries: [] };
    existing.ministries.push({
      ministryId: membership.ministryId,
      ministryLabel: membership.ministryLabel ?? "",
      supportSubjectId: membership.supportSubjectId,
      selected: selected !== undefined && selected.organizationId === membership.organizationId && selected.ministryId === membership.ministryId && selected.supportSubjectId === membership.supportSubjectId,
    });
    if (existing.organizationLabel === "" && membership.organizationLabel !== undefined) existing.organizationLabel = membership.organizationLabel;
    groups.set(membership.organizationId, existing);
  }
  return [...groups.entries()].map(([organizationId, group]) => ({ organizationId, organizationLabel: group.organizationLabel, ministries: group.ministries }));
}
const admittedMinistryCount = (memberships: readonly AdmittedMembership[]): number => new Set(memberships.map((membership) => `${membership.organizationId}::${membership.ministryId}`)).size;
function admissionActions(session: ResolvedSession): readonly ReadAction[] {
  switch (session.sessionState) {
    case "signed-in": {
      const ministryCount = admittedMinistryCount(session.admittedMemberships);
      return [
        readAction(
          "selectContext",
          ministryCount > 1,
          ministryCount === 1 ? "One ministry is admitted, so that context opens directly and there is nothing to choose." : ministryCount === 0 ? "The session admits no ministry, so there is no context to select." : "Several ministries are admitted, so a context can be selected.",
        ),
      ];
    }
    case "no-access":
      return [readAction("selectContext", false, "This session is not admitted: the account it names holds no membership, so there is no context to select.")];
    case "denied":
      return [readAction("selectContext", false, "This session is not admitted, so there is no context to select.")];
    case "expired":
      return [readAction("selectContext", false, "This session has expired and is not admitted, so there is no context to select.")];
    case "unavailable":
      return [readAction("selectContext", false, "This session is unavailable and is not admitted, so there is no context to select.")];
  }
}
function supportValueStates(figure: HomeSupportFigure): Readonly<Record<string, RecordedValueState>> {
  const states: Record<string, RecordedValueState> = {};
  for (const amount of figure.amounts) states[`${SUPPORT_ITEM_ID}.figure.amounts.${amount.currency}.minorUnits`] = recordedStateOf(amount);
  return states;
}
/** Reads the session's admission: which of the five states it is in, the guidance key the shell renders, and — only when admitted — the principal, the selected context and the scenario it runs. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readAdmissionState(): Promise<ReadResult<ReadEnvelope<AdmissionStateData>>> {
  const opened = await resolveReading({ job: "readAdmissionState" });
  if (!opened.ok) return opened.result;
  const session = opened.session;
  const asOf = opened.instant.toString();
  const source = storeSource(ADMISSION_SEED_REFERENCE);
  const actions = admissionActions(session);
  const coverage: Coverage = { from: null, to: asOf, state: "complete" };
  const stored = await readDecodedState({ session, job: "readAdmissionState", source, schema: admissionDocumentSchema, guidance: STORE_UNAVAILABLE_GUIDANCE });
  if (!stored.ok) return stored.result;
  const storedContext = stored.value.context;
  if (session.sessionState !== "signed-in") return answerOf(NO_CONTEXT_SCOPE, asOf, { data: { state: session.sessionState, guidance: GUIDANCE_BY_STATE[session.sessionState], principalId: null, context: null, scenarioId: null }, source, revision: storedContext.revision, coverage, actions });
  const selection = selectionOf(storedContext);
  if (selection === undefined) {
    // A session that selected no context still states the authority its records are read in: the worlds it reads name the context in force, and a session holding none of its own states the principal it does hold.
    const worlds = await resolveWorlds("readAdmissionState", { sessionId: session.sessionId });
    if (!worlds.ok) return worlds.result;
    const authority = scopeOf(session, worlds.published) ?? { ...NO_CONTEXT_SCOPE, principalId: session.principalId };
    return answerOf(authority, asOf, { data: { state: "signed-in", guidance: "workspace-ready", principalId: session.principalId, context: null, scenarioId: session.scenarioId }, source, revision: storedContext.revision, coverage, actions });
  }
  const admission = assertScope(session, selection.scope);
  if (!admission.ok) return { kind: "denied", denied: admission.denial };
  return answerOf(selection.scope, asOf, { data: { state: "signed-in", guidance: "workspace-ready", principalId: session.principalId, context: selection.context, scenarioId: session.scenarioId }, source, revision: storedContext.revision, coverage, actions });
}
/** Reads the memberships this session may act in, grouped by organisation and ministry, with the one in force marked and `directEntry` set when a single ministry makes a chooser unnecessary. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readContextChooser(): Promise<ReadResult<ReadEnvelope<ContextChooserData>>> {
  const opened = await resolveReading({ job: "readContextChooser" });
  if (!opened.ok) return opened.result;
  const session = opened.session;
  if (session.sessionState !== "signed-in") return deniedRead("not-admitted");
  const asOf = opened.instant.toString();
  const source = storeSource(CHOOSER_SEED_REFERENCE);
  const stored = await readDecodedState({ session, job: "readContextChooser", source, schema: admissionDocumentSchema, guidance: STORE_UNAVAILABLE_GUIDANCE });
  if (!stored.ok) return stored.result;
  const storedContext = stored.value.context;
  const selection = selectionOf(storedContext);
  const groups = groupAdmissions(session.admittedMemberships, selection?.context);
  const ministryCount = admittedMinistryCount(session.admittedMemberships);
  const data: ContextChooserData = { directEntry: ministryCount === 1, groups };
  const selectContext = readAction("selectContext", ministryCount > 1, ministryCount === 1 ? "One ministry is admitted, so the workspace opens directly and no chooser is offered." : "The session admits no ministry, so there is no context to select.");
  return answerOf(selection?.scope ?? NO_CONTEXT_SCOPE, asOf, { data, source, revision: storedContext.revision, coverage: { from: null, to: asOf, state: "complete" }, actions: [selectContext] });
}
/** Reads the worker's day as Attention, Information and Unfinished work, every item carrying why it is there and where it goes, with received support stated through the one report computation. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readHome(): Promise<ReadResult<ReadEnvelope<HomeData>>> {
  const opened = await resolveReading({ job: "readHome" });
  if (!opened.ok) return opened.result;
  const session = opened.session;
  if (session.sessionState !== "signed-in") return deniedRead("not-admitted");
  const at = opened.instant;
  const asOf = at.toString();
  const source = storeSource(HOME_SEED_REFERENCE);
  const stored = await readDecodedState({ session, job: "readHome", source, schema: homeDocumentSchema, guidance: STORE_UNAVAILABLE_GUIDANCE });
  if (!stored.ok) return stored.result;
  const document = stored.value;
  let workloadGifts: readonly GiftRowRecord[] = [];
  if (stored.documents.workload !== undefined) {
    const workload = workloadGiftDocumentSchema.safeParse(stored.documents.workload);
    if (!workload.success) return sourceUnavailableRead({ job: "readHome", source, guidance: STORE_UNAVAILABLE_GUIDANCE });
    workloadGifts = workload.data.gifts;
  }
  const selection = selectionOf(document.context);
  if (selection === undefined) return deniedRead(session.admittedMemberships.length === 0 ? "no-membership" : "not-admitted");
  const admission = assertScope(session, selection.scope);
  if (!admission.ok) return { kind: "denied", denied: admission.denial };
  const build: HomeBuildContext = { session, scope: selection.scope, today: todayFor(at) };
  const figure = document.supportProjection === null ? undefined : homeSupportFigure({ projectionRecord: document.supportProjection, gifts: document.gifts, workloadGifts, commitments: document.commitments, scope: selection.scope, asOf });
  const planReviewSeriesIds = new Set(document.series.filter((entry) => entry.planNeedsReview).map((entry) => entry.seriesId));
  const taskPartition = taskItems(document.tasks, planReviewSeriesIds, build);
  const attention: HomeItem[] = [...seriesPlanReviewItems(document.series, build), ...commitmentAttentionItems(document.commitments, build), ...taskPartition.attention];
  const information: HomeItem[] = [...(figure === undefined ? [] : [supportItem(figure)]), ...referralItems(document.referrals, document.partners, build), ...interactionItems(document.interactions, document.partners, build), ...taskPartition.information, ...targetItems(document.coachingTargets, build)];
  const unfinished: HomeItem[] = [...contentItems(document.contentDocuments, document.contentVariants, build), ...importItems(document.importProposals, build), ...notificationItems(document.notificationIntents, document.notificationResults, build), ...taskPartition.unfinished];
  const items: readonly HomeItem[] = [...attention, ...information, ...unfinished];
  const coverage: Coverage = figure?.coverage ?? { from: null, to: asOf, state: "complete" };
  const hasDueWork = items.some((item) => item.reason === "task-overdue" || item.reason === "task-due-today");
  const hasPlanReview = items.some((item) => item.reason === "series-plan-needs-review");
  const hasNotificationAttention = items.some((item) => item.reason === "notification-needs-attention");
  const actions = [readAction("completeTask", hasDueWork, "No open task is dated for today or earlier."), readAction("resolveMissedPlan", hasPlanReview, "No recurring plan needs review."), readAction("requestNotification", hasNotificationAttention, "No published edition has a notification that needs attention.")];
  return answerOf(selection.scope, asOf, { data: { items }, source, revision: document.context.revision, coverage, valueStates: figure === undefined ? {} : supportValueStates(figure), actions });
}
function homeSupportFigure(input: { readonly projectionRecord: SupportProjectionRecord; readonly gifts: readonly GiftRowRecord[]; readonly workloadGifts: readonly GiftRowRecord[]; readonly commitments: readonly CommitmentRowRecord[]; readonly scope: Scope; readonly asOf: string }): HomeSupportFigure {
  try {
    return statedSupportFigure({ projectionRecord: input.projectionRecord, gifts: [...input.gifts, ...input.workloadGifts], commitments: input.commitments, scope: input.scope, asOf: input.asOf });
  } catch {
    logger.sourceUnavailable({ job: "readHome", source: input.projectionRecord.source });
    return unavailableSupportFigure(input.projectionRecord, input.asOf);
  }
}
