"use client";
import { useRouter } from "next/navigation";
import { useCallback, useState, type ReactElement } from "react";
import { intentKeyOf, mayReplay, reappliableRevision, useReviewedMutation, type MutationSubmit } from "@/components/action-review";
import { hasSettled } from "@/components/attempt";
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
/** One language the caller's read made available for this membership. The tag is the value submitted; nothing here adds one. */ export type LanguageOption = { readonly tag: string; readonly label: string; readonly direction?: "ltr" | "rtl" };
const SELECT_LABEL = "Reading language";
const NOT_OFFERED_HINT = "The language recorded now is not one this publisher offers here, so choose one of the offered languages and save it.";
const NO_LANGUAGE_YET_HINT = "No language is recorded for this membership yet. Choose one and save it to state how you read this publisher's Updates.";
const FIELD_LABELS: Readonly<Record<string, string | undefined>> = { membershipId: "Membership", choice: "Off or Immediate", languagePreference: SELECT_LABEL };
const tagKey = (tag: string): string => tag.trim().toLowerCase();
function offeredLanguages(options: readonly LanguageOption[]): readonly LanguageOption[] {
  const offered = new Map<string, LanguageOption>();
  for (const option of options) {
    const tag = option.tag.trim();
    const key = tagKey(tag);
    const label = option.label.trim();
    if (key !== "" && !offered.has(key)) offered.set(key, { tag, label: label === "" ? tag : label, ...(option.direction === undefined ? {} : { direction: option.direction }) });
  }
  return [...offered.values()];
}
function languageLabel(tag: string, offered: readonly LanguageOption[]): string {
  const key = tagKey(tag);
  return offered.find((option) => tagKey(option.tag) === key)?.label ?? tag.trim();
}
function statedLanguage(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const stated: unknown = Reflect.get(value as Readonly<Record<string, unknown>>, "languagePreference");
  return typeof stated === "string" && stated.trim() !== "" ? stated.trim() : null;
}
function StatedLanguage({ tag, offered }: { readonly tag: string; readonly offered: readonly LanguageOption[] }): ReactElement {
  const trimmed = tag.trim();
  if (trimmed === "") return <span className="font-medium">no language</span>;
  const label = languageLabel(trimmed, offered);
  return (
    <>
      <bdi className="min-w-0 font-medium wrap-anywhere">{label}</bdi>
      {label === trimmed ? null : <bdi className="mono-identifier text-muted-foreground">{` (${trimmed})`}</bdi>}
    </>
  );
}
function outcomeStatement(outcome: MutationOutcome, context: { readonly offered: readonly LanguageOption[]; readonly stored: string; readonly selection: string | null }): ReactElement | null {
  if (outcome.outcome === "conflict") {
    return (
      <p className="text-sm text-pretty wrap-anywhere">
        {"The record holds "}
        <StatedLanguage tag={statedLanguage(outcome.current) ?? context.stored} offered={context.offered} />
        {" now, and your selection "}
        <StatedLanguage tag={statedLanguage(outcome.preservedInput) ?? context.selection ?? ""} offered={context.offered} />
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
  return outcome.outcome === "unchanged" ? <p className="text-sm text-pretty wrap-anywhere">Nothing needed changing, so nothing was written and no notification was touched. The language above is the record's own value.</p> : null;
}
export type LanguagePreferenceProps = {
  readonly scope: Scope;
  readonly membershipId: string;
  readonly publisherId: string | null;
  readonly purpose: string;
  readonly currentChoice: SetPreferencePayload["choice"];
  readonly currentLanguage: string | null;
  readonly expectedRevision: string;
  readonly languageOptions: readonly LanguageOption[];
  readonly onCheckResult?: () => void;
  readonly onSaved?: () => void;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly dir?: "ltr" | "rtl";
  readonly headingLevel?: 2 | 3 | 4;
  readonly className?: string;
};
/** The reading-language preference for one membership. */
export function LanguagePreference({ scope, membershipId, publisherId, purpose, currentChoice, currentLanguage, expectedRevision, languageOptions, onCheckResult, onSaved, disabled = false, disabledReason, dir, headingLevel = 2, className }: LanguagePreferenceProps): ReactElement {
  const setPreference = useSetPreference();
  const router = useRouter();
  const submit = useCallback<MutationSubmit<SetPreferencePayload>>((input) => setPreference.mutateAsync(input), [setPreference]);
  const review = useReviewedMutation<SetPreferencePayload>(submit);
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
  const submittedTag = pending !== null && offeredKeys.has(tagKey(pending)) && tagKey(pending) !== storedKey ? pending.trim() : null;
  const attempt = submittedTag === null ? null : { scope, expectedRevision, payload: { membershipId, choice: currentChoice, languagePreference: submittedTag } };
  const answeredHere = attempt !== null && current !== null && review.reviewedIntent === intentKeyOf(attempt) ? current : null;
  const reason = disabled ? disabledReason?.trim() || "This session cannot change the reading language for this membership." : null;
  const state = review.pending ? "working" : current === null ? "review" : "settled";
  const hint = noLanguages ? "This publisher offers no language this page can list, so there is nothing to choose here and nothing was written." : stored === "" ? NO_LANGUAGE_YET_HINT : !storedOffered ? NOT_OFFERED_HINT : "Choose a language other than the one recorded, then save it.";
  const statement = current === null ? null : outcomeStatement(current, { offered, stored, selection: pending });
  const settle = useCallback(
    async (run: () => Promise<MutationOutcome | null>): Promise<void> => {
      const outcome = await run();
      if (!hasSettled(outcome)) return;
      // The language stated as recorded above is the page's own server read, and no client query mounts that read, so the route is asked to read itself again; the receipt below is this component's own state, so it stays on screen across that re-read.
      router.refresh();
      onSaved?.();
    },
    [onSaved, router],
  );
  const retryWork = current !== null && mayReplay(current) ? (): void => void settle(review.retry) : undefined;
  const save = (): void => {
    if (attempt === null || review.pending || disabled) return;
    void settle(() => review.submit(attempt));
  };
  const resultRef = useCallback((node: HTMLDivElement | null): void => {
    if (node !== null) node.focus();
  }, []);
  return (
    <div data-slot="language-preference" data-state={state} data-language={stored === "" ? undefined : stored} aria-busy={review.pending ? true : undefined} dir={dir} className={cn("min-w-0", className)}>
      <FormFieldGroup legend={LANGUAGE_PREFERENCE_COPY.heading} name="language-preference" description={LANGUAGE_PREFERENCE_COPY.separateFromConsent} className="min-w-0">
        {() => (
          <div className="flex min-w-0 flex-col gap-4 text-start">
            <div className="flex min-w-0 flex-col gap-2 text-sm text-pretty wrap-anywhere">
              <p>{LANGUAGE_PREFERENCE_COPY.help}</p>
              <p>{LANGUAGE_PREFERENCE_COPY.separateFromProof}</p>
              <p className="text-muted-foreground">
                {`${"This preference applies to notices from"} `}
                <bdi className="mono-identifier">{publisherId === null ? "a publisher this read does not name" : publisherId}</bdi>
                {` ${"for the purpose"} `}
                <bdi className="mono-identifier">{purpose}</bdi>
                {`. ${"No other publisher, purpose or record about you is affected."}`}
              </p>
            </div>
            <FormField label={SELECT_LABEL} name="language-preference-select">
              {({ id, describedBy }) => {
                const currentValueId = `${id}-current-value`;
                return (
                  <>
                    <NativeSelect id={id} className="w-full max-w-full" value={selected} aria-describedby={describedBy === undefined ? currentValueId : `${describedBy} ${currentValueId}`} disabled={controlDisabled} onChange={(event) => setPending(event.currentTarget.value)}>
                      {selected === "" ? <NativeSelectOption {...{ value: "", disabled: true }}>{"A language has not been chosen yet"}</NativeSelectOption> : null}
                      {offered.length === 0 ? null : (
                        <NativeSelectOptGroup label="Languages this publisher offers">
                          {offered.map((option) => (
                            <NativeSelectOption key={option.tag} value={option.tag} dir={option.direction}>
                              {option.label}
                            </NativeSelectOption>
                          ))}
                        </NativeSelectOptGroup>
                      )}
                      {stored === "" || storedOffered ? null : (
                        <NativeSelectOptGroup label="Language recorded now, not offered here">
                          <NativeSelectOption value={stored}>{stored}</NativeSelectOption>
                        </NativeSelectOptGroup>
                      )}
                    </NativeSelect>
                    <p id={currentValueId} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <span className="text-muted-foreground">Language recorded now:</span>
                      {stored === "" ? <span className="font-medium">no language recorded for this membership</span> : <StatedLanguage tag={stored} offered={offered} />}
                    </p>
                    {changed && pending !== null && !review.pending && !(answeredHere !== null && (answeredHere.outcome === "accepted" || answeredHere.outcome === "alreadyAccepted" || answeredHere.outcome === "unchanged")) && pending !== null ? (
                      <output htmlFor={id} aria-atomic="true" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                        <span className="text-muted-foreground">Not saved yet:</span>
                        <StatedLanguage tag={pending} offered={offered} />
                        <span className="text-muted-foreground">Nothing has been written, and saving is your own deliberate act.</span>
                      </output>
                    ) : null}
                  </>
                );
              }}
            </FormField>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Button {...{ type: "button", variant: "default", onClick: save, disabled: controlDisabled || review.pending || attempt === null }}>{"Save language"}</Button>
              {review.pending ? <output className="min-w-0 text-sm text-muted-foreground text-pretty wrap-anywhere">Saving the reading language — working. Nothing else on this page changes.</output> : null}
            </div>
            {reason !== null ? <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{reason}</p> : changed || review.pending ? null : <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{hint}</p>}
          </div>
        )}
      </FormFieldGroup>
      {current === null ? null : (
        <div key={`${current.outcome}:${current.operationId}`} ref={resultRef} tabIndex={-1} data-slot="language-preference-result" data-outcome={current.outcome} className="mt-4 flex min-w-0 flex-col gap-3">
          <OperationResult outcome={current} headingLevel={headingLevel} onCheckResult={current.outcome === "unknown" ? onCheckResult : undefined} onRetrySameWork={retryWork} onReapply={reappliableRevision(current) === null ? undefined : () => void settle(review.reapply)} fieldLabels={FIELD_LABELS} />
          {statement === null ? null : <div className="min-w-0 text-muted-foreground">{statement}</div>}
        </div>
      )}
    </div>
  );
}
export default LanguagePreference;
