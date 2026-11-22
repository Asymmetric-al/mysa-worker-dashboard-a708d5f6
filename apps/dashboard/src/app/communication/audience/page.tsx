/**
 * `/communication/audience` — the publisher's Update-email audience (AAP 0.9.1, "Membership states and
 * eligible/excluded counts"; AAP 0.10.1 unit 10, worker half; AAP 0.7.1's "Reach readers" row, `readAudience`).
 *
 * **What this file is.** Composition, nothing else: one service read, then the arm that read's own result union
 * names. Every count, every state, every exclusion reason and every eligibility decision is the envelope's, and
 * every word about them is the copy module's. Nothing here counts, filters, sorts, defaults, clamps or
 * authorises, and no scope, principal or permission is ever taken from the URL.
 *
 * **Why the not-consent statement is the family surface's in the envelope arm.** `MembershipTable` states
 * `NOT_CONSENT_STATEMENT` above its own counts, so this page states it only in the arms where that surface
 * renders a notice instead — printing it in both places would state the same load-bearing rule twice.
 *
 * **Why this route declares no rendering directive of its own.** The root layout already renders every route per
 * request, and this read resolves the development-session cookie inside `modules/data-service/authorize.ts`, so
 * the segment is request-time work without a second declaration.
 */
import type { ReactElement } from "react";

import { StateNotice } from "@/components/state-notice";
import MembershipTable from "@/features/audience/components/membership-table";
import { NOT_CONSENT_STATEMENT, PURPOSE_LABEL } from "@/features/audience/copy/membership";
import { reads } from "@/modules/data-service";

// ---------------------------------------------------------------------------------------------
// Shapes, taken from the service rather than restated
// ---------------------------------------------------------------------------------------------

/** The one read this route holds, named once so its query and its answer are taken from the read itself. */
type AudienceRead = typeof reads.audience.readAudience;

/** What that read answers: the envelope, or the denial, outage or refusal it states instead. */
type AudienceResult = Awaited<ReturnType<AudienceRead>>;

/** The query the read declares, read from the read itself so this route cannot drift from it. */
type AudienceQueryInput = NonNullable<Parameters<AudienceRead>[0]>;

/** The arms of that union that carry no envelope: the denial, the outage and the refused request. */
type AudienceWithoutEnvelope = Exclude<AudienceResult, { readonly kind: "envelope" }>;

/** The URL's own parameter record, as Next 16 hands a route its search parameters. */
type SearchParams = Record<string, string | string[] | undefined>;

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** This surface's own address, which a retry re-requests. */
const AUDIENCE_HREF = "/communication/audience";

/** The one heading on this page, named so the section states which heading labels it. */
const HEADING_ID = "communication-audience-heading";

/** The two parameters this route forwards: the paging window the read declares, and nothing besides them. */
const PARAM = { page: "page", pageSize: "pageSize" } as const;

/** The interface locale the composed surface formats its counts in. */
const INTERFACE_LOCALE = "en-GB";

/** This page's own wording: its heading and lede, and the notices a denial, an outage or a refusal is stated with. */
const PAGE_COPY = {
  heading: `${PURPOSE_LABEL["update-email"]} audience`,
  lede: "The people this publisher may reach with its Update email for this purpose, the state each membership stands in, and the reason each excluded membership is excluded. Every count, state and reason below is the read's own, and no membership on this page is contact permission, proof of an address, or a choice this view may change.",
  denied: {
    title: "This publisher's audience is not available in the current context",
    body: "This session may not read the memberships of the publisher this context belongs to, so no count, state, name or size is stated here — a refusal is not an empty audience. Another context, if this session holds one, can be chosen from the shell.",
  },
  unavailable: { title: "This publisher's audience could not be read", retry: "Try this read again" },
  refused: {
    title: "This page's request was not one the audience read admits",
    body: "The read that answers this page refused the request this route made, so nothing was read and nothing is shown in its place. The source did not fail and no permission was refused: this route states only the page and the page size the read declares.",
  },
  unrecognised: { title: "This publisher's audience could not be read", body: "The read answered with a result this page does not recognise, so it is reported as the outage it may be rather than as an audience with nobody in it." },
} as const;

// ---------------------------------------------------------------------------------------------
// The read's own query, built from the URL and from nothing else
// ---------------------------------------------------------------------------------------------

/** One search parameter's first value: a repeated parameter is read once, and never treated as a decision. */
function paramOf(searchParams: SearchParams, name: string): string | undefined {
  const value = searchParams[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The query the audience read accepts, stated in the read's own vocabulary.
 *
 * Only the paging window is forwarded, as the numbers the read declares. Nothing is defaulted, clamped,
 * validated or dropped here: the service derives the window (a page below the first is the first page, and the
 * page size is the documented 50 with its 200 cap) and owns the whole-result counts, so a second opinion taken
 * on this page could only disagree with the figures rendered beside it. The publisher is deliberately not
 * forwarded: the read derives the publisher of this session's Updates, and a URL that named one would be
 * choosing the scope the service exists to derive.
 */
function audienceQueryOf(searchParams: SearchParams): AudienceQueryInput {
  const page = paramOf(searchParams, PARAM.page);
  const pageSize = paramOf(searchParams, PARAM.pageSize);
  return { ...(page === undefined ? {} : { page: Number(page) }), ...(pageSize === undefined ? {} : { pageSize: Number(pageSize) }) };
}

// ---------------------------------------------------------------------------------------------
// The arm that carries no envelope
// ---------------------------------------------------------------------------------------------

/**
 * The notice a denial, an outage or a refused request is stated with: one heading below the page's own, and a
 * retry of this same read where retrying is the useful next step.
 *
 * A denial states no count, no name and no size — `StateNotice` renders the reason code and nothing about what
 * the scope may hold — so the answer is the same whether or not a membership exists. A refused request is not
 * an outage, so it is stated as the refusal it is rather than as a source that failed.
 */
function AudienceNotice({ result }: { readonly result: AudienceWithoutEnvelope }): ReactElement {
  switch (result.kind) {
    case "denied":
      return <StateNotice kind="denied" headingLevel={2} title={PAGE_COPY.denied.title} description={PAGE_COPY.denied.body} reasonCode={result.denied.reasonCode} />;
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={2} title={PAGE_COPY.unavailable.title} description={result.unavailable.guidance} source={result.unavailable.source} action={{ label: PAGE_COPY.unavailable.retry, href: AUDIENCE_HREF }} />;
    case "refused":
      return <StateNotice kind="refused" headingLevel={2} title={PAGE_COPY.refused.title} description={PAGE_COPY.refused.body} action={{ label: PAGE_COPY.unavailable.retry, href: AUDIENCE_HREF }} />;
    default:
      // An outcome this page does not recognise is reported as the outage it may be, which is the only honest
      // answer: an empty audience would claim that nobody holds a membership.
      return <StateNotice kind="unavailable" headingLevel={2} title={PAGE_COPY.unrecognised.title} description={PAGE_COPY.unrecognised.body} />;
  }
}

// ---------------------------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------------------------

export interface CommunicationAudiencePageProps {
  /** The URL's own parameters, which Next 16 hands a route as a promise. */
  readonly searchParams: Promise<SearchParams>;
}

/** The publisher's Update-email audience: one read under the session's own scope, and the arm its result names. */
export default async function CommunicationAudiencePage({ searchParams }: CommunicationAudiencePageProps): Promise<ReactElement> {
  const stated = await searchParams;
  const result = await reads.audience.readAudience(audienceQueryOf(stated));
  return (
    <section aria-labelledby={HEADING_ID} className="flex min-w-0 flex-col gap-6 text-start">
      <div className="flex min-w-0 flex-col gap-2">
        {/* The one h1 on this page: every count, notice and table below opens at level two. */}
        <h1 id={HEADING_ID} className="text-2xl font-semibold text-pretty wrap-anywhere">
          {PAGE_COPY.heading}
        </h1>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">{PAGE_COPY.lede}</p>
      </div>
      {result.kind === "envelope" ? (
        <MembershipTable envelope={result.envelope} scope={result.envelope.scope} locale={INTERFACE_LOCALE} />
      ) : (
        <>
          <p className="max-w-prose text-pretty text-sm text-muted-foreground">{NOT_CONSENT_STATEMENT}</p>
          <AudienceNotice result={result} />
        </>
      )}
    </section>
  );
}
