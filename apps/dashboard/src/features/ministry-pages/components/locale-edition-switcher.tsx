"use client";

/**
 * The language editions of one Worker or Project Page: the one control that changes which edition is
 * being worked on, and the lifecycle state every admitted edition holds on its own.
 *
 * Why the states are listed side by side rather than summarised. AAP 0.8.6 fixes that "each locale
 * edition ... has its own draft, candidate and release; editing English does not overwrite an Arabic
 * draft or advance a French release", and criterion 17 asserts it. A single rolled-up "page status"
 * would state exactly the opposite — one word for a page whose English edition is in review, whose
 * French edition is released and whose Arabic edition has only a draft — so this component renders a
 * {@link DraftStatus} per edition and never computes a group status, a count of released editions or
 * a "needs attention" rollup.
 *
 * What it composes, and what it therefore refuses to duplicate (Rule 1 clause 2; AAP 0.3.4):
 *
 * - `components/locale-switcher` is the one locale chooser in the application. It owns the language
 *   names, the disclosure of a substituted language and the *Language unavailable* notice, and it
 *   already has the narrow-screen path, so this file builds no second select, imports no endonym
 *   table and never resolves a fallback of its own. The admitted editions arrive as props and are
 *   passed straight through.
 * - `components/draft-status` owns {@link lifecycleOf}, the only mapping from the service's variant
 *   and release records to a lifecycle word, and {@link DraftStatus}, the only rendering of it. This
 *   file calls it once per edition and adds no second vocabulary: a state is a word in text, never a
 *   colour, so the editions stay distinguishable in greyscale and to a reader who cannot resolve
 *   colour.
 * - `../copy` owns the family's sentences. The heading, the control's label, the note that the
 *   editions are independent, the fallback note and the translation note are leaves of that module.
 *
 * Switching an edition writes nothing. `onSelectLocale` reports the choice upward and that is the
 * whole of this component's effect: it holds no revision, calls no mutation, runs no query and mints
 * no operation identity, because the only writes in this family belong to the section fields, the
 * section actions, the presets, the release and review controls, the reach control, the
 * stop-showing-publicly dialog and the family catalogue. A worker is told in one line that switching
 * saves nothing, so nobody assumes the edition they left was saved; preserving unsaved field values
 * across a switch is the builder's own selection state, not a dialog here, and a "save before
 * switching" prompt at this level would guard the wrong state.
 *
 * Direction is the content's, not the interface's. The selected edition's `direction` is reported
 * upward through `onDirectionChange`, guarded so it fires once per actual change (and once on the
 * first render, when a content block still needs to know which way to lay itself out). Nothing here
 * writes `dir`, sets a CSS base direction, applies a transform or mirrors media: `page-builder.tsx`
 * and the preview frame put `dir` on the content block they own (AAP 0.8.6).
 *
 * Accessibility. The switchable controls sit in a `<fieldset>` whose `<legend>` is the family's
 * heading, so the group is named and `disabled` is the platform's own disabling rather than a
 * pointer-blocking wrapper — the `<select>` inside the shared switcher keeps its keyboard behaviour,
 * typeahead and mobile wheel, and a reader is told in words why it cannot be used. The statuses are
 * outside that fieldset, so a disabled switch still leaves every edition's state readable. The
 * control clears the 24x24 CSS px target floor of WCAG 2.2 SC 2.5.8, from the design system's own
 * 36 CSS px control height, every
 * spacing utility is logical (`ms-*`, `pe-*`, `text-start`) so the block mirrors inside a
 * right-to-left edition, and every locale tag renders inside `<bdi>` so a Latin tag beside an Arabic
 * name cannot reorder the row. Nothing is set sideways, so the block adds no horizontal page scroll
 * at 320 CSS px.
 *
 * It is a client component because it reports a selection and a direction upward through hooks, and
 * it holds no record state of its own: no clock, no money, no fetch, no cache key, no identifier.
 */

import { useEffect, useId, useRef, type ReactElement } from "react";

import { DraftStatus, lifecycleOf, type LifecycleEvidence } from "@/components/draft-status";
import { LocaleSwitcher, type LocaleEdition } from "@/components/locale-switcher";
import { cn } from "@/lib/cn";
import type { ContentLocale } from "@/modules/content/locale";
import type { ContentVariant, Release, TranslationSourceContext } from "@/modules/content/variant";

import { copy } from "../copy";

/**
 * The direction vocabulary, taken from the locale contract instead of restated, so a direction added
 * to the content profile reaches this file as a type error until it has been dealt with.
 */
type ContentDirection = ContentLocale["direction"];

/**
 * One locale edition of a Page, exactly as the `readPageLocales` envelope carries it.
 *
 * `locale` and `direction` are the edition's own BCP-47 tag and reading direction, lifted out of the
 * variant record so this component can address an edition without reaching into it for the two
 * fields it needs most. `variant` and `release` are the service's records unchanged, which is what
 * lets {@link lifecycleOf} stay the single derivation: nothing here re-derives a state from a status
 * string, and nothing needs the records reshaped first.
 *
 * `candidateId` is accepted because the envelope may state the frozen candidate on the edition as
 * well as on its variant; it is folded into the variant before the lifecycle is asked, so a candidate
 * recorded in either place is stated once, by the one mapping, rather than by a fallback branch here.
 *
 * `translationSource` is the source edition a manual translation copied, in the shape
 * `TranslationSourceContext` already gives it, so staleness is asked of `translationStaleness` through
 * {@link lifecycleOf} and is never recomputed in the interface. It is optional because a Page that is
 * not a translation has none.
 */
export interface EditionView {
  /** The edition's BCP-47 tag, for example `en`, `fr` or `ar`. */
  readonly locale: string;

  /** The direction the edition is authored and read in. */
  readonly direction: ContentDirection;

  /** The working variant: its draft, candidate and release pointers, as the service holds them. */
  readonly variant: ContentVariant;

  /** The release the surface is about, normally the variant's head; absent before a first release. */
  readonly release?: Release;

  /** The frozen candidate under review, when the envelope states it on the edition itself. */
  readonly candidateId?: string;

  /** The source a manual translation copied, when this edition is a translation. */
  readonly translationSource?: TranslationSourceContext;
}

/** Props of {@link LocaleEditionSwitcher}. */
export interface LocaleEditionSwitcherProps {
  /**
   * The editions this worker is admitted to, one per language, exactly as the page-edition read
   * returned them. A language absent from this list is never offered, and there is no "add a
   * language" option: creating a locale edition is a content operation the service records, not a
   * control in a switcher (AAP 0.10.2).
   */
  readonly editions: readonly EditionView[];

  /**
   * The tag of the edition currently being worked on. It is reported upward again as the worker
   * chooses another; this component never keeps a copy of the choice, so the surface that owns the
   * selection remains its only owner.
   */
  readonly selectedLocale: string;

  /** Reports the chosen edition's tag. Called only with a tag that is in `editions`. */
  readonly onSelectLocale: (locale: string) => void;

  /**
   * Reports the selected edition's reading direction, so the consuming surface can put `dir` on the
   * content block. Called once per actual change, and once when the component first renders with a
   * selection; not called while no edition is selected, because there is then no direction to state.
   */
  readonly onDirectionChange?: (direction: ContentDirection) => void;

  /**
   * Whether the edition can be changed right now — while a save is in flight, or while the surface
   * holds work it will not let go of. The control is disabled natively and says so; the per-edition
   * states stay readable either way.
   */
  readonly disabled?: boolean;

  /** Layout classes for the block this switcher occupies, using logical utilities only. */
  readonly className?: string;
}

/**
 * The one sentence this surface authors for itself: switching editions saves nothing.
 *
 * No key in `../copy` words it, and it is not the family's wording about editions — it is the fact a
 * worker needs before choosing another language, so that a switch is never mistaken for a save. It
 * stays one line on purpose: the builder owns unsaved-field preservation, and a longer sentence here
 * would promise behaviour that lives in another file.
 */
const SWITCHING_SAVES_NOTHING =
  "Switching language edition only changes which edition you are working on. It saves nothing, so nothing in this edition is written by choosing another.";

/**
 * What a disabled switcher says, so an inert control is never unexplained.
 *
 * This surface's own word rather than a family phrase, because no `../copy` key describes the
 * disabled state of the edition control. It states that the choice is unavailable now and invents no
 * cause: the caller knows why it disabled the control and this file does not.
 */
const SWITCHING_UNAVAILABLE = "The language edition cannot be changed right now.";

/**
 * A tag in the form two tags are compared by. BCP-47 case carries no meaning, so `AR` asked of an
 * `ar` edition is that edition and not a missing one.
 */
function normaliseTag(tag: string): string {
  return tag.trim().toLowerCase();
}

/**
 * The edition with this tag, or `undefined` when the selection names an edition this worker may not
 * work on.
 *
 * It is a lookup, not a resolution: this component never substitutes one language for another, so an
 * absent selection is reported to the shared switcher as *Language unavailable* rather than silently
 * answered with a different edition.
 */
function findEdition(editions: readonly EditionView[], tag: string): EditionView | undefined {
  const wanted = normaliseTag(tag);
  if (wanted === "") {
    return undefined;
  }
  return editions.find((edition) => normaliseTag(edition.locale) === wanted);
}

/**
 * The editions as the shared switcher lists them: the tag, the direction and the release that serves
 * the edition.
 *
 * No name is invented here. The switcher names a language from the caller's own endonym or from the
 * tag, so this file passes the tag and lets that one derivation stand rather than adding a second
 * that could disagree with the options it sits beside.
 */
function localeEditionsOf(editions: readonly EditionView[]): readonly LocaleEdition[] {
  return editions.map((edition) => ({
    tag: edition.locale,
    direction: edition.direction,
    releaseId: edition.release?.releaseId,
  }));
}

/**
 * The variant as the lifecycle derivation reads it: the envelope's candidate, when it stated one on
 * the edition rather than on the variant.
 *
 * Filling in one field before delegating keeps `lifecycleOf` the only mapping from records to a
 * state. Answering "is there a candidate?" here instead would be a second lifecycle rule, and the two
 * could then disagree about the same edition.
 */
function variantOf(edition: EditionView): ContentVariant {
  if (edition.candidateId === undefined || edition.variant.candidateId !== undefined) {
    return edition.variant;
  }
  return { ...edition.variant, candidateId: edition.candidateId };
}

/**
 * The translation evidence {@link lifecycleOf} asks `translationStaleness` about, when the edition is
 * a translation. A Page that is not a translation supplies none, and its lifecycle states nothing
 * about a source it never had.
 */
function evidenceOf(edition: EditionView): LifecycleEvidence | undefined {
  return edition.translationSource === undefined
    ? undefined
    : { translationSource: edition.translationSource };
}

/**
 * The Page's language editions: the one control that changes which edition is being worked on, and
 * the lifecycle state each admitted edition holds on its own.
 *
 * The control is the shared `components/locale-switcher`, given exactly the admitted editions and the
 * current selection, so the language names, the disclosure of a substituted language and *Language
 * unavailable* all come from the one implementation. Below it, every admitted edition is listed with
 * its own {@link DraftStatus}: an English edition in review, a French edition released and an Arabic
 * edition with only a draft are three facts, stated three times, and nothing on this surface reduces
 * them to one.
 *
 * `disabled` disables the switchable controls natively and leaves the statuses readable, so a worker
 * whose edition cannot be changed right now can still see what every edition holds.
 */
export function LocaleEditionSwitcher({
  editions,
  selectedLocale,
  onSelectLocale,
  onDirectionChange,
  disabled = false,
  className,
}: LocaleEditionSwitcherProps): ReactElement {
  const groupLabelId = useId();
  const disabledReasonId = useId();

  const selectedEdition = findEdition(editions, selectedLocale);
  const selectedDirection = selectedEdition?.direction;

  /*
   * Direction travels up so the consuming surface can put `dir` on the content block; this component
   * states no direction itself. The handler is held in a ref so a caller that re-creates its callback
   * on every render cannot re-trigger the report, and the last reported value is remembered so a
   * direction is reported once per change — including the first render, when nothing has changed yet
   * but the content block about to be rendered still needs to know which way it runs. A selection
   * that names no admitted edition reports nothing, because there is then no direction to state.
   */
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
      <fieldset
        disabled={disabled}
        aria-describedby={disabled ? disabledReasonId : undefined}
        className="min-w-0 border-0 p-0"
      >
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
          <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">
            {SWITCHING_SAVES_NOTHING}
          </p>
          {disabled ? (
            <p
              id={disabledReasonId}
              className="text-xs text-muted-foreground text-pretty wrap-anywhere"
            >
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
          <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">
            {copy.editions.editionIndependenceNote}
          </p>
          <ul aria-labelledby={groupLabelId} className="flex min-w-0 flex-col gap-3">
            {editions.map((edition) => {
              /*
               * One derivation per edition, from the records the service supplied: `lifecycleOf`
               * decides the word and `DraftStatus` renders it. No state is summarised across
               * editions and none is inferred here, so editing one edition cannot advance another's
               * badge (AAP 0.8.6).
               */
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
                  <bdi className="mono-identifier text-start text-xs text-muted-foreground">
                    {edition.locale}
                  </bdi>
                  <DraftStatus
                    state={state}
                    // Which source edition moved on, when the state is that a translation fell
                    // behind it. No instant is formatted here: a formatted date belongs to the
                    // caller, and this file formats none.
                    staleLocale={
                      state === "stale-translation"
                        ? edition.translationSource?.sourceVariant.locale.tag
                        : undefined
                    }
                  />
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">
            {copy.editions.fallbackNote}
          </p>
          {hasTranslation ? (
            <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">
              {copy.editions.translationSourceNote}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default LocaleEditionSwitcher;
