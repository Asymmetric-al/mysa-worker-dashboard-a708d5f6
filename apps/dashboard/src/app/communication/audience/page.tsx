import type { Metadata } from "next";
import type { ReactElement } from "react";
import { StateNotice } from "@/components/state-notice";
import MembershipTable from "@/features/audience/components/membership-table";
import { NOT_CONSENT_STATEMENT, PURPOSE_LABEL } from "@/features/audience/copy/membership";
import { reads } from "@/modules/data-service";
import { firstValueOf, type SearchParams } from "../../page-frame";
export const metadata: Metadata = { title: "Audience" };
type AudienceRead = typeof reads.audience.readAudience;
const AUDIENCE_HREF = "/communication/audience";
const HEADING_ID = "communication-audience-heading";
const PARAM = { page: "page", pageSize: "pageSize" } as const;
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
function audienceQueryOf(searchParams: SearchParams): NonNullable<Parameters<AudienceRead>[0]> {
  const page = firstValueOf(searchParams[PARAM.page]);
  const pageSize = firstValueOf(searchParams[PARAM.pageSize]);
  return { ...(page === undefined ? {} : { page: Number(page) }), ...(pageSize === undefined ? {} : { pageSize: Number(pageSize) }) };
}
function AudienceNotice({ result }: { readonly result: Exclude<Awaited<ReturnType<AudienceRead>>, { readonly kind: "envelope" }> }): ReactElement {
  switch (result.kind) {
    case "denied":
      return <StateNotice kind="denied" headingLevel={2} title={PAGE_COPY.denied.title} description={PAGE_COPY.denied.body} reasonCode={result.denied.reasonCode} />;
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={2} title={PAGE_COPY.unavailable.title} description={result.unavailable.guidance} source={result.unavailable.source} action={{ label: PAGE_COPY.unavailable.retry, href: AUDIENCE_HREF }} />;
    case "refused":
      return <StateNotice kind="refused" headingLevel={2} title={PAGE_COPY.refused.title} description={PAGE_COPY.refused.body} action={{ label: PAGE_COPY.unavailable.retry, href: AUDIENCE_HREF }} />;
    default:
      return <StateNotice kind="unavailable" headingLevel={2} title={PAGE_COPY.unrecognised.title} description={PAGE_COPY.unrecognised.body} />;
  }
}
/** The publisher's Update-email audience: one read under the session's own scope, and the arm its result names. */ export default async function CommunicationAudiencePage({ searchParams }: { readonly searchParams: Promise<SearchParams> }): Promise<ReactElement> {
  const stated = await searchParams;
  const result = await reads.audience.readAudience(audienceQueryOf(stated));
  return (
    <section aria-labelledby={HEADING_ID} className="flex min-w-0 flex-col gap-6 text-start">
      <div className="flex min-w-0 flex-col gap-2">
        <h1 id={HEADING_ID} className="type-page-title text-pretty wrap-anywhere">
          {PAGE_COPY.heading}
        </h1>
        <p className="max-w-prose type-supporting text-pretty">{PAGE_COPY.lede}</p>
      </div>
      {result.kind === "envelope" ? (
        <MembershipTable envelope={result.envelope} scope={result.envelope.scope} locale={"en-GB"} />
      ) : (
        <>
          <p className="max-w-prose text-pretty type-supporting">{NOT_CONSENT_STATEMENT}</p>
          <AudienceNotice result={result} />
        </>
      )}
    </section>
  );
}
