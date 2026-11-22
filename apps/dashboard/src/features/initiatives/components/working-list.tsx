"use client";
/**
 * The reviewed working list of one initiative: the three membership states the read returns, each
 * partner's stage, dates and recorded history, and the one change their state admits — reviewed before
 * it is accepted, then reported for that partner alone. The family's list preset renders the rows below
 * its own scroll region; a labelled card list carries the same facts and the same actions beneath it, so
 * a phone reads the list in the same order without the page ever scrolling sideways.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useId, useMemo, useState, type ReactElement, type ReactNode } from "react";
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
import { assertNever } from "@/lib/result";
import type { MutationOutcome, PerItemResult, ReadAction, ReadEnvelope, Scope, ValueState, reads } from "@/modules/data-service";
import { CLOSURE_COPY, INITIATIVE_COPY, MEMBERSHIP_RULES_COPY, MEMBERSHIP_STATES, MEMBERSHIP_STATE_COPY, REQUESTED_TERMS_COPY, STAGE_SELECTOR_COPY, STAGE_STATE_COPY, STATE_NOTICE_COPY, type MembershipState, type StageState } from "../copy";
import { useInitiative, type InitiativeReadWindow } from "../hooks/use-initiative";
import { invalidateInitiativeReads, useRemoveMember, useReturnMember, type RemoveMemberVariables, type ReturnMemberVariables } from "../hooks/use-initiative-mutations";
import { MEMBER_ACTION_STATE, type RemoveMemberPayload, type ReturnMemberPayload } from "../schemas/member";
import CloseInitiativeDialog from "./close-initiative-dialog";
import MemberPicker, { type MemberCandidate, type MemberCandidates } from "./member-picker";
import ReopenInitiativeDialog from "./reopen-initiative-dialog";
import StageSelector from "./stage-selector";

// The contract: the detail read's own types, so every fact below is the read's and not a shape this
// file invented.
type DetailEnvelope = Extract<Awaited<ReturnType<typeof reads.outreach.readInitiative>>, { readonly kind: "envelope" }>["envelope"];

type InitiativeDetail = DetailEnvelope["data"];

type MemberRow = InitiativeDetail["workingList"]["items"][number];

type MemberHistoryEntry = MemberRow["history"][number];

type ValueStates = Readonly<Record<string, ValueState>>;

/** A refusal this family's own read can answer with, as the browser re-read hands it back. */
type DetailRefusal = Exclude<Awaited<ReturnType<typeof reads.outreach.readInitiative>>, { readonly kind: "envelope" }>;

/** The one change a member row admits, named once for the row, the review and the result it produces. */
type MemberTask = "remove" | "return";

/** The heading levels a composing page can ask this section for, and the level its groups render at. */
const SECTION_HEADING_TAG = { 2: "h2", 3: "h3" } as const;

const GROUP_HEADING_TAG = { 2: "h3", 3: "h4" } as const;

const GROUP_HEADING_LEVEL = { 2: 3, 3: 4 } as const;

type WorkingListHeadingLevel = keyof typeof SECTION_HEADING_TAG;

const COUNT_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

// The whole-result window this surface renders
const NO_SORT: RecordListQueryState["sort"] = [];

const NO_COLUMNS_HIDDEN: RecordListQueryState["columnVisibility"] = {};

// Wording this surface alone states
/** `../copy.ts` owns this family's shared vocabulary — the three membership states, the statements about what inclusion is not, the stage and closure wording — and every sentence here is particular to this list. */
const WORKING_LIST_COPY = {
  partnerSingular: "partner",
  partnerPlural: "partners",
  countsNote: "Each state is counted on its own: nothing here is summed, and no state stands in for another.",
  partialPage: (shown: number, count: number): string => `This page of the read carries ${COUNT_FORMAT.format(shown)} of the ${COUNT_FORMAT.format(count)} partners in this state.`,
  addedTerm: "Added",
  returnedTerm: "Returned",
  notReturned: "Not returned",
  memberNoun: "working-list members",
  historyHeading: "Recorded history",
  noHistory: "No state change is recorded for this partner.",
  recordedByTerm: "Recorded by",
  noReason: "No reason was recorded for this state change.",
  doneLabel: "Done",
  addRefusalTitle: "Adding partners is not on offer in this read",
  closureHeading: "Closing and reopening this initiative",
  unstatedRefusal: "The read that supplied this list states that this change is not on offer, without a reason of its own.",
  excludedNote: "A partner the source marks not eligible is never re-included from this surface: the reason in their history comes from the source, and no control here overrides it.",
  reviewDescription: "One change at a time, recorded against this member's own revision. The review below states what the change does and what it leaves untouched, and its result stays here afterwards.",
  emptyTitle: "No partners on the working list yet",
  emptyBody: "Only partners you choose join this list, and each addition is reviewed before it is recorded. Choose from the eligible partners further down this page.",
  emptyAction: "Choose partners to add",
  listSuffix: "reviewed working list",
} as const;

/** The table's column headings, named once so the header row and the narrow card list state the same facts. */
const COLUMN_COPY = { partner: "Partner", state: "Membership state", stage: STAGE_SELECTOR_COPY.label, added: WORKING_LIST_COPY.addedTerm, returned: WORKING_LIST_COPY.returnedTerm } as const;

const REMOVE_COPY = {
  trigger: "Remove from the working list",
  shortTrigger: "Remove",
  title: "Review this removal",
  description: "Removing this partner takes them off the reviewed working list. Their history stays visible and every obligation recorded elsewhere is kept.",
  confirmLabel: "Remove this partner",
  cancelLabel: "Keep them on the list",
  reasonLabel: "Reason",
  reasonDescription: "Optional, up to 500 characters. The reason is recorded with the removal, so the history explains it later.",
  perItemHeading: "Result for this member",
} as const;

const RETURN_COPY = { trigger: "Return to the working list", shortTrigger: "Return", title: "Review this return", confirmLabel: "Return this partner", cancelLabel: "Leave them removed", perItemHeading: "Result for this member" } as const;

/** The field names a change carries, as the one field-error presentation reads them. */
const REMOVE_FIELD_LABELS: Readonly<Record<string, string>> = { initiativeId: "Initiative", memberId: "Working-list member", reason: REMOVE_COPY.reasonLabel };

const RETURN_FIELD_LABELS: Readonly<Record<string, string>> = { initiativeId: "Initiative", memberId: "Working-list member" };

/** The bound the service puts on a removal reason, so the field cannot produce a payload the service refuses. */
const REMOVE_REASON_MAX_LENGTH = 500;

/** The heading every review step inside a member's dialog renders at, below the section and its groups. */
const ROW_REVIEW_HEADING = 4;

/** The three outcomes that mean a change stands, so the caller is told about it. */
const STANDING_OUTCOMES: ReadonlySet<MutationOutcome["outcome"]> = new Set<MutationOutcome["outcome"]>(["accepted", "alreadyAccepted", "unchanged"]);

/** The tone each membership state's word carries; the word itself always says the state. */
const MEMBERSHIP_TONE: Readonly<Record<MembershipState, StatusTone>> = { included: "positive", removed: "neutral", excluded: "caution" };

/** The stage state a member row states, in this family's four-state vocabulary; `null` is "no stage recorded". */
const STAGE_STATE_OF_READ: Readonly<Record<MemberRow["stageState"], StageState | null>> = { admitted: "recorded", retired: "retired", unrecorded: null };

/** The tone each stage state's word carries. */
const STAGE_STATE_TONE: Readonly<Record<StageState, StatusTone>> = { recorded: "neutral", retired: "caution", denied: "caution", unavailable: "danger" };

/**
 * The value state the read recorded for one state's count. Where it states no entry, the count is still
 * the read's own enumeration of this initiative's complete list, so a zero is a recorded zero rather
 * than a gap and a populated count is a plain value.
 */
function countStateOf(valueStates: ValueStates, state: MembershipState, count: number): ValueState {
  return valueStates[`initiative.memberStates.${state}`] ?? (count === 0 ? "zero" : "value");
}

/** The state the read recorded for one member's stage, or `unknown` when it recorded none. */
function stageStateOf(valueStates: ValueStates, member: MemberRow): ValueState {
  return valueStates[`${member.memberId}.stage`] ?? "unknown";
}

/** The state the read recorded for one member's return instant. */
function returnedStateOf(valueStates: ValueStates, member: MemberRow): ValueState {
  return valueStates[`${member.memberId}.returnedAt`] ?? (member.returnedAt === null ? "unknown" : "value");
}

/** The revision a member change presents: the member record's own, with the envelope's only as the fallback for a row that states none. */
function memberRevisionOf(member: MemberRow, expectedRevision: string): string {
  return member.revision.trim() === "" ? expectedRevision : member.revision;
}

/** A count rendered from the value state the read recorded for it. */
function CountFigure({ count, state }: { readonly count: number; readonly state: ValueState }): ReactElement {
  if (!Number.isFinite(count)) {
    // A count that is not a number is never printed as one; it is reported as the unknown it is.
    return <StatusBadge {...statusBadgeProps(VALUE_STATE_WORDS, "unknown")} />;
  }
  switch (state) {
    case "value":
    case "zero":
      return <span className="tabular-figures">{COUNT_FORMAT.format(count)}</span>;
    case "incomplete-subtotal":
      return (
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
          <span className="tabular-figures">{COUNT_FORMAT.format(count)}</span>
          <StatusBadge {...statusBadgeProps(VALUE_STATE_WORDS, "incomplete-subtotal")} />
        </span>
      );
    case "unknown":
    case "withheld":
    case "unavailable":
      return <StatusBadge {...statusBadgeProps(VALUE_STATE_WORDS, state)} />;
    default:
      return assertNever(state, "Unhandled value state");
  }
}

/** A civil date or instant exactly as the read supplies it, isolated so a mixed-direction neighbour cannot reorder it. */
function StatedInstant({ value }: { readonly value: string }): ReactElement {
  return (
    <bdi>
      <time className="tabular-figures" dateTime={value}>
        {value}
      </time>
    </bdi>
  );
}

/** One term and its value in a member's facts; the pair is a `dl` row and never a bare sentence. */
function MemberFact({ term, children }: { readonly term: string; readonly children: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** Why a change is not on offer in this read, stated where the control would have been. */
function RefusalNote({ title, text }: { readonly title?: string; readonly text: string }): ReactElement {
  return (
    // A static explanation of a state the read already carries, so `role="alert"` is left off and the
    // region announces nothing when it merely renders.
    <Alert role={undefined} className="px-3 py-2">
      {title === undefined ? null : <AlertTitle>{title}</AlertTitle>}
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  );
}

/** Who the row is about: the partner's name, isolated for direction, with the member record's opaque reference beside it. */
function PartnerFigure({ member }: { readonly member: MemberRow }): ReactElement {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <bdi className="min-w-0 font-medium text-pretty wrap-anywhere">{member.partnerDisplayName}</bdi>
      <bdi className="mono-identifier min-w-0 break-all text-xs text-muted-foreground">{member.memberId}</bdi>
    </span>
  );
}

/** The state this partner stands in, as its own word — never a colour alone and never "active" or "inactive". */
function StateFigure({ member }: { readonly member: MemberRow }): ReactElement {
  const copy = MEMBERSHIP_STATE_COPY[member.state];
  return <StatusBadge label={copy.label} tone={MEMBERSHIP_TONE[member.state]} />;
}

/** The stage a member holds, in the state the read recorded for it: a value, or this family's not-stated wording. */
function StageValue({ member, stageState, valueState }: { readonly member: MemberRow; readonly stageState: StageState | null; readonly valueState: ValueState }): ReactElement {
  switch (valueState) {
    case "value":
    case "zero":
    case "incomplete-subtotal":
      break;
    case "unknown":
      // The read states no stage for this member, which is this family's own wording for that absence
      // rather than a blank term or the word "unknown" standing where an assessment would sit.
      return <span className="text-muted-foreground">{REQUESTED_TERMS_COPY.notStated}</span>;
    case "withheld":
    case "unavailable":
      // A value the read cannot show is never printed: its own word stands where the stage would be.
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
      {/* A retired stage stays visible and explains itself: the source no longer admits the value, so
          it is never silently dropped and never offered again as though it were approved. */}
      {stageState === "retired" ? <span className="text-xs text-pretty text-muted-foreground">{STAGE_STATE_COPY.retired.description}</span> : null}
    </span>
  );
}

/** Every recorded state change for one member, so a removal or an exclusion is never silent. */
function MemberHistory({ entries }: { readonly entries: readonly MemberHistoryEntry[] }): ReactElement {
  const headingId = useId();
  if (entries.length === 0) {
    return <p className="text-xs text-pretty text-muted-foreground">{WORKING_LIST_COPY.noHistory}</p>;
  }
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p id={headingId} className="text-xs font-medium text-muted-foreground">
        {WORKING_LIST_COPY.historyHeading}
      </p>
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

/** One member's change frozen at the moment the worker asked for it. */
interface MemberReview {
  readonly memberId: string;
  readonly partnerDisplayName: string;
  readonly memberState: MembershipState;
  readonly memberRevision: string;
  readonly task: MemberTask;
}

interface RowActionsProps {
  readonly member: MemberRow;
  readonly expectedRevision: string;
  readonly removeAction: ReadAction | undefined;
  readonly returnAction: ReadAction | undefined;
  readonly onReview: (review: MemberReview) => void;
  readonly className?: string;
}

/**
 * The one change this partner's state admits: Remove for an included partner, Return for a removed one,
 * and nothing at all for a partner the source marks not eligible. Where the read does not offer the
 * change, the reason it gives stands where the control would have been.
 */
function RowActions({ member, expectedRevision, removeAction, returnAction, onReview, className }: RowActionsProps): ReactElement {
  const openReview = (task: MemberTask): void => {
    onReview({ memberId: member.memberId, partnerDisplayName: member.partnerDisplayName, memberState: member.state, memberRevision: memberRevisionOf(member, expectedRevision), task });
  };
  if (member.state === "excluded") {
    return <p className={cn("max-w-56 text-xs text-pretty text-muted-foreground", className)}>{WORKING_LIST_COPY.excludedNote}</p>;
  }
  const action = member.state === "included" ? removeAction : returnAction;
  if (action?.available !== true) {
    return <p className={cn("max-w-56 text-xs text-pretty text-muted-foreground", className)}>{action?.reason ?? WORKING_LIST_COPY.unstatedRefusal}</p>;
  }
  const task: MemberTask = member.state === "included" ? "remove" : "return";
  const copy = task === "remove" ? REMOVE_COPY : RETURN_COPY;
  return (
    <Button type="button" variant="outline" size="sm" className={className} onClick={() => openReview(task)}>
      {copy.shortTrigger}
      {/* The visible word stays short enough for a table cell; the accessible name states the partner
          and the list, so a reader meets each row's control as its own. */}
      <span className="sr-only">
        {" "}
        <bdi>{member.partnerDisplayName}</bdi>
        {task === "remove" ? " from the working list" : " to the working list"}
      </span>
    </Button>
  );
}

/** The scope, the read's own value states, the admitted stages and the one re-read a change reports through: what every row of this list needs and no row owns. */
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

interface StageCellProps extends MemberSurfaceContext {
  readonly member: MemberRow;
}

/**
 * The stage a member holds: the family's own stage selector for an included partner, and the recorded
 * value with its state word for anyone else — an assessment is only ever changed by the selector.
 */
function StageCell({ initiativeId, member, scope, valueStates, admittedStages, stageAction, expectedRevision, onOutcome, onCheckResult }: StageCellProps): ReactElement {
  if (member.state !== "included") {
    return <StageValue member={member} stageState={STAGE_STATE_OF_READ[member.stageState]} valueState={stageStateOf(valueStates, member)} />;
  }
  return <StageSelector initiativeId={initiativeId} member={member} admittedStages={admittedStages} scope={scope} expectedRevision={memberRevisionOf(member, expectedRevision)} stageAction={stageAction} onOutcome={onOutcome} onCheckResult={onCheckResult} className="min-w-0" />;
}

/** When the read recorded this partner's return to the list, or the explicit statement that they have not returned. */
function ReturnedFigure({ member, valueState }: { readonly member: MemberRow; readonly valueState: ValueState }): ReactElement {
  if (member.returnedAt !== null) {
    return <StatedInstant value={member.returnedAt} />;
  }
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

interface MemberSurfaceProps extends MemberSurfaceContext {
  readonly removeAction: ReadAction | undefined;
  readonly returnAction: ReadAction | undefined;
  readonly onReview: (review: MemberReview) => void;
}

/** The columns this list's table is composed from: each cell is one of the figures above, never a second rendering of the same fact. */
function memberColumns({ initiativeId, scope, valueStates, admittedStages, stageAction, expectedRevision, onOutcome, onCheckResult }: MemberSurfaceContext): ReadonlyArray<RecordListColumnDef<MemberRow>> {
  return [
    { id: "partner", header: COLUMN_COPY.partner, enableSorting: false, enableHiding: false, cell: ({ row }) => <PartnerFigure member={row.original} /> },
    {
      id: "state",
      header: COLUMN_COPY.state,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <div className="flex min-w-0 flex-col gap-1.5">
          <StateFigure member={row.original} />
          <MemberHistory entries={row.original.history} />
        </div>
      ),
    },
    {
      id: "stage",
      header: COLUMN_COPY.stage,
      enableSorting: false,
      cell: ({ row }) => <StageCell initiativeId={initiativeId} member={row.original} scope={scope} valueStates={valueStates} admittedStages={admittedStages} stageAction={stageAction} expectedRevision={expectedRevision} onOutcome={onOutcome} onCheckResult={onCheckResult} />,
    },
    { id: "added", header: COLUMN_COPY.added, enableSorting: false, cell: ({ row }) => (row.original.addedAt.trim() === "" ? <span className="text-muted-foreground">{REQUESTED_TERMS_COPY.notStated}</span> : <StatedInstant value={row.original.addedAt} />) },
    { id: "returned", header: COLUMN_COPY.returned, enableSorting: false, cell: ({ row }) => <ReturnedFigure member={row.original} valueState={returnedStateOf(valueStates, row.original)} /> },
  ];
}

function memberRowId(row: MemberRow): string {
  return row.memberId;
}

interface MemberCardListProps extends MemberSurfaceProps {
  readonly rows: readonly MemberRow[];
  readonly label: string;
  readonly className?: string;
}

/**
 * The same rows, the same order and the same actions as a labelled sequence of member cards. It is the
 * composition a narrow surface actually shows; `display: none` removes the table it replaces, so a
 * reader meets one of the two and never both (WCAG 1.3.1, 1.4.10).
 */
function MemberCardList({ rows, label, className, initiativeId, scope, valueStates, admittedStages, stageAction, expectedRevision, onOutcome, onCheckResult, removeAction, returnAction, onReview }: MemberCardListProps): ReactElement {
  return (
    <div data-slot="working-list-members" className={cn("min-w-0", className)}>
      <ul aria-label={label} className="flex min-w-0 flex-col gap-3">
        {rows.map((member) => (
          <li key={member.memberId} className="flex min-w-0 flex-col gap-3 rounded-xl border border-border p-3">
            <PartnerFigure member={member} />
            <dl className="flex min-w-0 flex-col gap-1 text-sm">
              <MemberFact term={COLUMN_COPY.state}>
                <StateFigure member={member} />
              </MemberFact>
              <MemberFact term={COLUMN_COPY.stage}>
                <StageCell initiativeId={initiativeId} member={member} scope={scope} valueStates={valueStates} admittedStages={admittedStages} stageAction={stageAction} expectedRevision={expectedRevision} onOutcome={onOutcome} onCheckResult={onCheckResult} />
              </MemberFact>
              <MemberFact term={COLUMN_COPY.added}>{member.addedAt.trim() === "" ? <span className="text-muted-foreground">{REQUESTED_TERMS_COPY.notStated}</span> : <StatedInstant value={member.addedAt} />}</MemberFact>
              <MemberFact term={COLUMN_COPY.returned}>
                <ReturnedFigure member={member} valueState={returnedStateOf(valueStates, member)} />
              </MemberFact>
            </dl>
            <MemberHistory entries={member.history} />
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <RowActions member={member} expectedRevision={expectedRevision} removeAction={removeAction} returnAction={returnAction} onReview={onReview} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Whether the read stated a count this surface may render as the number it carries. */
function isCounted(state: ValueState): boolean {
  return state === "value" || state === "zero" || state === "incomplete-subtotal";
}

/** The three states, their own counts and the sentence each one means: distinct words, never one "active" flag. */
function StatesSummary({ memberStates, valueStates }: { readonly memberStates: InitiativeDetail["initiative"]["memberStates"]; readonly valueStates: ValueStates }): ReactElement {
  return (
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
                {/* The noun belongs to a figure the read stands behind; a badge standing in for an
                    unknown or withheld count is never read as "unknown partners". */}
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
}

/** What a working-list place is not, stated where the list is read rather than only in Help. */
function MembershipRules(): ReactElement {
  return (
    <div data-slot="working-list-rules" className="flex min-w-0 flex-col gap-1">
      <p className="text-sm text-pretty text-muted-foreground">{MEMBERSHIP_RULES_COPY.explicitSelectionOnly}</p>
      <ul className="flex min-w-0 flex-col gap-1 text-xs text-pretty text-muted-foreground">
        {[MEMBERSHIP_RULES_COPY.notAsked, MEMBERSHIP_RULES_COPY.notConsent, MEMBERSHIP_RULES_COPY.notAudienceMembership, MEMBERSHIP_RULES_COPY.removalPreservesHistory, MEMBERSHIP_RULES_COPY.returnRestoresEligiblePlanning].map((statement) => (
          <li key={statement}>{statement}</li>
        ))}
      </ul>
    </div>
  );
}

/** The member mutation as its handle actually dispatches it. */
type MutationDispatch<Variables> = (variables: Variables, options: { readonly onSettled: (outcome: MutationOutcome | undefined) => void }) => void;

/** The per-item state word each of the eight member-change outcomes reports as. */
const PER_ITEM_STATE_OF_OUTCOME: Readonly<Record<MutationOutcome["outcome"], PerItemResultState>> = { accepted: "accepted", alreadyAccepted: "accepted", unchanged: "unchanged", conflict: "failed", denied: "failed", invalid: "failed", unavailable: "failed", unknown: "failed" };

/** The member an outcome names, or the reviewed member when the outcome states no identifier of its own: an `unchanged` answer carries only a revision, so the review's member is the row it reports. */
function namedMemberOf(outcome: MutationOutcome, memberId: string): string {
  if (outcome.outcome !== "accepted" && outcome.outcome !== "alreadyAccepted") {
    return memberId;
  }
  return [...(outcome.changed ?? []), ...(outcome.created ?? [])].find((id) => id.trim() !== "") ?? memberId;
}

/** The words the outcome itself states for a row, or nothing at all when it states none. */
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

/** The per-item rows one settled member change reports. */
function memberResultRows(outcome: MutationOutcome | null, memberId: string): readonly PerItemResult[] {
  if (outcome === null) {
    return [];
  }
  if ((outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted") && (outcome.items ?? []).length > 0) {
    return outcome.items ?? [];
  }
  const reason = statedReasonOf(outcome);
  return [{ targetId: namedMemberOf(outcome, memberId), state: PER_ITEM_STATE_OF_OUTCOME[outcome.outcome], ...(reason === undefined ? {} : { reason }) }];
}

interface MemberReviewDialogProps {
  readonly review: MemberReview;
  readonly initiativeId: string;
  readonly scope: Scope;
  readonly onChanged: ((outcome: MutationOutcome) => void) | undefined;
  readonly onCheckResult: () => void;
  readonly onClose: () => void;
}

/** The body of one member's review, mounted for one visit so a fresh attempt starts from an empty reason. */
function MemberReviewBody({ review, initiativeId, scope, onChanged, onCheckResult, onClose }: MemberReviewDialogProps): ReactElement {
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FieldErrorLookup | null>(null);
  const [settled, setSettled] = useState<MutationOutcome | null>(null);
  const remove = useRemoveMember(scope);
  const restore = useReturnMember(scope);
  const dispatchRemove = remove.submit as MutationDispatch<RemoveMemberVariables>;
  const dispatchReturn = restore.submit as MutationDispatch<ReturnMemberVariables>;
  const submitRemove = useCallback<MutationSubmit<RemoveMemberPayload>>(
    (input) =>
      new Promise<MutationOutcome>((resolve) => {
        dispatchRemove(
          { operationId: input.operationId, expectedRevision: input.expectedRevision, payload: input.payload },
          {
            onSettled: (outcome) => {
              // A request whose acknowledgement was lost has no outcome to report, and `unknown` is the
              // one honest word for it: the receipt offers a check, never a second removal.
              resolve(outcome ?? { outcome: "unknown", operationId: input.operationId });
            },
          },
        );
      }),
    [dispatchRemove],
  );
  const submitReturn = useCallback<MutationSubmit<ReturnMemberPayload>>(
    (input) =>
      new Promise<MutationOutcome>((resolve) => {
        dispatchReturn(
          { operationId: input.operationId, expectedRevision: input.expectedRevision, payload: input.payload },
          {
            onSettled: (outcome) => {
              resolve(outcome ?? { outcome: "unknown", operationId: input.operationId });
            },
          },
        );
      }),
    [dispatchReturn],
  );
  // Leaving the key out is a valid removal while a blank reason is not, so an empty field states no
  // reason at all rather than a reason the service would refuse.
  const removePayload = useMemo<RemoveMemberPayload>(() => {
    const trimmed = reason.trim();
    return trimmed === "" ? { initiativeId, memberId: review.memberId } : { initiativeId, memberId: review.memberId, reason: trimmed };
  }, [initiativeId, review.memberId, reason]);
  const removeInput = useMemo(() => ({ scope, expectedRevision: review.memberRevision, payload: removePayload }), [scope, review.memberRevision, removePayload]);
  const returnPayload = useMemo<ReturnMemberPayload>(() => ({ initiativeId, memberId: review.memberId }), [initiativeId, review.memberId]);
  const returnInput = useMemo(() => ({ scope, expectedRevision: review.memberRevision, payload: returnPayload }), [scope, review.memberRevision, returnPayload]);
  const perItemRows = useMemo<readonly PerItemResult[]>(() => memberResultRows(settled, review.memberId), [settled, review.memberId]);
  // The state a change that stood leaves this member in, in the family's own action vocabulary; an
  // outcome that did not stand states no state at all, so the row never claims a move that did not
  // happen.
  const resultingState: MembershipState | null = settled !== null && STANDING_OUTCOMES.has(settled.outcome) ? MEMBER_ACTION_STATE[review.task] : null;
  const settle = useCallback(
    (outcome: MutationOutcome): void => {
      setSettled(outcome);
      // A message the service sent for this payload belongs beside the field it names, and nowhere else.
      setErrors(outcome.outcome === "invalid" ? fieldErrorsFromInvalid(outcome) : null);
      if (STANDING_OUTCOMES.has(outcome.outcome)) {
        onChanged?.(outcome);
      }
    },
    [onChanged],
  );
  const stateCopy = MEMBERSHIP_STATE_COPY[review.memberState];
  const memberName = <bdi className="min-w-0 wrap-anywhere">{review.partnerDisplayName}</bdi>;
  const reviewed =
    review.task === "remove" ? (
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-sm text-pretty text-muted-foreground">{REMOVE_COPY.description}</p>
        <FormField name={`remove-reason-${review.memberId}`} label={REMOVE_COPY.reasonLabel} description={REMOVE_COPY.reasonDescription} optionalHint error={errors?.byField.reason}>
          {(field) => (
            <Textarea
              id={field.id}
              name="reason"
              rows={2}
              maxLength={REMOVE_REASON_MAX_LENGTH}
              value={reason}
              aria-describedby={field.describedBy}
              aria-invalid={field.invalid ? true : undefined}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
          )}
        </FormField>
        <ActionReview<RemoveMemberPayload>
          title={REMOVE_COPY.title}
          headingLevel={ROW_REVIEW_HEADING}
          description={
            <div className="flex min-w-0 flex-col gap-1">
              <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                <span className="font-medium text-foreground">{memberName}</span>
                <span>{stateCopy.description}</span>
              </p>
              <p>{MEMBERSHIP_RULES_COPY.removalPreservesHistory}</p>
              <p>{MEMBERSHIP_RULES_COPY.returnRestoresEligiblePlanning}</p>
            </div>
          }
          confirmLabel={REMOVE_COPY.confirmLabel}
          cancelLabel={REMOVE_COPY.cancelLabel}
          onCancel={onClose}
          input={removeInput}
          submit={submitRemove}
          onSettled={settle}
          checkResult={onCheckResult}
          fieldLabels={REMOVE_FIELD_LABELS}
        />
      </div>
    ) : (
      <ActionReview<ReturnMemberPayload>
        title={RETURN_COPY.title}
        headingLevel={ROW_REVIEW_HEADING}
        description={
          <div className="flex min-w-0 flex-col gap-1">
            <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
              <span className="font-medium text-foreground">{memberName}</span>
              <span>{MEMBERSHIP_RULES_COPY.returnRestoresEligiblePlanning}</span>
            </p>
            <p>{MEMBERSHIP_RULES_COPY.removalPreservesHistory}</p>
          </div>
        }
        confirmLabel={RETURN_COPY.confirmLabel}
        cancelLabel={RETURN_COPY.cancelLabel}
        onCancel={onClose}
        input={returnInput}
        submit={submitReturn}
        onSettled={settle}
        checkResult={onCheckResult}
        fieldLabels={RETURN_FIELD_LABELS}
      />
    );
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {reviewed}
      {/* The receipt above reports each row by its opaque target reference, which a worker cannot read
          as a person; this names the member beside the same per-item words, and for a change that stood
          it states the state that change left them in, so the result of this member's change is legible
          and stays in place while the list behind it re-reads. */}
      {perItemRows.length === 0 ? null : (
        <PerItemResults
          heading={review.task === "remove" ? REMOVE_COPY.perItemHeading : RETURN_COPY.perItemHeading}
          items={perItemRows}
          renderItemAction={() => (
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-sm">
              {memberName}
              {resultingState === null ? null : <StatusBadge label={MEMBERSHIP_STATE_COPY[resultingState].label} tone={MEMBERSHIP_TONE[resultingState]} />}
            </span>
          )}
        />
      )}
      {settled === null ? null : (
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {WORKING_LIST_COPY.doneLabel}
          </Button>
        </DialogFooter>
      )}
    </div>
  );
}

/** One member's removal or Return, reviewed and accepted in the shared dialog substrate so the receipt outlives the row it was opened from and focus is contained and returned by the substrate itself. */
function MemberReviewDialog({ review, initiativeId, scope, onChanged, onCheckResult, onClose }: MemberReviewDialogProps): ReactElement {
  const title = review.task === "remove" ? REMOVE_COPY.trigger : RETURN_COPY.trigger;
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
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

/** The two closure actions, with the statements that keep each of them honest: closing fences new solicitation and leaves every obligation with its owner, a late response stays recordable without reopening, and reopening keeps the closure history. */
function ClosureControl({ initiativeId, envelope, closeAction, reopenAction, level, onChanged, onCheckResult }: ClosureControlProps): ReactElement {
  const headingId = useId();
  const [closeOpen, setCloseOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const Heading = GROUP_HEADING_TAG[level];
  const offersClose = closeAction?.available === true;
  const offersReopen = reopenAction?.available === true;
  const handleClosed = useCallback(
    (outcome: MutationOutcome): void => {
      onChanged?.(outcome);
    },
    [onChanged],
  );
  return (
    <section aria-labelledby={headingId} data-slot="working-list-closure" className="flex min-w-0 flex-col gap-3">
      <Heading id={headingId} className="font-heading text-base font-medium text-pretty">
        {WORKING_LIST_COPY.closureHeading}
      </Heading>
      <div className="flex min-w-0 flex-col gap-1 text-sm text-pretty text-muted-foreground">
        <p>{CLOSURE_COPY.closeHelp}</p>
        <p>{CLOSURE_COPY.historyPreservedNote}</p>
        <p>{CLOSURE_COPY.lateResponseNote}</p>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {offersClose ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setCloseOpen(true);
            }}
          >
            {CLOSURE_COPY.closeHeading}
          </Button>
        ) : null}
        {offersReopen ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setReopenOpen(true);
            }}
          >
            {CLOSURE_COPY.reopenHeading}
          </Button>
        ) : null}
      </div>
      {offersClose ? null : <RefusalNote title={CLOSURE_COPY.closeHeading} text={closeAction?.reason ?? WORKING_LIST_COPY.unstatedRefusal} />}
      {offersReopen ? null : <RefusalNote title={CLOSURE_COPY.reopenHeading} text={reopenAction?.reason ?? WORKING_LIST_COPY.unstatedRefusal} />}
      <CloseInitiativeDialog open={closeOpen} onOpenChange={setCloseOpen} initiativeId={initiativeId} envelope={envelope} onClosed={handleClosed} onCheckResult={onCheckResult} />
      {/* A reopen reports through its own receipt and the re-read; it hands back no outcome, and this
          surface never states one it was not given. */}
      <ReopenInitiativeDialog open={reopenOpen} onOpenChange={setReopenOpen} initiativeId={initiativeId} envelope={envelope} onReopened={onCheckResult} />
    </section>
  );
}

interface WorkingListBodyProps {
  readonly initiativeId: string;
  readonly envelope: ReadEnvelope<InitiativeDetail>;
  readonly candidates: readonly MemberCandidate[] | MemberCandidates;
  readonly onChanged: ((outcome: MutationOutcome) => void) | undefined;
  readonly onCheckResult: () => void;
  readonly level: WorkingListHeadingLevel;
}

/** The envelope in hand: the three states, the one list of every partner in them, the picker that adds to them, and the two closure actions. */
function WorkingListBody({ initiativeId, envelope, candidates, onChanged, onCheckResult, level }: WorkingListBodyProps): ReactElement {
  const { data, valueStates, scope, revision, actions } = envelope;
  // The member whose change is under review, frozen when it was opened; the row it came from may move
  // between states while the review is open, which is exactly what its receipt has to survive.
  const [review, setReview] = useState<MemberReview | null>(null);
  // Column visibility is presentation and belongs to this surface; the page window and the order are
  // the service's, so neither is offered as a control here.
  const [columnVisibility, setColumnVisibility] = useState<RecordListQueryState["columnVisibility"]>(NO_COLUMNS_HIDDEN);
  const admittedStages = useMemo<readonly string[]>(() => data.stages.filter((option) => option.admitted).map((option) => option.value), [data.stages]);
  const closeReview = useCallback((): void => {
    setReview(null);
  }, []);
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
  const listLabel = `${INITIATIVE_COPY.membersHeading} for ${data.initiative.name}, ${WORKING_LIST_COPY.listSuffix}`;
  function handleQueryStateChange(next: RecordListQueryState): void {
    // The order and the page window belong to the service: this surface renders the page the read
    // returned and states the whole-result total beside it, and no column here offers a sort the service
    // was not asked for, so the only change this handler takes is the presentation it owns.
    if (next.columnVisibility !== columnVisibility) {
      setColumnVisibility(next.columnVisibility);
    }
  }
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <MembershipRules />
      {total === 0 ? null : <StatesSummary memberStates={data.initiative.memberStates} valueStates={valueStates} />}
      {total === 0 ? (
        // Nothing is on the list yet, so the honest answer is the collection's own emptiness beside the
        // one real first action — the picker this surface renders below, reached by this link.
        <StateNotice kind="empty" headingLevel={GROUP_HEADING_LEVEL[level]} title={WORKING_LIST_COPY.emptyTitle} description={WORKING_LIST_COPY.emptyBody} action={{ label: WORKING_LIST_COPY.emptyAction, href: "#working-list-add" }} />
      ) : (
        <>
          {/*
            One answer, two compositions with opposite responsive display utilities: the preset's table
            for a wide surface, the labelled card list for a narrow one, so `display: none` leaves a
            reader exactly one of them (WCAG 1.3.1, 1.4.10). The pager states the whole-list total the
            read measured and offers only the page size the read used.
          */}
          <div className="hidden min-w-0 md:block">
            <RecordList
              label={listLabel}
              columns={columns}
              rows={rows}
              rowCount={total}
              queryState={listQueryState}
              onQueryStateChange={handleQueryStateChange}
              getRowId={memberRowId}
              rowActions={(row) => <RowActions member={row} expectedRevision={revision} removeAction={removeAction} returnAction={returnAction} onReview={setReview} />}
              itemNoun={WORKING_LIST_COPY.memberNoun}
              pageSizeOptions={[data.workingList.pageSize]}
            />
          </div>
          <MemberCardList {...surface} rows={rows} label={listLabel} className="md:hidden" />
          {rows.length < total ? <p className="text-xs text-pretty text-muted-foreground">{WORKING_LIST_COPY.partialPage(rows.length, total)}</p> : null}
        </>
      )}
      {review === null ? null : <MemberReviewDialog review={review} initiativeId={initiativeId} scope={scope} onChanged={onChanged} onCheckResult={onCheckResult} onClose={closeReview} />}
      <Separator />
      {/* The picker is the only way a partner joins this list, so its refusal stands exactly where the
          picker would be and the rest of the surface keeps working. */}
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

/** Props of {@link WorkingList}. */
export interface WorkingListProps {
  /** The initiative the working list belongs to: the identifier every change below names. */
  readonly initiativeId: string;
  /** The initiative detail envelope the composing page read: its scope and revision, its advisory actions, the working-list page, the source-approved stages and the initiative's own overview. */
  readonly envelope: ReadEnvelope<InitiativeDetail>;
  /** The eligible-partner read the composing route supplied, handed to the picker unchanged; no candidate set is computed here. */
  readonly candidates: readonly MemberCandidate[] | MemberCandidates;
  /** Called with the outcome once a change made through this surface stands, so the caller can re-read or move on. */
  readonly onChanged?: (outcome: MutationOutcome) => void;
  /**
   * The page windows the composing detail read states for the lists beside this one. They travel here so this
   * section re-reads the same record under the same window — one cache entry for one read — rather than a
   * second entry of the same initiative whose own lists sit on a different page.
   */
  readonly readWindow?: InitiativeReadWindow;
  /** The heading level this section renders at; its groups, cards and closure section render one level deeper. */
  readonly headingLevel?: WorkingListHeadingLevel;
  readonly className?: string;
}

/** The reviewed working list of one initiative. */
export default function WorkingList({ initiativeId, envelope, candidates, onChanged, readWindow, headingLevel = 3, className }: WorkingListProps): ReactElement {
  const headingId = useId();
  const query = useInitiative<InitiativeDetail>(initiativeId, envelope, readWindow);
  const queryClient = useQueryClient();
  const checkResult = useCallback((): void => {
    // This family's one invalidation policy is the re-read: an unconfirmed attempt is checked by
    // re-reading the initiative, never by repeating the change under a second identity.
    void invalidateInitiativeReads(queryClient, envelope.scope);
  }, [queryClient, envelope.scope]);
  const result = query.status === "ready" ? query.result : undefined;
  const current = result !== undefined && result.kind === "envelope" ? result.envelope : envelope;
  const refusal: DetailRefusal | undefined = result !== undefined && result.kind !== "envelope" ? result : undefined;
  const Heading = SECTION_HEADING_TAG[headingLevel];
  return (
    <section aria-labelledby={headingId} data-slot="working-list" className={cn("flex min-w-0 flex-col gap-4 text-start", className)}>
      <Heading id={headingId} className="font-heading text-lg font-medium text-pretty">
        {INITIATIVE_COPY.membersHeading}
      </Heading>
      {refusal === undefined ? (
        <WorkingListBody initiativeId={initiativeId} envelope={current} candidates={candidates} onChanged={onChanged} onCheckResult={checkResult} level={headingLevel} />
      ) : refusal.kind === "denied" ? (
        // No row, no count and no title: the answer is the same whether or not this initiative has a
        // working list, so nothing about the members is revealed.
        <StateNotice kind="denied" headingLevel={headingLevel} title={STATE_NOTICE_COPY.denied.title} description={STATE_NOTICE_COPY.denied.body} reasonCode={refusal.denied.reasonCode} />
      ) : refusal.kind === "refused" ? (
        // The read refused the request this view sent — an unadmitted page or filter — which is neither a
        // denial nor an outage: the refusal names the field to correct and nothing about the members is
        // shown in its place.
        <StateNotice kind="refused" headingLevel={headingLevel} title={STATE_NOTICE_COPY.refused.title} description={refusalSummary(refusal.refused)} />
      ) : (
        <StateNotice kind="unavailable" headingLevel={headingLevel} title={STATE_NOTICE_COPY.unavailable.title} description={refusal.unavailable.guidance} source={refusal.unavailable.source} retry={{ label: STATE_NOTICE_COPY.unavailable.actionLabel ?? "Try again", onClick: checkResult }} />
      )}
    </section>
  );
}
