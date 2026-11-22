/** `/communication/inbox` — the synthetic inbox: every message this reader's notification purpose has produced, at the copy the recipient was pinned to, as HTML and as plain text. **One read, one branch, one composition.** */
import type { ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import { InboxList } from "@/features/audience/components/inbox-list";
import { reads } from "@/modules/data-service";
// Shapes, taken from the service rather than restated
/** The one read this route holds, named once so its query and its answer are taken from the read itself. */
type InboxRead = typeof reads.audience.readInbox;
/** The query that read declares, read from the read itself so this route cannot drift from it. */
type InboxQueryInput = NonNullable<Parameters<InboxRead>[0]>;
/** The URL's own parameter record, as Next 16 hands a route its search parameters. */
type SearchParams = Record<string, string | string[] | undefined>;
// This route's own words
/** The one heading this route owns: the page is named here, and the composed surface opens its own section at level two beneath it, so the outline of every state starts at level one. The surface's own heading constant is not reused for it, because that constant titles the section the surface renders. */
const PAGE_HEADING = "Synthetic inbox";
const PAGE_HEADING_ID = "communication-inbox-heading";
const HEADING_CLASS = "text-2xl font-semibold text-pretty wrap-anywhere";
const PAGE_CLASS = "flex min-w-0 flex-col gap-6 text-start";
/** The interface locale the composed surface formats its counts in. */
const INTERFACE_LOCALE = "en-GB";
/** The level the notice occupies beneath this route's heading; the notice's own title becomes that level rather than a second page heading. */
const NOTICE_HEADING_LEVEL = 2;
const DENIED_TITLE = "This inbox is not available in this session";
const UNAVAILABLE_TITLE = "The inbox could not be read";
const REFUSED_TITLE = "The inbox request was refused";

/** The two parameters this route forwards: the paging window the read declares, and nothing besides them. */
const PARAM = { page: "page", pageSize: "pageSize" } as const;

// ---------------------------------------------------------------------------------------------
// The read's own query, built from the URL and from nothing else
// ---------------------------------------------------------------------------------------------

/** One search parameter's first value: a repeated parameter is read once, and never treated as a decision. */
function paramOf(searchParams: SearchParams, name: string): string | undefined {
  const value = searchParams[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The query the inbox read accepts, stated in the read's own vocabulary.
 *
 * Only the paging window is forwarded, as the numbers the read declares, because the surface keeps its window in
 * the address: the page the address states is the page the surface opens on, so the server paints that page and the
 * surface does not replace it with the read's default. Nothing is defaulted, clamped, validated or dropped here: the
 * service derives the window (a page below the first is the first page, and the page size is the documented 50 with
 * its 200 cap) and owns the whole-result counts, so a second opinion taken on this page could only disagree with the
 * figures rendered beside it.
 */
function inboxQueryOf(searchParams: SearchParams): InboxQueryInput {
  const page = paramOf(searchParams, PARAM.page);
  const pageSize = paramOf(searchParams, PARAM.pageSize);
  return { ...(page === undefined ? {} : { page: Number(page) }), ...(pageSize === undefined ? {} : { pageSize: Number(pageSize) }) };
}

/** This route's heading, rendered once per response in every state so the page is named even when nothing could be read. */
function PageHeading(): ReactElement {
  return (
    <h1 id={PAGE_HEADING_ID} className={HEADING_CLASS}>
      {PAGE_HEADING}
    </h1>
  );
}
/** Answers for a read member this route does not handle. Every member of the union is handled below, so this is unreachable by type; it is stated rather than swallowed so a member the read grows later fails here instead of rendering an empty page. */
function unhandledResult(result: never): never {
  throw new Error(`Unhandled inbox read result: ${JSON.stringify(result)}`);
}
export interface CommunicationInboxPageProps {
  /** The URL's own parameters, which Next 16 hands a route as a promise. */
  readonly searchParams: Promise<SearchParams>;
}

/** The synthetic inbox of the receiving persona. */
export default async function CommunicationInboxPage({ searchParams }: CommunicationInboxPageProps): Promise<ReactElement> {
  // The surface keeps its page window in the address and accepts a server answer only for the window it is itself
  // asking for, so this route reads the window the address states: the page painted here is the page the surface
  // opens on, and the first paint states the rows this read answered with instead of a default window that the
  // browser would then replace.
  const stated = await searchParams;
  const result = await reads.audience.readInbox(inboxQueryOf(stated));
  switch (result.kind) {
    case "envelope":
      return (
        <section aria-labelledby={PAGE_HEADING_ID} className={PAGE_CLASS}>
          <PageHeading />
          {/* `InboxList` is the one surface for the list, the send-outcome words, the empty state, the
              one-message-per-intent statement and the mail-submission label, and it composes `message-reader`
              itself for the message the reader opens. It is rendered once and no second reader stands beside
              it: a reader composed here as well would show that message twice and make the second message
              surface this application does not have. The whole answer is passed down, not a narrowed copy, so
              the surface reads scope, value states and the instant it was evaluated at from the read. */}
          <InboxList scope={result.envelope.scope} locale={INTERFACE_LOCALE} initialEnvelope={result} />
        </section>
      );
    case "denied":
      return (
        <section aria-labelledby={PAGE_HEADING_ID} className={PAGE_CLASS}>
          <PageHeading />
          {/* A refusal states no message, sender, subject, count or page size, and the list is not rendered
              beside it in a disabled form: the closed reason code is the whole answer, and it reads the same
              whether or not anything exists here. */}
          <StateNotice kind="denied" headingLevel={NOTICE_HEADING_LEVEL} title={DENIED_TITLE} reasonCode={result.denied.reasonCode} />
        </section>
      );
    case "unavailable":
      return (
        <section aria-labelledby={PAGE_HEADING_ID} className={PAGE_CLASS}>
          <PageHeading />
          {/* The source did not answer, so the inbox is reported as an outage with the source that failed and
              the service's own guidance: an empty list or a zero in its place would state that this reader was
              sent nothing, which the read never said. */}
          <StateNotice kind="unavailable" headingLevel={NOTICE_HEADING_LEVEL} title={UNAVAILABLE_TITLE} description={result.unavailable.guidance} source={result.unavailable.source} />
        </section>
      );
    case "refused":
      return (
        <section aria-labelledby={PAGE_HEADING_ID} className={PAGE_CLASS}>
          <PageHeading />
          {/* This route calls the read directly, so the request it made is its own and never one a handler
              refused: the arm is stated rather than thrown, and the notice's own sentence says the request was
              refused rather than the inbox source failing. */}
          <StateNotice kind="refused" headingLevel={NOTICE_HEADING_LEVEL} title={REFUSED_TITLE} />
        </section>
      );
  }
  return unhandledResult(result);
}
