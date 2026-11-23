/** The one page frame every route under `src/app` composes: the heading block a surface opens with, the notice ladder a read that produced no envelope is stated with in the page's own words, and the four readings every page makes of the address it was opened with. */
import type { ReactElement, ReactNode } from "react";
import StateNotice, { type NoticeAction, type NoticeHeadingLevel } from "@/components/state-notice";
import type { DenialReason, ReadResult } from "@/modules/data-service/outcome";
import type { SourceReference } from "@/lib/ids";
/** A read that produced no envelope: a denial, an outage behind the records, or a request the route itself refused. Structurally the three arms of every service read. */
export type ReadRefusal = { readonly kind: "denied"; readonly denied: { readonly reasonCode: DenialReason } } | { readonly kind: "unavailable"; readonly unavailable: { readonly guidance: string; readonly source: SourceReference } } | { readonly kind: "refused"; readonly refused: unknown };
/** What one page states for each refusal arm — its own title, the sentence it adds, the recovery it offers where one exists — and the heading level its notice nests at. */
export type ReadNoticeCopy = {
  readonly headingLevel: NoticeHeadingLevel;
  readonly denied: { readonly title: string; readonly body?: string; readonly action?: NoticeAction };
  readonly unavailable: { readonly title: string; readonly body?: string; readonly action?: NoticeAction };
  readonly refused: { readonly title: string; readonly body?: string; readonly action?: NoticeAction };
};
/** The notice a read that never became an envelope is stated with: the closed reason code of a denial, the source and guidance of an outage, or the request the route refused — never an empty result, a zero or a hidden count. */
export function ReadNotices({ failure, copy, className }: { readonly failure: ReadRefusal; readonly copy: ReadNoticeCopy; readonly className?: string }): ReactElement {
  // An outage's own guidance is the sentence unless the page states one, so no page repeats the service's wording to add nothing to it.
  if (failure.kind === "unavailable") return <StateNotice kind="unavailable" headingLevel={copy.headingLevel} title={copy.unavailable.title} description={copy.unavailable.body ?? failure.unavailable.guidance} source={failure.unavailable.source} action={copy.unavailable.action} className={className} />;
  if (failure.kind === "denied") return <StateNotice kind="denied" headingLevel={copy.headingLevel} title={copy.denied.title} description={copy.denied.body} reasonCode={failure.denied.reasonCode} action={copy.denied.action} className={className} />;
  return <StateNotice kind="refused" headingLevel={copy.headingLevel} title={copy.refused.title} description={copy.refused.body} action={copy.refused.action} className={className} />;
}
/** The page column every route renders its content in: one min-width-zero flex column, the gaps the pages have always used, and text that starts on the leading edge of whichever direction the content is read in. */
export const PageColumn = ({ children, gap = 6 }: { readonly children: ReactNode; readonly gap?: 4 | 6 }): ReactElement => <div className={gap === 4 ? "flex min-w-0 flex-col gap-4 text-start" : "flex min-w-0 flex-col gap-6 text-start"}>{children}</div>;
export type PageHeadingContent = { readonly title: string; readonly paragraphs?: readonly string[] };
/** The heading block a page opens with: the one `h1` of the route and the sentences that state what the surface holds. */
export const PageHeading = ({ title, paragraphs }: PageHeadingContent): ReactElement => (
  <div className="flex min-w-0 flex-col gap-2">
    <h1 className="type-page-title text-pretty wrap-anywhere">{title}</h1>
    {(paragraphs ?? []).map((paragraph) => (
      <p key={paragraph} className="type-supporting max-w-prose text-pretty">
        {paragraph}
      </p>
    ))}
  </div>
);
/** The frame a route surface opens with: the section that names itself by the route's one `h1`, that heading, and the column the surface lays out in. A surface whose reading direction is the content's own states it here, so the whole frame — not only its text — reads in that direction. */
export const PageSurface = ({ headingId, title, dir, children }: { readonly headingId: string; readonly title: string; readonly dir?: string; readonly children: ReactNode }): ReactElement => (
  <section aria-labelledby={headingId} {...(dir === undefined ? {} : { dir })} className="flex min-w-0 flex-col gap-6 text-start">
    <h1 id={headingId} className="type-page-title text-pretty wrap-anywhere">
      {title}
    </h1>
    {children}
  </section>
);
/** The frame a page states around its own surface: its words for the three refusal arms, the heading block it opens with, and the column gaps its content and its refusal lay out at. */
export type PageFrame = { readonly notice: ReadNoticeCopy; readonly heading?: PageHeadingContent; readonly gap?: 4 | 6; readonly refusalGap?: 4 | 6 };
/** The level a refusal nests at inside a page that states its own title: the heading the page keeps, with the refusal stated beneath it. */
const NESTED_NOTICE_LEVEL: NoticeHeadingLevel = 2;
/** A read that produced no envelope, stated inside the page column the route would have rendered its content in, so a refusal is never an empty surface. A route that states its own page title keeps it on a refusal too, with the notice beneath it; a route whose title is the record it could not read states the notice's own title as the page heading, at the page-title scale. */
export const pageRefusalOf = (failure: ReadRefusal, copy: ReadNoticeCopy, gap: 4 | 6 = 6, heading?: PageHeadingContent): ReactElement => (
  <PageColumn gap={gap}>
    {heading === undefined ? null : <PageHeading title={heading.title} paragraphs={heading.paragraphs} />}
    <ReadNotices failure={failure} copy={heading === undefined ? copy : { ...copy, headingLevel: NESTED_NOTICE_LEVEL }} />
  </PageColumn>
);
/** An envelope a read answered with, exactly as the page's own success branch receives it. */
export type AnsweredEnvelope<Envelope> = Extract<ReadResult<Envelope>, { readonly kind: "envelope" }>;
/** The one page frame: one service read, the heading block, and the page's own surface rendered from the envelope that read answered with — or, where it answered with none, the page's own words for that refusal. */
export async function readPageOf<Envelope>(read: () => Promise<ReadResult<Envelope>>, frame: PageFrame, surface: (answered: AnsweredEnvelope<Envelope>) => ReactNode): Promise<ReactElement> {
  const result = await read();
  if (result.kind !== "envelope") return pageRefusalOf(result, frame.notice, frame.refusalGap ?? frame.gap, frame.heading);
  return (
    <PageColumn gap={frame.gap}>
      {frame.heading === undefined ? null : <PageHeading title={frame.heading.title} paragraphs={frame.heading.paragraphs} />}
      {surface(result)}
    </PageColumn>
  );
}
/** The URL's own parameter record, as Next 16 hands a page or a handler its search parameters. */
export type SearchParams = Readonly<Record<string, string | string[] | undefined>>;
/** One parameter's first value as the address states it, unread: a repeated parameter is read once, and no list is treated as a decision the caller made. */
export const firstValueOf = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);
/** One parameter's first value with the blank reading an absent parameter has, so a value the surface reads as no choice stays the service's own default. */
export function paramOf(searchParams: SearchParams, name: string): string | undefined {
  const stated = firstValueOf(searchParams[name])?.trim() ?? "";
  return stated === "" ? undefined : stated;
}
/** A stated whole number of at most nine digits, or `undefined` where the caller stated none or stated something this route cannot read as a count. */
export function wholeNumberOf(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d{1,9}$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}
/** The query string that restores the selection a page was opened with, so a way back returns to the page and the facets the caller left, and `""` where the address stated none. */
export function searchSuffixOf(query: SearchParams): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) for (const stated of value === undefined ? [] : typeof value === "string" ? [value] : value) params.append(name, stated);
  const search = params.toString();
  return search === "" ? "" : `?${search}`;
}
/** One envelope in the wire's own encoding: what a client surface takes as its initial answer, so the browser neither re-requests records this render already holds nor waits for them. */
export function wireFormOf<Value>(value: Value): Value {
  const wire: unknown = JSON.parse(JSON.stringify(value));
  return wire as Value;
}
