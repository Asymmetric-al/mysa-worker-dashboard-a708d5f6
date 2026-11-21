"use client";
/**
 * The one record detail body: the single composition every record opens into.
 */
import Link from "next/link";
import { Fragment, useId, type ReactNode } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import StateNotice from "@/components/state-notice";
import StatusBadge, { valueStateWord } from "@/components/status-badge";
import { cn } from "@/lib/cn";
import { formatSourceReference, type SourceReference } from "@/lib/ids";
import type { ValueState } from "@/modules/data-service/envelope";
// The fixed body
/** The sections of a record body, in the only order they render. */
export const RECORD_DETAIL_SECTIONS = ["contactMethods", "restrictions", "relationshipContext", "activity", "privateNotes", "openTasks", "supportHistory"] as const;
/** One named section of the record body. */
export type RecordDetailSection = (typeof RECORD_DETAIL_SECTIONS)[number];
/** The heading of each section. */
export const RECORD_DETAIL_SECTION_TITLES: Readonly<Record<RecordDetailSection, string>> = {
  contactMethods: "Permitted contact methods",
  restrictions: "Restrictions",
  relationshipContext: "Relationship context",
  activity: "Actual activity",
  privateNotes: "Private notes",
  openTasks: "Open tasks",
  supportHistory: "Support history",
};
const SECTION_DESCRIPTIONS: Readonly<Partial<Record<RecordDetailSection, string>>> = {
  restrictions: "A restriction records what must not happen for this relationship. It is not a tag and not a note, so it is listed here in its own words.",
  activity: "Only something that happened appears here, with the precision its date is known to. A gift, a scheduled task or an opened mail or dialer app is not an activity.",
  privateNotes: "These lines are yours alone. They never appear in a shared projection, in an export, or in another record's audience.",
};
/** The audience a private note is shown with, stated once so no two surfaces word it differently and a reader never has to infer from a section heading whether the text beside it is shared. */
export const PRIVATE_NOTE_AUDIENCE_LABEL = "Private note — only you";

const UNAVAILABLE_RETRY_LABEL = "Try again";

const UNAVAILABLE_TITLE = "One source behind this record could not be read";
const UNAVAILABLE_DESCRIPTION = "The sections that depend on that source are unavailable rather than empty. Everything else on this record still works, and nothing was changed.";

const SKIP_TO_SECTIONS_LABEL = "Skip to the record's sections";

const LOADING_SECTION_BLOCKS = 3;

const LOADING_LINE_WIDTHS = ["w-full", "w-5/6", "w-2/3"] as const;
// The three chromes
/** The presentations one record body serves. */
export type RecordDetailLayout = "page" | "panel" | "sheet";

interface LayoutChrome {
  readonly surface: string;
  readonly headingLevel: 1 | 2;
  readonly headingSize: string;
  readonly avatarSize: "default" | "lg";
  readonly cardSize: "default" | "sm";
  readonly actionBar: string;
}
const STATIC_ACTION_BAR = "flex flex-wrap items-center gap-2";

const STICKY_ACTION_BAR = "sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-background/95 py-2 backdrop-blur-sm";

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
// Props
/** Where the worker returns to, and the list context that will still be filtered when they do. */
export interface RecordDetailBreadcrumbEntry {
  readonly label: string;
  readonly href: string;
}
/** Who the record is about. */
export interface RecordDetailIdentity {
  readonly displayName: string;
  readonly secondaryName?: string;
  readonly kind: string;
  readonly avatarSrc?: string;
  readonly reference?: SourceReference;
}
/** The named slots a feature fills. */
export interface RecordDetailSectionSlots {
  readonly contactMethods?: ReactNode;
  readonly restrictions?: ReactNode;
  readonly relationshipContext?: ReactNode;
  readonly activity?: ReactNode;
  readonly privateNotes?: ReactNode;
  readonly openTasks?: ReactNode;
  readonly supportHistory?: ReactNode;
}
/** A source that could not be read, with the caller's retry of the same read. */
export interface RecordDetailUnavailable {
  readonly source: SourceReference;
  readonly onRetry?: () => void;
}
/** Props of {@link RecordDetail}. */
export interface RecordDetailProps {
  readonly layout: RecordDetailLayout;
  readonly identity: RecordDetailIdentity;
  readonly sections?: RecordDetailSectionSlots;
  readonly breadcrumb?: readonly RecordDetailBreadcrumbEntry[];
  readonly status?: ReactNode;
  readonly actions?: ReactNode;
  readonly unavailable?: RecordDetailUnavailable;
  readonly isLoading?: boolean;
  readonly className?: string;
}
/** One financial figure of a support section. */
export interface RecordDetailSupportFigure {
  readonly label: string;
  readonly value: string;
  readonly valueState?: ValueState;
  readonly href?: string;
}
/** Props of {@link RecordDetailFigures}. */
export interface RecordDetailFiguresProps {
  readonly figures: readonly RecordDetailSupportFigure[];
  readonly className?: string;
}
// Helpers
function hasContent(slot: ReactNode): boolean {
  return slot !== undefined && slot !== null && slot !== false;
}
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
const STATE_KEEPS_THE_FIGURE: ReadonlySet<ValueState> = new Set<ValueState>(["value", "zero", "incomplete-subtotal"]);

function toDomId(generated: string, suffix: string): string {
  return `record-detail-${generated.replace(/[^a-zA-Z0-9_-]/g, "")}-${suffix}`;
}
// Financial figures
/** The one rendering of financial figures inside a record body. */
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
          <div key={`${figure.label}-${index}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
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
              {word === undefined ? null : <StatusBadge label={word.label} tone={word.tone} srPrefix={figure.label} />}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
// The body
/** The single record detail body described at the top of this file. */
export function RecordDetail({ layout, identity, sections = {}, breadcrumb, status, actions, unavailable, isLoading = false, className }: RecordDetailProps) {
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
  const retry = unavailable !== undefined && unavailable.onRetry !== undefined ? { label: UNAVAILABLE_RETRY_LABEL, onClick: unavailable.onRetry } : undefined;
  const initials = initialsOf(identity.displayName);
  const showsSkipLink = !isLoading && presentSections.length > 0;
  return (
    <article aria-busy={isLoading ? true : undefined} aria-labelledby={identityHeadingId} className={cn(chrome.surface, className)}>
      {/* First in the focus order, and never an action: a keyboard user reaches the record's
          sections before the breadcrumb's links or anything the actions bar holds. */}
      {showsSkipLink ? (
        <a href={`#${sectionsRegionId}`} className="sr-only rounded-md px-2 py-1 text-sm focus-visible:not-sr-only focus-visible:bg-background">
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
              {identity.avatarSrc !== undefined && identity.avatarSrc.length > 0 ? <AvatarImage src={identity.avatarSrc} alt="" /> : null}
              {/* The heading beside it already names the record, so the initials are not announced
                  twice; a name in any script is taken by code point rather than cut in half. */}
              <AvatarFallback aria-hidden="true">{initials.length > 0 ? initials : "?"}</AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col gap-1">
              <CardTitle>
                <IdentityHeading id={identityHeadingId} className={cn("font-heading font-medium text-balance", chrome.headingSize)}>
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
        <StateNotice kind="unavailable" title={UNAVAILABLE_TITLE} description={UNAVAILABLE_DESCRIPTION} source={unavailable.source} retry={retry} headingLevel={noticeHeadingLevel} />
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
                    {section === "privateNotes" ? <StatusBadge label={PRIVATE_NOTE_AUDIENCE_LABEL} tone="muted" /> : null}
                  </div>
                  {description === undefined ? null : <p className="text-sm text-muted-foreground">{description}</p>}
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
