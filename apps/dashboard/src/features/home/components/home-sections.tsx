"use client";
import type { ReactElement } from "react";

import StateNotice from "@/components/state-notice";
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
  if (result.kind !== "envelope") {
    // Headed at level two: the page's `h1` stands above this notice and nothing else in this arm renders one between them.
    return <StateNotice kind="unavailable" headingLevel={2} title={NOTICE_COPY.unavailable.title} description={NOTICE_COPY.unavailable.body} />;
  }
  const groups = homeSectionGroupsOf(result.envelope.data);
  return (
    <div className="flex min-w-0 flex-col gap-6 text-start">
      {groups.map((group) => (
        <HomeSection key={group.sectionKey} group={group} />
      ))}
    </div>
  );
}
