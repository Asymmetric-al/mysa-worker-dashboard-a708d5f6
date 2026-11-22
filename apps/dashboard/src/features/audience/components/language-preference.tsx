"use client";
/**
 * The reader's reading language for one publisher's Update email.
 *
 * Language is a preference of its own. It is not the Off or Immediate choice and it is not proof that the address
 * this membership is set for can be read, so this surface has its own fieldset, its own selection state, its own
 * Save control and its own submitted payload: nothing here is folded into a consent control, saving subscribes
 * nobody, and a notification already submitted, or still awaiting its outcome, keeps the edition it was pinned to.
 *
 * The languages offered are the ones the caller's read made available. No tag is invented here, and the line beside
 * the select is read from the envelope rather than patched locally, so it states the record's own value after a save.
 *
 * The attempt's identity belongs to `useReviewedMutation`, so a retry replays one intent under one `operationId` and a
 * changed selection draws a new one; the transport belongs to `useSetPreference`.
 */
import { useCallback, useState, type ReactElement } from "react";
import { intentKeyOf, mayReplay, reappliableRevision, useReviewedMutation, type MutationSubmit } from "@/components/action-review";
import { FormField, FormFieldGroup } from "@/components/form-field";
import OperationResult from "@/components/operation-result";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/cn";
import type { Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import { LANGUAGE_PREFERENCE_COPY } from "../copy/preferences";
import { useSetPreference } from "../hooks/use-audience-mutations";
import type { SetPreferencePayload } from "../schemas/preference";
/** One language the caller's read made available for this membership. The tag is the value submitted; nothing here adds one. */
export type LanguageOption = { readonly tag: string; readonly label: string; readonly direction?: "ltr" | "rtl" };
const SAVE_LABEL = "Save language";
const SELECT_LABEL = "Reading language";
const OFFERED_GROUP_LABEL = "Languages this publisher offers";
const RECORDED_GROUP_LABEL = "Language recorded now, not offered here";
const UNCHOSEN_LABEL = "A language has not been chosen yet";
const WORKING_NOTE = "Saving the reading language — working. Nothing else on this page changes.";
const UNSAVED_LEAD = "Not saved yet:";
const UNSAVED_TAIL = "Nothing has been written, and saving is your own deliberate act.";
const CONTEXT_LEAD = "This preference applies to notices from";
const CONTEXT_PURPOSE_LEAD = "for the purpose";
const CONTEXT_TAIL = "No other publisher, purpose or record about you is affected.";
const UNNAMED_PUBLISHER = "a publisher this read does not name";
const AUTHORITY_REASON = "This session cannot change the reading language for this membership.";
const NO_LANGUAGES = "This publisher offers no language this page can list, so there is nothing to choose here and nothing was written.";
const NOT_OFFERED_HINT = "The language recorded now is not one this publisher offers here, so choose one of the offered languages and save it.";
const NO_LANGUAGE_YET_HINT = "No language is recorded for this membership yet. Choose one and save it to state how you read this publisher's Updates.";
const NOTHING_TO_SAVE_HINT = "Choose a language other than the one recorded, then save it.";
const FIELD_LABELS: Readonly<Record<string, string | undefined>> = { membershipId: "Membership", choice: "Off or Immediate", languagePreference: SELECT_LABEL };
/** The comparison key of a language tag: BCP-47 tags are case-insensitive, so two spellings are one language. */
function tagKey(tag: string): string {
  return tag.trim().toLowerCase();
}
/** The offerable languages, in the caller's order, with a repeated tag collapsed and a blank one left out. */
function offeredLanguages(options: readonly LanguageOption[]): readonly LanguageOption[] {
  const seen = new Set<string>();
  const offered: LanguageOption[] = [];
  for (const option of options) {
    const tag = option.tag.trim();
    const key = tagKey(tag);
    if (key === "" || seen.has(key)) {
      continue;
    }
    seen.add(key);
    const label = option.label.trim();
    offered.push({ tag, label: label === "" ? tag : label, ...(option.direction === undefined ? {} : { direction: option.direction }) });
  }
  return offered;
}
/** The label one tag is offered under, or the tag itself when the offered set does not name it. */
function languageLabel(tag: string, offered: readonly LanguageOption[]): string {
  const key = tagKey(tag);
  return offered.find((option) => tagKey(option.tag) === key)?.label ?? tag.trim();
}
/** The language one answer states inside a record it carries, or `null` when it states none this surface can read. */
function statedLanguage(value: unknown): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const stated: unknown = Reflect.get(value as Readonly<Record<string, unknown>>, "languagePreference");
  return typeof stated === "string" && stated.trim() !== "" ? stated.trim() : null;
}
/** One language stated in running text, isolated so a right-to-left name cannot reorder the sentence around it. */
function StatedLanguage({ tag, offered }: { readonly tag: string; readonly offered: readonly LanguageOption[] }): ReactElement {
  const trimmed = tag.trim();
  if (trimmed === "") {
    return <span className="font-medium">no language</span>;
  }
  const label = languageLabel(trimmed, offered);
  return (
    <>
      <bdi className="min-w-0 font-medium wrap-anywhere">{label}</bdi>
      {label === trimmed ? null : <bdi className="mono-identifier text-muted-foreground">{` (${trimmed})`}</bdi>}
    </>
  );
}
/**
 * What one settled outcome means for this membership, beyond the receipt's own account of it.
 *
 * A conflict states the stored value beside the selection that was kept, because the service answers with both and
 * neither side overwrote the other. An acceptance states the one thing this save could not have done.
 */
function outcomeStatement(outcome: MutationOutcome, context: { readonly offered: readonly LanguageOption[]; readonly stored: string; readonly selection: string | null }): ReactElement | null {
  if (outcome.outcome === "conflict") {
    const held = statedLanguage(outcome.current) ?? context.stored;
    const kept = statedLanguage(outcome.preservedInput) ?? context.selection ?? "";
    return (
      <p className="text-sm text-pretty wrap-anywhere">
        {"The record holds "}
        <StatedLanguage tag={held} offered={context.offered} />
        {" now, and your selection "}
        <StatedLanguage tag={kept} offered={context.offered} />
        {" was not applied. Nothing was overwritten in either direction: re-apply your selection deliberately, or choose again above."}
      </p>
    );
  }
  if (outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted") {
    return (
      <p className="text-sm text-pretty wrap-anywhere">
        {"The language above is read from the service rather than assumed here, so it states the record's own value. This save changed the language only: the Off or Immediate choice was sent exactly as it was read, and no notification already submitted, or still awaiting its outcome, was reset."}
      </p>
    );
  }
  if (outcome.outcome === "unchanged") {
    return <p className="text-sm text-pretty wrap-anywhere">{"Nothing needed changing, so nothing was written and no notification was touched. The language above is the record's own value."}</p>;
  }
  // Every other outcome — a refusal, a denial, an outage, an unconfirmed attempt — is reported in full by the receipt,
  // and none of them recorded a language. A sentence here would let it be read as a save that happened.
  return null;
}

export type LanguagePreferenceProps = {
  /** The authority this preference is recorded under: the scope the preferences read ran in. */
  readonly scope: Scope;
  /** The membership whose reading language this is. The payload names it, so nothing is addressed by an email address or a name. */
  readonly membershipId: string;
  /** The publisher the membership is for, as the read states it, or `null` when that read names none. */
  readonly publisherId: string | null;
  /** The purpose the membership exists for, stated beside the choice so the scope of this preference is visible. */
  readonly purpose: string;
  /**
   * The Off or Immediate choice the read states, restated in the payload exactly as it stands.
   *
   * The preference mutation records the choice together with the language, so the payload has to state it; sending it
   * unchanged is what keeps a language save from being a second consent decision. A consent change made elsewhere
   * advances the membership's revision, so a restated value that has since moved answers `conflict` instead of
   * overwriting it.
   */
  readonly currentChoice: SetPreferencePayload["choice"];
  /** The language the read states for this membership, or `null` when none is recorded. */
  readonly currentLanguage: string | null;
  /** The revision the caller read: any change that wins the race makes this write a conflict rather than an overwrite. */
  readonly expectedRevision: string;
  /** The languages the read made available for this membership and publisher. Never a list this component supplies. */
  readonly languageOptions: readonly LanguageOption[];
  /** Recovers an unconfirmed attempt by reading the result again. Offered for `unknown` only, and never as a resend. */
  readonly onCheckResult?: () => void;
  /**
   * Asks the caller to read this membership again after an accepting answer.
   *
   * The value beside the control is the envelope's own, never a copy of what this form submitted, so an acceptance has
   * to bring a fresh read back: this callback is how the caller refetches or re-renders the surface that holds it. A
   * caller that omits it leaves the line stating the previous read until the next render, and this control then stops
   * claiming the selection is unsaved rather than contradicting the receipt it just rendered.
   */
  readonly onSaved?: () => void;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  /** The direction the surrounding surface is read in. Each language name is isolated in its own `<bdi>` regardless. */
  readonly dir?: "ltr" | "rtl";
  readonly headingLevel?: 2 | 3 | 4;
  readonly className?: string;
};

/**
 * The reading-language preference for one membership.
 *
 * The group is this control's own fieldset with its own legend: the Off or Immediate choice that sits elsewhere on the
 * page keeps its own state, its own submit and its own payload, and neither control reads the other's selection.
 * Nothing is written until the person activates Save, and the outcome — all eight of them — is rendered in place.
 */
export function LanguagePreference({ scope, membershipId, publisherId, purpose, currentChoice, currentLanguage, expectedRevision, languageOptions, onCheckResult, onSaved, disabled = false, disabledReason, dir, headingLevel = 2, className }: LanguagePreferenceProps): ReactElement {
  const setPreference = useSetPreference();
  const submit = useCallback<MutationSubmit<SetPreferencePayload>>((input) => setPreference.mutateAsync(input), [setPreference]);
  const review = useReviewedMutation<SetPreferencePayload>(submit);
  // The one piece of state this surface owns: the selection the person has made and not yet submitted. The saved
  // value is never copied here — it is read from the envelope on every render, so this form cannot disagree with the
  // record after a save, and a second owner of the saved value never exists.
  const [pending, setPending] = useState<string | null>(null);

  const offered = offeredLanguages(languageOptions);
  const offeredKeys = new Set(offered.map((option) => tagKey(option.tag)));
  const stored = currentLanguage?.trim() ?? "";
  const storedKey = tagKey(stored);
  const storedOffered = stored !== "" && offeredKeys.has(storedKey);
  const selected = pending ?? stored;
  const changed = pending !== null && tagKey(pending) !== storedKey;
  const noLanguages = offered.length === 0;
  const controlDisabled = disabled || noLanguages;
  const current = review.outcome;
  // The one input this control can submit: a language the offered set holds, different from the one recorded, carrying the
  // Off or Immediate value the read states unchanged. No consent, subscription or notification fact travels with it.
  const submittedTag = pending !== null && offeredKeys.has(tagKey(pending)) && tagKey(pending) !== storedKey ? pending.trim() : null;
  const attempt = submittedTag === null ? null : { scope, expectedRevision, payload: { membershipId, choice: currentChoice, languagePreference: submittedTag } };
  // Whether the outcome on screen answers this very selection: the review step fingerprints the scope, the revision and the
  // payload, so an acceptance for the language chosen now is recognisable while one for an earlier selection is not.
  const answeredHere = attempt !== null && current !== null && review.reviewedIntent === intentKeyOf(attempt) ? current : null;
  const acceptedHere = answeredHere !== null && (answeredHere.outcome === "accepted" || answeredHere.outcome === "alreadyAccepted" || answeredHere.outcome === "unchanged");
  const actionDisabled = controlDisabled || review.pending || attempt === null;
  const reason = disabled ? disabledReason?.trim() || AUTHORITY_REASON : null;
  const state = review.pending ? "working" : current === null ? "review" : "settled";
  const hint = noLanguages ? NO_LANGUAGES : stored === "" ? NO_LANGUAGE_YET_HINT : !storedOffered ? NOT_OFFERED_HINT : NOTHING_TO_SAVE_HINT;
  const statement = current === null ? null : outcomeStatement(current, { offered, stored, selection: pending });
  // A selection the service has already accepted is not unsaved, whether or not the fresh read has arrived yet.
  const showUnsaved = changed && pending !== null && !review.pending && !acceptedHere;

  // Every path that can accept a change reports its answer to the caller the same way: an accepting answer is the
  // service's word that the record now holds this language, so the caller reads it back instead of this surface
  // assuming the value. Nothing here copies a submitted value into state.
  const settle = useCallback(
    async (run: () => Promise<MutationOutcome | null>): Promise<void> => {
      const outcome = await run();
      if (outcome !== null && (outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unchanged")) {
        onSaved?.();
      }
    },
    [onSaved],
  );

  const save = (): void => {
    if (attempt === null || review.pending || disabled) {
      return;
    }
    void settle(() => review.submit(attempt));
  };

  // Focus follows each answer. The Save control disables itself while a request is in flight, which moves the keyboard to
  // the document body, so the receipt that answers the attempt is where a keyboard continues from; the region is keyed by
  // the answer it states, so a new answer remounts it and this runs again rather than leaving the keyboard on the body.
  const resultRef = useCallback((node: HTMLDivElement | null): void => {
    if (node !== null) {
      node.focus();
    }
  }, []);

  return (
    <div data-slot="language-preference" data-state={state} data-language={stored === "" ? undefined : stored} aria-busy={review.pending ? true : undefined} dir={dir} className={cn("min-w-0", className)}>
      {/* One fieldset for one preference: the legend names it, and the Off or Immediate group is not this one's parent,
          sibling state or submit. */}
      <FormFieldGroup legend={LANGUAGE_PREFERENCE_COPY.heading} name="language-preference" description={LANGUAGE_PREFERENCE_COPY.separateFromConsent} className="min-w-0">
        {() => (
          <div className="flex min-w-0 flex-col gap-4 text-start">
            <div className="flex min-w-0 flex-col gap-2 text-sm text-pretty wrap-anywhere">
              <p>{LANGUAGE_PREFERENCE_COPY.help}</p>
              <p>{LANGUAGE_PREFERENCE_COPY.separateFromProof}</p>
              <p className="text-muted-foreground">
                {`${CONTEXT_LEAD} `}
                <bdi className="mono-identifier">{publisherId === null ? UNNAMED_PUBLISHER : publisherId}</bdi>
                {` ${CONTEXT_PURPOSE_LEAD} `}
                <bdi className="mono-identifier">{purpose}</bdi>
                {`. ${CONTEXT_TAIL}`}
              </p>
            </div>
            <FormField label={SELECT_LABEL} name="language-preference-select">
              {({ id, describedBy }) => {
                const currentValueId = `${id}-current-value`;
                return (
                  <>
                    <NativeSelect id={id} className="w-full max-w-full" value={selected} aria-describedby={describedBy === undefined ? currentValueId : `${describedBy} ${currentValueId}`} disabled={controlDisabled} onChange={(event) => setPending(event.currentTarget.value)}>
                      {selected === "" ? (
                        <NativeSelectOption value="" disabled>
                          {UNCHOSEN_LABEL}
                        </NativeSelectOption>
                      ) : null}
                      {offered.length === 0 ? null : (
                        <NativeSelectOptGroup label={OFFERED_GROUP_LABEL}>
                          {offered.map((option) => (
                            <NativeSelectOption key={option.tag} value={option.tag} dir={option.direction}>
                              {option.label}
                            </NativeSelectOption>
                          ))}
                        </NativeSelectOptGroup>
                      )}
                      {/* A stored language the offered set does not name is listed in the select so the control states
                          what the record holds, and it stays unsavable: choosing it would re-save a value this publisher
                          does not offer. */}
                      {stored === "" || storedOffered ? null : (
                        <NativeSelectOptGroup label={RECORDED_GROUP_LABEL}>
                          <NativeSelectOption value={stored}>{stored}</NativeSelectOption>
                        </NativeSelectOptGroup>
                      )}
                    </NativeSelect>
                    <p id={currentValueId} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <span className="text-muted-foreground">Language recorded now:</span>
                      {stored === "" ? <span className="font-medium">no language recorded for this membership</span> : <StatedLanguage tag={stored} offered={offered} />}
                    </p>
                    {showUnsaved && pending !== null ? (
                      <output htmlFor={id} aria-atomic="true" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                        <span className="text-muted-foreground">{UNSAVED_LEAD}</span>
                        <StatedLanguage tag={pending} offered={offered} />
                        <span className="text-muted-foreground">{UNSAVED_TAIL}</span>
                      </output>
                    ) : null}
                  </>
                );
              }}
            </FormField>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Button type="button" variant="default" onClick={save} disabled={actionDisabled}>
                {SAVE_LABEL}
              </Button>
              {/* The busy condition is stated in words as well as announced, so a control that disables itself leaves
                  something to read rather than a dead button. */}
              {review.pending ? <output className="min-w-0 text-sm text-muted-foreground text-pretty wrap-anywhere">{WORKING_NOTE}</output> : null}
            </div>
            {reason !== null ? <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{reason}</p> : changed || review.pending ? null : <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{hint}</p>}
          </div>
        )}
      </FormFieldGroup>
      {current === null ? null : (
        <div key={`${current.outcome}:${current.operationId}`} ref={resultRef} tabIndex={-1} data-slot="language-preference-result" data-outcome={current.outcome} className="mt-4 flex min-w-0 flex-col gap-3">
          <OperationResult
            outcome={current}
            headingLevel={headingLevel}
            onCheckResult={current.outcome === "unknown" ? onCheckResult : undefined}
            onRetrySameWork={
              mayReplay(current)
                ? () => {
                    void settle(review.retry);
                  }
                : undefined
            }
            onReapply={
              reappliableRevision(current) === null
                ? undefined
                : () => {
                    void settle(review.reapply);
                  }
            }
            fieldLabels={FIELD_LABELS}
          />
          {statement === null ? null : <div className="min-w-0 text-muted-foreground">{statement}</div>}
        </div>
      )}
    </div>
  );
}
export default LanguagePreference;
