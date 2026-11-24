"use client";
import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type ReactElement } from "react";
import ActionReview, { type MutationSubmit } from "@/components/action-review";
import { factFrame } from "@/components/fact-list";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { InitiativeMemberRecord, MutationInput, MutationOutcome, ReadAction, Scope } from "@/modules/data-service";
import { MEMBERSHIP_RULES_COPY, MEMBERSHIP_STATE_COPY, REQUESTED_TERMS_COPY, STAGE_SELECTOR_COPY, STAGE_STATE_COPY, type StageState } from "../copy";
import { useSetStage } from "../hooks/use-initiative-mutations";
import { isAdmittedStage, type StagePayload } from "../schemas/stage";
const ABSENT_OPTION_VALUE = "";
type StageSourceState = Exclude<StageState, "recorded" | "retired">;
type StagePresentation = { readonly variant: "secondary" | "outline"; readonly offersControls: boolean };
const STAGE_PRESENTATION: Readonly<Record<StageState, StagePresentation>> = { recorded: { variant: "secondary", offersControls: true }, retired: { variant: "outline", offersControls: true }, denied: { variant: "outline", offersControls: false }, unavailable: { variant: "outline", offersControls: false } };
export type StageSelectorMember = { readonly memberId: string; readonly stage: InitiativeMemberRecord["stage"]; readonly revision: string; readonly state?: InitiativeMemberRecord["state"] | undefined; readonly partnerDisplayName?: string | null | undefined };
export interface StageSelectorProps {
  readonly initiativeId: string;
  readonly member: StageSelectorMember;
  readonly admittedStages: readonly string[];
  readonly scope: Scope;
  readonly expectedRevision: string;
  readonly stageAction?: ReadAction | undefined;
  readonly stageSourceState?: StageSourceState | undefined;
  readonly onOutcome?: ((outcome: MutationOutcome) => void) | undefined;
  readonly onReturn?: ((memberId: string) => void) | undefined;
  readonly onCheckResult?: (() => void) | undefined;
  readonly className?: string;
}
type StageIntent = { readonly stage: string | null; readonly expectedRevision: string };
type RecordedStage = { readonly memberId: string; readonly stage: string | null; readonly revision: string };
const carriedForward = (recorded: RecordedStage | null, member: StageSelectorMember): RecordedStage | null => (recorded === null || recorded.memberId !== member.memberId || recorded.revision === member.revision ? null : recorded);
type PendingAttempt = { readonly operationId: string; readonly resolve: (outcome: MutationOutcome) => void };
const stageStateOf = (stage: string | null, admittedStages: readonly string[], sourceState: StageSourceState | undefined): StageState | null => (sourceState !== undefined ? sourceState : stage === null ? null : isAdmittedStage(admittedStages, stage) ? "recorded" : "retired");
const presentationOf = (state: StageState | null): StagePresentation => (state === null ? { variant: "outline", offersControls: true } : STAGE_PRESENTATION[state]);
const stageTextOf = (stage: string | null): string => (stage === null ? REQUESTED_TERMS_COPY.notStated : stage);
const StageFact = factFrame({ rowClassName: "flex min-w-0 flex-wrap items-baseline gap-x-2", termClassName: "font-medium", valueClassName: "min-w-0 wrap-anywhere" });
const StageComparison = ({ recorded, intended }: { readonly recorded: string | null; readonly intended: string | null }): ReactElement => (
  <dl className="flex min-w-0 flex-col gap-1.5">
    <StageFact term={"Recorded stage"} value={<bdi>{stageTextOf(recorded)}</bdi>} />
    <StageFact term={"Stage after this change"} value={<bdi>{stageTextOf(intended)}</bdi>} />
  </dl>
);
const FIELD_LABELS: Readonly<Record<string, string>> = { initiativeId: "Initiative", memberId: "Working-list member", stage: STAGE_SELECTOR_COPY.label };
function changeRefusalOf(member: StageSelectorMember, stageAction: ReadAction | undefined): string | null {
  return member.state !== undefined && member.state !== "included" ? MEMBERSHIP_STATE_COPY[member.state].description : stageAction !== undefined && !stageAction.available ? (stageAction.reason ?? "The stage of this working-list member cannot be changed in the current session.") : null;
}
/** One working-list member's stage: the closed choice, the state it stands in, the two explicit actions, and the review-then-receipt every real change goes through. */
export default function StageSelector({ initiativeId, member, admittedStages, scope, expectedRevision, stageAction, stageSourceState, onOutcome, onReturn, onCheckResult, className }: StageSelectorProps): ReactElement {
  const selectId = useId();
  const helpId = useId();
  const reasonId = useId();
  const clearHelpId = useId();
  const [intent, setIntent] = useState<StageIntent | null>(null);
  const [note, setNote] = useState<{ readonly text: string; readonly sequence: number } | null>(null);
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
  useEffect(() => {
    if (mutationState.status === "submitting") {
      inFlightRef.current = true;
      return;
    }
    const pending = pendingRef.current;
    if (pending === null) return;
    if (mutationState.status === "settled") {
      inFlightRef.current = false;
      if (settledRef.current === mutationState.outcome) return;
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
  const submit = useCallback<MutationSubmit<StagePayload>>(
    (input: MutationInput<StagePayload>) =>
      new Promise<MutationOutcome>((resolve) => {
        pendingRef.current = { operationId: input.operationId, resolve };
        dispatchStage({ operationId: input.operationId, expectedRevision: input.expectedRevision, payload: input.payload });
      }),
    [dispatchStage],
  );
  const announce = useCallback((text: string): void => setNote((current) => ({ text, sequence: (current?.sequence ?? 0) + 1 })), []);
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
      setIntent({ stage, expectedRevision: recordedRevision });
      setNote(null);
    },
    [admittedStages, announce, recordedRevision, recordedStage],
  );
  const handleSettled = useCallback(
    (outcome: MutationOutcome): void => {
      if (intent !== null && (outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unchanged")) setRecorded({ memberId: member.memberId, stage: intent.stage, revision: outcome.revision });
      onOutcome?.(outcome);
    },
    [intent, member.memberId, onOutcome],
  );
  const memberName = (member.partnerDisplayName ?? "").trim() || member.memberId;
  const stageState = stageStateOf(recordedStage, admittedStages, stageSourceState);
  const presentation = presentationOf(stageState);
  const refusedReason = changeRefusalOf(member, stageAction);
  const offersStageChoice = presentation.offersControls && refusedReason === null;
  const offersClear = offersStageChoice && recordedStage !== null;
  const offersReturn = onReturn !== undefined && member.state === "removed";
  const shownValue: string | null = intent === null ? recordedStage : intent.stage;
  const handleSelectChange = (event: ChangeEvent<HTMLSelectElement>): void => beginChange(event.target.value === ABSENT_OPTION_VALUE ? null : event.target.value);
  return (
    <div data-slot="stage-selector" data-member-id={member.memberId} data-stage-state={stageState ?? undefined} className={cn("flex min-w-0 flex-col gap-2", className)}>
      {stageState === null ? null : (
        <p className="flex min-w-0 flex-wrap items-baseline gap-2">
          <Badge variant={presentation.variant}>{STAGE_STATE_COPY[stageState].label}</Badge> <span className="min-w-0 text-xs text-pretty text-muted-foreground">{STAGE_STATE_COPY[stageState].description}</span>
        </p>
      )}
      {presentation.offersControls ? (
        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor={selectId}>
            {STAGE_SELECTOR_COPY.label}
            <span className="sr-only">
              {" for "}
              <bdi>{memberName}</bdi>
            </span>
          </Label>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <NativeSelect id={selectId} value={shownValue ?? ABSENT_OPTION_VALUE} disabled={!offersStageChoice} aria-describedby={refusedReason === null ? helpId : `${helpId} ${reasonId}`} onChange={handleSelectChange} className="max-w-full">
              {shownValue === null ? <NativeSelectOption value={ABSENT_OPTION_VALUE}>{stageTextOf(null)}</NativeSelectOption> : null}
              {recordedStage !== null && !isAdmittedStage(admittedStages, recordedStage) ? <NativeSelectOption value={recordedStage ?? ABSENT_OPTION_VALUE}>{`${stageTextOf(recordedStage)} — ${STAGE_STATE_COPY.retired.label}`}</NativeSelectOption> : null}
              {admittedStages.map((stage) => (
                <NativeSelectOption key={stage} value={stage}>
                  {stage}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {offersClear || offersReturn ? (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" />} aria-describedby={helpId}>
                  {"Stage actions"}
                  <span className="sr-only">
                    {" for "}
                    <bdi>{memberName}</bdi>
                  </span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-72 max-w-full">
                  {offersClear ? <DropdownMenuItem {...{ "aria-describedby": clearHelpId, className: "py-2", onClick: () => beginChange(null) }}>{STAGE_SELECTOR_COPY.clearLabel}</DropdownMenuItem> : null}
                  {offersClear && offersReturn ? <DropdownMenuSeparator /> : null}
                  {offersReturn ? <DropdownMenuItem {...{ className: "py-2 text-pretty", onClick: () => onReturn?.(member.memberId) }}>{MEMBERSHIP_RULES_COPY.returnRestoresEligiblePlanning}</DropdownMenuItem> : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
          <p {...{ id: helpId, className: "text-xs text-pretty text-muted-foreground" }}>{STAGE_SELECTOR_COPY.help}</p>
          {offersClear ? <p {...{ id: clearHelpId, className: "text-xs text-pretty text-muted-foreground" }}>{STAGE_SELECTOR_COPY.clearHelp}</p> : null}
          {refusedReason === null ? null : (
            <Alert id={reasonId} role={undefined} className="px-3 py-2">
              <AlertDescription>{refusedReason}</AlertDescription>
            </Alert>
          )}
          {offersReturn ? <p className="text-xs text-pretty text-muted-foreground">{STAGE_SELECTOR_COPY.movedToListNote}</p> : null}
          <p className="text-xs text-pretty text-muted-foreground">{STAGE_SELECTOR_COPY.noTaskCreatedNote}</p>
        </div>
      ) : null}
      <output {...{ "aria-live": "polite", "aria-atomic": "true", className: "block text-xs text-pretty text-muted-foreground" }}>{note?.text ?? ""}</output>
      {intent === null ? null : (
        <div className="flex min-w-0 flex-col gap-3">
          <Separator />
          <ActionReview<StagePayload>
            title={STAGE_SELECTOR_COPY.label}
            description={
              <div className="flex min-w-0 flex-col gap-2">
                <StageComparison recorded={recordedStage} intended={intent.stage} /> {intent.stage === null ? <p>{STAGE_SELECTOR_COPY.clearHelp}</p> : null} <p>{STAGE_SELECTOR_COPY.noTaskCreatedNote}</p>
              </div>
            }
            confirmLabel={intent.stage === null ? STAGE_SELECTOR_COPY.clearLabel : "Record this stage"}
            onCancel={() => setIntent(null)}
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
