"use client";

import { useId, type ReactNode } from "react";

import DraftStatus, {
  LIFECYCLE_STATUS,
  type ContentLifecycleState,
  type LifecycleSpec,
} from "@/components/draft-status";
import StatusBadge, { type StatusBadgeSpec } from "@/components/status-badge";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import type { ContentLocale } from "@/modules/content/locale";
import {
  VARIANT_AUDIENCES,
  variantKeyAllowed,
  type VariantAudience,
  type VariantFamily,
} from "@/modules/content/variant";

/**
 * The one selector over a content document's editions: which audience variant and which exact
 * content locale the worker is looking at, in both content families.
 *
 * It is one component because Ministry Updates and Worker/Project Pages ask the same question —
 * "which edition of this document is on screen, and what state is it in?" — and because AAP 0.8.6
 * requires each locale edition and each Update variant to keep its own draft, candidate and release.
 * The Updates variant overview and editor, the Page builder and its edition list, and the review
 * header all compose this component, so one vocabulary describes every edition of every family.
 *
 * What it enforces, and what it deliberately refuses to do:
 *
 * - **Only the family's permitted audience axis.** The content module's own family rule decides
 *   whether a family may hold this audience at all: an Update may carry a Public and an
 *   Approved-supporter variant per locale, while a Worker Page or a Project Page is a public locale
 *   edition only. An edition the
 *   family forbids is dropped rather than rendered disabled, so a Page can never display a
 *   full audience × locale cross-product or an audience it does not have. Creating a variant is a
 *   named mutation on the feature's own surface, so there is no "add audience" affordance here.
 * - **Nothing about a denied edition.** This component renders exactly the editions its `variants`
 *   prop supplies; a variant the caller may not read is absent from that list and nothing here
 *   renders a placeholder, a lock, a count or a hint that it exists. The empty state says only that
 *   no edition is listed here, which is true whether or not anything exists elsewhere.
 * - **Unmistakable edition identity.** Every edition states its audience word, its locale's endonym
 *   and its lifecycle word together — "Approved supporter, العربية, Draft" — and the active edition
 *   is `aria-selected`. The lifecycle vocabulary is `LIFECYCLE_STATUS`, the one `DraftStatus` owns,
 *   so a candidate is never worded as a release and a stale translation is visible here rather than
 *   only inside the editor; the active edition additionally renders `DraftStatus`, whose sentence
 *   says what its state permits.
 * - **No state ownership and no write.** `activeVariantId` is a route or query fact of the feature
 *   and the component is fully controlled. Selecting an edition calls `onSelect` and does nothing
 *   else: it writes nothing, advances no release, and cannot disturb another edition's draft,
 *   candidate or release (Rule 1 clause 3). The audience on screen is decided by the resolved
 *   principal and the read envelope, never by this control, which can only ask for an edition the
 *   caller has already supplied as readable.
 * - **One polite announcement.** The single live region is the `<output>` beneath the control, which
 *   names the edition that is now on screen, so a change is announced once. The tabs themselves are
 *   the installed `Tabs`, which brings a single tab stop and arrow-key movement between editions;
 *   activation is deliberate (Enter or Space) rather than following focus, so arrowing across four
 *   editions does not request four reads.
 * - **A narrow-screen select, not a scrolling strip.** Below the `sm` breakpoint the control becomes
 *   a labelled `NativeSelect`, so the strip can never overflow or push the page sideways at 320 CSS
 *   px, and the platform supplies typeahead, a wheel and single-pointer operation with no second
 *   listbox widget to reimplement. Above it the strip wraps rather than scrolling horizontally.
 * - **Direction is the content's.** Every endonym renders inside `<bdi lang>` so a run of another
 *   script cannot reorder the label around it; layout uses logical utilities only; and no `dir`, CSS
 *   `direction` or transform is set here, because the edition's direction belongs to the consuming
 *   surface (`components/locale-switcher` reports it, `components/ui/direction` provides it).
 *
 * Every class below is a token utility or a variant of an installed component: no colour, radius,
 * shadow or spacing literal appears. The component holds no record state, reads no clock, fetches
 * nothing, formats no money and mints no identifier.
 */

/**
 * The word and tone of each audience a variant may serve, exhaustive over the content module's closed
 * union so a third audience is a compile error rather than an unlabelled chip.
 *
 * `status-badge` owns the state vocabularies but has none for content audiences, because the audience
 * axis is this selector's concern: the value a worker needs is which of the two audiences an edition
 * serves. Neither tone implies merit — `public` is the quiet neutral chip and `approved-supporter` the
 * system's emphasis fill, which reads as "a narrower audience", not as a better one.
 */
export const AUDIENCE_WORDS: Readonly<Record<VariantAudience, StatusBadgeSpec>> = {
  public: { label: "Public", tone: "neutral" },
  "approved-supporter": { label: "Approved supporter", tone: "info" },
};

/** What the empty state says. It states absence here and implies nothing about anywhere else. */
const NO_EDITION_NOTICE = "No edition you are permitted to read is listed here.";

/**
 * The name a language gives itself: `fr` is "français" and `ar` is "العربية".
 *
 * It is a display name and nothing else — no lifecycle, reach or fallback decision consults it. The
 * content and locale contracts carry a tag and a direction, not a name, so the platform is asked in
 * the tag's own language and answers with an endonym; a name a caller already holds is not accepted
 * here because `VariantTab` is the service's own edition shape and carries no display text. A tag the
 * platform cannot name, and a runtime without the ICU data, both answer the tag itself, which is
 * unhelpful but never wrong.
 */
function languageEndonymOf(tag: string): string {
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

/**
 * One edition this selector may offer: the identity of the variant, the audience it serves, its exact
 * content locale, and the lifecycle state the surface derived for it.
 *
 * The state is supplied rather than derived here, because deriving it needs the variant record, the
 * release the surface is about and — for a partial release or a stale translation — evidence only
 * that surface holds. `components/draft-status` owns that derivation (`lifecycleOf`), so this shape
 * carries its answer and the switcher holds no second rule. `staleSince` is the caller's already
 * formatted instant, passed through to `DraftStatus` so the staleness sentence is produced in one
 * place.
 */
export interface VariantTab {
  /** The variant's identity, which is also the value {@link VariantSwitcherProps.onSelect} reports. */
  readonly variantId: string;
  /** The audience this edition serves. Whether the family permits it is checked before rendering. */
  readonly audience: VariantAudience;
  /** The exact content locale of the edition. */
  readonly locale: ContentLocale;
  /** The lifecycle state, as `lifecycleOf` derived it from the service's records. */
  readonly lifecycle: ContentLifecycleState;
  /** When the source revision a manual translation copied was replaced, already formatted. */
  readonly staleSince?: string;
}

/** Props of {@link VariantSwitcher}. */
export interface VariantSwitcherProps {
  /**
   * The content family the document belongs to. It decides the permitted audience axis: an Update
   * admits both audiences, a Worker or Project Page admits `public` alone.
   */
  readonly family: VariantFamily;
  /**
   * The editions this caller may read, in any order. An edition absent from this list is never
   * rendered, and nothing reveals that it was withheld.
   */
  readonly variants: readonly VariantTab[];
  /**
   * The edition on screen, as a route or query fact of the feature. Empty, or naming an edition that
   * is not in `variants`, means no edition is marked current — the control states that plainly rather
   * than selecting a plausible-looking neighbour.
   */
  readonly activeVariantId: string;
  /**
   * Asks the feature to show another edition. It is called only with an id from `variants`, and only
   * for a change the worker made — never on render, and never for an automatic fallback.
   */
  readonly onSelect: (variantId: string) => void;
  /** The control group's visible label and the accessible name of the tab list. */
  readonly label: string;
  /** Placement classes from the surrounding surface, using logical utilities only. */
  readonly className?: string;
}

/** The list order of the two audiences, taken from the content module's own declaration. */
function audienceRank(audience: VariantAudience): number {
  const index = VARIANT_AUDIENCES.indexOf(audience);
  return index === -1 ? VARIANT_AUDIENCES.length : index;
}

/** Compares BCP-47 tags in the one case in which they carry no meaning. */
function compareLocaleTags(left: string, right: string): number {
  const a = left.trim().toLowerCase();
  const b = right.trim().toLowerCase();
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

/**
 * The one order the editions are listed in: by locale, then by audience, then by identity.
 *
 * Grouping a locale's audiences together keeps the two variants of one language side by side, which
 * is the structure of the record — one document, several language editions, each of which an audience
 * may read. The order is total and depends on nothing but the input, so the same set of editions is
 * always listed the same way: a strip that reshuffled between renders would move the edition under a
 * reader's pointer and make the active tab hard to follow.
 */
function compareEditions(left: VariantTab, right: VariantTab): number {
  const byLocale = compareLocaleTags(left.locale.tag, right.locale.tag);
  if (byLocale !== 0) {
    return byLocale;
  }
  const byAudience = audienceRank(left.audience) - audienceRank(right.audience);
  if (byAudience !== 0) {
    return byAudience;
  }
  if (left.variantId === right.variantId) {
    return 0;
  }
  return left.variantId < right.variantId ? -1 : 1;
}

/**
 * The editions this selector may show, in {@link compareEditions}'s order.
 *
 * The content module's family check is the only statement of which audience a family admits, and it
 * is applied here once: an edition the family forbids is dropped, not disabled and not counted. A
 * repeat of an identity already listed is collapsed for the same reason — two tabs for one edition
 * would offer the same choice twice and leave `aria-selected` ambiguous — and an edition with no
 * identity is skipped, because a tab whose value is empty cannot be selected or announced
 * meaningfully.
 */
function permittedEditions(
  family: VariantFamily,
  variants: readonly VariantTab[],
): readonly VariantTab[] {
  const seen = new Set<string>();
  const permitted: VariantTab[] = [];

  for (const variant of variants) {
    if (!variantKeyAllowed(family, variant.audience)) {
      continue;
    }
    if (variant.variantId.trim() === "" || seen.has(variant.variantId)) {
      continue;
    }
    seen.add(variant.variantId);
    permitted.push(variant);
  }

  return permitted.sort(compareEditions);
}

/**
 * The word of one lifecycle state, taken from the vocabulary `DraftStatus` owns rather than restated.
 *
 * A state the vocabulary does not describe cannot arrive through the type, but a value cast in from a
 * response can: it is rendered as itself instead of throwing, so one unlabelled edition does not blank
 * the selector that exists to identify editions.
 */
function lifecycleWordOf(state: ContentLifecycleState): string {
  const spec: LifecycleSpec | undefined = LIFECYCLE_STATUS[state];
  return spec === undefined ? String(state) : spec.label;
}

/**
 * The sentence naming one edition in full: its audience, its locale's own name and its lifecycle.
 *
 * The same sentence is the tab's accessible name and the select option's text, so a reader meets one
 * wording of an edition whichever control the viewport gives them.
 */
function spokenNameOf(variant: VariantTab): string {
  const audience = AUDIENCE_WORDS[variant.audience].label;
  const endonym = languageEndonymOf(variant.locale.tag);
  return `${audience}, ${endonym}, ${lifecycleWordOf(variant.lifecycle)}`;
}

/**
 * The one audience-variant and edition selector.
 *
 * Renders one tab per permitted edition above the `sm` breakpoint and one labelled select below it,
 * marks the active edition, names it in a single polite region, and states the active edition's
 * lifecycle through `DraftStatus`. It writes nothing, holds no state and changes no audience.
 */
export function VariantSwitcher({
  family,
  variants,
  activeVariantId,
  onSelect,
  label,
  className,
}: VariantSwitcherProps): ReactNode {
  const labelId = useId();
  const selectId = useId();
  const announcementId = useId();

  const activeId = activeVariantId.trim();
  const editions = permittedEditions(family, variants);
  const active = editions.find((edition) => edition.variantId === activeId);

  /*
   * Every request passes through here, whichever control the viewport offers. The chosen id is looked
   * up in the list the control was given, so a stale option or a tampered value selects nothing rather
   * than asking for an edition the caller does not hold; and an edition already on screen is not
   * requested again, because re-choosing it is not a change.
   */
  const requestSelection = (candidate: string): void => {
    const chosen = editions.find((edition) => edition.variantId === candidate);
    if (chosen === undefined || chosen.variantId === activeId) {
      return;
    }
    onSelect(chosen.variantId);
  };

  if (editions.length === 0) {
    return (
      <div
        data-slot="variant-switcher"
        data-family={family}
        data-no-editions="true"
        className={cn("flex min-w-0 flex-col gap-2", className)}
      >
        <span className="text-start text-sm leading-none font-medium">{label}</span>
        <p className="text-start text-sm text-muted-foreground text-pretty wrap-anywhere">
          {NO_EDITION_NOTICE}
        </p>
      </div>
    );
  }

  let announcement: ReactNode;
  if (active === undefined) {
    announcement = "No edition is selected here.";
  } else {
    announcement = (
      <>
        {"Showing "}
        {AUDIENCE_WORDS[active.audience].label}
        {", "}
        <bdi lang={active.locale.tag}>{languageEndonymOf(active.locale.tag)}</bdi>
        {", "}
        {lifecycleWordOf(active.lifecycle)}
        {"."}
      </>
    );
  }

  return (
    <div
      data-slot="variant-switcher"
      data-family={family}
      data-active-variant={active === undefined ? undefined : active.variantId}
      data-active-lifecycle={active === undefined ? undefined : active.lifecycle}
      className={cn("flex min-w-0 flex-col gap-2", className)}
    >
      <div className="hidden min-w-0 flex-col gap-2 sm:flex">
        <span
          id={labelId}
          className="text-start text-sm leading-none font-medium text-pretty wrap-anywhere"
        >
          {label}
        </span>
        <Tabs
          // `null` rather than `undefined`: Base UI reads `null` as "no tab is active" in a
          // controlled root, while `undefined` hands the root back to its own default selection and
          // would mark an edition current that the feature never chose.
          value={active === undefined ? null : active.variantId}
          onValueChange={(value: unknown, eventDetails: { reason: string }) => {
            // Only a selection the worker made asks for a different edition. Base UI also reports
            // automatic changes — an initial or missing-tab fallback — and those must never move a
            // feature to an edition nobody chose.
            if (eventDetails.reason !== "none" || typeof value !== "string") {
              return;
            }
            requestSelection(value);
          }}
          className="min-w-0"
        >
          <TabsList
            aria-labelledby={labelId}
            // The list wraps instead of scrolling: its own height is released so a second row of
            // editions is not clipped, and it is bounded by the column so no strip can widen the page.
            className="group-data-horizontal/tabs:h-auto max-w-full flex-wrap justify-start"
          >
            {editions.map((edition) => (
              <TabsTrigger
                key={edition.variantId}
                value={edition.variantId}
                // The visible label is the audience chip, the endonym and the lifecycle word; the
                // accessible name states the same three parts as one sentence, so a screen-reader
                // user never confuses two editions of the same document.
                aria-label={spokenNameOf(edition)}
                className="min-w-0 flex-none items-start whitespace-normal"
              >
                <StatusBadge
                  label={AUDIENCE_WORDS[edition.audience].label}
                  tone={AUDIENCE_WORDS[edition.audience].tone}
                />
                <bdi lang={edition.locale.tag} className="min-w-0 text-start wrap-anywhere">
                  {languageEndonymOf(edition.locale.tag)}
                </bdi>
                <span className="min-w-0 text-start text-muted-foreground wrap-anywhere">
                  {lifecycleWordOf(edition.lifecycle)}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="flex min-w-0 flex-col gap-2 sm:hidden">
        <Label htmlFor={selectId}>{label}</Label>
        <NativeSelect
          id={selectId}
          className="w-full max-w-full"
          value={active === undefined ? "" : active.variantId}
          aria-describedby={announcementId}
          onChange={(event) => requestSelection(event.target.value)}
        >
          {active === undefined ? (
            // Named rather than blank, and not selectable: an empty option reads as a control that
            // failed to load, and choosing it would not name an edition.
            <NativeSelectOption value="" disabled>
              No edition selected
            </NativeSelectOption>
          ) : null}
          {editions.map((edition) => (
            <NativeSelectOption key={edition.variantId} value={edition.variantId}>
              {spokenNameOf(edition)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      <output
        id={announcementId}
        htmlFor={selectId}
        // `output` is the semantic status element, so it carries the polite live region that announces
        // a change without a `role` on a generic element. It is this component's only live region: the
        // tabs announce their own selection and the lifecycle sentence below is not live, so nothing
        // here is spoken twice. `aria-atomic` keeps the sentence whole.
        aria-atomic="true"
        className="text-start text-xs text-muted-foreground text-pretty wrap-anywhere"
      >
        {announcement}
      </output>

      {active === undefined ? null : (
        <DraftStatus state={active.lifecycle} staleSince={active.staleSince} />
      )}
    </div>
  );
}

export default VariantSwitcher;
