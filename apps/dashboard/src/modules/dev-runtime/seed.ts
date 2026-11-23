import { Temporal } from "temporal-polyfill";
import type { SourceReference } from "@/lib/ids";
import { checksum, CONTENT_PROFILE_VERSION, type ContentDirection, type ContentDocumentJson, type ContentSection, type PresentationChoice } from "@/modules/content/document";
import type {
  AdmittedMembership,
  CoachingCheckInRecord,
  CoachingDurationRecord,
  CoachingGrantRecord,
  CoachingInvitationRecord,
  CoachingModuleSelection,
  CoachingTargetPeriodRecord,
  CoachingTargetRecord,
  CoachingTargetVersionRecord,
  CommitmentRowRecord,
  ContentAudience,
  ContentDocumentRecord,
  ContentRevisionRecord,
  ContentVariantRecord,
  CoverageState,
  GiftRowRecord,
  ImportProposalRecord,
  InitiativeMemberRecord,
  InitiativeRecord,
  InteractionRecord,
  MediaAssetProfileRecord,
  MediaAssetRecord,
  MediaAssetRenditionPurpose,
  MediaAssetRenditionRecord,
  MembershipRecord,
  MembershipState,
  MinistryId,
  NotificationIntentRecord,
  NotificationRecipientOutcomeRecord,
  NotificationSendResultRecord,
  OperationRecord,
  OrganizationId,
  PartnerKind,
  PartnerRecord,
  PrincipalId,
  PrivateNoteRecord,
  ReferralCycleRecord,
  ReleaseReach,
  ReleaseRecord,
  RequestRecord,
  Scope,
  SessionContextRecord,
  SupportSubjectId,
  SupportProjectionRecord,
  TaskRecord,
  TaskSeriesRecord,
} from "@/modules/data-service/envelope";
import type { PublishMode, ReviewDecision } from "@/modules/data-service/mutations/content";
import { minorUnitsOf, type Money } from "@/modules/money/amount";
import { UNKNOWN_CURRENCY } from "@/modules/money/currency";
import { seededMediaReference } from "@/modules/store/media";
import type { SessionDocuments } from "@/modules/store/paths";
import type { CommitmentKind, RecurringBucket } from "@/modules/support/buckets";
import { GOAL_CAPABILITY, GOAL_MEASURE } from "@/modules/support/goal";
import { SEED_INSTANT } from "@/modules/time/clock";
import { startOfCivilDay } from "@/modules/time/civil";
import { REFERRAL_SOURCE_ZONE, confirmationDeadline, continuedWindowEnd, newWindowEnd } from "@/modules/time/window";
import { buildSessionMeta, DEFAULT_SCENARIO_ID, type PersistedPersonaKind, type PersistedPersonaRecord, type ScenarioId, type SessionMetaDocument, type SessionState } from "./scenario";
export const SESSION_STATE_VERSION = 1;
export const OPERATION_LEDGER_VERSION = 1;
const INITIAL_REVISION = "rev-1";
const REFERRAL_NEW_WINDOW_DAYS = 14;
const REFERRAL_CONTINUATION_DAYS = 30;
const identifier = <Brand extends string>(value: string): Brand => value as Brand;
const ORGANIZATION_HARBOUR: OrganizationId = identifier<OrganizationId>("org-harbour");
const MINISTRY_YOUTH: MinistryId = identifier<MinistryId>("min-harbour-youth");
const MINISTRY_STUDENTS: MinistryId = identifier<MinistryId>("min-harbour-students");
const SUPPORT_SUBJECT_YOUTH: SupportSubjectId = identifier<SupportSubjectId>("sup-harbour-youth");
const SUPPORT_SUBJECT_STUDENTS: SupportSubjectId = identifier<SupportSubjectId>("sup-harbour-students");
const ORGANIZATION_RIVERBEND: OrganizationId = identifier<OrganizationId>("org-riverbend");
const MINISTRY_OUTREACH: MinistryId = identifier<MinistryId>("min-riverbend-outreach");
const SUPPORT_SUBJECT_OUTREACH: SupportSubjectId = identifier<SupportSubjectId>("sup-riverbend-outreach");
const PRINCIPAL_NEW_WORKER: PrincipalId = identifier<PrincipalId>("principal-new-worker");
const PRINCIPAL_ESTABLISHED: PrincipalId = identifier<PrincipalId>("principal-established-worker");
const PRINCIPAL_SECOND: PrincipalId = identifier<PrincipalId>("principal-second-worker");
const PRINCIPAL_DEPUTIZED: PrincipalId = identifier<PrincipalId>("principal-deputized-fundraiser");
const PRINCIPAL_COACH: PrincipalId = identifier<PrincipalId>("principal-coach");
const PRINCIPAL_REVIEWER: PrincipalId = identifier<PrincipalId>("principal-content-reviewer");
const PRINCIPAL_READER_PUBLIC: PrincipalId = identifier<PrincipalId>("principal-reader-public");
const PRINCIPAL_READER_SUPPORTER: PrincipalId = identifier<PrincipalId>("principal-reader-approved-supporter");
const PRINCIPAL_READER_UNAUTHORIZED: PrincipalId = identifier<PrincipalId>("principal-reader-unauthorized");
const PRINCIPAL_SUBSCRIBER: PrincipalId = identifier<PrincipalId>("principal-subscriber");
const PRINCIPAL_NO_ACCESS: PrincipalId = identifier<PrincipalId>("principal-no-access-user");
const PRINCIPAL_UNAVAILABLE: PrincipalId = identifier<PrincipalId>("principal-unavailable-session");
const PRINCIPAL_DENIED: PrincipalId = identifier<PrincipalId>("principal-denied-session");
const PRINCIPAL_EXPIRED: PrincipalId = identifier<PrincipalId>("principal-expired-session");
const PUBLISHER_HARBOUR = "publisher-harbour";
const HARBOUR_YOUTH: AdmittedMembership = { organizationId: ORGANIZATION_HARBOUR, ministryId: MINISTRY_YOUTH, supportSubjectId: SUPPORT_SUBJECT_YOUTH, organizationLabel: "Harbour Community Church", ministryLabel: "Youth Ministry" };
const HARBOUR_STUDENTS: AdmittedMembership = { organizationId: ORGANIZATION_HARBOUR, ministryId: MINISTRY_STUDENTS, supportSubjectId: SUPPORT_SUBJECT_STUDENTS, organizationLabel: "Harbour Community Church", ministryLabel: "Students Ministry" };
const HARBOUR_BOTH: readonly AdmittedMembership[] = [HARBOUR_YOUTH, HARBOUR_STUDENTS];
const RIVERBEND_OUTREACH: AdmittedMembership = { organizationId: ORGANIZATION_RIVERBEND, ministryId: MINISTRY_OUTREACH, supportSubjectId: SUPPORT_SUBJECT_OUTREACH, organizationLabel: "Riverbend Chapel", ministryLabel: "Outreach" };
export type SeededWorkspace = "new-worker" | "established-worker" | "established-worker-partial-release" | "students-ministry" | "second-worker" | "coach" | "subscriber" | "reader-approved-supporter" | "empty";
export type SeededContext = { readonly organizationId: OrganizationId; readonly ministryId: MinistryId; readonly supportSubjectId: SupportSubjectId };
export type PersonaId = "new-worker" | "established-worker" | "second-worker" | "fundraiser" | "coach" | "reviewer" | "reader-public" | "reader-approved-supporter" | "reader-unauthorized" | "subscriber";
const PERSONA_ROSTER_ORDER: readonly PersonaId[] = Object.freeze(["new-worker", "established-worker", "second-worker", "fundraiser", "reviewer", "coach", "reader-public", "reader-approved-supporter", "reader-unauthorized", "subscriber"]);
const GOAL_CAPABLE_PERSONAS: readonly PersonaId[] = Object.freeze(["new-worker", "established-worker", "second-worker", "fundraiser"]); // The personas that hold the goal capability, so the roster below states each one's capabilities once.
const CAPABILITIES_BY_PERSONA: Readonly<Record<PersonaId, readonly string[]>> = Object.freeze(Object.fromEntries(PERSONA_ROSTER_ORDER.map((persona) => [persona, Object.freeze(GOAL_CAPABLE_PERSONAS.includes(persona) ? [GOAL_CAPABILITY] : [])])) as Record<PersonaId, readonly string[]>);
export type SeededPersona = { readonly id: PersonaId; readonly principalId: PrincipalId; readonly kind: PersistedPersonaKind; readonly label: string; readonly defaultSessionId: string; readonly description: string };
export const DEFAULT_SESSION_ID = "established-worker";
export interface SeededSession {
  readonly sessionId: string;
  readonly persona: PersonaId;
  readonly label: string;
  readonly description: string;
  readonly principalId: PrincipalId;
  readonly admittedMemberships: readonly AdmittedMembership[];
  readonly sessionState: SessionState;
  readonly scenarioId: ScenarioId;
  readonly selectedContext: SeededContext | null;
  readonly workspace: SeededWorkspace;
  readonly documents?: SeededSessionDocuments;
}
export type SeededSessionDocuments = { readonly state: SessionStateDocument; readonly operations: OperationLedgerDocument; readonly meta: SessionMetaDocument };
export type SeededSessionWithDocuments = SeededSession & { readonly documents: SeededSessionDocuments };
type SeededSessionOverrides = Pick<SeededSession, "sessionState" | "scenarioId" | "selectedContext" | "workspace">;
const buildSession = (sessionId: string, persona: PersonaId, label: string, description: string, principalId: PrincipalId, admittedMemberships: readonly AdmittedMembership[], overrides: Partial<SeededSessionOverrides> = {}): SeededSession => ({
  sessionId,
  persona,
  label,
  description,
  principalId,
  admittedMemberships,
  sessionState: "signed-in",
  scenarioId: DEFAULT_SCENARIO_ID,
  selectedContext: null,
  workspace: "empty",
  ...overrides,
});
const establishedSession = (sessionId: string, label: string, description: string, overrides: Partial<SeededSessionOverrides> = {}): SeededSession =>
  buildSession(sessionId, "established-worker", label, description, PRINCIPAL_ESTABLISHED, HARBOUR_BOTH, { selectedContext: HARBOUR_YOUTH, workspace: "established-worker", ...overrides });
export const SEEDED_SESSIONS: readonly SeededSession[] = deepFreeze([
  buildSession("new-worker", "new-worker", "New worker", "No gifts, goal, subscription or integration: one private contact, one task and one Update waiting for its first draft.", PRINCIPAL_NEW_WORKER, [HARBOUR_YOUTH], { selectedContext: HARBOUR_YOUTH, workspace: "new-worker" }),
  buildSession("established-worker", "established-worker", "Established worker", "Years of gifts, recurring support, partners, drafts and pages, across two ministries.", PRINCIPAL_ESTABLISHED, HARBOUR_BOTH, { selectedContext: HARBOUR_YOUTH, workspace: "established-worker" }),
  buildSession("established-worker-students", "established-worker", "Established worker — students ministry", "The same worker with the students ministry selected: an available support source carrying no goal.", PRINCIPAL_ESTABLISHED, HARBOUR_BOTH, { selectedContext: HARBOUR_STUDENTS, workspace: "students-ministry" }),
  buildSession("second-worker", "second-worker", "Second worker", "Another ministry entirely: the isolation proof, holding none of the first scope's records.", PRINCIPAL_SECOND, [RIVERBEND_OUTREACH], { selectedContext: RIVERBEND_OUTREACH, workspace: "second-worker" }),
  buildSession("deputized-fundraiser", "fundraiser", "Deputized fundraiser", "Acting inside one admitted ministry, among the shared records and their own private work.", PRINCIPAL_DEPUTIZED, [HARBOUR_YOUTH], { selectedContext: HARBOUR_YOUTH, workspace: "established-worker" }),
  buildSession("coach", "coach", "Coach", "Read-only access to exactly the modules and periods the worker has shared.", PRINCIPAL_COACH, [], { workspace: "coach" }),
  buildSession("content-reviewer", "reviewer", "Content reviewer", "Approves frozen content candidates, and only candidates.", PRINCIPAL_REVIEWER, [HARBOUR_YOUTH], { selectedContext: HARBOUR_YOUTH, workspace: "established-worker" }),
  // A reader is admitted by the persona it previews, not by a ministry membership, so its session carries no admitted membership and has chosen no context; the one exception is the record the reader itself owns — the approved-supporter reader's membership, which its own preference controls write and which the publisher's world also holds as the copy a receiving read reaches across.
  buildSession("reader-public", "reader-public", "Public reader", "A public reader in the receiving preview, admitted to the public edition only.", PRINCIPAL_READER_PUBLIC, [], {}),
  buildSession("reader-approved-supporter", "reader-approved-supporter", "Approved-supporter reader", "A reader admitted to the approved-supporter edition, and refused the public one's siblings.", PRINCIPAL_READER_SUPPORTER, [], { workspace: "reader-approved-supporter" }),
  buildSession("reader-unauthorized", "reader-unauthorized", "Unauthorized reader", "Refused protected content honestly, with nothing about it disclosed.", PRINCIPAL_READER_UNAUTHORIZED, [], {}),
  buildSession("subscriber", "subscriber", "Subscriber", "A reader whose own membership is waiting for proof: confirmable inside its 168-hour window, with Off or Immediate available for it.", PRINCIPAL_SUBSCRIBER, [], { workspace: "subscriber" }),
  buildSession("no-access", "established-worker", "No access", "No usable account: the only honest outcome is account-recovery guidance.", PRINCIPAL_NO_ACCESS, [], { sessionState: "no-access" }),
  buildSession("session-unavailable", "established-worker", "Session state — unavailable", "Admission could not be resolved because a source is down: retry guidance, never an empty workspace.", PRINCIPAL_UNAVAILABLE, [HARBOUR_YOUTH], { sessionState: "unavailable", scenarioId: "financial-source-unavailable" }),
  buildSession("session-denied", "established-worker", "Session state — denied", "Denied with nothing disclosed: no count, title, size or existence hint.", PRINCIPAL_DENIED, [], { sessionState: "denied" }),
  buildSession("session-expired", "established-worker", "Session state — expired", "An expired session, offered a way back in rather than a blank page.", PRINCIPAL_EXPIRED, [HARBOUR_YOUTH], { sessionState: "expired" }),
  establishedSession("established-worker-media-unavailable", "Established worker — media unavailable", "One placement's source is down: the poster and text alternative stay, the prose is intact, retry is offered.", { scenarioId: "media-unavailable" }),
  establishedSession("established-worker-coaching-unavailable", "Established worker — coaching module unavailable", "One admitted coaching module's source is down, and the other admitted modules stay usable.", { scenarioId: "coaching-module-unavailable" }),
  buildSession("coach-coaching-module-unavailable", "coach", "Coach — coaching module unavailable", "One admitted coaching module's source is down, and the other admitted modules stay usable.", PRINCIPAL_COACH, [], { scenarioId: "coaching-module-unavailable", workspace: "coach" }),
  establishedSession("established-worker-continuation-on", "Established worker — continuation on", "Worker continuation is on, so an ordinarily expired referral cycle offers its single Continue action.", { scenarioId: "continuation-on" }),
  establishedSession("established-worker-continuation-off", "Established worker — continuation off", "Worker continuation is explicitly off, so the same expired cycle offers no Continue action at all.", { scenarioId: "continuation-off" }),
  establishedSession("established-worker-partial-release", "Established worker — partial release failure", "One variant of a submission released while its sibling failed, and the sibling's prior-good head was kept.", { scenarioId: "partial-release-failure", workspace: "established-worker-partial-release" }),
]);
export const SEEDED_PERSONAS: Readonly<Record<PersonaId, SeededPersona>> = deepFreeze({
  "new-worker": { id: "new-worker", principalId: PRINCIPAL_NEW_WORKER, kind: "worker", label: "New worker", defaultSessionId: "new-worker", description: "A worker with no gifts, goal, subscription or integration, starting from a private contact and a task." },
  "established-worker": { id: "established-worker", principalId: PRINCIPAL_ESTABLISHED, kind: "worker", label: "Established worker", defaultSessionId: DEFAULT_SESSION_ID, description: "A worker with years of support, recurring gifts, partners, drafts and pages, across two ministries." },
  "second-worker": { id: "second-worker", principalId: PRINCIPAL_SECOND, kind: "worker", label: "Second worker", defaultSessionId: "second-worker", description: "A worker in another organization, whose scope shares nothing with the first." },
  fundraiser: { id: "fundraiser", principalId: PRINCIPAL_DEPUTIZED, kind: "worker", label: "Deputized fundraiser", defaultSessionId: "deputized-fundraiser", description: "Someone deputized to act inside one admitted ministry, and nowhere else." },
  coach: { id: "coach", principalId: PRINCIPAL_COACH, kind: "coach", label: "Coach", defaultSessionId: "coach", description: "A coach admitted read-only to exactly the modules and periods a worker has shared, until the frozen cutoff." },
  reviewer: { id: "reviewer", principalId: PRINCIPAL_REVIEWER, kind: "reviewer", label: "Content reviewer", defaultSessionId: "content-reviewer", description: "A reviewer who approves or returns the exact frozen revisions a candidate carries, and nothing else." },
  "reader-public": { id: "reader-public", principalId: PRINCIPAL_READER_PUBLIC, kind: "reader", label: "Public reader", defaultSessionId: "reader-public", description: "A reader of the public edition, appearing only in the in-app receiving preview." },
  "reader-approved-supporter": { id: "reader-approved-supporter", principalId: PRINCIPAL_READER_SUPPORTER, kind: "reader", label: "Approved-supporter reader", defaultSessionId: "reader-approved-supporter", description: "A reader admitted to the approved-supporter edition and refused anything else." },
  "reader-unauthorized": { id: "reader-unauthorized", principalId: PRINCIPAL_READER_UNAUTHORIZED, kind: "reader", label: "Unauthorized reader", defaultSessionId: "reader-unauthorized", description: "A reader with no grant: the refusal discloses no count, title, size or existence hint." },
  subscriber: { id: "subscriber", principalId: PRINCIPAL_SUBSCRIBER, kind: "reader", label: "Subscriber", defaultSessionId: "subscriber", description: "A reader with a purpose-specific membership, choosing Off or Immediate for that purpose alone." },
} satisfies Record<PersonaId, SeededPersona>);
function seededPersonaRoster(): PersistedPersonaRecord[] {
  return PERSONA_ROSTER_ORDER.map((personaId) => {
    const persona = SEEDED_PERSONAS[personaId];
    return { id: persona.id, principalId: persona.principalId, kind: persona.kind, label: persona.label, description: persona.description };
  });
}
export const SEEDED_SESSION_IDS: readonly string[] = Object.freeze(SEEDED_SESSIONS.map((session) => session.sessionId));
export const findSeededSession = (sessionId: string): SeededSession | undefined => SEEDED_SESSIONS.find((session) => session.sessionId === sessionId);
export const isSeededSessionId = (sessionId: string): boolean => findSeededSession(sessionId) !== undefined;
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) deepFreeze(Reflect.get(value, key));
  return value;
}
const money = (currency: string, minorUnits: number): Money => ({ currency, minorUnits: minorUnitsOf(minorUnits) });
const source = (system: string, reference: string): SourceReference => ({ system, reference });
function dayStart(date: string, zone: string): Temporal.Instant {
  const start = startOfCivilDay(Temporal.PlainDate.from(date), zone);
  if (start.status === "refused") throw new RangeError(`The seed cannot resolve the start of ${date} in ${zone}: ${start.reason}.`);
  return start.instant;
}
function referralNewWindowEnd(introductionOn: string): Temporal.Instant {
  const window = newWindowEnd({ originalIntroductionOn: Temporal.PlainDate.from(introductionOn), datePrecision: "date", sourceZone: REFERRAL_SOURCE_ZONE, days: REFERRAL_NEW_WINDOW_DAYS });
  if (window.status !== "bounded") throw new RangeError(`The seed cannot bound a referral New window from ${introductionOn}: ${window.status === "refused" ? window.reason : window.reason}.`);
  return window.resolvedEndInstant;
}
function referralContinuedWindowEnd(acceptedAt: Temporal.Instant): Temporal.Instant {
  const window = continuedWindowEnd({ acceptedAt, days: REFERRAL_CONTINUATION_DAYS, cycle: { consumed: false } });
  if (window.status !== "bounded") throw new RangeError(`The seed cannot bound a referral continuation from ${acceptedAt.toString()}: ${window.reason}.`);
  return window.endInstant;
}
const membershipConfirmationDeadline = (acceptedAt: Temporal.Instant): string => confirmationDeadline({ acceptedAt, now: SEED_INSTANT }).deadlineInstant.toString();
function buildPartner(partnerId: string, kind: PartnerKind, displayName: string, overrides: Partial<PartnerRecord> = {}): PartnerRecord {
  return { partnerId, kind, displayName, nameParts: null, contactMethods: [], restrictions: [], tags: [], favourite: false, stage: null, audience: "shared", source: null, revision: INITIAL_REVISION, ...overrides };
}
const contactMethod = (kind: "email" | "phone" | "postal", value: string, permitted = true): PartnerRecord["contactMethods"][number] => ({ kind, value, permitted, verified: false });
const nameParts = (given: string, family: string): PartnerRecord["nameParts"] => ({ given, family, additional: [] });
const buildPrivateNote = (noteId: string, partnerId: string, authorPrincipalId: PrincipalId, body: string, createdAt: string): PrivateNoteRecord => ({ noteId, partnerId, authorPrincipalId, body, audience: "private", createdAt, revision: INITIAL_REVISION });
const workerParticipant = (session: SeededSession): InteractionRecord["participants"][number] => ({ role: "Worker", partnerId: null, principalId: session.principalId });
const recordedNote = (session: SeededSession, body: string, audience: NonNullable<InteractionRecord["note"]>["audience"]): NonNullable<InteractionRecord["note"]> => ({ body, audience, authorPrincipalId: session.principalId });
const memberHistory = (memberState: InitiativeMemberRecord["state"], at: string, byPrincipalId: PrincipalId, reason: string): InitiativeMemberRecord["history"][number] => ({ state: memberState, at, byPrincipalId, reason });
function buildInteraction(interactionId: string, partnerId: string, type: string, occurredOn: string | null, precision: InteractionRecord["precision"], outcome: string, overrides: Partial<InteractionRecord> = {}): InteractionRecord {
  return { interactionId, partnerId, type, occurredOn, precision, outcome, participants: [], note: null, provenance: null, revision: INITIAL_REVISION, ...overrides };
}
function buildTask(taskId: string, title: string, ownerPrincipalId: PrincipalId, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return { taskId, title, category: null, dueOn: null, plannedTime: null, timeZone: null, kind: "default", status: "open", partnerId: null, initiativeId: null, seriesId: null, ownerPrincipalId, note: null, revision: INITIAL_REVISION, ...overrides };
}
const GIFT_ROW_DEFAULTS = { designation: null, attribution: { kind: "unresolved" }, refundOf: null } as const;
function buildGift(giftRowId: string, giftId: string, currency: string, minorUnits: number, originalGiftOn: string | null, overrides: Partial<GiftRowRecord> = {}): GiftRowRecord {
  return { giftRowId, giftId, allocationId: null, amount: money(currency, minorUnits), originalGiftOn, datePrecision: originalGiftOn === null ? "unknown" : "date", ...GIFT_ROW_DEFAULTS, provenance: source("finance", giftId), entryOn: originalGiftOn ?? "2026-11-20", revision: INITIAL_REVISION, ...overrides };
}
function buildCommitment(commitmentRowId: string, kind: CommitmentKind, bucketState: RecurringBucket, currency: string, minorUnits: number, overrides: Partial<CommitmentRowRecord> = {}): CommitmentRowRecord {
  return { commitmentRowId, kind, cadence: "Monthly", perOccurrence: money(currency, minorUnits), bucketState, lastSuccessfulOn: null, nextEligibleOn: null, pause: { state: "active", resumeOn: null }, fixedTotal: null, provenance: source("finance", commitmentRowId), revision: INITIAL_REVISION, ...overrides };
}
function buildMembership(membershipId: string, email: string, state: MembershipState, overrides: Partial<MembershipRecord> = {}): MembershipRecord {
  return { membershipId, email, displayName: null, publisherId: PUBLISHER_HARBOUR, purpose: "update-email", state, acceptedAt: null, confirmationDeadline: null, languagePreference: null, revision: INITIAL_REVISION, ...overrides };
}
type SupportProjectionInput = {
  readonly supportSubjectId: SupportSubjectId;
  readonly currencyExponents: Readonly<Record<string, number>>;
  readonly coverage: { readonly from: string; readonly to: string; readonly state: CoverageState };
  readonly lastSourceUpdate: string;
  readonly sourceReference: string;
  readonly goal: SupportProjectionRecord["goal"];
};
function supportProjectionOf({ supportSubjectId, currencyExponents, coverage, lastSourceUpdate, sourceReference, goal }: SupportProjectionInput): SupportProjectionRecord {
  return { supportSubjectId, basis: "effective_cash_allocation", currencyExponents, coverage, asOf: SEED_INSTANT.toString(), lastSourceUpdate, goal, source: source("finance", sourceReference), revision: INITIAL_REVISION };
}
export type SeededMediaProduction = "copy" | "image-display";
export type SeededMediaBytes = { readonly assetId: string; readonly renditionId: string; readonly file: string; readonly fixture: string; readonly producedBy: SeededMediaProduction };
export const SEEDED_MEDIA_BYTES: readonly SeededMediaBytes[] = Object.freeze([
  { assetId: "asset-video-welcome", renditionId: "rendition-video-welcome-playback", file: "sample-h264.mp4", fixture: "sample-h264.mp4", producedBy: "copy" },
  { assetId: "asset-video-welcome", renditionId: "rendition-video-welcome-poster", file: "poster.jpg", fixture: "poster.jpg", producedBy: "copy" },
  { assetId: "asset-video-welcome", renditionId: "rendition-video-welcome-captions", file: "sample.vtt", fixture: "sample.vtt", producedBy: "copy" },
  { assetId: "asset-video-welcome", renditionId: "rendition-video-welcome-transcript", file: "transcript.vtt", fixture: "sample.vtt", producedBy: "copy" },
  { assetId: "asset-image-portrait", renditionId: "rendition-image-portrait-display", file: "display.jpg", fixture: "IMG_20260814-harbour-youth-group.jpg", producedBy: "image-display" },
  { assetId: "asset-video-unavailable", renditionId: "rendition-video-unavailable-poster", file: "poster.jpg", fixture: "poster.jpg", producedBy: "copy" },
]);
function seededBytesRefOf(renditionId: string): string {
  const entry = SEEDED_MEDIA_BYTES.find((candidate) => candidate.renditionId === renditionId);
  if (entry === undefined) throw new Error(`No seeded media bytes are declared for ${JSON.stringify(renditionId)}: every rendition the seed records needs a row in SEEDED_MEDIA_BYTES, because that row says which committed fixture a reset materialises and where custody keeps it.`);
  return seededMediaReference(entry.assetId, entry.file);
}
const rendition = (renditionId: string, purpose: MediaAssetRenditionPurpose, mimeType: string): MediaAssetRenditionRecord => ({ renditionId, purpose, bytesRef: seededBytesRefOf(renditionId), mimeType });
const NORMAL_PRESENTATION: PresentationChoice = Object.freeze({ treatment: "normal", layout: "single-column", alignment: "start", imageFit: "cover" });
const contentBody = (direction: ContentDirection, texts: readonly string[], sections: readonly ContentSection[] = []): ContentDocumentJson => ({ type: "doc", profileVersion: CONTENT_PROFILE_VERSION, direction, content: texts.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })), sections });
function buildContentRevision(revisionId: string, variantId: string, body: ContentDocumentJson, authorPrincipalId: PrincipalId, createdAt: string, shareTitle: string, overrides: Partial<ContentRevisionRecord> = {}): ContentRevisionRecord {
  return { revisionId, variantId, body, mediaPlacements: [], captions: [], sharePresentation: { title: shareTitle, description: "Shared from the Harbour youth ministry.", imageAssetId: null, imageAltText: null }, contentChecksum: checksum(body), authorPrincipalId, createdAt, revision: INITIAL_REVISION, ...overrides };
}
function buildContentVariant(variantId: string, documentId: string, audience: ContentAudience, locale: string, direction: ContentDirection, overrides: Partial<ContentVariantRecord> = {}): ContentVariantRecord {
  return { variantId, documentId, audience, locale, direction, draftRevisionId: null, candidateId: null, releaseHeadId: null, translationSource: null, revision: INITIAL_REVISION, ...overrides };
}
function buildRelease(releaseId: string, variantId: string, revisionId: string, audience: ContentAudience, locale: string, publishedAt: string, reach: ReleaseReach): ReleaseRecord {
  return { releaseId, variantId, revisionId, audience, locale, publishedAt, reach, withdrawnAt: null, supersededBy: null, revision: INITIAL_REVISION };
}
interface ContentReviewRecord {
  readonly candidateId: string;
  readonly variantId: string;
  readonly revisionId: string;
  readonly notifyMode: PublishMode;
  readonly decision: ReviewDecision;
  readonly note: string | null;
  readonly submittedAt: string;
  readonly decidedAt: string | null;
  readonly decidedByPrincipalId: string | null;
  readonly revision: string;
}
function buildContentReview(candidateId: string, variantId: string, revisionId: string, submittedAt: string, overrides: Partial<ContentReviewRecord> = {}): ContentReviewRecord {
  return { candidateId, variantId, revisionId, notifyMode: "publish-only", decision: "submitted", note: null, submittedAt, decidedAt: null, decidedByPrincipalId: null, revision: INITIAL_REVISION, ...overrides };
}
const assetScope = (session: SeededSession, membership: AdmittedMembership): Scope => ({ organizationId: membership.organizationId, ministryId: membership.ministryId, supportSubjectId: membership.supportSubjectId, principalId: session.principalId });
function buildMediaAsset(assetId: string, kind: MediaAssetRecord["kind"], profileCheck: MediaAssetProfileRecord, sourceOriginalRef: string, renditions: readonly MediaAssetRenditionRecord[], scope: Scope, tagVerification: MediaAssetRecord["tagVerification"] = { checked: true, residualTags: [] }): MediaAssetRecord {
  return { assetId, kind, profileCheck, sourceOriginalRef, renditions, scope, tagVerification, revision: INITIAL_REVISION };
}
export interface SessionStateDocument {
  readonly version: number;
  readonly context: SessionContextRecord;
  readonly partners: readonly PartnerRecord[];
  readonly privateNotes: readonly PrivateNoteRecord[];
  readonly interactions: readonly InteractionRecord[];
  readonly tasks: readonly TaskRecord[];
  readonly series: readonly TaskSeriesRecord[];
  readonly initiatives: readonly InitiativeRecord[];
  readonly initiativeMembers: readonly InitiativeMemberRecord[];
  readonly requests: readonly RequestRecord[];
  readonly referrals: readonly ReferralCycleRecord[];
  readonly supportProjection: SupportProjectionRecord | null;
  readonly gifts: readonly GiftRowRecord[];
  readonly commitments: readonly CommitmentRowRecord[];
  readonly contentDocuments: readonly ContentDocumentRecord[];
  readonly contentVariants: readonly ContentVariantRecord[];
  readonly contentRevisions: readonly ContentRevisionRecord[];
  readonly contentReviews: readonly ContentReviewRecord[];
  readonly releases: readonly ReleaseRecord[];
  readonly mediaAssets: readonly MediaAssetRecord[];
  readonly memberships: readonly MembershipRecord[];
  readonly notificationIntents: readonly NotificationIntentRecord[];
  readonly notificationResults: readonly NotificationSendResultRecord[];
  readonly coachingGrants: readonly CoachingGrantRecord[];
  readonly coachingTargets: readonly CoachingTargetRecord[];
  readonly coachingCheckIns: readonly CoachingCheckInRecord[];
  readonly importProposals: readonly ImportProposalRecord[];
}
export type OperationLedgerDocument = { readonly version: number; readonly entries: readonly OperationRecord[] };
export const EMPTY_OPERATION_LEDGER: OperationLedgerDocument = deepFreeze({ version: OPERATION_LEDGER_VERSION, entries: [] as readonly OperationRecord[] });
type SessionFamilies = Omit<SessionStateDocument, "version" | "context">;
type WorkspaceFamilies = Partial<SessionFamilies>;
function buildContext(session: SeededSession): SessionContextRecord {
  const { sessionId, principalId, admittedMemberships, selectedContext: selected, sessionState, scenarioId } = session;
  return { sessionId, principalId, admittedMemberships, selectedOrganizationId: selected?.organizationId ?? null, selectedMinistryId: selected?.ministryId ?? null, selectedSupportSubjectId: selected?.supportSubjectId ?? null, sessionState, scenarioId, clockOffset: { milliseconds: 0 }, revision: INITIAL_REVISION };
}
const emptyFamilies = (): SessionFamilies => ({
  partners: [],
  privateNotes: [],
  interactions: [],
  tasks: [],
  series: [],
  initiatives: [],
  initiativeMembers: [],
  requests: [],
  referrals: [],
  supportProjection: null,
  gifts: [],
  commitments: [],
  contentDocuments: [],
  contentVariants: [],
  contentRevisions: [],
  contentReviews: [],
  releases: [],
  mediaAssets: [],
  memberships: [],
  notificationIntents: [],
  notificationResults: [],
  coachingGrants: [],
  coachingTargets: [],
  coachingCheckIns: [],
  importProposals: [],
});
const stateDocument = (session: SeededSession, families: WorkspaceFamilies): SessionStateDocument => ({ version: SESSION_STATE_VERSION, context: buildContext(session), ...emptyFamilies(), ...families });
function newWorkerWorkspace(session: SeededSession): SessionStateDocument {
  const partners: readonly PartnerRecord[] = [buildPartner("partner-nw-ada-quinn", "private-preparation", "Ada Quinn (met on Sunday)", { audience: "private", contactMethods: [contactMethod("email", "ada.quinn@example.org")], tags: ["first-contact"] })];
  const tasks: readonly TaskRecord[] = [buildTask("task-nw-first-follow-up", "Send Ada a first note", session.principalId, { category: "Care", dueOn: "2026-11-24", partnerId: "partner-nw-ada-quinn", note: "Ask how she heard about the ministry before adding her to anything." })];
  const contentDocuments: readonly ContentDocumentRecord[] = [{ documentId: "doc-update-first-note", family: "update", kind: "update", sourceSubject: source("content", "update-first-note"), siteId: "site-harbour", givingBinding: null, managedFields: ["title"], revision: INITIAL_REVISION }];
  const contentVariants: readonly ContentVariantRecord[] = [buildContentVariant("variant-update-first-note-public-en", "doc-update-first-note", "public", "en", "ltr")];
  return stateDocument(session, { partners, tasks, contentDocuments, contentVariants });
}
function secondWorkerWorkspace(session: SeededSession): SessionStateDocument {
  const partners: readonly PartnerRecord[] = [
    buildPartner("partner-river-owen-hale", "person", "Owen Hale", { nameParts: nameParts("Owen", "Hale"), contactMethods: [contactMethod("email", "owen.hale@example.org")], tags: ["outreach"], source: source("crm", "crm-2011") }),
    buildPartner("partner-river-theo-brooks", "person", "Theo Brooks", { nameParts: nameParts("Theo", "Brooks"), contactMethods: [contactMethod("phone", "+44 20 7946 0613")], favourite: true }),
  ];
  const privateNotes: readonly PrivateNoteRecord[] = [buildPrivateNote("note-river-owen-hale", "partner-river-owen-hale", session.principalId, "Only this ministry's record. Nothing here is shared with Harbour.", "2026-11-09T10:15:00Z")];
  const interactions: readonly InteractionRecord[] = [buildInteraction("interaction-river-owen-hale", "partner-river-owen-hale", "Phone call", "2026-11-09", "date", "Agreed to hear about the outreach evening", { participants: [workerParticipant(session)] })];
  const tasks: readonly TaskRecord[] = [buildTask("task-river-invite-owen", "Send Owen the outreach evening details", session.principalId, { dueOn: "2026-11-25", partnerId: "partner-river-owen-hale" })];
  const gifts: readonly GiftRowRecord[] = [buildGift("gift-row-river-0001", "gift-river-0001", "USD", 7500, "2026-11-06", { designation: "Outreach", attribution: { kind: "partner", partnerId: "partner-river-owen-hale" } })];
  const supportProjection = supportProjectionOf({ supportSubjectId: SUPPORT_SUBJECT_OUTREACH, currencyExponents: { USD: 2 }, coverage: { from: "2026-01-01", to: "2026-11-06", state: "complete" }, lastSourceUpdate: "2026-11-06T21:00:00Z", sourceReference: "ledger-riverbend-2026", goal: null });
  return stateDocument(session, { partners, privateNotes, interactions, tasks, gifts, supportProjection });
}
const harbourPartners = (): readonly PartnerRecord[] => [
  buildPartner("partner-jo-mbeki", "person", "Jo Mbeki", { nameParts: nameParts("Jo", "Mbeki"), contactMethods: [contactMethod("email", "jo.mbeki@example.org")], tags: ["church-visit"], favourite: true, stage: "Follow up", source: source("crm", "crm-1001") }),
  buildPartner("partner-household-nakamura", "household", "The Nakamura Household", { contactMethods: [contactMethod("postal", "14 Bridge Lane, Harbourton HT1 3AB")], tags: ["newsletter"] }),
  buildPartner("partner-hana-nakamura", "person", "Hana Nakamura", { nameParts: nameParts("Hana", "Nakamura"), contactMethods: [contactMethod("email", "hana.nakamura@example.org")] }),
  buildPartner("partner-kenji-nakamura", "person", "Kenji Nakamura", { nameParts: nameParts("Kenji", "Nakamura"), contactMethods: [contactMethod("phone", "+44 20 7946 0421")] }),
  buildPartner("partner-church-st-aidan", "church", "St Aidan's Church", { contactMethods: [contactMethod("postal", "2 Abbey Road, Harbourton HT1 8PJ")], tags: ["church"] }),
  buildPartner("partner-ruth-okafor", "person", "Ruth Okafor", { nameParts: nameParts("Ruth", "Okafor"), contactMethods: [contactMethod("email", "ruth.okafor@example.org")], stage: "Church warden" }),
  buildPartner("partner-harbour-trust", "organization", "Harbour Community Trust", { contactMethods: [contactMethod("email", "grants.harbour@example.org")], tags: ["grant-maker"], source: source("crm", "00042") }),
  buildPartner("partner-daniel-whitfield", "person", "Daniel Whitfield", { nameParts: nameParts("Daniel", "Whitfield"), contactMethods: [contactMethod("email", "daniel.whitfield@example.org")], stage: "Trust representative" }),
  buildPartner("partner-elena-sokolova", "person", "Елена Соколова", { nameParts: nameParts("Елена", "Соколова"), contactMethods: [contactMethod("email", "elena.sokolova@example.org")] }),
  buildPartner("partner-sara-al-hassan", "person", "سارة الحسن", { nameParts: nameParts("سارة", "الحسن"), contactMethods: [contactMethod("phone", "+44 20 7946 0912")] }),
  buildPartner("partner-marcus-webb", "person", "Marcus Webb", {
    nameParts: nameParts("Marcus", "Webb"),
    contactMethods: [contactMethod("phone", "+44 20 7946 0958", false), contactMethod("email", "marcus.webb@example.org")],
    restrictions: [{ kind: "no-phone", detail: "Asked that we never telephone, and confirmed it in writing." }],
    tags: ["restriction"],
  }),
  buildPartner("partner-priya-raman", "person", "Priya Raman", { nameParts: nameParts("Priya", "Raman"), contactMethods: [contactMethod("email", "priya.raman@example.org")], tags: ["volunteer"] }),
  buildPartner("partner-grace-adeyemi", "person", "Grace Adeyemi", { nameParts: nameParts("Grace", "Adeyemi"), contactMethods: [contactMethod("email", "grace.adeyemi@example.org")] }),
  buildPartner("partner-prep-sunday-visitor", "private-preparation", "Sunday visitor (name to confirm)", { audience: "private", tags: ["preparation"] }),
];
const harbourPrivateNotes = (session: SeededSession): readonly PrivateNoteRecord[] => [
  buildPrivateNote("note-prep-sunday-visitor", "partner-prep-sunday-visitor", session.principalId, "Visited with a friend on Sunday and asked about the youth programme. Do not add them to any list until they say so.", "2026-11-16T18:40:00Z"),
  buildPrivateNote("note-jo-mbeki", "partner-jo-mbeki", session.principalId, "Prefers a call after 6pm, and asked for nothing to be posted to the shared house address.", "2026-11-12T19:05:00Z"),
];
const harbourInteractions = (session: SeededSession): readonly InteractionRecord[] => [
  buildInteraction("interaction-jo-call", "partner-jo-mbeki", "Phone call", "2026-11-12", "date", "Left a voicemail", { participants: [workerParticipant(session)], note: recordedNote(session, "Left a message about the autumn appeal; will try again next week.", "private") }),
  buildInteraction("interaction-household-visit", "partner-household-nakamura", "Visit", "2026-10-04", "approximate", "Met the household for tea", {
    participants: [workerParticipant(session), { role: "Host", partnerId: "partner-hana-nakamura", principalId: null }],
    note: recordedNote(session, "Warm visit; the household was in and asked after the students' group.", "shared"),
  }),
  buildInteraction("interaction-ruth-email", "partner-ruth-okafor", "Email", null, "unknown", "Replied about the autumn appeal", { provenance: source("mail", "mail-7712"), note: recordedNote(session, "The reply arrived, but the day it was sent was never recorded.", "shared") }),
  buildInteraction("interaction-grace-meeting", "partner-grace-adeyemi", "Meeting", "2026-11-06", "date", "Discussed what the appeal asks for", { participants: [workerParticipant(session)], provenance: source("crm", "crm-act-8814") }),
];
const SERIES_MONTH_END_RULE: TaskSeriesRecord["currentRule"] = { profile: "monthlyOnDay", interval: 1, dayOfMonth: 31, firstDueOn: "2026-08-31", planningTimeZone: REFERRAL_SOURCE_ZONE, end: { kind: "ongoing-personal-policy" } };
const SERIES_WEEKLY_CALL_ROUND: TaskSeriesRecord["currentRule"] = { profile: "weekly", interval: 1, dayOfMonth: null, firstDueOn: "2026-11-04", planningTimeZone: REFERRAL_SOURCE_ZONE, end: { kind: "after-count", count: 12 } };
const SERIES_FORTNIGHTLY_NEWSLETTER: TaskSeriesRecord["currentRule"] = { profile: "everyNWeeks", interval: 2, dayOfMonth: null, firstDueOn: "2026-09-07", planningTimeZone: REFERRAL_SOURCE_ZONE, end: { kind: "on-date", on: "2027-03-29" } };
const SERIES_VISIT_ROUND: TaskSeriesRecord["currentRule"] = { profile: "weekly", interval: 1, dayOfMonth: null, firstDueOn: "2026-10-05", planningTimeZone: REFERRAL_SOURCE_ZONE, end: { kind: "after-count", count: 6 } };
const SERIES_MISSED_PLAN_REVIEW: TaskSeriesRecord["currentRule"] = { profile: "weekly", interval: 1, dayOfMonth: null, firstDueOn: "2026-09-24", planningTimeZone: REFERRAL_SOURCE_ZONE, end: { kind: "ongoing-personal-policy" } };
const harbourTasks = (session: SeededSession): readonly TaskRecord[] => [
  buildTask("task-care-jo", "Follow up with Jo after the visit", session.principalId, { category: "Care", dueOn: "2026-11-24", partnerId: "partner-jo-mbeki" }),
  buildTask("task-meeting-grace", "Talk terms with Grace", session.principalId, { kind: "meeting", dueOn: "2026-11-26", plannedTime: "14:30", timeZone: REFERRAL_SOURCE_ZONE, partnerId: "partner-grace-adeyemi", initiativeId: "initiative-autumn-appeal" }),
  buildTask("task-overdue-thank-you", "Send the thank-you note", session.principalId, { category: "Thank you", dueOn: "2026-11-10", partnerId: "partner-hana-nakamura" }),
  buildTask("task-completed-intro", "Introduce Grace to the students' group", session.principalId, { status: "completed", dueOn: "2026-11-05", partnerId: "partner-grace-adeyemi" }),
  buildTask("task-undated-prayer", "Pray for the students' exam week", session.principalId, { category: "Prayer" }),
  buildTask("task-reopened-warden-visit", "Visit the church warden", session.principalId, { status: "reopened", dueOn: "2026-11-28", partnerId: "partner-ruth-okafor" }),
  buildTask("task-series-month-end", "Month-end support review", session.principalId, { dueOn: "2026-11-30", seriesId: "series-month-end-support-review" }),
  buildTask("task-series-weekly-call", "Weekly call round", session.principalId, { dueOn: "2026-11-25", seriesId: "series-weekly-call-round" }),
  buildTask("task-series-stopped-leftover", "Visit round: Abbey Road", session.principalId, { dueOn: "2026-10-19", partnerId: "partner-church-st-aidan", seriesId: "series-visit-round" }),
  buildTask("task-series-missed-occurrence", "Monday review of the working list", session.principalId, { dueOn: "2026-10-22", seriesId: "series-missed-plan-review" }),
];
function buildSeries(seriesId: string, session: SeededSession, title: string, currentRule: TaskSeriesRecord["currentRule"], state: TaskSeriesRecord["state"], options: { readonly currentOccurrenceId?: string; readonly planNeedsReview?: boolean } = {}): TaskSeriesRecord {
  const { currentOccurrenceId = null, planNeedsReview = false } = options;
  return { seriesId, ownerPrincipalId: session.principalId, title, currentRule, effectiveRevisions: [{ revisionId: `${seriesId}-rev-1`, effectiveFrom: currentRule.firstDueOn, rule: currentRule }], currentOccurrenceId, state, planNeedsReview, revision: INITIAL_REVISION };
}
const harbourSeries = (session: SeededSession): readonly TaskSeriesRecord[] => [
  buildSeries("series-month-end-support-review", session, "Month-end support review", SERIES_MONTH_END_RULE, "active", { currentOccurrenceId: "task-series-month-end" }),
  buildSeries("series-weekly-call-round", session, "Weekly call round", SERIES_WEEKLY_CALL_ROUND, "active", { currentOccurrenceId: "task-series-weekly-call" }),
  buildSeries("series-fortnightly-newsletter", session, "Fortnightly newsletter to partners", SERIES_FORTNIGHTLY_NEWSLETTER, "paused"),
  buildSeries("series-visit-round", session, "Visit round", SERIES_VISIT_ROUND, "stopped"),
  buildSeries("series-missed-plan-review", session, "Monday review of the working list", SERIES_MISSED_PLAN_REVIEW, "active", { currentOccurrenceId: "task-series-missed-occurrence", planNeedsReview: true }),
];
function buildInitiative(session: SeededSession, initiativeId: string, name: string, purpose: string, period: InitiativeRecord["period"]): InitiativeRecord {
  return { initiativeId, name, purpose, ministryContextId: MINISTRY_YOUTH, responsiblePrincipalId: session.principalId, period, state: "open", closureDisposition: null, revision: INITIAL_REVISION };
}
const harbourInitiatives = (session: SeededSession): readonly InitiativeRecord[] => [buildInitiative(session, "initiative-autumn-appeal", "Autumn appeal", "Invite current partners to consider supporting the youth programme through the autumn.", { from: "2026-09-01", to: "2026-11-30" })];
function buildMember(memberId: string, partnerId: string, state: InitiativeMemberRecord["state"], stage: string | null, addedAt: string, history: InitiativeMemberRecord["history"]): InitiativeMemberRecord {
  return { memberId, initiativeId: "initiative-autumn-appeal", partnerId, state, stage, addedAt, returnedAt: null, history, revision: INITIAL_REVISION };
}
function harbourInitiativeMembers(session: SeededSession): readonly InitiativeMemberRecord[] {
  const addedBy = session.principalId;
  const added = "Added from the reviewed working list.";
  return [
    buildMember("member-autumn-jo", "partner-jo-mbeki", "included", "Answered", "2026-09-02T09:00:00Z", [memberHistory("included", "2026-09-02T09:00:00Z", addedBy, added)]),
    buildMember("member-autumn-grace", "partner-grace-adeyemi", "included", "Asked", "2026-09-02T09:05:00Z", [memberHistory("included", "2026-09-02T09:05:00Z", addedBy, added)]),
    buildMember("member-autumn-priya", "partner-priya-raman", "removed", null, "2026-09-02T09:10:00Z", [memberHistory("included", "2026-09-02T09:10:00Z", addedBy, added), memberHistory("removed", "2026-10-01T10:00:00Z", addedBy, "Volunteers rather than gives, and asked not to be asked.")]),
    buildMember("member-autumn-marcus", "partner-marcus-webb", "excluded", null, "2026-09-02T09:15:00Z", [memberHistory("excluded", "2026-09-02T09:15:00Z", addedBy, "Asked not to be approached; the restriction stays recorded.")]),
  ];
}
function buildRequest(requestId: string, recipientPartnerId: string, purpose: string, terms: RequestRecord["terms"], presentation: RequestRecord["presentation"], response: RequestRecord["response"], nextWorkIds: readonly string[]): RequestRecord {
  return { requestId, initiativeId: "initiative-autumn-appeal", recipientPartnerId, representedOrganizationId: null, purpose, terms, presentation, response, nextWorkIds, revision: INITIAL_REVISION };
}
const harbourRequests = (): readonly RequestRecord[] => [
  buildRequest(
    "request-autumn-grace",
    "partner-grace-adeyemi",
    "Support the youth programme through the autumn appeal.",
    { version: "terms-v2", money: { amount: money("USD", 5000), cadence: "Monthly", term: "12 months" }, nonFinancial: null },
    { presentedOn: "2026-09-15", manner: "In person", versionRef: "terms-v1" },
    { kind: "conditional", respondentId: "partner-grace-adeyemi", standingEvidence: null, termsVersionRef: "terms-v1", recordedAt: "2026-11-06T16:20:00Z" },
    ["task-care-jo"],
  ),
];
const REFERRAL_CYCLE_DEFAULTS = { sourceZone: REFERRAL_SOURCE_ZONE, sourceReference: null, cycleIndex: 0, windowKind: "new", windowStart: null, windowEnd: null, consumed: false, predecessorId: null, revision: INITIAL_REVISION } as const;
function buildReferral(referralId: string, partnerId: string, originalIntroductionOn: string | null, overrides: Partial<ReferralCycleRecord> = {}): ReferralCycleRecord {
  return { referralId, partnerId, originalIntroductionOn, datePrecision: originalIntroductionOn === null ? "unknown" : "date", ...REFERRAL_CYCLE_DEFAULTS, ...overrides };
}
const newReferralCycle = (referralId: string, partnerId: string, introductionOn: string, reference: string, overrides: Partial<ReferralCycleRecord> = {}): ReferralCycleRecord =>
  buildReferral(referralId, partnerId, introductionOn, { sourceReference: source("crm", reference), windowStart: dayStart(introductionOn, REFERRAL_SOURCE_ZONE).toString(), windowEnd: referralNewWindowEnd(introductionOn).toString(), ...overrides });
const continuedReferralCycle = (referralId: string, partnerId: string, introductionOn: string, reference: string, acceptedAt: Temporal.Instant, predecessorId: string): ReferralCycleRecord =>
  buildReferral(referralId, partnerId, introductionOn, { sourceReference: source("crm", reference), cycleIndex: 1, windowKind: "continued", windowStart: acceptedAt.toString(), windowEnd: referralContinuedWindowEnd(acceptedAt).toString(), predecessorId });
const harbourReferrals = (): readonly ReferralCycleRecord[] => [
  newReferralCycle("referral-jo-expired", "partner-jo-mbeki", "2026-05-04", "intro-4411"),
  newReferralCycle("referral-ruth-new", "partner-ruth-okafor", "2026-03-02", "intro-3902", { consumed: true }),
  continuedReferralCycle("referral-ruth-continued", "partner-ruth-okafor", "2026-03-02", "intro-3902", Temporal.Instant.from("2026-11-02T10:00:00Z"), "referral-ruth-new"),
  newReferralCycle("referral-kenji-active", "partner-kenji-nakamura", "2026-11-12", "intro-5117"),
  buildReferral("referral-hana-approximate", "partner-hana-nakamura", "2026-09-10", { datePrecision: "approximate" }),
  buildReferral("referral-sara-unknown", "partner-sara-al-hassan", null, { datePrecision: "unknown" }),
];
function harbourSupportProjection(): SupportProjectionRecord {
  return {
    supportSubjectId: SUPPORT_SUBJECT_YOUTH,
    basis: "effective_cash_allocation",
    currencyExponents: { USD: 2, EUR: 2, KWD: 3, JPY: 0 },
    coverage: { from: "2023-01-01", to: "2026-11-20", state: "partial" },
    asOf: SEED_INSTANT.toString(),
    lastSourceUpdate: "2026-11-18T09:30:00Z",
    goal: {
      amount: money("USD", 2500000),
      measure: GOAL_MEASURE,
      effectiveFrom: "2026-01-01",
      revision: "1", // A goal's revision is the base revision an edit presents, and the report reads it as a whole number: it is the one seeded revision that is not an opaque token, so it is not "rev-1".
    },
    source: source("finance", "ledger-harbour-2026"),
    revision: INITIAL_REVISION,
  };
}
function harbourGifts(): readonly GiftRowRecord[] {
  return [
    buildGift("gift-row-harbour-0001", "gift-harbour-0001", "USD", 12500, "2026-11-02", { designation: "Youth ministry", attribution: { kind: "partner", partnerId: "partner-jo-mbeki" } }),
    buildGift("gift-row-harbour-0002", "gift-harbour-0002", "USD", 10000, "2026-10-20", { designation: "Youth ministry", attribution: { kind: "partner", partnerId: "partner-hana-nakamura" } }), // A split gift: this ministry may see only its own allocation of it.
    buildGift("gift-row-harbour-0003", "gift-harbour-0002", "USD", 4000, "2026-10-20", { allocationId: "alloc-harbour-0002-youth", designation: "Youth ministry", attribution: { kind: "partner", partnerId: "partner-hana-nakamura" } }),
    buildGift("gift-row-harbour-0004", "gift-harbour-0004", "KWD", 1250, "2026-10-15", { designation: "Youth ministry", attribution: { kind: "partner", partnerId: "partner-daniel-whitfield" } }), // A three-decimal currency: 1,250 minor units is 1.250 KWD, never 12.50.
    buildGift("gift-row-harbour-0005", "gift-harbour-0005", "JPY", 5000, "2026-09-28", { designation: "Youth ministry", attribution: { kind: "partner", partnerId: "partner-elena-sokolova" } }), // A zero-decimal currency: 5,000 minor units is 5,000 JPY, and the exponent is never assumed.
    buildGift("gift-row-harbour-0006", "gift-harbour-0006", "EUR", 2500, "2026-09-12", { attribution: { kind: "partner", partnerId: "partner-kenji-nakamura" } }),
    buildGift("gift-row-harbour-0007", "gift-harbour-0007", UNKNOWN_CURRENCY, 7500, "2026-08-30"), // The source never identified this currency, so no exponent exists for it and it is never defaulted.
    buildGift("gift-row-harbour-0008", "gift-harbour-0008", "USD", 5000, "2026-08-18", { attribution: { kind: "anonymous" } }),
    buildGift("gift-row-harbour-0009", "gift-harbour-0009", "USD", 7500, "2026-07-05", { designation: "Youth ministry", attribution: { kind: "partner", partnerId: "partner-church-st-aidan" } }),
    // The refund explains itself instead of disappearing: a negative amount naming the row it corrects.
    buildGift("gift-row-harbour-0010", "gift-harbour-0010", "USD", -7500, "2026-09-01", { designation: "Youth ministry", attribution: { kind: "partner", partnerId: "partner-church-st-aidan" }, refundOf: "gift-row-harbour-0009" }),
    buildGift("gift-row-harbour-0011", "gift-harbour-0011", "USD", 3000, "2026-06-01", { datePrecision: "approximate", attribution: { kind: "partner", partnerId: "partner-ruth-okafor" } }), // An approximate gift date: the precision travels with the date rather than being invented.
  ];
}
function harbourCommitments(): readonly CommitmentRowRecord[] {
  return [
    buildCommitment("commitment-harbour-0001", "automatic-recurring", "received", "USD", 5000, { cadence: "Monthly", lastSuccessfulOn: "2026-11-05", nextEligibleOn: "2026-12-05" }),
    buildCommitment("commitment-harbour-0002", "automatic-recurring", "processing", "EUR", 1500, { lastSuccessfulOn: "2026-10-25", nextEligibleOn: "2026-11-25" }),
    buildCommitment("commitment-harbour-0003", "manual-recurring", "upcoming", "USD", 2500, { nextEligibleOn: "2026-12-01" }),
    buildCommitment("commitment-harbour-0004", "manual-recurring", "recovery-needs-attention", "USD", 1000, { lastSuccessfulOn: "2026-09-10", nextEligibleOn: "2026-09-10" }),
    buildCommitment("commitment-harbour-0005", "fixed-total", "not-received", "USD", 5000, { cadence: "Once", fixedTotal: { promised: money("USD", 250000), fulfilled: money("USD", 100000), released: money("USD", 25000), remaining: money("USD", 125000) } }),
    buildCommitment("commitment-harbour-0006", "automatic-recurring", "outside-partition", "KWD", 1000, { pause: { state: "paused", resumeOn: "2026-12-01" }, lastSuccessfulOn: "2026-08-02" }),
  ];
}
type HarbourContent = Pick<SessionStateDocument, "contentDocuments" | "contentVariants" | "contentRevisions" | "contentReviews" | "releases" | "mediaAssets">;
function harbourContentDocuments(): readonly ContentDocumentRecord[] {
  return [
    { documentId: "doc-update-autumn", family: "update", kind: "update", sourceSubject: source("content", "update-autumn-2026"), siteId: "site-harbour", givingBinding: null, managedFields: ["title"], revision: INITIAL_REVISION },
    { documentId: "doc-page-harbour-youth", family: "worker-page", kind: "story", sourceSubject: source("content", "worker-page-harbour-youth"), siteId: "site-harbour", givingBinding: null, managedFields: ["title", "givingBinding"], revision: INITIAL_REVISION },
    // The second family's Page: the same site and the same contributor authority, composed from the Project Page catalogue's own sections, so both families the Pages index names hold a Page a worker can actually compose.
    { documentId: "doc-page-harbour-kitchen", family: "project-page", kind: "milestone", sourceSubject: source("content", "project-page-harbour-kitchen"), siteId: "site-harbour", givingBinding: null, managedFields: ["title", "givingBinding"], revision: INITIAL_REVISION },
  ];
}
function harbourMediaAssets(session: SeededSession): readonly MediaAssetRecord[] {
  const scope = assetScope(session, HARBOUR_YOUTH);
  const welcomeRenditions = [rendition("rendition-video-welcome-playback", "playback", "video/mp4"), rendition("rendition-video-welcome-poster", "poster", "image/jpeg"), rendition("rendition-video-welcome-captions", "captions", "text/vtt"), rendition("rendition-video-welcome-transcript", "transcript", "text/vtt")];
  // The committed fixtures are the bytes served here: `scripts/make-media-fixtures.mjs --check` verified the poster carries no EXIF, ICC profile or comment segment, the caption track is plain WebVTT, and the clip's container reports a creation timestamp and no descriptive tag. The transcript is served from the committed WebVTT text under a custody name of its own.
  const welcome = buildMediaAsset("asset-video-welcome", "video", { container: "mp4", codec: "avc1.64001f", durationSeconds: 2, width: 960, height: 540 }, "media-originals/welcome-sunday-raw.mp4", welcomeRenditions, scope);
  // A revealing original filename, kept private: it is never echoed into output or served, and `prepareDisplayImage` re-reads the delivered bytes and refuses one still carrying metadata or a copy of the original's name.
  const portrait = buildMediaAsset("asset-image-portrait", "image", { container: "jpeg", codec: "jpeg", durationSeconds: null, width: 1125, height: 2000 }, "media-originals/IMG_20260814-harbour-youth-group.jpg", [rendition("rendition-image-portrait-display", "display", "image/jpeg")], scope);
  // No playback bytes exist for this asset, so the only rendition it serves is the committed poster, which the fixture script's own check verified carries no metadata segment.
  const unavailable = buildMediaAsset("asset-video-unavailable", "video", { container: "mp4", codec: "avc1.4d401f", durationSeconds: 95.4, width: 1280, height: 720 }, "media-originals/evening-talk-raw.mp4", [rendition("rendition-video-unavailable-poster", "poster", "image/jpeg")], scope);
  return [welcome, portrait, unavailable];
}
function harbourContentRevisions(): readonly ContentRevisionRecord[] {
  const author = PRINCIPAL_ESTABLISHED;
  const pageSection: ContentSection = { element: "story", fields: { heading: "A term with the youth group", body: "Friday evenings, a shared meal and a great deal of football." }, presentation: NORMAL_PRESENTATION };
  // The Project Page's one composed section, from the milestone type that family's catalogue admits: the three fields its type edits, under the seeded presentation every composed section starts with.
  const kitchenSection: ContentSection = { element: "milestone", fields: { heading: "The new cooker arrived", date: "2026-09-12", body: "The kitchen is what makes a Friday evening possible, and the refit began with the oven nobody could repair." }, presentation: NORMAL_PRESENTATION };
  const autumnEnglish = contentBody("ltr", ["Autumn at Harbour Youth", "This term we have met every Friday, shared a meal each week and welcomed six new faces.", "Thank you for praying with us and for giving what makes the work possible."]);
  const autumnForSupporters = contentBody("ltr", ["Autumn at Harbour Youth", "This term we have met every Friday, shared a meal each week and welcomed six new faces.", "For those who support this work: the monthly costs rose in September and your regular giving is what carried them."]);
  const autumnArabic = contentBody("rtl", ["الخريف في هاربر يوث", "التقينا كل يوم جمعة هذا الفصل، وتشاركنا وجبة، ورحّبنا بستة وجوه جديدة."]);
  const pageArabic = contentBody("rtl", ["يلتقي هاربر يوث أيام الجمعة في قاعة الكنيسة، والجميع مرحّب بهم."], [{ element: "story", fields: { heading: "فصل مع مجموعة الشباب", body: "أمسيات الجمعة، ووجبة مشتركة، وكثير من كرة القدم." }, presentation: NORMAL_PRESENTATION, direction: "rtl" }]);
  const portraitShare = { sharePresentation: { title: "Autumn at Harbour Youth", description: "A term of Friday evenings, shared meals and six new faces.", imageAssetId: "asset-image-portrait", imageAltText: "The youth group gathered in the church hall." } };
  return [
    buildContentRevision("rev-update-en-1", "variant-update-autumn-en-public", autumnEnglish, author, "2026-11-09T15:00:00Z", "Autumn at Harbour Youth", portraitShare),
    buildContentRevision("rev-update-en-supporter-1", "variant-update-autumn-en-approved-supporter", autumnForSupporters, author, "2026-11-09T15:20:00Z", "Autumn at Harbour Youth — for supporters"),
    buildContentRevision("rev-update-fr-1", "variant-update-autumn-fr-public", contentBody("ltr", ["L'automne à Harbour Youth", "Ce trimestre, nous nous sommes retrouvés chaque vendredi autour d'un repas, et six nouveaux visages sont venus."]), author, "2026-11-11T11:00:00Z", "L'automne à Harbour Youth"),
    buildContentRevision("rev-update-ar-draft-1", "variant-update-autumn-ar-public", autumnArabic, author, "2026-11-13T10:00:00Z", "الخريف في هاربر يوث"),
    buildContentRevision("rev-update-ar-candidate-1", "variant-update-autumn-ar-public", contentBody("rtl", ["الخريف في هاربر يوث", "التقينا كل يوم جمعة هذا الفصل، وتشاركنا وجبة، ورحّبنا بستة وجوه جديدة.", "شكراً لصلاتكم ودعمكم الذي يجعل هذا العمل ممكناً."]), author, "2026-11-14T09:30:00Z", "الخريف في هاربر يوث"),
    buildContentRevision("rev-page-en-1", "variant-page-harbour-youth-en-public", contentBody("ltr", ["Harbour Youth meets on Fridays in the church hall, and everyone is welcome."], [pageSection]), author, "2026-10-01T14:00:00Z", "Harbour Youth", {
      mediaPlacements: [{ placementId: "placement-page-video", assetId: "asset-video-welcome", sectionElement: "story", position: 0, altText: "A short welcome from the youth group.", caption: "A welcome from the group.", credit: "Harbour Youth" }],
      captions: [{ assetId: "asset-video-welcome", renditionId: "rendition-video-welcome-captions", language: "en", label: "English", isDefault: true }],
      sharePresentation: { title: "Harbour Youth", description: "Fridays in the church hall.", imageAssetId: "asset-image-portrait", imageAltText: "The youth group gathered in the church hall." },
    }),
    buildContentRevision("rev-page-ar-draft-1", "variant-page-harbour-youth-ar-public", pageArabic, author, "2026-11-15T16:45:00Z", "هاربر يوث"),
    // The Project Page's own draft: one composed milestone section and the prose around it, saved and never submitted, so the family's builder opens on an edition there is something to compose in.
    buildContentRevision(
      "rev-page-harbour-kitchen-en-draft-1",
      "variant-page-harbour-kitchen-en-public",
      contentBody("ltr", ["The kitchen is where a Friday evening begins.", "This page follows the refit of it, says what has been done and what it still needs."], [kitchenSection]),
      author,
      "2026-11-16T10:00:00Z",
      "Harbour Youth Kitchen",
    ),
  ];
}
function harbourContentVariants(): readonly ContentVariantRecord[] {
  return [
    buildContentVariant("variant-update-autumn-en-public", "doc-update-autumn", "public", "en", "ltr", { releaseHeadId: "release-update-en-1" }),
    buildContentVariant("variant-update-autumn-en-approved-supporter", "doc-update-autumn", "approved-supporter", "en", "ltr", { releaseHeadId: "release-update-en-approved-supporter-1" }),
    buildContentVariant("variant-update-autumn-fr-public", "doc-update-autumn", "public", "fr", "ltr", { releaseHeadId: "release-update-fr-1", translationSource: { variantId: "variant-update-autumn-en-public", revisionId: "rev-update-en-1" } }),
    // The sibling that failed: its draft and its frozen candidate exist, and it has no release head, so the partial release kept every other variant's prior-good head without inventing this one.
    buildContentVariant("variant-update-autumn-ar-public", "doc-update-autumn", "public", "ar", "rtl", { draftRevisionId: "rev-update-ar-draft-1", candidateId: "rev-update-ar-candidate-1" }),
    buildContentVariant("variant-page-harbour-youth-en-public", "doc-page-harbour-youth", "public", "en", "ltr", { releaseHeadId: "release-page-en-1" }),
    buildContentVariant("variant-page-harbour-youth-ar-public", "doc-page-harbour-youth", "public", "ar", "rtl", { draftRevisionId: "rev-page-ar-draft-1" }),
    // The Project Page's one edition: public English, holding a saved draft and no candidate and no release, which is the state the family's second composition starts from.
    buildContentVariant("variant-page-harbour-kitchen-en-public", "doc-page-harbour-kitchen", "public", "en", "ltr", { draftRevisionId: "rev-page-harbour-kitchen-en-draft-1" }),
  ];
}
// The failed sibling's frozen candidate carries the submission record that put it under review, so a fresh-seed reviewer can answer it.
const harbourContentReviews = (): readonly ContentReviewRecord[] => [buildContentReview("rev-update-ar-candidate-1", "variant-update-autumn-ar-public", "rev-update-ar-candidate-1", "2026-11-14T09:45:00Z")];
const harbourReleases = (): readonly ReleaseRecord[] => [
  buildRelease("release-update-en-1", "variant-update-autumn-en-public", "rev-update-en-1", "public", "en", "2026-11-10T09:00:00Z", "link-public"),
  buildRelease("release-update-en-approved-supporter-1", "variant-update-autumn-en-approved-supporter", "rev-update-en-supporter-1", "approved-supporter", "en", "2026-11-10T09:00:00Z", "link-public"),
  buildRelease("release-update-fr-1", "variant-update-autumn-fr-public", "rev-update-fr-1", "public", "fr", "2026-11-12T09:00:00Z", "link-public"),
  buildRelease("release-page-en-1", "variant-page-harbour-youth-en-public", "rev-page-en-1", "public", "en", "2026-10-02T08:00:00Z", "listed"),
];
const harbourContent = (session: SeededSession): HarbourContent => ({ contentDocuments: harbourContentDocuments(), contentVariants: harbourContentVariants(), contentRevisions: harbourContentRevisions(), contentReviews: harbourContentReviews(), releases: harbourReleases(), mediaAssets: harbourMediaAssets(session) });
const PARTIAL_RELEASE_HEADS: Readonly<Record<string, string>> = { "variant-update-autumn-en-public": "release-update-en-2", "variant-update-autumn-ar-public": "release-update-ar-1" };
function partialReleaseContentVariants(): readonly ContentVariantRecord[] {
  return harbourContentVariants().map((variant) => {
    const head = PARTIAL_RELEASE_HEADS[variant.variantId];
    return head === undefined ? variant : { ...variant, releaseHeadId: head };
  });
}
function partialReleaseContentRevisions(): readonly ContentRevisionRecord[] {
  const author = PRINCIPAL_ESTABLISHED;
  return [
    ...harbourContentRevisions(),
    buildContentRevision("rev-update-ar-1", "variant-update-autumn-ar-public", contentBody("rtl", ["الخريف في هاربر يوث", "التقينا كل يوم جمعة هذا الفصل، وتشاركنا وجبة."]), author, "2026-10-23T10:00:00Z", "الخريف في هاربر يوث"),
    buildContentRevision(
      "rev-update-en-2",
      "variant-update-autumn-en-public",
      contentBody("ltr", ["Autumn at Harbour Youth", "This term we have met every Friday, shared a meal each week and welcomed six new faces.", "As the term closes we are planning the Christmas meal, and your giving is what makes it possible."]),
      author,
      "2026-11-17T15:00:00Z",
      "Autumn at Harbour Youth",
    ),
  ];
}
function partialReleaseReleases(): readonly ReleaseRecord[] {
  return [
    ...harbourReleases().map((release) => (release.releaseId === "release-update-en-1" ? { ...release, supersededBy: "release-update-en-2" } : release)),
    buildRelease("release-update-ar-1", "variant-update-autumn-ar-public", "rev-update-ar-1", "public", "ar", "2026-10-24T09:00:00Z", "link-public"),
    buildRelease("release-update-en-2", "variant-update-autumn-en-public", "rev-update-en-2", "public", "en", "2026-11-18T09:00:00Z", "link-public"),
  ];
}
/** The receiving reader's own membership: its approval is the protected-reading grant, the row is the membership a notification copy is addressed at, and it is the record that reader's own preference, confirmation and unsubscribe controls write. */
function approvedSupporterMembership(): MembershipRecord {
  return buildMembership(PRINCIPAL_READER_SUPPORTER, "supporter@example.org", "active", { displayName: "Approved supporter", acceptedAt: "2026-07-22T10:30:00Z", languagePreference: "en" });
}
function harbourMemberships(): readonly MembershipRecord[] {
  return [
    buildMembership("membership-ada-active", "ada.quinn@example.org", "active", { displayName: "Ada Quinn", acceptedAt: "2026-03-02T08:00:00Z", languagePreference: "en" }),
    buildMembership("membership-priya-active", "priya.raman@example.org", "active", { displayName: "Priya Raman", acceptedAt: "2026-04-11T19:30:00Z", languagePreference: "en" }),
    buildMembership("membership-jonas-active", "jonas.oyelaran@example.org", "active", { displayName: "Jonas Oyelaran", acceptedAt: "2026-05-19T12:00:00Z", languagePreference: "en" }),
    buildMembership("membership-tobias-active", "tobias.kern@example.org", "active", { displayName: "Tobias Kern", acceptedAt: "2026-06-30T06:45:00Z", languagePreference: "de" }),
    approvedSupporterMembership(), // The receiving reader is a member of this publisher's Update-email audience, so this one row is two facts on the publisher's side: the approval a receiving read decides the grant from, and the membership the notice's copy is addressed at.
    // Awaiting proof: not membership, and its 168-hour confirmation window is stored as the instant it closes.
    buildMembership("membership-awaiting-proof", "iwan.pritchard@example.org", "awaiting-proof", { displayName: "Iwan Pritchard", acceptedAt: "2026-11-16T12:00:00Z", confirmationDeadline: membershipConfirmationDeadline(Temporal.Instant.from("2026-11-16T12:00:00Z")), languagePreference: "cy" }),
    buildMembership("membership-unsubscribed", "hilary.baptiste@example.org", "off", { displayName: "Hilary Baptiste", acceptedAt: "2026-02-08T09:15:00Z", languagePreference: "en" }),
    buildMembership("membership-restricted", "nadia.haq@example.org", "restricted", { displayName: "Nadia Haq", acceptedAt: "2026-07-14T15:00:00Z" }),
    buildMembership("membership-subscribed-column", "jo.mbeki@example.org", "off", { displayName: "Jo Mbeki" }),
  ];
}
const harbourNotificationIntents = (): readonly NotificationIntentRecord[] => [
  // The ceiling is every eligible recipient of the seeded audience at the instant this notice was meant for, which now includes the receiving reader the accepted copy below is addressed at: the reader's own membership is one of the publisher's active, audience-addressed memberships and not a fifth of a .
  { intentId: "intent-update-autumn-en", publisherId: PUBLISHER_HARBOUR, purpose: "update-email", documentId: "doc-update-autumn", releaseId: "release-update-en-1", intendedAt: "2026-11-10T09:05:00Z", ceilingCount: 5, revision: INITIAL_REVISION },
];
function harbourNotificationResults(): readonly NotificationSendResultRecord[] {
  const recipients: readonly NotificationRecipientOutcomeRecord[] = [
    { recipientId: "membership-ada-active", renditionId: "rendition-update-en-notice", state: "accepted", at: "2026-11-10T09:06:12Z" },
    { recipientId: "membership-priya-active", renditionId: "rendition-update-en-notice", state: "accepted", at: "2026-11-10T09:06:14Z" },
    { recipientId: "membership-jonas-active", renditionId: "rendition-update-en-notice", state: "failed", at: "2026-11-10T09:06:15Z" },
    { recipientId: "membership-tobias-active", renditionId: "rendition-update-de-notice", state: "unknown", at: "2026-11-10T09:06:31Z" },
    // The receiving reader's copy, recorded under the identity the notice is addressed at, is the message the synthetic inbox renders for that persona: the same outcome the publisher recorded, never a claim that it was delivered or read.
    { recipientId: PRINCIPAL_READER_SUPPORTER, renditionId: "rendition-update-en-notice", state: "accepted", at: "2026-11-10T09:06:33Z" },
  ];
  // The seeded intent serves all five eligible recipients of its ceiling — accepted, failed and unknown outcomes are all a recorded copy — so no recipient of this intent went unserved.
  return [{ sendResultId: "send-result-update-autumn-en", intentId: "intent-update-autumn-en", recipients, unserved: [], recordedAt: "2026-11-10T09:07:00Z", revision: INITIAL_REVISION }];
}
type CoachingShare = { readonly coachingGrants: readonly CoachingGrantRecord[]; readonly coachingTargets: readonly CoachingTargetRecord[]; readonly coachingCheckIns: readonly CoachingCheckInRecord[] };
const targetVersions = (targetId: string, measure: CoachingTargetVersionRecord["measure"], quantity: number, calendarStart: string): readonly CoachingTargetVersionRecord[] => [{ revisionId: `${targetId}-1`, effectiveFrom: calendarStart, effectiveTo: null, quantity, measure, calendarStart }];
function coachingShare(): CoachingShare {
  const modules: CoachingModuleSelection = { "support-goal": false, "support-results": false, targets: true, "check-ins": true, "task-summaries": false };
  const duration: CoachingDurationRecord = { kind: "through-date", cutoffInstant: "2026-12-31T00:00:00Z", frozenZone: REFERRAL_SOURCE_ZONE };
  const invitation: CoachingInvitationRecord = { issuedAt: "2026-10-30T09:00:00Z", expiresAt: "2026-11-06T09:00:00Z", supersededBy: null };
  const conversationVersions: readonly CoachingTargetVersionRecord[] = [
    { revisionId: "target-conversations-weekly-1", effectiveFrom: "2026-11-02", effectiveTo: "2026-11-08", quantity: 2, measure: "conversations", calendarStart: "2026-11-02" },
    { revisionId: "target-conversations-weekly-2", effectiveFrom: "2026-11-09", effectiveTo: null, quantity: 3, measure: "conversations", calendarStart: "2026-11-02" },
  ];
  function buildGrant(grantId: string, ministryIds: readonly MinistryId[], selections: CoachingModuleSelection, overrides: Partial<CoachingGrantRecord> = {}): CoachingGrantRecord {
    return { grantId, workerPrincipalId: PRINCIPAL_ESTABLISHED, coachPrincipalId: PRINCIPAL_COACH, ministryIds, modules: selections, duration, financialRange: null, state: "active", invitation, revision: INITIAL_REVISION, ...overrides };
  }
  function buildTarget(targetId: string, privateLabel: string, measure: CoachingTargetRecord["measure"], quantity: number, period: CoachingTargetPeriodRecord, calendarStart: string, versions: readonly CoachingTargetVersionRecord[], overrides: Partial<CoachingTargetRecord> = {}): CoachingTargetRecord {
    return { targetId, workerPrincipalId: PRINCIPAL_ESTABLISHED, privateLabel, measure, quantity, period, calendarStart, homePlacement: "placed", state: "active", versions, revision: INITIAL_REVISION, ...overrides };
  }
  const questions: NonNullable<CoachingCheckInRecord["privateDraft"]>["questions"] = [
    { wording: "How did the week go?", order: 0 },
    { wording: "What would help next week?", order: 1 },
  ];
  const questionsCapturedAt = "2026-11-13T08:00:00Z";
  const recordedAnswers = [
    { questionOrder: 0, text: "Two good conversations and one difficult one." },
    { questionOrder: 1, text: "A shorter list on Monday." },
  ];
  return {
    coachingGrants: [
      buildGrant("grant-established-coach", [MINISTRY_YOUTH], modules),
      buildGrant("grant-established-coach-support", [MINISTRY_YOUTH], { ...modules, "support-goal": true }, { financialRange: { from: "2026-10-01", to: "2026-10-31", currency: "USD" } }),
      buildGrant(
        "grant-revoked-coach",
        [MINISTRY_STUDENTS],
        { ...modules, "check-ins": false },
        { duration: { kind: "ongoing", cutoffInstant: null, frozenZone: REFERRAL_SOURCE_ZONE }, state: "revoked", invitation: { issuedAt: "2026-05-04T09:00:00Z", expiresAt: "2026-05-11T09:00:00Z", supersededBy: "grant-established-coach" } },
      ),
      buildGrant(
        "grant-ended-coach",
        [MINISTRY_YOUTH],
        { ...modules, targets: false, "check-ins": false },
        { duration: { kind: "through-date", cutoffInstant: "2026-09-30T00:00:00Z", frozenZone: REFERRAL_SOURCE_ZONE }, state: "ended", invitation: { issuedAt: "2026-08-03T09:00:00Z", expiresAt: "2026-08-10T09:00:00Z", supersededBy: null } },
      ),
    ],
    coachingTargets: [
      buildTarget("target-calls-weekly", "Calls each week — my own wording, never shown to a coach", "calls-made", 5, { kind: "weekly", from: null, to: null }, "2026-11-02", targetVersions("target-calls-weekly", "calls-made", 5, "2026-11-02")),
      buildTarget("target-conversations-weekly", "Real conversations, not just hellos", "conversations", 3, { kind: "weekly", from: null, to: null }, "2026-11-02", conversationVersions),
      buildTarget("target-messages-monthly", "Personal messages each month", "personal-messages", 20, { kind: "monthly", from: null, to: null }, "2026-10-01", targetVersions("target-messages-monthly", "personal-messages", 20, "2026-10-01"), { homePlacement: "unplaced", state: "paused" }),
      buildTarget("target-meetings-custom", "Meetings during the appeal fortnight", "meetings-held", 3, { kind: "custom", from: "2026-11-02", to: "2026-11-15" }, "2026-11-02", targetVersions("target-meetings-custom", "meetings-held", 3, "2026-11-02"), { homePlacement: "unplaced" }),
    ],
    coachingCheckIns: [
      {
        checkInId: "check-in-week-46",
        workerPrincipalId: PRINCIPAL_ESTABLISHED,
        grantId: "grant-established-coach",
        privateDraft: { revisionId: "check-in-week-46-private-1", questions, questionsCapturedAt, answers: [...recordedAnswers, { questionOrder: null, text: "Not for sharing: still deciding about the appeal." }], savedAt: "2026-11-13T08:30:00Z" },
        shared: { revisionId: "check-in-week-46-shared-1", questions, questionsCapturedAt, answers: recordedAnswers, recipientPrincipalIds: [PRINCIPAL_COACH], duration, sharedAt: "2026-11-13T08:35:00Z", updatedAt: "2026-11-13T08:35:00Z", withdrawnAt: null },
        revision: INITIAL_REVISION,
      },
    ],
  };
}
function establishedWorkerWorkspace(session: SeededSession): SessionStateDocument {
  const harbour = {
    partners: harbourPartners(),
    privateNotes: harbourPrivateNotes(session),
    interactions: harbourInteractions(session),
    tasks: harbourTasks(session),
    series: harbourSeries(session),
    initiatives: harbourInitiatives(session),
    initiativeMembers: harbourInitiativeMembers(session),
    requests: harbourRequests(),
    referrals: harbourReferrals(),
    supportProjection: harbourSupportProjection(),
    gifts: harbourGifts(),
    commitments: harbourCommitments(),
    memberships: harbourMemberships(),
    notificationIntents: harbourNotificationIntents(),
    notificationResults: harbourNotificationResults(),
  };
  return stateDocument(session, { ...harbour, ...harbourContent(session), ...coachingShare() });
}
const partialReleaseWorkspace = (session: SeededSession): SessionStateDocument => ({ ...establishedWorkerWorkspace(session), contentVariants: partialReleaseContentVariants(), contentRevisions: partialReleaseContentRevisions(), releases: partialReleaseReleases() });
function studentsMinistryWorkspace(session: SeededSession): SessionStateDocument {
  const partners: readonly PartnerRecord[] = [
    buildPartner("partner-students-femi-adebayo", "person", "Femi Adebayo", { nameParts: nameParts("Femi", "Adebayo"), contactMethods: [contactMethod("email", "femi.adebayo@example.org")], tags: ["students"], source: source("crm", "crm-2044") }),
    buildPartner("partner-students-holy-trinity", "church", "Holy Trinity Chaplaincy", { contactMethods: [contactMethod("postal", "Holy Trinity, Harbourton HT1 4QD")], tags: ["students"] }),
  ];
  const gifts: readonly GiftRowRecord[] = [
    buildGift("gift-row-students-0001", "gift-students-0001", "EUR", 6000, "2026-10-08", { designation: "Students ministry", attribution: { kind: "partner", partnerId: "partner-students-femi-adebayo" } }),
    buildGift("gift-row-students-0002", "gift-students-0002", "EUR", 4500, "2026-09-14", { designation: "Students ministry", attribution: { kind: "partner", partnerId: "partner-students-holy-trinity" } }),
  ];
  const supportProjection = supportProjectionOf({ supportSubjectId: SUPPORT_SUBJECT_STUDENTS, currencyExponents: { EUR: 2 }, coverage: { from: "2024-01-01", to: "2026-11-18", state: "complete" }, lastSourceUpdate: "2026-11-18T07:45:00Z", sourceReference: "ledger-harbour-students-2026", goal: null });
  const tasks: readonly TaskRecord[] = [buildTask("task-students-term-plan", "Plan the students' term programme", session.principalId, { category: "Planning", dueOn: "2026-11-27", partnerId: "partner-students-holy-trinity" })];
  return stateDocument(session, { partners, gifts, supportProjection, tasks });
}
const coachWorkspace = (session: SeededSession): SessionStateDocument => stateDocument(session, { ...coachingShare(), supportProjection: harbourSupportProjection(), gifts: harbourGifts(), commitments: harbourCommitments() });
function subscriberWorkspace(session: SeededSession): SessionStateDocument {
  const memberships: readonly MembershipRecord[] = [
    buildMembership(session.principalId, "subscriber@example.org", "awaiting-proof", { displayName: "Subscriber", acceptedAt: "2026-11-16T12:00:00Z", confirmationDeadline: membershipConfirmationDeadline(Temporal.Instant.from("2026-11-16T12:00:00Z")), languagePreference: "en" }),
  ];
  return stateDocument(session, { memberships });
}
/** The approved-supporter reader's own world: the record its own Off/Immediate choice, reading language, confirmation and unsubscribe write. A session sees only its own files, so the membership a reader changes is this copy, while the publisher's world carries the copy a receiving read reaches across for the grant and the notice addressed at it, both built by `approvedSupporterMembership` so they start identical. */
function approvedSupporterWorkspace(session: SeededSession): SessionStateDocument {
  return stateDocument(session, { memberships: [approvedSupporterMembership()] });
}
const WORKSPACE_BUILDERS: Readonly<Record<SeededWorkspace, (session: SeededSession) => SessionStateDocument>> = {
  "new-worker": newWorkerWorkspace,
  "established-worker": establishedWorkerWorkspace,
  "established-worker-partial-release": partialReleaseWorkspace,
  "students-ministry": studentsMinistryWorkspace,
  "second-worker": secondWorkerWorkspace,
  coach: coachWorkspace,
  subscriber: subscriberWorkspace,
  "reader-approved-supporter": approvedSupporterWorkspace,
  empty: (session) => stateDocument(session, {}),
};
/** Builds the state document a seeded session starts with, from the workspace its row names. */
export const seedWorkspace = (session: SeededSession): SessionStateDocument => WORKSPACE_BUILDERS[session.workspace](session);
function buildSessionDocuments(session: SeededSession): SeededSessionDocuments {
  const selected = session.selectedContext;
  return {
    meta: buildSessionMeta({
      principalId: session.principalId,
      admittedMemberships: session.admittedMemberships,
      sessionState: session.sessionState,
      scenarioId: session.scenarioId,
      capabilities: CAPABILITIES_BY_PERSONA[session.persona],
      personas: seededPersonaRoster(),
      selectedContext: selected === null ? null : { organizationId: selected.organizationId, ministryId: selected.ministryId, supportSubjectId: selected.supportSubjectId },
    }),
    state: seedWorkspace(session),
    operations: EMPTY_OPERATION_LEDGER,
  };
}
/** Builds the three documents a session id names, in the store's own document shape. */
export function seedSessionDocuments(sessionId: string): SessionDocuments {
  const session = findSeededSession(sessionId);
  if (session === undefined) throw new RangeError(`No seeded session ${JSON.stringify(sessionId)}: the seed lays down ${SEEDED_SESSION_IDS.join(", ")}.`);
  return buildSessionDocuments(session);
}
/** Builds every seeded session's three documents and returns the rows with them attached. */
export const seed = async (): Promise<SeededSessionWithDocuments[]> => SEEDED_SESSIONS.map((session) => ({ ...session, documents: buildSessionDocuments(session) }));
