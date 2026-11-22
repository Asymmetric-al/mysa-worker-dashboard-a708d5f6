"use client";
/**
 * `/preview` — the receiving list: the released Updates a reader may open now, exactly as the
 * service authorised them.
 *
 * **What this surface decides, and what it deliberately does not.** Nothing here filters, counts,
 * resolves a language fallback or judges reach. The list is the envelope and nothing else: an
 * edition a rule excluded is absent because the read omitted it, and this component never states
 * what was withheld — no hidden-edition count, no disabled row, no hint that a sibling edition
 * exists. Asking for another audience or another language re-renders the route so the server
 * authorises the read again; a locally narrowed list would answer for a scope the service never
 * agreed to.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { EyeIcon } from "lucide-react";
import { useId, type ReactElement, type ReactNode } from "react";
import LocaleSwitcher, { type LocaleEdition } from "@/components/locale-switcher";
import SimulationLabel from "@/components/simulation-label";
import StateNotice, { type NoticeHeadingLevel } from "@/components/state-notice";
import StatusBadge, { VALUE_STATE_WORDS } from "@/components/status-badge";
import VariantSwitcher, { AUDIENCE_WORDS, type VariantTab } from "@/components/variant-switcher";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import type { ContentLocale } from "@/modules/content/locale";
import type { VariantAudience, VariantFamily } from "@/modules/content/variant";
import type { Scope, ValueState } from "@/modules/data-service/envelope";
import type { ReadResult } from "@/modules/data-service/outcome";
import { RECEIVING_LIST_COPY, RECEIVING_POST_COPY, RECEIVING_SIMULATION_EFFECT } from "../copy/receiving";
import { useReceivingList, type ReceivingListEnvelope, type UseReceivingListParams } from "../hooks/use-audience-reads";
// The shapes the read states, taken from the read rather than restated here
/** One edition of one Update as the receiving read states it: its identity, its audience, the locale it is read in and the address it opens at. */
export type ReceivingEditionView = ReceivingListEnvelope["data"]["editions"][number];
/** The paging window of the read: the whole-result count, the page delivered and the page size it executed. */
type ReceivingPageWindow = ReceivingListEnvelope["data"]["page"];
/** The query the receiving read accepts, taken from the hook so an address this surface writes and an answer it reads stay one shape. */
type ReceivingListRequest = NonNullable<UseReceivingListParams["params"]>;
/** The direction an edition is read in, as the content module names it. */
type ContentDirection = ContentLocale["direction"];
// Props
/** The persona whose reading experience this preview shows, as the development runtime named it. It is an identifier and a word, never an inferred audience. */
export interface ReceivingPersonaView {
  readonly id: string;
  readonly label: string;
}
/** Props of {@link ReceivingList}. */
export interface ReceivingListProps {
  /** The authority the server read under; every re-request is authorised again against it. */
  readonly scope: Scope;
  /** The interface locale this surface formats its counts in, stated by the route that composes it. */
  readonly locale: string;
  /** The server's own answer: adopted as the first render and replaced — never merged — by each later server render. */
  readonly initialEnvelope: ReadResult<ReceivingListEnvelope>;
  /** The persona being previewed, stated in text so the surface cannot be mistaken for an anonymous reader. */
  readonly persona: ReceivingPersonaView;
  /** The query the route read with: the language asked for and the page it delivered. Absent members are the read's own defaults. */
  readonly params?: ReceivingListRequest;
  /** The audience whose reading experience the route is previewing, when it knows one. This surface marks it, it never derives it. */
  readonly activeAudience?: VariantAudience;
  /**
   * Asked for another audience. On a receiving preview the audience a person may read is granted by
   * the persona, so the answer belongs to the route: it switches the persona and the server reads
   * again. Without it the request is still put to the server, which is the only place that can
   * answer it.
   */
  readonly onSelectAudience?: (audience: VariantAudience) => void;
  /** The direction the served edition is read in, reported upward so the surrounding document can follow it. */
  readonly onDirectionChange?: (direction: ContentDirection) => void;
  /** The heading level this surface continues from: the route owns the page's one `h1`. */
  readonly headingLevel?: NoticeHeadingLevel;
  readonly className?: string;
}
// Fixed values
const SURFACE_SLOT = "receiving-list";
const EDITION_SLOT = "receiving-edition";
const ITEM_NOUN_SINGULAR = "edition";
const ITEM_NOUN_PLURAL = "editions";
/** Pages are counted from one, because the read slices from `(page - 1) * pageSize`. */
const FIRST_PAGE = 1;
/** The address parameters the receiving read accepts, written here so the request this surface builds is the one the read answers. */
const LOCALE_PARAM = "locale";
const PAGE_PARAM = "page";
const PAGE_SIZE_PARAM = "pageSize";
/**
 * The one content family this read serves. `readReceivingList` admits Update documents only, so the
 * audience switcher is told the family whose audiences these tabs are, instead of guessing it.
 */
const UPDATE_FAMILY = "update" as const satisfies VariantFamily;
/**
 * The lifecycle word for every edition this read can return. The read omits withdrawn and superseded
 * releases before an edition reaches this list, so each row is a current publication — a fact of the
 * envelope, not a lifecycle judgement made here.
 */
const RECEIVED_EDITION_LIFECYCLE = "released" as const;
const AUDIENCE_SWITCHER_LABEL = "Audience this preview shows";
const LOCALE_SWITCHER_LABEL = "Reading language";
const PAGES_LABEL = "Pages of this reading list";
const PREVIOUS_PAGE_LABEL = "Previous page";
const NEXT_PAGE_LABEL = "Next page";
const RETRY_LABEL = "Try again";
const PREVIEWING_AS = "Previewing as";
/** Shown in place of a title the source did not supply, so a row never renders an empty link. */
const UNTITLED_EDITION = "Untitled Update";
const DENIED_TITLE = "This reading list cannot be read with this access";
const UNAVAILABLE_TITLE = "The reading list could not be read";
const REFUSED_TITLE = "This request is not a reading list this view serves";
const REFUSED_DESCRIPTION = "The address asked for something this view does not read, so nothing was read and no list stands in its place. Correct the request and open it again: once it is one this view admits, the read runs unchanged.";
/** Said beside a count the read did not state, so a surface never formats a number the envelope withheld. */
const COUNT_NOT_STATED = "The read did not state how many editions this list holds, so no count is shown here and none is derived from the editions on screen.";
const NO_EDITIONS: readonly ReceivingEditionView[] = [];
const NO_REQUEST: ReceivingListRequest = Object.freeze({});
/** The identity column's link, sized so the target is at least 24 CSS px tall (WCAG 2.5.8). */
const EDITION_LINK_CLASS = "inline-flex min-h-6 max-w-full items-center break-words text-start underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const HEADING_TAG: Readonly<Record<NoticeHeadingLevel, "h1" | "h2" | "h3" | "h4">> = { 1: "h1", 2: "h2", 3: "h3", 4: "h4" };
/** The level a notice nests under: never above its surrounding heading, and never below `h4`. */
const NESTED_HEADING: Readonly<Record<NoticeHeadingLevel, NoticeHeadingLevel>> = { 1: 2, 2: 3, 3: 4, 4: 4 };
/** The whole-number formatters this surface counts with, one per interface locale: the locale is a viewer choice, so the formatter is keyed by the one the route states and the constructor is paid once per locale rather than once per formatted count. */
const COUNT_FORMATS = new Map<string, Intl.NumberFormat>();
/** The whole-number formatter for the interface locale the composing route states. */
function countFormatOf(locale: string): Intl.NumberFormat {
  const known = COUNT_FORMATS.get(locale);
  if (known !== undefined) {
    return known;
  }
  const made = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  COUNT_FORMATS.set(locale, made);
  return made;
}
// Reading the envelope's own statements
const normaliseTag = (tag: string): string => tag.trim().toLowerCase();
/**
 * A language's name in that language. It names a language the reader asked for or is being served;
 * it never resolves which edition serves them, which is the read's answer alone.
 */
function languageNameOf(tag: string): string {
  const trimmed = tag.trim();
  if (trimmed === "") return "";
  const language = (trimmed.split("-")[0] ?? trimmed).toLowerCase();
  try {
    const names = new Intl.DisplayNames([language], { type: "language" });
    const name = names.of(language);
    return name === undefined || name.trim() === "" ? trimmed : name;
  } catch {
    return trimmed;
  }
}
/** The persona's own word, or its identifier when the runtime supplied no label, so the surface always names who is being previewed. */
function personaLabelOf(persona: ReceivingPersonaView): string {
  const label = persona.label.trim();
  return label === "" ? persona.id : label;
}
/** The title a row shows: the edition's own share title, or the stand-in a source without one earns. */
function titleOf(edition: ReceivingEditionView): string {
  const title = edition.title?.trim() ?? "";
  return title === "" ? UNTITLED_EDITION : title;
}
/** The language editions the read supplied, one per language, in the order the read itself stated them. */
function localeEditionsOf(editions: readonly ReceivingEditionView[]): readonly LocaleEdition[] {
  const seen = new Set<string>();
  const locales: LocaleEdition[] = [];
  for (const edition of editions) {
    const key = normaliseTag(edition.locale.tag);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    locales.push({ tag: edition.locale.tag, direction: edition.locale.direction, releaseId: edition.releaseId });
  }
  return locales;
}
/**
 * One tab per audience the read supplied, taken from the edition the read itself ordered first for
 * that audience. The tab's value is that edition's own variant identity, so selecting an audience
 * asks the server for the same route under that audience and never selects an edition on its behalf.
 */
function audienceTabsOf(editions: readonly ReceivingEditionView[]): readonly VariantTab[] {
  const seen = new Set<VariantAudience>();
  const tabs: VariantTab[] = [];
  for (const edition of editions) {
    if (seen.has(edition.audience)) continue;
    seen.add(edition.audience);
    tabs.push({ variantId: edition.variantId, audience: edition.audience, locale: edition.locale, lifecycle: RECEIVED_EDITION_LIFECYCLE });
  }
  return tabs;
}
/**
 * The tab the route says it is previewing. When the route states no audience, the switcher marks the
 * only audience present — a truthful reading of the read's own rows — and marks none when the list
 * spans several, because no single audience is then being previewed.
 */
function activeTabId(tabs: readonly VariantTab[], activeAudience: VariantAudience | undefined): string {
  if (activeAudience !== undefined) {
    const stated = tabs.find((candidate) => candidate.audience === activeAudience);
    return stated === undefined ? "" : stated.variantId;
  }
  return tabs.length === 1 ? (tabs[0]?.variantId ?? "") : "";
}
/** The language this list is actually serving: the one asked for when it is among the editions, and otherwise the edition the read prioritised first. */
function servedTagOf(locales: readonly LocaleEdition[], requestedTag: string): string {
  const wanted = normaliseTag(requestedTag);
  if (wanted !== "") {
    const exact = locales.find((locale) => normaliseTag(locale.tag) === wanted);
    if (exact !== undefined) return exact.tag;
  }
  return locales[0]?.tag ?? "";
}
/** The address this surface asks for: the language asked for, the page size the route read with, and the page itself when it is not the first. */
function searchFor(request: ReceivingListRequest, next: { readonly locale?: string; readonly page?: number }): string {
  const search = new URLSearchParams();
  const locale = (next.locale ?? request.locale ?? "").trim();
  if (locale !== "") search.set(LOCALE_PARAM, locale);
  if (request.pageSize !== undefined) search.set(PAGE_SIZE_PARAM, String(request.pageSize));
  const page = next.page ?? request.page ?? FIRST_PAGE;
  if (page > FIRST_PAGE) search.set(PAGE_PARAM, String(page));
  const encoded = search.toString();
  return encoded === "" ? "" : `?${encoded}`;
}

// The small surfaces a row and the list footer are made of
/** The heading this surface continues the page with: the level belongs to the route, which owns the document's one `h1`. */
function Heading({ id, level, children }: { readonly id: string; readonly level: NoticeHeadingLevel; readonly children: ReactNode }): ReactElement {
  const Tag = HEADING_TAG[level];
  return (
    <Tag id={id} className="font-heading text-lg font-medium text-pretty wrap-anywhere">
      {children}
    </Tag>
  );
}
interface PageWindowLineProps {
  readonly page: ReceivingPageWindow;
  readonly state: ValueState | undefined;
  /** The interface locale the window's figures are formatted in, stated by the route that composes the surface. */
  readonly locale: string;
}
/** The whole-result count, stated from the read's own window; a count the envelope did not state is reported as the value state it carries rather than formatted as a number. */
function PageWindowLine({ page, state, locale }: PageWindowLineProps): ReactElement {
  if (state !== undefined && state !== "value") {
    const word = VALUE_STATE_WORDS[state];
    return (
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <StatusBadge label={word.label} tone={word.tone} srPrefix="Edition count" />
        <span className="text-muted-foreground text-pretty wrap-anywhere">{COUNT_NOT_STATED}</span>
      </p>
    );
  }
  const total = page.total;
  if (total === 0) {
    return <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{`No ${ITEM_NOUN_SINGULAR}`}</p>;
  }
  const countFormat = countFormatOf(locale);
  const first = (page.page - FIRST_PAGE) * page.pageSize + 1;
  const last = Math.min(page.page * page.pageSize, total);
  return <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{`Showing ${countFormat.format(first)}\u2013${countFormat.format(last)} of ${countFormat.format(total)} ${total === 1 ? ITEM_NOUN_SINGULAR : ITEM_NOUN_PLURAL}`}</p>;
}
interface EditionRowProps {
  readonly edition: ReceivingEditionView;
  /** The language the reader asked for, stated so a row served in another language says so instead of leaving the substitution silent. */
  readonly requestedTag: string;
}
/**
 * One edition: the title as its own link to the exact post, the audience word, the language it is
 * read in, and — when the reader asked for a language this edition is not in — the sentence naming
 * both languages. Nothing here decides what the reader may read; the row exists because the read
 * returned it.
 */
function EditionRow({ edition, requestedTag }: EditionRowProps): ReactElement {
  const audience = AUDIENCE_WORDS[edition.audience];
  const servedName = languageNameOf(edition.locale.tag);
  const servedLabel = servedName === "" ? edition.locale.tag : servedName;
  const description = edition.description?.trim() ?? "";
  const fallbackDisclosed = requestedTag !== "" && normaliseTag(requestedTag) !== normaliseTag(edition.locale.tag);
  return (
    <li data-slot={EDITION_SLOT} data-document-id={edition.documentId} data-variant-id={edition.variantId} data-release-id={edition.releaseId} data-audience={edition.audience} data-locale={edition.locale.tag} className="min-w-0">
      <Card size="sm" className="min-w-0">
        <CardHeader className="min-w-0">
          <CardTitle className="min-w-0 text-start text-pretty wrap-anywhere">
            <Link href={edition.href} className={EDITION_LINK_CLASS}>
              <bdi>{titleOf(edition)}</bdi>
            </Link>
          </CardTitle>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <StatusBadge label={audience.label} tone={audience.tone} srPrefix="Audience" />
            <StatusBadge label={servedLabel} tone="muted" srPrefix="Language" />
          </div>
          {description === "" ? null : (
            // The description is the edition's own prose: its direction and language come from the edition, never from the interface around it.
            <CardDescription className="min-w-0 text-start text-pretty wrap-anywhere" dir={edition.locale.direction} lang={edition.locale.tag}>
              <bdi>{description}</bdi>
            </CardDescription>
          )}
        </CardHeader>
        {fallbackDisclosed ? (
          <CardContent>
            <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">{RECEIVING_POST_COPY.languageFallbackStatement(languageNameOf(requestedTag), servedLabel)}</p>
          </CardContent>
        ) : null}
      </Card>
    </li>
  );
}
/**
 * The reading list a person is shown: the released Updates they may open now, in the language they
 * may be served in, with the persona being previewed stated in text and the simulation labelled.
 *
 * The server's answer is the whole of the data here. Switching audience or language re-renders the
 * route so the server authorises the read again; nothing below narrows, re-counts or re-orders what
 * the read supplied.
 */
export function ReceivingList({ scope, locale, initialEnvelope, persona, params, activeAudience, onSelectAudience, onDirectionChange, headingLevel = 2, className }: ReceivingListProps): ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const headingId = useId();
  const { result, refresh } = useReceivingList({ scope, params, initialEnvelope });
  const request = params ?? NO_REQUEST;
  const envelope = result.kind === "envelope" ? result.envelope : undefined;
  const editions = envelope === undefined ? NO_EDITIONS : envelope.data.editions;
  const requestedTag = (request.locale ?? envelope?.data.languagePreference ?? "").trim();
  const localeEditions = localeEditionsOf(editions);
  const audienceTabs = audienceTabsOf(editions);
  const activeVariantId = activeTabId(audienceTabs, activeAudience);
  const servedTag = servedTagOf(localeEditions, requestedTag);
  const noticeLevel = NESTED_HEADING[headingLevel];
  const personaLabel = personaLabelOf(persona);
  // The address is the query: the language asked for and the page wanted travel in it, so the next
  // render is read and authorised on the server rather than answered from a list held here.
  const addressFor = (next: { readonly locale?: string; readonly page?: number }): string => {
    const search = searchFor(request, next);
    return search === "" ? pathname : `${pathname}${search}`;
  };
  const requestRoute = (next: { readonly locale?: string; readonly page?: number }): void => {
    router.replace(addressFor(next), { scroll: false });
  };
  const requestLocale = (tag: string): void => {
    if (normaliseTag(tag) === normaliseTag(requestedTag)) return;
    requestRoute({ locale: tag, page: FIRST_PAGE });
  };
  const requestAudience = (variantId: string): void => {
    const tab = audienceTabs.find((candidate) => candidate.variantId === variantId);
    if (tab === undefined) return;
    if (onSelectAudience !== undefined) {
      onSelectAudience(tab.audience);
      return;
    }
    // No persona switch was supplied, so the request still goes to the server: asking again is the
    // only honest recovery this surface owns, and the answer states what that reader may open.
    refresh();
  };
  const page = envelope?.data.page;
  const countState = envelope?.valueStates["page.total"];
  const renderEditions = (): ReactNode => {
    if (editions.length === 0) {
      // An empty list and a missing language are two different answers. A reader who asked for a
      // language and was served nothing at all is told the language is unavailable; a reader who
      // asked for none is told the list is empty. Neither says what was withheld.
      if (requestedTag !== "") {
        const requestedName = languageNameOf(requestedTag);
        return <StateNotice kind="language-unavailable" headingLevel={noticeLevel} title={requestedName === "" ? RECEIVING_POST_COPY.languageUnavailable.title : `${RECEIVING_POST_COPY.languageUnavailable.title}: ${requestedName}`} description={RECEIVING_POST_COPY.languageUnavailable.description} />;
      }
      return <StateNotice kind="empty" headingLevel={noticeLevel} title={RECEIVING_LIST_COPY.emptyTitle} description={RECEIVING_LIST_COPY.emptyDescription} />;
    }
    return (
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex min-w-0 flex-col gap-4">
          <VariantSwitcher family={UPDATE_FAMILY} variants={audienceTabs} activeVariantId={activeVariantId} onSelect={requestAudience} label={AUDIENCE_SWITCHER_LABEL} />
          <LocaleSwitcher locales={localeEditions} requested={requestedTag} served={servedTag} onRequest={requestLocale} onDirectionChange={onDirectionChange} label={LOCALE_SWITCHER_LABEL} />
        </div>
        <ul className="flex min-w-0 flex-col gap-3">
          {editions.map((edition) => (
            <EditionRow key={`${edition.releaseId}:${edition.variantId}`} edition={edition} requestedTag={requestedTag} />
          ))}
        </ul>
        <div className="flex min-w-0 flex-col gap-2">
          {page === undefined ? null : <PageWindowLine page={page} state={countState} locale={locale} />}
          {/* The window is the read's own, so paging is two links that ask the route for another page
              rather than a control that slices rows here. This file's dependency set excludes the
              shared paging bar on purpose — a reading list carries no page-size choice — so the two
              addresses are built from the same parameters the read was given. */}
          {page !== undefined && page.pageCount > 1 ? (
            <nav aria-label={PAGES_LABEL} className="flex min-w-0 flex-wrap items-center gap-2">
              {page.page > FIRST_PAGE ? (
                <Link href={addressFor({ page: page.page - 1 })} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-6 whitespace-normal")}>
                  {PREVIOUS_PAGE_LABEL}
                </Link>
              ) : null}
              {page.page < page.pageCount ? (
                <Link href={addressFor({ page: page.page + 1 })} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-6 whitespace-normal")}>
                  {NEXT_PAGE_LABEL}
                </Link>
              ) : null}
            </nav>
          ) : null}
        </div>
      </div>
    );
  };
  return (
    <section aria-labelledby={headingId} data-slot={SURFACE_SLOT} data-persona={persona.id} data-read-state={result.kind} className={cn("flex min-w-0 flex-col gap-4", className)}>
      <header className="flex min-w-0 flex-col gap-3">
        <Heading id={headingId} level={headingLevel}>
          {RECEIVING_LIST_COPY.heading}
        </Heading>
        <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{RECEIVING_LIST_COPY.description}</p>
        {/* `role={undefined}`: this states who is being previewed and how access is checked, which is a
            fact about the surface rather than an event, so it is read in place instead of being
            announced as an alert on every render. */}
        <Alert variant="default" role={undefined}>
          <EyeIcon aria-hidden="true" focusable="false" />
          <AlertTitle className="text-pretty wrap-anywhere">{`${PREVIEWING_AS} ${personaLabel}`}</AlertTitle>
          <AlertDescription className="text-pretty wrap-anywhere">{RECEIVING_LIST_COPY.recheckStatement}</AlertDescription>
        </Alert>
        <SimulationLabel effect={RECEIVING_SIMULATION_EFFECT} />
      </header>
      {result.kind === "denied" ? (
        // A denial answers the same way whether or not anything exists here: no title, no count, no
        // size. The reason code names the rule that refused, never a record.
        <StateNotice kind="denied" headingLevel={noticeLevel} title={DENIED_TITLE} description={RECEIVING_POST_COPY.denialNotices["not-authorised"]} reasonCode={result.denied.reasonCode} />
      ) : null}
      {result.kind === "unavailable" ? <StateNotice kind="unavailable" headingLevel={noticeLevel} title={UNAVAILABLE_TITLE} description={result.unavailable.guidance} source={result.unavailable.source} retry={{ label: RETRY_LABEL, onClick: refresh }} /> : null}
      {result.kind === "refused" ? <StateNotice kind="refused" headingLevel={noticeLevel} title={REFUSED_TITLE} description={REFUSED_DESCRIPTION} /> : null}
      {envelope === undefined ? null : renderEditions()}
    </section>
  );
}
export default ReceivingList;
