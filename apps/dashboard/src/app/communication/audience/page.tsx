import type { Metadata } from "next";
import type { ReactElement } from "react";
import { StateNotice } from "@/components/state-notice";
import MembershipTable from "@/features/audience/components/membership-table";
import { NOT_CONSENT_STATEMENT, PURPOSE_LABEL } from "@/features/audience/copy/membership";
import { reads } from "@/modules/data-service";
import { firstValueOf, type SearchParams } from "../../page-frame";
export const metadata: Metadata = { title: "Email audience" };
type AudienceRead = typeof reads.audience.readAudience;
const AUDIENCE_HREF = "/communication/audience";
const HEADING_ID = "communication-audience-heading";
const PARAM = { page: "page", pageSize: "pageSize" } as const;
const PAGE_COPY = {
  heading: "Email audience",
  lede: `Who will receive your ${PURPOSE_LABEL["update-email"].toLowerCase()}, their current consent status, and why excluded contacts won’t be emailed.`,
  denied: {
    title: "Email audience isn’t available in this ministry context",
    body: "Your current session doesn’t have permission to view this audience list. Switch ministry context from the sidebar if you have access to another one.",
  },
  unavailable: { title: "Couldn’t load Email audience", retry: "Try again" },
  refused: {
    title: "Couldn’t load Email audience",
    body: "The page parameters weren’t accepted. Reload Email audience to view from page 1.",
  },
  unrecognised: { title: "Couldn’t load Email audience", body: "Received an unexpected response from the audience service. Try again in a moment." },
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
