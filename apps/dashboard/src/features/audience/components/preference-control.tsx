"use client";
import { useRouter } from "next/navigation";
import { useCallback, useState, type ReactElement } from "react";
import { mayReplay, useReviewedMutation } from "@/components/action-review";
import { hasSettled } from "@/components/attempt";
import { factFrame } from "@/components/fact-list";
import { FormFieldGroup } from "@/components/form-field";
import OperationResult, { type ReceiptHeadingLevel } from "@/components/operation-result";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import { PREFERENCE_CHOICE_COPY } from "../copy/preferences";
import { useSetPreference } from "../hooks/use-audience-mutations";
import type { SetPreferencePayload } from "../schemas/preference";
type PreferenceChoice = SetPreferencePayload["choice"];
const CHOICE_ORDER: readonly PreferenceChoice[] = Object.freeze(Object.keys(PREFERENCE_CHOICE_COPY)) as readonly PreferenceChoice[];
const PURPOSE_LABELS: Readonly<Record<string, string>> = { "update-email": "Update emails" };
const purposeLabelOf = (purpose: string): string => PURPOSE_LABELS[purpose] ?? purpose;
const CONTROL_COPY = {
  legend: (purpose: string): string => `${purposeLabelOf(purpose)}`,
  scope: "Applies only to this ministry’s update emails. Your other subscriptions, protected access, and financial records aren’t affected.",
  publisherTerm: "Ministry",
  purposeTerm: "List",
  selectedMarker: "active",
  pending: "Saving preference…",
  restrictedTitle: "Preference locked",
  restrictedFallback: "This subscription is restricted at the source and can’t be changed here.",
} as const;
const FIELD_LABELS: Readonly<Record<string, string>> = { membershipId: "Membership", choice: "Choice", languagePreference: "Language" };
const SENTENCE_CLASS = "text-sm text-pretty text-muted-foreground";
const TERM_CLASS = "text-muted-foreground";
const Fact = factFrame({ rowClassName: "flex min-w-0 flex-wrap items-baseline gap-2", termClassName: TERM_CLASS, valueClassName: "min-w-0" });
export type PreferenceControlProps = {
  readonly scope: Scope;
  readonly membershipId: string;
  readonly publisherId: string;
  readonly purpose: string;
  readonly currentChoice: PreferenceChoice;
  readonly expectedRevision: string;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly onSettled?: (outcome: MutationOutcome) => void;
  readonly onCheckResult?: () => void;
  readonly headingLevel?: ReceiptHeadingLevel;
  readonly className?: string;
};
/** One reader's Off or Immediate choice for one publisher and purpose, with the reviewed save that records it. */
export default function PreferenceControl({ scope, membershipId, publisherId, purpose, currentChoice, expectedRevision, disabled = false, disabledReason, onSettled, onCheckResult, headingLevel, className }: PreferenceControlProps): ReactElement {
  const setPreference = useSetPreference();
  const mutatePreference = setPreference.mutateAsync;
  const router = useRouter();
  const submitPreference = useCallback(async (input: MutationInput<SetPreferencePayload>): Promise<MutationOutcome> => mutatePreference({ operationId: input.operationId, scope: input.scope, expectedRevision: input.expectedRevision, payload: input.payload }), [mutatePreference]);
  const { operationId, submit, retry, reapply, pending, outcome } = useReviewedMutation<SetPreferencePayload>(submitPreference);
  const [requested, setRequested] = useState<PreferenceChoice | null>(null);
  const [acknowledgedRevision, setAcknowledgedRevision] = useState<string | null>(null);
  const selection = requested ?? currentChoice;
  const revision = acknowledgedRevision ?? expectedRevision;
  const statedReason = (disabledReason ?? "").trim();
  const adopt = (result: MutationOutcome): void => {
    const acknowledged = result.outcome === "accepted" || result.outcome === "alreadyAccepted" || result.outcome === "unchanged" ? result.revision : result.outcome === "conflict" ? result.currentRevision : null;
    if (acknowledged !== null) setAcknowledgedRevision(acknowledged);
    // The recorded choice this control is composed beside is the page's own server read, and no client query mounts that read, so the route is asked to read itself again after a result that stands; a refusal changed nothing, so it asks for nothing. The receipt below is this component's own state, so it stays on screen across that re-read.
    if (hasSettled(result)) router.refresh();
    onSettled?.(result);
  };
  const choose = async (next: PreferenceChoice): Promise<void> => {
    if (disabled) return;
    setRequested(next);
    adopt(await submit({ scope, expectedRevision: revision, payload: { membershipId, choice: next } }));
  };
  const settleAttempt = async (run: () => Promise<MutationOutcome | null>): Promise<void> => {
    const result = await run();
    if (result !== null) adopt(result);
  };
  const reapplyOnConflict = outcome?.outcome === "conflict" ? (): void => void settleAttempt(reapply) : undefined;
  return (
    <section
      data-slot="preference-control"
      data-publisher-id={publisherId}
      data-purpose={purpose}
      data-recorded-choice={currentChoice}
      data-selected-choice={selection}
      data-state={pending ? "working" : (outcome?.outcome ?? "recorded")}
      data-operation-id={operationId ?? undefined}
      aria-busy={pending ? true : undefined}
      className={cn("flex min-w-0 flex-col gap-4", className)}
    >
      <FormFieldGroup legend={CONTROL_COPY.legend(purpose)} name="preference-choice" description={CONTROL_COPY.scope}>
        {(group) => {
          const choicesId = `${group.legendId}-choices`;
          const describedBy = [group.describedBy, choicesId].filter((id) => id !== undefined && id !== "").join(" ");
          return (
            <div className="flex min-w-0 flex-col gap-3">
              <dl className="flex min-w-0 flex-col gap-1 text-sm sm:flex-row sm:flex-wrap sm:gap-x-6">
                <Fact term={CONTROL_COPY.publisherTerm} value={<bdi className="mono-identifier min-w-0 wrap-anywhere">{publisherId}</bdi>} />
                <Fact term={CONTROL_COPY.purposeTerm} value={purposeLabelOf(purpose)} />
              </dl>
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/80 bg-card px-3.5 py-3 shadow-2xs">
                <div className="flex min-w-0 items-center gap-3">
                  <Switch id={`${group.legendId}-switch`} checked={selection === "immediate"} disabled={disabled || pending} aria-labelledby={group.legendId} aria-describedby={describedBy === "" ? undefined : describedBy} onCheckedChange={(checked) => void choose(checked ? "immediate" : "off")} />
                  <span className="text-sm font-medium text-foreground">{PREFERENCE_CHOICE_COPY[selection].label}</span>
                </div>
                <span className="rounded-4xl border border-border/80 bg-surface-subtle px-2.5 py-0.5 text-xs text-muted-foreground">{selection === "immediate" ? "Notifications on" : "Notifications off"}</span>
              </div>
              <p {...{ "data-slot": "preference-announcement", "aria-live": "polite", className: "sr-only" }}>{PREFERENCE_CHOICE_COPY[selection].announcement}</p>
              <ul id={choicesId} className="grid min-w-0 gap-2 text-sm sm:grid-cols-2">
                {CHOICE_ORDER.map((choice) => {
                  const wording = PREFERENCE_CHOICE_COPY[choice];
                  const active = choice === selection;
                  return (
                    <li key={choice} data-choice={choice} data-selected={active ? "true" : "false"} className={cn("flex min-w-0 flex-col gap-1 rounded-xl border p-3 transition-colors", active ? "border-foreground/30 bg-card shadow-2xs" : "border-border/70 bg-surface-subtle")}>
                      <p className="flex min-w-0 flex-wrap items-baseline gap-2">
                        <span className={cn("font-medium", active ? "text-foreground" : "text-muted-foreground")}>{wording.label}</span>
                        {active ? <span className="text-xs text-muted-foreground">{CONTROL_COPY.selectedMarker}</span> : null}
                      </p>
                      <p className={cn("min-w-0", SENTENCE_CLASS)}>{wording.description}</p>
                    </li>
                  );
                })}
              </ul>
              {pending ? <output className={cn("block min-w-0", SENTENCE_CLASS)}>{CONTROL_COPY.pending}</output> : null}
              {disabled ? (
                <Alert role={undefined}>
                  <AlertTitle>{CONTROL_COPY.restrictedTitle}</AlertTitle>
                  <AlertDescription>
                    <p>{statedReason === "" ? CONTROL_COPY.restrictedFallback : statedReason}</p>
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          );
        }}
      </FormFieldGroup>
      {pending || outcome === null ? null : (
        <OperationResult outcome={outcome} headingLevel={headingLevel} onCheckResult={outcome.outcome === "unknown" ? onCheckResult : undefined} onRetrySameWork={mayReplay(outcome) ? () => void settleAttempt(retry) : undefined} onReapply={reapplyOnConflict} fieldLabels={FIELD_LABELS} />
      )}
    </section>
  );
}
