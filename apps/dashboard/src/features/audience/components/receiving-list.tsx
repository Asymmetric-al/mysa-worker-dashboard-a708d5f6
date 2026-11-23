"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { EyeIcon } from "lucide-react";
import { useId, type ReactElement, type ReactNode } from "react";
import LocaleSwitcher, { type LocaleEdition } from "@/components/locale-switcher";
import SimulationLabel from "@/components/simulation-label";
import StateNotice, { type NoticeHeadingLevel } from "@/components/state-notice";
import StatusBadge, { VALUE_STATE_WORDS } from "@/components/status-badge";
import { AUDIENCE_WORDS } from "@/components/variant-switcher";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { countFormatOf } from "@/lib/count-format";
import { languageNameOf } from "@/lib/language-name";
import type { ContentLocale } from "@/modules/content/locale";
import type { Scope, ValueState } from "@/modules/data-service/envelope";
import type { ReadResult } from "@/modules/data-service/outcome";
import { RECEIVING_LIST_COPY, RECEIVING_POST_COPY, RECEIVING_SIMULATION_EFFECT } from "../copy/receiving";
import { useReceivingList, type ReceivingListEnvelope, type UseReceivingListParams } from "../hooks/use-audience-reads";
/** One edition of one Update as the receiving read states it: its identity, its audience, the locale it is read in and the address it opens at. */ export type ReceivingEditionView = ReceivingListEnvelope["data"]["editions"][number];
type ReceivingPageWindow = ReceivingListEnvelope["data"]["page"];
type ReceivingListRequest = NonNullable<UseReceivingListParams["params"]>;
type ContentDirection = ContentLocale["direction"];
/** The persona whose reading experience this preview shows, as the development runtime named it. It is an identifier and a word, never an inferred audience. */ export type ReceivingPersonaView = { readonly id: string; readonly label: string };
/** Props of {@link ReceivingList}. */ export interface ReceivingListProps {
  readonly scope: Scope;
  /** The interface locale this surface formats its counts in, stated by the route that composes it. */
  readonly locale: string;
  readonly initialEnvelope: ReadResult<ReceivingListEnvelope>;
  readonly persona: ReceivingPersonaView;
  readonly params?: ReceivingListRequest;
  readonly onDirectionChange?: (direction: ContentDirection) => void;
  readonly headingLevel?: NoticeHeadingLevel;
  readonly className?: string;
}
const ITEM_NOUN_SINGULAR = "edition";
const FIRST_PAGE = 1;
const PREVIEWING_AS = "Previewing as";
const UNTITLED_EDITION = "Untitled Update";
const REFUSED_DESCRIPTION = "The address asked for something this view does not read, so nothing was read and no list stands in its place. Correct the request and open it again: once it is one this view admits, the read runs unchanged.";
const NO_EDITIONS: readonly ReceivingEditionView[] = [];
const NO_REQUEST: ReceivingListRequest = Object.freeze({});
const HEADING_TAG: Readonly<Record<NoticeHeadingLevel, "h1" | "h2" | "h3" | "h4">> = { 1: "h1", 2: "h2", 3: "h3", 4: "h4" };
/** The one type scale's heading utility for each level, so this surface's heading takes the measure of the level the composing page gives it rather than one fixed size. */
const HEADING_SCALE: Readonly<Record<NoticeHeadingLevel, string>> = { 1: "type-page-title", 2: "type-section-title", 3: "type-subsection-title", 4: "type-group-title" };
const NESTED_HEADING: Readonly<Record<NoticeHeadingLevel, NoticeHeadingLevel>> = { 1: 2, 2: 3, 3: 4, 4: 4 };
const normaliseTag = (tag: string): string => tag.trim().toLowerCase();
function titleOf(edition: ReceivingEditionView): string {
  const title = edition.title?.trim() ?? "";
  return title === "" ? UNTITLED_EDITION : title;
}
function localeEditionsOf(editions: readonly ReceivingEditionView[]): readonly LocaleEdition[] {
  const locales = new Map<string, LocaleEdition>();
  for (const edition of editions) {
    const key = normaliseTag(edition.locale.tag);
    if (key !== "" && !locales.has(key)) locales.set(key, { tag: edition.locale.tag, direction: edition.locale.direction, releaseId: edition.releaseId });
  }
  return [...locales.values()];
}
const servedTagOf = (locales: readonly LocaleEdition[], requestedTag: string): string => {
  const wanted = normaliseTag(requestedTag);
  return (wanted === "" ? undefined : locales.find((locale) => normaliseTag(locale.tag) === wanted)?.tag) ?? locales[0]?.tag ?? "";
};
function searchFor(request: ReceivingListRequest, next: { readonly locale?: string; readonly page?: number }): string {
  const search = new URLSearchParams();
  const locale = (next.locale ?? request.locale ?? "").trim();
  if (locale !== "") search.set("locale", locale);
  if (request.pageSize !== undefined) search.set("pageSize", String(request.pageSize));
  const page = next.page ?? request.page ?? FIRST_PAGE;
  if (page > FIRST_PAGE) search.set("page", String(page));
  const encoded = search.toString();
  return encoded === "" ? "" : `?${encoded}`;
}
function Heading({ id, level, children }: { readonly id: string; readonly level: NoticeHeadingLevel; readonly children: ReactNode }): ReactElement {
  const Tag = HEADING_TAG[level];
  return (
    <Tag id={id} className={cn(HEADING_SCALE[level], "text-pretty wrap-anywhere")}>
      {children}
    </Tag>
  );
}
type PageWindowLineProps = { readonly page: ReceivingPageWindow; readonly state: ValueState | undefined; readonly locale: string };
function PageWindowLine({ page, state, locale }: PageWindowLineProps): ReactElement {
  if (state !== undefined && state !== "value") {
    const word = VALUE_STATE_WORDS[state];
    return (
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 type-supporting">
        <StatusBadge label={word.label} tone={word.tone} srPrefix="Edition count" />
        <span className="text-muted-foreground text-pretty wrap-anywhere">The read did not state how many editions this list holds, so no count is shown here and none is derived from the editions on screen.</span>
      </p>
    );
  }
  const total = page.total;
  if (total === 0) return <p className="type-supporting text-pretty wrap-anywhere">{`No ${ITEM_NOUN_SINGULAR}`}</p>;
  const format = countFormatOf(locale);
  const last = Math.min(page.page * page.pageSize, total);
  return <p className="type-supporting text-pretty wrap-anywhere">{`Showing ${format.format((page.page - FIRST_PAGE) * page.pageSize + 1)}\u2013${format.format(last)} of ${format.format(total)} ${total === 1 ? ITEM_NOUN_SINGULAR : "editions"}`}</p>;
}
type EditionRowProps = { readonly edition: ReceivingEditionView; readonly requestedTag: string };
function EditionRow({ edition, requestedTag }: EditionRowProps): ReactElement {
  const audience = AUDIENCE_WORDS[edition.audience];
  const servedName = languageNameOf(edition.locale.tag);
  const servedLabel = servedName === "" ? edition.locale.tag : servedName;
  const description = edition.description?.trim() ?? "";
  return (
    <li data-slot="receiving-edition" data-document-id={edition.documentId} data-variant-id={edition.variantId} data-release-id={edition.releaseId} data-audience={edition.audience} data-locale={edition.locale.tag} className="min-w-0">
      <Card size="sm" className="min-w-0">
        <CardHeader className="min-w-0">
          <CardTitle className="min-w-0 text-start text-pretty wrap-anywhere">
            <Link href={edition.href} className="inline-link inline-flex min-h-6 max-w-full items-center break-words text-start hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <bdi>{titleOf(edition)}</bdi>
            </Link>
          </CardTitle>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <StatusBadge label={audience.label} tone={audience.tone} srPrefix="Audience" />
            <StatusBadge label={servedLabel} tone="muted" srPrefix="Language" />
          </div>
          {description === "" ? null : (
            <CardDescription className="min-w-0 text-start text-pretty wrap-anywhere" dir={edition.locale.direction} lang={edition.locale.tag}>
              <bdi>{description}</bdi>
            </CardDescription>
          )}
        </CardHeader>
        {requestedTag !== "" && normaliseTag(requestedTag) !== normaliseTag(edition.locale.tag) ? (
          <CardContent>
            <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">{RECEIVING_POST_COPY.languageFallbackStatement(languageNameOf(requestedTag), servedLabel)}</p>
          </CardContent>
        ) : null}
      </Card>
    </li>
  );
}
/** The reading list a person is shown: */ export function ReceivingList({ scope, locale, initialEnvelope, persona, params, onDirectionChange, headingLevel = 2, className }: ReceivingListProps): ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const headingId = useId();
  const { result, refresh } = useReceivingList({ scope, params, initialEnvelope });
  const request = params ?? NO_REQUEST;
  const envelope = result.kind === "envelope" ? result.envelope : undefined;
  const editions = envelope === undefined ? NO_EDITIONS : envelope.data.editions;
  const requestedTag = (request.locale ?? envelope?.data.languagePreference ?? "").trim();
  const localeEditions = localeEditionsOf(editions);
  const noticeLevel = NESTED_HEADING[headingLevel];
  const personaLabel = persona.label.trim() === "" ? persona.id : persona.label.trim();
  const addressFor = (next: { readonly locale?: string; readonly page?: number }): string => {
    const search = searchFor(request, next);
    return search === "" ? pathname : `${pathname}${search}`;
  };
  const requestRoute = (next: { readonly locale?: string; readonly page?: number }): void => void router.replace(addressFor(next), { scroll: false });
  const requestLocale = (tag: string): void => {
    if (normaliseTag(tag) === normaliseTag(requestedTag)) return;
    requestRoute({ locale: tag, page: FIRST_PAGE });
  };
  const page = envelope?.data.page;
  const renderEditions = (): ReactNode => {
    if (editions.length === 0) {
      if (requestedTag !== "") {
        const requestedName = languageNameOf(requestedTag);
        return <StateNotice kind="language-unavailable" headingLevel={noticeLevel} title={requestedName === "" ? RECEIVING_POST_COPY.languageUnavailable.title : `${RECEIVING_POST_COPY.languageUnavailable.title}: ${requestedName}`} description={RECEIVING_POST_COPY.languageUnavailable.description} />;
      }
      return <StateNotice kind="empty" headingLevel={noticeLevel} title={RECEIVING_LIST_COPY.emptyTitle} description={RECEIVING_LIST_COPY.emptyDescription} />;
    }
    return (
      <div className="flex min-w-0 flex-col gap-4">
        <LocaleSwitcher locales={localeEditions} requested={requestedTag} served={servedTagOf(localeEditions, requestedTag)} onRequest={requestLocale} onDirectionChange={onDirectionChange} label="Reading language" />
        <ul className="flex min-w-0 flex-col gap-3">
          {editions.map((edition) => (
            <EditionRow key={`${edition.releaseId}:${edition.variantId}`} edition={edition} requestedTag={requestedTag} />
          ))}
        </ul>
        <div className="flex min-w-0 flex-col gap-2">
          {page === undefined ? null : <PageWindowLine page={page} state={envelope?.valueStates["page.total"]} locale={locale} />}
          {page !== undefined && page.pageCount > 1 ? (
            <nav aria-label="Pages of this reading list" className="flex min-w-0 flex-wrap items-center gap-2">
              {[...(page.page > FIRST_PAGE ? [{ label: "Previous page", page: page.page - 1 }] : []), ...(page.page < page.pageCount ? [{ label: "Next page", page: page.page + 1 }] : [])].map((link) => (
                <Link key={link.label} href={addressFor({ page: link.page })} data-slot="button" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-6 whitespace-normal")}>
                  {link.label}
                </Link>
              ))}
            </nav>
          ) : null}
        </div>
      </div>
    );
  };
  return (
    <section aria-labelledby={headingId} data-slot="receiving-list" data-persona={persona.id} data-read-state={result.kind} className={cn("flex min-w-0 flex-col gap-4", className)}>
      <header className="flex min-w-0 flex-col gap-3">
        <Heading id={headingId} level={headingLevel}>
          {RECEIVING_LIST_COPY.heading}
        </Heading>
        <p className="type-supporting text-pretty wrap-anywhere">{RECEIVING_LIST_COPY.description}</p>
        <Alert variant="default" role={undefined}>
          <EyeIcon aria-hidden="true" focusable="false" />
          <AlertTitle className="text-pretty wrap-anywhere">{`${PREVIEWING_AS} ${personaLabel}`}</AlertTitle>
          <AlertDescription className="text-pretty wrap-anywhere">{RECEIVING_LIST_COPY.recheckStatement}</AlertDescription>
        </Alert>
        <SimulationLabel effect={RECEIVING_SIMULATION_EFFECT} />
      </header>
      {result.kind === "denied" ? <StateNotice kind="denied" headingLevel={noticeLevel} title="This reading list cannot be read with this access" description={RECEIVING_POST_COPY.denialNotices["not-authorised"]} reasonCode={result.denied.reasonCode} /> : null}
      {result.kind === "unavailable" ? <StateNotice kind="unavailable" headingLevel={noticeLevel} title="The reading list could not be read" description={result.unavailable.guidance} source={result.unavailable.source} retry={{ label: "Try again", onClick: refresh }} /> : null}
      {result.kind === "refused" ? <StateNotice kind="refused" headingLevel={noticeLevel} title="This request is not a reading list this view serves" description={REFUSED_DESCRIPTION} /> : null}
      {envelope === undefined ? null : renderEditions()}
    </section>
  );
}
export default ReceivingList;
