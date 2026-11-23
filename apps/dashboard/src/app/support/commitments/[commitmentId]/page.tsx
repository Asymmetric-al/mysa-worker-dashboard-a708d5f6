import type { Metadata } from "next";
import type { ReactElement } from "react";
import { CommitmentDetail } from "@/features/support/components/commitment-detail";
import { reads } from "@/modules/data-service";
import { pageRefusalOf, searchSuffixOf, type ReadNoticeCopy, type SearchParams } from "../../../page-frame";
const LIST_HREF = "/support/commitments";
type CommitmentDetailRouteProps = { readonly params: Promise<{ commitmentId: string }>; readonly searchParams: Promise<SearchParams> };
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Commitment" };
const NOTICE_COPY: ReadNoticeCopy = {
  headingLevel: 1,
  denied: { title: "This commitment is not shown in this context", body: "The commitments read was refused for the context this session is admitted to. Nothing here states whether a commitment carries that identifier, what such a commitment would be, or how large it is." },
  unavailable: { title: "The commitment could not be read" },
  refused: { title: "This commitment's request was refused" },
};
/** One commitment: the envelope for it, or the read's own refusal stated as `denied` or `unavailable`. */
export default async function CommitmentDetailPage({ params, searchParams }: CommitmentDetailRouteProps): Promise<ReactElement> {
  const { commitmentId } = await params;
  const carried = searchSuffixOf(await searchParams);
  const result = await reads.support.readCommitments({ commitmentId });
  const back = { label: "Back to the commitments list", href: `${LIST_HREF}${carried}` };
  const copy: ReadNoticeCopy = { ...NOTICE_COPY, denied: { ...NOTICE_COPY.denied, action: back }, unavailable: { ...NOTICE_COPY.unavailable, action: { label: "Read this commitment again", href: `${LIST_HREF}/${encodeURIComponent(commitmentId)}${carried}` } }, refused: { ...NOTICE_COPY.refused, action: back } };
  if (result.kind !== "envelope") return pageRefusalOf(result, copy, 4);
  return <CommitmentDetail scope={result.envelope.scope} commitmentId={commitmentId} locale="en-GB" />;
}
