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
  denied: { title: "This commitment isn’t available in this context", body: "Your current session doesn’t have permission to view commitment details here." },
  unavailable: { title: "Couldn’t load this commitment" },
  refused: { title: "Couldn’t open this commitment" },
};
/** One commitment: the envelope for it, or the read's own refusal stated as `denied` or `unavailable`. */ export default async function CommitmentDetailPage({ params, searchParams }: CommitmentDetailRouteProps): Promise<ReactElement> {
  const { commitmentId } = await params;
  const carried = searchSuffixOf(await searchParams);
  const result = await reads.support.readCommitments({ commitmentId });
  const back = { label: "Back to Commitments", href: `${LIST_HREF}${carried}` };
  const copy: ReadNoticeCopy = { ...NOTICE_COPY, denied: { ...NOTICE_COPY.denied, action: back }, unavailable: { ...NOTICE_COPY.unavailable, action: { label: "Try again", href: `${LIST_HREF}/${encodeURIComponent(commitmentId)}${carried}` } }, refused: { ...NOTICE_COPY.refused, action: back } };
  if (result.kind !== "envelope") return pageRefusalOf(result, copy, 4);
  return <CommitmentDetail scope={result.envelope.scope} commitmentId={commitmentId} locale="en-GB" />;
}
