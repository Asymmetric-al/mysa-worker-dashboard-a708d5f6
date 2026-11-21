/**
 * The outreach reads: the initiatives a ministry runs and their reviewed working lists, the
 * independently answerable Requests inside them, and the referral cycles that carry an original
 * introduction date and the window resolved from it.
 *
 * Five reads, and nothing else, are this module's surface: `readInitiatives`, `readInitiative`,
 * `readInitiativeResults`, `readReferrals` and `readReferral`. Each answers with a
 * `ReadResult<ReadEnvelope<T>>`, never with a bare array, record, count or boolean, so a surface
 * cannot present an absence as a zero or a refusal as an empty list.
 *
 * Plan items that put this file in scope: AAP 0.9.1's `data-service/reads/*` tree and 0.11.1's
 * "(11 files)" row; 0.6.1's outreach read row; 0.7.1's job groups "Coordinate outreach"
 * (`readInitiatives`, `readInitiative`, `readInitiativeResults`) and "Act on an introduction"
 * (`readReferrals`, `readReferral`); 0.8.3 in full; and success criteria 14 and 15.
 *
 * What this module refuses to blur, because each distinction is a workflow's meaning rather than a
 * presentational preference:
 *
 * - **Inclusion is not consent.** A working-list member is one of exactly three states — `included`,
 *   `removed`, `excluded` — and no field here can be read as "asked", as contactability, as
 *   communication consent or as membership of an Update's audience. Membership is created by
 *   selection; a later filter that happens to match a partner never joins the list, and no read
 *   recomputes it from a query.
 * - **A stage predicts nothing.** A stage is a human assessment drawn from a source-approved list.
 *   A value the source no longer offers is reported as retired, distinctly from a refusal and from an
 *   unavailable source, and no stage is turned into a likelihood, a rank or a giving forecast.
 * - **A Request is an invitation, not a transaction.** Its terms are *requested* terms, versioned;
 *   its response names the respondent and binds to the terms version it answers. Agreement creates no
 *   pledge, gift, recurring payment, booking, subscription, receipt or completed task, and none of
 *   those records is synthesised here: the collect is not read at all, so no such shape can leak into
 *   a response.
 * - **An introduction date is evidence.** The recorded date is the date of the introduction itself,
 *   with the precision it is known to. A stored entry timestamp is never presented as the
 *   introduction, and import, first view, reassignment, merge and retry are not introductions. An
 *   approximate or unknown date yields no deadline, no Active/Expired judgement and no Continue
 *   action — a late first entry may already be expired, and no read briefly activates it or starts
 *   its clock today.
 * - **Expired history is not partner access.** The Expired view is built by `project()` from an
 *   explicit allow-list, so the fields that must not exist — contact channels, referrer context,
 *   precise location, notes, financial data, and the partner identifier that would let a caller probe
 *   `readPartner` with it — are absent from the envelope rather than hidden by a component.
 *
 * Every window judgement comes from `@/modules/time/window`; this module states no boundary of its
 * own. The persisted exclusive endpoint is the authority and is never recomputed for the judgement,
 * which is what keeps a deadline already stated immune to later travel, display settings and zone-data
 * changes. The nominal calendar-day wording is disclosed beside it, because a person reads a date
 * while the instant is what expires.
 *
 * Authorisation happens before enumeration, so a caller that may not see a partner cannot learn that
 * one is on a working list or on a referral by counting, filtering or paging. Filtering, sorting,
 * paging and aggregation happen here, and every `total` is the whole authorised result rather than the
 * loaded page.
 *
 * Layering: a service read module. It reaches the session, scope and permission decisions through
 * `../authorize`, the envelope contract through `../envelope`, the outcome vocabulary through
 * `../outcome`, the store through its one read function, the fixed boundaries through
 * `@/modules/time/*`, the currency table through `@/modules/money/currency`, and the scenario flags
 * through the development runtime that owns them. It imports no store write function, no support or
 * export module, no component, no feature and no application route.
 */
import { Temporal } from "temporal-polyfill";
import { z } from "zod";

import { isScenarioId, scenarioFlagsFor } from "@/modules/dev-runtime/scenario";
import type { SourceReference } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { compareCodeUnits } from "@/lib/ordering";
import { exponentOf } from "@/modules/money/currency";
import { readSession } from "@/modules/store/repository";
import { clampPageSize } from "@/modules/support/report";
import { instantAt } from "@/modules/time/clock";
import {
  civilDateAt,
  parseCivilDate,
  serialiseCivilDate,
  type CivilDate,
  type DatePrecision,
} from "@/modules/time/civil";
import {
  newWindowEnd,
  referralWindowState,
  type MidnightResolution,
  type NewWindowEnd,
  type ReferralWindowStatus,
  type WindowRefusalReason,
} from "@/modules/time/window";

import {
  assertScope,
  canEdit,
  canView,
  readResultOfRefusal,
  resolveSession,
  type ResolvedSession,
  type SessionSource,
} from "../authorize";
import {
  buildEnvelope,
  initiativeMemberRecordSchema,
  initiativeRecordSchema,
  partnerRecordSchema,
  project,
  recordRevisionSchema,
  referralCycleRecordSchema,
  REQUEST_RESPONSE_KINDS,
  requestRecordSchema,
  taskRecordSchema,
  type Coverage,
  type InitiativeMemberRecord,
  type InitiativeMemberState,
  type InitiativeRecord,
  type InitiativeState,
  type PartnerKind,
  type PartnerRecord,
  type PrincipalId,
  type ReadAction,
  type ReadEnvelope,
  type RecordedValueState,
  type ReferralCycleRecord,
  type ReferralWindowKind,
  type RequestRecord,
  type RequestResponseKind,
  type Scope,
  type TaskKind,
  type TaskRecord,
  type TaskRecordStatus,
} from "../envelope";
import {
  denied,
  LOCAL_STORE_SYSTEM,
  unavailable,
  type DeniedOutcome,
  type ReadResult,
} from "../outcome";

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/**
 * The operation identity a read's refusal carries.
 *
 * A read has no attempt identity: nothing was asked to change, so nothing can be replayed. The same
 * literal `../authorize` uses keeps a read refusal's shape identical to the one every other read
 * produces — the only field that may differ is the reason code.
 */
const READ_ATTEMPT_ID = "read";

/**
 * The store's reference for the outreach family, reported as a read's source and in diagnostics.
 *
 * The reference is a fixed opaque marker naming the record family a reader would ask for. It is never
 * the session's identity: the session id is the value of the development cookie, so it is a
 * credential, and a credential has no place in an envelope a browser receives or in a log line.
 */
const OUTREACH_SOURCE_REFERENCE = "outreach";

/**
 * The stages this release's source-approved list offers, declared once here with the values the seeded
 * working lists use.
 *
 * A stage is a human assessment recorded against a member of a reviewed working list: it predicts no
 * giving, measures no worth and fulfils no obligation. It is a compact selector rather than a board,
 * and the set is closed, which is what lets a stored value the source no longer offers be reported as
 * retired instead of being silently accepted or dropped.
 *
 * Internal by design: this file exports five reads and their result shapes, and the stage vocabulary
 * reaches a surface through the value each read reports, never as a second exported list.
 */
const SOURCE_APPROVED_STAGES = [
  "Not yet asked",
  "Asked",
  "Answered",
  "Follow up due",
  "Paused",
] as const;

/**
 * How far the boundary-rule search looks when it recovers the calendar-day period a persisted
 * referral endpoint was resolved under.
 *
 * A search bound, not a policy: the release's periods are stated by the development runtime that
 * seeds the cycles, and this module must not restate them. Any period the rule can resolve inside a
 * little over a year is recoverable, and a stored endpoint that no period reproduces is disclosed as
 * such rather than being given a wording the evidence does not support.
 */
const NEW_WINDOW_PERIOD_SEARCH_LIMIT = 400;

// ---------------------------------------------------------------------------------------------
// The stored records these reads need
// ---------------------------------------------------------------------------------------------

/**
 * The members of a session's state document these five reads read.
 *
 * Each collection is validated through the record schema `../envelope` declares — the single
 * declaration of every stored shape — so a document written by another version is reported as an
 * unavailable source rather than projected into a shape a surface would render as fact. Unknown
 * members are ignored, because the rest of the document belongs to families this module never reads.
 */
const outreachDocumentsSchema = z.object({
  context: z.object({ revision: recordRevisionSchema }),
  partners: z.array(partnerRecordSchema),
  initiatives: z.array(initiativeRecordSchema),
  initiativeMembers: z.array(initiativeMemberRecordSchema),
  requests: z.array(requestRecordSchema),
  referrals: z.array(referralCycleRecordSchema),
  tasks: z.array(taskRecordSchema),
});

/** The validated outreach records of one session. */
type OutreachDocuments = z.infer<typeof outreachDocumentsSchema>;

// ---------------------------------------------------------------------------------------------
// Opening a read: session, scope, instant and records
// ---------------------------------------------------------------------------------------------

/** A read that could not start, already shaped as the refusal its caller returns unchanged. */
interface OutreachRefusal {
  readonly ok: false;
  readonly refusal: ReadResult<never>;
}

/** A read that may proceed: the session, the scope it acts in, its instant and its records. */
interface OutreachAccess {
  readonly ok: true;
  readonly session: ResolvedSession;
  readonly scope: Scope;
  readonly now: Temporal.Instant;
  readonly documents: OutreachDocuments;
}

/** The two halves of {@link openOutreach}'s answer. */
type OutreachOpening = OutreachAccess | OutreachRefusal;

/** Wraps a denial as the failing half of {@link OutreachOpening}. */
function refuseRead(denial: DeniedOutcome): OutreachRefusal {
  return { ok: false, refusal: { kind: "denied", denied: denial } };
}

/**
 * Builds the unavailable half of a read, naming the source rather than pretending the collection is
 * empty.
 *
 * An absent or unreadable source is never an empty list and never a zero: a surface that showed
 * "no initiatives" for a store it could not read would report a fact it does not have. The
 * diagnostic line names the job and the source's opaque identity and carries no record value.
 */
function unavailableRead(input: {
  readonly job: string;
  readonly reference: string;
  readonly guidance: string;
}): OutreachRefusal {
  const source: SourceReference = { system: LOCAL_STORE_SYSTEM, reference: input.reference };
  logger.sourceUnavailable({ job: input.job, source });
  return {
    ok: false,
    refusal: {
      kind: "unavailable",
      unavailable: unavailable({
        operationId: READ_ATTEMPT_ID,
        source,
        guidance: input.guidance,
      }),
    },
  };
}

/**
 * Resolves the session, the scope it has selected, the scenario instant and the records this read
 * needs.
 *
 * Scope is derived here and is never an argument: the cookie names a session, the session's own meta
 * document names the principal and the selected context, and admission is re-checked on the derived
 * scope. A session that has selected no context is refused rather than given the first membership it
 * happens to hold, because inventing one would hand the request authority it never asked for.
 *
 * The instant is the session's own scenario clock — the offset the development runtime persisted for
 * this session — so two sessions running in different scenarios are judged at their own now rather
 * than at whichever offset a process-wide clock happened to hold last. Every boundary is then a pure
 * function of `(record, now)`, evaluated here, with no background job anywhere.
 */
async function openOutreach(job: string, source?: SessionSource): Promise<OutreachOpening> {
  const resolved = await resolveSession(source);
  if (!resolved.ok) {
    return { ok: false, refusal: readResultOfRefusal(resolved.refusal) };
  }

  const { session } = resolved;
  const scope = session.selected;
  if (scope === null) {
    // No context has been selected, so there is no scope to read under. The session's own admission
    // state still decides why: the authority question is asked with a membership the principal
    // genuinely holds, purely to obtain that answer, so an expired or denied session is reported as
    // such rather than as a missing selection. Nothing is read with that scope.
    const admitted = session.admittedMemberships[0];
    if (admitted !== undefined) {
      const gate = assertScope(session, {
        organizationId: admitted.organizationId,
        ministryId: admitted.ministryId,
        supportSubjectId: admitted.supportSubjectId,
        principalId: session.principalId,
      });
      if (!gate.ok) {
        return refuseRead(gate.denial);
      }
    }
    return refuseRead(denied({ operationId: READ_ATTEMPT_ID, reasonCode: "no-membership" }));
  }

  const scoped = assertScope(session, scope);
  if (!scoped.ok) {
    return refuseRead(scoped.denial);
  }

  let stored: Awaited<ReturnType<typeof readSession>>;
  try {
    stored = await readSession(session.sessionId);
  } catch {
    stored = undefined;
  }
  if (stored === undefined) {
    return unavailableRead({
      job,
      reference: OUTREACH_SOURCE_REFERENCE,
      guidance:
        "The session's records could not be read. Reload the workspace, or reset the seed from Settings.",
    });
  }

  const parsed = outreachDocumentsSchema.safeParse(stored.state);
  if (!parsed.success) {
    return unavailableRead({
      job,
      reference: OUTREACH_SOURCE_REFERENCE,
      guidance:
        "The stored outreach records are not in a shape this build can read. Reset the seed from Settings to restore the known dataset.",
    });
  }

  return {
    ok: true,
    session,
    scope,
    now: instantAt(session.clockOffsetMs),
    documents: parsed.data,
  };
}

// ---------------------------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------------------------

/** The page number a request asks for, defaulting to the first page. */
function pageOf(requested: number | undefined): number {
  return requested !== undefined && Number.isSafeInteger(requested) && requested >= 1
    ? requested
    : 1;
}

/** The rows of one page over the whole authorised result. */
function slicePage<T>(rows: readonly T[], page: number, pageSize: number): readonly T[] {
  const offset = (page - 1) * pageSize;
  return rows.slice(offset, offset + pageSize);
}

/**
 * Records the state of one count: a known zero and a known other value are the two states a count can
 * be in, and they stay apart so a surface never renders an absence as nothing to report.
 */
function markCount(states: Record<string, RecordedValueState>, path: string, count: number): void {
  states[path] = count === 0 ? "zero" : "value";
}

/** Records the state of an optional value: `unknown` when the source established none. */
function markOptional(
  states: Record<string, RecordedValueState>,
  path: string,
  present: boolean,
): void {
  states[path] = present ? "value" : "unknown";
}

/** The earliest of some civil dates, as the ISO form a coverage boundary is stated in. */
function earliestCivil(dates: readonly (string | null)[]): string | null {
  const stated = dates.filter((value): value is string => value !== null).sort();
  return stated[0] ?? null;
}

/** The latest of some civil dates, as the ISO form a coverage boundary is stated in. */
function latestCivil(dates: readonly (string | null)[]): string | null {
  const stated = dates.filter((value): value is string => value !== null).sort();
  return stated[stated.length - 1] ?? null;
}

/**
 * States the period these records cover.
 *
 * The state is `complete` because the local store holds every record of the family for this scope:
 * nothing is sampled, nothing is paged away and nothing is dropped. A boundary is `null` when no
 * record states one, which is different from a boundary at the earliest day the store holds. What is
 * *not* known about an individual record — an unstated period, an imprecise introduction date — is a
 * value state on that field, never a coverage claim, because relabelling a real count as a partial
 * subtotal would imply a gap in the dataset that does not exist.
 */
function completeCoverage(from: string | null, to: string | null): Coverage {
  return { from, to, state: "complete" };
}

/**
 * Reads a persisted instant back into the value the boundary module takes.
 *
 * Only parsing happens here: no boundary, no arithmetic and no zone resolution is performed in this
 * module, so `@/modules/time/window` stays the one place a deadline is computed. A stored value that
 * is not a readable instant is reported as such rather than guessed at.
 */
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

/** The epoch milliseconds of a stored instant, used only to order records that share a collection. */
function instantOrder(value: string): number {
  const instant = readInstant(value);
  return instant === undefined ? Number.NEGATIVE_INFINITY : instant.epochMilliseconds;
}

/**
 * Reports whether the caller may read one partner record.
 *
 * Three permission facts stay three, and this answers only the first: whether the caller may see the
 * record at all. It is not contactability, not communication consent for any publisher or purpose,
 * and not a protected-content grant. A private-preparation record belongs to the principal whose
 * session documents hold it, so the session's own principal is its stated author; a shared record
 * states none.
 */
function canReadPartner(session: ResolvedSession, scope: Scope, partner: PartnerRecord): boolean {
  return canView(session, {
    kind: "partner",
    scope,
    audience: partner.audience,
    authorPrincipalId: partner.audience === "private" ? session.principalId : null,
  }).allowed;
}

/**
 * The partner records this read may name, by identifier, so a row never spells a hidden name and a
 * lookup a caller makes can never reach a partner the caller may not see.
 */
function readablePartners(
  session: ResolvedSession,
  scope: Scope,
  documents: OutreachDocuments,
): ReadonlyMap<string, PartnerRecord> {
  const readable = new Map<string, PartnerRecord>();
  for (const partner of documents.partners) {
    if (canReadPartner(session, scope, partner)) {
      readable.set(partner.partnerId, partner);
    }
  }
  return readable;
}

// ---------------------------------------------------------------------------------------------
// Initiatives: the list
// ---------------------------------------------------------------------------------------------

/**
 * How an initiative stands today.
 *
 * The stored record states `open` or `closed`; a reopening preserves the closure disposition it
 * recorded, so an initiative that is open beside a preserved disposition has been closed and reopened
 * rather than never closed. The three are reported apart because a reader deciding whether to resume
 * work needs to know an earlier close happened, and because collapsing `reopened` into `open` would
 * erase the history the reopen exists to preserve.
 */
export type InitiativeLifecycle = "open" | "reopened" | "closed";

/** The orders an initiative list may be presented in. */
export type InitiativeSort = "name" | "period-start" | "state";

/** What an initiative list may ask for: a state filter, a whole-dataset search, an order and a page. */
export interface InitiativesQuery {
  readonly state?: InitiativeState;
  /** Matched against the name and the purpose of every authorised initiative, never against a partner. */
  readonly search?: string;
  readonly sort?: InitiativeSort;
  readonly page?: number;
  readonly pageSize?: number;
}

/**
 * How many members a working list carries in each of its three states.
 *
 * Three counts and not one: `included` is the reviewed list, `removed` keeps the history of having
 * been on it, and `excluded` is a deliberate decision not to approach. None of the three is a count of
 * people asked, and none is a consent or an audience.
 */
export interface InitiativeMembershipCounts {
  readonly included: number;
  readonly removed: number;
  readonly excluded: number;
}

/** One initiative as a list row: its purpose, its accountable person, its period and its states. */
export interface InitiativeRow {
  readonly initiativeId: string;
  readonly name: string;
  readonly purpose: string;
  readonly responsiblePrincipalId: PrincipalId;
  /** The planning window the initiative states, or `null` when it states none. */
  readonly period: { readonly from: string | null; readonly to: string | null } | null;
  readonly state: InitiativeState;
  readonly lifecycle: InitiativeLifecycle;
  /** How unfinished work was handed on or resolved when it closed, as recorded. */
  readonly closureDisposition: string | null;
  readonly memberStates: InitiativeMembershipCounts;
  readonly revision: string;
}

/** One page of initiatives over the whole authorised result. */
export interface InitiativeListPage {
  readonly items: readonly InitiativeRow[];
  /** The whole-result count, never the size of the loaded page. */
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

/** Reads the life of an initiative from the two facts its record states. */
function lifecycleOf(initiative: InitiativeRecord): InitiativeLifecycle {
  if (initiative.state === "closed") {
    return "closed";
  }
  // A stored disposition beside an open initiative is what a reopen preserves, so it is the one
  // evidence that this initiative was closed before.
  return initiative.closureDisposition === null ? "open" : "reopened";
}

/**
 * Counts one initiative's members in their three states, over the partners this caller may name.
 *
 * A member whose partner record is not readable is not counted, so a total can never disclose that a
 * partner the caller may not see is on the list.
 */
function memberStatesOf(
  initiativeId: string,
  members: readonly InitiativeMemberRecord[],
  partners: ReadonlyMap<string, PartnerRecord>,
): InitiativeMembershipCounts {
  const counts = { included: 0, removed: 0, excluded: 0 };
  for (const member of members) {
    if (member.initiativeId !== initiativeId) {
      continue;
    }
    if (partners.get(member.partnerId) === undefined) {
      continue;
    }
    counts[member.state] += 1;
  }
  return counts;
}

/** Builds one list row from the initiative record and the working list it owns. */
function initiativeRowOf(
  initiative: InitiativeRecord,
  members: readonly InitiativeMemberRecord[],
  partners: ReadonlyMap<string, PartnerRecord>,
): InitiativeRow {
  return {
    initiativeId: initiative.initiativeId,
    name: initiative.name,
    purpose: initiative.purpose,
    responsiblePrincipalId: initiative.responsiblePrincipalId,
    period:
      initiative.period === null
        ? null
        : { from: initiative.period.from, to: initiative.period.to },
    state: initiative.state,
    lifecycle: lifecycleOf(initiative),
    closureDisposition: initiative.closureDisposition,
    memberStates: memberStatesOf(initiative.initiativeId, members, partners),
    revision: initiative.revision,
  };
}

/** The order a list request asks for, defaulting to the name. */
function sortOfInitiative(requested: InitiativeSort | undefined): InitiativeSort {
  switch (requested) {
    case "period-start":
    case "state":
    case "name":
      return requested;
    default:
      return "name";
  }
}

/**
 * The sort key of an optional civil date, so a stated date orders before an unstated one and two
 * stated dates order chronologically.
 */
function civilOrderKey(date: string | null): readonly [number, string] {
  return date === null ? [1, ""] : [0, date];
}

/** Orders work by the day it is due, with undated work after every dated task, then by identifier. */
function compareTasksByDue(left: TaskRecord, right: TaskRecord): number {
  const leftKey = civilOrderKey(left.dueOn);
  const rightKey = civilOrderKey(right.dueOn);
  if (leftKey[0] !== rightKey[0]) {
    return leftKey[0] - rightKey[0];
  }
  if (leftKey[1] !== rightKey[1]) {
    return leftKey[1] < rightKey[1] ? -1 : 1;
  }
  return left.taskId < right.taskId ? -1 : 1;
}

/** The order the lifecycle states are listed in: work in progress, resumed, then closed. */
function lifecycleOrder(lifecycle: InitiativeLifecycle): number {
  switch (lifecycle) {
    case "open":
      return 0;
    case "reopened":
      return 1;
    case "closed":
      return 2;
  }
}

/**
 * Orders two initiative rows under one requested order.
 *
 * The name tiebreak compares by code unit rather than by locale, so the order is the same on every
 * machine, in every process and after any collation update; a surface may present the same rows
 * differently, but a page boundary must not move between readers.
 */
function compareInitiatives(
  sort: InitiativeSort,
  left: InitiativeRow,
  right: InitiativeRow,
): number {
  if (sort === "period-start") {
    const a = civilOrderKey(left.period === null ? null : left.period.from);
    const b = civilOrderKey(right.period === null ? null : right.period.from);
    if (a[0] !== b[0]) {
      return a[0] - b[0];
    }
    if (a[1] !== b[1]) {
      return a[1] < b[1] ? -1 : 1;
    }
  }
  if (sort === "state") {
    const difference = lifecycleOrder(left.lifecycle) - lifecycleOrder(right.lifecycle);
    if (difference !== 0) {
      return difference;
    }
  }
  return compareCodeUnits(left.name, right.name);
}

/**
 * Lists the initiatives of the admitted ministry with their purpose, accountable person, optional
 * period and state, paged over the whole authorised result.
 *
 * Membership is reported as the three counts of a reviewed working list and nothing else: this read
 * never derives a member from a filter that happens to match, so a roster query run after the list was
 * reviewed changes nothing here. A test-view of a stage arrives with `readInitiative`.
 */
export async function readInitiatives(
  query: InitiativesQuery = {},
  source?: SessionSource,
): Promise<ReadResult<ReadEnvelope<InitiativeListPage>>> {
  const opening = await openOutreach("readInitiatives", source);
  if (!opening.ok) {
    return opening.refusal;
  }

  const { session, scope, now, documents } = opening;
  const partners = readablePartners(session, scope, documents);

  const readable: InitiativeRow[] = [];
  for (const initiative of documents.initiatives) {
    const decision = canView(session, {
      kind: "initiative",
      scope,
      ministryId: initiative.ministryContextId,
      responsiblePrincipalId: initiative.responsiblePrincipalId,
    });
    if (!decision.allowed) {
      continue;
    }
    readable.push(initiativeRowOf(initiative, documents.initiativeMembers, partners));
  }

  const needle = (query.search ?? "").trim().toLowerCase();
  const stateFilter = query.state;
  const matching = readable.filter((row) => {
    if (stateFilter !== undefined && row.state !== stateFilter) {
      return false;
    }
    if (needle === "") {
      return true;
    }
    return row.name.toLowerCase().includes(needle) || row.purpose.toLowerCase().includes(needle);
  });

  const sort = sortOfInitiative(query.sort);
  const ordered = [...matching].sort((left, right) => compareInitiatives(sort, left, right));

  const page = pageOf(query.page);
  const pageSize = clampPageSize(query.pageSize);
  const items = slicePage(ordered, page, pageSize);

  const states: Record<string, RecordedValueState> = {};
  markCount(states, "page.total", ordered.length);
  for (const row of items) {
    markOptional(
      states,
      `${row.initiativeId}.period.from`,
      row.period !== null && row.period.from !== null,
    );
    markOptional(
      states,
      `${row.initiativeId}.period.to`,
      row.period !== null && row.period.to !== null,
    );
    markOptional(states, `${row.initiativeId}.closureDisposition`, row.closureDisposition !== null);
    markCount(states, `${row.initiativeId}.memberStates.included`, row.memberStates.included);
    markCount(states, `${row.initiativeId}.memberStates.removed`, row.memberStates.removed);
    markCount(states, `${row.initiativeId}.memberStates.excluded`, row.memberStates.excluded);
  }

  const actions: readonly ReadAction[] = [
    { name: "createInitiative", available: true },
    ordered.length === 0
      ? {
          name: "readInitiative",
          available: false,
          reason: "No initiative in this ministry matches the current view.",
        }
      : { name: "readInitiative", available: true },
  ];

  return {
    kind: "envelope",
    envelope: buildEnvelope({
      data: { items, total: ordered.length, page, pageSize },
      scope,
      // The source is the local store named by its fixed family marker: an opaque reference a reader
      // can use to find the owner of these records, never the session credential that opened it.
      source: { system: LOCAL_STORE_SYSTEM, reference: OUTREACH_SOURCE_REFERENCE },
      // The collection has no revision of its own; the document set that holds it does, and a change
      // originating from a row states that row's own revision.
      revision: documents.context.revision,
      asOf: now.toString(),
      coverage: completeCoverage(
        earliestCivil(readable.map((row) => (row.period === null ? null : row.period.from))),
        latestCivil(readable.map((row) => (row.period === null ? null : row.period.to))),
      ),
      valueStates: states,
      actions,
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// Initiatives: one initiative
// ---------------------------------------------------------------------------------------------

/** What one initiative's detail may ask for: a membership-state filter and a page of the working list. */
export interface InitiativeDetailQuery {
  readonly memberState?: InitiativeMemberState;
  readonly page?: number;
  readonly pageSize?: number;
}

/**
 * Where a member's recorded stage stands against the list the source approves today.
 *
 * `admitted` is a value the source still offers, `retired` is a value it no longer offers, and
 * `unrecorded` is the honest absence of an assessment. The three stay apart — and all three stay
 * apart from a refusal and from an unavailable source — so a stale stage is reported as stale rather
 * than silently accepted, silently dropped or presented as a decision nobody recorded.
 */
export type InitiativeStageState = "admitted" | "retired" | "unrecorded";

/** One value of the source-approved stage list, and whether the source still offers it. */
export interface InitiativeStageOption {
  readonly value: string;
  readonly admitted: boolean;
}

/** One recorded change of a member's state, kept so a removal or an exclusion is never silent. */
export interface InitiativeMemberHistoryRow {
  readonly state: InitiativeMemberState;
  readonly at: string;
  readonly byPrincipalId: PrincipalId;
  readonly reason: string | null;
}

/** One partner as the reviewed working list presents them. */
export interface InitiativeMemberRow {
  readonly memberId: string;
  readonly partnerId: string;
  readonly partnerDisplayName: string;
  readonly partnerKind: PartnerKind;
  readonly state: InitiativeMemberState;
  /** The recorded assessment, or `null` when none was recorded. */
  readonly stage: string | null;
  readonly stageState: InitiativeStageState;
  readonly addedAt: string;
  /** When the member was last returned to the list, or `null` when they never were. */
  readonly returnedAt: string | null;
  readonly history: readonly InitiativeMemberHistoryRow[];
  readonly revision: string;
}

/**
 * What a Request asked for, versioned: requested terms, never received support.
 *
 * `basis` is stated in the value itself so no reader can mistake an ask for a gift: these terms never
 * enter a support projection, and the money they carry is what was requested in an exact currency and
 * an integer count of that currency's minor units. A non-financial ask carries no amount at all —
 * `money` is `null` rather than a zero amount — because a zero would read as an ask for nothing.
 */
export interface RequestedTermsRow {
  readonly version: string;
  readonly basis: "requested-terms";
  readonly money: {
    readonly currency: string;
    /** The exact integer count of the currency's minor units that was requested. */
    readonly minorUnits: number;
    /** The currency's exported exponent, or `null` when the table does not know the code. */
    readonly currencyExponent: number | null;
    readonly cadence: string | null;
    readonly term: string | null;
  } | null;
  readonly nonFinancial: string | null;
}

/** The actual presentation of a Request: when, how, and the terms version it showed. */
export interface RequestPresentationRow {
  readonly presentedOn: string;
  readonly manner: string;
  readonly versionRef: string;
  /** Whether the version it showed is still the version the Request states. */
  readonly citesCurrentVersion: boolean;
}

/**
 * A response, bound to the terms version it answers.
 *
 * `standingEvidence` is what the response was said on the strength of, and it is reported as
 * recorded: a job title, a household relationship or a staff role establishes no authority, so none
 * is inferred from a name, an address or a related record.
 */
export interface RequestResponseRow {
  readonly kind: RequestResponseKind;
  readonly respondentId: string;
  readonly standingEvidence: string | null;
  readonly termsVersionRef: string;
  readonly recordedAt: string;
  /** Whether the version answered is still the version the Request states. */
  readonly answersCurrentVersion: boolean;
}

/** One independently answerable invitation inside an initiative. */
export interface InitiativeRequestRow {
  readonly requestId: string;
  readonly recipientPartnerId: string;
  /** The recipient's name when this caller may name that partner, otherwise `null`. */
  readonly recipientDisplayName: string | null;
  readonly representedOrganizationId: string | null;
  readonly purpose: string;
  readonly terms: RequestedTermsRow;
  readonly presentation: RequestPresentationRow | null;
  readonly response: RequestResponseRow | null;
  /** True when a response exists and answers terms other than the current version. */
  readonly answeredEarlierTermsVersion: boolean;
  /** True while no response is recorded: a real category, not an absence. */
  readonly unanswered: boolean;
  readonly nextWorkIds: readonly string[];
  readonly revision: string;
}

/** One piece of work the initiative owns, as its detail presents it. */
export interface InitiativeTaskRow {
  readonly taskId: string;
  readonly title: string;
  readonly dueOn: string | null;
  readonly plannedTime: string | null;
  readonly timeZone: string | null;
  readonly kind: TaskKind;
  readonly status: TaskRecordStatus;
  readonly ownerPrincipalId: PrincipalId;
  readonly revision: string;
}

/**
 * One entry of an initiative's history, derived only from records that carry a time.
 *
 * A close and a reopen are reported through the initiative's own lifecycle and closure disposition
 * rather than as dated entries, because no record states when either happened and inventing a date
 * would be a fabricated fact in a history a person reads as record.
 */
export type InitiativeHistoryRow =
  | {
      readonly kind: "member-state";
      readonly at: string;
      readonly memberId: string;
      readonly state: InitiativeMemberState;
      readonly byPrincipalId: PrincipalId;
      readonly reason: string | null;
    }
  | {
      readonly kind: "request-response";
      readonly at: string;
      readonly requestId: string;
      readonly responseKind: RequestResponseKind;
      readonly termsVersionRef: string;
      readonly respondentId: string;
    };

/** One page of the reviewed working list, over the whole authorised list. */
export interface InitiativeWorkingListPage {
  readonly items: readonly InitiativeMemberRow[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * Everything one initiative's detail presents: its overview, list, Requests, work and history.
 *
 * The reviewed working list is the collection this read pages, at 50 rows by default and 200 at most,
 * because it is the one collection that grows with how many partners the ministry is approaching. The
 * Requests and the open work it owns are each bounded by that list — one invitation per reviewed
 * partner, a handful of follow-up tasks — so they are returned complete beside their whole-result
 * counts rather than through two further page axes the one query would have to carry.
 */
export interface InitiativeDetail {
  readonly initiative: InitiativeRow;
  /** Every admitted value, then every value the source no longer offers but a member still carries. */
  readonly stages: readonly InitiativeStageOption[];
  readonly workingList: InitiativeWorkingListPage;
  readonly requests: { readonly items: readonly InitiativeRequestRow[]; readonly total: number };
  readonly nextWork: { readonly items: readonly InitiativeTaskRow[]; readonly total: number };
  readonly history: readonly InitiativeHistoryRow[];
}

/** Whether a recorded stage is a value the source still offers. */
function stageStateOf(stage: string | null): InitiativeStageState {
  if (stage === null) {
    return "unrecorded";
  }
  return (SOURCE_APPROVED_STAGES as readonly string[]).includes(stage) ? "admitted" : "retired";
}

/**
 * The stage set a selector offers: every admitted value, then every recorded value the source has
 * retired, so a member's stale assessment can still be seen and replaced deliberately.
 */
function stageOptionsOf(
  members: readonly InitiativeMemberRecord[],
): readonly InitiativeStageOption[] {
  const options: InitiativeStageOption[] = SOURCE_APPROVED_STAGES.map((value) => ({
    value,
    admitted: true,
  }));
  const retired = new Set<string>();
  for (const member of members) {
    if (member.stage !== null && stageStateOf(member.stage) === "retired") {
      retired.add(member.stage);
    }
  }
  return [...options, ...[...retired].sort().map((value) => ({ value, admitted: false }))];
}

/** The order the three membership states are listed in: the reviewed list, then its history. */
function memberStateOrder(state: InitiativeMemberState): number {
  switch (state) {
    case "included":
      return 0;
    case "removed":
      return 1;
    case "excluded":
      return 2;
  }
}

/**
 * Builds one working-list row, or `undefined` when this caller may not name the partner.
 *
 * A member whose partner is unreadable is left out before the list is counted, so neither the page nor
 * its total can disclose that a partner the caller may not see is on the list.
 */
function memberRowOf(
  member: InitiativeMemberRecord,
  partners: ReadonlyMap<string, PartnerRecord>,
): InitiativeMemberRow | undefined {
  const partner = partners.get(member.partnerId);
  if (partner === undefined) {
    return undefined;
  }
  return {
    memberId: member.memberId,
    partnerId: member.partnerId,
    partnerDisplayName: partner.displayName,
    partnerKind: partner.kind,
    state: member.state,
    stage: member.stage,
    stageState: stageStateOf(member.stage),
    addedAt: member.addedAt,
    returnedAt: member.returnedAt,
    history: member.history.map((entry) => ({
      state: entry.state,
      at: entry.at,
      byPrincipalId: entry.byPrincipalId,
      reason: entry.reason,
    })),
    revision: member.revision,
  };
}

/** Builds the requested-terms row, stating the currency exponent rather than assuming two decimals. */
function requestedTermsOf(terms: RequestRecord["terms"]): RequestedTermsRow {
  return {
    version: terms.version,
    basis: "requested-terms",
    money:
      terms.money === null
        ? null
        : {
            currency: terms.money.amount.currency,
            minorUnits: terms.money.amount.minorUnits,
            currencyExponent: exponentOf(terms.money.amount.currency) ?? null,
            cadence: terms.money.cadence,
            term: terms.money.term,
          },
    nonFinancial: terms.nonFinancial,
  };
}

/** Builds one Request row, naming the recipient only when this caller may name that partner. */
function requestRowOf(
  request: RequestRecord,
  partners: ReadonlyMap<string, PartnerRecord>,
): InitiativeRequestRow {
  const recipient = partners.get(request.recipientPartnerId);
  const currentVersion = request.terms.version;
  return {
    requestId: request.requestId,
    recipientPartnerId: request.recipientPartnerId,
    recipientDisplayName: recipient === undefined ? null : recipient.displayName,
    representedOrganizationId: request.representedOrganizationId,
    purpose: request.purpose,
    terms: requestedTermsOf(request.terms),
    presentation:
      request.presentation === null
        ? null
        : {
            presentedOn: request.presentation.presentedOn,
            manner: request.presentation.manner,
            versionRef: request.presentation.versionRef,
            citesCurrentVersion: request.presentation.versionRef === currentVersion,
          },
    response:
      request.response === null
        ? null
        : {
            kind: request.response.kind,
            respondentId: request.response.respondentId,
            standingEvidence: request.response.standingEvidence,
            termsVersionRef: request.response.termsVersionRef,
            recordedAt: request.response.recordedAt,
            answersCurrentVersion: request.response.termsVersionRef === currentVersion,
          },
    answeredEarlierTermsVersion:
      request.response !== null && request.response.termsVersionRef !== currentVersion,
    unanswered: request.response === null,
    nextWorkIds: request.nextWorkIds,
    revision: request.revision,
  };
}

/** Builds one next-work row, without the task's own note: work is summarised, private text is not. */
function taskRowOf(task: TaskRecord): InitiativeTaskRow {
  return {
    taskId: task.taskId,
    title: task.title,
    dueOn: task.dueOn,
    plannedTime: task.plannedTime,
    timeZone: task.timeZone,
    kind: task.kind,
    status: task.status,
    ownerPrincipalId: task.ownerPrincipalId,
    revision: task.revision,
  };
}

/** Collects every dated entry an initiative's own records state, newest first. */
function historyOf(
  initiativeId: string,
  members: readonly InitiativeMemberRecord[],
  requests: readonly RequestRecord[],
): readonly InitiativeHistoryRow[] {
  const entries: InitiativeHistoryRow[] = [];
  for (const member of members) {
    if (member.initiativeId !== initiativeId) {
      continue;
    }
    for (const change of member.history) {
      entries.push({
        kind: "member-state",
        at: change.at,
        memberId: member.memberId,
        state: change.state,
        byPrincipalId: change.byPrincipalId,
        reason: change.reason,
      });
    }
  }
  for (const request of requests) {
    if (request.initiativeId !== initiativeId || request.response === null) {
      continue;
    }
    entries.push({
      kind: "request-response",
      at: request.response.recordedAt,
      requestId: request.requestId,
      responseKind: request.response.kind,
      termsVersionRef: request.response.termsVersionRef,
      respondentId: request.response.respondentId,
    });
  }
  return entries.sort((left, right) => instantOrder(right.at) - instantOrder(left.at));
}

/**
 * States which changes the caller may currently make, with a reason for each it may not.
 *
 * The actions are advisory: every mutation re-derives scope, permission and the expected revision when
 * it is submitted, so a stale list can produce a refusal but never an unauthorised write. A late
 * response remains recordable while the initiative is closed — closing fences new solicitation, not
 * the record of an answer that actually arrived — which is why that action's availability does not
 * depend on the lifecycle at all.
 */
function initiativeActions(input: {
  readonly session: ResolvedSession;
  readonly scope: Scope;
  readonly initiative: InitiativeRecord;
  readonly members: readonly InitiativeMemberRecord[];
  readonly requests: readonly RequestRecord[];
}): readonly ReadAction[] {
  const edits = canEdit(input.session, {
    kind: "initiative",
    scope: input.scope,
    ministryId: input.initiative.ministryContextId,
    responsiblePrincipalId: input.initiative.responsiblePrincipalId,
  });
  const lifecycle = lifecycleOf(input.initiative);
  const closed = lifecycle === "closed";
  const responsibleReason = "Only the principal responsible for this initiative may change it.";
  const listed = input.members.filter((member) => member.state === "included").length > 0;
  const returned = input.members.filter((member) => member.state === "removed").length > 0;
  const awaitingPresentation = input.requests.some((request) => request.presentation === null);
  const awaitingResponse = input.requests.some(
    (request) => request.presentation !== null && request.response === null,
  );

  const refused = (name: string, reason: string): ReadAction => ({
    name,
    available: false,
    reason: edits.allowed ? reason : responsibleReason,
  });

  return [
    edits.allowed && !closed
      ? { name: "addMembers", available: true }
      : refused(
          "addMembers",
          "This initiative is closed, so its working list no longer takes new members.",
        ),
    edits.allowed && listed
      ? { name: "removeMember", available: true }
      : refused("removeMember", "The working list has no included member to remove."),
    edits.allowed && returned
      ? { name: "returnMember", available: true }
      : refused("returnMember", "No removed member is available to return."),
    edits.allowed && listed
      ? { name: "setStage", available: true }
      : refused(
          "setStage",
          "A stage is recorded against an included member, and the working list has none.",
        ),
    edits.allowed && !closed
      ? { name: "draftRequest", available: true }
      : refused("draftRequest", "This initiative is closed, so no new Request may be drafted."),
    edits.allowed && awaitingPresentation
      ? { name: "presentRequest", available: true }
      : refused("presentRequest", "No drafted Request is waiting to be presented."),
    edits.allowed && awaitingResponse
      ? { name: "recordRequestResponse", available: true }
      : refused("recordRequestResponse", "No presented Request is waiting for a response."),
    edits.allowed && !closed
      ? { name: "closeInitiative", available: true }
      : refused("closeInitiative", "This initiative is already closed."),
    edits.allowed && closed
      ? { name: "reopenInitiative", available: true }
      : refused("reopenInitiative", "Only a closed initiative can be reopened."),
  ];
}

/**
 * Reads one initiative: its overview, its reviewed working list, its Requests with the terms version
 * each answers, the work it owns and its dated history.
 *
 * A reference that names no initiative this caller may read is refused in exactly the shape a
 * reference to an initiative in another ministry produces, because a distinguishable "not found"
 * would let a caller enumerate what it cannot see.
 */
export async function readInitiative(
  initiativeId: string,
  query: InitiativeDetailQuery = {},
  source?: SessionSource,
): Promise<ReadResult<ReadEnvelope<InitiativeDetail>>> {
  const opening = await openOutreach("readInitiative", source);
  if (!opening.ok) {
    return opening.refusal;
  }

  const { session, scope, now, documents } = opening;
  const initiative = documents.initiatives.find((record) => record.initiativeId === initiativeId);
  if (initiative === undefined) {
    return {
      kind: "denied",
      denied: denied({ operationId: READ_ATTEMPT_ID, reasonCode: "no-permission" }),
    };
  }

  const decision = canView(session, {
    kind: "initiative",
    scope,
    ministryId: initiative.ministryContextId,
    responsiblePrincipalId: initiative.responsiblePrincipalId,
  });
  if (!decision.allowed) {
    return { kind: "denied", denied: decision.denial };
  }

  const partners = readablePartners(session, scope, documents);
  const members = documents.initiativeMembers.filter(
    (member) => member.initiativeId === initiative.initiativeId,
  );
  const requests = documents.requests
    .filter((request) => request.initiativeId === initiative.initiativeId)
    .sort((left, right) => (left.requestId < right.requestId ? -1 : 1));

  const workingList = members
    .map((member) => memberRowOf(member, partners))
    .filter((row): row is InitiativeMemberRow => row !== undefined)
    .filter((row) => query.memberState === undefined || row.state === query.memberState)
    .sort((left, right) => {
      const byState = memberStateOrder(left.state) - memberStateOrder(right.state);
      if (byState !== 0) {
        return byState;
      }
      // Code-unit order, never a locale-aware one: a page boundary must not move between machines.
      return compareCodeUnits(left.partnerDisplayName, right.partnerDisplayName);
    });

  const page = pageOf(query.page);
  const pageSize = clampPageSize(query.pageSize);
  const items = slicePage(workingList, page, pageSize);

  const requestRows = requests.map((request) => requestRowOf(request, partners));
  const nextWork = documents.tasks
    .filter(
      (task) =>
        task.initiativeId === initiative.initiativeId &&
        (task.status === "open" || task.status === "reopened"),
    )
    .sort(compareTasksByDue)
    .map(taskRowOf);

  const states: Record<string, RecordedValueState> = {};
  markCount(states, "workingList.total", workingList.length);
  markCount(states, "requests.total", requestRows.length);
  markCount(states, "nextWork.total", nextWork.length);
  markOptional(
    states,
    "initiative.period.from",
    initiative.period !== null && initiative.period.from !== null,
  );
  markOptional(
    states,
    "initiative.period.to",
    initiative.period !== null && initiative.period.to !== null,
  );
  markOptional(states, "initiative.closureDisposition", initiative.closureDisposition !== null);
  for (const row of items) {
    markOptional(states, `${row.memberId}.stage`, row.stage !== null);
    markOptional(states, `${row.memberId}.returnedAt`, row.returnedAt !== null);
  }
  for (const request of requestRows) {
    markOptional(
      states,
      `${request.requestId}.representedOrganizationId`,
      request.representedOrganizationId !== null,
    );
    markOptional(states, `${request.requestId}.presentation`, request.presentation !== null);
    markOptional(states, `${request.requestId}.response`, request.response !== null);
    markOptional(states, `${request.requestId}.terms.money`, request.terms.money !== null);
    if (request.terms.money !== null) {
      markOptional(
        states,
        `${request.requestId}.terms.money.currencyExponent`,
        request.terms.money.currencyExponent !== null,
      );
    }
    if (request.recipientDisplayName === null) {
      // The caller may not name this recipient: the value is withheld rather than unknown, and a
      // surface must render it as withheld so it is never mistaken for an absent partner.
      states[`${request.requestId}.recipientDisplayName`] = "withheld";
    } else {
      states[`${request.requestId}.recipientDisplayName`] = "value";
    }
  }
  for (const task of nextWork) {
    markOptional(states, `${task.taskId}.dueOn`, task.dueOn !== null);
    markOptional(states, `${task.taskId}.plannedTime`, task.plannedTime !== null);
  }

  const data: InitiativeDetail = {
    initiative: initiativeRowOf(initiative, members, partners),
    stages: stageOptionsOf(members),
    workingList: { items, total: workingList.length, page, pageSize },
    requests: { items: requestRows, total: requestRows.length },
    nextWork: { items: nextWork, total: nextWork.length },
    history: historyOf(initiative.initiativeId, members, requests),
  };

  return {
    kind: "envelope",
    envelope: buildEnvelope({
      data,
      scope,
      source: { system: LOCAL_STORE_SYSTEM, reference: OUTREACH_SOURCE_REFERENCE },
      revision: initiative.revision,
      asOf: now.toString(),
      coverage: completeCoverage(
        earliestCivil([
          initiative.period === null ? null : initiative.period.from,
          ...requests.map((request) =>
            request.presentation === null ? null : request.presentation.presentedOn,
          ),
        ]),
        latestCivil([initiative.period === null ? null : initiative.period.to]),
      ),
      valueStates: states,
      actions: initiativeActions({ session, scope, initiative, members, requests }),
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// Initiatives: results
// ---------------------------------------------------------------------------------------------

/**
 * One count with the base it is measured against and that base's meaning.
 *
 * `percentage` is present only when the denominator is positive: a rate over an empty base is no rate
 * at all, so nothing is produced — not `0`, not `0%` and not a value that renders as a proportion of
 * nothing. A bare percentage over an unstated base is what makes an outreach result easy to misread,
 * so it cannot be expressed here.
 */
export interface MeasuredCount {
  readonly count: number;
  readonly denominator: number;
  readonly denominatorMeaning: string;
  readonly percentage?: number;
}

/** One of the seven response kinds with the count it holds and the base it is measured against. */
export interface ResponseKindResult extends MeasuredCount {
  readonly kind: RequestResponseKind;
}

/**
 * The results of one terms version: how many Requests referenced it, and how many responses bind to it.
 *
 * A late response against an earlier version appears here as a `superseded` version that is answered,
 * beside the `current` version that is not, so the two are never presented as each other.
 */
export interface TermsVersionResult {
  readonly termsVersion: string;
  readonly state: "current" | "superseded";
  readonly requestsReferencing: number;
  readonly responses: MeasuredCount;
}

/** The whole result of one initiative, with every count carrying its denominator. */
export interface InitiativeResults {
  readonly initiative: {
    readonly initiativeId: string;
    readonly name: string;
    readonly state: InitiativeState;
    readonly lifecycle: InitiativeLifecycle;
    readonly revision: string;
  };
  readonly workingList: {
    readonly included: MeasuredCount;
    readonly removed: MeasuredCount;
    readonly excluded: MeasuredCount;
  };
  readonly requests: {
    readonly presented: MeasuredCount;
    readonly answered: MeasuredCount;
    readonly unanswered: MeasuredCount;
  };
  readonly responseKinds: readonly ResponseKindResult[];
  readonly termsVersions: readonly TermsVersionResult[];
}

/** The base a working-list count is measured against. */
const WORKING_LIST_BASE = "partners the reviewed working list carries";

/** The base a Request count is measured against. */
const REQUEST_BASE = "Requests recorded for this initiative";

/**
 * Measures a count against its base.
 *
 * The percentage is one decimal place, computed from integer counts, and it is omitted entirely when
 * the base is zero. It is a rate over a stated base, never a score: nothing here ranks a partner by
 * worth, predicts giving or derives a likelihood from a stage.
 */
function measuredCount(
  count: number,
  denominator: number,
  denominatorMeaning: string,
): MeasuredCount {
  const base = { count, denominator, denominatorMeaning };
  if (denominator <= 0) {
    return base;
  }
  return { ...base, percentage: Math.round((count * 1000) / denominator) / 10 };
}

/**
 * Reads one initiative's results: every count as a numerator over a stated base.
 *
 * The bases are the reviewed working list, the Requests recorded for the initiative and, per terms
 * version, the Requests that referenced it. A response that answered terms other than the current
 * version is reported under the version it answered — which is why a superseded version can be fully
 * answered while the current one is not — and `unanswered` is one of the seven real categories rather
 * than the absence of a row.
 */
export async function readInitiativeResults(
  initiativeId: string,
  source?: SessionSource,
): Promise<ReadResult<ReadEnvelope<InitiativeResults>>> {
  const opening = await openOutreach("readInitiativeResults", source);
  if (!opening.ok) {
    return opening.refusal;
  }

  const { session, scope, now, documents } = opening;
  const initiative = documents.initiatives.find((record) => record.initiativeId === initiativeId);
  if (initiative === undefined) {
    return {
      kind: "denied",
      denied: denied({ operationId: READ_ATTEMPT_ID, reasonCode: "no-permission" }),
    };
  }

  const decision = canView(session, {
    kind: "initiative",
    scope,
    ministryId: initiative.ministryContextId,
    responsiblePrincipalId: initiative.responsiblePrincipalId,
  });
  if (!decision.allowed) {
    return { kind: "denied", denied: decision.denial };
  }

  const partners = readablePartners(session, scope, documents);
  const members = documents.initiativeMembers.filter(
    (member) => member.initiativeId === initiative.initiativeId && partners.has(member.partnerId),
  );
  const requests = documents.requests.filter(
    (request) => request.initiativeId === initiative.initiativeId,
  );

  const rosterTotal = members.length;
  const included = members.filter((member) => member.state === "included").length;
  const removed = members.filter((member) => member.state === "removed").length;
  const excluded = members.filter((member) => member.state === "excluded").length;

  const presented = requests.filter((request) => request.presentation !== null).length;
  const answered = requests.filter((request) => request.response !== null).length;
  const unanswered = requests.filter((request) => request.response === null).length;

  const responseKinds: ResponseKindResult[] = REQUEST_RESPONSE_KINDS.map((kind) => ({
    kind,
    ...measuredCount(
      kind === "unanswered"
        ? unanswered
        : requests.filter((request) => request.response?.kind === kind).length,
      requests.length,
      REQUEST_BASE,
    ),
  }));

  const versionSet = new Set<string>();
  for (const request of requests) {
    versionSet.add(request.terms.version);
    if (request.presentation !== null) {
      versionSet.add(request.presentation.versionRef);
    }
    if (request.response !== null) {
      versionSet.add(request.response.termsVersionRef);
    }
  }
  const termsVersions: TermsVersionResult[] = [...versionSet].sort().map((termsVersion) => {
    const referencing = requests.filter(
      (request) =>
        request.terms.version === termsVersion ||
        request.presentation?.versionRef === termsVersion ||
        request.response?.termsVersionRef === termsVersion,
    ).length;
    const bound = requests.filter(
      (request) => request.response?.termsVersionRef === termsVersion,
    ).length;
    return {
      termsVersion,
      state: requests.some((request) => request.terms.version === termsVersion)
        ? "current"
        : "superseded",
      requestsReferencing: referencing,
      responses: measuredCount(
        bound,
        referencing,
        "Requests that stated or answered this terms version",
      ),
    };
  });

  const data: InitiativeResults = {
    initiative: {
      initiativeId: initiative.initiativeId,
      name: initiative.name,
      state: initiative.state,
      lifecycle: lifecycleOf(initiative),
      revision: initiative.revision,
    },
    workingList: {
      included: measuredCount(included, rosterTotal, WORKING_LIST_BASE),
      removed: measuredCount(removed, rosterTotal, WORKING_LIST_BASE),
      excluded: measuredCount(excluded, rosterTotal, WORKING_LIST_BASE),
    },
    requests: {
      presented: measuredCount(presented, requests.length, REQUEST_BASE),
      answered: measuredCount(answered, requests.length, REQUEST_BASE),
      unanswered: measuredCount(unanswered, requests.length, REQUEST_BASE),
    },
    responseKinds,
    termsVersions,
  };

  const states: Record<string, RecordedValueState> = {};
  for (const [path, value] of [
    ["workingList.included", data.workingList.included],
    ["workingList.removed", data.workingList.removed],
    ["workingList.excluded", data.workingList.excluded],
    ["requests.presented", data.requests.presented],
    ["requests.answered", data.requests.answered],
    ["requests.unanswered", data.requests.unanswered],
  ] as const) {
    markCount(states, `${path}.count`, value.count);
    markCount(states, `${path}.denominator`, value.denominator);
    markOptional(states, `${path}.percentage`, value.percentage !== undefined);
  }
  for (const kind of responseKinds) {
    markCount(states, `responseKinds.${kind.kind}.count`, kind.count);
    markOptional(states, `responseKinds.${kind.kind}.percentage`, kind.percentage !== undefined);
  }
  for (const version of termsVersions) {
    markCount(
      states,
      `termsVersions.${version.termsVersion}.requestsReferencing`,
      version.requestsReferencing,
    );
    markCount(
      states,
      `termsVersions.${version.termsVersion}.responses.count`,
      version.responses.count,
    );
    markOptional(
      states,
      `termsVersions.${version.termsVersion}.responses.percentage`,
      version.responses.percentage !== undefined,
    );
  }

  return {
    kind: "envelope",
    envelope: buildEnvelope({
      data,
      scope,
      source: { system: LOCAL_STORE_SYSTEM, reference: OUTREACH_SOURCE_REFERENCE },
      revision: initiative.revision,
      asOf: now.toString(),
      coverage: completeCoverage(
        earliestCivil([
          initiative.period === null ? null : initiative.period.from,
          ...requests.map((request) =>
            request.presentation === null ? null : request.presentation.presentedOn,
          ),
        ]),
        latestCivil([initiative.period === null ? null : initiative.period.to]),
      ),
      valueStates: states,
      actions: [{ name: "readInitiative", available: true }],
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// Referrals
// ---------------------------------------------------------------------------------------------

/**
 * The three referral lists, which are three different questions and never one filtered list.
 *
 * `active` is a window still running; `incomplete-date` is evidence too imprecise to have a deadline at
 * all; `expired` is permitted history, whose field set is the narrowest of the three.
 */
export type ReferralListName = "active" | "incomplete-date" | "expired";

/** What a referral list may ask for: which list, a whole-dataset search, and a page. */
export interface ReferralsQuery {
  readonly list?: ReferralListName;
  /** Matched against the partner's display name only, never against a source reference. */
  readonly search?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

/** The calendar-day wording of a New window, disclosed beside the instant that expires. */
export interface ReferralNominalWindow {
  /** The last date the nominal rule includes: the day before the exclusive endpoint. */
  readonly lastIncludedOn: string;
  /** The same statement in plain words, as the boundary module states it. */
  readonly wording: string;
  /** True when a gap or an overlap moved the resolved instant off the nominal midnight. */
  readonly disagreesWithResolved: boolean;
  readonly resolution: MidnightResolution;
}

/**
 * A referral's exclusive endpoint, as resolved and as disclosed.
 *
 * `end` is the persisted instant and is the authority: it is never recomputed for a judgement, so a
 * deadline already stated cannot move because someone travelled, changed a display setting or
 * installed newer timezone data. `nominal` is what a person would say out loud, and it is `null` with
 * a stated reason when the evidence does not support a wording — never replaced by a guess.
 */
export interface ReferralDeadlineView {
  readonly kind: ReferralWindowKind;
  readonly end: string;
  readonly nominal: ReferralNominalWindow | null;
  readonly nominalUnavailableReason: string | null;
  /** The civil day the persisted endpoint falls on in the source zone, when that zone resolves. */
  readonly resolvedOn: string | null;
}

/**
 * Whether this cycle's single deliberate continuation is currently on offer, and why not when it is
 * not.
 *
 * A reason travels with the cycle rather than a disabled control, so a reader is told why no Continue
 * is offered instead of pressing something that cannot work.
 */
export interface ContinuationEligibility {
  readonly available: boolean;
  readonly reason: string | null;
  readonly cycle: { readonly consumed: boolean; readonly successorId: string | null };
}

/**
 * The worker-continuation setting this session runs under, with the reason it gives when it withholds
 * the action.
 *
 * It is stated once per read rather than repeated on every row, because it is a policy of the session
 * and not a fact about a cycle: worker continuation is off by default, and an absent Continue is
 * disclosed as this policy rather than as a per-row omission a reader has to infer.
 */
export interface ContinuationPolicy {
  readonly setting: "on" | "off" | "unknown";
  readonly reason: string | null;
}

/**
 * One referral cycle in full: the introduction it records, the window resolved from it, where it
 * stands now and what may be done next.
 *
 * `originalIntroductionOn` is the date of the introduction itself. No entry timestamp is exposed
 * anywhere, because an import, a first view, a reassignment, a merge or a retry is not an introduction
 * and a surface must not be able to present one as the other.
 */
export interface ReferralDetailRow {
  readonly referralId: string;
  readonly partnerId: string;
  readonly partnerDisplayName: string;
  readonly partnerKind: PartnerKind;
  readonly datePrecision: DatePrecision;
  readonly originalIntroductionOn: string | null;
  readonly sourceZone: string;
  readonly sourceReference: SourceReference | null;
  readonly cycleIndex: number;
  readonly windowKind: ReferralWindowKind;
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly consumed: boolean;
  readonly predecessorId: string | null;
  readonly successorId: string | null;
  readonly status: ReferralWindowStatus;
  readonly deadline: ReferralDeadlineView | null;
  readonly continuation: ContinuationEligibility;
  readonly revision: string;
}

/**
 * The fields permitted Expired history states, and the complete list of them.
 *
 * Everything else a referral row carries — the partner identifier a caller could probe `readPartner`
 * with, the source zone, the predecessor trail, the nominal disclosure and the revision of a record no
 * write is offered on — is absent from the projection rather than hidden by a component. Expired
 * history is a narrow permission, not partner access, so the shape that grants access must not be
 * reconstructable from it.
 */
const EXPIRED_REFERRAL_FIELDS = [
  "referralId",
  "partnerDisplayName",
  "sourceReference",
  "status",
  "originalIntroductionOn",
  "datePrecision",
  "windowKind",
  "windowStart",
  "windowEnd",
  "cycleIndex",
  "consumed",
] as const satisfies readonly (keyof ReferralDetailRow)[];

/** One expired cycle as permitted history presents it: an approved identity, its status and its dates. */
export type ExpiredReferralRow = Pick<ReferralDetailRow, (typeof EXPIRED_REFERRAL_FIELDS)[number]>;

/** One referral as a list row: who it is, when it was introduced, where its window stands. */
export interface ReferralListRow {
  readonly referralId: string;
  readonly partnerDisplayName: string;
  readonly datePrecision: DatePrecision;
  readonly originalIntroductionOn: string | null;
  readonly cycleIndex: number;
  readonly windowKind: ReferralWindowKind;
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly status: ReferralWindowStatus["status"];
  /** The refusal behind a `refused` status, so the list never reports an unexplained lack of a date. */
  readonly statusReason: WindowRefusalReason | null;
  readonly consumed: boolean;
  readonly continuation: ContinuationEligibility;
}

/** One page of one referral list, over the whole authorised result. */
export type ReferralListData =
  | {
      readonly list: "active" | "incomplete-date";
      readonly items: readonly ReferralListRow[];
      readonly total: number;
      readonly page: number;
      readonly pageSize: number;
      readonly continuationPolicy: ContinuationPolicy;
    }
  | {
      readonly list: "expired";
      readonly items: readonly ExpiredReferralRow[];
      readonly total: number;
      readonly page: number;
      readonly pageSize: number;
      readonly continuationPolicy: ContinuationPolicy;
    };

/**
 * One referral, presented either in full or as permitted Expired history.
 *
 * The two are one union because the second is a permission rather than a layout: an expired cycle is
 * reported in the narrow shape whichever route reached it.
 */
export type ReferralDetailData =
  | {
      readonly view: "detail";
      readonly referral: ReferralDetailRow;
      readonly continuationPolicy: ContinuationPolicy;
    }
  | {
      readonly view: "expired-history";
      readonly referral: ExpiredReferralRow;
      readonly continuationPolicy: ContinuationPolicy;
    };

/**
 * The continuation policy this session runs under, read from the scenario flags that own it.
 *
 * A scenario id this build does not define leaves the setting `unknown` rather than assumed on, so a
 * document written by another version withholds the action instead of granting it.
 */
function continuationPolicyOf(session: ResolvedSession): ContinuationPolicy {
  const setting = isScenarioId(session.scenarioId)
    ? scenarioFlagsFor(session.scenarioId).continuationSetting
    : "unknown";
  switch (setting) {
    case "on":
      return { setting, reason: null };
    case "off":
      return {
        setting,
        reason:
          "Worker continuation is off, so an ordinarily expired referral offers no Continue action.",
      };
    case "unknown":
      return {
        setting,
        reason:
          "The worker-continuation setting could not be read, so no Continue action is offered.",
      };
  }
}

/**
 * Where one cycle stands at this instant.
 *
 * The judgement is the boundary module's, applied to the persisted endpoint: strictly before it the
 * cycle is active, and at it the cycle is expired rather than active. A cycle whose stored endpoint
 * cannot be read back is reported as refused, because a window that cannot be evaluated cannot be
 * shown to be running.
 */
function referralStatusOf(cycle: ReferralCycleRecord, now: Temporal.Instant): ReferralWindowStatus {
  const end = readInstant(cycle.windowEnd);
  if (cycle.windowEnd !== null && end === undefined) {
    return { status: "refused", reason: "invalid-date" };
  }
  return referralWindowState({ windowEnd: end, now });
}

/**
 * Recovers the calendar-day period whose rule resolves to the persisted endpoint.
 *
 * The release states its referral periods in the runtime that seeds the cycles, not on the cycle
 * record, and this module must not restate a policy it does not own. The disclosure is therefore
 * derived by asking the one boundary function which period reproduces the endpoint that was actually
 * recorded: no arithmetic is performed here, and a stored endpoint that no period reproduces yields no
 * nominal wording rather than a plausible-sounding one.
 */
function matchingNewWindowRule(input: {
  readonly cycle: ReferralCycleRecord;
  readonly originalIntroductionOn: CivilDate;
  readonly end: Temporal.Instant;
}): Extract<NewWindowEnd, { status: "bounded" }> | undefined {
  if (input.cycle.datePrecision !== "date") {
    return undefined;
  }
  for (let days = 1; days <= NEW_WINDOW_PERIOD_SEARCH_LIMIT; days += 1) {
    const candidate = newWindowEnd({
      originalIntroductionOn: input.originalIntroductionOn,
      datePrecision: input.cycle.datePrecision,
      sourceZone: input.cycle.sourceZone,
      days,
    });
    if (
      candidate.status === "bounded" &&
      candidate.resolvedEndInstant.toString() === input.end.toString()
    ) {
      return candidate;
    }
  }
  return undefined;
}

/** Builds the deadline disclosure for one cycle: the persisted instant first, the wording beside it. */
function deadlineOf(cycle: ReferralCycleRecord): ReferralDeadlineView | null {
  const end = readInstant(cycle.windowEnd);
  if (end === undefined) {
    return null;
  }

  const resolved = civilDateAt(end, cycle.sourceZone);
  const resolvedOn = resolved.status === "resolved" ? serialiseCivilDate(resolved.date) : null;

  if (cycle.windowKind === "continued") {
    return {
      kind: "continued",
      end: end.toString(),
      nominal: null,
      nominalUnavailableReason:
        "A continuation is counted in elapsed seconds from the instant it was accepted, so it has no calendar-day wording.",
      resolvedOn,
    };
  }

  const parsedDate =
    cycle.originalIntroductionOn === null
      ? undefined
      : parseCivilDate(cycle.originalIntroductionOn);
  if (parsedDate === undefined || parsedDate.status === "refused") {
    return {
      kind: cycle.windowKind,
      end: end.toString(),
      nominal: null,
      nominalUnavailableReason:
        "The stored introduction date cannot be read as a calendar date, so no calendar-day wording is stated for this endpoint.",
      resolvedOn,
    };
  }

  const rule = matchingNewWindowRule({
    cycle,
    originalIntroductionOn: parsedDate.date,
    end,
  });
  if (rule === undefined) {
    return {
      kind: cycle.windowKind,
      end: end.toString(),
      nominal: null,
      nominalUnavailableReason:
        "The persisted endpoint is not the endpoint any period of the New-window rule resolves today, so the persisted instant stands and no nominal wording is stated for it.",
      resolvedOn,
    };
  }

  return {
    kind: cycle.windowKind,
    end: end.toString(),
    nominal: {
      lastIncludedOn: serialiseCivilDate(rule.nominalLastIncludedOn),
      wording: rule.nominalWording,
      disagreesWithResolved: rule.nominalDisagreesWithResolved,
      resolution: rule.resolution,
    },
    nominalUnavailableReason: null,
    resolvedOn,
  };
}

/**
 * Whether this cycle's continuation is on offer, and the single reason it is not when it is not.
 *
 * A continuation needs all of: this caller's current permission, the worker-continuation setting on,
 * an ordinarily expired New window, and a cycle that has not already been continued. The setting is
 * checked first among the policy facts because it is the one a person can change, and an expired cycle
 * is checked before the consumed one because "it has already been continued" would be a misleading
 * answer for a cycle that was never eligible.
 */
function continuationOf(input: {
  readonly status: ReferralWindowStatus;
  readonly cycle: ReferralCycleRecord;
  readonly successorId: string | null;
  readonly policy: ContinuationPolicy;
}): ContinuationEligibility {
  const cycleState = { consumed: input.cycle.consumed, successorId: input.successorId };
  const unavailable = (reason: string): ContinuationEligibility => ({
    available: false,
    reason,
    cycle: cycleState,
  });

  switch (input.status.status) {
    case "active":
      return unavailable("This referral's window has not ended, so there is nothing to continue.");
    case "no-deadline":
      return unavailable(
        "The introduction date is not precise enough to have had a window, so there is nothing to continue.",
      );
    case "refused":
      return unavailable(
        "The window this referral carries could not be evaluated, so no continuation is offered.",
      );
    case "expired":
      break;
  }
  if (input.cycle.windowKind !== "new") {
    return unavailable(
      "This cycle is itself a continuation, and an introduction carries at most one continuation.",
    );
  }
  if (input.cycle.consumed || input.successorId !== null) {
    return unavailable("This referral cycle has already been continued.");
  }
  // The policy is consulted last, so a cycle that could not be continued anyway is told why in its
  // own terms and only a genuinely eligible cycle is withheld by the setting.
  if (input.policy.reason !== null) {
    return unavailable(input.policy.reason);
  }
  return { available: true, reason: null, cycle: cycleState };
}

/** The successor a cycle produced, which is what keeps it to at most one continuation. */
function successorIdOf(
  referralId: string,
  referrals: readonly ReferralCycleRecord[],
): string | null {
  const successor = referrals.find((cycle) => cycle.predecessorId === referralId);
  return successor === undefined ? null : successor.referralId;
}

/**
 * One referral row before its calendar-day disclosure is attached.
 *
 * A list presents where each window stands, not what it would read out loud, so the disclosure is
 * resolved once for the one cycle a detail opens instead of for every row a list enumerates. The
 * projection permitted Expired history states never carries the disclosure, which is why a row without
 * it is still the whole permitted shape.
 */
type ReferralRowBase = Omit<ReferralDetailRow, "deadline">;

/**
 * Builds one referral row, or `undefined` when this caller may not name the partner.
 *
 * A referral whose partner record is unreadable or unreadable-by-this-caller is omitted before any
 * count is taken, so a referral list can never become an oracle for a partner outside the caller's
 * scope.
 */
function referralRowOf(input: {
  readonly cycle: ReferralCycleRecord;
  readonly partners: ReadonlyMap<string, PartnerRecord>;
  readonly referrals: readonly ReferralCycleRecord[];
  readonly now: Temporal.Instant;
  readonly policy: ContinuationPolicy;
}): ReferralRowBase | undefined {
  const partner = input.partners.get(input.cycle.partnerId);
  if (partner === undefined) {
    return undefined;
  }
  const status = referralStatusOf(input.cycle, input.now);
  const successorId = successorIdOf(input.cycle.referralId, input.referrals);
  return {
    referralId: input.cycle.referralId,
    partnerId: input.cycle.partnerId,
    partnerDisplayName: partner.displayName,
    partnerKind: partner.kind,
    datePrecision: input.cycle.datePrecision,
    originalIntroductionOn: input.cycle.originalIntroductionOn,
    sourceZone: input.cycle.sourceZone,
    sourceReference: input.cycle.sourceReference,
    cycleIndex: input.cycle.cycleIndex,
    windowKind: input.cycle.windowKind,
    windowStart: input.cycle.windowStart,
    windowEnd: input.cycle.windowEnd,
    consumed: input.cycle.consumed,
    predecessorId: input.cycle.predecessorId,
    successorId,
    status,
    // Reaching this row already means the referral target was permitted, so the only remaining
    // question is the policy.
    continuation: continuationOf({
      status,
      cycle: input.cycle,
      successorId,
      policy: input.policy,
    }),
    revision: input.cycle.revision,
  };
}

/** The list one cycle belongs to, which is decided by its evidence rather than by a filter. */
function listOfStatus(status: ReferralWindowStatus): ReferralListName {
  switch (status.status) {
    case "active":
      return "active";
    case "expired":
      return "expired";
    case "no-deadline":
    case "refused":
      return "incomplete-date";
  }
}

/** One referral as a light list row, which carries where its window stands without the disclosure. */
function referralListRowOf(row: ReferralRowBase): ReferralListRow {
  return {
    referralId: row.referralId,
    partnerDisplayName: row.partnerDisplayName,
    datePrecision: row.datePrecision,
    originalIntroductionOn: row.originalIntroductionOn,
    cycleIndex: row.cycleIndex,
    windowKind: row.windowKind,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    status: row.status.status,
    statusReason: row.status.status === "refused" ? row.status.reason : null,
    consumed: row.consumed,
    continuation: row.continuation,
  };
}

/** The latest civil day any of these rows resolves its endpoint to, in each cycle's own source zone. */
function latestResolvedDay(rows: readonly ReferralRowBase[]): string | null {
  const days: (string | null)[] = [];
  for (const row of rows) {
    const end = readInstant(row.windowEnd);
    if (end === undefined) {
      days.push(null);
      continue;
    }
    const resolved = civilDateAt(end, row.sourceZone);
    days.push(resolved.status === "resolved" ? serialiseCivilDate(resolved.date) : null);
  }
  return latestCivil(days);
}

/**
 * Orders two optional stored dates newest first, with an unstated date after every stated one.
 *
 * The two-`undefined` case is answered explicitly so the comparison never subtracts two infinities
 * into `NaN`, which a sort would treat as an arbitrary decision rather than a stated order.
 */
function compareDatesDescending(left: string | null, right: string | null): number {
  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return instantOrder(right) - instantOrder(left);
}

/** The order a referral list is presented in: newest endpoint first, then newest introduction. */
function compareReferrals(left: ReferralRowBase, right: ReferralRowBase): number {
  const byEnd = compareDatesDescending(left.windowEnd, right.windowEnd);
  if (byEnd !== 0) {
    return byEnd;
  }
  const byIntroduction = compareDatesDescending(
    left.originalIntroductionOn,
    right.originalIntroductionOn,
  );
  if (byIntroduction !== 0) {
    return byIntroduction;
  }
  return left.referralId < right.referralId ? -1 : 1;
}

/**
 * Lists referrals in one of the three lists: Active, incomplete-date, or the narrow permitted Expired
 * view.
 *
 * The lists are distinct questions. Active and incomplete-date rows carry the partner, the recorded
 * date with its precision, the window and whether a continuation is on offer; the Expired list carries
 * only an approved identity, the source reference, the status and the permitted dates, because expired
 * history is a narrow permission rather than access to the partner. A cycle whose introduction date is
 * approximate or unknown is never briefly activated and never judged: it appears in incomplete-date
 * and states no deadline.
 *
 * A stored cycle states no withdrawn, revoked, erased or departed status, so nothing in this read can
 * present one of those fates as ordinary expiry: the only status a cycle carries is the window it
 * resolved, and a cycle whose window cannot be read is refused as incomplete rather than shown as
 * expired history.
 */
export async function readReferrals(
  query: ReferralsQuery = {},
  source?: SessionSource,
): Promise<ReadResult<ReadEnvelope<ReferralListData>>> {
  const opening = await openOutreach("readReferrals", source);
  if (!opening.ok) {
    return opening.refusal;
  }

  const { session, scope, now, documents } = opening;

  // The referral question is answered once, from the derived scope, and before anything is
  // enumerated: a caller without authority for this family learns nothing about its size.
  const permitted = canView(session, { kind: "referral", scope });
  if (!permitted.allowed) {
    return { kind: "denied", denied: permitted.denial };
  }

  const partners = readablePartners(session, scope, documents);
  const continuationPolicy = continuationPolicyOf(session);

  const rows: ReferralRowBase[] = [];
  for (const cycle of documents.referrals) {
    const row = referralRowOf({
      cycle,
      partners,
      referrals: documents.referrals,
      now,
      policy: continuationPolicy,
    });
    if (row !== undefined) {
      rows.push(row);
    }
  }

  const list: ReferralListName = query.list ?? "active";
  const needle = (query.search ?? "").trim().toLowerCase();
  const matching = rows
    .filter((row) => listOfStatus(row.status) === list)
    .filter((row) => needle === "" || row.partnerDisplayName.toLowerCase().includes(needle))
    .sort(compareReferrals);

  const page = pageOf(query.page);
  const pageSize = clampPageSize(query.pageSize);
  const pageRows = slicePage(matching, page, pageSize);

  const states: Record<string, RecordedValueState> = {};
  markCount(states, "page.total", matching.length);
  for (const row of pageRows) {
    markOptional(
      states,
      `${row.referralId}.originalIntroductionOn`,
      row.originalIntroductionOn !== null,
    );
    markOptional(states, `${row.referralId}.windowStart`, row.windowStart !== null);
    markOptional(states, `${row.referralId}.windowEnd`, row.windowEnd !== null);
    markOptional(states, `${row.referralId}.sourceReference`, row.sourceReference !== null);
  }

  const continueOffered = matching.some((row) => row.continuation.available);
  const actions: readonly ReadAction[] = [
    { name: "recordIntroduction", available: true },
    // Continue is absent rather than disabled when no cycle may be continued; each row states the
    // reason in its own `continuation`, so a reader is told why without being offered a dead control.
    ...(continueOffered ? [{ name: "continueReferral", available: true }] : []),
    matching.length === 0
      ? {
          name: "readReferral",
          available: false,
          reason: `No referral is in the ${list} list for the current view.`,
        }
      : { name: "readReferral", available: true },
  ];

  const data: ReferralListData =
    list === "expired"
      ? {
          list,
          items: pageRows.map((row) => project(row, EXPIRED_REFERRAL_FIELDS)),
          total: matching.length,
          page,
          pageSize,
          continuationPolicy,
        }
      : {
          list,
          items: pageRows.map(referralListRowOf),
          total: matching.length,
          page,
          pageSize,
          continuationPolicy,
        };

  return {
    kind: "envelope",
    envelope: buildEnvelope({
      data,
      scope,
      source: { system: LOCAL_STORE_SYSTEM, reference: OUTREACH_SOURCE_REFERENCE },
      revision: documents.context.revision,
      asOf: now.toString(),
      coverage: completeCoverage(
        earliestCivil(matching.map((row) => row.originalIntroductionOn)),
        latestResolvedDay(matching),
      ),
      valueStates: states,
      actions,
    }),
  };
}

/**
 * Reads one referral: the introduction it records with its precision, the window resolved from it, the
 * disclosure that sits beside the resolved instant, where it stands now and whether it may be
 * continued.
 *
 * An expired cycle is answered in the narrow Expired shape whichever route reached it, so an expired
 * referral cannot be re-opened into a partner record by asking for its detail. A reference that names
 * no referral this caller may read is refused in exactly the shape an out-of-scope reference produces.
 */
export async function readReferral(
  referralId: string,
  source?: SessionSource,
): Promise<ReadResult<ReadEnvelope<ReferralDetailData>>> {
  const opening = await openOutreach("readReferral", source);
  if (!opening.ok) {
    return opening.refusal;
  }

  const { session, scope, now, documents } = opening;
  const cycle = documents.referrals.find((record) => record.referralId === referralId);
  if (cycle === undefined) {
    return {
      kind: "denied",
      denied: denied({ operationId: READ_ATTEMPT_ID, reasonCode: "no-permission" }),
    };
  }

  const decision = canView(session, { kind: "referral", scope });
  if (!decision.allowed) {
    return { kind: "denied", denied: decision.denial };
  }

  const partners = readablePartners(session, scope, documents);
  const continuationPolicy = continuationPolicyOf(session);
  const base = referralRowOf({
    cycle,
    partners,
    referrals: documents.referrals,
    now,
    policy: continuationPolicy,
  });
  if (base === undefined) {
    // The partner behind this cycle is not one this caller may name, so the referral is refused in
    // the same shape a hidden record produces: nothing about the partner may be learned from it.
    return {
      kind: "denied",
      denied: denied({ operationId: READ_ATTEMPT_ID, reasonCode: "no-permission" }),
    };
  }

  // The one cycle this read opens is the one whose calendar-day disclosure is resolved.
  const row: ReferralDetailRow = { ...base, deadline: deadlineOf(cycle) };

  const expired = row.status.status === "expired";

  // An expired cycle is answered in the narrow permitted shape whichever route reached it, so its
  // detail cannot be re-opened into partner access; the continuation policy is stated beside the
  // projection rather than inside it, because it explains an absent action and discloses no record.
  const data: ReferralDetailData = expired
    ? {
        view: "expired-history",
        referral: project(row, EXPIRED_REFERRAL_FIELDS),
        continuationPolicy,
      }
    : { view: "detail", referral: row, continuationPolicy };

  // One state per value-bearing path the returned data carries: the narrow projection holds no
  // deadline, so its paths are not described here.
  const states: Record<string, RecordedValueState> = {};
  markOptional(
    states,
    `${row.referralId}.originalIntroductionOn`,
    row.originalIntroductionOn !== null,
  );
  markOptional(states, `${row.referralId}.windowStart`, row.windowStart !== null);
  markOptional(states, `${row.referralId}.windowEnd`, row.windowEnd !== null);
  markOptional(states, `${row.referralId}.sourceReference`, row.sourceReference !== null);
  if (!expired) {
    markOptional(states, `${row.referralId}.deadline`, row.deadline !== null);
    markOptional(
      states,
      `${row.referralId}.deadline.nominal`,
      row.deadline !== null && row.deadline.nominal !== null,
    );
    markOptional(
      states,
      `${row.referralId}.deadline.resolvedOn`,
      row.deadline !== null && row.deadline.resolvedOn !== null,
    );
    markOptional(states, `${row.referralId}.successorId`, row.successorId !== null);
    markOptional(states, `${row.referralId}.predecessorId`, row.predecessorId !== null);
  }

  const actions: readonly ReadAction[] = row.continuation.available
    ? [{ name: "continueReferral", available: true }]
    : [];

  return {
    kind: "envelope",
    envelope: buildEnvelope({
      data,
      scope,
      // The store answered this read, so the source is the local store named by its fixed family
      // marker, an opaque reference and never the session credential that opened the store. The
      // record's own source reference still travels in the row, where a reader can see which system
      // the referral came from.
      source: { system: LOCAL_STORE_SYSTEM, reference: OUTREACH_SOURCE_REFERENCE },
      revision: row.revision,
      asOf: now.toString(),
      coverage: completeCoverage(row.originalIntroductionOn, latestResolvedDay([row])),
      valueStates: states,
      actions,
    }),
  };
}
