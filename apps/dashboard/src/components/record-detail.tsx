"use client";

/**
 * The one record detail body: the single composition every record opens into.
 *
 * A record is opened three ways — at its own route, in a side panel over the list it came from, and
 * as the full page a phone shows — and all three render this component. There is deliberately no
 * second detail component, no "panel variant" and no mobile card copy: a second implementation would
 * let one presentation keep a private note, a withheld amount or an unavailable section that the
 * others correctly omit, and the difference would be invisible until a worker read the same record
 * twice.
 *
 * `layout` is chrome and nothing else. It changes the width and padding of the surface, the heading
 * level (a route's `h1` becomes a panel's or sheet's `h2`, with every section heading one level
 * below), the avatar and card density, and whether the action bar is sticky. It never changes which
 * sections render, their order, or which actions exist, because those are properties of the record
 * and of the authority it was read under.
 *
 * The order is fixed and exported as {@link RECORD_DETAIL_SECTIONS}: identity, permitted contact
 * methods, restrictions, relationship context, actual activity, private notes, open tasks and
 * authorised support history. Each present section is a real `<section>` with its own heading, joined
 * to the next by a `Separator`, so the body has a document outline a screen reader can navigate
 * rather than a stack of divs.
 *
 * Record classes stay apart here, because the closest surfaces are the ones that most easily blur:
 *
 * - Private notes are their own section carrying their own audience label. They are never merged
 *   into activity, into support history or into anything an export or another record's audience
 *   carries, and this component renders them only from the `privateNotes` slot.
 * - A restriction is its own section with its own wording. It is not a tag and not a note.
 * - Actual activity is what happened, with the precision its date is known to. A gift, a scheduled
 *   task or an opened mail or dialer app is never an activity, so this section is titled for what it
 *   holds and never for what a worker might hope it proves.
 * - Support history is financial and is rendered through {@link RecordDetailFigures}, which reads
 *   each figure's `ValueState` so a genuine zero, an unknown value, a withheld value, an unavailable
 *   source and an incomplete subtotal stay five different renderings — in the cell, in the accessible
 *   name and in whatever an export copies. This file formats no money and computes no total: it
 *   renders the text `@/modules/money/format` already produced, and a figure that has no number
 *   renders its state word instead of a plausible `0`.
 * - Identity is never inferred. Two records with the same name, the same email address or the same
 *   postal address stay two records, so an opaque `{ system, reference }` is shown as the identifier
 *   it is, inside `<bdi>` with the monospace identifier utility, and every name and amount is
 *   isolated the same way. Direction is inherited from the block; nothing here sets `dir`, and
 *   spacing uses logical utilities only.
 *
 * What it refuses to do, because a second owner of these facts is how surfaces drift apart:
 *
 * - It holds no record state. The body renders the projected data it is given and keeps nothing;
 *   the read envelope stays the one shape the query cache holds, and the service stays the one owner
 *   of filtering, totals and revisions.
 * - It fetches nothing, reads no clock and formats no date. The caller composes each slot — including
 *   the read's coverage or basis statement, where a financial section needs one — from the values the
 *   service supplied for the reader's display preferences.
 * - It never renders a denied read. Authorisation happens before enumeration, so a denial reaches the
 *   caller as the `denied` notice and never as a body with a count, a title, a size or an existence
 *   hint for this component to leak. A section whose content is *withheld* is omitted rather than
 *   emptied: an absent slot renders no section, so emptiness here always means a section genuinely
 *   has nothing to show, which is why a caller that has nothing to list renders its honest empty state
 *   inside the slot rather than leaving the slot out.
 * - It composes no row menu, no board and no second form. Row actions arrive through `actions` and are
 *   additionally reachable in the body, and the slots carry their own content.
 *
 * States: `isLoading` renders section-shaped skeletons in the same order as the body and marks the
 * region `aria-busy`, never a blank surface and never an empty state. `unavailable` renders the
 * `StateNotice` for the source that could not be read, with the read's opaque reference, the caller's
 * retry and every independent section still usable. Both keep the Development data label of the
 * surrounding shell intact, because neither is allowed to look like a production absence.
 *
 * Accessibility: the root is an `<article>` named by the identity heading, the breadcrumb is the
 * design system's labelled navigation landmark, and the first focusable element is a skip link to the
 * sections rather than an action. Every interactive element arrives from `components/ui` at 24x24 CSS
 * px or better, focus rings come from the one `--ring` token, and the sticky action bar clears the
 * focused control because the stylesheet's global `scroll-padding`/`scroll-margin` offset applies to
 * every element with an id (WCAG 2.2 2.4.11). No transition is needed to perceive a section.
 *
 * This is not a wrapper around a dependency: the three-chrome contract, the fixed section order, the
 * record-class separation and the value-state rendering are the shared concern itself, and
 * `side-panel.tsx` composes *this* file rather than the reverse, so the import direction stays
 * one-way.
 */

import Link from "next/link";
import { Fragment, useId, type ReactNode } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import StateNotice from "@/components/state-notice";
import StatusBadge, { valueStateWord } from "@/components/status-badge";
import { cn } from "@/lib/cn";
import { formatSourceReference, type SourceReference } from "@/lib/ids";
import type { ValueState } from "@/modules/data-service/envelope";

// ---------------------------------------------------------------------------------------------
// The fixed body
// ---------------------------------------------------------------------------------------------

/**
 * The sections of a record body, in the only order they render.
 *
 * Exported because a feature composes its slots against this list, and because the order is a
 * contract: the same record read at its route, in a side panel and on a phone lists the same facts in
 * the same sequence. A section is present only when its slot is filled, so a context that withholds a
 * section omits it instead of showing an empty one.
 */
export const RECORD_DETAIL_SECTIONS = [
  "contactMethods",
  "restrictions",
  "relationshipContext",
  "activity",
  "privateNotes",
  "openTasks",
  "supportHistory",
] as const;

/** One named section of the record body. */
export type RecordDetailSection = (typeof RECORD_DETAIL_SECTIONS)[number];

/**
 * The heading of each section.
 *
 * A heading names what the section holds, not what a reader might infer from it: "Actual activity"
 * rather than "Activity", so a gift or an opened mail app cannot be mistaken for something that
 * happened between two people.
 */
export const RECORD_DETAIL_SECTION_TITLES: Readonly<Record<RecordDetailSection, string>> = {
  contactMethods: "Permitted contact methods",
  restrictions: "Restrictions",
  relationshipContext: "Relationship context",
  activity: "Actual activity",
  privateNotes: "Private notes",
  openTasks: "Open tasks",
  supportHistory: "Support history",
};

/**
 * The one-line explanation a section carries when its meaning is easily confused with a neighbouring
 * one. Sections whose heading says everything are deliberately absent.
 */
const SECTION_DESCRIPTIONS: Readonly<Partial<Record<RecordDetailSection, string>>> = {
  restrictions:
    "A restriction records what must not happen for this relationship. It is not a tag and not a note, so it is listed here in its own words.",
  activity:
    "Only something that happened appears here, with the precision its date is known to. A gift, a scheduled task or an opened mail or dialer app is not an activity.",
  privateNotes:
    "These lines are yours alone. They never appear in a shared projection, in an export, or in another record's audience.",
};

/**
 * The audience a private note is shown with, stated once so no two surfaces word it differently and
 * a reader never has to infer from a section heading whether the text beside it is shared.
 */
export const PRIVATE_NOTE_AUDIENCE_LABEL = "Private note — only you";

/** The retry a caller offers beside an unavailable source. */
const UNAVAILABLE_RETRY_LABEL = "Try again";

/** What an unavailable source says, worded so an outage is never read as an empty record. */
const UNAVAILABLE_TITLE = "One source behind this record could not be read";
const UNAVAILABLE_DESCRIPTION =
  "The sections that depend on that source are unavailable rather than empty. Everything else on this record still works, and nothing was changed.";

/** The bypass a keyboard user gets before the breadcrumb's links and the body's actions. */
const SKIP_TO_SECTIONS_LABEL = "Skip to the record's sections";

/**
 * How many section-shaped skeleton blocks a loading body paints.
 *
 * The number is a density placeholder and makes no claim about which sections the record will turn
 * out to have — the loaded body renders exactly the slots the caller filled.
 */
const LOADING_SECTION_BLOCKS = 3;

/** The line widths inside one skeleton block, cycled so a block does not read as a single bar. */
const LOADING_LINE_WIDTHS = ["w-full", "w-5/6", "w-2/3"] as const;

// ---------------------------------------------------------------------------------------------
// The three chromes
// ---------------------------------------------------------------------------------------------

/** The presentations one record body serves. */
export type RecordDetailLayout = "page" | "panel" | "sheet";

/** What one presentation changes. Chrome only: never a section, an order or an action. */
interface LayoutChrome {
  /** The surface's width and vertical rhythm, using logical and token utilities only. */
  readonly surface: string;
  /** The identity heading's level: a route's `h1`, or the panel's or sheet's `h2`. */
  readonly headingLevel: 1 | 2;
  /** The identity heading's size, which follows from the level it takes. */
  readonly headingSize: string;
  /** The avatar density that matches the surface. */
  readonly avatarSize: "default" | "lg";
  /** The card density: a route has room for the default spacing, a panel and a sheet do not. */
  readonly cardSize: "default" | "sm";
  /** The action bar: in flow on a route, held at the top of a scrolling panel or sheet. */
  readonly actionBar: string;
}

/** The action bar in flow, where the page itself scrolls. */
const STATIC_ACTION_BAR = "flex flex-wrap items-center gap-2";

/**
 * The action bar held at the top of a scrolling surface.
 *
 * It paints the surface token rather than a literal, so content scrolling underneath stays legible,
 * and it declares no height: the reaching controls keep their own 24x24 CSS px target size.
 */
const STICKY_ACTION_BAR =
  "sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-background/95 py-2 backdrop-blur-sm";

/** One presentation's chrome, keyed by the closed layout union. */
const LAYOUT_CHROME: Readonly<Record<RecordDetailLayout, LayoutChrome>> = {
  page: {
    surface: "mx-auto flex w-full max-w-4xl flex-col gap-4 py-6",
    headingLevel: 1,
    headingSize: "text-xl",
    avatarSize: "lg",
    cardSize: "default",
    actionBar: STATIC_ACTION_BAR,
  },
  panel: {
    surface: "flex w-full flex-col gap-4 py-4",
    headingLevel: 2,
    headingSize: "text-lg",
    avatarSize: "default",
    cardSize: "sm",
    actionBar: STICKY_ACTION_BAR,
  },
  sheet: {
    surface: "flex w-full flex-col gap-4 py-3",
    headingLevel: 2,
    headingSize: "text-lg",
    avatarSize: "default",
    cardSize: "sm",
    actionBar: STICKY_ACTION_BAR,
  },
};

// ---------------------------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------------------------

/** Where the worker returns to, and the list context that will still be filtered when they do. */
export interface RecordDetailBreadcrumbEntry {
  /** Reader-facing text, for example "Partner roster" or the name of the saved view in use. */
  readonly label: string;
  /** The destination, which carries the query state the list was read under. */
  readonly href: string;
}

/**
 * Who the record is about.
 *
 * `displayName` and `secondaryName` are record values, not derived ones: the second is the
 * disambiguating name the read supplied (a household, a role, a distinguishing detail) and is never
 * assembled from the first. `kind` is the reader-facing word for the record class. `reference` is the
 * opaque source reference, shown as the identifier it is so two look-alike records stay two records.
 */
export interface RecordDetailIdentity {
  /** The name this record is displayed by, isolation-rendered inside `<bdi>`. */
  readonly displayName: string;
  /** The read's own second line of identity, when it supplies one. */
  readonly secondaryName?: string;
  /** The record class in words — "Person", "Household", "Church", "Organization", "Preparation". */
  readonly kind: string;
  /** An admitted portrait, or absent so the initials stand in and no image is requested. */
  readonly avatarSrc?: string;
  /** The opaque `{ system, reference }` the source issued, never a name or an address. */
  readonly reference?: SourceReference;
}

/**
 * The named slots a feature fills.
 *
 * Every member is content for one section, in the order {@link RECORD_DETAIL_SECTIONS} fixes. A
 * member left out omits its section, which is how a context that withholds a fact avoids rendering an
 * empty one; a member that is present but has nothing to list renders its own honest empty state (a
 * `StateNotice` of kind `empty`) so "nothing recorded" never looks like "nothing shown".
 */
export interface RecordDetailSectionSlots {
  /** Contact methods with their permitted state — contactability, never consent. */
  readonly contactMethods?: ReactNode;
  /** What must not happen for this relationship. */
  readonly restrictions?: ReactNode;
  /** How this record relates to the worker's context: household, representation, initiative. */
  readonly relationshipContext?: ReactNode;
  /** Interactions that actually happened, with the precision their date is known to. */
  readonly activity?: ReactNode;
  /** The worker's own text, in its own section under its own audience label. */
  readonly privateNotes?: ReactNode;
  /** Open and overdue work linked to this record, and nothing about what it proves. */
  readonly openTasks?: ReactNode;
  /**
   * Authorised support history. Render financial figures through {@link RecordDetailFigures} so each
   * amount carries its `ValueState`, and add the read's coverage or basis statement where the read
   * supplied one.
   */
  readonly supportHistory?: ReactNode;
}

/** A source that could not be read, with the caller's retry of the same read. */
export interface RecordDetailUnavailable {
  /** The source system and its opaque reference, as the envelope stated them. */
  readonly source: SourceReference;
  /**
   * A re-request of the same read. It replays one read under the same scope and query, so a retry
   * returns the source's current answer instead of a second effect.
   */
  readonly onRetry?: () => void;
}

/** Props of {@link RecordDetail}. */
export interface RecordDetailProps {
  /** Which of the three presentations renders this body. Changes chrome only. */
  readonly layout: RecordDetailLayout;

  /** Who the record is about. */
  readonly identity: RecordDetailIdentity;

  /**
   * The sections to render, in the order {@link RECORD_DETAIL_SECTIONS} fixes. Omit a slot to omit
   * its section; pass an empty object while loading.
   */
  readonly sections?: RecordDetailSectionSlots;

  /**
   * The list context being returned to, outermost first. Every entry is a destination — the record
   * itself is the heading, so it is not repeated as a crumb — and each href carries the filters,
   * sort and page the list was read under, which is what makes the return path exact.
   */
  readonly breadcrumb?: readonly RecordDetailBreadcrumbEntry[];

  /** The record's state label — a `StatusBadge` or `DraftStatus` the feature chose and worded. */
  readonly status?: ReactNode;

  /**
   * The record's actions. They must also be reachable in the body, so a reader who cannot use the
   * bar can still complete the job.
   */
  readonly actions?: ReactNode;

  /** A source behind this record that could not be read. */
  readonly unavailable?: RecordDetailUnavailable;

  /** Whether the sections are still being read. Renders skeletons, never an empty body. */
  readonly isLoading?: boolean;

  /** Layout classes for the surface this body sits in. Never a colour, radius or shadow. */
  readonly className?: string;
}

/**
 * One financial figure of a support section.
 *
 * `value` is text `@/modules/money/format` already produced from exact minor units, or the word the
 * read supplied for a value that is not a number — never a float and never a placeholder this
 * component invents. `valueState` is the state the envelope recorded for that path, and it is what
 * decides whether the value is shown as a figure, shown beside its state word, or replaced by the
 * state word alone.
 */
export interface RecordDetailSupportFigure {
  /** The measure in words, including its currency, period and grain where the read states them. */
  readonly label: string;
  /** The formatted value, or the word for a value that has no number. */
  readonly value: string;
  /** The state the read envelope recorded for this path. Defaults to an ordinary value. */
  readonly valueState?: ValueState;
  /** Where the worker can see the records behind this figure, when the caller has one. */
  readonly href?: string;
}

/** Props of {@link RecordDetailFigures}. */
export interface RecordDetailFiguresProps {
  /** The figures of one support section, in the read's own order. */
  readonly figures: readonly RecordDetailSupportFigure[];
  /** Layout classes for the list. Never a colour, radius or shadow. */
  readonly className?: string;
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/** True when a slot carries content, so a section renders only when it has something to hold. */
function hasContent(slot: ReactNode): boolean {
  return slot !== undefined && slot !== null && slot !== false;
}

/**
 * The initials a portrait-less avatar shows.
 *
 * Isolated from the direction of its neighbours because a name can be right-to-left while the page is
 * not, and taken by code point so a name outside the basic plane is not cut in half.
 */
function initialsOf(displayName: string): string {
  const words = displayName
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  const first = words[0];
  if (first === undefined) {
    return "";
  }
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  const initialOf = (word: string): string => Array.from(word)[0] ?? "";
  return `${initialOf(first)}${last === undefined ? "" : initialOf(last)}`.toUpperCase();
}

/** The states whose amount is a real figure and may therefore be printed beside its state. */
const STATE_KEEPS_THE_FIGURE: ReadonlySet<ValueState> = new Set<ValueState>([
  "value",
  "zero",
  "incomplete-subtotal",
]);

/**
 * A DOM id that is safe both as an `id` and inside a URL fragment.
 *
 * A `useId` value is unique per render tree, but it may contain characters a fragment lookup has to
 * percent-encode, and the skip link below is a real fragment link. Reducing it to the identifier
 * characters keeps the per-tree distinction while making the skip target addressable by every
 * browser.
 */
function toDomId(generated: string, suffix: string): string {
  return `record-detail-${generated.replace(/[^a-zA-Z0-9_-]/g, "")}-${suffix}`;
}

// ---------------------------------------------------------------------------------------------
// Financial figures
// ---------------------------------------------------------------------------------------------

/**
 * The one rendering of financial figures inside a record body.
 *
 * A figure carries the state its read recorded, and the state decides the rendering rather than the
 * number: a plain value and a genuine zero print the amount the money module formatted, an incomplete
 * subtotal prints its amount with the state word beside it, and an unknown, withheld or unavailable
 * value prints its state word *instead of* the amount, because a number that is not a number must
 * never be shown as `0` or as an empty cell. The state word comes from `components/status-badge`, which
 * owns the five words, so a record body and a report cannot word the same state differently.
 *
 * `srPrefix` makes each word intelligible on its own in a screen reader or a copied row: "Total
 * received: Withheld" rather than an orphaned "Withheld" beside a label the reader never heard.
 */
export function RecordDetailFigures({ figures, className }: RecordDetailFiguresProps) {
  if (figures.length === 0) {
    return null;
  }

  return (
    <dl className={cn("flex flex-col gap-2 text-sm", className)}>
      {figures.map((figure, index) => {
        const state = figure.valueState;
        const word = state === undefined ? undefined : valueStateWord(state);
        const showsFigure = state === undefined || STATE_KEEPS_THE_FIGURE.has(state);
        const amount = <bdi className="tabular-figures">{figure.value}</bdi>;

        return (
          <div
            key={`${figure.label}-${index}`}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"
          >
            <dt className="text-muted-foreground">{figure.label}</dt>
            <dd className="flex flex-wrap items-baseline gap-2">
              {showsFigure ? (
                figure.href === undefined ? (
                  amount
                ) : (
                  <Link className="underline-offset-4 hover:underline" href={figure.href}>
                    {amount}
                  </Link>
                )
              ) : null}
              {word === undefined ? null : (
                <StatusBadge label={word.label} tone={word.tone} srPrefix={figure.label} />
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

// ---------------------------------------------------------------------------------------------
// The body
// ---------------------------------------------------------------------------------------------

/**
 * The single record detail body described at the top of this file.
 *
 * It renders the projected data it is given and holds nothing of its own beyond the two DOM ids it
 * mints, so the same record read twice renders the same body, and a stale surface can only be a stale
 * envelope rather than a local copy drifting from the store.
 */
export function RecordDetail({
  layout,
  identity,
  sections = {},
  breadcrumb,
  status,
  actions,
  unavailable,
  isLoading = false,
  className,
}: RecordDetailProps) {
  const chrome = LAYOUT_CHROME[layout];
  const generatedId = useId();
  const identityHeadingId = toDomId(generatedId, "identity");
  const sectionsRegionId = toDomId(generatedId, "sections");

  // The identity takes the surface's highest heading; every section sits one level below it, so the
  // outline is valid in a route (`h1` then `h2`) and in a panel or sheet (`h2` then `h3`) without the
  // component below ever having to guess which document it landed in.
  const IdentityHeading = chrome.headingLevel === 1 ? "h1" : "h2";
  const SectionHeading = chrome.headingLevel === 1 ? "h2" : "h3";
  const noticeHeadingLevel = chrome.headingLevel === 1 ? 2 : 3;

  const presentSections = RECORD_DETAIL_SECTIONS.filter((section) => hasContent(sections[section]));
  const retry =
    unavailable !== undefined && unavailable.onRetry !== undefined
      ? { label: UNAVAILABLE_RETRY_LABEL, onClick: unavailable.onRetry }
      : undefined;
  const initials = initialsOf(identity.displayName);
  const showsSkipLink = !isLoading && presentSections.length > 0;

  return (
    <article
      aria-busy={isLoading ? true : undefined}
      aria-labelledby={identityHeadingId}
      className={cn(chrome.surface, className)}
    >
      {/* First in the focus order, and never an action: a keyboard user reaches the record's
          sections before the breadcrumb's links or anything the actions bar holds. */}
      {showsSkipLink ? (
        <a
          href={`#${sectionsRegionId}`}
          className="sr-only rounded-md px-2 py-1 text-sm focus-visible:not-sr-only focus-visible:bg-background"
        >
          {SKIP_TO_SECTIONS_LABEL}
        </a>
      ) : null}

      {breadcrumb !== undefined && breadcrumb.length > 0 ? (
        <Breadcrumb>
          <BreadcrumbList>
            {breadcrumb.map((entry, index) => (
              <Fragment key={entry.href}>
                {index > 0 ? <BreadcrumbSeparator /> : null}
                <BreadcrumbItem>
                  <BreadcrumbLink render={<Link href={entry.href} />}>{entry.label}</BreadcrumbLink>
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      ) : null}

      <Card size={chrome.cardSize}>
        <CardHeader>
          <div className="flex items-start gap-3">
            <Avatar size={chrome.avatarSize} className="mt-0.5">
              {identity.avatarSrc !== undefined && identity.avatarSrc.length > 0 ? (
                <AvatarImage src={identity.avatarSrc} alt="" />
              ) : null}
              {/* The heading beside it already names the record, so the initials are not announced
                  twice; a name in any script is taken by code point rather than cut in half. */}
              <AvatarFallback aria-hidden="true">
                {initials.length > 0 ? initials : "?"}
              </AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col gap-1">
              <CardTitle>
                <IdentityHeading
                  id={identityHeadingId}
                  className={cn("font-heading font-medium text-balance", chrome.headingSize)}
                >
                  <bdi>{identity.displayName}</bdi>
                </IdentityHeading>
              </CardTitle>
              {identity.secondaryName !== undefined && identity.secondaryName.length > 0 ? (
                <p className="text-sm text-muted-foreground">
                  <bdi>{identity.secondaryName}</bdi>
                </p>
              ) : null}
              <CardDescription>{identity.kind}</CardDescription>
              {identity.reference !== undefined ? (
                <p className="text-xs text-muted-foreground">
                  <span className="sr-only">Source reference: </span>
                  {/* An opaque reference, never parsed and never a join key: a leading zero survives
                      and a mixed-direction neighbour cannot reorder it. */}
                  <bdi className="mono-identifier">{formatSourceReference(identity.reference)}</bdi>
                </p>
              ) : null}
            </div>
          </div>
          {hasContent(status) ? <CardAction>{status}</CardAction> : null}
        </CardHeader>
      </Card>

      {hasContent(actions) ? <div className={chrome.actionBar}>{actions}</div> : null}

      {unavailable !== undefined ? (
        <StateNotice
          kind="unavailable"
          title={UNAVAILABLE_TITLE}
          description={UNAVAILABLE_DESCRIPTION}
          source={unavailable.source}
          retry={retry}
          headingLevel={noticeHeadingLevel}
        />
      ) : null}

      {isLoading ? (
        // Section-shaped, in the body's own order, and hidden from assistive technology because the
        // region already states that it is busy. A loading body is never an empty one.
        <div aria-hidden="true" className="flex flex-col gap-4">
          {Array.from({ length: LOADING_SECTION_BLOCKS }, (_unused, index) => (
            <Fragment key={index}>
              {index > 0 ? <Separator /> : null}
              <div className="flex flex-col gap-2">
                <Skeleton className="h-5 w-40" />
                {LOADING_LINE_WIDTHS.map((width) => (
                  <Skeleton key={width} className={cn("h-4", width)} />
                ))}
              </div>
            </Fragment>
          ))}
        </div>
      ) : (
        // The skip link's destination. Focusable only programmatically, so the skip lands here
        // without putting a stray tab stop between the actions and the first control of a section.
        <div id={sectionsRegionId} tabIndex={-1} className="flex flex-col gap-4">
          {presentSections.map((section, index) => {
            const headingId = `${sectionsRegionId}-${section}`;
            const description = SECTION_DESCRIPTIONS[section];

            return (
              <Fragment key={section}>
                {index > 0 ? <Separator /> : null}
                <section aria-labelledby={headingId} className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <SectionHeading id={headingId} className="font-heading text-base font-medium">
                      {RECORD_DETAIL_SECTION_TITLES[section]}
                    </SectionHeading>
                    {section === "privateNotes" ? (
                      <StatusBadge label={PRIVATE_NOTE_AUDIENCE_LABEL} tone="muted" />
                    ) : null}
                  </div>
                  {description === undefined ? null : (
                    <p className="text-sm text-muted-foreground">{description}</p>
                  )}
                  {sections[section]}
                </section>
              </Fragment>
            );
          })}
        </div>
      )}
    </article>
  );
}

export default RecordDetail;
