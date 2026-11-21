"use client";

import { useEffect, useId, useRef, type ReactElement, type ReactNode } from "react";

import { StateNotice } from "@/components/state-notice";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/cn";
import type { ContentLocale } from "@/modules/content/locale";

/**
 * The one locale-edition and direction selector: the language a reader is reading a Page edition or
 * an Update in, named honestly when it is not the language they asked for, and absent when nothing
 * they are permitted to read exists in it.
 *
 * It is one component because the editor, the Page and Update previews and the receiving views all
 * ask the same question — "which language is this, and did I get the one I asked for?" — and three
 * hand-written selectors would answer it three ways (AAP 0.3.4 "Locale fallback resolution").
 *
 * What this component decides, and what it deliberately leaves alone:
 *
 * - **The chain is not here.** Which edition a reader is served is `resolveLocale` in
 *   `modules/content/locale.ts`: exact tag, then the same primary language, then the Site default,
 *   then *Language unavailable*, over admitted releases only. This component receives that answer as
 *   props and never re-derives it, so a second, drifting fallback rule cannot exist in the interface
 *   (AAP 0.8.6).
 * - **A fallback is disclosed, never disguised.** When the served edition is not the requested one,
 *   the control names both languages in words — the requested one first, then the one actually
 *   shown — because a reader who asked for French and received English has to be told, not left to
 *   notice (AAP 0.8.6, criterion 17).
 * - **A denied edition is invisible.** The options are exactly the admitted editions the caller
 *   passes; nothing here lists a language another audience may read, hints that one exists, or
 *   offers it and then refuses it. A language admitted nowhere and a language admitted only to
 *   someone else therefore render identically, which is the point of the contract rather than an
 *   omission (`LocaleResolution`).
 * - **Language is not consent.** Changing the language changes which admitted edition is read. It
 *   does not subscribe, unsubscribe, confirm a membership or touch a notification intent — this
 *   component holds no consent state and calls nothing but the caller's own `onRequest`
 *   (AAP 0.8.5).
 * - **Direction is the content's, not the interface's.** The served edition's `direction` is
 *   reported upwards so the consuming surface puts `dir` on the content block; nothing here sets a
 *   CSS `direction`, applies a transform, or wraps content in a second direction provider —
 *   `components/ui/direction` remains the only one (AAP 0.4.2, 0.8.6). The control's own layout is
 *   built from logical utilities, so it mirrors correctly inside a right-to-left edition while
 *   never asserting a direction of its own.
 * - **No bidi control characters are emitted.** Isolation for a mixed-direction language name is
 *   markup (`<bdi>`), never U+200E, U+200F or a U+202A-U+202E/2066-2069 mark, so nothing directional
 *   can be copied out of this control and saved into content.
 *
 * A native `select` inside the installed `NativeSelect` is the control on purpose: typeahead, a
 * mobile wheel, a screen-reader listbox and single-pointer operation all come from the platform,
 * with no second listbox widget to reimplement (AAP 0.4.2, 0.4.5 gap 9 uses the same reasoning for
 * date entry). The visible `Label` bound by `htmlFor` is its accessible name, and the control is
 * 36 CSS px tall, comfortably above the 24x24 CSS px floor of WCAG 2.2 SC 2.5.8.
 *
 * One live region, announced once. The `<output>` beside the select reports the served edition — its
 * language, its tag and the direction it is read in — and is the only polite region here, so a change
 * of language is announced a single time rather than by the control and a second summary. The
 * `language-unavailable` case renders `components/state-notice`, which owns that state's wording and
 * its own polite status region.
 *
 * A rendering decision worth stating: the option labels carry the language name and its tag as text,
 * not as `<bdi>` and a nested span, because an HTML `option`'s content model is text only. The
 * isolating element is therefore used where inline markup is genuinely available — the served-edition
 * sentence and the badges — and each option reads `<name> (<tag>)`, which keeps an Arabic name beside
 * a Latin tag legible inside an English list and the reverse inside an Arabic one.
 *
 * Every colour, radius, shadow and space below resolves to a token utility or to a variant of an
 * installed component (AAP 0.4.3); the component holds no state of the record, fetches nothing,
 * reads no clock and formats no money.
 */

/**
 * The direction vocabulary, taken from the locale contract instead of restated, so a direction added
 * to the content profile reaches this component as a type error until it has a word.
 */
type ContentDirection = ContentLocale["direction"];

/**
 * How each direction is said in words, exhaustive over the profile's two values.
 *
 * The words are how the control tells a reader which way the edition they are about to read runs,
 * which is information rather than decoration: it is the only visible statement that the Arabic
 * edition below will be laid out right to left.
 */
const DIRECTION_WORDS: Readonly<Record<ContentDirection, string>> = {
  ltr: "left to right",
  rtl: "right to left",
};

/**
 * One edition this control may offer.
 *
 * It satisfies `ContentLocale` field for field, and it is also satisfied by the richer
 * `AdmittedLocale` record `admittedLocales()` returns, so a caller passes that list unchanged rather
 * than mapping it into a second shape. `endonym` and `label` are optional because the locale contract
 * does not carry a name: when a caller has one it is used, and when it does not the name is derived
 * from the tag (see {@link languageNameOf}).
 */
export interface LocaleEdition extends ContentLocale {
  /** The language's name in its own language, as a caller that has one states it ("français"). */
  readonly endonym?: string;

  /** The language's name in the surrounding interface language, when a caller has only that. */
  readonly label?: string;

  /** The release serving this edition, carried through so a caller can address it exactly. */
  readonly releaseId?: string;

  /** Whether this is the Site's declared default edition; stated beside the served language. */
  readonly isSiteDefault?: boolean;
}

/** Props of {@link LocaleSwitcher}. */
export interface LocaleSwitcherProps {
  /**
   * The editions this reader is admitted to, exactly as `admittedLocales()` listed them. A locale not
   * in this list is never offered, and no "add a language" option exists: translating or administering
   * locales is outside this release (AAP 0.10.2).
   */
  readonly locales: readonly LocaleEdition[];

  /** The BCP-47 tag the reader asked for, which need not be the one they are served. */
  readonly requested: string;

  /** The BCP-47 tag the resolver actually served, when the caller knows it. */
  readonly served?: string;

  /**
   * The resolver's own answer to "was this a fallback?". It is accepted because the resolution
   * carries it, and it is used for the one case the tags alone cannot settle: a fallback whose served
   * edition the caller did not name, where the requested edition must not be shown as if it were the
   * one on screen.
   */
  readonly fallbackOccurred?: boolean;

  /**
   * Asks for an edition. It is called only with a tag that is in `locales`, and only when the reader
   * picks one — never on mount, never to "fix" the selection, and never more than once per change.
   */
  readonly onRequest: (tag: string) => void;

  /**
   * Receives the direction of the edition actually being read, so the consuming surface can put
   * `dir` on the content block. It is reported when the control first renders and again whenever the
   * served direction changes; it is not reported while no edition is served, because there is then
   * no direction to state (AAP 0.8.6).
   */
  readonly onDirectionChange?: (servedDirection: ContentDirection) => void;

  /** Whether the resolver answered *Language unavailable* for the requested language. */
  readonly unavailable?: boolean;

  /** The control's visible label and accessible name ("Language", "Edition language"). */
  readonly label: string;

  /** Placement classes from the surrounding surface, using logical utilities only. */
  readonly className?: string;
}

/** The form two tags are compared in: BCP-47 case carries no meaning, so `EN-gb` is `en-GB`. */
function normaliseTag(tag: string): string {
  return tag.trim().toLowerCase();
}

/** The admitted edition whose tag is this one, or `undefined` when this control may not offer it. */
function findEdition(
  locales: readonly LocaleEdition[],
  tag: string | undefined,
): LocaleEdition | undefined {
  if (tag === undefined) {
    return undefined;
  }
  const wanted = normaliseTag(tag);
  if (wanted === "") {
    return undefined;
  }
  return locales.find((locale) => normaliseTag(locale.tag) === wanted);
}

/**
 * The language a tag names, as that language names itself: `ar` is "العربية" and `fr` is "français".
 *
 * It is a display name and nothing else — the fallback chain never consults it, and the result is
 * used only in text the reader sees. `Intl.DisplayNames` is asked in the tag's own language, so the
 * answer is an endonym rather than a translation into whichever language the interface happens to be
 * in; a tag the platform cannot name, and a runtime without the data, both answer the tag itself,
 * which is unhelpful but never wrong. A caller that supplies `endonym` (or `label`) bypasses this
 * derivation entirely, so a surface can render names without depending on the platform's ICU data and
 * the server and the browser cannot disagree about how a language is called.
 */
function languageNameOf(tag: string): string {
  const trimmed = tag.trim();
  if (trimmed === "") {
    return "";
  }
  const language = (trimmed.split("-")[0] ?? trimmed).toLowerCase();
  try {
    const names = new Intl.DisplayNames([language], { type: "language" });
    const name = names.of(language);
    return name === undefined || name.trim() === "" ? trimmed : name;
  } catch {
    return trimmed;
  }
}

/** The name an edition is shown under: the caller's endonym, then its label, then its own tag. */
function displayNameOf(edition: LocaleEdition): string {
  const endonym = edition.endonym?.trim() ?? "";
  if (endonym !== "") {
    return endonym;
  }
  const label = edition.label?.trim() ?? "";
  if (label !== "") {
    return label;
  }
  return languageNameOf(edition.tag);
}

/**
 * One option's text: the language name and its tag.
 *
 * The tag is included because it is the only unambiguous identification of an edition — two names can
 * read alike across scripts, and a reader comparing a Page edition with a message they received needs
 * the code that distinguishes them. A tag the platform could not name would otherwise render as
 * "xx (xx)", so in that case the tag stands alone.
 */
function optionTextOf(edition: LocaleEdition): string {
  const name = displayNameOf(edition);
  return name === "" || normaliseTag(name) === normaliseTag(edition.tag)
    ? edition.tag
    : `${name} (${edition.tag})`;
}

/**
 * The single locale-edition and direction selector.
 *
 * Renders the admitted editions as the control's only options, names the served edition and the
 * direction it reads in, discloses a substitution in words, reports the served direction upward, and
 * renders the *Language unavailable* notice instead of a choice when nothing in the requested
 * language may be read. It computes no fallback, holds no record state and changes nothing about the
 * audience.
 */
export function LocaleSwitcher({
  locales,
  requested,
  served,
  fallbackOccurred = false,
  onRequest,
  onDirectionChange,
  unavailable = false,
  label,
  className,
}: LocaleSwitcherProps): ReactElement {
  const selectId = useId();
  const servedSentenceId = useId();

  const requestedTag = requested.trim();
  const hasEditions = locales.length > 0;

  /*
   * An empty admitted list and a resolver answer of `language-unavailable` are one fact — nothing in
   * the requested language may be read here — so they take one path. Keeping them apart would let a
   * surface render "no languages exist" beside a request that was in fact refused, and would make a
   * caller state the same answer twice.
   */
  const isUnavailable = unavailable || !hasEditions;

  const requestedEdition = isUnavailable ? undefined : findEdition(locales, requestedTag);
  const namedServedEdition = findEdition(locales, served);

  /*
   * The edition on screen. A named served edition is authoritative, because that is the resolver's
   * answer. When the caller names none, the requested edition may only stand in for the served one if
   * no fallback was declared: a caller that reports a substitution but does not name the substitute
   * must not see the requested language marked as the one being read.
   */
  const servedEdition = isUnavailable
    ? undefined
    : (namedServedEdition ?? (fallbackOccurred ? undefined : requestedEdition));

  const servedTag = servedEdition?.tag ?? "";
  const servedDirection: ContentDirection | undefined = servedEdition?.direction;
  const servedName = servedEdition === undefined ? "" : displayNameOf(servedEdition);
  const requestedName =
    requestedEdition === undefined ? languageNameOf(requestedTag) : displayNameOf(requestedEdition);

  /*
   * The disclosure is built from the two tags actually rendered, so the sentence can never contradict
   * the selection: the resolver's `fallbackOccurred` says a substitution happened, and these tags say
   * which two languages it happened between. Tag comparison ignores case, because BCP-47 case carries
   * no meaning — a request for `EN-gb` answered by an `en-GB` edition is that edition, not a
   * substitution.
   */
  const fallbackDisclosed =
    servedEdition !== undefined &&
    requestedTag !== "" &&
    normaliseTag(servedTag) !== normaliseTag(requestedTag);

  /*
   * Direction travels up so the consuming feature can put `dir` on the content block; this component
   * states no direction itself. The handler is held in a ref so a caller that re-creates its callback
   * on every render cannot re-trigger the report, and the last reported value is remembered so a
   * direction is reported once per change — including the first render, when nothing has changed yet
   * but a block about to be rendered still needs its direction.
   */
  const directionHandler = useRef(onDirectionChange);
  const reportedDirection = useRef<ContentDirection | undefined>(undefined);
  useEffect(() => {
    directionHandler.current = onDirectionChange;
  });
  useEffect(() => {
    if (reportedDirection.current === servedDirection) {
      return;
    }
    reportedDirection.current = servedDirection;
    if (servedDirection !== undefined) {
      directionHandler.current?.(servedDirection);
    }
  }, [servedDirection]);

  let servedSentence: ReactNode;
  if (servedEdition === undefined) {
    /*
     * Nothing is served. When the language is unavailable the notice below is the announcement and
     * this region stays silent rather than repeating it in a second polite region; when the caller
     * simply has not named an edition yet, the region says so instead of leaving a blank area that
     * reads as a failure.
     */
    servedSentence = isUnavailable ? null : (
      <span className="min-w-0 text-muted-foreground text-pretty wrap-anywhere">
        {fallbackOccurred
          ? "A language other than the one requested is being shown; choose the edition to read below."
          : "No language is being read yet."}
      </span>
    );
  } else {
    servedSentence = (
      <>
        {fallbackDisclosed ? (
          <span className="min-w-0 text-muted-foreground text-pretty wrap-anywhere">
            Requested <bdi className="font-medium text-foreground">{requestedName}</bdi>{" "}
            <bdi className="mono-identifier">{requestedTag}</bdi>.
          </span>
        ) : null}
        <span className="text-muted-foreground">showing</span>
        <Badge variant="outline">
          <bdi className="min-w-0 break-words">{servedName}</bdi>
        </Badge>
        <bdi className="mono-identifier">{servedTag}</bdi>
        <span className="text-muted-foreground">
          read {DIRECTION_WORDS[servedEdition.direction]}.
        </span>
        {servedEdition.isSiteDefault === true ? (
          <Badge variant="secondary">Site default</Badge>
        ) : null}
      </>
    );
  }

  return (
    <div
      className={cn("flex min-w-0 flex-col gap-2", className)}
      data-slot="locale-switcher"
      data-served-locale={servedTag === "" ? undefined : servedTag}
      data-served-direction={servedDirection}
    >
      {/* The visible label is also the accessible name: `htmlFor` binds it to the one control below. */}
      <Label htmlFor={selectId}>{label}</Label>
      <NativeSelect
        id={selectId}
        className="w-full max-w-full"
        value={servedTag}
        // Disabled only when there is nothing to choose. An unavailable language that still has
        // admitted alternatives keeps the control usable, because switching to one of them is the
        // reader's recovery; the choice withheld is the requested language itself, which is never
        // offered as an option.
        disabled={!hasEditions}
        aria-describedby={servedSentenceId}
        onChange={(event) => {
          // Admission is re-checked against the list the control was given, so `onRequest` can only
          // ever receive a tag that is in `locales` — a tampered or stale option value selects
          // nothing rather than asking for an edition the reader may not read.
          const chosen = findEdition(locales, event.target.value);
          if (chosen === undefined) {
            return;
          }
          onRequest(chosen.tag);
        }}
      >
        {servedTag === "" ? (
          // Named rather than blank, and `disabled` so it cannot be picked as if it were a language:
          // an empty selection would otherwise read as a control that failed to load.
          <NativeSelectOption value="" disabled>
            {isUnavailable ? "No edition in the requested language" : "No language selected"}
          </NativeSelectOption>
        ) : null}
        {locales.map((edition) => (
          <NativeSelectOption key={edition.tag} value={edition.tag}>
            {optionTextOf(edition)}
          </NativeSelectOption>
        ))}
      </NativeSelect>

      <output
        id={servedSentenceId}
        // `output` carries the implicit `status` role and a polite live region, so a change of the
        // served edition is announced once. `htmlFor` names the control whose value it reports, and
        // `aria-atomic` keeps the sentence whole instead of announcing only the fragments that
        // changed. This is the component's only polite region: the unavailable case speaks through
        // the notice below, so the two never announce the same fact twice.
        htmlFor={selectId}
        aria-atomic="true"
        className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-start text-xs"
      >
        {servedSentence}
      </output>

      {isUnavailable ? (
        <StateNotice
          kind="language-unavailable"
          // The heading names the missing language and nothing else: no edition title, no count, no
          // sibling language and no hint that another audience has one.
          title={
            requestedName === "" ? "Language unavailable" : `Language unavailable: ${requestedName}`
          }
          description={
            hasEditions
              ? "Choose another language from the list to read this edition in one you are permitted to read."
              : "No edition you are permitted to read exists in the language you asked for, and there is no other language to offer here."
          }
        />
      ) : null}
    </div>
  );
}

export default LocaleSwitcher;
