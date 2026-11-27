import type { Metadata } from "next";
import Link from "next/link";
import type { ReactElement } from "react";
import { PageColumn, PageHeading } from "./page-frame";
const PAGE_TITLE = "Page not found";
const COPY = {
  missing: "We couldn’t find a page at this address.",
  whereToGo: "Use the sidebar to jump anywhere, or head back to",
  orOpen: "or",
  helpStated: "for guides to your workspace.",
} as const;
export const metadata: Metadata = { title: PAGE_TITLE };
/** Missing-route screen with clear paths back to Home and Help. */ export default function NotFoundPage(): ReactElement {
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
        {` ${COPY.helpStated}`}
      </p>
    </PageColumn>
  );
}
