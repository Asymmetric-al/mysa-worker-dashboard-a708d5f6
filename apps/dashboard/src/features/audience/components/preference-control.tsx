"use client";
/**
 * The reader's one Off/Immediate choice for a single publisher and single purpose: both words and what each of them
 * means, the control that records one of them, and the receipt of what the service answered.
 *
 * **One control, resolved against the component map.** AAP 0.4.2 assigns `RadioGroup` to reach, publish-versus-notify
 * and target period, and to nothing in this family, so the two-value preference is carried by the installed `Switch`
 * with both words — Off and Immediate — always rendered as text from `../copy/preferences`. One control over one copy
 * module is what keeps the switch and the words from ever describing two different closed sets; a radio group beside it
 * would be a second implementation of the same choice.
 *
 * **What this file owns, and what it does not.** The attempt's identity, the in-flight fence, replay and re-apply
 * belong to `useReviewedMutation` (`@/components/action-review`); the transport and the revalidation of this family's
 * reads belong to `useSetPreference`; the meaning of every answer belongs to the service and is rendered by
 * `OperationResult` alone. This surface sends the choice and nothing else: the reading language is a separate
 * preference owned by `language-preference.tsx`, so neither control can be read as consenting to the other. Both submit
 * against the same expected revision, so whichever saves second is answered with a `conflict` that preserves its input
 * rather than silently overwriting the other.
 */
import { useCallback, useState, type ReactElement } from "react";
import { mayReplay, useReviewedMutation } from "@/components/action-review";
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
/** The closed pair of choices, taken from the payload schema so this file never restates a member of the union. */
type PreferenceChoice = SetPreferencePayload["choice"];
/**
 * The two choices in the order the copy module declares them, Off then Immediate: the words are listed from that one
 * source, so a member added to the union without wording appears here rather than being silently dropped.
 */
const CHOICE_ORDER: readonly PreferenceChoice[] = Object.freeze(Object.keys(PREFERENCE_CHOICE_COPY)) as readonly PreferenceChoice[];
/** The words this surface uses for the purpose the read reported. A purpose it has no wording for is stated as the read named it, never relabelled. */
const PURPOSE_LABELS: Readonly<Record<string, string>> = { "update-email": "Update email" };
function purposeLabelOf(purpose: string): string {
  return PURPOSE_LABELS[purpose] ?? purpose;
}
const CONTROL_COPY = {
  legend: (purpose: string): string => `${purposeLabelOf(purpose)} from this publisher`,
  scope: "This choice covers one publisher and one purpose only. It subscribes you to nothing else, grants no access to protected content and changes no financial record, and choosing it is your own decision rather than a restriction placed on you.",
  publisherTerm: "Publisher",
  purposeTerm: "Purpose",
  selectedMarker: "selected here",
  pending: "Submitting this choice…",
  restrictedTitle: "This choice cannot be changed here",
  restrictedFallback: "This membership is restricted by the source of record, so no choice is offered for it.",
} as const;
/** The names an `invalid` outcome may key its messages by, said as the words this surface uses for them. */
const FIELD_LABELS: Readonly<Record<string, string>> = { membershipId: "Membership", choice: "Choice", languagePreference: "Language" };
const ROOT_CLASS = "flex min-w-0 flex-col gap-4";
const SENTENCE_CLASS = "text-sm text-pretty text-muted-foreground";
const IDENTIFIER_CLASS = "mono-identifier min-w-0 wrap-anywhere";
const TERM_CLASS = "text-muted-foreground";
export type PreferenceControlProps = {
  /** The authority this change is submitted in. The service re-resolves it from the session and re-checks the membership, so this is the caller's claim and not an authority it grants. */
  readonly scope: Scope;
  /** The membership this choice belongs to, exactly as the preferences read published it. It names the publisher and the purpose, which is why the payload carries neither a second copy of them. */
  readonly membershipId: string;
  /** The publisher whose Update email this choice is about, shown in the text so the scope cannot be mistaken for a global setting. An opaque reference, never a key anything is looked up by. */
  readonly publisherId: string;
  /** The purpose the membership was opened for, as the read reported it. */
  readonly purpose: string;
  /** The choice the record holds now. The switch starts here, and a new read of the preferences replaces it. */
  readonly currentChoice: PreferenceChoice;
  /** The revision the caller read. A stale one is answered `conflict` with this surface's choice preserved rather than overwriting the other control's save. */
  readonly expectedRevision: string;
  /** Whether the membership refuses any choice at all, as a restricted source membership does. */
  readonly disabled?: boolean;
  /** Why no choice is offered, when the caller knows the reason. The fallback states the restricted membership when it is absent. */
  readonly disabledReason?: string;
  /** Called with every outcome this surface settles, so the caller can reconcile whatever it derived from the read. */
  readonly onSettled?: (outcome: MutationOutcome) => void;
  /** Reads the result of a change whose acknowledgement was lost. Recovery is by operation identity, so this re-reads rather than re-sending. */
  readonly onCheckResult?: () => void;
  /** The heading level of the receipt, so it nests under whatever heading the page around it reaches. */
  readonly headingLevel?: ReceiptHeadingLevel;
  readonly className?: string;
};

/** One reader's Off or Immediate choice for one publisher and purpose, with the reviewed save that records it. */
export default function PreferenceControl({ scope, membershipId, publisherId, purpose, currentChoice, expectedRevision, disabled = false, disabledReason, onSettled, onCheckResult, headingLevel, className }: PreferenceControlProps): ReactElement {
  const setPreference = useSetPreference();
  const mutatePreference = setPreference.mutateAsync;
  // The four fields travel unchanged: this file neither mints the operation id nor rewrites the scope, the revision or the payload on their way out.
  const submitPreference = useCallback(
    async (input: MutationInput<SetPreferencePayload>): Promise<MutationOutcome> =>
      mutatePreference({ operationId: input.operationId, scope: input.scope, expectedRevision: input.expectedRevision, payload: input.payload }),
    [mutatePreference],
  );
  const { operationId, submit, retry, reapply, pending, outcome } = useReviewedMutation<SetPreferencePayload>(submitPreference);
  // The choice the person asked for, held apart from the choice the read published: the switch shows the request while it is in flight, and the receipt — not this state — states what the record holds.
  const [requested, setRequested] = useState<PreferenceChoice | null>(null);
  // The freshest revision the service has reported to this surface, so a second choice is not submitted against a revision the first one already replaced.
  const [acknowledgedRevision, setAcknowledgedRevision] = useState<string | null>(null);
  const selection = requested ?? currentChoice;
  const revision = acknowledgedRevision ?? expectedRevision;
  const statedReason = (disabledReason ?? "").trim();
  const restrictedReason = statedReason === "" ? CONTROL_COPY.restrictedFallback : statedReason;
  const adopt = (result: MutationOutcome): void => {
    switch (result.outcome) {
      case "accepted":
      case "alreadyAccepted":
      case "unchanged":
        setAcknowledgedRevision(result.revision);
        break;
      case "conflict":
        // The record stands at the revision the answer reports, so re-applying this surface's choice is judged against that one rather than against the revision it replaced.
        setAcknowledgedRevision(result.currentRevision);
        break;
      default:
        break;
    }
    onSettled?.(result);
  };
  const choose = async (next: PreferenceChoice): Promise<void> => {
    if (disabled) {
      return;
    }
    setRequested(next);
    // No attempt is reset here: an unchanged intent keeps the identity `useReviewedMutation` already holds, so choosing the same value again is answered with the original result instead of a second effect.
    adopt(await submit({ scope, expectedRevision: revision, payload: { membershipId, choice: next } }));
  };
  const replay = async (): Promise<void> => {
    const result = await retry();
    if (result !== null) {
      adopt(result);
    }
  };
  const applyAgain = async (): Promise<void> => {
    const result = await reapply();
    if (result !== null) {
      adopt(result);
    }
  };
  return (
    <section
      data-slot="preference-control"
      data-publisher-id={publisherId}
      data-purpose={purpose}
      data-recorded-choice={currentChoice}
      data-selected-choice={selection}
      data-state={pending ? "working" : (outcome?.outcome ?? "recorded")}
      /* The identity the last attempt was made under, so a repeated press can be shown to have produced one effect. */
      data-operation-id={operationId ?? undefined}
      aria-busy={pending ? true : undefined}
      className={cn(ROOT_CLASS, className)}
    >
      {/* The group owns the name: Base UI's switch renders a span with a hidden input beside it, so the single labelled
          control's field primitive would point a label's `for` at that hidden input and leave the span unnamed, while
          the group's legend is what `aria-labelledby` can name the span with. */}
      <FormFieldGroup legend={CONTROL_COPY.legend(purpose)} name="preference-choice" description={CONTROL_COPY.scope}>
        {(group) => {
          const switchId = `${group.legendId}-switch`;
          const choicesId = `${group.legendId}-choices`;
          const describedBy = [group.describedBy, choicesId].filter((id) => id !== undefined && id !== "").join(" ");
          return (
            <div className="flex min-w-0 flex-col gap-3">
              <dl className="flex min-w-0 flex-col gap-1 text-sm sm:flex-row sm:flex-wrap sm:gap-x-6">
                <div className="flex min-w-0 flex-wrap items-baseline gap-2">
                  <dt className={TERM_CLASS}>{CONTROL_COPY.publisherTerm}</dt>
                  <dd className="min-w-0">
                    <bdi className={IDENTIFIER_CLASS}>{publisherId}</bdi>
                  </dd>
                </div>
                <div className="flex min-w-0 flex-wrap items-baseline gap-2">
                  <dt className={TERM_CLASS}>{CONTROL_COPY.purposeTerm}</dt>
                  <dd className="min-w-0">{purposeLabelOf(purpose)}</dd>
                </div>
              </dl>
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <Switch
                  id={switchId}
                  // Immediate is the on position and Off the off position; both words are spelled out in the list below, so the switch never carries the choice alone.
                  checked={selection === "immediate"}
                  disabled={disabled || pending}
                  aria-labelledby={group.legendId}
                  aria-describedby={describedBy === "" ? undefined : describedBy}
                  onCheckedChange={(checked) => {
                    void choose(checked ? "immediate" : "off");
                  }}
                />
                <span className="text-sm font-medium text-foreground">{PREFERENCE_CHOICE_COPY[selection].label}</span>
              </div>
              {/* The active choice is announced as a sentence rather than shown by colour alone, and the copy module owns what the sentence promises. */}
              <p data-slot="preference-announcement" aria-live="polite" className="sr-only">
                {PREFERENCE_CHOICE_COPY[selection].announcement}
              </p>
              <ul id={choicesId} className="flex min-w-0 flex-col gap-2 text-sm">
                {CHOICE_ORDER.map((choice) => {
                  const wording = PREFERENCE_CHOICE_COPY[choice];
                  const active = choice === selection;
                  return (
                    <li key={choice} data-choice={choice} data-selected={active ? "true" : "false"} className="flex min-w-0 flex-col gap-0.5">
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
                // A standing explanation rather than an announcement: nothing changed, so nothing is spoken on render.
                <Alert role={undefined}>
                  <AlertTitle>{CONTROL_COPY.restrictedTitle}</AlertTitle>
                  <AlertDescription>
                    <p>{restrictedReason}</p>
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          );
        }}
      </FormFieldGroup>
      {/* The receipt is hidden while a further attempt is in flight, so a settled answer never stands beside a new request as if it described it. */}
      {pending || outcome === null ? null : (
        <OperationResult
          outcome={outcome}
          headingLevel={headingLevel}
          onCheckResult={outcome.outcome === "unknown" ? onCheckResult : undefined}
          onRetrySameWork={
            mayReplay(outcome)
              ? () => {
                  void replay();
                }
              : undefined
          }
          onReapply={
            outcome.outcome === "conflict"
              ? () => {
                  void applyAgain();
                }
              : undefined
          }
          fieldLabels={FIELD_LABELS}
        />
      )}
    </section>
  );
}
