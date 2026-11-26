"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useId, useMemo, useState, type ReactElement } from "react";
import ActionReview, { type MutationSubmit } from "@/components/action-review";
import FormField, { fieldErrorsFromInvalid, refusalSummary, type FieldErrorLookup } from "@/components/form-field";
import { PerItemResults, type PerItemResultState } from "@/components/operation-result";
import { RecordList, type RecordListColumnDef, type RecordListQueryState } from "@/components/record-list";
import { StateNotice } from "@/components/state-notice";
import StatusBadge, { statusBadgeProps, VALUE_STATE_WORDS, type StatusTone } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { countFormatOf } from "@/lib/count-format";
import { assertNever } from "@/lib/result";
import type { MutationInput, MutationOutcome, PerItemResult, ReadAction, ReadEnvelope, Scope, ValueState, reads } from "@/modules/data-service";
import { CLOSURE_COPY, INITIATIVE_COPY, MEMBERSHIP_RULES_COPY, MEMBERSHIP_STATES, MEMBERSHIP_STATE_COPY, REQUESTED_TERMS_COPY, STAGE_SELECTOR_COPY, STAGE_STATE_COPY, STATE_NOTICE_COPY, type MembershipState, type StageState } from "../copy";
import { useInitiative, type InitiativeReadWindow } from "../hooks/use-initiative";
import { invalidateInitiativeReads, useRemoveMember, useReturnMember, type NamedChange } from "../hooks/use-initiative-mutations";
import { MEMBER_ACTION_STATE, type RemoveMemberPayload } from "../schemas/member";
import CloseInitiativeDialog from "./close-initiative-dialog";
import { CountFigure, StatedInstant, TermFact } from "./figures";
import MemberPicker, { type MemberCandidate, type MemberCandidates } from "./member-picker";
import ReopenInitiativeDialog from "./reopen-initiative-dialog";
import StageSelector from "./stage-selector";
type DetailEnvelope = Extract<Awaited<ReturnType<typeof reads.outreach.readInitiative>>, { readonly kind: "envelope" }>["envelope"];
type InitiativeDetail = DetailEnvelope["data"];
type MemberRow = InitiativeDetail["workingList"]["items"][number];
type ValueStates = Readonly<Record<string, ValueState>>;
type MemberTask = "remove" | "return";
const SECTION_HEADING_TAG = { 2: "h2", 3: "h3" } as const;
const GROUP_HEADING_TAG = { 2: "h3", 3: "h4" } as const;
const GROUP_HEADING_LEVEL = { 2: 3, 3: 4 } as const;
type WorkingListHeadingLevel = keyof typeof SECTION_HEADING_TAG;
const SECTION_HEADING_SCALE: Readonly<Record<WorkingListHeadingLevel, string>> = { 2: "type-section-title", 3: "type-subsection-title" };
const GROUP_HEADING_SCALE: Readonly<Record<WorkingListHeadingLevel, string>> = { 2: "type-subsection-title", 3: "type-group-title" };
const NO_SORT: RecordListQueryState["sort"] = [];
const NO_COLUMNS_HIDDEN: RecordListQueryState["columnVisibility"] = {};
const WORKING_LIST_COPY = {
  partnerSingular: "partner",
  partnerPlural: "partners",
  countsNote: "Each group is counted separately so you can see who is active, removed, or ineligible.",
  partialPage: (shown: number, count: number): string => `Showing ${countFormatOf().format(shown)} of ${countFormatOf().format(count)} partners in this list.`,
  addedTerm: "Added",
  returnedTerm: "Returned",
  notReturned: "—",
  memberNoun: "partners",
  historyHeading: "History",
  noHistory: "No changes recorded yet.",
  recordedByTerm: "By",
  noReason: "No note added.",
  doneLabel: "Done",
  addRefusalTitle: "Adding partners isn’t available here",
  closureHeading: "Close or reopen initiative",
  unstatedRefusal: "This action isn’t available right now.",
  excludedNote: "Marked ineligible by your organization’s records and can’t be added here.",
  reviewDescription: "Confirm this working-list update below.",
  emptyTitle: "No partners on this working list yet",
  emptyBody: "Choose eligible partners below to build your working list for this initiative.",
  emptyAction: "Choose partners to add",
  listSuffix: "working list",
} as const;
const COLUMN_COPY = { partner: "Partner", state: "Status", stage: STAGE_SELECTOR_COPY.label, added: WORKING_LIST_COPY.addedTerm, returned: WORKING_LIST_COPY.returnedTerm } as const;
const REMOVE_COPY = {
  trigger: "Remove from working list",
  shortTrigger: "Remove",
  title: "Remove from working list?",
  description: "Removes this partner from the active working list while keeping all history and open tasks intact.",
  confirmLabel: "Remove partner",
  cancelLabel: "Keep on list",
  reasonLabel: "Reason",
  reasonDescription: "Optional note recorded in the initiative’s history (up to 500 characters).",
  perItemHeading: "Result",
} as const;
const RETURN_COPY = { trigger: "Return to working list", shortTrigger: "Return", title: "Return to working list?", confirmLabel: "Return partner", cancelLabel: "Cancel", perItemHeading: "Result" } as const;
const REMOVE_FIELD_LABELS: Readonly<Record<string, string>> = { initiativeId: "Initiative", memberId: "Working-list member", reason: REMOVE_COPY.reasonLabel };
const RETURN_FIELD_LABELS: Readonly<Record<string, string>> = { initiativeId: "Initiative", memberId: "Working-list member" };
const REMOVE_REASON_MAX_LENGTH = 500;
const STANDING_OUTCOMES: ReadonlySet<MutationOutcome["outcome"]> = new Set<MutationOutcome["outcome"]>(["accepted", "alreadyAccepted", "unchanged"]);
const MEMBERSHIP_TONE: Readonly<Record<MembershipState, StatusTone>> = { included: "positive", removed: "neutral", excluded: "caution" };
const STAGE_STATE_OF_READ: Readonly<Record<MemberRow["stageState"], StageState | null>> = { admitted: "recorded", retired: "retired", unrecorded: null };
const STAGE_STATE_TONE: Readonly<Record<StageState, StatusTone>> = { recorded: "neutral", retired: "caution", denied: "caution", unavailable: "danger" };
const countStateOf = (valueStates: ValueStates, state: MembershipState, count: number): ValueState => valueStates[`initiative.memberStates.${state}`] ?? (count === 0 ? "zero" : "value");
const returnedStateOf = (valueStates: ValueStates, member: MemberRow): ValueState => valueStates[`${member.memberId}.returnedAt`] ?? (member.returnedAt === null ? "unknown" : "value");
const memberRevisionOf = (member: MemberRow, expectedRevision: string): string => (member.revision.trim() === "" ? expectedRevision : member.revision);
const RefusalNote = ({ title, text }: { readonly title?: string; readonly text: string }): ReactElement => (
  <Alert role={undefined} className="px-3 py-2">
    {title === undefined ? null : <AlertTitle>{title}</AlertTitle>}
    <AlertDescription>{text}</AlertDescription>
  </Alert>
);
const PartnerFigure = ({ member }: { readonly member: MemberRow }): ReactElement => (
  <span className="flex min-w-0 flex-col gap-0.5">
    <bdi className="min-w-0 font-medium text-pretty wrap-anywhere">{member.partnerDisplayName}</bdi>
    <bdi className="mono-identifier min-w-0 break-all text-xs text-muted-foreground">{member.memberId}</bdi>
  </span>
);
const StateFigure = ({ member }: { readonly member: MemberRow }): ReactElement => <StatusBadge label={MEMBERSHIP_STATE_COPY[member.state].label} tone={MEMBERSHIP_TONE[member.state]} />;
function StageValue({ member, stageState, valueState }: { readonly member: MemberRow; readonly stageState: StageState | null; readonly valueState: ValueState }): ReactElement {
  switch (valueState) {
    case "value":
    case "zero":
    case "incomplete-subtotal":
      break;
    case "unknown":
      return <span className="text-muted-foreground">{REQUESTED_TERMS_COPY.notStated}</span>;
    case "withheld":
    case "unavailable":
      return <StatusBadge {...statusBadgeProps(VALUE_STATE_WORDS, valueState)} />;
    default:
      return assertNever(valueState, "Unhandled value state");
  }
  const stage = member.stage;
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
        <bdi className="min-w-0 wrap-anywhere">{stage === null ? REQUESTED_TERMS_COPY.notStated : stage}</bdi>
        {stageState === null ? null : <StatusBadge label={STAGE_STATE_COPY[stageState].label} tone={STAGE_STATE_TONE[stageState]} />}
      </span>
      {stageState === "retired" ? <span className="text-xs text-pretty text-muted-foreground">{STAGE_STATE_COPY.retired.description}</span> : null}
    </span>
  );
}
function MemberHistory({ entries }: { readonly entries: readonly MemberRow["history"][number][] }): ReactElement {
  const headingId = useId();
  if (entries.length === 0) return <p className="text-xs text-pretty text-muted-foreground">{WORKING_LIST_COPY.noHistory}</p>;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p {...{ id: headingId, className: "text-xs font-medium text-muted-foreground" }}>{WORKING_LIST_COPY.historyHeading}</p>
      <ul aria-labelledby={headingId} className="flex min-w-0 flex-col gap-1.5 text-xs">
        {entries.map((entry, index) => (
          <li key={`${entry.at}-${entry.state}-${String(index)}`} className="flex min-w-0 flex-col gap-0.5">
            <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <StatusBadge label={MEMBERSHIP_STATE_COPY[entry.state].label} tone={MEMBERSHIP_TONE[entry.state]} />
              <StatedInstant value={entry.at} />
            </p>
            <p className="min-w-0 text-pretty wrap-anywhere">{entry.reason ?? WORKING_LIST_COPY.noReason}</p>
            <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-muted-foreground">
              <span>{`${WORKING_LIST_COPY.recordedByTerm}:`}</span>
              <bdi className="mono-identifier break-all">{entry.byPrincipalId}</bdi>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
type MemberReview = { readonly memberId: string; readonly partnerDisplayName: string; readonly memberState: MembershipState; readonly memberRevision: string; readonly task: MemberTask };
type RowActionsProps = { readonly member: MemberRow; readonly expectedRevision: string; readonly removeAction: ReadAction | undefined; readonly returnAction: ReadAction | undefined; readonly onReview: (review: MemberReview) => void; readonly className?: string };
function RowActions({ member, expectedRevision, removeAction, returnAction, onReview, className }: RowActionsProps): ReactElement {
  const openReview = (task: MemberTask): void => onReview({ memberId: member.memberId, partnerDisplayName: member.partnerDisplayName, memberState: member.state, memberRevision: memberRevisionOf(member, expectedRevision), task });
  if (member.state === "excluded") return <p className={cn("max-w-56 text-xs text-pretty text-muted-foreground", className)}>{WORKING_LIST_COPY.excludedNote}</p>;
  const action = member.state === "included" ? removeAction : returnAction;
  if (action?.available !== true) return <p className={cn("max-w-56 text-xs text-pretty text-muted-foreground", className)}>{action?.reason ?? WORKING_LIST_COPY.unstatedRefusal}</p>;
  const task: MemberTask = member.state === "included" ? "remove" : "return";
  const copy = task === "remove" ? REMOVE_COPY : RETURN_COPY;
  return (
    <Button type="button" variant="outline" size="sm" className={className} onClick={() => openReview(task)}>
      {copy.shortTrigger}
      <span className="sr-only">
        {" "}
        <bdi>{member.partnerDisplayName}</bdi>
        {task === "remove" ? " from the working list" : " to the working list"}
      </span>
    </Button>
  );
}
interface MemberSurfaceContext {
  readonly initiativeId: string;
  readonly scope: Scope;
  readonly valueStates: ValueStates;
  readonly admittedStages: readonly string[];
  readonly stageAction: ReadAction | undefined;
  readonly expectedRevision: string;
  readonly onOutcome: ((outcome: MutationOutcome) => void) | undefined;
  readonly onCheckResult: () => void;
}
type StageCellProps = MemberSurfaceContext & { readonly member: MemberRow };
function StageCell({ initiativeId, member, scope, valueStates, admittedStages, stageAction, expectedRevision, onOutcome, onCheckResult }: StageCellProps): ReactElement {
  if (member.state !== "included") return <StageValue member={member} stageState={STAGE_STATE_OF_READ[member.stageState]} valueState={valueStates[`${member.memberId}.stage`] ?? "unknown"} />;
  return <StageSelector initiativeId={initiativeId} member={member} admittedStages={admittedStages} scope={scope} expectedRevision={memberRevisionOf(member, expectedRevision)} stageAction={stageAction} onOutcome={onOutcome} onCheckResult={onCheckResult} className="min-w-0" />;
}
function ReturnedFigure({ member, valueState }: { readonly member: MemberRow; readonly valueState: ValueState }): ReactElement {
  if (member.returnedAt !== null) return <StatedInstant value={member.returnedAt} />;
  switch (valueState) {
    case "withheld":
    case "unavailable":
      return <StatusBadge {...statusBadgeProps(VALUE_STATE_WORDS, valueState)} />;
    case "value":
    case "zero":
    case "incomplete-subtotal":
    case "unknown":
      return <span className="text-muted-foreground">{WORKING_LIST_COPY.notReturned}</span>;
    default:
      return assertNever(valueState, "Unhandled value state");
  }
}
type MemberSurfaceProps = MemberSurfaceContext & { readonly removeAction: ReadAction | undefined; readonly returnAction: ReadAction | undefined; readonly onReview: (review: MemberReview) => void };
const addedFigureOf = (member: MemberRow): ReactElement => (member.addedAt.trim() === "" ? <span className="text-muted-foreground">{REQUESTED_TERMS_COPY.notStated}</span> : <StatedInstant value={member.addedAt} />);
const returnedFigureOf = (member: MemberRow, valueStates: ValueStates): ReactElement => <ReturnedFigure member={member} valueState={returnedStateOf(valueStates, member)} />;
const stageCellOf = (member: MemberRow, surface: MemberSurfaceContext): ReactElement => (
  <StageCell initiativeId={surface.initiativeId} member={member} scope={surface.scope} valueStates={surface.valueStates} admittedStages={surface.admittedStages} stageAction={surface.stageAction} expectedRevision={surface.expectedRevision} onOutcome={surface.onOutcome} onCheckResult={surface.onCheckResult} />
);
const memberColumns = (surface: MemberSurfaceContext): ReadonlyArray<RecordListColumnDef<MemberRow>> => [
  { id: "partner", header: COLUMN_COPY.partner, enableSorting: false, enableHiding: false, cell: ({ row }) => <PartnerFigure member={row.original} /> },
  {
    id: "state",
    header: COLUMN_COPY.state,
    enableSorting: false,
    enableHiding: false,
    cell: ({ row }) => (
      <div className="flex min-w-0 flex-col gap-1.5">
        <StateFigure member={row.original} /> <MemberHistory entries={row.original.history} />
      </div>
    ),
  },
  { id: "stage", header: COLUMN_COPY.stage, enableSorting: false, cell: ({ row }) => stageCellOf(row.original, surface) },
  { id: "added", header: COLUMN_COPY.added, enableSorting: false, cell: ({ row }) => addedFigureOf(row.original) },
  { id: "returned", header: COLUMN_COPY.returned, enableSorting: false, cell: ({ row }) => returnedFigureOf(row.original, surface.valueStates) },
];
const MemberCardList = ({ surface, rows, label, className }: { readonly surface: MemberSurfaceProps; readonly rows: readonly MemberRow[]; readonly label: string; readonly className?: string }): ReactElement => (
  <div data-slot="working-list-members" className={cn("min-w-0", className)}>
    <ul aria-label={label} className="flex min-w-0 flex-col gap-3">
      {rows.map((member) => (
        <li key={member.memberId} className="flex min-w-0 flex-col gap-3 rounded-xl border border-border p-3">
          <PartnerFigure member={member} />
          <dl className="flex min-w-0 flex-col gap-1 text-sm">
            <TermFact term={COLUMN_COPY.state} value={<StateFigure member={member} />} />
            <TermFact term={COLUMN_COPY.stage} value={stageCellOf(member, surface)} />
            <TermFact term={COLUMN_COPY.added} value={addedFigureOf(member)} />
            <TermFact term={COLUMN_COPY.returned} value={returnedFigureOf(member, surface.valueStates)} />
          </dl>
          <MemberHistory entries={member.history} />
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <RowActions member={member} expectedRevision={surface.expectedRevision} removeAction={surface.removeAction} returnAction={surface.returnAction} onReview={surface.onReview} />
          </div>
        </li>
      ))}
    </ul>
  </div>
);
const isCounted = (state: ValueState): boolean => state === "value" || state === "zero" || state === "incomplete-subtotal";
const StatesSummary = ({ memberStates, valueStates }: { readonly memberStates: InitiativeDetail["initiative"]["memberStates"]; readonly valueStates: ValueStates }): ReactElement => (
  <div data-slot="working-list-states" className="flex min-w-0 flex-col gap-2">
    <ul className="flex min-w-0 flex-col gap-2">
      {MEMBERSHIP_STATES.map((state) => {
        const copy = MEMBERSHIP_STATE_COPY[state];
        const count = memberStates[state];
        const countState = countStateOf(valueStates, state, count);
        return (
          <li key={state} className="flex min-w-0 flex-col gap-0.5">
            <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <StatusBadge label={copy.label} tone={MEMBERSHIP_TONE[state]} />
              <span className="text-sm">
                <CountFigure count={count} state={countState} />
              </span>
              {isCounted(countState) && Number.isFinite(count) ? <span className="text-sm text-muted-foreground">{count === 1 ? WORKING_LIST_COPY.partnerSingular : WORKING_LIST_COPY.partnerPlural}</span> : null}
            </p>
            <p className="text-xs text-pretty text-muted-foreground">{copy.description}</p>
          </li>
        );
      })}
    </ul>
    <p className="text-xs text-pretty text-muted-foreground">{WORKING_LIST_COPY.countsNote}</p>
  </div>
);
const MembershipRules = (): ReactElement => (
  <div data-slot="working-list-rules" className="flex min-w-0 flex-col gap-1">
    <p className="text-sm text-pretty text-muted-foreground">{MEMBERSHIP_RULES_COPY.explicitSelectionOnly}</p>
    <ul className="flex min-w-0 flex-col gap-1 text-xs text-pretty text-muted-foreground">
      {[MEMBERSHIP_RULES_COPY.notAsked, MEMBERSHIP_RULES_COPY.notConsent, MEMBERSHIP_RULES_COPY.notAudienceMembership, MEMBERSHIP_RULES_COPY.removalPreservesHistory, MEMBERSHIP_RULES_COPY.returnRestoresEligiblePlanning].map((statement) => (
        <li key={statement}>{statement}</li>
      ))}
    </ul>
  </div>
);
type MutationDispatch<P> = (variables: NamedChange<P>, options: { readonly onSettled: (outcome: MutationOutcome | undefined) => void }) => void;
const submitThrough = <P,>(dispatch: MutationDispatch<P>, input: MutationInput<P>): Promise<MutationOutcome> =>
  new Promise<MutationOutcome>((resolve) => dispatch({ operationId: input.operationId, expectedRevision: input.expectedRevision, payload: input.payload }, { onSettled: (outcome) => resolve(outcome ?? { outcome: "unknown", operationId: input.operationId }) }));
const PER_ITEM_STATE_OF_OUTCOME: Readonly<Record<MutationOutcome["outcome"], PerItemResultState>> = { accepted: "accepted", alreadyAccepted: "accepted", unchanged: "unchanged", conflict: "failed", denied: "failed", invalid: "failed", unavailable: "failed", unknown: "failed" };
const namedMemberOf = (outcome: MutationOutcome, memberId: string): string => (outcome.outcome !== "accepted" && outcome.outcome !== "alreadyAccepted" ? memberId : ([...(outcome.changed ?? []), ...(outcome.created ?? [])].find((id) => id.trim() !== "") ?? memberId));
function statedReasonOf(outcome: MutationOutcome): string | undefined {
  switch (outcome.outcome) {
    case "unavailable":
      return outcome.guidance;
    case "denied":
      return outcome.reasonCode;
    case "conflict":
      return outcome.reason;
    case "accepted":
    case "alreadyAccepted":
    case "unchanged":
    case "invalid":
    case "unknown":
      return undefined;
    default:
      return assertNever(outcome, "Unhandled mutation outcome");
  }
}
function memberResultRows(outcome: MutationOutcome | null, memberId: string): readonly PerItemResult[] {
  if (outcome === null) return [];
  if ((outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted") && (outcome.items ?? []).length > 0) return outcome.items ?? [];
  const reason = statedReasonOf(outcome);
  return [{ targetId: namedMemberOf(outcome, memberId), state: PER_ITEM_STATE_OF_OUTCOME[outcome.outcome], ...(reason === undefined ? {} : { reason }) }];
}
type MemberReviewDialogProps = { readonly review: MemberReview; readonly initiativeId: string; readonly scope: Scope; readonly onChanged: ((outcome: MutationOutcome) => void) | undefined; readonly onCheckResult: () => void; readonly onClose: () => void };
function MemberReviewBody({ review, initiativeId, scope, onChanged, onCheckResult, onClose }: MemberReviewDialogProps): ReactElement {
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FieldErrorLookup | null>(null);
  const [settled, setSettled] = useState<MutationOutcome | null>(null);
  const remove = useRemoveMember(scope);
  const restore = useReturnMember(scope);
  const removing = review.task === "remove";
  const dispatch: MutationDispatch<RemoveMemberPayload> = removing ? remove.submit : restore.submit;
  const submit = useCallback<MutationSubmit<RemoveMemberPayload>>((input) => submitThrough(dispatch, input), [dispatch]);
  const payload = useMemo<RemoveMemberPayload>(() => (removing && reason.trim() !== "" ? { initiativeId, memberId: review.memberId, reason: reason.trim() } : { initiativeId, memberId: review.memberId }), [initiativeId, removing, review.memberId, reason]);
  const input = useMemo(() => ({ scope, expectedRevision: review.memberRevision, payload }), [scope, review.memberRevision, payload]);
  const perItemRows = useMemo<readonly PerItemResult[]>(() => memberResultRows(settled, review.memberId), [settled, review.memberId]);
  const resultingState: MembershipState | null = settled !== null && STANDING_OUTCOMES.has(settled.outcome) ? MEMBER_ACTION_STATE[review.task] : null;
  const settle = useCallback(
    (outcome: MutationOutcome): void => {
      setSettled(outcome);
      setErrors(outcome.outcome === "invalid" ? fieldErrorsFromInvalid(outcome) : null);
      if (STANDING_OUTCOMES.has(outcome.outcome)) onChanged?.(outcome);
    },
    [onChanged],
  );
  const taskCopy = removing ? REMOVE_COPY : RETURN_COPY;
  const memberName = <bdi className="min-w-0 wrap-anywhere">{review.partnerDisplayName}</bdi>;
  const reviewProps = { headingLevel: 4, onCancel: onClose, onSettled: settle, checkResult: onCheckResult } as const;
  const descriptionOf = (lead: string, statements: readonly string[]): ReactElement => (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
        <span className="font-medium text-foreground">{memberName}</span>
        <span>{lead}</span>
      </p>
      {statements.map((statement) => (
        <p key={statement}>{statement}</p>
      ))}
    </div>
  );
  const description = removing
    ? descriptionOf(MEMBERSHIP_STATE_COPY[review.memberState].description, [MEMBERSHIP_RULES_COPY.removalPreservesHistory, MEMBERSHIP_RULES_COPY.returnRestoresEligiblePlanning])
    : descriptionOf(MEMBERSHIP_RULES_COPY.returnRestoresEligiblePlanning, [MEMBERSHIP_RULES_COPY.removalPreservesHistory]);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-3">
        {removing ? <p className="text-sm text-pretty text-muted-foreground">{REMOVE_COPY.description}</p> : null}
        {removing ? (
          <FormField name={`remove-reason-${review.memberId}`} label={REMOVE_COPY.reasonLabel} description={REMOVE_COPY.reasonDescription} optionalHint error={errors?.byField.reason}>
            {(field) => <Textarea id={field.id} name="reason" rows={2} maxLength={REMOVE_REASON_MAX_LENGTH} value={reason} aria-describedby={field.describedBy} aria-invalid={field.invalid ? true : undefined} onChange={(event) => setReason(event.target.value)} />}
          </FormField>
        ) : null}
        <ActionReview<RemoveMemberPayload> {...reviewProps} title={taskCopy.title} description={description} confirmLabel={taskCopy.confirmLabel} cancelLabel={taskCopy.cancelLabel} input={input} submit={submit} fieldLabels={removing ? REMOVE_FIELD_LABELS : RETURN_FIELD_LABELS} />
      </div>
      {perItemRows.length === 0 ? null : (
        <PerItemResults
          heading={taskCopy.perItemHeading}
          items={perItemRows}
          renderItemAction={() => (
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-sm">
              {memberName} {resultingState === null ? null : <StatusBadge label={MEMBERSHIP_STATE_COPY[resultingState].label} tone={MEMBERSHIP_TONE[resultingState]} />}
            </span>
          )}
        />
      )}
      {settled === null ? null : (
        <DialogFooter>
          <Button {...{ type: "button", variant: "outline", size: "sm", onClick: onClose }}>{WORKING_LIST_COPY.doneLabel}</Button>
        </DialogFooter>
      )}
    </div>
  );
}
function MemberReviewDialog({ review, initiativeId, scope, onChanged, onCheckResult, onClose }: MemberReviewDialogProps): ReactElement {
  const title = review.task === "remove" ? REMOVE_COPY.trigger : RETURN_COPY.trigger;
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent data-slot="working-list-review">
        <DialogHeader>
          <DialogTitle>
            {title}
            {": "}
            <bdi>{review.partnerDisplayName}</bdi>
          </DialogTitle>
          <DialogDescription>{WORKING_LIST_COPY.reviewDescription}</DialogDescription>
        </DialogHeader>
        <MemberReviewBody review={review} initiativeId={initiativeId} scope={scope} onChanged={onChanged} onCheckResult={onCheckResult} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}
interface ClosureControlProps {
  readonly initiativeId: string;
  readonly envelope: ReadEnvelope<InitiativeDetail>;
  readonly closeAction: ReadAction | undefined;
  readonly reopenAction: ReadAction | undefined;
  readonly level: WorkingListHeadingLevel;
  readonly onChanged: ((outcome: MutationOutcome) => void) | undefined;
  readonly onCheckResult: () => void;
}
function ClosureControl({ initiativeId, envelope, closeAction, reopenAction, level, onChanged, onCheckResult }: ClosureControlProps): ReactElement {
  const headingId = useId();
  const [dialog, setDialog] = useState<"close" | "reopen" | null>(null);
  const Heading = GROUP_HEADING_TAG[level];
  const offersClose = closeAction?.available === true;
  const offersReopen = reopenAction?.available === true;
  return (
    <section aria-labelledby={headingId} data-slot="working-list-closure" className="flex min-w-0 flex-col gap-3">
      <Heading {...{ id: headingId, className: cn(GROUP_HEADING_SCALE[level], "text-pretty") }}>{WORKING_LIST_COPY.closureHeading}</Heading>
      <div className="flex min-w-0 flex-col gap-1 text-sm text-pretty text-muted-foreground">
        <p>{CLOSURE_COPY.closeHelp}</p>
        <p>{CLOSURE_COPY.historyPreservedNote}</p>
        <p>{CLOSURE_COPY.lateResponseNote}</p>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {offersClose ? <Button {...{ type: "button", variant: "outline", size: "sm", onClick: () => setDialog("close") }}>{CLOSURE_COPY.closeHeading}</Button> : null}
        {offersReopen ? <Button {...{ type: "button", variant: "outline", size: "sm", onClick: () => setDialog("reopen") }}>{CLOSURE_COPY.reopenHeading}</Button> : null}
      </div>
      {offersClose ? null : <RefusalNote title={CLOSURE_COPY.closeHeading} text={closeAction?.reason ?? WORKING_LIST_COPY.unstatedRefusal} />}
      {offersReopen ? null : <RefusalNote title={CLOSURE_COPY.reopenHeading} text={reopenAction?.reason ?? WORKING_LIST_COPY.unstatedRefusal} />}
      <CloseInitiativeDialog open={dialog === "close"} onOpenChange={(open) => setDialog(open ? "close" : null)} initiativeId={initiativeId} envelope={envelope} onClosed={onChanged} onCheckResult={onCheckResult} />
      <ReopenInitiativeDialog open={dialog === "reopen"} onOpenChange={(open) => setDialog(open ? "reopen" : null)} initiativeId={initiativeId} envelope={envelope} onReopened={onCheckResult} />
    </section>
  );
}
interface WorkingListBodyProps {
  readonly initiativeId: string;
  readonly envelope: ReadEnvelope<InitiativeDetail>;
  readonly candidates: readonly MemberCandidate[] | MemberCandidates;
  readonly onChanged: ((outcome: MutationOutcome) => void) | undefined;
  readonly onWindowChange: ((change: InitiativeReadWindow) => void) | undefined;
  readonly onCheckResult: () => void;
  readonly level: WorkingListHeadingLevel;
}
function WorkingListBody({ initiativeId, envelope, candidates, onChanged, onWindowChange, onCheckResult, level }: WorkingListBodyProps): ReactElement {
  const { data, valueStates, scope, revision, actions } = envelope;
  const [review, setReview] = useState<MemberReview | null>(null);
  const [columnVisibility, setColumnVisibility] = useState<RecordListQueryState["columnVisibility"]>(NO_COLUMNS_HIDDEN);
  const admittedStages = useMemo<readonly string[]>(() => data.stages.filter((option) => option.admitted).map((option) => option.value), [data.stages]);
  const closeReview = useCallback((): void => setReview(null), []);
  const actionOf = (name: string): ReadAction | undefined => actions.find((action) => action.name === name);
  const addAction = actionOf("addMembers");
  const removeAction = actionOf("removeMember");
  const returnAction = actionOf("returnMember");
  const stageAction = actionOf("setStage");
  const closeAction = actionOf("closeInitiative");
  const reopenAction = actionOf("reopenInitiative");
  const rows = data.workingList.items;
  const total = data.workingList.total;
  const listQueryState = useMemo<RecordListQueryState>(() => ({ sort: NO_SORT, page: data.workingList.page, pageSize: data.workingList.pageSize, columnVisibility }), [data.workingList.page, data.workingList.pageSize, columnVisibility]);
  const surface = useMemo<MemberSurfaceProps>(
    () => ({ initiativeId, scope, valueStates, admittedStages, stageAction, expectedRevision: revision, onOutcome: onChanged, onCheckResult, removeAction, returnAction, onReview: setReview }),
    [initiativeId, scope, valueStates, admittedStages, stageAction, revision, onChanged, onCheckResult, removeAction, returnAction],
  );
  const columns = useMemo<ReadonlyArray<RecordListColumnDef<MemberRow>>>(() => memberColumns(surface), [surface]);
  const rowActionsOf = (row: MemberRow): ReactElement => <RowActions member={row} expectedRevision={revision} removeAction={removeAction} returnAction={returnAction} onReview={setReview} />;
  const listLabel = `${INITIATIVE_COPY.membersHeading} for ${data.initiative.name}, ${WORKING_LIST_COPY.listSuffix}`;
  function handleQueryStateChange(next: RecordListQueryState): void {
    if (next.columnVisibility !== columnVisibility) setColumnVisibility(next.columnVisibility);
    // The read's own `page`/`pageSize` are what a pager change states: this list is one page of its whole result, so the window the read is asked under moves rather than a slice of the answer held here.
    if (next.page !== data.workingList.page || next.pageSize !== data.workingList.pageSize) onWindowChange?.({ page: next.page, pageSize: next.pageSize });
  }
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <MembershipRules />
      {total === 0 ? null : <StatesSummary memberStates={data.initiative.memberStates} valueStates={valueStates} />}
      {total === 0 ? (
        <StateNotice kind="empty" headingLevel={GROUP_HEADING_LEVEL[level]} title={WORKING_LIST_COPY.emptyTitle} description={WORKING_LIST_COPY.emptyBody} action={{ label: WORKING_LIST_COPY.emptyAction, href: "#working-list-add" }} />
      ) : (
        <>
          <div className="hidden min-w-0 md:block">
            <RecordList label={listLabel} columns={columns} rows={rows} rowCount={total} queryState={listQueryState} onQueryStateChange={handleQueryStateChange} getRowId={(row) => row.memberId} rowActions={rowActionsOf} itemNoun={WORKING_LIST_COPY.memberNoun} pageSizeOptions={[data.workingList.pageSize]} />
          </div>
          <MemberCardList surface={surface} rows={rows} label={listLabel} className="md:hidden" />
          {rows.length < total ? <p className="text-xs text-pretty text-muted-foreground">{WORKING_LIST_COPY.partialPage(rows.length, total)}</p> : null}
        </>
      )}
      {review === null ? null : <MemberReviewDialog review={review} initiativeId={initiativeId} scope={scope} onChanged={onChanged} onCheckResult={onCheckResult} onClose={closeReview} />}
      <Separator />
      <div id="working-list-add" className="min-w-0 scroll-mt-24">
        {addAction?.available === true ? (
          <MemberPicker initiativeId={initiativeId} candidates={candidates} scope={scope} expectedRevision={revision} onAdded={onChanged} headingLevel={GROUP_HEADING_LEVEL[level]} className="min-w-0" />
        ) : (
          <RefusalNote title={WORKING_LIST_COPY.addRefusalTitle} text={addAction?.reason ?? WORKING_LIST_COPY.unstatedRefusal} />
        )}
      </div>
      <Separator />
      <ClosureControl initiativeId={initiativeId} envelope={envelope} closeAction={closeAction} reopenAction={reopenAction} level={level} onChanged={onChanged} onCheckResult={onCheckResult} />
    </div>
  );
}
/** The heading level this section renders at; its groups, cards and closure section render one level deeper. */ export type WorkingListProps = {
  readonly initiativeId: string;
  readonly envelope: ReadEnvelope<InitiativeDetail>;
  readonly candidates: readonly MemberCandidate[] | MemberCandidates;
  readonly onChanged?: (outcome: MutationOutcome) => void;
  readonly readWindow?: InitiativeReadWindow;
  readonly onWindowChange?: (change: InitiativeReadWindow) => void;
  readonly headingLevel?: WorkingListHeadingLevel;
  readonly className?: string;
};
/** The reviewed working list of one initiative. */ export default function WorkingList({ initiativeId, envelope, candidates, onChanged, readWindow, onWindowChange, headingLevel = 3, className }: WorkingListProps): ReactElement {
  const headingId = useId();
  // The composing detail read's window travels here so this section re-reads the same record under the same window — one cache entry for one read — rather than a second entry of the same initiative whose own lists sit on a different page.
  const query = useInitiative<InitiativeDetail>(initiativeId, envelope, readWindow);
  const queryClient = useQueryClient();
  const checkResult = useCallback((): void => void invalidateInitiativeReads(queryClient, envelope.scope), [queryClient, envelope.scope]);
  const result = query.status === "ready" ? query.result : undefined;
  const refusal: Exclude<Awaited<ReturnType<typeof reads.outreach.readInitiative>>, { readonly kind: "envelope" }> | undefined = result !== undefined && result.kind !== "envelope" ? result : undefined;
  const Heading = SECTION_HEADING_TAG[headingLevel];
  return (
    <section aria-labelledby={headingId} data-slot="working-list" className={cn("flex min-w-0 flex-col gap-4 text-start", className)}>
      <Heading {...{ id: headingId, className: cn(SECTION_HEADING_SCALE[headingLevel], "text-pretty") }}>{INITIATIVE_COPY.membersHeading}</Heading>
      {refusal === undefined ? (
        <WorkingListBody initiativeId={initiativeId} envelope={result !== undefined && result.kind === "envelope" ? result.envelope : envelope} candidates={candidates} onChanged={onChanged} onWindowChange={onWindowChange} onCheckResult={checkResult} level={headingLevel} />
      ) : refusal.kind === "denied" ? (
        <StateNotice kind="denied" headingLevel={headingLevel} title={STATE_NOTICE_COPY.denied.title} description={STATE_NOTICE_COPY.denied.body} reasonCode={refusal.denied.reasonCode} />
      ) : refusal.kind === "refused" ? (
        <StateNotice kind="refused" headingLevel={headingLevel} title={STATE_NOTICE_COPY.refused.title} description={refusalSummary(refusal.refused)} />
      ) : (
        <StateNotice kind="unavailable" headingLevel={headingLevel} title={STATE_NOTICE_COPY.unavailable.title} description={refusal.unavailable.guidance} source={refusal.unavailable.source} retry={{ label: STATE_NOTICE_COPY.unavailable.actionLabel ?? "Try again", onClick: checkResult }} />
      )}
    </section>
  );
}
