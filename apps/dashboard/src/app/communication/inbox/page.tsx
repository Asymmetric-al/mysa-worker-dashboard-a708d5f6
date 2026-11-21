/** `/communication/inbox` — the synthetic inbox: every message this reader's notification purpose has produced, at the copy the recipient was pinned to, as HTML and as plain text. **One read, one branch, one composition.** */
import type { ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import { InboxList } from "@/features/audience/components/inbox-list";
import { reads } from "@/modules/data-service";
// This route's own words
/** The one heading this route owns: the page is named here, and the composed surface opens its own section at level two beneath it, so the outline of every state starts at level one. The surface's own heading constant is not reused for it, because that constant titles the section the surface renders. */
const PAGE_HEADING = "Synthetic inbox";
const PAGE_HEADING_ID = "communication-inbox-heading";
const HEADING_CLASS = "text-2xl font-semibold text-pretty wrap-anywhere";
const PAGE_CLASS = "flex min-w-0 flex-col gap-6 text-start";
/** The level the notice occupies beneath this route's heading; the notice's own title becomes that level rather than a second page heading. */
const NOTICE_HEADING_LEVEL = 2;
const DENIED_TITLE = "This inbox is not available in this session";
const UNAVAILABLE_TITLE = "The inbox could not be read";
const REFUSED_TITLE = "The inbox request was refused";
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
/** The synthetic inbox of the receiving persona. */
export default async function CommunicationInboxPage(): Promise<ReactElement> {
  // The surface owns its page window in client state and accepts a server answer only for the window it is
  // itself asking for, whose opening value is the read's own default (the first page, 50 rows). This route
  // reads that window: forwarding a page a URL stated would paint one page on the server and replace it with
  // another in the browser, and no surface links here with one.
  const result = await reads.audience.readInbox();
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
          <InboxList scope={result.envelope.scope} initialEnvelope={result} />
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
