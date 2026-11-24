import type { Metadata } from "next";
import Link from "next/link";
import type { ReactElement } from "react";
import { PageColumn, PageHeading } from "./page-frame";
const PAGE_TITLE = "This page could not be found";
const COPY = {
  missing: "No screen in this dashboard answers to the address you opened, so nothing is shown in its place: a missing address is not an empty list, a zero or a record with nothing in it.",
  whereToGo: "Every screen this session can open is listed in the navigation beside this page. The two destinations that begin again are",
  orOpen: "or",
  helpStated: ", where each job and where it starts is stated.",
} as const;
export const metadata: Metadata = { title: PAGE_TITLE };
/** The surface a missing address renders: the product's one page title at the page-title scale, and the two destinations that begin again — because a missing address is still a page, and states its heading like every other. */
export default function NotFoundPage(): ReactElement {
  return (
    <PageColumn>
      <PageHeading title={PAGE_TITLE} paragraphs={[COPY.missing]} />
      <p className="type-supporting max-w-prose text-pretty">
        {`${COPY.whereToGo} `}
        <Link href={"/"} className="inline-link">
          Home
        </Link>
        {` ${COPY.orOpen} `}
        <Link href={"/help"} className="inline-link">
          Help
        </Link>
        {COPY.helpStated}
      </p>
    </PageColumn>
  );
}
