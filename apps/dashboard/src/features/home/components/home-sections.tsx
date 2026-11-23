"use client";
import type { ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import { assertNever } from "@/lib/result";
import type { ReadEnvelope, ReadResult, Scope } from "@/modules/data-service";
import { NOTICE_COPY, SECTION_COPY } from "../copy";
import { homeSectionGroupsOf, type HomeData, type HomeSectionGroupView } from "../home-view";
import { useHome } from "../use-home";
import HomeItemRow from "./home-item-row";
import SectionHeading from "./section-heading";
export type HomeSectionsProps = { readonly initial: ReadResult<ReadEnvelope<HomeData>>; readonly scope: Scope };
function HomeSection({ group }: { readonly group: HomeSectionGroupView }): ReactElement {
  const headingId = `home-${group.sectionKey}`;
  const copy = SECTION_COPY[group.sectionKey];
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
      <SectionHeading id={headingId} sectionKey={group.sectionKey} count={group.items.length} />
      {group.items.length === 0 ? (
        <StateNotice kind="empty" headingLevel={3} title={copy.emptyTitle} description={copy.emptyBody} action={{ label: copy.firstAction.label, href: copy.firstAction.href }} />
      ) : (
        <ul aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
          {group.items.map((item) => (
            <HomeItemRow key={item.id} item={item} variant={group.sectionKey} />
          ))}
        </ul>
      )}
    </section>
  );
}
export default function HomeSections(props: HomeSectionsProps): ReactElement {
  const { result } = useHome({ initial: props.initial, scope: props.scope });
  // Every arm heads at level two, because the page's `h1` stands above this surface and no other heading sits between them.
  switch (result.kind) {
    case "envelope":
      return (
        <div className="flex min-w-0 flex-col gap-6 text-start">
          {homeSectionGroupsOf(result.envelope.data).map((group) => (
            <HomeSection key={group.sectionKey} group={group} />
          ))}
        </div>
      );
    case "denied":
      return <StateNotice kind="denied" headingLevel={2} title={NOTICE_COPY.denied.title} description={NOTICE_COPY.denied.body} reasonCode={result.denied.reasonCode} />; // A denial states no item, count or existence hint, so it reads the same whether or not work exists in the context this session may not read.
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={2} title={NOTICE_COPY.unavailable.title} description={NOTICE_COPY.unavailable.body} source={result.unavailable.source} />; // The source that did not answer is named, so an outage is never drawn as an empty Home and never as a zero.
    case "refused":
      return <StateNotice kind="refused" headingLevel={2} title={NOTICE_COPY.refused.title} description={NOTICE_COPY.refused.body} />;
    default:
      return assertNever(result, "Unhandled Home read result");
  }
}
