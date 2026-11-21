"use client";
/**
 * One working-list member's stage assessment: the value the source holds, the closed list of stages
 * the source approves, and the two explicit actions beside it — Clear, and the Return the working
 * list owns.
 *
 * A stage is a human assessment. It measures no worth, predicts no giving and fulfils no obligation,
 * so this surface states that boundary beside the control and derives nothing from the value: no
 * next stage, no rank, no percentage and no date. Moving a partner between lists is never a drag
 * (WCAG 2.5.7): the value is a native closed choice, and Return is a labelled menu item.
 */
import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type ReactElement } from "react";
import ActionReview, { type MutationSubmit } from "@/components/action-review";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import { assertNever } from "@/lib/result";
import type { InitiativeMemberRecord, MutationInput, MutationOutcome, ReadAction, Scope } from "@/modules/data-service";
import { MEMBERSHIP_RULES_COPY, MEMBERSHIP_STATE_COPY, REQUESTED_TERMS_COPY, STAGE_SELECTOR_COPY, STAGE_STATE_COPY, type StageState } from "../copy";
import { useSetStage } from "../hooks/use-initiative-mutations";
import { isAdmittedStage, type StagePayload } from "../schemas/stage";
/**
 * The option value that stands for "no stage recorded". A `<select>` carries strings, while the
 * record carries the absence as `null`, so the conversion happens here and nowhere else.
 */
const ABSENT_OPTION_VALUE = "";
/** The menu of explicit actions beside the select; it opens Clear and Return, and carries no drag affordance. */
const MENU_TRIGGER_LABEL = "Stage actions";
/** The confirm word for a recorded assessment, matching the family's own "Clear stage" action wording. */
const RECORD_LABEL = "Record this stage";
/** The two terms the review step compares: what the record holds, and what this change would record. */
const RECORDED_TERM = "Recorded stage";
const INTENDED_TERM = "Stage after this change";
/** What a caller is told when the read refuses a change but states no reason of its own. */
const UNSTATED_CHANGE_REFUSAL = "The stage of this working-list member cannot be changed in the current session.";
/** The two source states this surface cannot derive from a member's own record, and never invents. */
type StageSourceState = Exclude<StageState, "recorded" | "retired">;
/** The badge tone and whether the controls are offered at all, for one closed stage state. */
interface StagePresentation {
  readonly variant: "secondary" | "outline";
  readonly offersControls: boolean;
}
/**
 * One working-list member as this control reads them: the opaque member reference, the recorded stage
 * and the revision a change must present, plus the display name and membership state where the
 * caller's read carries them.
 *
 * The members of the detail read (`InitiativeMemberRow`) and of the stored record both satisfy this
 * shape, so the caller passes its own row rather than converting it and this file states no identity
 * of its own.
 */
export interface StageSelectorMember {
  readonly memberId: string;
  readonly stage: InitiativeMemberRecord["stage"];
  readonly revision: string;
  readonly state?: InitiativeMemberRecord["state"] | undefined;
  readonly partnerDisplayName?: string | null | undefined;
}
/** Props of {@link StageSelector}. */
export interface StageSelectorProps {
  readonly initiativeId: string;
  readonly member: StageSelectorMember;
  /** The source-approved stage list, exactly as the read supplied it: this control offers nothing else. */
  readonly admittedStages: readonly string[];
  readonly scope: Scope;
  /** The revision the caller read; a member record that states its own is preferred over it. */
  readonly expectedRevision: string;
  /** The read's advisory action for `setStage`; when it is unavailable its reason is shown and no control is offered. */
  readonly stageAction?: ReadAction | undefined;
  /** A state of the stage source itself — a denial or an outage — which the member's record cannot state. */
  readonly stageSourceState?: StageSourceState | undefined;
  readonly onOutcome?: ((outcome: MutationOutcome) => void) | undefined;
  readonly onReturn?: ((memberId: string) => void) | undefined;
  readonly onCheckResult?: (() => void) | undefined;
  readonly className?: string;
}
/** One intended change, with the revision it was decided against so the receipt survives the read that follows it. */
interface StageIntent {
  readonly stage: string | null;
  readonly expectedRevision: string;
}
/** What the service last reported for this member, so a change made here is the basis of the next one. */
interface RecordedStage {
  readonly memberId: string;
  readonly stage: string | null;
  readonly revision: string;
}
/**
 * What this control last recorded, while the caller's read still holds the revision it started from.
 *
 * A settled change answers with the record's new revision, and the next change has to present it. The
 * caller's re-read does that once it arrives; until then this is the newer fact about the same member,
 * so the next change is not refused as stale. Once the read carries a different revision — the
 * accepted one or a later one — the read is authoritative again and this stands down.
 */
function carriedForward(recorded: RecordedStage | null, member: StageSelectorMember): RecordedStage | null {
  if (recorded === null || recorded.memberId !== member.memberId || recorded.revision === member.revision) {
    return null;
  }
  return recorded;
}
/** The attempt in flight, and the promise the review step is awaiting. */
interface PendingAttempt {
  readonly operationId: string;
  readonly resolve: (outcome: MutationOutcome) => void;
}
/** The note a live region announces after a selection that produced no change. */
interface StageNote {
  readonly text: string;
  readonly sequence: number;
}
/**
 * Which of the closed stage states this surface is presenting.
 *
 * `recorded` and `retired` are read from the member's own value against the list the source approves
 * today; `denied` and `unavailable` are the caller's, because a record cannot state that its own
 * source refused or failed. A member with no recorded stage and no source condition states no stage
 * state at all, rather than a fifth word for "not recorded".
 */
function stageStateOf(stage: string | null, admittedStages: readonly string[], sourceState: StageSourceState | undefined): StageState | null {
  if (sourceState !== undefined) {
    return sourceState;
  }
  if (stage === null) {
    return null;
  }
  return isAdmittedStage(admittedStages, stage) ? "recorded" : "retired";
}
/**
 * How one stage state is presented. The switch is exhaustive over the closed set, so a state added to
 * the vocabulary fails to compile here instead of rendering with no word and no tone.
 */
function presentationOf(state: StageState | null): StagePresentation {
  if (state === null) {
    return { variant: "outline", offersControls: true };
  }
  switch (state) {
    case "recorded":
      return { variant: "secondary", offersControls: true };
    case "retired":
      // The source no longer admits this value: it stays visible as retired and is never silently
      // dropped, and it is never offered again as though the source still approved it.
      return { variant: "outline", offersControls: true };
    case "denied":
      // A denial reveals nothing. No stage value, count, title or existence hint is rendered beside
      // it, so the controls are withheld entirely rather than disabled with a value on screen.
      return { variant: "outline", offersControls: false };
    case "unavailable":
      // The source could not answer, so nothing here is shown as "no stage": the controls are
      // withheld and the rest of the row stays usable.
      return { variant: "outline", offersControls: false };
    default:
      return assertNever(state, "Unhandled stage state");
  }
}
/** The name this control belongs to: the member's stated display name, or the opaque reference when none is stated. */
function memberNameOf(member: StageSelectorMember): string {
  const stated = (member.partnerDisplayName ?? "").trim();
  return stated === "" ? member.memberId : stated;
}
/** The stage a value states, or the family's own not-stated wording when the record holds none. */
function stageTextOf(stage: string | null): string {
  return stage === null ? REQUESTED_TERMS_COPY.notStated : stage;
}
/** What the review step compares: the assessment the record holds, beside the one this change would record. */
function StageComparison({ recorded, intended }: { readonly recorded: string | null; readonly intended: string | null }): ReactElement {
  return (
    <dl className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <dt className="font-medium">{RECORDED_TERM}</dt>
        <dd className="min-w-0 wrap-anywhere">
          <bdi>{stageTextOf(recorded)}</bdi>
        </dd>
      </div>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <dt className="font-medium">{INTENDED_TERM}</dt>
        <dd className="min-w-0 wrap-anywhere">
          <bdi>{stageTextOf(intended)}</bdi>
        </dd>
      </div>
    </dl>
  );
}
/** The stage a prospective change would record, given every option this control offered. */
function intendedStageOf(value: string): string | null {
  return value === ABSENT_OPTION_VALUE ? null : value;
}
/** The field names this change carries, as the one field-error presentation reads them. */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  initiativeId: "Initiative",
  memberId: "Working-list member",
  stage: STAGE_SELECTOR_COPY.label,
};
/**
 * Why a stage change is not on offer here, or `null` when it is.
 *
 * A membership that is not on the working list cannot carry a stage, and the read's advisory action
 * says when this session may not change one at all; both are stated rather than left to a disabled
 * control with no explanation.
 */
function changeRefusalOf(member: StageSelectorMember, stageAction: ReadAction | undefined): string | null {
  if (member.state !== undefined && member.state !== "included") {
    return MEMBERSHIP_STATE_COPY[member.state].description;
  }
  if (stageAction !== undefined && !stageAction.available) {
    return stageAction.reason ?? UNSTATED_CHANGE_REFUSAL;
  }
  return null;
}
/**
 * One working-list member's stage: the closed choice, the state it stands in, the two explicit
 * actions, and the review-then-receipt every real change goes through.
 *
 * A selection that would change nothing is answered here — no request, no attempt identity and no
 * receipt — and a value outside the source-approved list is refused before it can be dispatched.
 */
export default function StageSelector({
  initiativeId,
  member,
  admittedStages,
  scope,
  expectedRevision,
  stageAction,
  stageSourceState,
  onOutcome,
  onReturn,
  onCheckResult,
  className,
}: StageSelectorProps): ReactElement {
  const selectId = useId();
  const helpId = useId();
  const reasonId = useId();
  const clearHelpId = useId();
  const [intent, setIntent] = useState<StageIntent | null>(null);
  const [note, setNote] = useState<StageNote | null>(null);
  const [recorded, setRecorded] = useState<RecordedStage | null>(null);
  const carried = carriedForward(recorded, member);
  const recordedStage = carried === null ? member.stage : carried.stage;
  const recordedRevision = carried === null ? (member.revision.trim() === "" ? expectedRevision : member.revision) : carried.revision;
  const setStage = useSetStage(scope);
  const dispatchStage = setStage.submit;
  const mutationState = setStage.state;
  const pendingRef = useRef<PendingAttempt | null>(null);
  const settledRef = useRef<MutationOutcome | null>(null);
  const inFlightRef = useRef(false);
  /**
   * The family's mutation hook reports its one settled outcome through its state rather than by
   * returning a promise, so this effect hands that outcome to the review step awaiting it. The
   * settled object stays put until another attempt settles, which is what keeps one outcome from
   * resolving twice; an attempt that leaves flight without an answer resolves `unknown`, because
   * that is the only honest report of an effect nobody can confirm.
   */
  useEffect(() => {
    if (mutationState.status === "submitting") {
      inFlightRef.current = true;
      return;
    }
    const pending = pendingRef.current;
    if (pending === null) {
      return;
    }
    if (mutationState.status === "settled") {
      inFlightRef.current = false;
      if (settledRef.current === mutationState.outcome) {
        return;
      }
      settledRef.current = mutationState.outcome;
      pendingRef.current = null;
      pending.resolve(mutationState.outcome);
      return;
    }
    if (inFlightRef.current) {
      inFlightRef.current = false;
      pendingRef.current = null;
      pending.resolve({ outcome: "unknown", operationId: pending.operationId });
    }
  }, [mutationState]);
  /** The one way this control submits: the review step's attempt identity, sent through the family's named mutation. */
  const submit = useCallback<MutationSubmit<StagePayload>>(
    (input: MutationInput<StagePayload>) =>
      new Promise<MutationOutcome>((resolve) => {
        pendingRef.current = { operationId: input.operationId, resolve };
        dispatchStage({ operationId: input.operationId, expectedRevision: input.expectedRevision, payload: input.payload });
      }),
    [dispatchStage],
  );
  const announce = useCallback((text: string): void => {
    // The sequence advances even when the wording repeats, so a second identical selection still
    // changes the region the assistive technology is watching and is announced again.
    setNote((current) => ({ text, sequence: (current?.sequence ?? 0) + 1 }));
  }, []);
  /**
   * Opens the review step for one prospective value, or answers the selection here.
   *
   * Every path through this control goes through it, so the two rules that protect the record — a
   * value outside the approved list never reaches the service, and the same assessment is no change
   * at all — hold for the select and for Clear alike.
   */
  const beginChange = useCallback(
    (stage: string | null): void => {
      if (!isAdmittedStage(admittedStages, stage)) {
        announce(STAGE_SELECTOR_COPY.help);
        return;
      }
      if (recordedStage === stage) {
        setIntent(null);
        announce(STAGE_SELECTOR_COPY.sameValueNote);
        return;
      }
      // The revision is captured when the intent is decided, so the receipt this change produces
      // survives the re-read that follows it, and the next change presents the new revision.
      setIntent({ stage, expectedRevision: recordedRevision });
      setNote(null);
    },
    [admittedStages, announce, recordedRevision, recordedStage],
  );
  const handleSettled = useCallback(
    (outcome: MutationOutcome): void => {
      // The answer to an accepting change states the record's revision, so the next change made here
      // presents the current one even before the caller's re-read arrives.
      if (intent !== null && (outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unchanged")) {
        setRecorded({ memberId: member.memberId, stage: intent.stage, revision: outcome.revision });
      }
      onOutcome?.(outcome);
    },
    [intent, member.memberId, onOutcome],
  );
  const memberName = memberNameOf(member);
  const stageState = stageStateOf(recordedStage, admittedStages, stageSourceState);
  const presentation = presentationOf(stageState);
  const refusedReason = changeRefusalOf(member, stageAction);
  const offersStageChoice = presentation.offersControls && refusedReason === null;
  const offersClear = offersStageChoice && recordedStage !== null;
  const offersReturn = onReturn !== undefined && member.state === "removed";
  const offersMenu = offersClear || offersReturn;
  const describedBy = refusedReason === null ? helpId : `${helpId} ${reasonId}`;
  // The select shows the value this control would record — the intent while a review is open, the
  // recorded value otherwise — so a pending Clear reads as "not stated" instead of as no choice.
  const shownValue: string | null = intent === null ? recordedStage : intent.stage;
  const selectedValue = shownValue ?? ABSENT_OPTION_VALUE;
  const showsAbsentOption = shownValue === null;
  const showsRetiredOption = recordedStage !== null && !isAdmittedStage(admittedStages, recordedStage);
  const handleSelectChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    beginChange(intendedStageOf(event.target.value));
  };
  const handleClear = (): void => {
    beginChange(null);
  };
  const handleReturn = (): void => {
    onReturn?.(member.memberId);
  };
  return (
    <div data-slot="stage-selector" data-member-id={member.memberId} data-stage-state={stageState ?? undefined} className={cn("flex min-w-0 flex-col gap-2", className)}>
      {stageState === null ? null : (
        <p className="flex min-w-0 flex-wrap items-baseline gap-2">
          <Badge variant={presentation.variant}>{STAGE_STATE_COPY[stageState].label}</Badge>
          <span className="min-w-0 text-xs text-pretty text-muted-foreground">{STAGE_STATE_COPY[stageState].description}</span>
        </p>
      )}
      {presentation.offersControls ? (
        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor={selectId}>
            {STAGE_SELECTOR_COPY.label}
            <span className="sr-only">
              {/* The accessible name names the member this control belongs to, and `sr-only` keeps it
                  whole: no width, zoom or 320 px layout can truncate it out of the name. */}
              {" for "}
              <bdi>{memberName}</bdi>
            </span>
          </Label>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <NativeSelect id={selectId} value={selectedValue} disabled={!offersStageChoice} aria-describedby={describedBy} onChange={handleSelectChange} className="max-w-full">
              {showsAbsentOption ? <NativeSelectOption value={ABSENT_OPTION_VALUE}>{stageTextOf(null)}</NativeSelectOption> : null}
              {showsRetiredOption ? (
                <NativeSelectOption value={recordedStage ?? ABSENT_OPTION_VALUE}>{`${stageTextOf(recordedStage)} — ${STAGE_STATE_COPY.retired.label}`}</NativeSelectOption>
              ) : null}
              {admittedStages.map((stage) => (
                <NativeSelectOption key={stage} value={stage}>
                  {stage}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {offersMenu ? (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" />} aria-describedby={helpId}>
                  {MENU_TRIGGER_LABEL}
                  <span className="sr-only">
                    {" for "}
                    <bdi>{memberName}</bdi>
                  </span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-72 max-w-full">
                  {offersClear ? (
                    <DropdownMenuItem aria-describedby={clearHelpId} className="py-2" onClick={handleClear}>
                      {STAGE_SELECTOR_COPY.clearLabel}
                    </DropdownMenuItem>
                  ) : null}
                  {offersClear && offersReturn ? <DropdownMenuSeparator /> : null}
                  {offersReturn ? (
                    // The family's own sentence names the Return action and the fact that it grants no
                    // permission, so the item carries the consequence at the point of the action.
                    <DropdownMenuItem className="py-2 text-pretty" onClick={handleReturn}>
                      {MEMBERSHIP_RULES_COPY.returnRestoresEligiblePlanning}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
          <p id={helpId} className="text-xs text-pretty text-muted-foreground">
            {STAGE_SELECTOR_COPY.help}
          </p>
          {offersClear ? (
            <p id={clearHelpId} className="text-xs text-pretty text-muted-foreground">
              {STAGE_SELECTOR_COPY.clearHelp}
            </p>
          ) : null}
          {refusedReason === null ? null : (
            // A static explanation of why a change is not on offer, so `role="alert"` is left off and
            // the region announces nothing when it merely renders.
            <Alert id={reasonId} role={undefined} className="px-3 py-2">
              <AlertDescription>{refusedReason}</AlertDescription>
            </Alert>
          )}
          {offersReturn ? <p className="text-xs text-pretty text-muted-foreground">{STAGE_SELECTOR_COPY.movedToListNote}</p> : null}
          <p className="text-xs text-pretty text-muted-foreground">{STAGE_SELECTOR_COPY.noTaskCreatedNote}</p>
        </div>
      ) : null}
      {/* Always rendered, so a selection that changed nothing has a region to be announced in. */}
      <output aria-live="polite" aria-atomic="true" className="block text-xs text-pretty text-muted-foreground">
        {note?.text ?? ""}
      </output>
      {intent === null ? null : (
        <div className="flex min-w-0 flex-col gap-3">
          <Separator />
          <ActionReview<StagePayload>
            title={STAGE_SELECTOR_COPY.label}
            description={
              <div className="flex min-w-0 flex-col gap-2">
                <StageComparison recorded={recordedStage} intended={intent.stage} />
                {intent.stage === null ? <p>{STAGE_SELECTOR_COPY.clearHelp}</p> : null}
                <p>{STAGE_SELECTOR_COPY.noTaskCreatedNote}</p>
              </div>
            }
            confirmLabel={intent.stage === null ? STAGE_SELECTOR_COPY.clearLabel : RECORD_LABEL}
            onCancel={() => {
              setIntent(null);
            }}
            input={{ scope, expectedRevision: intent.expectedRevision, payload: { initiativeId, memberId: member.memberId, stage: intent.stage } }}
            submit={submit}
            onSettled={handleSettled}
            checkResult={onCheckResult}
            fieldLabels={FIELD_LABELS}
            headingLevel={3}
          />
        </div>
      )}
    </div>
  );
}
