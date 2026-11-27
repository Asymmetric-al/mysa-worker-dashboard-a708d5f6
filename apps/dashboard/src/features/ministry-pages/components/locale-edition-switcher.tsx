"use client";
import { useEffect, useId, useRef, type ReactElement } from "react";
import { DraftStatus, lifecycleOf, type LifecycleEvidence } from "@/components/draft-status";
import { LocaleSwitcher, type LocaleEdition } from "@/components/locale-switcher";
import { cn } from "@/lib/cn";
import type { ContentLocale } from "@/modules/content/locale";
import type { ContentVariant, Release, ReviewDecision, TranslationSourceContext } from "@/modules/content/variant";
import { copy } from "../copy";
type ContentDirection = ContentLocale["direction"];
export type EditionView = {
  readonly locale: string;
  readonly direction: ContentDirection;
  readonly variant: ContentVariant;
  readonly release?: Release;
  readonly candidateId?: string;
  readonly translationSource?: TranslationSourceContext;
  /** The answer the read recorded on this edition's frozen candidate, or `null` for one still awaiting it: the fact this list states so an approved candidate is not named as one nobody has answered. */ readonly candidateDecision?: ReviewDecision | null;
};
export type LocaleEditionSwitcherProps = { readonly editions: readonly EditionView[]; readonly selectedLocale: string; readonly onSelectLocale: (locale: string) => void; readonly onDirectionChange?: (direction: ContentDirection) => void; readonly disabled?: boolean; readonly className?: string };
const normaliseTag = (tag: string): string => tag.trim().toLowerCase();
const findEdition = (editions: readonly EditionView[], tag: string): EditionView | undefined => (normaliseTag(tag) === "" ? undefined : editions.find((edition) => normaliseTag(edition.locale) === normaliseTag(tag)));
const localeEditionsOf = (editions: readonly EditionView[]): readonly LocaleEdition[] => editions.map((edition) => ({ tag: edition.locale, direction: edition.direction, releaseId: edition.release?.releaseId }));
const variantOf = (edition: EditionView): ContentVariant => (edition.candidateId === undefined || edition.variant.candidateId !== undefined ? edition.variant : { ...edition.variant, candidateId: edition.candidateId });
const evidenceOf = (edition: EditionView): LifecycleEvidence | undefined =>
  edition.translationSource === undefined && edition.candidateDecision === undefined ? undefined : { ...(edition.translationSource === undefined ? {} : { translationSource: edition.translationSource }), ...(edition.candidateDecision === undefined ? {} : { reviewDecision: edition.candidateDecision }) };
/** The Page's language editions: the one control that changes which edition is being worked on, and the lifecycle state each admitted edition holds on its own. */
export function LocaleEditionSwitcher({ editions, selectedLocale, onSelectLocale, onDirectionChange, disabled = false, className }: LocaleEditionSwitcherProps): ReactElement {
  const groupLabelId = useId();
  const disabledReasonId = useId();
  const selectedEdition = findEdition(editions, selectedLocale);
  const selectedDirection = selectedEdition?.direction;
  const directionHandler = useRef(onDirectionChange);
  const reportedDirection = useRef<ContentDirection | undefined>(undefined);
  useEffect(() => {
    directionHandler.current = onDirectionChange;
  });
  useEffect(() => {
    if (reportedDirection.current === selectedDirection) return;
    reportedDirection.current = selectedDirection;
    if (selectedDirection !== undefined) directionHandler.current?.(selectedDirection);
  }, [selectedDirection]);
  return (
    <div data-slot="locale-edition-switcher" data-selected-locale={selectedEdition?.locale} data-selected-direction={selectedDirection} className={cn("flex min-w-0 flex-col gap-3 text-start", className)}>
      <fieldset disabled={disabled} aria-describedby={disabled ? disabledReasonId : undefined} className="min-w-0 border-0 p-0">
        <legend {...{ id: groupLabelId, className: "pb-2 text-start text-sm font-medium" as const }}>{copy.editions.heading}</legend>
        <div className="flex min-w-0 flex-col gap-2">
          <LocaleSwitcher locales={localeEditionsOf(editions)} requested={selectedLocale} served={selectedEdition?.locale} unavailable={selectedEdition === undefined} onRequest={onSelectLocale} label={copy.editions.localeLabel} />
          <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">Switching languages changes which edition you’re viewing without saving any edits.</p>
          {disabled ? <p {...{ id: disabledReasonId, className: "text-xs text-muted-foreground text-pretty wrap-anywhere" as const }}>{"Language switching isn’t available right now."}</p> : null}
        </div>
      </fieldset>
      {editions.length === 0 ? null : (
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">{copy.editions.editionIndependenceNote}</p>
          <ul aria-labelledby={groupLabelId} className="flex min-w-0 flex-col gap-3">
            {editions.map((edition) => {
              const state = lifecycleOf(variantOf(edition), edition.release, evidenceOf(edition));
              return (
                <li key={edition.locale} data-slot="locale-edition" data-locale={edition.locale} data-lifecycle-state={state} data-selected={selectedEdition?.locale === edition.locale ? "true" : undefined} className="flex min-w-0 flex-col gap-1">
                  <bdi className="mono-identifier text-start text-xs text-muted-foreground">{edition.locale}</bdi>
                  <DraftStatus state={state} staleLocale={state === "stale-translation" ? edition.translationSource?.sourceVariant.locale.tag : undefined} />
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">{copy.editions.fallbackNote}</p>
          {editions.some((edition) => edition.translationSource !== undefined) ? <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">{copy.editions.translationSourceNote}</p> : null}
        </div>
      )}
    </div>
  );
}
export default LocaleEditionSwitcher;
