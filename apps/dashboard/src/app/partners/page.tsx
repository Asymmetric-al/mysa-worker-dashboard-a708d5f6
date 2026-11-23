import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactElement } from "react";
import { buttonVariants } from "@/components/ui/button";
import PartnerRoster from "@/features/partners/components/partner-roster";
import PrivatePreparationForm from "@/features/partners/components/private-preparation-form";
import { parseRosterQuery, rosterQuerySearch, rosterReadQuery, type RosterQueryState } from "@/features/partners/query/roster-query";
import { cn } from "@/lib/cn";
import { querySearchParamsOf } from "@/lib/query-params";
import { reads, type ReadAction } from "@/modules/data-service";
import { PageColumn, PageHeading, ReadNotices, type ReadNoticeCopy, type SearchParams } from "../page-frame";
type RosterEnvelope = Extract<Awaited<ReturnType<typeof reads.partners.findPartners>>, { readonly kind: "envelope" }>["envelope"];
/** The admitted roster read: the answer this route composes the family's roster surface for, and the one it seeds that surface with. */
type RosterEnvelopeRead = { readonly kind: "envelope"; readonly envelope: RosterEnvelope };
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Partners" };
const ROSTER_HREF = "/partners";
const ADD_CONTACT_ANCHOR = "add-private-contact";
/** The one advisory action whose presence mounts the private-contact block below the roster. */
const CREATE_PREPARATION_ACTION = "createPrivatePreparation";
/** This route's own wording. Not one word of it is a count, an amount, a record name or a permission. */
const PAGE_COPY = {
  lede: "Everyone this ministry's records hold: people, households, churches, organizations and your own private preparation, searched and filtered over the whole authorised result rather than the page on screen.",
  classes:
    "Two records that look alike stay two records, even where a name, an email address or a postal address is identical, and a tag, a favourite or an open task proves nothing about contact, consent or giving. Private preparation is a record class of its own: it is written and read here, and it is never copied into a shared history or another record's audience.",
  emptyAction: "Add a private contact",
} as const;
const NOTICE_COPY: ReadNoticeCopy = {
  headingLevel: 2,
  denied: { title: "The partner roster is not available in this context", body: "This session may not read these records in the context it is working in, so no row, count, name or size is stated here — a refusal is not an empty roster. Another context, if this session holds one, can be chosen from the shell." },
  unavailable: { title: "The partner roster could not be read" },
  refused: {
    title: "This roster's request was refused",
    body: "The address states a view the partner read does not admit, so nothing was read and the source behind the roster did not fail. Every filter, ordering, page and page size this route sends is drawn from the read's own vocabulary, so a refusal says the request was refused rather than that the records are empty.",
  },
};
/** This same view as an address, written by the one grammar the roster surface writes its own address with: a retry re-reads the roster the worker was looking at rather than dropping the view, and a page beyond the last one the result holds is answered by the last page it does hold. The page is replaced rather than appended, so one view is one address. */
const rosterHrefOf = (view: RosterQueryState): string => {
  const query = rosterQuerySearch(view);
  return query === "" ? ROSTER_HREF : `${ROSTER_HREF}?${query}`;
};
const admits = (actions: readonly ReadAction[], name: string): boolean => actions.some((action) => action.name === name && action.available);
/** What the route renders for an admitted read: the family's roster surface, seeded with this read's own answer, and the private-contact block beside it. */
function RosterBody({ result }: { readonly result: RosterEnvelopeRead }): ReactElement {
  const { envelope } = result;
  const mayPrepare = admits(envelope.actions, CREATE_PREPARATION_ACTION);
  return (
    <>
      {/* One composition of the list pattern, and only one: the family's roster surface owns the toolbar, the table preset, the pager and the scroll region, and asks the service for the same view this read answered. It is handed this read's answer as its seed, so the first paint states these rows and this whole-result count rather than a loading notice and the mount issues no second read of the same view. The surface's own row action is the way into each record, so this route adds none and cannot offer a second one. */}
      <PartnerRoster
        scope={envelope.scope}
        initialResult={result}
        emptyAction={
          mayPrepare ? (
            <Link href={`#${ADD_CONTACT_ANCHOR}`} className={cn(buttonVariants({ variant: "outline" }), "h-auto max-w-full whitespace-normal")}>
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
      {result.kind === "envelope" ? <RosterBody result={result} /> : <ReadNotices failure={result} copy={{ ...NOTICE_COPY, unavailable: { ...NOTICE_COPY.unavailable, action: { label: "Try this read again", href: rosterHrefOf(view) } } }} />}
    </PageColumn>
  );
}
