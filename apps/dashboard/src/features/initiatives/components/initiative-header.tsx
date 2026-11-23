"use client";
import type { ReactElement } from "react";
import StatusBadge, { type StatusTone } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { ReadAction, ReadEnvelope, reads } from "@/modules/data-service";
import { CLOSURE_COPY, INITIATIVE_COPY, INITIATIVE_STATE_COPY, MEMBERSHIP_RULES_COPY, MEMBERSHIP_STATES, MEMBERSHIP_STATE_COPY, REQUESTED_TERMS_COPY, dispositionFallback, type MembershipState } from "../copy";
import { StatedInstant, TermFact } from "./figures";
type InitiativeEnvelope = Extract<Awaited<ReturnType<typeof reads.outreach.readInitiative>>, { readonly kind: "envelope" }>["envelope"];
type InitiativeDetailData = InitiativeEnvelope["data"];
type InitiativeRowData = InitiativeDetailData["initiative"];
type InitiativeHeaderPayload = { readonly initiative: Pick<InitiativeRowData, "name" | "purpose" | "responsiblePrincipalId" | "period" | "state" | "lifecycle" | "closureDisposition" | "memberStates">; readonly nextWork: Pick<InitiativeDetailData["nextWork"], "total"> };
type InitiativeHeaderProps = { readonly envelope: ReadEnvelope<InitiativeHeaderPayload>; readonly onRequestClose?: () => void; readonly onRequestReopen?: () => void };
type InitiativeLifecycleAction = "closeInitiative" | "reopenInitiative";
type HeaderView = { readonly initiative: InitiativeHeaderPayload["initiative"]; readonly openWork: number | null };
function viewOf(envelope: ReadEnvelope<InitiativeHeaderPayload> | null | undefined): HeaderView | null {
  if (envelope === null || envelope === undefined) return null;
  const data: unknown = envelope.data;
  if (typeof data !== "object" || data === null) return null;
  const payload = data as { readonly initiative?: unknown; readonly nextWork?: unknown };
  const initiative = payload.initiative;
  if (typeof initiative !== "object" || initiative === null) return null;
  const nextWork = payload.nextWork;
  const total = typeof nextWork === "object" && nextWork !== null ? (nextWork as { readonly total?: unknown }).total : undefined;
  return { initiative: initiative as InitiativeHeaderPayload["initiative"], openWork: typeof total === "number" ? total : null };
}
const actionOf = (actions: readonly ReadAction[], name: InitiativeLifecycleAction): ReadAction | undefined => actions.find((action) => action.name === name);
type AbsentAction = { readonly labels: readonly string[]; readonly reason: string };
function absentActions(candidates: readonly { readonly label: string; readonly action: ReadAction | undefined }[]): readonly AbsentAction[] {
  const grouped: { labels: string[]; reason: string }[] = [];
  for (const candidate of candidates) {
    const { action, label } = candidate;
    if (action === undefined || action.available || action.reason === undefined) continue;
    const existing = grouped.find((entry) => entry.reason === action.reason);
    if (existing === undefined) {
      grouped.push({ labels: [label], reason: action.reason });
    } else {
      existing.labels.push(label);
    }
  }
  return grouped;
}
const toneOf = (state: InitiativeHeaderPayload["initiative"]["state"]): StatusTone => (state === "closed" ? "neutral" : "positive");
function PeriodValue({ period }: { readonly period: InitiativeRowData["period"] }): ReactElement {
  const from = period === null ? null : period.from;
  const to = period === null ? null : period.to;
  if (from === null && to === null) return <span className="text-muted-foreground">{REQUESTED_TERMS_COPY.notStated}</span>;
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
      {from === null ? <span className="text-muted-foreground">{REQUESTED_TERMS_COPY.notStated}</span> : <StatedInstant value={from} />}
      <span aria-hidden="true">–</span>
      {to === null ? <span className="text-muted-foreground">{REQUESTED_TERMS_COPY.notStated}</span> : <StatedInstant value={to} />}
    </span>
  );
}
const SCOPE_TERMS = { organization: "Organization", ministry: "Ministry", supportSubject: "Support subject" } as const;
const ScopeReference = ({ term, reference }: { readonly term: string; readonly reference: string }): ReactElement => (
  <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
    <dt className="shrink-0">{term}</dt>
    <dd className="min-w-0 break-all">
      <bdi className="mono-identifier">{reference}</bdi>
    </dd>
  </div>
);
function MembershipCount({ state, count }: { readonly state: MembershipState; readonly count: number }): ReactElement {
  const copy = MEMBERSHIP_STATE_COPY[state];
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{copy.label}</dt>
      <dd className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
        <span className="tabular-figures text-base font-medium">{count}</span>
        {count === 0 ? <span className="text-xs text-pretty text-muted-foreground">{copy.emptyNote}</span> : null}
      </dd>
    </div>
  );
}
export default function InitiativeHeader({ envelope, onRequestClose, onRequestReopen }: InitiativeHeaderProps): ReactElement | null {
  const view = viewOf(envelope);
  if (view === null) return null;
  const { initiative, openWork } = view;
  const closed = initiative.state === "closed";
  const reopened = initiative.lifecycle === "reopened";
  const ownsUnfinishedWork = openWork !== null && openWork > 0;
  const showsClosureNotes = (closed && ownsUnfinishedWork) || reopened;
  const disposition = initiative.closureDisposition === null ? REQUESTED_TERMS_COPY.notStated : dispositionFallback(initiative.closureDisposition);
  const closeAction = actionOf(envelope.actions, "closeInitiative");
  const reopenAction = actionOf(envelope.actions, "reopenInitiative");
  const offersClose = closeAction?.available === true && onRequestClose !== undefined;
  const offersReopen = reopenAction?.available === true && onRequestReopen !== undefined;
  const absent = absentActions([
    { label: CLOSURE_COPY.closeHeading, action: closeAction },
    { label: CLOSURE_COPY.reopenHeading, action: reopenAction },
  ]);
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          <h2 className="font-heading text-lg font-medium text-pretty break-words">{initiative.name}</h2>
        </CardTitle>
        <CardDescription className="text-pretty break-words">
          <span className="sr-only">{`${INITIATIVE_COPY.purposeLabel}: `}</span>
          {initiative.purpose}
        </CardDescription>
        <CardAction>
          <StatusBadge label={INITIATIVE_STATE_COPY[initiative.state].label} tone={toneOf(initiative.state)} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <TermFact term={INITIATIVE_COPY.responsibleLabel} value={<bdi className="mono-identifier break-all">{initiative.responsiblePrincipalId}</bdi>} />
          <TermFact term={INITIATIVE_COPY.periodLabel} value={<PeriodValue period={initiative.period} />} />
          {closed || initiative.closureDisposition !== null ? <TermFact term={CLOSURE_COPY.dispositionLabel} value={<bdi>{disposition}</bdi>} /> : null}
        </dl>
        {showsClosureNotes ? (
          <div className="flex flex-col gap-1.5 text-sm text-pretty text-muted-foreground">
            {closed && ownsUnfinishedWork ? <p>{CLOSURE_COPY.handoffNote}</p> : null} {reopened ? <p>{CLOSURE_COPY.historyPreservedNote}</p> : null}
          </div>
        ) : null}
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{INITIATIVE_COPY.membersHeading}</h3>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3">
            {MEMBERSHIP_STATES.map((state) => (
              <MembershipCount key={state} state={state} count={initiative.memberStates[state]} />
            ))}
          </dl>
          <p className="text-xs text-pretty text-muted-foreground">{MEMBERSHIP_RULES_COPY.notAsked}</p>
        </div>
        <Separator />
        <dl className="flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-4">
          <ScopeReference term={SCOPE_TERMS.organization} reference={envelope.scope.organizationId} />
          <ScopeReference term={SCOPE_TERMS.ministry} reference={envelope.scope.ministryId} />
          <ScopeReference term={SCOPE_TERMS.supportSubject} reference={envelope.scope.supportSubjectId} />
        </dl>
      </CardContent>
      {offersClose || offersReopen || absent.length > 0 ? (
        <CardFooter className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-col gap-2">
            {offersClose ? <p className="text-xs text-pretty text-muted-foreground">{CLOSURE_COPY.closeHelp}</p> : null}
            {absent.length === 0 ? null : (
              <Alert role={undefined} className="px-3 py-2">
                <AlertDescription>
                  <ul className="flex flex-col gap-0.5 text-xs">
                    {absent.map((entry) => (
                      <li key={entry.reason} className="text-pretty">
                        <span className="font-medium text-foreground">{entry.labels.join(", ")}</span>
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
