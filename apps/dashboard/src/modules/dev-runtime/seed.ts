/**
 * The deterministic readable seed: one row per seeded persona and scenario, the records each
 * persona's workspace starts with, and the builders that lay a session's documents down.
 *
 * Plan items that put this file in scope:
 * - AAP 0.7.2 "What the deterministic seed holds" — the seed is "built by
 *   `src/modules/dev-runtime/seed` from compact builders rather than checked-in literals" and covers
 *   identities and personas, relationships, money, work and outreach, content, media and delivery.
 * - AAP 0.6.1 "Development runtime" — the internal seed entry point the reset script and the
 *   workload generator call; AAP 0.11.1's `modules/dev-runtime/{seed,generate,failures,scenario,reset}.ts`.
 * - AAP 0.12.4 "Deterministic seed for every session scenario", invoked by `scripts/reset.ts` and by
 *   the Settings reset control, and AAP 0.12.1 criterion 21's `bun run reset`.
 *
 * Determinism, which is what makes every later assertion evidence. Every instant is `SEED_INSTANT`
 * or a value a boundary function derives from it, every date is a literal civil date, and every
 * identifier is a literal or built from a literal index, so two resets serialise byte-identically.
 * Nothing here reads the machine clock, `Math.random`, `crypto.randomUUID` or the environment, and
 * nothing here writes: the documents are handed to `store/repository`, which is the only writer.
 *
 * Layering. A development-runtime module: it imports the store's document and media-reference surfaces,
 * the sibling scenario module, the time and content domain modules, and `data-service/envelope` for TYPES
 * only, so the data service stays out of this module's runtime graph — `envelope.ts` is the declaration of
 * the stored record form both sides share, and it imports no module of this one.
 *
 * What it hands a caller. `SEEDED_PERSONAS` names the ten personas this release seeds, with the
 * session a spec means by each; `SEEDED_SESSIONS` and `SEEDED_SESSION_IDS` are the registry a
 * development panel lists and a CLI validates against; `DEFAULT_SESSION_ID` is the session a caller
 * means by "the worker"; and `seed()` builds every row's three documents without persisting one.
 * `seedSessionDocuments()` and `seedWorkspace()` stay the per-session entry points the reset script,
 * the workload generator and the Settings reset already call.
 */
import { Temporal } from "temporal-polyfill";

import type { SourceReference } from "@/lib/ids";
import {
  checksum,
  CONTENT_PROFILE_VERSION,
  type ContentDirection,
  type ContentDocumentJson,
  type ContentSection,
  type PresentationChoice,
} from "@/modules/content/document";
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
import { minorUnitsOf, type Money } from "@/modules/money/amount";
import { UNKNOWN_CURRENCY } from "@/modules/money/currency";
import { seededMediaReference } from "@/modules/store/media";
import type { SessionDocuments } from "@/modules/store/paths";
import type { CommitmentKind, RecurringBucket } from "@/modules/support/buckets";
import { GOAL_CAPABILITY } from "@/modules/support/goal";
import { SEED_INSTANT } from "@/modules/time/clock";
import { startOfCivilDay } from "@/modules/time/civil";
import { confirmationDeadline, continuedWindowEnd, newWindowEnd } from "@/modules/time/window";

import {
  buildSessionMeta,
  DEFAULT_SCENARIO_ID,
  type PersistedPersonaKind,
  type PersistedPersonaRecord,
  type ScenarioId,
  type SessionMetaDocument,
  type SessionState,
} from "./scenario";

// ---------------------------------------------------------------------------------------------
// Document versions and shared literals
// ---------------------------------------------------------------------------------------------

/** The version of the state document this module writes; a stored document of another version is not read as this one. */
export const SESSION_STATE_VERSION = 1;

/** The version of the operation ledger a fresh session starts with, before any operation is accepted. */
export const OPERATION_LEDGER_VERSION = 1;

/**
 * The optimistic-concurrency revision every seeded record carries.
 *
 * A seeded record has never been written by a caller, so `rev-1` is the first revision of every one
 * of them and a caller's first write presents exactly this value.
 */
const INITIAL_REVISION = "rev-1";

/**
 * How many calendar days the seed's referral New window runs over, and how many elapsed days its
 * continuation runs over.
 *
 * The specification fixes the arithmetic and leaves the period to the builder (AAP 0.8.7), so the
 * two periods are stated once here rather than at each referral row.
 */
const REFERRAL_NEW_WINDOW_DAYS = 14;
const REFERRAL_CONTINUATION_DAYS = 30;

/** The zone the seeded referral windows are computed in; a date-only window is resolved in its source zone. */
const REFERRAL_SOURCE_ZONE = "Europe/London";

// ---------------------------------------------------------------------------------------------
// Identities: one literal per organization, ministry, support subject and principal
// ---------------------------------------------------------------------------------------------

/**
 * Mints one opaque identifier for a seeded record.
 *
 * The stored form is a plain string and every identifier's brand exists only at compile time, so
 * this is the one place the seed states that a literal names a specific kind of record. `envelope.ts`
 * mints one the same way when it parses a stored record, and the seed is the other legitimate
 * producer: it is the code that writes the records a read later parses.
 */
function identifier<Brand extends string>(value: string): Brand {
  return value as Brand;
}

/**
 * An organization is the admitted organization; a ministry is the admitted ministry; a support
 * subject is the finance and support scope; a principal is the acting user. They are four separate
 * references, and no surface here treats a matching id or name as evidence that two records are one.
 */
const ORGANIZATION_HARBOUR: OrganizationId = identifier<OrganizationId>("org-harbour");
const MINISTRY_YOUTH: MinistryId = identifier<MinistryId>("min-harbour-youth");
const MINISTRY_STUDENTS: MinistryId = identifier<MinistryId>("min-harbour-students");
const SUPPORT_SUBJECT_YOUTH: SupportSubjectId = identifier<SupportSubjectId>("sup-harbour-youth");
const SUPPORT_SUBJECT_STUDENTS: SupportSubjectId =
  identifier<SupportSubjectId>("sup-harbour-students");

const ORGANIZATION_RIVERBEND: OrganizationId = identifier<OrganizationId>("org-riverbend");
const MINISTRY_OUTREACH: MinistryId = identifier<MinistryId>("min-riverbend-outreach");
const SUPPORT_SUBJECT_OUTREACH: SupportSubjectId =
  identifier<SupportSubjectId>("sup-riverbend-outreach");

const PRINCIPAL_NEW_WORKER: PrincipalId = identifier<PrincipalId>("principal-new-worker");
const PRINCIPAL_ESTABLISHED: PrincipalId = identifier<PrincipalId>("principal-established-worker");
const PRINCIPAL_SECOND: PrincipalId = identifier<PrincipalId>("principal-second-worker");
const PRINCIPAL_DEPUTIZED: PrincipalId = identifier<PrincipalId>("principal-deputized-fundraiser");
const PRINCIPAL_COACH: PrincipalId = identifier<PrincipalId>("principal-coach");
const PRINCIPAL_REVIEWER: PrincipalId = identifier<PrincipalId>("principal-content-reviewer");
const PRINCIPAL_READER_PUBLIC: PrincipalId = identifier<PrincipalId>("principal-reader-public");
const PRINCIPAL_READER_SUPPORTER: PrincipalId = identifier<PrincipalId>(
  "principal-reader-approved-supporter",
);
const PRINCIPAL_READER_UNAUTHORIZED: PrincipalId = identifier<PrincipalId>(
  "principal-reader-unauthorized",
);
const PRINCIPAL_SUBSCRIBER: PrincipalId = identifier<PrincipalId>("principal-subscriber");
const PRINCIPAL_NO_ACCESS: PrincipalId = identifier<PrincipalId>("principal-no-access-user");
const PRINCIPAL_UNAVAILABLE: PrincipalId = identifier<PrincipalId>("principal-unavailable-session");
const PRINCIPAL_DENIED: PrincipalId = identifier<PrincipalId>("principal-denied-session");
const PRINCIPAL_EXPIRED: PrincipalId = identifier<PrincipalId>("principal-expired-session");

/** The publisher a membership consents to, and the publisher a notification intent is sent for. */
const PUBLISHER_HARBOUR = "publisher-harbour";

/** One admitted ministry, stated as the triplet a session's context carries. */
const HARBOUR_YOUTH: AdmittedMembership = {
  organizationId: ORGANIZATION_HARBOUR,
  ministryId: MINISTRY_YOUTH,
  supportSubjectId: SUPPORT_SUBJECT_YOUTH,
};

/** The established worker's second ministry, which is what makes the context chooser appear. */
const HARBOUR_STUDENTS: AdmittedMembership = {
  organizationId: ORGANIZATION_HARBOUR,
  ministryId: MINISTRY_STUDENTS,
  supportSubjectId: SUPPORT_SUBJECT_STUDENTS,
};

/** The second worker's ministry, in another organization, so nothing of the first scope is visible. */
const RIVERBEND_OUTREACH: AdmittedMembership = {
  organizationId: ORGANIZATION_RIVERBEND,
  ministryId: MINISTRY_OUTREACH,
  supportSubjectId: SUPPORT_SUBJECT_OUTREACH,
};

// ---------------------------------------------------------------------------------------------
// The seeded sessions
// ---------------------------------------------------------------------------------------------

/**
 * Which workspace a seeded session starts with.
 *
 * It decides what the session's state document holds, not who the session is: the deputized
 * fundraiser and the content reviewer act inside the established worker's ministry, so they start
 * from the same shared records, while their own private notes and tasks are theirs. The students
 * ministry is its own workspace because a state document holds the projection of the ministry its
 * context selects, and that ministry's source carries no goal. The partial-release workspace is the
 * established worker's own records with only their content publication facts changed, so the failed
 * sibling that criterion 17 starts from is record state and not a source availability: a scenario
 * flag states what a source can serve, which is a different fact from what a release attempt did.
 */
export type SeededWorkspace =
  | "new-worker"
  | "established-worker"
  | "established-worker-partial-release"
  | "students-ministry"
  | "second-worker"
  | "coach"
  | "empty";

/** The context a seeded session has already selected: three separate references, never one id. */
export interface SeededContext {
  readonly organizationId: OrganizationId;
  readonly ministryId: MinistryId;
  readonly supportSubjectId: SupportSubjectId;
}

/**
 * The closed roster of personas AAP 0.1.2 fixes, as identifiers a browser spec, a development panel
 * and the seed itself can address.
 *
 * A persona is who is acting. An admission state is how the session stands, so the rows that
 * demonstrate `unavailable`, `denied`, `expired` and `no-access` carry the persona whose seat they
 * are and state the difference in {@link SeededSession.sessionState} — the state is never a second
 * persona, and the enum is closed so a spec cannot name one this release does not seed.
 */
export type PersonaId =
  | "new-worker"
  | "established-worker"
  | "second-worker"
  | "fundraiser"
  | "coach"
  | "reviewer"
  | "reader-public"
  | "reader-approved-supporter"
  | "reader-unauthorized"
  | "subscriber";

/**
 * What each persona may do beyond admission, as the capability set its session states.
 *
 * The only capability this release defines is the support goal's `canEditGoal`
 * (`modules/support/goal.ts` owns its name and its test; importing the name keeps one declaration of
 * it). Admission alone never implies it: two principals admitted to the same ministry can sit on
 * either side of it, which is exactly what makes the goal read-only for one of them and editable for
 * the other.
 *
 * Who holds it, and why. A worker sets the target for the support they raise, so every worker persona
 * holds it — including the deputized fundraiser, whose seat exists to raise support inside one
 * admitted ministry. A content reviewer acts in the ministry for content and never for finance, and a
 * coach, reader or subscriber relates to a publication rather than to a ministry's target and holds
 * no membership at all; none of them holds it. That absence is a real, seeded state: the reviewer
 * session opens the same Support surface, sees the same goal and is offered no way to change it.
 */
const CAPABILITIES_BY_PERSONA: Readonly<Record<PersonaId, readonly string[]>> = Object.freeze({
  "new-worker": Object.freeze([GOAL_CAPABILITY]),
  "established-worker": Object.freeze([GOAL_CAPABILITY]),
  "second-worker": Object.freeze([GOAL_CAPABILITY]),
  fundraiser: Object.freeze([GOAL_CAPABILITY]),
  coach: Object.freeze([]),
  reviewer: Object.freeze([]),
  "reader-public": Object.freeze([]),
  "reader-approved-supporter": Object.freeze([]),
  "reader-unauthorized": Object.freeze([]),
  subscriber: Object.freeze([]),
});

/**
 * One persona, the words it is named by, and the session a spec selects when it means that persona.
 *
 * `principalId` is the reference the active persona is matched by: it is the same principal the
 * persona's sessions resolve to, so the panel identifies the acting persona by reference and never by
 * a label. `kind` is how the panel groups the roster — the receiving readers apart from the
 * worker-side identities whose seats own work.
 */
export interface SeededPersona {
  readonly id: PersonaId;
  readonly principalId: PrincipalId;
  readonly kind: PersistedPersonaKind;
  readonly label: string;
  readonly defaultSessionId: string;
  readonly description: string;
}

/**
 * The session a caller means when it says "the worker": the established worker, signed in, in the
 * baseline scenario. It is the default the workload generator and the journeys start from, so it is
 * named once here rather than repeated as a literal.
 */
export const DEFAULT_SESSION_ID = "established-worker";

/** One seeded persona or scenario, and everything the seed needs to lay its session down. */
export interface SeededSession {
  /** The development session id, which is also its file name, so it satisfies `isSafeSessionId`. */
  readonly sessionId: string;
  /** The persona who acts in this session, from the closed roster above. */
  readonly persona: PersonaId;
  /** The short name the development panel lists this session under. */
  readonly label: string;
  /** What this row demonstrates, in the words AAP 0.1.2 and 0.7.2 use. */
  readonly description: string;
  /** The principal the session resolves to; the seed never invents one at run time. */
  readonly principalId: PrincipalId;
  /** The memberships the principal is admitted to, as the organization/ministry/support-subject triplets. */
  readonly admittedMemberships: readonly AdmittedMembership[];
  /** How admission stands for the session, in the development runtime's own vocabulary. */
  readonly sessionState: SessionState;
  /** The scenario the session runs in. */
  readonly scenarioId: ScenarioId;
  /** The context already selected, or `null` for a session that has chosen none. */
  readonly selectedContext: SeededContext | null;
  /** The workspace the session's state document starts with. */
  readonly workspace: SeededWorkspace;
  /**
   * The three documents this session owns, present on what `seed()` returns and absent from the
   * registry row.
   *
   * The registry stays a description, so a panel that only lists sessions pays for nothing else;
   * `seed()` builds the documents per call, so a caller can never hold a shared literal that a later
   * seed would read back altered.
   */
  readonly documents?: SeededSessionDocuments;
}

/** The three documents a seeded session owns: its records, its operation ledger and its scenario meta. */
export interface SeededSessionDocuments {
  readonly state: SessionStateDocument;
  readonly operations: OperationLedgerDocument;
  readonly meta: SessionMetaDocument;
}

/** A seeded row whose documents have been built: what {@link seed} returns. */
export type SeededSessionWithDocuments = SeededSession & {
  readonly documents: SeededSessionDocuments;
};

/**
 * Every seeded session, in the order the development panel lists them.
 *
 * The roster is AAP 0.1.2's closed persona list — a new worker, an established worker with two
 * ministries, a second worker in another ministry (the isolation proof), a deputized fundraiser, a
 * coach, a content reviewer and the reader personas plus a subscriber — and then one row per session
 * state, signed-in included, ending with the no-access user whose only honest outcome is
 * account-recovery guidance. Every scenario `./scenario` defines also has a row, so a criterion that
 * needs a source down or a sibling release that failed selects a session instead of editing a record
 * by hand; and every scenario id comes from that registry, so a row cannot name a world this release
 * does not define.
 */
export const SEEDED_SESSIONS: readonly SeededSession[] = deepFreeze([
  {
    sessionId: "new-worker",
    persona: "new-worker",
    label: "New worker",
    description:
      "No gifts, goal, subscription or integration: one private contact and one task to start from.",
    principalId: PRINCIPAL_NEW_WORKER,
    admittedMemberships: [HARBOUR_YOUTH],
    sessionState: "signed-in",
    scenarioId: DEFAULT_SCENARIO_ID,
    selectedContext: HARBOUR_YOUTH,
    workspace: "new-worker",
  },
  {
    sessionId: "established-worker",
    persona: "established-worker",
    label: "Established worker",
    description:
      "Years of gifts, recurring support, partners, drafts and pages, across two ministries.",
    principalId: PRINCIPAL_ESTABLISHED,
    admittedMemberships: [HARBOUR_YOUTH, HARBOUR_STUDENTS],
    sessionState: "signed-in",
    scenarioId: DEFAULT_SCENARIO_ID,
    selectedContext: HARBOUR_YOUTH,
    workspace: "established-worker",
  },
  // The second ministry selected: the support source is available and holds no goal, which is the
  // "no goal" state a surface must render differently from "no percentage" and from an unavailable source.
  {
    sessionId: "established-worker-students",
    persona: "established-worker",
    label: "Established worker — students ministry",
    description:
      "The same worker with the students ministry selected: an available support source carrying no goal.",
    principalId: PRINCIPAL_ESTABLISHED,
    admittedMemberships: [HARBOUR_YOUTH, HARBOUR_STUDENTS],
    sessionState: "signed-in",
    scenarioId: DEFAULT_SCENARIO_ID,
    selectedContext: HARBOUR_STUDENTS,
    workspace: "students-ministry",
  },
  {
    sessionId: "second-worker",
    persona: "second-worker",
    label: "Second worker",
    description:
      "Another ministry entirely: the isolation proof, holding none of the first scope's records.",
    principalId: PRINCIPAL_SECOND,
    admittedMemberships: [RIVERBEND_OUTREACH],
    sessionState: "signed-in",
    scenarioId: DEFAULT_SCENARIO_ID,
    selectedContext: RIVERBEND_OUTREACH,
    workspace: "second-worker",
  },
  {
    sessionId: "deputized-fundraiser",
    persona: "fundraiser",
    label: "Deputized fundraiser",
    description:
      "Acting inside one admitted ministry, among the shared records and their own private work.",
    principalId: PRINCIPAL_DEPUTIZED,
    admittedMemberships: [HARBOUR_YOUTH],
    sessionState: "signed-in",
    scenarioId: DEFAULT_SCENARIO_ID,
    selectedContext: HARBOUR_YOUTH,
    workspace: "established-worker",
  },
  {
    sessionId: "coach",
    persona: "coach",
    label: "Coach",
    description: "Read-only access to exactly the modules and periods the worker has shared.",
    principalId: PRINCIPAL_COACH,
    admittedMemberships: [],
    sessionState: "signed-in",
    scenarioId: DEFAULT_SCENARIO_ID,
    selectedContext: null,
    workspace: "coach",
  },
  {
    sessionId: "content-reviewer",
    persona: "reviewer",
    label: "Content reviewer",
    description: "Approves frozen content candidates, and only candidates.",
    principalId: PRINCIPAL_REVIEWER,
    admittedMemberships: [HARBOUR_YOUTH],
    sessionState: "signed-in",
    scenarioId: DEFAULT_SCENARIO_ID,
    selectedContext: HARBOUR_YOUTH,
    workspace: "established-worker",
  },
  // A reader is admitted by the persona it previews, not by a ministry membership, so its session
  // carries no admitted membership and has chosen no context: the receiving preview reads one
  // document and one edition, never a workspace.
  {
    sessionId: "reader-public",
    persona: "reader-public",
    label: "Public reader",
    description: "A public reader in the receiving preview, admitted to the public edition only.",
    principalId: PRINCIPAL_READER_PUBLIC,
    admittedMemberships: [],
    sessionState: "signed-in",
    scenarioId: DEFAULT_SCENARIO_ID,
    selectedContext: null,
    workspace: "empty",
  },
  {
    sessionId: "reader-approved-supporter",
    persona: "reader-approved-supporter",
    label: "Approved-supporter reader",
    description:
      "A reader admitted to the approved-supporter edition, and refused the public one's siblings.",
    principalId: PRINCIPAL_READER_SUPPORTER,
    admittedMemberships: [],
    sessionState: "signed-in",
    scenarioId: DEFAULT_SCENARIO_ID,
    selectedContext: null,
    workspace: "empty",
  },
  {
    sessionId: "reader-unauthorized",
    persona: "reader-unauthorized",
    label: "Unauthorized reader",
    description: "Refused protected content honestly, with nothing about it disclosed.",
    principalId: PRINCIPAL_READER_UNAUTHORIZED,
    admittedMemberships: [],
    sessionState: "signed-in",
    scenarioId: DEFAULT_SCENARIO_ID,
    selectedContext: null,
    workspace: "empty",
  },
  {
    sessionId: "subscriber",
    persona: "subscriber",
    label: "Subscriber",
    description: "A reader with a purpose-specific membership, choosing Off or Immediate for it.",
    principalId: PRINCIPAL_SUBSCRIBER,
    admittedMemberships: [],
    sessionState: "signed-in",
    scenarioId: DEFAULT_SCENARIO_ID,
    selectedContext: null,
    workspace: "empty",
  },
  // A session state belongs to a seat rather than being a persona of its own, so these rows are the
  // established worker's seat in each state: the same person, a different admission. The state is
  // what the shell and the service read, and it is never inferred from a label.
  {
    sessionId: "no-access",
    persona: "established-worker",
    label: "No access",
    description: "No usable account: the only honest outcome is account-recovery guidance.",
    principalId: PRINCIPAL_NO_ACCESS,
    admittedMemberships: [],
    sessionState: "no-access",
    scenarioId: DEFAULT_SCENARIO_ID,
    selectedContext: null,
    workspace: "empty",
  },
  // The session reports its source unavailable, so it runs in the scenario that makes the financial
  // source unavailable: the state and the world behind it are the same fact.
  {
    sessionId: "session-unavailable",
    persona: "established-worker",
    label: "Session state — unavailable",
    description:
      "Admission could not be resolved because a source is down: retry guidance, never an empty workspace.",
    principalId: PRINCIPAL_UNAVAILABLE,
    admittedMemberships: [HARBOUR_YOUTH],
    sessionState: "unavailable",
    scenarioId: "financial-source-unavailable",
    selectedContext: null,
    workspace: "empty",
  },
  {
    sessionId: "session-denied",
    persona: "established-worker",
    label: "Session state — denied",
    description: "Denied with nothing disclosed: no count, title, size or existence hint.",
    principalId: PRINCIPAL_DENIED,
    admittedMemberships: [],
    sessionState: "denied",
    scenarioId: DEFAULT_SCENARIO_ID,
    selectedContext: null,
    workspace: "empty",
  },
  {
    sessionId: "session-expired",
    persona: "established-worker",
    label: "Session state — expired",
    description: "An expired session, offered a way back in rather than a blank page.",
    principalId: PRINCIPAL_EXPIRED,
    admittedMemberships: [HARBOUR_YOUTH],
    sessionState: "expired",
    scenarioId: DEFAULT_SCENARIO_ID,
    selectedContext: null,
    workspace: "empty",
  },
  // The remaining scenarios are worlds over the same records, so each is one more row for the same
  // persona rather than a second copy of the inventory: a criterion that needs a source down, a
  // contained edition or a sibling release that failed selects the row that puts it in reach.
  {
    sessionId: "established-worker-media-unavailable",
    persona: "established-worker",
    label: "Established worker — media unavailable",
    description:
      "One placement's source is down: the poster and text alternative stay, the prose is intact, retry is offered.",
    principalId: PRINCIPAL_ESTABLISHED,
    admittedMemberships: [HARBOUR_YOUTH, HARBOUR_STUDENTS],
    sessionState: "signed-in",
    scenarioId: "media-unavailable",
    selectedContext: HARBOUR_YOUTH,
    workspace: "established-worker",
  },
  {
    sessionId: "established-worker-coaching-unavailable",
    persona: "established-worker",
    label: "Established worker — coaching module unavailable",
    description:
      "One admitted coaching module's source is down, and the other admitted modules stay usable.",
    principalId: PRINCIPAL_ESTABLISHED,
    admittedMemberships: [HARBOUR_YOUTH, HARBOUR_STUDENTS],
    sessionState: "signed-in",
    scenarioId: "coaching-module-unavailable",
    selectedContext: HARBOUR_YOUTH,
    workspace: "established-worker",
  },
  {
    sessionId: "established-worker-continuation-on",
    persona: "established-worker",
    label: "Established worker — continuation on",
    description:
      "Worker continuation is on, so an ordinarily expired referral cycle offers its single Continue action.",
    principalId: PRINCIPAL_ESTABLISHED,
    admittedMemberships: [HARBOUR_YOUTH, HARBOUR_STUDENTS],
    sessionState: "signed-in",
    scenarioId: "continuation-on",
    selectedContext: HARBOUR_YOUTH,
    workspace: "established-worker",
  },
  {
    sessionId: "established-worker-continuation-off",
    persona: "established-worker",
    label: "Established worker — continuation off",
    description:
      "Worker continuation is explicitly off, so the same expired cycle offers no Continue action at all.",
    principalId: PRINCIPAL_ESTABLISHED,
    admittedMemberships: [HARBOUR_YOUTH, HARBOUR_STUDENTS],
    sessionState: "signed-in",
    scenarioId: "continuation-off",
    selectedContext: HARBOUR_YOUTH,
    workspace: "established-worker",
  },
  {
    sessionId: "established-worker-partial-release",
    persona: "established-worker",
    label: "Established worker — partial release failure",
    description:
      "One variant of a submission released while its sibling failed, and the sibling's prior-good head was kept.",
    principalId: PRINCIPAL_ESTABLISHED,
    admittedMemberships: [HARBOUR_YOUTH, HARBOUR_STUDENTS],
    sessionState: "signed-in",
    scenarioId: "partial-release-failure",
    selectedContext: HARBOUR_YOUTH,
    workspace: "established-worker-partial-release",
  },
]);

/**
 * Every persona, keyed by its identifier, with the session a spec means when it names that persona.
 *
 * It exists so `apps/dashboard/playwright.config.ts`, the browser specs and the development panel can
 * name an identity instead of repeating a session id, and so a persona this release does not seed is a
 * compile error at the call site rather than a session that silently does nothing.
 */
export const SEEDED_PERSONAS: Readonly<Record<PersonaId, SeededPersona>> = deepFreeze({
  "new-worker": {
    id: "new-worker",
    principalId: PRINCIPAL_NEW_WORKER,
    kind: "worker",
    label: "New worker",
    defaultSessionId: "new-worker",
    description:
      "A worker with no gifts, goal, subscription or integration, starting from a private contact and a task.",
  },
  "established-worker": {
    id: "established-worker",
    principalId: PRINCIPAL_ESTABLISHED,
    kind: "worker",
    label: "Established worker",
    defaultSessionId: DEFAULT_SESSION_ID,
    description:
      "A worker with years of support, recurring gifts, partners, drafts and pages, across two ministries.",
  },
  "second-worker": {
    id: "second-worker",
    principalId: PRINCIPAL_SECOND,
    kind: "worker",
    label: "Second worker",
    defaultSessionId: "second-worker",
    description: "A worker in another organization, whose scope shares nothing with the first.",
  },
  fundraiser: {
    id: "fundraiser",
    principalId: PRINCIPAL_DEPUTIZED,
    kind: "worker",
    label: "Deputized fundraiser",
    defaultSessionId: "deputized-fundraiser",
    description: "Someone deputized to act inside one admitted ministry, and nowhere else.",
  },
  coach: {
    id: "coach",
    principalId: PRINCIPAL_COACH,
    kind: "coach",
    label: "Coach",
    defaultSessionId: "coach",
    description:
      "A coach admitted read-only to exactly the modules and periods a worker has shared, until the frozen cutoff.",
  },
  reviewer: {
    id: "reviewer",
    principalId: PRINCIPAL_REVIEWER,
    kind: "reviewer",
    label: "Content reviewer",
    defaultSessionId: "content-reviewer",
    description:
      "A reviewer who approves or returns the exact frozen revisions a candidate carries, and nothing else.",
  },
  "reader-public": {
    id: "reader-public",
    principalId: PRINCIPAL_READER_PUBLIC,
    kind: "reader",
    label: "Public reader",
    defaultSessionId: "reader-public",
    description: "A reader of the public edition, appearing only in the in-app receiving preview.",
  },
  "reader-approved-supporter": {
    id: "reader-approved-supporter",
    principalId: PRINCIPAL_READER_SUPPORTER,
    kind: "reader",
    label: "Approved-supporter reader",
    defaultSessionId: "reader-approved-supporter",
    description: "A reader admitted to the approved-supporter edition and refused anything else.",
  },
  "reader-unauthorized": {
    id: "reader-unauthorized",
    principalId: PRINCIPAL_READER_UNAUTHORIZED,
    kind: "reader",
    label: "Unauthorized reader",
    defaultSessionId: "reader-unauthorized",
    description:
      "A reader with no grant: the refusal discloses no count, title, size or existence hint.",
  },
  subscriber: {
    id: "subscriber",
    principalId: PRINCIPAL_SUBSCRIBER,
    kind: "reader",
    label: "Subscriber",
    defaultSessionId: "subscriber",
    description:
      "A reader with a purpose-specific membership, choosing Off or Immediate for that purpose alone.",
  },
} satisfies Record<PersonaId, SeededPersona>);

/**
 * The order the development panel lists the seeded roster in: the worker-side identities first,
 * then the reviewer and the coach, then the receiving readers.
 *
 * Written out rather than read from {@link SEEDED_PERSONAS}'s keys, because a key order is a property
 * of insertion rather than a decision: reordering that literal would silently reorder the panel. This
 * list is the order itself, and it is what keeps a persisted roster byte-identical between two runs
 * of the deterministic seed (AAP 0.7.2).
 */
const PERSONA_ROSTER_ORDER: readonly PersonaId[] = Object.freeze([
  "new-worker",
  "established-worker",
  "second-worker",
  "fundraiser",
  "reviewer",
  "coach",
  "reader-public",
  "reader-approved-supporter",
  "reader-unauthorized",
  "subscriber",
]);

/**
 * The persona roster every seeded session persists: the ten personas AAP 0.7.2 seeds, in registry
 * order.
 *
 * It is written into each session's own document rather than derived at read time, so the development
 * read can list the roster without importing this builder, which belongs to the write path. Every
 * session carries the same roster — the panel lists what can be previewed, and which of them the
 * session currently acts as is answered by matching the session's principal, not by which subset the
 * document happens to hold. No clock and no randomness enters it, so two resets persist identical
 * bytes and a caller builds a fresh array on every call rather than sharing one literal.
 */
function seededPersonaRoster(): PersistedPersonaRecord[] {
  return PERSONA_ROSTER_ORDER.map((personaId) => {
    const persona = SEEDED_PERSONAS[personaId];
    return {
      id: persona.id,
      principalId: persona.principalId,
      kind: persona.kind,
      label: persona.label,
      description: persona.description,
    };
  });
}

/** The seeded session ids, in registry order, for an operator listing and for a CLI's validation. */
export const SEEDED_SESSION_IDS: readonly string[] = Object.freeze(
  SEEDED_SESSIONS.map((session) => session.sessionId),
);

/** Returns the seeded row a session id names, or `undefined` when no row does. */
export function findSeededSession(sessionId: string): SeededSession | undefined {
  return SEEDED_SESSIONS.find((session) => session.sessionId === sessionId);
}

/** Reports whether an id names a seeded session, so a caller refuses an unknown id before it writes. */
export function isSeededSessionId(sessionId: string): boolean {
  return findSeededSession(sessionId) !== undefined;
}

// ---------------------------------------------------------------------------------------------
// Small value helpers
// ---------------------------------------------------------------------------------------------

/**
 * Freezes a value and, recursively, everything it holds.
 *
 * The registry below is handed to the development panel, the browser specs and the reset script, so
 * one caller appending to a row's `admittedMemberships` array would change what every later seed
 * writes and two resets would no longer agree. Deep-freezing the registry turns that into a thrown
 * error instead of a silent divergence. The documents a caller builds are not frozen: they are fresh
 * per call, and the store is the one owner that writes them.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze(Reflect.get(value, key));
  }
  return value;
}

/** Builds one exact amount from its currency code and integer minor units; no float arithmetic anywhere. */
function money(currency: string, minorUnits: number): Money {
  return { currency, minorUnits: minorUnitsOf(minorUnits) };
}

/** Builds an opaque source reference: the source that owns the record and its opaque reference. */
function source(system: string, reference: string): SourceReference {
  return { system, reference };
}

/**
 * The instant the civil day starts in a zone, resolved through the one civil-date rule set.
 *
 * A seed row naming a zone this runtime cannot resolve is a defect in the seed rather than a value
 * a reader can act on, so it throws; every zone here is a literal that resolves.
 */
function dayStart(date: string, zone: string): Temporal.Instant {
  const start = startOfCivilDay(Temporal.PlainDate.from(date), zone);
  if (start.status === "refused") {
    throw new RangeError(
      `The seed cannot resolve the start of ${date} in ${zone}: ${start.reason}.`,
    );
  }
  return start.instant;
}

/**
 * The exclusive endpoint of a referral's New window, computed by the boundary function that owns the
 * arithmetic rather than written out as a literal.
 *
 * The seed persists the resolved endpoint, because the rule is that a deadline already stated never
 * moves when the timezone database or the display settings change.
 */
function referralNewWindowEnd(introductionOn: string): Temporal.Instant {
  const window = newWindowEnd({
    originalIntroductionOn: Temporal.PlainDate.from(introductionOn),
    datePrecision: "date",
    sourceZone: REFERRAL_SOURCE_ZONE,
    days: REFERRAL_NEW_WINDOW_DAYS,
  });
  if (window.status !== "bounded") {
    throw new RangeError(
      `The seed cannot bound a referral New window from ${introductionOn}: ${window.status === "refused" ? window.reason : window.reason}.`,
    );
  }
  return window.resolvedEndInstant;
}

/** The exclusive endpoint of a referral continuation: the acceptance instant plus elapsed days. */
function referralContinuedWindowEnd(acceptedAt: Temporal.Instant): Temporal.Instant {
  const window = continuedWindowEnd({
    acceptedAt,
    days: REFERRAL_CONTINUATION_DAYS,
    cycle: { consumed: false },
  });
  if (window.status !== "bounded") {
    throw new RangeError(
      `The seed cannot bound a referral continuation from ${acceptedAt.toString()}: ${window.reason}.`,
    );
  }
  return window.endInstant;
}

/** The instant a purpose-specific membership's confirmation window closes, 168 elapsed hours after acceptance. */
function membershipConfirmationDeadline(acceptedAt: Temporal.Instant): string {
  return confirmationDeadline({ acceptedAt, now: SEED_INSTANT }).deadlineInstant.toString();
}

// ---------------------------------------------------------------------------------------------
// Compact builders: every family states the fields a row does not vary, so a row states only its story
// ---------------------------------------------------------------------------------------------

/** Builds one partner record; a row supplies the fields its kind and its story vary. */
function buildPartner(
  partnerId: string,
  kind: PartnerKind,
  displayName: string,
  overrides: Partial<PartnerRecord> = {},
): PartnerRecord {
  return {
    partnerId,
    kind,
    displayName,
    nameParts: null,
    contactMethods: [],
    restrictions: [],
    tags: [],
    favourite: false,
    stage: null,
    audience: "shared",
    source: null,
    revision: INITIAL_REVISION,
    ...overrides,
  };
}

/** One permitted contact method on a partner record; this release verifies no address or number. */
function contactMethod(
  kind: "email" | "phone" | "postal",
  value: string,
  permitted = true,
): PartnerRecord["contactMethods"][number] {
  return { kind, value, permitted, verified: false };
}

/** A person's name in the parts a form edits them in; the display name is never derived from them. */
function nameParts(given: string, family: string): PartnerRecord["nameParts"] {
  return { given, family, additional: [] };
}

/** Builds one private note; its audience is the literal `private`, so no shared read can carry it. */
function buildPrivateNote(
  noteId: string,
  partnerId: string,
  authorPrincipalId: PrincipalId,
  body: string,
  createdAt: string,
): PrivateNoteRecord {
  return {
    noteId,
    partnerId,
    authorPrincipalId,
    body,
    audience: "private",
    createdAt,
    revision: INITIAL_REVISION,
  };
}

/** Builds one interaction record; a date the worker does not know is `unknown` with no date at all. */
function buildInteraction(
  interactionId: string,
  partnerId: string,
  type: string,
  occurredOn: string | null,
  precision: InteractionRecord["precision"],
  outcome: string,
  overrides: Partial<InteractionRecord> = {},
): InteractionRecord {
  return {
    interactionId,
    partnerId,
    type,
    occurredOn,
    precision,
    outcome,
    participants: [],
    note: null,
    provenance: null,
    revision: INITIAL_REVISION,
    ...overrides,
  };
}

/** Builds one task; only the title is required, and a planned time belongs to a meeting task. */
function buildTask(
  taskId: string,
  title: string,
  ownerPrincipalId: PrincipalId,
  overrides: Partial<TaskRecord> = {},
): TaskRecord {
  return {
    taskId,
    title,
    category: null,
    dueOn: null,
    plannedTime: null,
    timeZone: null,
    kind: "default",
    status: "open",
    partnerId: null,
    initiativeId: null,
    seriesId: null,
    ownerPrincipalId,
    note: null,
    revision: INITIAL_REVISION,
    ...overrides,
  };
}

/** Builds one gift row; a refund or correction carries a negative amount and names the row it corrects. */
function buildGift(
  giftRowId: string,
  giftId: string,
  currency: string,
  minorUnits: number,
  originalGiftOn: string | null,
  overrides: Partial<GiftRowRecord> = {},
): GiftRowRecord {
  return {
    giftRowId,
    giftId,
    allocationId: null,
    amount: money(currency, minorUnits),
    originalGiftOn,
    datePrecision: originalGiftOn === null ? "unknown" : "date",
    designation: null,
    attribution: { kind: "unresolved" },
    refundOf: null,
    provenance: source("finance", giftId),
    entryOn: originalGiftOn ?? "2026-11-20",
    revision: INITIAL_REVISION,
    ...overrides,
  };
}

/** Builds one read-only commitment row; only a fixed-total commitment carries a promised total. */
function buildCommitment(
  commitmentRowId: string,
  kind: CommitmentKind,
  bucketState: RecurringBucket,
  currency: string,
  minorUnits: number,
  overrides: Partial<CommitmentRowRecord> = {},
): CommitmentRowRecord {
  return {
    commitmentRowId,
    kind,
    cadence: "Monthly",
    perOccurrence: money(currency, minorUnits),
    bucketState,
    lastSuccessfulOn: null,
    nextEligibleOn: null,
    pause: { state: "active", resumeOn: null },
    fixedTotal: null,
    provenance: source("finance", commitmentRowId),
    revision: INITIAL_REVISION,
    ...overrides,
  };
}

/** Builds one purpose-specific membership; an email is a value here and never a join key. */
function buildMembership(
  membershipId: string,
  email: string,
  state: MembershipState,
  overrides: Partial<MembershipRecord> = {},
): MembershipRecord {
  return {
    membershipId,
    email,
    displayName: null,
    publisherId: PUBLISHER_HARBOUR,
    purpose: "update-email",
    state,
    acceptedAt: null,
    confirmationDeadline: null,
    languagePreference: null,
    revision: INITIAL_REVISION,
    ...overrides,
  };
}

/**
 * How one seeded rendition's bytes reach the store's media custody when a reset materialises them.
 *
 * `copy` takes the committed fixture's bytes as they are: that fixture *is* the rendition, and
 * `scripts/make-media-fixtures.mjs` is what verified it. `image-display` runs the application's one image
 * pipeline over the committed original, because a display rendition is a preparation the upload path
 * performs, so the seed serves what that pipeline produces rather than the source it came from.
 */
export type SeededMediaProduction = "copy" | "image-display";

/** One seeded rendition's bytes: where they come from, how they are produced, and where custody keeps them. */
export interface SeededMediaBytes {
  /** The asset whose record names these bytes. */
  readonly assetId: string;
  /** The rendition the record states for them. */
  readonly renditionId: string;
  /**
   * The file name custody keeps the bytes under, inside the asset's own directory. The reference form —
   * `media/fixtures/<assetId>/<file>`, relative to the store's data root — belongs to `store/media`, so
   * this table names the file and that module decides where it lives.
   */
  readonly file: string;
  /** The committed fixture the bytes are read from, under `apps/dashboard/public/fixtures/media/`. */
  readonly fixture: string;
  /** How the bytes are produced from that fixture. */
  readonly producedBy: SeededMediaProduction;
}

/**
 * Every byte the seeded inventory serves, in one table.
 *
 * A rendition's `bytesRef` is derived from its row, so the record and the file a reset writes cannot
 * disagree, and the fixture a byte comes from is stated once rather than here and again in the
 * materialising step. The committed fixtures stay inputs: they are read by a reset and never served,
 * because the bytes a request can reach live in the store's own data tree and only the re-authorising
 * media route resolves them.
 *
 * The image's display rendition is named `display.jpg`, never the original's revealing file name: what the
 * pipeline produced is a new image, and the name a camera gave the photograph must not survive into a path
 * a record states.
 */
export const SEEDED_MEDIA_BYTES: readonly SeededMediaBytes[] = Object.freeze([
  {
    assetId: "asset-video-welcome",
    renditionId: "rendition-video-welcome-playback",
    file: "sample-h264.mp4",
    fixture: "sample-h264.mp4",
    producedBy: "copy",
  },
  {
    assetId: "asset-video-welcome",
    renditionId: "rendition-video-welcome-poster",
    file: "poster.jpg",
    fixture: "poster.jpg",
    producedBy: "copy",
  },
  {
    assetId: "asset-video-welcome",
    renditionId: "rendition-video-welcome-captions",
    file: "sample.vtt",
    fixture: "sample.vtt",
    producedBy: "copy",
  },
  {
    assetId: "asset-image-portrait",
    renditionId: "rendition-image-portrait-display",
    file: "display.jpg",
    fixture: "IMG_20260814-harbour-youth-group.jpg",
    producedBy: "image-display",
  },
  {
    assetId: "asset-video-unavailable",
    renditionId: "rendition-video-unavailable-poster",
    file: "poster.jpg",
    fixture: "poster.jpg",
    producedBy: "copy",
  },
]);

/**
 * The custody reference of one seeded rendition, taken from the one table that states where its bytes come
 * from. A rendition with no row is a record that would name bytes nothing materialises, so it is refused
 * here rather than written as a record a reset cannot serve.
 */
function seededBytesRefOf(renditionId: string): string {
  const entry = SEEDED_MEDIA_BYTES.find((candidate) => candidate.renditionId === renditionId);
  if (entry === undefined) {
    throw new Error(
      `No seeded media bytes are declared for ${JSON.stringify(renditionId)}: every rendition the seed records needs a row in SEEDED_MEDIA_BYTES, because that row says which committed fixture a reset materialises and where custody keeps it.`,
    );
  }
  return seededMediaReference(entry.assetId, entry.file);
}

/** One prepared rendition of a media asset: what is served in place of the original bytes. */
function rendition(
  renditionId: string,
  purpose: MediaAssetRenditionPurpose,
  mimeType: string,
): MediaAssetRenditionRecord {
  return { renditionId, purpose, bytesRef: seededBytesRefOf(renditionId), mimeType };
}

/** The bounded presentation every seeded section starts from: plain, single column, start-aligned, cover. */
const NORMAL_PRESENTATION: PresentationChoice = Object.freeze({
  treatment: "normal",
  layout: "single-column",
  alignment: "start",
  imageFit: "cover",
});

/**
 * Builds a content body: the Tiptap document root the profile version validates, with one paragraph
 * per text and the composed sections a page family states. An Update states no sections.
 */
function contentBody(
  direction: ContentDirection,
  paragraphs: readonly string[],
  sections: readonly ContentSection[] = [],
): ContentDocumentJson {
  return {
    type: "doc",
    profileVersion: CONTENT_PROFILE_VERSION,
    direction,
    content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
    sections,
  };
}

/** Builds one exact content revision; its checksum is computed from the body the renderer will read. */
function buildContentRevision(
  revisionId: string,
  variantId: string,
  body: ContentDocumentJson,
  authorPrincipalId: PrincipalId,
  createdAt: string,
  shareTitle: string,
  overrides: Partial<ContentRevisionRecord> = {},
): ContentRevisionRecord {
  return {
    revisionId,
    variantId,
    body,
    mediaPlacements: [],
    captions: [],
    sharePresentation: {
      title: shareTitle,
      description: "Shared from the Harbour youth ministry.",
      imageAssetId: null,
      imageAltText: null,
    },
    contentChecksum: checksum(body),
    authorPrincipalId,
    createdAt,
    revision: INITIAL_REVISION,
    ...overrides,
  };
}

/** Builds one content variant; each variant owns its own draft, candidate and release head. */
function buildContentVariant(
  variantId: string,
  documentId: string,
  audience: ContentAudience,
  locale: string,
  direction: ContentDirection,
  overrides: Partial<ContentVariantRecord> = {},
): ContentVariantRecord {
  return {
    variantId,
    documentId,
    audience,
    locale,
    direction,
    draftRevisionId: null,
    candidateId: null,
    releaseHeadId: null,
    translationSource: null,
    revision: INITIAL_REVISION,
    ...overrides,
  };
}

/** Builds one release: an exact frozen revision, in one audience, in one locale, at one reach. */
function buildRelease(
  releaseId: string,
  variantId: string,
  revisionId: string,
  audience: ContentAudience,
  locale: string,
  publishedAt: string,
  reach: ReleaseReach,
): ReleaseRecord {
  return {
    releaseId,
    variantId,
    revisionId,
    audience,
    locale,
    publishedAt,
    reach,
    withdrawnAt: null,
    supersededBy: null,
    revision: INITIAL_REVISION,
  };
}

/**
 * The scope a seeded media asset is readable in: the session's organization, ministry and support
 * subject with the principal reading it, which is re-checked on every request for a rendition.
 */
function assetScope(session: SeededSession, membership: AdmittedMembership): Scope {
  return {
    organizationId: membership.organizationId,
    ministryId: membership.ministryId,
    supportSubjectId: membership.supportSubjectId,
    principalId: session.principalId,
  };
}

/**
 * Builds one scoped media asset; `sourceOriginalRef` is private and never served.
 *
 * `tagVerification` is the caller's statement about the bytes this asset actually serves, stated per asset
 * because the three seeded assets were verified by different things: the image's display rendition is
 * produced and verified by the application's image pipeline, and the video's playback, poster and caption
 * bytes are the committed fixtures verified by `scripts/make-media-fixtures.mjs`. One hardcoded value here
 * would claim for one asset a check that ran for another — and it would claim it for the image in
 * particular, over bytes that never carried metadata at all.
 */
function buildMediaAsset(
  assetId: string,
  kind: MediaAssetRecord["kind"],
  profileCheck: MediaAssetProfileRecord,
  sourceOriginalRef: string,
  renditions: readonly MediaAssetRenditionRecord[],
  scope: Scope,
  tagVerification: MediaAssetRecord["tagVerification"],
): MediaAssetRecord {
  return {
    assetId,
    kind,
    profileCheck,
    sourceOriginalRef,
    renditions,
    scope,
    tagVerification,
    revision: INITIAL_REVISION,
  };
}

// ---------------------------------------------------------------------------------------------
// The documents a seeded session owns
// ---------------------------------------------------------------------------------------------

/**
 * The records a session's state document holds: one member per record family AAP 0.6.2's table
 * names, each an empty collection in a session that holds none.
 *
 * The operation ledger is deliberately absent: the store gives it its own
 * `<sessionId>.operations.json` so an append-only ledger is never rewritten by a record change. The
 * import proposal family is present and empty in the readable seed, because a proposal is the record
 * of a file the worker chose rather than something the seed can invent. A coaching task share is
 * absent for a related reason: `envelope.ts` declares no stored record for one, and a share exists
 * because a worker selected a task, so seeding a shape of its own would fork the contract the reads
 * parse.
 */
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

/** A session's operation ledger document: append-only entries, and nothing else. */
export interface OperationLedgerDocument {
  readonly version: number;
  readonly entries: readonly OperationRecord[];
}

/**
 * The ledger a freshly seeded session carries: no operation has been accepted in it yet, so a
 * replay of any `operationId` is a first attempt rather than a stored result.
 *
 * Every seeded session starts from this same value, so it is deep-frozen: a caller appending to its
 * `entries` array would otherwise add an entry to every session's ledger at once.
 */
export const EMPTY_OPERATION_LEDGER: OperationLedgerDocument = deepFreeze({
  version: OPERATION_LEDGER_VERSION,
  entries: [] as readonly OperationRecord[],
});

/** The record families a workspace fills; every family it omits is an empty collection. */
type WorkspaceFamilies = Partial<Omit<SessionStateDocument, "version" | "context">>;

/** Builds the stored context record from the session row, which is the single root of its scope. */
function buildContext(session: SeededSession): SessionContextRecord {
  const selected = session.selectedContext;
  return {
    sessionId: session.sessionId,
    principalId: session.principalId,
    admittedMemberships: session.admittedMemberships,
    selectedOrganizationId: selected?.organizationId ?? null,
    selectedMinistryId: selected?.ministryId ?? null,
    selectedSupportSubjectId: selected?.supportSubjectId ?? null,
    // Stored exactly as the row states it. `no-access` is its own admission state and is never
    // collapsed into `denied`: a denial discloses nothing about what it refused, while no-access
    // states the one thing that is known, that there is an account to recover.
    sessionState: session.sessionState,
    scenarioId: session.scenarioId,
    clockOffset: { milliseconds: 0 },
    revision: INITIAL_REVISION,
  };
}

/** Assembles a state document from a session row and the families its workspace fills. */
function stateDocument(session: SeededSession, families: WorkspaceFamilies): SessionStateDocument {
  return {
    version: SESSION_STATE_VERSION,
    context: buildContext(session),
    partners: families.partners ?? [],
    privateNotes: families.privateNotes ?? [],
    interactions: families.interactions ?? [],
    tasks: families.tasks ?? [],
    series: families.series ?? [],
    initiatives: families.initiatives ?? [],
    initiativeMembers: families.initiativeMembers ?? [],
    requests: families.requests ?? [],
    referrals: families.referrals ?? [],
    supportProjection: families.supportProjection ?? null,
    gifts: families.gifts ?? [],
    commitments: families.commitments ?? [],
    contentDocuments: families.contentDocuments ?? [],
    contentVariants: families.contentVariants ?? [],
    contentRevisions: families.contentRevisions ?? [],
    releases: families.releases ?? [],
    mediaAssets: families.mediaAssets ?? [],
    memberships: families.memberships ?? [],
    notificationIntents: families.notificationIntents ?? [],
    notificationResults: families.notificationResults ?? [],
    coachingGrants: families.coachingGrants ?? [],
    coachingTargets: families.coachingTargets ?? [],
    coachingCheckIns: families.coachingCheckIns ?? [],
    importProposals: families.importProposals ?? [],
  };
}

// ---------------------------------------------------------------------------------------------
// The new worker: a private contact and one task, and nothing else
// ---------------------------------------------------------------------------------------------

/**
 * The new worker's workspace, exactly as AAP 0.1.2 states it: no gifts, no goal, no subscription and
 * no integration, and a first private contact with one task to do about it.
 */
function newWorkerWorkspace(session: SeededSession): SessionStateDocument {
  const partners: readonly PartnerRecord[] = [
    buildPartner("partner-nw-ada-quinn", "private-preparation", "Ada Quinn (met on Sunday)", {
      audience: "private",
      contactMethods: [contactMethod("email", "ada.quinn@example.org")],
      tags: ["first-contact"],
    }),
  ];

  const tasks: readonly TaskRecord[] = [
    buildTask("task-nw-first-follow-up", "Send Ada a first note", session.principalId, {
      category: "Care",
      dueOn: "2026-11-24",
      partnerId: "partner-nw-ada-quinn",
      note: "Ask how she heard about the ministry before adding her to anything.",
    }),
  ];

  return stateDocument(session, { partners, tasks });
}

// ---------------------------------------------------------------------------------------------
// The second worker: a small distinct set in another ministry, which is the isolation proof
// ---------------------------------------------------------------------------------------------

/**
 * The second worker's workspace: its own contacts, note, interaction, task and gift in another
 * organization entirely, so a read from this scope can return nothing of the first scope's records.
 */
function secondWorkerWorkspace(session: SeededSession): SessionStateDocument {
  const partners: readonly PartnerRecord[] = [
    buildPartner("partner-river-owen-hale", "person", "Owen Hale", {
      nameParts: nameParts("Owen", "Hale"),
      contactMethods: [contactMethod("email", "owen.hale@example.org")],
      tags: ["outreach"],
      source: source("crm", "crm-2011"),
    }),
    buildPartner("partner-river-theo-brooks", "person", "Theo Brooks", {
      nameParts: nameParts("Theo", "Brooks"),
      contactMethods: [contactMethod("phone", "+44 20 7946 0613")],
      favourite: true,
    }),
  ];

  const privateNotes: readonly PrivateNoteRecord[] = [
    buildPrivateNote(
      "note-river-owen-hale",
      "partner-river-owen-hale",
      session.principalId,
      "Only this ministry's record. Nothing here is shared with Harbour.",
      "2026-11-09T10:15:00Z",
    ),
  ];

  const interactions: readonly InteractionRecord[] = [
    buildInteraction(
      "interaction-river-owen-hale",
      "partner-river-owen-hale",
      "Phone call",
      "2026-11-09",
      "date",
      "Agreed to hear about the outreach evening",
      {
        participants: [{ role: "Worker", partnerId: null, principalId: session.principalId }],
      },
    ),
  ];

  const tasks: readonly TaskRecord[] = [
    buildTask(
      "task-river-invite-owen",
      "Send Owen the outreach evening details",
      session.principalId,
      {
        dueOn: "2026-11-25",
        partnerId: "partner-river-owen-hale",
      },
    ),
  ];

  const gifts: readonly GiftRowRecord[] = [
    buildGift("gift-row-river-0001", "gift-river-0001", "USD", 7500, "2026-11-06", {
      designation: "Outreach",
      attribution: { kind: "partner", partnerId: "partner-river-owen-hale" },
      provenance: source("finance", "gift-river-0001"),
    }),
  ];

  const supportProjection: SupportProjectionRecord = {
    supportSubjectId: SUPPORT_SUBJECT_OUTREACH,
    basis: "effective_cash_allocation",
    currencyExponents: { USD: 2 },
    coverage: { from: "2026-01-01", to: "2026-11-06", state: "complete" },
    asOf: SEED_INSTANT.toString(),
    lastSourceUpdate: "2026-11-06T21:00:00Z",
    goal: null,
    source: source("finance", "ledger-riverbend-2026"),
    revision: INITIAL_REVISION,
  };

  return stateDocument(session, {
    partners,
    privateNotes,
    interactions,
    tasks,
    gifts,
    supportProjection,
  });
}

// ---------------------------------------------------------------------------------------------
// The established worker's shared records: relationships, preparation and work
// ---------------------------------------------------------------------------------------------

/**
 * The relationship roster: people, a household, a church, an organization and its separately
 * recorded representative, non-financial contacts, names in other scripts, a leading-zero source
 * reference and one deliberately restricted record.
 *
 * A household is not a person's contactability or consent and an organization's representative is a
 * separate record, so neither is a field on another record: identity here is the record's own id.
 */
function harbourPartners(): readonly PartnerRecord[] {
  return [
    buildPartner("partner-jo-mbeki", "person", "Jo Mbeki", {
      nameParts: nameParts("Jo", "Mbeki"),
      contactMethods: [contactMethod("email", "jo.mbeki@example.org")],
      tags: ["church-visit"],
      favourite: true,
      stage: "Follow up",
      source: source("crm", "crm-1001"),
    }),
    buildPartner("partner-household-nakamura", "household", "The Nakamura Household", {
      contactMethods: [contactMethod("postal", "14 Bridge Lane, Harbourton HT1 3AB")],
      tags: ["newsletter"],
    }),
    buildPartner("partner-hana-nakamura", "person", "Hana Nakamura", {
      nameParts: nameParts("Hana", "Nakamura"),
      contactMethods: [contactMethod("email", "hana.nakamura@example.org")],
    }),
    buildPartner("partner-kenji-nakamura", "person", "Kenji Nakamura", {
      nameParts: nameParts("Kenji", "Nakamura"),
      contactMethods: [contactMethod("phone", "+44 20 7946 0421")],
    }),
    buildPartner("partner-church-st-aidan", "church", "St Aidan's Church", {
      contactMethods: [contactMethod("postal", "2 Abbey Road, Harbourton HT1 8PJ")],
      tags: ["church"],
    }),
    // The church's warden is a person in her own right, recorded apart from the church record.
    buildPartner("partner-ruth-okafor", "person", "Ruth Okafor", {
      nameParts: nameParts("Ruth", "Okafor"),
      contactMethods: [contactMethod("email", "ruth.okafor@example.org")],
      stage: "Church warden",
    }),
    buildPartner("partner-harbour-trust", "organization", "Harbour Community Trust", {
      contactMethods: [contactMethod("email", "grants.harbour@example.org")],
      tags: ["grant-maker"],
      // A leading zero survives exactly: this is an opaque reference, never a number.
      source: source("crm", "00042"),
    }),
    // The Trust's representative is deliberately a distinct record from the Trust itself.
    buildPartner("partner-daniel-whitfield", "person", "Daniel Whitfield", {
      nameParts: nameParts("Daniel", "Whitfield"),
      contactMethods: [contactMethod("email", "daniel.whitfield@example.org")],
      stage: "Trust representative",
    }),
    // Names in another script, kept exactly as written.
    buildPartner("partner-elena-sokolova", "person", "Елена Соколова", {
      nameParts: nameParts("Елена", "Соколова"),
      contactMethods: [contactMethod("email", "elena.sokolova@example.org")],
    }),
    buildPartner("partner-sara-al-hassan", "person", "سارة الحسن", {
      nameParts: nameParts("سارة", "الحسن"),
      contactMethods: [contactMethod("phone", "+44 20 7946 0912")],
    }),
    // The one deliberately restricted record: the number is recorded and not permitted.
    buildPartner("partner-marcus-webb", "person", "Marcus Webb", {
      nameParts: nameParts("Marcus", "Webb"),
      contactMethods: [
        contactMethod("phone", "+44 20 7946 0958", false),
        contactMethod("email", "marcus.webb@example.org"),
      ],
      restrictions: [
        { kind: "no-phone", detail: "Asked that we never telephone, and confirmed it in writing." },
      ],
      tags: ["restriction"],
    }),
    // A volunteer who has never given, whom no surface may present as a supporter.
    buildPartner("partner-priya-raman", "person", "Priya Raman", {
      nameParts: nameParts("Priya", "Raman"),
      contactMethods: [contactMethod("email", "priya.raman@example.org")],
      tags: ["volunteer"],
    }),
    buildPartner("partner-grace-adeyemi", "person", "Grace Adeyemi", {
      nameParts: nameParts("Grace", "Adeyemi"),
      contactMethods: [contactMethod("email", "grace.adeyemi@example.org")],
    }),
    // Worker-private preparation with no shared identity at all.
    buildPartner(
      "partner-prep-sunday-visitor",
      "private-preparation",
      "Sunday visitor (name to confirm)",
      { audience: "private", tags: ["preparation"] },
    ),
  ];
}

/** The worker's own private preparation notes: a different record class from a shared fact. */
function harbourPrivateNotes(session: SeededSession): readonly PrivateNoteRecord[] {
  return [
    buildPrivateNote(
      "note-prep-sunday-visitor",
      "partner-prep-sunday-visitor",
      session.principalId,
      "Visited with a friend on Sunday and asked about the youth programme. Do not add them to any list until they say so.",
      "2026-11-16T18:40:00Z",
    ),
    buildPrivateNote(
      "note-jo-mbeki",
      "partner-jo-mbeki",
      session.principalId,
      "Prefers a call after 6pm, and asked for nothing to be posted to the shared house address.",
      "2026-11-12T19:05:00Z",
    ),
  ];
}

/** What actually happened, recorded with the precision each date is known to. */
function harbourInteractions(session: SeededSession): readonly InteractionRecord[] {
  return [
    buildInteraction(
      "interaction-jo-call",
      "partner-jo-mbeki",
      "Phone call",
      "2026-11-12",
      "date",
      "Left a voicemail",
      {
        participants: [{ role: "Worker", partnerId: null, principalId: session.principalId }],
        note: {
          body: "Left a message about the autumn appeal; will try again next week.",
          audience: "private",
        },
      },
    ),
    buildInteraction(
      "interaction-household-visit",
      "partner-household-nakamura",
      "Visit",
      "2026-10-04",
      "approximate",
      "Met the household for tea",
      {
        participants: [
          { role: "Worker", partnerId: null, principalId: session.principalId },
          { role: "Host", partnerId: "partner-hana-nakamura", principalId: null },
        ],
        note: {
          body: "Warm visit; the household was in and asked after the students' group.",
          audience: "shared",
        },
      },
    ),
    // An honest "I do not know when": unknown precision and no date at all.
    buildInteraction(
      "interaction-ruth-email",
      "partner-ruth-okafor",
      "Email",
      null,
      "unknown",
      "Replied about the autumn appeal",
      {
        provenance: source("mail", "mail-7712"),
        note: {
          body: "The reply arrived, but the day it was sent was never recorded.",
          audience: "shared",
        },
      },
    ),
    buildInteraction(
      "interaction-grace-meeting",
      "partner-grace-adeyemi",
      "Meeting",
      "2026-11-06",
      "date",
      "Discussed what the appeal asks for",
      {
        participants: [{ role: "Worker", partnerId: null, principalId: session.principalId }],
        provenance: source("crm", "crm-act-8814"),
      },
    ),
  ];
}

/**
 * The five repeat rules the seeded series run on, each stated once so a series' current rule and the
 * rule revision it was appended as cannot drift apart.
 *
 * The month-end rule is monthly on day 31: a month with 30 days or fewer resolves to its final day
 * and discloses that resolution, which is what makes the February case reachable from stored data.
 */
const SERIES_MONTH_END_RULE: TaskSeriesRecord["currentRule"] = {
  profile: "monthlyOnDay",
  interval: 1,
  dayOfMonth: 31,
  firstDueOn: "2026-08-31",
  planningTimeZone: REFERRAL_SOURCE_ZONE,
  end: { kind: "ongoing-personal-policy" },
};

/** An ordinary weekly series with a stated count, so "how many are left" is a stored fact. */
const SERIES_WEEKLY_CALL_ROUND: TaskSeriesRecord["currentRule"] = {
  profile: "weekly",
  interval: 1,
  dayOfMonth: null,
  firstDueOn: "2026-11-04",
  planningTimeZone: REFERRAL_SOURCE_ZONE,
  end: { kind: "after-count", count: 12 },
};

/** An every-two-weeks series with an inclusive end date, which is the shape a paused series keeps. */
const SERIES_FORTNIGHTLY_NEWSLETTER: TaskSeriesRecord["currentRule"] = {
  profile: "everyNWeeks",
  interval: 2,
  dayOfMonth: null,
  firstDueOn: "2026-09-07",
  planningTimeZone: REFERRAL_SOURCE_ZONE,
  end: { kind: "on-date", on: "2027-03-29" },
};

/** The rule of a series the worker stopped: it keeps its history and admits nothing further. */
const SERIES_VISIT_ROUND: TaskSeriesRecord["currentRule"] = {
  profile: "weekly",
  interval: 1,
  dayOfMonth: null,
  firstDueOn: "2026-10-05",
  planningTimeZone: REFERRAL_SOURCE_ZONE,
  end: { kind: "after-count", count: 6 },
};

/** The rule of the series whose current date was missed three times over. */
const SERIES_MISSED_PLAN_REVIEW: TaskSeriesRecord["currentRule"] = {
  profile: "weekly",
  interval: 1,
  dayOfMonth: null,
  firstDueOn: "2026-09-24",
  planningTimeZone: REFERRAL_SOURCE_ZONE,
  end: { kind: "ongoing-personal-policy" },
};

/** The work a seeded session starts with, including the one actionable occurrence of each series. */
function harbourTasks(session: SeededSession): readonly TaskRecord[] {
  return [
    buildTask("task-care-jo", "Follow up with Jo after the visit", session.principalId, {
      category: "Care",
      dueOn: "2026-11-24",
      partnerId: "partner-jo-mbeki",
    }),
    // A meeting states a planned time and always discloses the zone it is stated in.
    buildTask("task-meeting-grace", "Talk terms with Grace", session.principalId, {
      kind: "meeting",
      dueOn: "2026-11-26",
      plannedTime: "14:30",
      timeZone: REFERRAL_SOURCE_ZONE,
      partnerId: "partner-grace-adeyemi",
      initiativeId: "initiative-autumn-appeal",
    }),
    buildTask("task-overdue-thank-you", "Send the thank-you note", session.principalId, {
      category: "Thank you",
      dueOn: "2026-11-10",
      partnerId: "partner-hana-nakamura",
    }),
    buildTask(
      "task-completed-intro",
      "Introduce Grace to the students' group",
      session.principalId,
      {
        status: "completed",
        dueOn: "2026-11-05",
        partnerId: "partner-grace-adeyemi",
      },
    ),
    // Undated on purpose: a list must show it as undated rather than invent a due date for it.
    buildTask("task-undated-prayer", "Pray for the students' exam week", session.principalId, {
      category: "Prayer",
    }),
    // Completed once and then reopened by hand, so the reopened state is reachable from real work.
    buildTask("task-reopened-warden-visit", "Visit the church warden", session.principalId, {
      status: "reopened",
      dueOn: "2026-11-28",
      partnerId: "partner-ruth-okafor",
    }),
    // November has 30 days, so the day-31 rule resolves this occurrence to the 30th.
    buildTask("task-series-month-end", "Month-end support review", session.principalId, {
      dueOn: "2026-11-30",
      seriesId: "series-month-end-support-review",
    }),
    // The one actionable occurrence of the weekly series: the following dates are previews only.
    buildTask("task-series-weekly-call", "Weekly call round", session.principalId, {
      dueOn: "2026-11-25",
      seriesId: "series-weekly-call-round",
    }),
    // The occurrence a stopped series left behind: stopping explains its fate, it does not complete it.
    buildTask("task-series-stopped-leftover", "Visit round: Abbey Road", session.principalId, {
      dueOn: "2026-10-19",
      partnerId: "partner-church-st-aidan",
      seriesId: "series-visit-round",
    }),
    // Three dates have passed since this occurrence was due, so its plan needs review rather than a
    // stack of overdue copies.
    buildTask(
      "task-series-missed-occurrence",
      "Monday review of the working list",
      session.principalId,
      {
        dueOn: "2026-10-22",
        seriesId: "series-missed-plan-review",
      },
    ),
  ];
}

/**
 * Builds one series: its current rule, the one rule revision it was written as, and the single
 * occurrence it admits, if any.
 *
 * A series revision is appended rather than rewritten, so the history a completed occurrence was
 * measured against stays as it was written; the seed therefore states the first revision explicitly.
 */
function buildSeries(
  seriesId: string,
  session: SeededSession,
  title: string,
  currentRule: TaskSeriesRecord["currentRule"],
  state: TaskSeriesRecord["state"],
  options: { readonly currentOccurrenceId?: string; readonly planNeedsReview?: boolean } = {},
): TaskSeriesRecord {
  return {
    seriesId,
    ownerPrincipalId: session.principalId,
    title,
    currentRule,
    effectiveRevisions: [
      {
        revisionId: `${seriesId}-rev-1`,
        effectiveFrom: currentRule.firstDueOn,
        rule: currentRule,
      },
    ],
    currentOccurrenceId: options.currentOccurrenceId ?? null,
    state,
    planNeedsReview: options.planNeedsReview ?? false,
    revision: INITIAL_REVISION,
  };
}

/**
 * The repeating work, in every state a series can be in: active with one actionable occurrence, a
 * weekly round, a paused series, a stopped one whose leftover occurrence still exists, and one whose
 * current date was missed three times over.
 *
 * A stopped series states its history and admits nothing further, and it never completes the work it
 * leaves behind: the leftover occurrence stays open, with its own fate to be decided.
 */
function harbourSeries(session: SeededSession): readonly TaskSeriesRecord[] {
  return [
    buildSeries(
      "series-month-end-support-review",
      session,
      "Month-end support review",
      SERIES_MONTH_END_RULE,
      "active",
      { currentOccurrenceId: "task-series-month-end" },
    ),
    buildSeries(
      "series-weekly-call-round",
      session,
      "Weekly call round",
      SERIES_WEEKLY_CALL_ROUND,
      "active",
      { currentOccurrenceId: "task-series-weekly-call" },
    ),
    buildSeries(
      "series-fortnightly-newsletter",
      session,
      "Fortnightly newsletter to partners",
      SERIES_FORTNIGHTLY_NEWSLETTER,
      "paused",
    ),
    buildSeries("series-visit-round", session, "Visit round", SERIES_VISIT_ROUND, "stopped"),
    buildSeries(
      "series-missed-plan-review",
      session,
      "Monday review of the working list",
      SERIES_MISSED_PLAN_REVIEW,
      "active",
      { currentOccurrenceId: "task-series-missed-occurrence", planNeedsReview: true },
    ),
  ];
}

// ---------------------------------------------------------------------------------------------
// Outreach: an initiative, its working list, a versioned Request, and the referral cycles
// ---------------------------------------------------------------------------------------------

/** The one finite initiative: a named purpose, one responsible person, one ministry context. */
function harbourInitiatives(session: SeededSession): readonly InitiativeRecord[] {
  return [
    {
      initiativeId: "initiative-autumn-appeal",
      name: "Autumn appeal",
      purpose:
        "Invite current partners to consider supporting the youth programme through the autumn.",
      ministryContextId: MINISTRY_YOUTH,
      responsiblePrincipalId: session.principalId,
      period: { from: "2026-09-01", to: "2026-11-30" },
      state: "open",
      closureDisposition: null,
      revision: INITIAL_REVISION,
    },
  ];
}

/**
 * The reviewed working list, in all three member states: included (which is not "asked"), removed
 * with its history kept, and excluded as a deliberate decision not to approach.
 */
function harbourInitiativeMembers(session: SeededSession): readonly InitiativeMemberRecord[] {
  const addedBy = session.principalId;
  return [
    {
      memberId: "member-autumn-jo",
      initiativeId: "initiative-autumn-appeal",
      partnerId: "partner-jo-mbeki",
      state: "included",
      stage: "Answered",
      addedAt: "2026-09-02T09:00:00Z",
      returnedAt: null,
      history: [
        {
          state: "included",
          at: "2026-09-02T09:00:00Z",
          byPrincipalId: addedBy,
          reason: "Added from the reviewed working list.",
        },
      ],
      revision: INITIAL_REVISION,
    },
    {
      memberId: "member-autumn-grace",
      initiativeId: "initiative-autumn-appeal",
      partnerId: "partner-grace-adeyemi",
      state: "included",
      stage: "Asked",
      addedAt: "2026-09-02T09:05:00Z",
      returnedAt: null,
      history: [
        {
          state: "included",
          at: "2026-09-02T09:05:00Z",
          byPrincipalId: addedBy,
          reason: "Added from the reviewed working list.",
        },
      ],
      revision: INITIAL_REVISION,
    },
    {
      memberId: "member-autumn-priya",
      initiativeId: "initiative-autumn-appeal",
      partnerId: "partner-priya-raman",
      state: "removed",
      stage: null,
      addedAt: "2026-09-02T09:10:00Z",
      returnedAt: "2026-10-01T10:00:00Z",
      history: [
        {
          state: "included",
          at: "2026-09-02T09:10:00Z",
          byPrincipalId: addedBy,
          reason: "Added from the reviewed working list.",
        },
        {
          state: "removed",
          at: "2026-10-01T10:00:00Z",
          byPrincipalId: addedBy,
          reason: "Volunteers rather than gives, and asked not to be asked.",
        },
      ],
      revision: INITIAL_REVISION,
    },
    {
      memberId: "member-autumn-marcus",
      initiativeId: "initiative-autumn-appeal",
      partnerId: "partner-marcus-webb",
      state: "excluded",
      stage: null,
      addedAt: "2026-09-02T09:15:00Z",
      returnedAt: null,
      history: [
        {
          state: "excluded",
          at: "2026-09-02T09:15:00Z",
          byPrincipalId: addedBy,
          reason: "Asked not to be approached; the restriction stays recorded.",
        },
      ],
      revision: INITIAL_REVISION,
    },
  ];
}

/**
 * The one Request, and the late response that answers it.
 *
 * The Request's terms have since moved to `terms-v2`, while the presentation cites `terms-v1` and the
 * response binds to `terms-v1`: a response answers the terms version it actually answered rather than
 * whatever version exists when it is read. A response creates no pledge, gift, task or message.
 */
function harbourRequests(): readonly RequestRecord[] {
  return [
    {
      requestId: "request-autumn-grace",
      initiativeId: "initiative-autumn-appeal",
      recipientPartnerId: "partner-grace-adeyemi",
      representedOrganizationId: null,
      purpose: "Support the youth programme through the autumn appeal.",
      terms: {
        version: "terms-v2",
        money: { amount: money("USD", 5000), cadence: "Monthly", term: "12 months" },
        nonFinancial: null,
      },
      presentation: { presentedOn: "2026-09-15", manner: "In person", versionRef: "terms-v1" },
      response: {
        kind: "conditional",
        respondentId: "partner-grace-adeyemi",
        standingEvidence: null,
        termsVersionRef: "terms-v1",
        recordedAt: "2026-11-06T16:20:00Z",
      },
      nextWorkIds: ["task-care-jo"],
      revision: INITIAL_REVISION,
    },
  ];
}

/**
 * The referral cycles: one already expired on its New window, the cycle it was continued from, the
 * continuation itself, and two whose date evidence yields no deadline at all.
 *
 * The resolved endpoints come from the boundary functions that own the arithmetic — calendar days for
 * a New window, elapsed seconds for a continuation — and are persisted, so a later timezone-data or
 * display-settings change cannot move a deadline that has already been stated.
 */
function harbourReferrals(): readonly ReferralCycleRecord[] {
  const continuedAcceptedAt = Temporal.Instant.from("2026-11-02T10:00:00Z");
  return [
    {
      referralId: "referral-jo-expired",
      partnerId: "partner-jo-mbeki",
      originalIntroductionOn: "2026-05-04",
      datePrecision: "date",
      sourceZone: REFERRAL_SOURCE_ZONE,
      sourceReference: source("crm", "intro-4411"),
      cycleIndex: 0,
      windowKind: "new",
      windowStart: dayStart("2026-05-04", REFERRAL_SOURCE_ZONE).toString(),
      windowEnd: referralNewWindowEnd("2026-05-04").toString(),
      consumed: false,
      predecessorId: null,
      revision: INITIAL_REVISION,
    },
    {
      referralId: "referral-ruth-new",
      partnerId: "partner-ruth-okafor",
      originalIntroductionOn: "2026-03-02",
      datePrecision: "date",
      sourceZone: REFERRAL_SOURCE_ZONE,
      sourceReference: source("crm", "intro-3902"),
      cycleIndex: 0,
      windowKind: "new",
      windowStart: dayStart("2026-03-02", REFERRAL_SOURCE_ZONE).toString(),
      windowEnd: referralNewWindowEnd("2026-03-02").toString(),
      consumed: true,
      predecessorId: null,
      revision: INITIAL_REVISION,
    },
    {
      referralId: "referral-ruth-continued",
      partnerId: "partner-ruth-okafor",
      originalIntroductionOn: "2026-03-02",
      datePrecision: "date",
      sourceZone: REFERRAL_SOURCE_ZONE,
      sourceReference: source("crm", "intro-3902"),
      cycleIndex: 1,
      windowKind: "continued",
      windowStart: continuedAcceptedAt.toString(),
      windowEnd: referralContinuedWindowEnd(continuedAcceptedAt).toString(),
      consumed: false,
      predecessorId: "referral-ruth-new",
      revision: INITIAL_REVISION,
    },
    {
      // A date-only cycle still inside its New window at the seed instant: D is day one, so a
      // fourteen-day window opened on 12 November is still active on 20 November.
      referralId: "referral-kenji-active",
      partnerId: "partner-kenji-nakamura",
      originalIntroductionOn: "2026-11-12",
      datePrecision: "date",
      sourceZone: REFERRAL_SOURCE_ZONE,
      sourceReference: source("crm", "intro-5117"),
      cycleIndex: 0,
      windowKind: "new",
      windowStart: dayStart("2026-11-12", REFERRAL_SOURCE_ZONE).toString(),
      windowEnd: referralNewWindowEnd("2026-11-12").toString(),
      consumed: false,
      predecessorId: null,
      revision: INITIAL_REVISION,
    },
    {
      // An approximate date yields no deadline, no Active/Expired judgement and no Continue.
      referralId: "referral-hana-approximate",
      partnerId: "partner-hana-nakamura",
      originalIntroductionOn: "2026-09-10",
      datePrecision: "approximate",
      sourceZone: REFERRAL_SOURCE_ZONE,
      sourceReference: null,
      cycleIndex: 0,
      windowKind: "new",
      windowStart: null,
      windowEnd: null,
      consumed: false,
      predecessorId: null,
      revision: INITIAL_REVISION,
    },
    {
      // An unknown date states no date at all rather than a guessed one.
      referralId: "referral-sara-unknown",
      partnerId: "partner-sara-al-hassan",
      originalIntroductionOn: null,
      datePrecision: "unknown",
      sourceZone: REFERRAL_SOURCE_ZONE,
      sourceReference: null,
      cycleIndex: 0,
      windowKind: "new",
      windowStart: null,
      windowEnd: null,
      consumed: false,
      predecessorId: null,
      revision: INITIAL_REVISION,
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Support: one named basis with its provenance and coverage, the gifts, and the commitments
// ---------------------------------------------------------------------------------------------

/**
 * The one support projection for the selected ministry: source-qualified effective cash allocations,
 * partial coverage because the source's history does not reach back to the beginning of the record,
 * four currency exponents including a three-decimal and a zero-decimal one, and one goal.
 *
 * `UNKNOWN` is deliberately absent from `currencyExponents`: an amount whose currency the source did
 * not identify has no exponent, so no surface may render it as a major-unit total, sum it or compare
 * it with another currency.
 */
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
      measure: "received-support",
      effectiveFrom: "2026-01-01",
      // A goal's revision is the base revision an edit presents, and the report reads it as a whole
      // number: it is the one seeded revision that is not an opaque token, so it is not "rev-1".
      revision: "1",
    },
    source: source("finance", "ledger-harbour-2026"),
    revision: INITIAL_REVISION,
  };
}

/**
 * The gift ledger at the grain it is read in: several currencies, a split gift whose sibling
 * allocation belongs to another ministry, a refund that names the row it corrects, anonymous and
 * unresolved support, and one amount in a currency the source never identified.
 */
function harbourGifts(): readonly GiftRowRecord[] {
  return [
    buildGift("gift-row-harbour-0001", "gift-harbour-0001", "USD", 12500, "2026-11-02", {
      designation: "Youth ministry",
      attribution: { kind: "partner", partnerId: "partner-jo-mbeki" },
      provenance: source("finance", "gift-harbour-0001"),
    }),
    // A split gift: this ministry may see only its own allocation of it.
    buildGift("gift-row-harbour-0002", "gift-harbour-0002", "USD", 10000, "2026-10-20", {
      designation: "Youth ministry",
      attribution: { kind: "partner", partnerId: "partner-hana-nakamura" },
      provenance: source("finance", "gift-harbour-0002"),
    }),
    buildGift("gift-row-harbour-0003", "gift-harbour-0002", "USD", 4000, "2026-10-20", {
      allocationId: "alloc-harbour-0002-youth",
      designation: "Youth ministry",
      attribution: { kind: "partner", partnerId: "partner-hana-nakamura" },
      provenance: source("finance", "gift-harbour-0002"),
    }),
    // A three-decimal currency: 1,250 minor units is 1.250 KWD, never 12.50.
    buildGift("gift-row-harbour-0004", "gift-harbour-0004", "KWD", 1250, "2026-10-15", {
      designation: "Youth ministry",
      attribution: { kind: "partner", partnerId: "partner-daniel-whitfield" },
      provenance: source("finance", "gift-harbour-0004"),
    }),
    // A zero-decimal currency: 5,000 minor units is 5,000 JPY, and the exponent is never assumed.
    buildGift("gift-row-harbour-0005", "gift-harbour-0005", "JPY", 5000, "2026-09-28", {
      designation: "Youth ministry",
      attribution: { kind: "partner", partnerId: "partner-elena-sokolova" },
      provenance: source("finance", "gift-harbour-0005"),
    }),
    buildGift("gift-row-harbour-0006", "gift-harbour-0006", "EUR", 2500, "2026-09-12", {
      attribution: { kind: "partner", partnerId: "partner-kenji-nakamura" },
      provenance: source("finance", "gift-harbour-0006"),
    }),
    // The source never identified this currency, so no exponent exists for it and it is never defaulted.
    buildGift("gift-row-harbour-0007", "gift-harbour-0007", UNKNOWN_CURRENCY, 7500, "2026-08-30", {
      provenance: source("finance", "gift-harbour-0007"),
    }),
    buildGift("gift-row-harbour-0008", "gift-harbour-0008", "USD", 5000, "2026-08-18", {
      attribution: { kind: "anonymous" },
      provenance: source("finance", "gift-harbour-0008"),
    }),
    buildGift("gift-row-harbour-0009", "gift-harbour-0009", "USD", 7500, "2026-07-05", {
      designation: "Youth ministry",
      attribution: { kind: "partner", partnerId: "partner-church-st-aidan" },
      provenance: source("finance", "gift-harbour-0009"),
    }),
    // The refund explains itself instead of disappearing: a negative amount naming the row it corrects.
    buildGift("gift-row-harbour-0010", "gift-harbour-0010", "USD", -7500, "2026-09-01", {
      designation: "Youth ministry",
      attribution: { kind: "partner", partnerId: "partner-church-st-aidan" },
      refundOf: "gift-row-harbour-0009",
      provenance: source("finance", "gift-harbour-0010"),
    }),
    // An approximate gift date: the precision travels with the date rather than being invented.
    buildGift("gift-row-harbour-0011", "gift-harbour-0011", "USD", 3000, "2026-06-01", {
      datePrecision: "approximate",
      attribution: { kind: "partner", partnerId: "partner-ruth-okafor" },
      provenance: source("finance", "gift-harbour-0011"),
    }),
  ];
}

/**
 * The commitments: all three kinds, one in each of the five outcome buckets, and one whose source
 * evidence is unknown or stale so it sits outside the partition rather than in a sixth bucket.
 *
 * A commitment is not received money and a bucket never implies that this application can retry,
 * post, correct or refund anything.
 */
function harbourCommitments(): readonly CommitmentRowRecord[] {
  return [
    buildCommitment("commitment-harbour-0001", "automatic-recurring", "received", "USD", 5000, {
      cadence: "Monthly",
      lastSuccessfulOn: "2026-11-05",
      nextEligibleOn: "2026-12-05",
    }),
    buildCommitment("commitment-harbour-0002", "automatic-recurring", "processing", "EUR", 1500, {
      lastSuccessfulOn: "2026-10-25",
      nextEligibleOn: "2026-11-25",
    }),
    buildCommitment("commitment-harbour-0003", "manual-recurring", "upcoming", "USD", 2500, {
      nextEligibleOn: "2026-12-01",
    }),
    buildCommitment(
      "commitment-harbour-0004",
      "manual-recurring",
      "recovery-needs-attention",
      "USD",
      1000,
      { lastSuccessfulOn: "2026-09-10", nextEligibleOn: "2026-09-10" },
    ),
    buildCommitment("commitment-harbour-0005", "fixed-total", "not-received", "USD", 5000, {
      cadence: "Once",
      fixedTotal: {
        promised: money("USD", 250000),
        fulfilled: money("USD", 100000),
        released: money("USD", 25000),
        remaining: money("USD", 125000),
      },
    }),
    buildCommitment(
      "commitment-harbour-0006",
      "automatic-recurring",
      "outside-partition",
      "KWD",
      1000,
      {
        pause: { state: "paused", resumeOn: "2026-12-01" },
        lastSuccessfulOn: "2026-08-02",
      },
    ),
  ];
}

// ---------------------------------------------------------------------------------------------
// Content and media: locales, the draft/candidate/release states, and the prepared assets
// ---------------------------------------------------------------------------------------------

/** The content and media families a seeded workspace fills, built together because they reference each other. */
interface HarbourContent {
  readonly contentDocuments: readonly ContentDocumentRecord[];
  readonly contentVariants: readonly ContentVariantRecord[];
  readonly contentRevisions: readonly ContentRevisionRecord[];
  readonly releases: readonly ReleaseRecord[];
  readonly mediaAssets: readonly MediaAssetRecord[];
}

/**
 * The canonical content identities.
 *
 * The page carries no giving binding at all: with no approved Designation bound, its giving
 * placement shows *Giving unavailable* rather than a fictional fund, and there is no fallback.
 */
function harbourContentDocuments(): readonly ContentDocumentRecord[] {
  return [
    {
      documentId: "doc-update-autumn",
      family: "update",
      kind: "update",
      sourceSubject: source("content", "update-autumn-2026"),
      siteId: "site-harbour",
      givingBinding: null,
      managedFields: ["title"],
      revision: INITIAL_REVISION,
    },
    {
      documentId: "doc-page-harbour-youth",
      family: "worker-page",
      kind: "story",
      sourceSubject: source("content", "worker-page-harbour-youth"),
      siteId: "site-harbour",
      givingBinding: null,
      managedFields: ["title", "givingBinding"],
      revision: INITIAL_REVISION,
    },
  ];
}

/**
 * The three scoped media assets, each describing the bytes it actually serves.
 *
 * Every rendition's `bytesRef` comes from `SEEDED_MEDIA_BYTES`, so a record names a file a reset
 * materialises in the store's own data tree and never a fixture under `public/`. The video's recorded
 * profile is the fixture's own — `sample-h264.mp4` is H.264 High (`avc1.64001f`) at 960x540 with AAC audio
 * and a five-second duration, `poster.jpg` is the matching 960x540 still, and `sample.vtt` is the caption
 * track — so no surface can show a size, a duration or a codec the served bytes contradict.
 *
 * The image is the seed's EXIF-bearing original, which is the input criterion 9's stripping assertion is
 * built on: `IMG_20260814-harbour-youth-group.jpg` is committed with an Orientation of 6, a camera make and
 * model, a DateTimeOriginal and a GPS pair, its revealing file name stays private, and the display rendition
 * served in its place is produced from it by `prepareDisplayImage` at reset — orientation applied, bounded to
 * 2,000 px on its longest edge, re-encoded and metadata stripped. The profile below is therefore the served
 * rendition's own 1125x2000 rather than the 2400x1350 the original carries, so a surface that shows a size
 * shows what was delivered.
 *
 * The third asset's playback rendition was never prepared and is therefore absent rather than fabricated: its
 * placement shows the poster, the text alternative and a retry, which is how the unavailable state is
 * reachable without an empty player.
 *
 * Preparation itself is not performed here: the seed opens no file and holds no bytes, so each asset states
 * the verification of the bytes it serves and a reset performs the preparation that produces them.
 */
function harbourMediaAssets(session: SeededSession): readonly MediaAssetRecord[] {
  const scope = assetScope(session, HARBOUR_YOUTH);
  return [
    buildMediaAsset(
      "asset-video-welcome",
      "video",
      { container: "mp4", codec: "avc1.64001f", durationSeconds: 5.055, width: 960, height: 540 },
      "media-originals/welcome-sunday-raw.mp4",
      [
        rendition("rendition-video-welcome-playback", "playback", "video/mp4"),
        rendition("rendition-video-welcome-poster", "poster", "image/jpeg"),
        rendition("rendition-video-welcome-captions", "captions", "text/vtt"),
      ],
      scope,
      // The committed fixtures are the bytes served here, and `scripts/make-media-fixtures.mjs --check`
      // verified them: the poster carries no EXIF, ICC profile or comment segment, the caption track is plain
      // WebVTT, and the clip's container reports a creation timestamp and no descriptive metadata tag.
      { checked: true, residualTags: [] },
    ),
    buildMediaAsset(
      "asset-image-portrait",
      "image",
      { container: "jpeg", codec: "jpeg", durationSeconds: null, width: 1125, height: 2000 },
      // A revealing original filename, kept private: it is never echoed into output or served, and it is not
      // the name of the rendition's custody file either.
      "media-originals/IMG_20260814-harbour-youth-group.jpg",
      [rendition("rendition-image-portrait-display", "display", "image/jpeg")],
      scope,
      // Produced and verified by `prepareDisplayImage` when a reset materialises it: that pipeline re-reads
      // the delivered bytes and refuses one still carrying metadata or a copy of the original's file name, so
      // this states the result of the run that produces the served bytes.
      { checked: true, residualTags: [] },
    ),
    buildMediaAsset(
      "asset-video-unavailable",
      "video",
      { container: "mp4", codec: "avc1.4d401f", durationSeconds: 95.4, width: 1280, height: 720 },
      "media-originals/evening-talk-raw.mp4",
      [rendition("rendition-video-unavailable-poster", "poster", "image/jpeg")],
      scope,
      // No playback bytes exist for this asset, so the only rendition it serves is the committed poster, which
      // the fixture script's own check verified carries no EXIF, ICC profile or comment segment.
      { checked: true, residualTags: [] },
    ),
  ];
}

/**
 * Every content revision: the two released English editions, the released French translation, the
 * Arabic draft and its frozen candidate, and the page's English release plus an Arabic draft.
 *
 * A candidate freezes the exact revision it was submitted as, so the draft after it cannot reach it;
 * each variant keeps its own draft, candidate and release head.
 */
function harbourContentRevisions(): readonly ContentRevisionRecord[] {
  const author = PRINCIPAL_ESTABLISHED;
  const pageSection: ContentSection = {
    element: "story",
    fields: {
      heading: "A term with the youth group",
      body: "Friday evenings, a shared meal and a great deal of football.",
    },
    presentation: NORMAL_PRESENTATION,
  };

  return [
    buildContentRevision(
      "rev-update-en-1",
      "variant-update-autumn-en-public",
      contentBody("ltr", [
        "Autumn at Harbour Youth",
        "This term we have met every Friday, shared a meal each week and welcomed six new faces.",
        "Thank you for praying with us and for giving what makes the work possible.",
      ]),
      author,
      "2026-11-09T15:00:00Z",
      "Autumn at Harbour Youth",
      {
        sharePresentation: {
          title: "Autumn at Harbour Youth",
          description: "A term of Friday evenings, shared meals and six new faces.",
          imageAssetId: "asset-image-portrait",
          imageAltText: "The youth group gathered in the church hall.",
        },
      },
    ),
    buildContentRevision(
      "rev-update-en-supporter-1",
      "variant-update-autumn-en-approved-supporter",
      contentBody("ltr", [
        "Autumn at Harbour Youth",
        "This term we have met every Friday, shared a meal each week and welcomed six new faces.",
        "For those who support this work: the monthly costs rose in September and your regular giving is what carried them.",
      ]),
      author,
      "2026-11-09T15:20:00Z",
      "Autumn at Harbour Youth — for supporters",
    ),
    buildContentRevision(
      "rev-update-fr-1",
      "variant-update-autumn-fr-public",
      contentBody("ltr", [
        "L'automne à Harbour Youth",
        "Ce trimestre, nous nous sommes retrouvés chaque vendredi autour d'un repas, et six nouveaux visages sont venus.",
      ]),
      author,
      "2026-11-11T11:00:00Z",
      "L'automne à Harbour Youth",
    ),
    buildContentRevision(
      "rev-update-ar-draft-1",
      "variant-update-autumn-ar-public",
      contentBody("rtl", [
        "الخريف في هاربر يوث",
        "التقينا كل يوم جمعة هذا الفصل، وتشاركنا وجبة، ورحّبنا بستة وجوه جديدة.",
      ]),
      author,
      "2026-11-13T10:00:00Z",
      "الخريف في هاربر يوث",
    ),
    buildContentRevision(
      "rev-update-ar-candidate-1",
      "variant-update-autumn-ar-public",
      contentBody("rtl", [
        "الخريف في هاربر يوث",
        "التقينا كل يوم جمعة هذا الفصل، وتشاركنا وجبة، ورحّبنا بستة وجوه جديدة.",
        "شكراً لصلاتكم ودعمكم الذي يجعل هذا العمل ممكناً.",
      ]),
      author,
      "2026-11-14T09:30:00Z",
      "الخريف في هاربر يوث",
    ),
    buildContentRevision(
      "rev-page-en-1",
      "variant-page-harbour-youth-en-public",
      contentBody(
        "ltr",
        ["Harbour Youth meets on Fridays in the church hall, and everyone is welcome."],
        [pageSection],
      ),
      author,
      "2026-10-01T14:00:00Z",
      "Harbour Youth",
      {
        mediaPlacements: [
          {
            placementId: "placement-page-video",
            assetId: "asset-video-welcome",
            sectionElement: "story",
            position: 0,
            altText: "A short welcome from the youth group.",
            caption: "A welcome from the group.",
            credit: "Harbour Youth",
          },
        ],
        captions: [
          {
            assetId: "asset-video-welcome",
            renditionId: "rendition-video-welcome-captions",
            language: "en",
            label: "English",
            isDefault: true,
          },
        ],
        sharePresentation: {
          title: "Harbour Youth",
          description: "Fridays in the church hall.",
          imageAssetId: "asset-image-portrait",
          imageAltText: "The youth group gathered in the church hall.",
        },
      },
    ),
    buildContentRevision(
      "rev-page-ar-draft-1",
      "variant-page-harbour-youth-ar-public",
      contentBody(
        "rtl",
        ["يلتقي هاربر يوث أيام الجمعة في قاعة الكنيسة، والجميع مرحّب بهم."],
        [
          {
            element: "story",
            fields: {
              heading: "فصل مع مجموعة الشباب",
              body: "أمسيات الجمعة، ووجبة مشتركة، وكثير من كرة القدم.",
            },
            presentation: NORMAL_PRESENTATION,
            direction: "rtl",
          },
        ],
      ),
      author,
      "2026-11-15T16:45:00Z",
      "هاربر يوث",
    ),
  ];
}

/** Every variant: public and approved-supporter editions beside each other, in three locales. */
function harbourContentVariants(): readonly ContentVariantRecord[] {
  return [
    buildContentVariant(
      "variant-update-autumn-en-public",
      "doc-update-autumn",
      "public",
      "en",
      "ltr",
      { releaseHeadId: "release-update-en-1" },
    ),
    buildContentVariant(
      "variant-update-autumn-en-approved-supporter",
      "doc-update-autumn",
      "approved-supporter",
      "en",
      "ltr",
      { releaseHeadId: "release-update-en-approved-supporter-1" },
    ),
    buildContentVariant(
      "variant-update-autumn-fr-public",
      "doc-update-autumn",
      "public",
      "fr",
      "ltr",
      {
        releaseHeadId: "release-update-fr-1",
        translationSource: {
          variantId: "variant-update-autumn-en-public",
          revisionId: "rev-update-en-1",
        },
      },
    ),
    // The sibling that failed: its draft and its frozen candidate exist, and it has no release head,
    // so the partial release kept every other variant's prior-good head without inventing this one.
    buildContentVariant(
      "variant-update-autumn-ar-public",
      "doc-update-autumn",
      "public",
      "ar",
      "rtl",
      {
        draftRevisionId: "rev-update-ar-draft-1",
        candidateId: "rev-update-ar-candidate-1",
      },
    ),
    buildContentVariant(
      "variant-page-harbour-youth-en-public",
      "doc-page-harbour-youth",
      "public",
      "en",
      "ltr",
      { releaseHeadId: "release-page-en-1" },
    ),
    buildContentVariant(
      "variant-page-harbour-youth-ar-public",
      "doc-page-harbour-youth",
      "public",
      "ar",
      "rtl",
      { draftRevisionId: "rev-page-ar-draft-1" },
    ),
  ];
}

/** The releases: independent per variant, with the page released publicly and listable. */
function harbourReleases(): readonly ReleaseRecord[] {
  return [
    buildRelease(
      "release-update-en-1",
      "variant-update-autumn-en-public",
      "rev-update-en-1",
      "public",
      "en",
      "2026-11-10T09:00:00Z",
      "link-public",
    ),
    buildRelease(
      "release-update-en-approved-supporter-1",
      "variant-update-autumn-en-approved-supporter",
      "rev-update-en-supporter-1",
      "approved-supporter",
      "en",
      "2026-11-10T09:00:00Z",
      "link-public",
    ),
    buildRelease(
      "release-update-fr-1",
      "variant-update-autumn-fr-public",
      "rev-update-fr-1",
      "public",
      "fr",
      "2026-11-12T09:00:00Z",
      "link-public",
    ),
    buildRelease(
      "release-page-en-1",
      "variant-page-harbour-youth-en-public",
      "rev-page-en-1",
      "public",
      "en",
      "2026-10-02T08:00:00Z",
      "listed",
    ),
  ];
}

/** Builds the content and media families together, because a placement names an asset and a release names a revision. */
function harbourContent(session: SeededSession): HarbourContent {
  return {
    contentDocuments: harbourContentDocuments(),
    contentVariants: harbourContentVariants(),
    contentRevisions: harbourContentRevisions(),
    releases: harbourReleases(),
    mediaAssets: harbourMediaAssets(session),
  };
}

// ---------------------------------------------------------------------------------------------
// The partial-release world: the same ministry, with one submission's per-variant outcomes stored
// ---------------------------------------------------------------------------------------------

/**
 * Every variant of the established worker's Update and Page, with the two heads the partial release
 * left behind.
 *
 * One submission of the Update had two editions. The English public edition's attempt landed, so its
 * newer release is its head and the release it replaced is marked superseded. The Arabic public
 * edition's attempt failed, so its prior-good release is still its head and the candidate it submitted
 * — `rev-update-ar-candidate-1`, already frozen on the variant by {@link harbourContentVariants} —
 * stays frozen there rather than being discarded. No release names that candidate's revision, and that
 * absence is what makes "failed under its prior-good head" a stored fact rather than a label.
 *
 * The other four variants are the established worker's own records unchanged, in their own order: a
 * failed sibling changes what one submission published and nothing about the rest of the Update.
 */
function partialReleaseContentVariants(): readonly ContentVariantRecord[] {
  return harbourContentVariants().map((variant) => {
    switch (variant.variantId) {
      case "variant-update-autumn-en-public":
        // The sibling whose attempt succeeded: a second release became its head.
        return { ...variant, releaseHeadId: "release-update-en-2" };
      case "variant-update-autumn-ar-public":
        // The sibling whose attempt failed: the prior-good head it already had, kept.
        return { ...variant, releaseHeadId: "release-update-ar-1" };
      default:
        return variant;
    }
  });
}

/**
 * Every revision of the partial-release world: the established worker's own, then the two the two
 * publications named above released.
 *
 * Both are built through {@link buildContentRevision}, under the Update's own document identity
 * (`doc-update-autumn`), so each carries the checksum of the body it publishes and the content profile
 * validates it exactly as it validates the seeded drafts and candidates beside it. Each instant is a
 * literal between the submission it belongs to and {@link SEED_INSTANT}, so no revision is dated after
 * the instant the seed's clock starts at.
 */
function partialReleaseContentRevisions(): readonly ContentRevisionRecord[] {
  const author = PRINCIPAL_ESTABLISHED;
  return [
    ...harbourContentRevisions(),
    // The Arabic edition's earlier publication, which the failed attempt did not replace.
    buildContentRevision(
      "rev-update-ar-1",
      "variant-update-autumn-ar-public",
      contentBody("rtl", ["الخريف في هاربر يوث", "التقينا كل يوم جمعة هذا الفصل، وتشاركنا وجبة."]),
      author,
      "2026-10-23T10:00:00Z",
      "الخريف في هاربر يوث",
    ),
    // The English edition's second publication, which the sibling's failure left standing.
    buildContentRevision(
      "rev-update-en-2",
      "variant-update-autumn-en-public",
      contentBody("ltr", [
        "Autumn at Harbour Youth",
        "This term we have met every Friday, shared a meal each week and welcomed six new faces.",
        "As the term closes we are planning the Christmas meal, and your giving is what makes it possible.",
      ]),
      author,
      "2026-11-17T15:00:00Z",
      "Autumn at Harbour Youth",
    ),
  ];
}

/**
 * Every release of the partial-release world: the established worker's own, with the one the English
 * edition's second publication replaced marked superseded by it, then that publication's release and
 * the Arabic edition's prior-good one.
 *
 * Both added releases are built through {@link buildRelease} and keep the reach the variants beside
 * them already carry, `link-public`: this world changes which release stands at a head, not how far a
 * released edition reaches. Their publication instants are literals: the Arabic edition's earlier
 * release precedes its draft, and the English release follows the candidate submission it belonged to
 * and precedes {@link SEED_INSTANT}.
 */
function partialReleaseReleases(): readonly ReleaseRecord[] {
  return [
    ...harbourReleases().map((release) =>
      release.releaseId === "release-update-en-1"
        ? { ...release, supersededBy: "release-update-en-2" }
        : release,
    ),
    buildRelease(
      "release-update-ar-1",
      "variant-update-autumn-ar-public",
      "rev-update-ar-1",
      "public",
      "ar",
      "2026-10-24T09:00:00Z",
      "link-public",
    ),
    buildRelease(
      "release-update-en-2",
      "variant-update-autumn-en-public",
      "rev-update-en-2",
      "public",
      "en",
      "2026-11-18T09:00:00Z",
      "link-public",
    ),
  ];
}

// ---------------------------------------------------------------------------------------------
// Delivery: purpose-specific memberships, one notification intent, and its per-recipient outcomes
// ---------------------------------------------------------------------------------------------

/**
 * The purpose-specific memberships: four active, one awaiting proof, one deliberately off, one the
 * source restricted, and one whose address looks subscribed.
 *
 * The last one is the seed's "a `subscribed` flag is not consent" case: its address is the same value
 * a partner record carries, and it establishes nothing — an email address is a value and never a join
 * key — while its state is `off`, because a source column claiming a subscription is not consent.
 */
function harbourMemberships(): readonly MembershipRecord[] {
  return [
    buildMembership("membership-ada-active", "ada.quinn@example.org", "active", {
      displayName: "Ada Quinn",
      acceptedAt: "2026-03-02T08:00:00Z",
      languagePreference: "en",
    }),
    buildMembership("membership-priya-active", "priya.raman@example.org", "active", {
      displayName: "Priya Raman",
      acceptedAt: "2026-04-11T19:30:00Z",
      languagePreference: "en",
    }),
    buildMembership("membership-jonas-active", "jonas.oyelaran@example.org", "active", {
      displayName: "Jonas Oyelaran",
      acceptedAt: "2026-05-19T12:00:00Z",
      languagePreference: "en",
    }),
    buildMembership("membership-tobias-active", "tobias.kern@example.org", "active", {
      displayName: "Tobias Kern",
      acceptedAt: "2026-06-30T06:45:00Z",
      languagePreference: "de",
    }),
    // Awaiting proof: not membership, and its 168-hour confirmation window is stored as the instant it closes.
    buildMembership("membership-awaiting-proof", "iwan.pritchard@example.org", "awaiting-proof", {
      displayName: "Iwan Pritchard",
      acceptedAt: "2026-11-16T12:00:00Z",
      confirmationDeadline: membershipConfirmationDeadline(
        Temporal.Instant.from("2026-11-16T12:00:00Z"),
      ),
      languagePreference: "cy",
    }),
    buildMembership("membership-unsubscribed", "hilary.baptiste@example.org", "off", {
      displayName: "Hilary Baptiste",
      acceptedAt: "2026-02-08T09:15:00Z",
      languagePreference: "en",
    }),
    buildMembership("membership-restricted", "nadia.haq@example.org", "restricted", {
      displayName: "Nadia Haq",
      acceptedAt: "2026-07-14T15:00:00Z",
    }),
    buildMembership("membership-subscribed-column", "jo.mbeki@example.org", "off", {
      displayName: "Jo Mbeki",
    }),
  ];
}

/** The one notification intent: pinned to the release that was published, with the ceiling it was accepted for. */
function harbourNotificationIntents(): readonly NotificationIntentRecord[] {
  return [
    {
      intentId: "intent-update-autumn-en",
      publisherId: PUBLISHER_HARBOUR,
      purpose: "update-email",
      documentId: "doc-update-autumn",
      releaseId: "release-update-en-1",
      intendedAt: "2026-11-10T09:05:00Z",
      ceilingCount: 4,
      revision: INITIAL_REVISION,
    },
  ];
}

/**
 * The recorded outcome of that intent, per recipient: accepted, failed and unknown are three
 * different facts, and none of them claims that a message reached a mailbox or was read.
 *
 * Only the four active memberships are recipients. The membership awaiting proof, the one that is
 * off and the restricted one are absent because eligibility is evaluated per publisher and purpose.
 */
function harbourNotificationResults(): readonly NotificationSendResultRecord[] {
  const recipients: readonly NotificationRecipientOutcomeRecord[] = [
    {
      recipientId: "membership-ada-active",
      renditionId: "rendition-update-en-notice",
      state: "accepted",
      at: "2026-11-10T09:06:12Z",
    },
    {
      recipientId: "membership-priya-active",
      renditionId: "rendition-update-en-notice",
      state: "accepted",
      at: "2026-11-10T09:06:14Z",
    },
    {
      recipientId: "membership-jonas-active",
      renditionId: "rendition-update-en-notice",
      state: "failed",
      at: "2026-11-10T09:06:15Z",
    },
    {
      recipientId: "membership-tobias-active",
      renditionId: "rendition-update-de-notice",
      state: "unknown",
      at: "2026-11-10T09:06:31Z",
    },
  ];

  return [
    {
      sendResultId: "send-result-update-autumn-en",
      intentId: "intent-update-autumn-en",
      recipients,
      recordedAt: "2026-11-10T09:07:00Z",
      revision: INITIAL_REVISION,
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Coaching: the grant episode, one target, and a check-in with a private and a shared revision
// ---------------------------------------------------------------------------------------------

/** The coaching families, built once because the coach's own session reads exactly the same records. */
interface CoachingShare {
  readonly coachingGrants: readonly CoachingGrantRecord[];
  readonly coachingTargets: readonly CoachingTargetRecord[];
  readonly coachingCheckIns: readonly CoachingCheckInRecord[];
}

/**
 * What the established worker has shared with the coach: an active grant for a fixed period, a
 * revoked one and an ended one, one target per canonical measure, and a check-in whose private
 * answers stay with the worker.
 *
 * The private label and the private answer are never part of a shared module: the shared revision
 * carries its own answers, so sharing is a deliberate act rather than a switch that exposes a draft.
 */
function coachingShare(): CoachingShare {
  // The five independent switches of `@/modules/coaching/grant`'s MODULE_KEYS: the non-financial
  // targets and check-ins are shared for a fixed period, and both financial modules stay off because
  // a grant that shares figures must state the reviewed range it shares them over.
  const modules: CoachingModuleSelection = {
    "support-goal": false,
    "support-results": false,
    targets: true,
    "check-ins": true,
    "task-summaries": false,
  };

  const duration: CoachingDurationRecord = {
    kind: "through-date",
    cutoffInstant: "2026-12-31T00:00:00Z",
    frozenZone: REFERRAL_SOURCE_ZONE,
  };

  const invitation: CoachingInvitationRecord = {
    issuedAt: "2026-10-30T09:00:00Z",
    expiresAt: "2026-11-06T09:00:00Z",
    supersededBy: null,
  };

  const weeklyPeriod: CoachingTargetPeriodRecord = { kind: "weekly", from: null, to: null };

  const monthlyPeriod: CoachingTargetPeriodRecord = { kind: "monthly", from: null, to: null };

  const customPeriod: CoachingTargetPeriodRecord = {
    kind: "custom",
    from: "2026-11-02",
    to: "2026-11-15",
  };

  // Two versions of the conversations target: the week that ended on 8 November keeps the quantity
  // it was measured against, and the change applies from 9 November onwards with no prorated bridge.
  const conversationVersions: readonly CoachingTargetVersionRecord[] = [
    {
      revisionId: "target-conversations-weekly-1",
      effectiveFrom: "2026-11-02",
      effectiveTo: "2026-11-08",
      quantity: 2,
      measure: "conversations",
      calendarStart: "2026-11-02",
    },
    {
      revisionId: "target-conversations-weekly-2",
      effectiveFrom: "2026-11-09",
      effectiveTo: null,
      quantity: 3,
      measure: "conversations",
      calendarStart: "2026-11-02",
    },
  ];

  return {
    coachingGrants: [
      {
        grantId: "grant-established-coach",
        workerPrincipalId: PRINCIPAL_ESTABLISHED,
        coachPrincipalId: PRINCIPAL_COACH,
        ministryIds: [MINISTRY_YOUTH],
        modules,
        duration,
        financialRange: null,
        state: "active",
        invitation,
        revision: INITIAL_REVISION,
      },
      {
        // The revoked episode keeps its history: re-enabling a module never restores what was shared.
        grantId: "grant-revoked-coach",
        workerPrincipalId: PRINCIPAL_ESTABLISHED,
        coachPrincipalId: PRINCIPAL_COACH,
        ministryIds: [MINISTRY_STUDENTS],
        modules: { ...modules, "check-ins": false },
        duration: { kind: "ongoing", cutoffInstant: null, frozenZone: REFERRAL_SOURCE_ZONE },
        financialRange: null,
        state: "revoked",
        invitation: {
          issuedAt: "2026-05-04T09:00:00Z",
          expiresAt: "2026-05-11T09:00:00Z",
          supersededBy: "grant-established-coach",
        },
        revision: INITIAL_REVISION,
      },
      {
        // An ended episode cannot return through a stale Save, an extension or a re-enabled module.
        grantId: "grant-ended-coach",
        workerPrincipalId: PRINCIPAL_ESTABLISHED,
        coachPrincipalId: PRINCIPAL_COACH,
        ministryIds: [MINISTRY_YOUTH],
        modules: { ...modules, targets: false, "check-ins": false },
        duration: {
          kind: "through-date",
          cutoffInstant: "2026-09-30T00:00:00Z",
          frozenZone: REFERRAL_SOURCE_ZONE,
        },
        financialRange: null,
        state: "ended",
        invitation: {
          issuedAt: "2026-08-03T09:00:00Z",
          expiresAt: "2026-08-10T09:00:00Z",
          supersededBy: null,
        },
        revision: INITIAL_REVISION,
      },
    ],
    coachingTargets: [
      {
        targetId: "target-calls-weekly",
        workerPrincipalId: PRINCIPAL_ESTABLISHED,
        privateLabel: "Calls each week — my own wording, never shown to a coach",
        measure: "calls-made",
        quantity: 5,
        period: weeklyPeriod,
        calendarStart: "2026-11-02",
        homePlacement: "placed",
        state: "active",
        versions: [
          {
            revisionId: "target-calls-weekly-1",
            effectiveFrom: "2026-11-02",
            effectiveTo: null,
            quantity: 5,
            measure: "calls-made",
            calendarStart: "2026-11-02",
          },
        ],
        revision: INITIAL_REVISION,
      },
      {
        // Five calls containing two conversations are five calls and two conversations: each measure
        // is counted from the activity records, never derived by dividing another measure.
        targetId: "target-conversations-weekly",
        workerPrincipalId: PRINCIPAL_ESTABLISHED,
        privateLabel: "Real conversations, not just hellos",
        measure: "conversations",
        quantity: 3,
        period: weeklyPeriod,
        calendarStart: "2026-11-02",
        homePlacement: "placed",
        state: "active",
        versions: conversationVersions,
        revision: INITIAL_REVISION,
      },
      {
        // Paused, and not placed on Home: pausing stops new counting and never rewrites a closed period.
        targetId: "target-messages-monthly",
        workerPrincipalId: PRINCIPAL_ESTABLISHED,
        privateLabel: "Personal messages each month",
        measure: "personal-messages",
        quantity: 20,
        period: monthlyPeriod,
        calendarStart: "2026-10-01",
        homePlacement: "unplaced",
        state: "paused",
        versions: [
          {
            revisionId: "target-messages-monthly-1",
            effectiveFrom: "2026-10-01",
            effectiveTo: null,
            quantity: 20,
            measure: "personal-messages",
            calendarStart: "2026-10-01",
          },
        ],
        revision: INITIAL_REVISION,
      },
      {
        // A one-off custom period, which states both its first and its last day.
        targetId: "target-meetings-custom",
        workerPrincipalId: PRINCIPAL_ESTABLISHED,
        privateLabel: "Meetings during the appeal fortnight",
        measure: "meetings-held",
        quantity: 3,
        period: customPeriod,
        calendarStart: "2026-11-02",
        homePlacement: "unplaced",
        state: "active",
        versions: [
          {
            revisionId: "target-meetings-custom-1",
            effectiveFrom: "2026-11-02",
            effectiveTo: null,
            quantity: 3,
            measure: "meetings-held",
            calendarStart: "2026-11-02",
          },
        ],
        revision: INITIAL_REVISION,
      },
    ],
    coachingCheckIns: [
      {
        checkInId: "check-in-week-46",
        workerPrincipalId: PRINCIPAL_ESTABLISHED,
        grantId: "grant-established-coach",
        privateDraft: {
          revisionId: "check-in-week-46-private-1",
          questions: [
            { wording: "How did the week go?", order: 0 },
            { wording: "What would help next week?", order: 1 },
          ],
          questionsCapturedAt: "2026-11-13T08:00:00Z",
          answers: [
            { questionOrder: 0, text: "Two good conversations and one difficult one." },
            { questionOrder: 1, text: "A shorter list on Monday." },
            { questionOrder: null, text: "Not for sharing: still deciding about the appeal." },
          ],
          savedAt: "2026-11-13T08:30:00Z",
        },
        shared: {
          revisionId: "check-in-week-46-shared-1",
          questions: [
            { wording: "How did the week go?", order: 0 },
            { wording: "What would help next week?", order: 1 },
          ],
          questionsCapturedAt: "2026-11-13T08:00:00Z",
          answers: [
            { questionOrder: 0, text: "Two good conversations and one difficult one." },
            { questionOrder: 1, text: "A shorter list on Monday." },
          ],
          recipientPrincipalIds: [PRINCIPAL_COACH],
          duration,
          sharedAt: "2026-11-13T08:35:00Z",
          updatedAt: "2026-11-13T08:35:00Z",
          withdrawnAt: null,
        },
        revision: INITIAL_REVISION,
      },
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// Assembling a seeded session
// ---------------------------------------------------------------------------------------------

/**
 * The established worker's workspace: the readable seed AAP 0.7.2 describes, shared by every persona
 * that acts inside that ministry.
 *
 * The private notes, interactions, tasks and series belong to the session's own principal, while the
 * partner, support, content and delivery records are the ministry's shared operational facts. A
 * persona that acts in this ministry therefore starts from the same world, and the isolation proof is
 * the session in the other organization, which starts from records none of these names.
 */
function establishedWorkerWorkspace(session: SeededSession): SessionStateDocument {
  const content = harbourContent(session);
  const coaching = coachingShare();
  return stateDocument(session, {
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
    contentDocuments: content.contentDocuments,
    contentVariants: content.contentVariants,
    contentRevisions: content.contentRevisions,
    releases: content.releases,
    mediaAssets: content.mediaAssets,
    memberships: harbourMemberships(),
    notificationIntents: harbourNotificationIntents(),
    notificationResults: harbourNotificationResults(),
    coachingGrants: coaching.coachingGrants,
    coachingTargets: coaching.coachingTargets,
    coachingCheckIns: coaching.coachingCheckIns,
  });
}

/**
 * The established worker's workspace with one Update submission's per-variant release outcomes stored.
 *
 * Everything the session acts on is the established worker's own records, built once by
 * {@link establishedWorkerWorkspace} and carried over unchanged: the same partners, gifts, tasks,
 * series, initiatives, requests, referrals, support projection, media assets, memberships,
 * notification intents and results, and coaching records. Only the three publication families of the
 * Update differ, because a partial release changes what one submission published and nothing about the
 * ministry's operational facts.
 *
 * This is the world AAP 0.7.2's "partial-release example where one variant succeeded and a sibling
 * failed" names and the one criterion 17 starts from: the success and the failed sibling's prior-good
 * head are both readable from the records, with no store edited by hand and no scenario flag standing
 * in for a publication outcome.
 */
function partialReleaseWorkspace(session: SeededSession): SessionStateDocument {
  return {
    ...establishedWorkerWorkspace(session),
    contentVariants: partialReleaseContentVariants(),
    contentRevisions: partialReleaseContentRevisions(),
    releases: partialReleaseReleases(),
  };
}

/**
 * The established worker's second ministry, selected: an available support source carrying no goal.
 *
 * A state document holds the projection of the ministry its context selects, so this is the second
 * subject's own world rather than a second copy of the first's. Its coverage is complete and its
 * source is available, which is what keeps "there is no goal" distinct from "the source is
 * unavailable" and from a goal whose period has no denominator. No gift falls in the current month,
 * so the month reads as a zero within complete coverage instead of a gap in an incomplete one.
 */
function studentsMinistryWorkspace(session: SeededSession): SessionStateDocument {
  const partners: readonly PartnerRecord[] = [
    buildPartner("partner-students-femi-adebayo", "person", "Femi Adebayo", {
      nameParts: nameParts("Femi", "Adebayo"),
      contactMethods: [contactMethod("email", "femi.adebayo@example.org")],
      tags: ["students"],
      source: source("crm", "crm-2044"),
    }),
    buildPartner("partner-students-holy-trinity", "church", "Holy Trinity Chaplaincy", {
      contactMethods: [contactMethod("postal", "Holy Trinity, Harbourton HT1 4QD")],
      tags: ["students"],
    }),
  ];

  const gifts: readonly GiftRowRecord[] = [
    buildGift("gift-row-students-0001", "gift-students-0001", "EUR", 6000, "2026-10-08", {
      designation: "Students ministry",
      attribution: { kind: "partner", partnerId: "partner-students-femi-adebayo" },
      provenance: source("finance", "gift-students-0001"),
    }),
    buildGift("gift-row-students-0002", "gift-students-0002", "EUR", 4500, "2026-09-14", {
      designation: "Students ministry",
      attribution: { kind: "partner", partnerId: "partner-students-holy-trinity" },
      provenance: source("finance", "gift-students-0002"),
    }),
  ];

  const supportProjection: SupportProjectionRecord = {
    supportSubjectId: SUPPORT_SUBJECT_STUDENTS,
    basis: "effective_cash_allocation",
    currencyExponents: { EUR: 2 },
    coverage: { from: "2024-01-01", to: "2026-11-18", state: "complete" },
    asOf: SEED_INSTANT.toString(),
    lastSourceUpdate: "2026-11-18T07:45:00Z",
    goal: null,
    source: source("finance", "ledger-harbour-students-2026"),
    revision: INITIAL_REVISION,
  };

  const tasks: readonly TaskRecord[] = [
    buildTask("task-students-term-plan", "Plan the students' term programme", session.principalId, {
      category: "Planning",
      dueOn: "2026-11-27",
      partnerId: "partner-students-holy-trinity",
    }),
  ];

  return stateDocument(session, { partners, gifts, supportProjection, tasks });
}

/**
 * The coach's workspace: exactly what the worker shared, and nothing else.
 *
 * A coach session holds no partner, gift, draft or private note at all, which is the read-only
 * portfolio's premise: the grant bounds what can be enumerated before any record is looked at.
 */
function coachWorkspace(session: SeededSession): SessionStateDocument {
  return stateDocument(session, coachingShare());
}

/** Builds the state document a seeded session starts with, from the workspace its row names. */
export function seedWorkspace(session: SeededSession): SessionStateDocument {
  switch (session.workspace) {
    case "new-worker":
      return newWorkerWorkspace(session);
    case "established-worker":
      return establishedWorkerWorkspace(session);
    case "established-worker-partial-release":
      return partialReleaseWorkspace(session);
    case "students-ministry":
      return studentsMinistryWorkspace(session);
    case "second-worker":
      return secondWorkerWorkspace(session);
    case "coach":
      return coachWorkspace(session);
    case "empty":
      return stateDocument(session, {});
  }
}

/**
 * Builds the three documents one seeded row owns: its scenario and context document, its records, and
 * an operation ledger in which no operation has been accepted.
 *
 * The row is handed in rather than looked up, so both entry points below share this one construction
 * and neither can lay down documents the other would not.
 */
function buildSessionDocuments(session: SeededSession): SeededSessionDocuments {
  const selected = session.selectedContext;
  return {
    meta: buildSessionMeta({
      principalId: session.principalId,
      // The triplets are handed over unchanged: the meta document and the state document state the
      // same three references, so neither can drift from the other.
      admittedMemberships: session.admittedMemberships,
      sessionState: session.sessionState,
      scenarioId: session.scenarioId,
      capabilities: CAPABILITIES_BY_PERSONA[session.persona],
      // Every session persists the same roster: the panel offers the identities a preview may switch
      // to, and the one this session acts as is found by matching the principal below.
      personas: seededPersonaRoster(),
      selectedContext:
        selected === null
          ? null
          : {
              organizationId: selected.organizationId,
              ministryId: selected.ministryId,
              supportSubjectId: selected.supportSubjectId,
            },
    }),
    state: seedWorkspace(session),
    operations: EMPTY_OPERATION_LEDGER,
  };
}

/**
 * Builds the three documents a session id names, in the store's own document shape.
 *
 * The session is refused unless a seeded row names it, so a caller cannot create a session the seed
 * does not describe. The store owns every write; this function only builds values.
 */
export function seedSessionDocuments(sessionId: string): SessionDocuments {
  const session = findSeededSession(sessionId);
  if (session === undefined) {
    throw new RangeError(
      `No seeded session ${JSON.stringify(sessionId)}: the seed lays down ${SEEDED_SESSION_IDS.join(", ")}.`,
    );
  }

  return buildSessionDocuments(session);
}

/**
 * Builds every seeded session's three documents and returns the rows with them attached.
 *
 * This is the one producer a caller reads when it wants the whole world rather than one session: it
 * persists nothing, opens no file and reads no clock, so the caller owns every write and a reset that
 * fails half way leaves no half-built world behind. Each call builds fresh documents, so a caller
 * holding one session's records cannot alter what the next seed produces, and two calls in one
 * process return deep-equal results — the determinism every criterion starts from.
 */
export async function seed(): Promise<SeededSessionWithDocuments[]> {
  const sessions: SeededSessionWithDocuments[] = [];
  for (const session of SEEDED_SESSIONS) {
    sessions.push({ ...session, documents: buildSessionDocuments(session) });
  }
  return sessions;
}
