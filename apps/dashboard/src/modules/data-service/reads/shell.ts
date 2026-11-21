/**
 * The three reads the shell is built from: the admission statement, the context chooser, and Home.
 */
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import type { SourceReference } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { compareCodeUnits } from "@/lib/ordering";
import { redactDenial } from "@/lib/redaction";
import type { CommitmentRow } from "@/modules/support/buckets";
import { REPORT_DEFAULT_TIME_ZONE, buildReportQuery, runReport, type PeriodState } from "@/modules/support/report";
import { instantAt } from "@/modules/time/clock";
import { civilDateAt, parseCivilDate, serialiseCivilDate, todayInZone, type CivilDate } from "@/modules/time/civil";
import { referralWindowState } from "@/modules/time/window";
import { readSession } from "@/modules/store/repository";
import { assertScope, canView, readResultOfRefusal, resolveSession, type ResolvedSession } from "../authorize";
import {
  buildEnvelope,
  commitmentRowRecordSchema,
  contentDocumentRecordSchema,
  contentVariantRecordSchema,
  coachingTargetRecordSchema,
  giftRowRecordSchema,
  importProposalRecordSchema,
  interactionRecordSchema,
  notificationIntentRecordSchema,
  notificationSendResultRecordSchema,
  partnerRecordSchema,
  referralCycleRecordSchema,
  sessionContextRecordSchema,
  supportProjectionRecordSchema,
  taskRecordSchema,
  taskSeriesRecordSchema,
  type AdmittedMembership,
  type CoachingTargetRecord,
  type CommitmentRowRecord,
  type ContentDocumentRecord,
  type ContentVariantRecord,
  type Coverage,
  type GiftRowRecord,
  type ImportProposalRecord,
  type InteractionRecord,
  type NotificationIntentRecord,
  type NotificationSendResultRecord,
  type PartnerRecord,
  type ReadAction,
  type ReadEnvelope,
  type RecordedValueState,
  type ReferralCycleRecord,
  type Scope,
  type SessionContextRecord,
  type SessionState,
  type SupportProjectionRecord,
  type TaskRecord,
  type TaskSeriesRecord,
  type ValueState,
} from "../envelope";
import { LOCAL_STORE_SYSTEM, denied, unavailable, type DenialReason, type DeniedOutcome, type ReadResult } from "../outcome";
// Admission: the five states the shell must tell apart
/** The stable key of the guidance the shell renders for one admission state. */
export type AdmissionGuidanceKey = "workspace-ready" | "account-recovery" | "request-access" | "sign-in-again" | "retry-later";
/** The context the session is acting in: the three references one admitted membership states. */
export interface AdmissionContext {
  readonly organizationId: string;
  readonly ministryId: string;
  readonly supportSubjectId: string;
}
/** What the shell may know about admission. */
export interface AdmissionStateData {
  readonly state: SessionState;
  readonly guidance: AdmissionGuidanceKey;
  readonly principalId: string | null;
  readonly context: AdmissionContext | null;
  readonly scenarioId: string | null;
}
// The context chooser
/** One admitted ministry, as the chooser lists it. */
export interface AdmittedMinistryEntry {
  readonly ministryId: string;
  readonly ministryLabel: string;
  readonly supportSubjectId: string;
  readonly selected: boolean;
}
/** One organisation and the ministries it admits for this principal. */
export interface ContextChooserGroup {
  readonly organizationId: string;
  readonly organizationLabel: string;
  readonly ministries: readonly AdmittedMinistryEntry[];
}
/** The chooser, or the fact that there is nothing to choose. */
export interface ContextChooserData {
  readonly directEntry: boolean;
  readonly groups: readonly ContextChooserGroup[];
}
// Home: Attention, Information, Unfinished work
/** The three sections Home is partitioned into, in the order the surface renders them. */
export type HomeSection = "attention" | "information" | "unfinished-work";
/** Why one item is on Home. */
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
/** Where one item stands, in the smallest vocabulary the states need. */
export type HomeItemStatus =
  | "overdue"
  | "due-today"
  | "upcoming"
  | "undated"
  | "needs-review"
  | "needs-attention"
  | "active"
  | "expired"
  | "recorded"
  | "received"
  | "placed"
  | "paused"
  | "draft"
  | "awaiting-review";
/** One currency's part of the received-support figure, exactly as `runReport` states it. */
export interface HomeSupportAmount {
  readonly currency: string;
  readonly exponent: number | null;
  readonly minorUnits: number | null;
  readonly valueState: ValueState;
}
/** The period the support figure covers, with the state that says whether it has closed. */
export interface HomeSupportPeriod {
  readonly from: string;
  readonly to: string;
  readonly state: PeriodState;
}
/** Received support in the current period, as the one report computation states it. */
export interface HomeSupportFigure {
  readonly state: "stated" | "unavailable";
  readonly source: SourceReference;
  readonly asOf: string;
  readonly period: HomeSupportPeriod | null;
  readonly coverage: Coverage | null;
  readonly amounts: readonly HomeSupportAmount[];
}
/** One thing Home shows, with both questions already answered. */
export interface HomeItem {
  readonly itemId: string;
  readonly section: HomeSection;
  readonly reason: HomeReasonKey;
  readonly destination: string;
  readonly label: string | null;
  readonly status: HomeItemStatus;
  readonly onDate: string | null;
  readonly locale: string | null;
  readonly figure?: HomeSupportFigure;
}
/** Everything Home states: its items, in section order, and nothing else. */
export interface HomeData {
  readonly items: readonly HomeItem[];
}
// Fixed values this module states
const READ_ATTEMPT_ID = "read";

const HOME_TIME_ZONE = REPORT_DEFAULT_TIME_ZONE;

const GUIDANCE_BY_STATE: Readonly<Record<SessionState, AdmissionGuidanceKey>> = Object.freeze({
  "signed-in": "workspace-ready",
  "no-access": "account-recovery",
  denied: "request-access",
  expired: "sign-in-again",
  unavailable: "retry-later",
});
const ADMISSION_SEED_REFERENCE = "session-admission";
const CHOOSER_SEED_REFERENCE = "session-contexts";
const HOME_SEED_REFERENCE = "home";

const SUPPORT_ITEM_ID = "support-received-this-period";

const RECENT_INTERACTION_LIMIT = 5;

const STORE_UNAVAILABLE_GUIDANCE = "This session's records could not be read. Nothing was changed; try again in a moment.";
// The session documents these reads parse
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
type HomeDocument = z.infer<typeof homeDocumentSchema>;

const workloadGiftDocumentSchema = z.object({ gifts: z.array(giftRowRecordSchema) });
// Shared plumbing: sources, refusals, the scenario instant and civil dates
function storeSource(reference: string): SourceReference {
  return { system: LOCAL_STORE_SYSTEM, reference };
}
function refuse(reason: DenialReason): DeniedOutcome {
  return redactDenial(denied({ operationId: READ_ATTEMPT_ID, reasonCode: reason }));
}
function deniedResult<T>(reason: DenialReason): ReadResult<ReadEnvelope<T>> {
  return { kind: "denied", denied: refuse(reason) };
}
function sourceUnavailableResult<T>(job: string, source: SourceReference, guidance: string = STORE_UNAVAILABLE_GUIDANCE): ReadResult<ReadEnvelope<T>> {
  logger.sourceUnavailable({ job, source });
  return {
    kind: "unavailable",
    unavailable: unavailable({ operationId: READ_ATTEMPT_ID, source, guidance }),
  };
}
function asOfText(session: ResolvedSession): string {
  return instantAt(session.clockOffsetMs).toString();
}
const NO_CONTEXT_SCOPE: Scope = Object.freeze({
  organizationId: "" as Scope["organizationId"],
  ministryId: "" as Scope["ministryId"],
  supportSubjectId: "" as Scope["supportSubjectId"],
  principalId: "" as Scope["principalId"],
});
function readStatedDate(value: string, field: string): CivilDate {
  const parsed = parseCivilDate(value);
  if (parsed.status === "refused") {
    throw new TypeError(`A stored ${field} value is not a civil date, so the record cannot be read.`);
  }
  return parsed.date;
}
function readStatedDateOrNull(value: string | null, field: string): CivilDate | undefined {
  return value === null ? undefined : readStatedDate(value, field);
}
function readInstant(value: string | null): Temporal.Instant | undefined {
  if (value === null) {
    return undefined;
  }
  try {
    return Temporal.Instant.from(value);
  } catch {
    return undefined;
  }
}
function todayFor(at: Temporal.Instant): CivilDate | undefined {
  const resolved = todayInZone(HOME_TIME_ZONE, at);
  return resolved.status === "resolved" ? resolved.date : undefined;
}
// Received support: one report, built from the stored projection
interface ReportGiftRow {
  readonly giftRowId: string;
  readonly giftId: string;
  readonly allocationId?: string;
  readonly amount: GiftRowRecord["amount"];
  readonly originalGiftOn?: CivilDate;
  readonly datePrecision: GiftRowRecord["datePrecision"];
  readonly designation?: string;
  readonly attribution: GiftRowRecord["attribution"];
  readonly refundOf?: string;
  readonly provenance: GiftRowRecord["provenance"];
  readonly entryOn: CivilDate;
}
interface ReportSupportProjection {
  readonly supportSubjectId: string;
  readonly basis: SupportProjectionRecord["basis"];
  readonly currencyExponents: Readonly<Record<string, number>>;
  readonly coverage: Coverage;
  readonly asOf: string;
  readonly lastSourceUpdate: string;
  readonly source: SourceReference;
  readonly goal?: NonNullable<SupportProjectionRecord["goal"]>;
  readonly gifts: readonly ReportGiftRow[];
  readonly commitments: readonly CommitmentRow[];
}
function toReportGiftRow(record: GiftRowRecord): ReportGiftRow {
  const originalGiftOn = readStatedDateOrNull(record.originalGiftOn, "gift date");
  return {
    giftRowId: record.giftRowId,
    giftId: record.giftId,
    ...(record.allocationId === null ? {} : { allocationId: record.allocationId }),
    amount: record.amount,
    ...(originalGiftOn === undefined ? {} : { originalGiftOn }),
    datePrecision: record.datePrecision,
    ...(record.designation === null ? {} : { designation: record.designation }),
    attribution: record.attribution,
    ...(record.refundOf === null ? {} : { refundOf: record.refundOf }),
    provenance: record.provenance,
    entryOn: readStatedDate(record.entryOn, "gift entry date"),
  };
}
function toCommitmentRow(record: CommitmentRowRecord): CommitmentRow {
  const lastSuccessfulOn = readStatedDateOrNull(record.lastSuccessfulOn, "commitment date");
  const nextEligibleOn = readStatedDateOrNull(record.nextEligibleOn, "commitment date");
  const resumeOn = readStatedDateOrNull(record.pause.resumeOn, "commitment pause date");
  return {
    commitmentRowId: record.commitmentRowId,
    kind: record.kind,
    cadence: record.cadence,
    perOccurrence: record.perOccurrence,
    bucketState: record.bucketState,
    ...(lastSuccessfulOn === undefined ? {} : { lastSuccessfulOn }),
    ...(nextEligibleOn === undefined ? {} : { nextEligibleOn }),
    pause: resumeOn === undefined ? { state: record.pause.state } : { state: record.pause.state, resumeOn },
    ...(record.fixedTotal === null ? {} : { fixedTotal: record.fixedTotal }),
  };
}
function buildSupportProjection(input: {
  readonly projectionRecord: SupportProjectionRecord;
  readonly gifts: readonly GiftRowRecord[];
  readonly commitments: readonly CommitmentRowRecord[];
  readonly asOf: string;
}): ReportSupportProjection {
  const record = input.projectionRecord;
  return {
    supportSubjectId: record.supportSubjectId,
    basis: record.basis,
    currencyExponents: record.currencyExponents,
    coverage: record.coverage,
    asOf: input.asOf,
    lastSourceUpdate: record.lastSourceUpdate,
    source: record.source,
    ...(record.goal === null ? {} : { goal: record.goal }),
    gifts: input.gifts.map(toReportGiftRow),
    commitments: input.commitments.map(toCommitmentRow),
  };
}
function statedSupportFigure(input: {
  readonly projectionRecord: SupportProjectionRecord;
  readonly gifts: readonly GiftRowRecord[];
  readonly commitments: readonly CommitmentRowRecord[];
  readonly scope: Scope;
  readonly asOf: string;
}): HomeSupportFigure {
  const projection = buildSupportProjection(input);
  const built = buildReportQuery({
    reportId: "received-period-and-year-to-date",
    scope: {
      organizationId: input.scope.organizationId,
      ministryId: input.scope.ministryId,
      supportSubjectId: input.scope.supportSubjectId,
      principalId: input.scope.principalId,
    },
    period: { kind: "preset", preset: "this-month" },
    currency: { kind: "all" },
    timeZone: HOME_TIME_ZONE,
  });
  if (!built.ok) {
    throw new TypeError(`The Home support query was refused on ${built.problems.map((problem) => problem.field).join(", ")}, so no received-support figure is stated.`);
  }
  const result = runReport(built.query, projection);
  return {
    state: "stated",
    source: result.snapshot.source,
    asOf: result.snapshot.asOf,
    period: {
      from: serialiseCivilDate(result.snapshot.period.from),
      to: serialiseCivilDate(result.snapshot.period.to),
      state: result.snapshot.period.state,
    },
    coverage: result.snapshot.coverage,
    amounts: result.summary.map((summary) => ({
      currency: summary.currency,
      exponent: summary.exponent ?? null,
      minorUnits: summary.received.minorUnits,
      valueState: summary.received.valueState,
    })),
  };
}
function unavailableSupportFigure(record: SupportProjectionRecord, asOf: string): HomeSupportFigure {
  return {
    state: "unavailable",
    source: record.source,
    asOf,
    period: null,
    coverage: record.coverage,
    amounts: [],
  };
}
function recordedStateOf(amount: HomeSupportAmount): RecordedValueState {
  switch (amount.valueState) {
    case "value":
    case "zero":
    case "unknown":
    case "withheld":
    case "unavailable":
      return amount.valueState;
    case "incomplete-subtotal":
      return amount.minorUnits === 0 ? "zero" : "value";
  }
}
// Home: building one item per record
interface HomeBuildContext {
  readonly session: ResolvedSession;
  readonly scope: Scope;
  readonly today: CivilDate | undefined;
}
function action(name: string, available: boolean, reason: string): ReadAction {
  return available ? { name, available: true } : { name, available: false, reason };
}
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
  return {
    itemId: input.itemId,
    section: input.section,
    reason: input.reason,
    destination: input.destination,
    label: input.label,
    status: input.status,
    onDate: input.onDate ?? null,
    locale: input.locale ?? null,
    ...(input.figure === undefined ? {} : { figure: input.figure }),
  };
}
function compareByDayThenId(left: HomeItem, right: HomeItem): number {
  const leftDay = left.onDate ?? "";
  const rightDay = right.onDate ?? "";
  return leftDay === rightDay ? compareCodeUnits(left.itemId, right.itemId) : compareCodeUnits(leftDay, rightDay);
}
function seriesPlanReviewItems(series: readonly TaskSeriesRecord[], context: HomeBuildContext): readonly HomeItem[] {
  const items: HomeItem[] = [];
  for (const entry of [...series].sort((left, right) => compareCodeUnits(left.seriesId, right.seriesId))) {
    if (!entry.planNeedsReview || entry.state === "stopped") {
      continue;
    }
    const view = canView(context.session, {
      kind: "series",
      scope: context.scope,
      ownerPrincipalId: entry.ownerPrincipalId,
    });
    if (!view.allowed) {
      continue;
    }
    items.push(
      homeItem({
        itemId: `series:${entry.seriesId}`,
        section: "attention",
        reason: "series-plan-needs-review",
        destination: `/work/series/${entry.seriesId}`,
        label: entry.title,
        status: "needs-review",
      }),
    );
  }
  return items;
}
function taskItems(
  tasks: readonly TaskRecord[],
  planReviewSeriesIds: ReadonlySet<string>,
  context: HomeBuildContext,
): {
  readonly attention: readonly HomeItem[];
  readonly information: readonly HomeItem[];
  readonly unfinished: readonly HomeItem[];
} {
  const attention: HomeItem[] = [];
  const information: HomeItem[] = [];
  const unfinished: HomeItem[] = [];
  const dated: { readonly task: TaskRecord; readonly day: CivilDate }[] = [];
  for (const task of [...tasks].sort((left, right) => compareCodeUnits(left.taskId, right.taskId))) {
    if (task.status !== "open" && task.status !== "reopened") {
      continue;
    }
    if (task.seriesId !== null && planReviewSeriesIds.has(task.seriesId)) {
      continue;
    }
    const view = canView(context.session, {
      kind: "task",
      scope: context.scope,
      ownerPrincipalId: task.ownerPrincipalId,
    });
    if (!view.allowed) {
      continue;
    }
    const parsed = task.dueOn === null ? undefined : parseCivilDate(task.dueOn);
    if (parsed === undefined || parsed.status === "refused") {
      // An undated task, and one whose stored day the calendar cannot read, are never given an
      // invented date and never hidden: the Work list's Undated list is where the record is decided.
      unfinished.push(taskHomeItem(task, "unfinished-work", "task-undated", "undated", null));
      continue;
    }
    dated.push({ task, day: parsed.date });
  }
  const today = context.today;
  for (const { task, day } of dated) {
    const onDate = serialiseCivilDate(day);
    if (today === undefined) {
      // Without a resolved day boundary nothing is called overdue or due today: the item states the
      // day it is due and the Work list owns the judgement.
      information.push(taskHomeItem(task, "information", "task-upcoming", "upcoming", onDate));
      continue;
    }
    const order = Temporal.PlainDate.compare(day, today);
    if (order < 0) {
      attention.push(taskHomeItem(task, "attention", "task-overdue", "overdue", onDate));
    } else if (order === 0) {
      attention.push(taskHomeItem(task, "attention", "task-due-today", "due-today", onDate));
    } else {
      information.push(taskHomeItem(task, "information", "task-upcoming", "upcoming", onDate));
    }
  }
  attention.sort(compareByDayThenId);
  information.sort(compareByDayThenId);
  unfinished.sort(compareByDayThenId);
  return { attention, information, unfinished };
}
function taskHomeItem(task: TaskRecord, section: HomeSection, reason: HomeReasonKey, status: HomeItemStatus, onDate: string | null): HomeItem {
  return homeItem({
    itemId: `task:${task.taskId}`,
    section,
    reason,
    destination: "/work",
    label: task.title,
    status,
    onDate,
  });
}
function commitmentAttentionItems(commitments: readonly CommitmentRowRecord[], context: HomeBuildContext): readonly HomeItem[] {
  const view = canView(context.session, {
    kind: "support-subject",
    scope: context.scope,
    capabilities: [],
  });
  if (!view.allowed) {
    return [];
  }
  return commitments
    .filter((record) => record.bucketState === "recovery-needs-attention")
    .sort((left, right) => compareCodeUnits(left.commitmentRowId, right.commitmentRowId))
    .map((record) =>
      homeItem({
        itemId: `commitment:${record.commitmentRowId}`,
        section: "attention",
        reason: "commitment-needs-attention",
        destination: `/support/commitments/${record.commitmentRowId}`,
        label: record.cadence,
        status: "needs-attention",
      }),
    );
}
function notificationItems(intents: readonly NotificationIntentRecord[], results: readonly NotificationSendResultRecord[], context: HomeBuildContext): readonly HomeItem[] {
  // Delivery belongs to the publication family — an intent names the document and the release it was
  // recorded for — so the permission that gates an edition gates its send results too, and a caller
  // who may not read the edition is not shown that a notice for it exists.
  const view = canView(context.session, { kind: "content-variant", scope: context.scope });
  if (!view.allowed) {
    return [];
  }
  const resultsByIntent = new Map<string, NotificationSendResultRecord[]>();
  for (const result of results) {
    const existing = resultsByIntent.get(result.intentId);
    if (existing === undefined) {
      resultsByIntent.set(result.intentId, [result]);
    } else {
      existing.push(result);
    }
  }
  const items: HomeItem[] = [];
  for (const intent of [...intents].sort((left, right) => compareCodeUnits(left.intentId, right.intentId))) {
    const outcomes = resultsByIntent.get(intent.intentId) ?? [];
    const needsAttention = outcomes.length === 0 || outcomes.some((outcome) => outcome.recipients.some((copy) => copy.state !== "accepted"));
    if (!needsAttention) {
      continue;
    }
    const lastRecordedAt = outcomes.at(-1)?.recordedAt ?? null;
    items.push(
      homeItem({
        itemId: `notification:${intent.intentId}`,
        section: "unfinished-work",
        reason: "notification-needs-attention",
        destination: "/communication/delivery",
        label: null,
        status: "needs-attention",
        onDate: lastRecordedAt === null ? null : civilDayOf(lastRecordedAt),
      }),
    );
  }
  return items;
}
function interactionItems(interactions: readonly InteractionRecord[], partners: readonly PartnerRecord[], context: HomeBuildContext): readonly HomeItem[] {
  const view = canView(context.session, { kind: "interaction", scope: context.scope });
  if (!view.allowed) {
    return [];
  }
  const partnersById = new Map(partners.map((partner) => [partner.partnerId, partner]));
  const items: HomeItem[] = [];
  for (const record of interactions) {
    const partner = partnersById.get(record.partnerId);
    if (partner === undefined) {
      continue;
    }
    const partnerView = canView(context.session, {
      kind: "partner",
      scope: context.scope,
      audience: partner.audience,
      authorPrincipalId: context.session.principalId,
    });
    if (!partnerView.allowed) {
      continue;
    }
    items.push(
      homeItem({
        itemId: `interaction:${record.interactionId}`,
        section: "information",
        reason: "interaction-recorded",
        destination: `/partners/${partner.partnerId}`,
        label: partner.displayName,
        status: "recorded",
        onDate: record.occurredOn,
      }),
    );
  }
  items.sort((left, right) => {
    const leftDay = left.onDate ?? "";
    const rightDay = right.onDate ?? "";
    return leftDay === rightDay ? compareCodeUnits(left.itemId, right.itemId) : compareCodeUnits(rightDay, leftDay);
  });
  return items.slice(0, RECENT_INTERACTION_LIMIT);
}
function referralItems(referrals: readonly ReferralCycleRecord[], partners: readonly PartnerRecord[], context: HomeBuildContext): readonly HomeItem[] {
  const view = canView(context.session, { kind: "referral", scope: context.scope });
  if (!view.allowed) {
    return [];
  }
  const partnersById = new Map(partners.map((partner) => [partner.partnerId, partner]));
  const now = instantAt(context.session.clockOffsetMs);
  const items: HomeItem[] = [];
  for (const cycle of [...referrals].sort((left, right) => compareCodeUnits(left.referralId, right.referralId))) {
    if (cycle.consumed) {
      // A consumed cycle has already produced its one successor: its window is settled history, not
      // a window changing state, and reporting it here would state a deadline that no longer matters.
      continue;
    }
    const windowEnd = readInstant(cycle.windowEnd);
    if (windowEnd === undefined) {
      continue;
    }
    const state = referralWindowState({ windowEnd, now });
    if (state.status !== "active" && state.status !== "expired") {
      continue;
    }
    const partner = partnersById.get(cycle.partnerId);
    items.push(
      homeItem({
        itemId: `referral:${cycle.referralId}`,
        section: "information",
        reason: state.status === "active" ? "referral-window-active" : "referral-window-expired",
        destination: `/partners/referrals/${cycle.referralId}`,
        label: partner?.displayName ?? null,
        status: state.status,
      }),
    );
  }
  return items;
}
function contentItems(documents: readonly ContentDocumentRecord[], variants: readonly ContentVariantRecord[], context: HomeBuildContext): readonly HomeItem[] {
  const view = canView(context.session, { kind: "content-variant", scope: context.scope });
  if (!view.allowed) {
    return [];
  }
  const documentsById = new Map(documents.map((document) => [document.documentId, document]));
  const items: HomeItem[] = [];
  for (const variant of [...variants].sort((left, right) => compareCodeUnits(left.variantId, right.variantId))) {
    const document = documentsById.get(variant.documentId);
    if (document === undefined) {
      continue;
    }
    const destination = contentDestination(document, variant);
    if (variant.candidateId !== null) {
      items.push(
        homeItem({
          itemId: `variant:${variant.variantId}`,
          section: "unfinished-work",
          reason: "candidate-awaiting-review",
          destination,
          label: document.kind,
          status: "awaiting-review",
          locale: variant.locale,
        }),
      );
      continue;
    }
    if (variant.draftRevisionId !== null) {
      items.push(
        homeItem({
          itemId: `variant:${variant.variantId}`,
          section: "unfinished-work",
          reason: "draft-saved",
          destination,
          label: document.kind,
          status: "draft",
          locale: variant.locale,
        }),
      );
    }
  }
  return items;
}
function contentDestination(document: ContentDocumentRecord, variant: ContentVariantRecord): string {
  return document.family === "update" ? `/communication/${document.documentId}/${variant.variantId}` : `/pages/${document.documentId}`;
}
function importItems(proposals: readonly ImportProposalRecord[], context: HomeBuildContext): readonly HomeItem[] {
  const view = canView(context.session, {
    kind: "partner",
    scope: context.scope,
    audience: "private",
    authorPrincipalId: context.session.principalId,
  });
  if (!view.allowed) {
    return [];
  }
  return proposals
    .filter((proposal) => proposal.processedAt === null)
    .sort((left, right) => compareCodeUnits(left.importOperationId, right.importOperationId))
    .map((proposal) =>
      homeItem({
        itemId: `import:${proposal.importOperationId}`,
        section: "unfinished-work",
        reason: "import-awaiting-decisions",
        destination: "/partners/import",
        label: null,
        status: "awaiting-review",
      }),
    );
}
function targetItems(targets: readonly CoachingTargetRecord[], context: HomeBuildContext): readonly HomeItem[] {
  return targets
    .filter((target) => target.workerPrincipalId === context.session.principalId && target.homePlacement === "placed" && target.state !== "ended")
    .sort((left, right) => compareCodeUnits(left.targetId, right.targetId))
    .map((target) =>
      homeItem({
        itemId: `target:${target.targetId}`,
        section: "information",
        reason: "target-placed-on-home",
        destination: "/coaching/targets",
        label: target.privateLabel,
        status: target.state === "paused" ? "paused" : "placed",
      }),
    );
}
function supportItem(figure: HomeSupportFigure): HomeItem {
  return homeItem({
    itemId: SUPPORT_ITEM_ID,
    section: "information",
    reason: "support-received-this-period",
    destination: "/support",
    label: null,
    status: "received",
    figure,
  });
}
function civilDayOf(value: string): string | null {
  const instant = readInstant(value);
  if (instant === undefined) {
    return null;
  }
  const resolved = civilDateAt(instant, HOME_TIME_ZONE);
  return resolved.status === "resolved" ? serialiseCivilDate(resolved.date) : null;
}
// Scope and admission, shared by the three reads
function envelopeResult<T>(envelope: ReadEnvelope<T>): ReadResult<ReadEnvelope<T>> {
  return { kind: "envelope", envelope };
}
interface StoredSelection {
  readonly context: AdmissionContext;
  readonly scope: Scope;
}
function selectionOf(record: SessionContextRecord): StoredSelection | undefined {
  const { selectedOrganizationId, selectedMinistryId, selectedSupportSubjectId } = record;
  if (selectedOrganizationId === null || selectedMinistryId === null || selectedSupportSubjectId === null) {
    return undefined;
  }
  return {
    context: {
      organizationId: selectedOrganizationId,
      ministryId: selectedMinistryId,
      supportSubjectId: selectedSupportSubjectId,
    },
    scope: {
      organizationId: selectedOrganizationId,
      ministryId: selectedMinistryId,
      supportSubjectId: selectedSupportSubjectId,
      principalId: record.principalId,
    },
  };
}
function groupAdmissions(memberships: readonly AdmittedMembership[], selected: AdmissionContext | undefined): readonly ContextChooserGroup[] {
  const groups = new Map<string, { organizationLabel: string; ministries: AdmittedMinistryEntry[] }>();
  for (const membership of memberships) {
    const existing = groups.get(membership.organizationId) ?? { organizationLabel: "", ministries: [] };
    // A blank label means the source of record named no name for that context: the surface then shows
    // the opaque reference rather than a blank presented as a name. The name is never derived here.
    existing.ministries.push({
      ministryId: membership.ministryId,
      ministryLabel: membership.ministryLabel ?? "",
      supportSubjectId: membership.supportSubjectId,
      selected:
        selected !== undefined && selected.organizationId === membership.organizationId && selected.ministryId === membership.ministryId && selected.supportSubjectId === membership.supportSubjectId,
    });
    // Understood only from the memberships' own statements, the group states the first name any of
    // them gives its organisation, and stays blank while none of them names one.
    if (existing.organizationLabel === "" && membership.organizationLabel !== undefined) {
      existing.organizationLabel = membership.organizationLabel;
    }
    groups.set(membership.organizationId, existing);
  }
  return [...groups.entries()].map(([organizationId, group]) => ({
    organizationId,
    organizationLabel: group.organizationLabel,
    ministries: group.ministries,
  }));
}
function admittedMinistryCount(memberships: readonly AdmittedMembership[]): number {
  const distinct = new Set(memberships.map((membership) => `${membership.organizationId}::${membership.ministryId}`));
  return distinct.size;
}
function admissionActions(session: ResolvedSession): readonly ReadAction[] {
  switch (session.sessionState) {
    case "signed-in": {
      const ministryCount = admittedMinistryCount(session.admittedMemberships);
      return [
        action(
          "selectContext",
          ministryCount > 1,
          ministryCount === 1
            ? "One ministry is admitted, so that context opens directly and there is nothing to choose."
            : ministryCount === 0
              ? "The session admits no ministry, so there is no context to select."
              : "Several ministries are admitted, so a context can be selected.",
        ),
      ];
    }
    case "no-access":
      return [action("selectContext", false, "This session is not admitted: the account it names holds no membership, so there is no context to select.")];
    case "denied":
      return [action("selectContext", false, "This session is not admitted, so there is no context to select.")];
    case "expired":
      return [action("selectContext", false, "This session has expired and is not admitted, so there is no context to select.")];
    case "unavailable":
      return [action("selectContext", false, "This session is unavailable and is not admitted, so there is no context to select.")];
  }
}
function supportValueStates(figure: HomeSupportFigure): Readonly<Record<string, RecordedValueState>> {
  const states: Record<string, RecordedValueState> = {};
  for (const amount of figure.amounts) {
    states[`${SUPPORT_ITEM_ID}.figure.amounts.${amount.currency}.minorUnits`] = recordedStateOf(amount);
  }
  return states;
}
// readAdmissionState
/** Reads the session's admission: which of the five states it is in, the guidance key the shell renders, and — only when admitted — the principal, the selected context and the scenario it runs. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readAdmissionState(): Promise<ReadResult<ReadEnvelope<AdmissionStateData>>> {
  const resolution = await resolveSession();
  if (!resolution.ok) {
    // No usable session is a refusal, not an empty workspace: the shell is told nothing about any
    // record, and it offers the retry or sign-in guidance it owns. A store that could not answer is
    // the different fact, and it reaches the surface as the outage it is.
    return readResultOfRefusal(resolution.refusal);
  }
  const session = resolution.session;
  const asOf = asOfText(session);
  const source = storeSource(ADMISSION_SEED_REFERENCE);
  const actions = admissionActions(session);
  const coverage: Coverage = { from: null, to: asOf, state: "complete" };
  let storedContext: SessionContextRecord;
  try {
    const documents = await readSession(session.sessionId);
    if (documents === undefined) {
      return sourceUnavailableResult("readAdmissionState", source);
    }
    const parsed = admissionDocumentSchema.safeParse(documents.state);
    if (!parsed.success) {
      return sourceUnavailableResult("readAdmissionState", source);
    }
    storedContext = parsed.data.context;
  } catch {
    return sourceUnavailableResult("readAdmissionState", source);
  }
  if (session.sessionState !== "signed-in") {
    // The four states that grant nothing state the state, its guidance and the session record's
    // revision, and no principal, membership, count or size at all.
    return envelopeResult(
      buildEnvelope<AdmissionStateData>({
        data: {
          state: session.sessionState,
          guidance: GUIDANCE_BY_STATE[session.sessionState],
          principalId: null,
          context: null,
          scenarioId: null,
        },
        scope: NO_CONTEXT_SCOPE,
        source,
        revision: storedContext.revision,
        asOf,
        coverage,
        valueStates: {},
        actions,
      }),
    );
  }
  const selection = selectionOf(storedContext);
  if (selection === undefined) {
    // Admitted, but no context chosen yet: the shell shows the chooser, and this read states no
    // context because none is in force. Nothing is assumed in its place.
    return envelopeResult(
      buildEnvelope<AdmissionStateData>({
        data: {
          state: "signed-in",
          guidance: "workspace-ready",
          principalId: session.principalId,
          context: null,
          scenarioId: session.scenarioId,
        },
        scope: NO_CONTEXT_SCOPE,
        source,
        revision: storedContext.revision,
        asOf,
        coverage,
        valueStates: {},
        actions,
      }),
    );
  }
  const admission = assertScope(session, selection.scope);
  if (!admission.ok) {
    return { kind: "denied", denied: admission.denial };
  }
  return envelopeResult(
    buildEnvelope<AdmissionStateData>({
      data: {
        state: "signed-in",
        guidance: "workspace-ready",
        principalId: session.principalId,
        context: selection.context,
        scenarioId: session.scenarioId,
      },
      scope: selection.scope,
      source,
      revision: storedContext.revision,
      asOf,
      coverage,
      valueStates: {},
      actions,
    }),
  );
}
// readContextChooser
/** Reads the memberships this session may act in, grouped by organisation and ministry, with the one in force marked and `directEntry` set when a single ministry makes a chooser unnecessary. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readContextChooser(): Promise<ReadResult<ReadEnvelope<ContextChooserData>>> {
  const resolution = await resolveSession();
  if (!resolution.ok) {
    return readResultOfRefusal(resolution.refusal);
  }
  const session = resolution.session;
  if (session.sessionState !== "signed-in") {
    // A session that cannot act enumerates nothing. Which state it is in is `readAdmissionState`'s
    // answer, and a denial never carries it.
    return deniedResult<ContextChooserData>("not-admitted");
  }
  const asOf = asOfText(session);
  const source = storeSource(CHOOSER_SEED_REFERENCE);
  let storedContext: SessionContextRecord;
  try {
    const documents = await readSession(session.sessionId);
    if (documents === undefined) {
      return sourceUnavailableResult("readContextChooser", source);
    }
    const parsed = admissionDocumentSchema.safeParse(documents.state);
    if (!parsed.success) {
      return sourceUnavailableResult("readContextChooser", source);
    }
    storedContext = parsed.data.context;
  } catch {
    return sourceUnavailableResult("readContextChooser", source);
  }
  const selection = selectionOf(storedContext);
  const groups = groupAdmissions(session.admittedMemberships, selection?.context);
  const ministryCount = admittedMinistryCount(session.admittedMemberships);
  const data: ContextChooserData = { directEntry: ministryCount === 1, groups };
  return envelopeResult(
    buildEnvelope<ContextChooserData>({
      data,
      scope: selection?.scope ?? NO_CONTEXT_SCOPE,
      source,
      revision: storedContext.revision,
      asOf,
      coverage: { from: null, to: asOf, state: "complete" },
      valueStates: {},
      actions: [
        action(
          "selectContext",
          ministryCount > 1,
          ministryCount === 1 ? "One ministry is admitted, so the workspace opens directly and no chooser is offered." : "The session admits no ministry, so there is no context to select.",
        ),
      ],
    }),
  );
}
// readHome
/** Reads the worker's day as Attention, Information and Unfinished work, every item carrying why it is there and where it goes, with received support stated through the one report computation. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readHome(): Promise<ReadResult<ReadEnvelope<HomeData>>> {
  const resolution = await resolveSession();
  if (!resolution.ok) {
    return readResultOfRefusal(resolution.refusal);
  }
  const session = resolution.session;
  if (session.sessionState !== "signed-in") {
    return deniedResult<HomeData>("not-admitted");
  }
  const at = instantAt(session.clockOffsetMs);
  const asOf = at.toString();
  const source = storeSource(HOME_SEED_REFERENCE);
  let document: HomeDocument;
  let workloadGifts: readonly GiftRowRecord[] = [];
  try {
    const documents = await readSession(session.sessionId);
    if (documents === undefined) {
      return sourceUnavailableResult("readHome", source);
    }
    const parsed = homeDocumentSchema.safeParse(documents.state);
    if (!parsed.success) {
      return sourceUnavailableResult("readHome", source);
    }
    document = parsed.data;
    if (documents.workload !== undefined) {
      const workload = workloadGiftDocumentSchema.safeParse(documents.workload);
      if (!workload.success) {
        return sourceUnavailableResult("readHome", source);
      }
      workloadGifts = workload.data.gifts;
    }
  } catch {
    return sourceUnavailableResult("readHome", source);
  }
  const selection = selectionOf(document.context);
  if (selection === undefined) {
    // Signed in with no context in force: this principal may not enumerate a ministry's work, and an
    // empty Home would be indistinguishable from a quiet day. A principal admitted to nothing and one
    // that has simply not chosen yet are told apart by the reason code, which is the only fact a
    // refusal may carry.
    return deniedResult<HomeData>(session.admittedMemberships.length === 0 ? "no-membership" : "not-admitted");
  }
  const admission = assertScope(session, selection.scope);
  if (!admission.ok) {
    return { kind: "denied", denied: admission.denial };
  }
  const build: HomeBuildContext = { session, scope: selection.scope, today: todayFor(at) };
  const figure =
    document.supportProjection === null
      ? undefined
      : homeSupportFigure({
          projectionRecord: document.supportProjection,
          gifts: document.gifts,
          workloadGifts,
          commitments: document.commitments,
          scope: selection.scope,
          asOf,
        });
  const planReviewSeriesIds = new Set(document.series.filter((entry) => entry.planNeedsReview).map((entry) => entry.seriesId));
  const taskPartition = taskItems(document.tasks, planReviewSeriesIds, build);
  const attention: HomeItem[] = [...seriesPlanReviewItems(document.series, build), ...commitmentAttentionItems(document.commitments, build), ...taskPartition.attention];
  const information: HomeItem[] = [
    ...(figure === undefined ? [] : [supportItem(figure)]),
    ...referralItems(document.referrals, document.partners, build),
    ...interactionItems(document.interactions, document.partners, build),
    ...taskPartition.information,
    ...targetItems(document.coachingTargets, build),
  ];
  const unfinished: HomeItem[] = [
    ...contentItems(document.contentDocuments, document.contentVariants, build),
    ...importItems(document.importProposals, build),
    ...notificationItems(document.notificationIntents, document.notificationResults, build),
    ...taskPartition.unfinished,
  ];
  const items: readonly HomeItem[] = [...attention, ...information, ...unfinished];
  const coverage: Coverage = figure?.coverage ?? { from: null, to: asOf, state: "complete" };
  const hasDueWork = items.some((item) => item.reason === "task-overdue" || item.reason === "task-due-today");
  const hasPlanReview = items.some((item) => item.reason === "series-plan-needs-review");
  const hasNotificationAttention = items.some((item) => item.reason === "notification-needs-attention");
  return envelopeResult(
    buildEnvelope<HomeData>({
      data: { items },
      scope: selection.scope,
      source,
      revision: document.context.revision,
      asOf,
      coverage,
      valueStates: figure === undefined ? {} : supportValueStates(figure),
      actions: [
        action("completeTask", hasDueWork, "No open task is dated for today or earlier."),
        action("resolveMissedPlan", hasPlanReview, "No recurring plan needs review."),
        action("requestNotification", hasNotificationAttention, "No published edition has a notification that needs attention."),
      ],
    }),
  );
}
function homeSupportFigure(input: {
  readonly projectionRecord: SupportProjectionRecord;
  readonly gifts: readonly GiftRowRecord[];
  readonly workloadGifts: readonly GiftRowRecord[];
  readonly commitments: readonly CommitmentRowRecord[];
  readonly scope: Scope;
  readonly asOf: string;
}): HomeSupportFigure {
  try {
    return statedSupportFigure({
      projectionRecord: input.projectionRecord,
      gifts: [...input.gifts, ...input.workloadGifts],
      commitments: input.commitments,
      scope: input.scope,
      asOf: input.asOf,
    });
  } catch {
    logger.sourceUnavailable({ job: "readHome", source: input.projectionRecord.source });
    return unavailableSupportFigure(input.projectionRecord, input.asOf);
  }
}
