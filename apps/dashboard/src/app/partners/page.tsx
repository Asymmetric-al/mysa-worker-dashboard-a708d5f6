import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactElement } from "react";
import { buttonVariants, BUTTON_WRAP_CLASS } from "@/components/ui/button";
import PartnerRoster from "@/features/partners/components/partner-roster";
import PrivatePreparationForm from "@/features/partners/components/private-preparation-form";
import { parseRosterQuery, rosterQuerySearch, rosterReadQuery, type RosterQueryState } from "@/features/partners/query/roster-query";
import { cn } from "@/lib/cn";
import { querySearchParamsOf } from "@/lib/query-params";
import { reads, type ReadAction } from "@/modules/data-service";
import PartnerIntroductionSection from "./partner-introduction-section";
import { PageColumn, PageHeading, ReadNotices, type ReadNoticeCopy, type SearchParams } from "../page-frame";
type RosterEnvelope = Extract<Awaited<ReturnType<typeof reads.partners.findPartners>>, { readonly kind: "envelope" }>["envelope"];
type RosterEnvelopeRead = { readonly kind: "envelope"; readonly envelope: RosterEnvelope };
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Partners" };
const ROSTER_HREF = "/partners";
const ADD_CONTACT_ANCHOR = "add-private-contact";
/** The one advisory action whose presence mounts the private-contact block below the roster. */
/** This route's own wording. Not one word of it is a count, an amount, a record name or a permission. */ const PAGE_COPY = {
  lede: "Everyone in your ministry — people, households, churches, organizations, and your private contacts. Search and filters apply across your full list.",
  classes:
    "Your private contacts and notes are visible only to you and are never copied into shared records or exports. Tags, favourites, and tasks help you organize and never record consent or giving.",
  emptyAction: "Add private contact",
} as const;
const NOTICE_COPY: ReadNoticeCopy = {
  headingLevel: 2,
  denied: { title: "Partners aren’t available in this ministry", body: "Your current session doesn’t have permission to view partners here. Switch ministries from the sidebar if you have access to another one." },
  unavailable: { title: "Couldn’t load partners" },
  refused: {
    title: "Invalid partner filter or page",
    body: "The URL includes a filter, sort, or page that isn’t supported. Clear your filters or return to the default partner list.",
  },
};
/** This same view as an address, written by the one grammar the roster surface writes its own address with: a retry re-reads the roster the worker was looking at rather than dropping the view, and a page beyond the last one the result holds is answered by the last page it does hold. The page is replaced rather than appended, so one view is one address. */
const rosterHrefOf = (view: RosterQueryState): string => {
  const query = rosterQuerySearch(view);
  return query === "" ? ROSTER_HREF : `${ROSTER_HREF}?${query}`;
};
const admits = (actions: readonly ReadAction[], name: string): boolean => actions.some((action) => action.name === name && action.available);
function RosterBody({ result }: { readonly result: RosterEnvelopeRead }): ReactElement {
  const { envelope } = result;
  const mayPrepare = admits(envelope.actions, "createPrivatePreparation");
  return (
    <>
      {/* One composition of the list pattern, and only one: the family's roster surface owns the toolbar, the table preset, the pager and the scroll region, and asks the service for the same view this read answered. It is handed this read's answer as its seed, so the first paint states these rows and this whole-result count rather than a loading notice and the mount issues no second read of the same view. The surface's own row action is the way into each record, so this route adds none and cannot offer a second one. */}
      <PartnerRoster
        scope={envelope.scope}
        initialResult={result}
        introduction={<PartnerIntroductionSection />}
        emptyAction={
          mayPrepare ? (
            <Link href={`#${ADD_CONTACT_ANCHOR}`} data-slot="button" className={cn(buttonVariants({ variant: "outline" }), BUTTON_WRAP_CLASS)}>
              {PAGE_COPY.emptyAction}
            </Link>
          ) : undefined
        }
      />
      {mayPrepare ? (
        <div id={ADD_CONTACT_ANCHOR} tabIndex={-1} className="scroll-mt-6">
          <PrivatePreparationForm scope={envelope.scope} expectedRevision={envelope.revision} />
        </div>
      ) : null}
    </>
  );
}
/** The roster over one scope: the read of the view the address describes, the family's own roster surface over it, and the worker's private preparation, which the same read admitted. */
export default async function PartnersRosterPage({ searchParams }: { readonly searchParams: Promise<SearchParams> }): Promise<ReactElement> {
  const stated = await searchParams;
  const view = parseRosterQuery(querySearchParamsOf(stated));
  const query = rosterReadQuery(view);
  const result = await reads.partners.findPartners(query); // The organization, ministry, support subject and principal are derived by the service from this session: the address supplies a view and nothing that could invent authority.
  // A page past the last one the result holds would reach the list as an empty page of a non-empty result, and the list would state that no partner exists while its own pager states how many it holds — so the address is corrected here, before anything is rendered, rather than the reader being told a falsehood about the collection.
  if (result.kind === "envelope" && (query.page?.index ?? 0) >= result.envelope.data.page.totalPages) redirect(rosterHrefOf({ ...view, page: result.envelope.data.page.totalPages }));
  return (
    <PageColumn>
      <PageHeading title="Partners" paragraphs={[PAGE_COPY.lede, PAGE_COPY.classes]} />
      {result.kind === "envelope" ? <RosterBody result={result} /> : <ReadNotices failure={result} copy={{ ...NOTICE_COPY, unavailable: { ...NOTICE_COPY.unavailable, action: { label: "Try again", href: rosterHrefOf(view) } } }} />}
    </PageColumn>
  );
}
