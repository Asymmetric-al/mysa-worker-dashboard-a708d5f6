"use client";
import { useId, type ReactNode } from "react";
import DraftStatus, { LIFECYCLE_STATUS, type ContentLifecycleState, type LifecycleSpec } from "@/components/draft-status";
import StatusBadge, { type StatusBadgeSpec } from "@/components/status-badge";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import type { ContentLocale } from "@/modules/content/locale";
import { VARIANT_AUDIENCES, variantKeyAllowed, type VariantAudience, type VariantFamily } from "@/modules/content/variant";
/** The word and tone of each audience a variant may serve, exhaustive over the content module's closed union so a third audience is a compile error rather than an unlabelled chip. */
export const AUDIENCE_WORDS: Readonly<Record<VariantAudience, StatusBadgeSpec>> = {
  public: { label: "Public", tone: "neutral" },
  "approved-supporter": { label: "Approved supporter", tone: "info" },
};
const NO_EDITION_NOTICE = "No edition you are permitted to read is listed here.";

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
/** One edition this selector may offer: the identity of the variant, the audience it serves, its exact content locale, and the lifecycle state the surface derived for it. */
export interface VariantTab {
  readonly variantId: string;
  readonly audience: VariantAudience;
  readonly locale: ContentLocale;
  readonly lifecycle: ContentLifecycleState;
  readonly staleSince?: string;
}
/** Props of {@link VariantSwitcher}. */
export interface VariantSwitcherProps {
  readonly family: VariantFamily;
  readonly variants: readonly VariantTab[];
  readonly activeVariantId: string;
  readonly onSelect: (variantId: string) => void;
  readonly label: string;
  readonly className?: string;
}
function audienceRank(audience: VariantAudience): number {
  const index = VARIANT_AUDIENCES.indexOf(audience);
  return index === -1 ? VARIANT_AUDIENCES.length : index;
}
function compareLocaleTags(left: string, right: string): number {
  const a = left.trim().toLowerCase();
  const b = right.trim().toLowerCase();
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
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
function permittedEditions(family: VariantFamily, variants: readonly VariantTab[]): readonly VariantTab[] {
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
function lifecycleWordOf(state: ContentLifecycleState): string {
  const spec: LifecycleSpec | undefined = LIFECYCLE_STATUS[state];
  return spec === undefined ? String(state) : spec.label;
}
function spokenNameOf(variant: VariantTab): string {
  const audience = AUDIENCE_WORDS[variant.audience].label;
  const endonym = languageEndonymOf(variant.locale.tag);
  return `${audience}, ${endonym}, ${lifecycleWordOf(variant.lifecycle)}`;
}
/** The one audience-variant and edition selector. */
export function VariantSwitcher({ family, variants, activeVariantId, onSelect, label, className }: VariantSwitcherProps): ReactNode {
  const labelId = useId();
  const selectId = useId();
  const announcementId = useId();
  const activeId = activeVariantId.trim();
  const editions = permittedEditions(family, variants);
  const active = editions.find((edition) => edition.variantId === activeId);
  const requestSelection = (candidate: string): void => {
    const chosen = editions.find((edition) => edition.variantId === candidate);
    if (chosen === undefined || chosen.variantId === activeId) {
      return;
    }
    onSelect(chosen.variantId);
  };
  if (editions.length === 0) {
    return (
      <div data-slot="variant-switcher" data-family={family} data-no-editions="true" className={cn("flex min-w-0 flex-col gap-2", className)}>
        <span className="text-start text-sm leading-none font-medium">{label}</span>
        <p className="text-start text-sm text-muted-foreground text-pretty wrap-anywhere">{NO_EDITION_NOTICE}</p>
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
        <span id={labelId} className="text-start text-sm leading-none font-medium text-pretty wrap-anywhere">
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
                <StatusBadge label={AUDIENCE_WORDS[edition.audience].label} tone={AUDIENCE_WORDS[edition.audience].tone} />
                <bdi lang={edition.locale.tag} className="min-w-0 text-start wrap-anywhere">
                  {languageEndonymOf(edition.locale.tag)}
                </bdi>
                <span className="min-w-0 text-start text-muted-foreground wrap-anywhere">{lifecycleWordOf(edition.lifecycle)}</span>
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
      {active === undefined ? null : <DraftStatus state={active.lifecycle} staleSince={active.staleSince} />}
    </div>
  );
}
export default VariantSwitcher;
