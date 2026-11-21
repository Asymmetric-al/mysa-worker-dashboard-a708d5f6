"use client";
/**
 * The language editions of one Worker or Project Page: the one control that changes which edition is
 * being worked on, and the lifecycle state every admitted edition holds on its own.
 */
import { useEffect, useId, useRef, type ReactElement } from "react";
import { DraftStatus, lifecycleOf, type LifecycleEvidence } from "@/components/draft-status";
import { LocaleSwitcher, type LocaleEdition } from "@/components/locale-switcher";
import { cn } from "@/lib/cn";
import type { ContentLocale } from "@/modules/content/locale";
import type { ContentVariant, Release, TranslationSourceContext } from "@/modules/content/variant";
import { copy } from "../copy";
type ContentDirection = ContentLocale["direction"];
/** One locale edition of a Page, exactly as the `readPageLocales` envelope carries it. */
export interface EditionView {
  readonly locale: string;
  readonly direction: ContentDirection;
  readonly variant: ContentVariant;
  readonly release?: Release;
  readonly candidateId?: string;
  readonly translationSource?: TranslationSourceContext;
}
/** Props of {@link LocaleEditionSwitcher}. */
export interface LocaleEditionSwitcherProps {
  readonly editions: readonly EditionView[];
  readonly selectedLocale: string;
  readonly onSelectLocale: (locale: string) => void;
  readonly onDirectionChange?: (direction: ContentDirection) => void;
  readonly disabled?: boolean;
  readonly className?: string;
}
const SWITCHING_SAVES_NOTHING = "Switching language edition only changes which edition you are working on. It saves nothing, so nothing in this edition is written by choosing another.";

const SWITCHING_UNAVAILABLE = "The language edition cannot be changed right now.";

function normaliseTag(tag: string): string {
  return tag.trim().toLowerCase();
}
function findEdition(editions: readonly EditionView[], tag: string): EditionView | undefined {
  const wanted = normaliseTag(tag);
  if (wanted === "") {
    return undefined;
  }
  return editions.find((edition) => normaliseTag(edition.locale) === wanted);
}
function localeEditionsOf(editions: readonly EditionView[]): readonly LocaleEdition[] {
  return editions.map((edition) => ({
    tag: edition.locale,
    direction: edition.direction,
    releaseId: edition.release?.releaseId,
  }));
}
function variantOf(edition: EditionView): ContentVariant {
  if (edition.candidateId === undefined || edition.variant.candidateId !== undefined) {
    return edition.variant;
  }
  return { ...edition.variant, candidateId: edition.candidateId };
}
function evidenceOf(edition: EditionView): LifecycleEvidence | undefined {
  return edition.translationSource === undefined ? undefined : { translationSource: edition.translationSource };
}
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
    if (reportedDirection.current === selectedDirection) {
      return;
    }
    reportedDirection.current = selectedDirection;
    if (selectedDirection !== undefined) {
      directionHandler.current?.(selectedDirection);
    }
  }, [selectedDirection]);
  const localeEditions = localeEditionsOf(editions);
  const hasTranslation = editions.some((edition) => edition.translationSource !== undefined);
  return (
    <div
      data-slot="locale-edition-switcher"
      data-selected-locale={selectedEdition?.locale}
      data-selected-direction={selectedDirection}
      className={cn("flex min-w-0 flex-col gap-3 text-start", className)}
    >
      {/*
        One named group for the switchable controls. The `<legend>` is the family's heading, so the
        group has a visible name as well as an accessible one, and it is also the name the list of
        editions below is labelled by — one string in the DOM rather than two copies of it.
        `disabled` is the platform's own disabling rather than a pointer-blocking wrapper: the select
        inside the shared switcher becomes unfocusable and unusable while every word stays in the
        accessibility tree, which `pointer-events: none` would not achieve and would leave a keyboard
        user pressing a control that silently does nothing.
      */}
      <fieldset disabled={disabled} aria-describedby={disabled ? disabledReasonId : undefined} className="min-w-0 border-0 p-0">
        <legend id={groupLabelId} className="pb-2 text-start text-sm font-medium">
          {copy.editions.heading}
        </legend>
        <div className="flex min-w-0 flex-col gap-2">
          <LocaleSwitcher
            locales={localeEditions}
            requested={selectedLocale}
            served={selectedEdition?.locale}
            // A selection that names no admitted edition is the resolver's *Language unavailable*
            // answer, so the shared switcher states it rather than being handed a guess. Its own
            // notice names the requested language and no sibling edition, which is what keeps a
            // denied edition invisible.
            unavailable={selectedEdition === undefined}
            onRequest={onSelectLocale}
            label={copy.editions.localeLabel}
          />
          <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">{SWITCHING_SAVES_NOTHING}</p>
          {disabled ? (
            <p id={disabledReasonId} className="text-xs text-muted-foreground text-pretty wrap-anywhere">
              {SWITCHING_UNAVAILABLE}
            </p>
          ) : null}
        </div>
      </fieldset>
      {/*
        Nothing is listed when the worker has no admitted edition at all: the switcher's own notice
        already says that nothing permitted to read exists here, and an empty list beside it would
        read as a second, quieter failure.
      */}
      {editions.length === 0 ? null : (
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">{copy.editions.editionIndependenceNote}</p>
          <ul aria-labelledby={groupLabelId} className="flex min-w-0 flex-col gap-3">
            {editions.map((edition) => {
              const state = lifecycleOf(variantOf(edition), edition.release, evidenceOf(edition));
              return (
                <li
                  key={edition.locale}
                  data-slot="locale-edition"
                  data-locale={edition.locale}
                  data-lifecycle-state={state}
                  // A correlation for the surface and the browser journey, not decoration: it adds
                  // no chrome, because the shared switcher already names the edition being read.
                  data-selected={selectedEdition?.locale === edition.locale ? "true" : undefined}
                  className="flex min-w-0 flex-col gap-1"
                >
                  {/*
                    The edition is identified by its tag, isolated in `<bdi>` so a Latin tag inside a
                    right-to-left edition cannot reorder what follows it. The human-readable language
                    name stays the switcher's: one derivation of it, in the options beside this list.
                  */}
                  <bdi className="mono-identifier text-start text-xs text-muted-foreground">{edition.locale}</bdi>
                  <DraftStatus
                    state={state}
                    // Which source edition moved on, when the state is that a translation fell
                    // behind it. No instant is formatted here: a formatted date belongs to the
                    // caller, and this file formats none.
                    staleLocale={state === "stale-translation" ? edition.translationSource?.sourceVariant.locale.tag : undefined}
                  />
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">{copy.editions.fallbackNote}</p>
          {hasTranslation ? <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">{copy.editions.translationSourceNote}</p> : null}
        </div>
      )}
    </div>
  );
}
export default LocaleEditionSwitcher;
