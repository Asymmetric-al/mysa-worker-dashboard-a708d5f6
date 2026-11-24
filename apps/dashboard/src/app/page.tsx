import type { Metadata } from "next";
import type { ReactElement } from "react";
import HomeSections from "@/features/home/components/home-sections";
import { HOME_COPY } from "@/features/home/copy";
import { PRODUCT_TITLE_SUFFIX } from "@/lib/application-name";
import { reads } from "@/modules/data-service";
import { PageColumn, PageHeading, pageRefusalOf, type ReadNoticeCopy } from "./page-frame";
export const dynamic = "force-dynamic";
/** The home title states the product suffix itself: this route sits in the root layout's own segment, where `title.template` is not applied to the segment's own `title`. */ export const metadata: Metadata = { title: { absolute: `${HOME_COPY.title}${PRODUCT_TITLE_SUFFIX}` } };
const NOTICE_COPY: ReadNoticeCopy = {
  headingLevel: 1,
  denied: { title: HOME_COPY.title, body: "Home could not be read for this session, so no item, count or reason is stated here — a refusal is not a quiet day. " + "If this session admits another context, the shell is where that context is chosen." },
  unavailable: { title: HOME_COPY.title },
  refused: { title: HOME_COPY.title },
};
/** The Home screen: the worker's day in three sections, or the reason it could not be read. */ export default async function HomePage(): Promise<ReactElement> {
  const result = await reads.context.readHome();
  // Every refusal notice states the page's own title, so it is the page heading itself and the heading block is rendered only for the surface that answered: a heading above a notice repeating the same word would state the route's title twice.
  if (result.kind !== "envelope") return pageRefusalOf(result, NOTICE_COPY, 6);
  return (
    <PageColumn gap={6}>
      <PageHeading title={HOME_COPY.title} paragraphs={[HOME_COPY.lead]} />
      <HomeSections initial={result} scope={result.envelope.scope} />
    </PageColumn>
  );
}
