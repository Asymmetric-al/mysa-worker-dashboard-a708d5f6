"use client";

/**
 * The initiative detail header: who this initiative is, how it stands, and the exact authority the
 * page in front of the worker was read under.
 *
 * Plan items that put this file in scope: AAP 0.9.1 and 0.11.1 for `src/features/initiatives/**` and
 * the identity region of `/partners/initiatives/[initiativeId]`; AAP 0.10.1 family "Outreach
 * initiatives and Requests"; AAP 0.8.3 on the three membership states and on closing fencing new
 * solicitation; AAP 0.7.1 on the read envelope and on stating the scope wherever an action could
 * cross it.
 *
 * Every fact below is one the read already settled, and each stays separate from the others:
 *
 * - The initiative is its own identity. Its name and purpose are the record's, and the person
 *   accountable for it is the opaque principal reference the record stores. Nothing here resolves a
 *   name from an email address or matches a person by a display name, because equal-looking values
 *   establish neither identity nor authority.
 * - The period is the civil dates the payload carries, rendered as `<time dateTime>` with no clock,
 *   no arithmetic and no zone, so a display setting cannot rebase a planning window. An initiative
 *   that states no period says so in words rather than leaving an empty gap, because "no period set"
 *   and "period unknown" are different facts and only the first is true here.
 * - The state is `open` or `closed`, with its word from `../copy` and a tone chosen from that word's
 *   meaning; the badge never carries the state in colour alone. A closed initiative states the
 *   disposition it closed with, and says that closing fenced new solicitation without resolving the
 *   work someone still owns, so "closed" is never read as "everything finished".
 * - The three membership counts are the read's own totals for `included`, `removed` and `excluded`.
 *   They are never recomputed from an array here, never summed into one "members" number and never
 *   rendered as one another: the reviewed list, the history of a removal and a decision not to
 *   approach are three different things. Inclusion is also stated as *not* having asked.
 * - The scope line is `envelope.scope`: the organisation, the ministry and the support subject the
 *   data was actually read in, each as an opaque reference in isolation. It is stated here, above
 *   every tab, because this is the one region of the route where an action could cross a context.
 * - Closing and reopening are offered only where `envelope.actions` admits them by name. Permission
 *   is never inferred from the state, and where an action is absent the reason the read supplied is
 *   shown instead of a disabled control. The actions are advisory — the service re-checks scope,
 *   permission and revision on submit — so a trigger here only asks the route to open its own
 *   confirmation; no mutation, dialog or result is performed in this file.
 *
 * What it deliberately is not: this region states no financial fact and holds no field for a
 * capability this release defers (no amount, no pledge, no campaign, no send or schedule). It fetches
 * nothing, reads no clock, formats no money and owns no state. A denied read is never rendered by
 * the route in the first place, and the guard below renders nothing at all — no title, no count, no
 * existence hint — if it is reached with no payload.
 *
 * Accessibility and direction: the region heading is an `<h2>` under the route's `<h1>`; every fact
 * is a real `<dt>`/`<dd>` pair; every name, identifier and date is isolated in a `<bdi>` so a
 * right-to-left name or a leading-zero identifier cannot reorder its neighbours; spacing is logical
 * and everything wraps, so at 320 CSS px the region stacks into one column with no horizontal page
 * scroll; and the two triggers are installed `Button`s of at least 24×24 CSS px. Nothing animates,
 * nothing is draggable, and no colour carries a meaning on its own.
 *
 * Layering: this file sits in a feature, above `components` and the envelope contract. It imports no
 * other feature and never the store, and it reaches the service only for the types of the read it
 * renders.
 */

import type { ReactElement, ReactNode } from "react";

import StatusBadge, { type StatusTone } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { ReadAction, ReadEnvelope, reads } from "@/modules/data-service";

import {
  CLOSURE_COPY,
  INITIATIVE_COPY,
  INITIATIVE_STATE_COPY,
  MEMBERSHIP_RULES_COPY,
  MEMBERSHIP_STATES,
  MEMBERSHIP_STATE_COPY,
  REQUESTED_TERMS_COPY,
  dispositionFallback,
  type MembershipState,
} from "../copy";

// ---------------------------------------------------------------------------------------------
// The contract: the detail read's own types, narrowed to the fields this region renders
// ---------------------------------------------------------------------------------------------

/**
 * The envelope `reads.outreach.readInitiative` answers with.
 *
 * Taken from the read itself rather than restated, so a field this region renders cannot drift from
 * the payload that carries it: adding, renaming or retyping a field in the read fails to compile
 * here instead of leaving a header that reads a value the service no longer supplies.
 */
type InitiativeEnvelope = Extract<
  Awaited<ReturnType<typeof reads.outreach.readInitiative>>,
  { readonly kind: "envelope" }
>["envelope"];

/** Everything the initiative detail read returns. */
type InitiativeDetailData = InitiativeEnvelope["data"];

/** One initiative as its detail read presents it. */
type InitiativeRowData = InitiativeDetailData["initiative"];

/**
 * The part of the detail payload this region reads, and no more.
 *
 * Narrowing rather than restating keeps the field types the service's own while leaving the rest of
 * the detail (the working list page, the Requests, the history) to the components that own it. The
 * three membership counts arrive as counts, so no consumer of this component is tempted to derive
 * them from an array.
 */
interface InitiativeHeaderPayload {
  readonly initiative: Pick<
    InitiativeRowData,
    | "name"
    | "purpose"
    | "responsiblePrincipalId"
    | "period"
    | "state"
    | "lifecycle"
    | "closureDisposition"
    | "memberStates"
  >;
  readonly nextWork: Pick<InitiativeDetailData["nextWork"], "total">;
}

/** Props of {@link InitiativeHeader}. */
interface InitiativeHeaderProps {
  /**
   * The initiative detail envelope. Its `data` carries the record this region states, its `scope`
   * the authority the read ran under, and its `actions` the two lifecycle changes the caller may
   * ask for.
   */
  readonly envelope: ReadEnvelope<InitiativeHeaderPayload>;
  /**
   * Asks the route to open its own close confirmation. A request, never the change: the mutation,
   * the disposition and the handoff belong to the route's dialog, which re-checks everything.
   */
  readonly onRequestClose?: () => void;
  /** Asks the route to open its own reopen confirmation, on the same terms. */
  readonly onRequestReopen?: () => void;
}

/** The two lifecycle changes this region can ask for, by the names the read uses. */
type InitiativeLifecycleAction = "closeInitiative" | "reopenInitiative";

/**
 * The facts this region renders, once the payload has been guarded.
 *
 * `openWork` is the whole count of work the initiative still owns, or `null` when the payload states
 * none — never `0`, because a count that was not supplied is not an empty one.
 */
interface HeaderView {
  readonly initiative: InitiativeHeaderPayload["initiative"];
  readonly openWork: number | null;
}

// ---------------------------------------------------------------------------------------------
// Reading the payload defensively
// ---------------------------------------------------------------------------------------------

/**
 * The payload this region reads, or `null` when the envelope carries none.
 *
 * A denial is never handed to this component: the route renders the notice that belongs to it, and a
 * denial that reached a header would have to state a title or a count to say anything. The guard
 * therefore reads the two levels that a caller in plain JavaScript can still get wrong and answers
 * `null`, so nothing about a record — not its name, not a count, not that it exists — can be
 * printed from an envelope with no payload in it.
 */
function viewOf(
  envelope: ReadEnvelope<InitiativeHeaderPayload> | null | undefined,
): HeaderView | null {
  if (envelope === null || envelope === undefined) {
    return null;
  }
  const data: unknown = envelope.data;
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const payload = data as { readonly initiative?: unknown; readonly nextWork?: unknown };
  const initiative = payload.initiative;
  if (typeof initiative !== "object" || initiative === null) {
    return null;
  }
  const nextWork = payload.nextWork;
  const total =
    typeof nextWork === "object" && nextWork !== null
      ? (nextWork as { readonly total?: unknown }).total
      : undefined;

  return {
    initiative: initiative as InitiativeHeaderPayload["initiative"],
    openWork: typeof total === "number" ? total : null,
  };
}

/**
 * The one action of the read that carries this name, or `undefined` when the read does not list it.
 *
 * Looked up by the name the service itself uses, so a permission question is never answered from the
 * initiative's state: an initiative can be open for one caller and closed for another, and the read
 * is the only thing that knows which.
 */
function actionOf(
  actions: readonly ReadAction[],
  name: InitiativeLifecycleAction,
): ReadAction | undefined {
  return actions.find((action) => action.name === name);
}

/** One reason the read gave for not offering a lifecycle change, and every change it applies to. */
interface AbsentAction {
  readonly labels: readonly string[];
  readonly reason: string;
}

/**
 * The reasons the read gave for the lifecycle changes it does not offer, one entry per distinct
 * reason.
 *
 * A caller who may not change this initiative at all gets the same reason back for both changes, and
 * printing it twice would read as two separate refusals. Grouping by the reason keeps the read as the
 * only author of the sentence: this function never writes a reason of its own, and a change the read
 * omitted altogether is not reported here at all.
 */
function absentActions(
  candidates: readonly { readonly label: string; readonly action: ReadAction | undefined }[],
): readonly AbsentAction[] {
  const grouped: { labels: string[]; reason: string }[] = [];
  for (const candidate of candidates) {
    const { action, label } = candidate;
    if (action === undefined || action.available || action.reason === undefined) {
      continue;
    }
    const existing = grouped.find((entry) => entry.reason === action.reason);
    if (existing === undefined) {
      grouped.push({ labels: [label], reason: action.reason });
    } else {
      existing.labels.push(label);
    }
  }
  return grouped;
}

/**
 * The tone the initiative's own state carries.
 *
 * The word always states the state; the tone only reinforces it, and `open` reads as the active,
 * soliciting state while `closed` reads as the quiet one. Neither is a judgement about the work.
 */
function toneOf(state: InitiativeHeaderPayload["initiative"]["state"]): StatusTone {
  return state === "closed" ? "neutral" : "positive";
}

// ---------------------------------------------------------------------------------------------
// The small presentational pieces this region composes
// ---------------------------------------------------------------------------------------------

/**
 * One labelled fact: a real `<dt>`/`<dd>` pair inside the definition list, never two styled divs.
 *
 * The term is muted and the value keeps the foreground colour, so a reader scanning the grid reads
 * the values and the labels stay available to a screen reader as the label of its value.
 */
function Fact({
  term,
  children,
}: {
  readonly term: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/**
 * One civil date, exactly as the payload carries it.
 *
 * The stored `YYYY-MM-DD` string is both the visible text and the `<time dateTime>` value: nothing
 * parses it, formats it, converts a zone or adds a day, so the day the record states is the day the
 * reader sees. `<bdi>` keeps it whole beside a right-to-left neighbour, and the tabular figures keep
 * two dates aligned.
 */
function CivilDate({ value }: { readonly value: string }): ReactElement {
  return (
    <bdi>
      <time className="tabular-figures" dateTime={value}>
        {value}
      </time>
    </bdi>
  );
}

/**
 * The planning period the initiative states, or the words for a period it states none.
 *
 * A period may name a start, an end, both or neither, and each case is rendered as it stands: an
 * end the record does not state reads "Not stated" rather than borrowing today's date or the other
 * boundary. A period object with neither boundary is the same fact as no period object at all, so
 * both render the one absence sentence instead of an empty row.
 */
function PeriodValue({ period }: { readonly period: InitiativeRowData["period"] }): ReactElement {
  const from = period === null ? null : period.from;
  const to = period === null ? null : period.to;
  if (from === null && to === null) {
    return <span className="text-muted-foreground">{REQUESTED_TERMS_COPY.notStated}</span>;
  }
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
      {from === null ? (
        <span className="text-muted-foreground">{REQUESTED_TERMS_COPY.notStated}</span>
      ) : (
        <CivilDate value={from} />
      )}
      {/* The separator is punctuation, so it is left out of the spoken form; the term above says
          which two ends of one period the reader is hearing. */}
      <span aria-hidden="true">–</span>
      {to === null ? (
        <span className="text-muted-foreground">{REQUESTED_TERMS_COPY.notStated}</span>
      ) : (
        <CivilDate value={to} />
      )}
    </span>
  );
}

/**
 * The three terms of the scope line.
 *
 * `envelope.scope` carries three opaque references and a display name for none of them, so the terms
 * are the scope's own field names rather than a friendly label this file would have to invent. They
 * are the same words `components/context-indicator` shows for the same references, so one scope is
 * named one way across the application.
 */
const SCOPE_TERMS = {
  organization: "Organization",
  ministry: "Ministry",
  supportSubject: "Support subject",
} as const;

/**
 * One opaque reference from the scope, stated as a fact.
 *
 * It renders the reference itself and never a label resolved from it: equal-looking identifiers
 * establish nothing, and the scope's value is the authority the data was actually read under.
 */
function ScopeReference({
  term,
  reference,
}: {
  readonly term: string;
  readonly reference: string;
}): ReactElement {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
      <dt className="shrink-0">{term}</dt>
      <dd className="min-w-0 break-all">
        <bdi className="mono-identifier">{reference}</bdi>
      </dd>
    </div>
  );
}

/**
 * One membership state and the read's count for it.
 *
 * The count is the read's own total, printed with tabular figures so the three line up. A zero says
 * so in words beside it, so an empty list is never mistaken for a value the read could not supply.
 */
function MembershipCount({
  state,
  count,
}: {
  readonly state: MembershipState;
  readonly count: number;
}): ReactElement {
  const copy = MEMBERSHIP_STATE_COPY[state];
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{copy.label}</dt>
      <dd className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
        <span className="tabular-figures text-base font-medium">{count}</span>
        {count === 0 ? (
          <span className="text-xs text-pretty text-muted-foreground">{copy.emptyNote}</span>
        ) : null}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The region
// ---------------------------------------------------------------------------------------------

/**
 * The initiative detail header.
 *
 * Renders nothing when the envelope carries no payload, so a caller that reached this component
 * without a record cannot print a title, a count or an existence hint from it.
 */
export default function InitiativeHeader({
  envelope,
  onRequestClose,
  onRequestReopen,
}: InitiativeHeaderProps): ReactElement | null {
  const view = viewOf(envelope);
  if (view === null) {
    return null;
  }

  const { initiative, openWork } = view;
  const closed = initiative.state === "closed";
  const reopened = initiative.lifecycle === "reopened";
  const ownsUnfinishedWork = openWork !== null && openWork > 0;
  // A closed initiative states how it closed; a reopened one states the disposition a reopen
  // preserved, so the closure history is visible while the initiative is open again.
  const showsDisposition = closed || initiative.closureDisposition !== null;
  const showsClosureNotes = (closed && ownsUnfinishedWork) || reopened;
  const stateCopy = INITIATIVE_STATE_COPY[initiative.state];
  const disposition =
    initiative.closureDisposition === null
      ? REQUESTED_TERMS_COPY.notStated
      : dispositionFallback(initiative.closureDisposition);

  const closeAction = actionOf(envelope.actions, "closeInitiative");
  const reopenAction = actionOf(envelope.actions, "reopenInitiative");
  // `actions` is advisory and the service re-checks, but a trigger with no handler to call would be
  // a control that cannot act, so one is offered only when the read admits it *and* the route has
  // supplied the request it would make.
  const offersClose = closeAction?.available === true && onRequestClose !== undefined;
  const offersReopen = reopenAction?.available === true && onRequestReopen !== undefined;
  const absent = absentActions([
    { label: CLOSURE_COPY.closeHeading, action: closeAction },
    { label: CLOSURE_COPY.reopenHeading, action: reopenAction },
  ]);
  const hasFooter = offersClose || offersReopen || absent.length > 0;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          <h2 className="font-heading text-lg font-medium text-pretty break-words">
            {initiative.name}
          </h2>
        </CardTitle>
        <CardDescription className="text-pretty break-words">
          <span className="sr-only">{`${INITIATIVE_COPY.purposeLabel}: `}</span>
          {initiative.purpose}
        </CardDescription>
        <CardAction>
          <StatusBadge label={stateCopy.label} tone={toneOf(initiative.state)} />
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Fact term={INITIATIVE_COPY.responsibleLabel}>
            <bdi className="mono-identifier break-all">{initiative.responsiblePrincipalId}</bdi>
          </Fact>
          <Fact term={INITIATIVE_COPY.periodLabel}>
            <PeriodValue period={initiative.period} />
          </Fact>
          {showsDisposition ? (
            <Fact term={CLOSURE_COPY.dispositionLabel}>
              <bdi>{disposition}</bdi>
            </Fact>
          ) : null}
        </dl>

        {showsClosureNotes ? (
          <div className="flex flex-col gap-1.5 text-sm text-pretty text-muted-foreground">
            {closed && ownsUnfinishedWork ? <p>{CLOSURE_COPY.handoffNote}</p> : null}
            {reopened ? <p>{CLOSURE_COPY.historyPreservedNote}</p> : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{INITIATIVE_COPY.membersHeading}</h3>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3">
            {MEMBERSHIP_STATES.map((state) => (
              <MembershipCount key={state} state={state} count={initiative.memberStates[state]} />
            ))}
          </dl>
          <p className="text-xs text-pretty text-muted-foreground">
            {MEMBERSHIP_RULES_COPY.notAsked}
          </p>
        </div>

        <Separator />

        <dl className="flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-4">
          <ScopeReference
            term={SCOPE_TERMS.organization}
            reference={envelope.scope.organizationId}
          />
          <ScopeReference term={SCOPE_TERMS.ministry} reference={envelope.scope.ministryId} />
          <ScopeReference
            term={SCOPE_TERMS.supportSubject}
            reference={envelope.scope.supportSubjectId}
          />
        </dl>
      </CardContent>

      {hasFooter ? (
        <CardFooter className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-col gap-2">
            {offersClose ? (
              <p className="text-xs text-pretty text-muted-foreground">{CLOSURE_COPY.closeHelp}</p>
            ) : null}
            {absent.length === 0 ? null : (
              // A static explanation of why a change is not on offer, so `role="alert"` is left off
              // and the region announces nothing when it merely renders.
              <Alert role={undefined} className="px-3 py-2">
                <AlertDescription>
                  <ul className="flex flex-col gap-0.5 text-xs">
                    {absent.map((entry) => (
                      <li key={entry.reason} className="text-pretty">
                        <span className="font-medium text-foreground">
                          {entry.labels.join(", ")}
                        </span>
                        {` — ${entry.reason}`}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </div>
          {offersClose || offersReopen ? (
            <div className="flex flex-wrap items-center gap-2">
              {offersClose ? (
                <Button variant="outline" onClick={() => onRequestClose?.()}>
                  {CLOSURE_COPY.closeHeading}
                </Button>
              ) : null}
              {offersReopen ? (
                <Button variant="outline" onClick={() => onRequestReopen?.()}>
                  {CLOSURE_COPY.reopenHeading}
                </Button>
              ) : null}
            </div>
          ) : null}
        </CardFooter>
      ) : null}
    </Card>
  );
}
