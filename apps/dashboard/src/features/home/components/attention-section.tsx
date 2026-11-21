/** Home's Attention partition: the work waiting on a decision or an action, each item stating its reason before its destination. */
import { useId, type ReactElement } from "react";

import StateNotice from "@/components/state-notice";
import { NOTICE_COPY, SECTION_COPY } from "../copy";
import { parseHomeSectionGroup, type HomeSectionGroup } from "../home-schema";
import HomeItemRow from "./home-item-row";
import SectionHeading from "./section-heading";

const ATTENTION_COPY = SECTION_COPY.attention;

const STACK_CLASS = "flex min-w-0 flex-col gap-3";

/** A section whose payload never arrived, or that this module could not read, is reported as unavailable — never as an empty section and never as a zero. */
function readGroup(candidate: unknown): HomeSectionGroup {
  if (candidate === undefined || candidate === null) {
    return { items: [], state: "unavailable" };
  }
  try {
    return parseHomeSectionGroup(candidate);
  } catch {
    // The parser threw rather than returning a rejection, so nothing here was read: an empty list would report a quiet day that was never observed.
    return { items: [], state: "unavailable" };
  }
}

export default function AttentionSection(props: { group: unknown }): ReactElement {
  const headingId = useId();
  const group = readGroup(props.group);
  if (group.state === "unavailable" || group.state === "unknown") {
    // An unreadable payload arrives with the schema's own wording for it; a source outage uses the shared notice copy.
    const unreadable = group.state === "unknown" ? group.notice : undefined;
    return (
      <section aria-labelledby={headingId} className={STACK_CLASS}>
        <SectionHeading id={headingId} sectionKey="attention" />
        <StateNotice kind="unavailable" headingLevel={3} title={unreadable?.title ?? NOTICE_COPY.unavailable.title} description={unreadable?.body ?? NOTICE_COPY.unavailable.body} />
      </section>
    );
  }
  if (group.state === "denied") {
    // No count, no item and no existence hint: the answer reads the same whether or not work exists in a scope this session may not read.
    return (
      <section aria-labelledby={headingId} className={STACK_CLASS}>
        <SectionHeading id={headingId} sectionKey="attention" />
        <StateNotice kind="denied" headingLevel={3} title={NOTICE_COPY.denied.title} description={NOTICE_COPY.denied.body} />
      </section>
    );
  }
  const items = group.items;
  const [firstItem] = items;
  return (
    <section aria-labelledby={headingId} className={STACK_CLASS}>
      <SectionHeading id={headingId} sectionKey="attention" count={group.count} />
      {firstItem === undefined ? (
        <StateNotice kind="empty" headingLevel={3} title={ATTENTION_COPY.emptyTitle} description={ATTENTION_COPY.emptyBody} action={ATTENTION_COPY.firstAction} />
      ) : (
        <ul aria-labelledby={headingId} className={STACK_CLASS}>
          {items.map((item, position) => (
            // The envelope states the order and this section never re-orders or filters, so the envelope's own position is the stable identity a row can be keyed by.
            <HomeItemRow key={position} item={item} variant="attention" />
          ))}
        </ul>
      )}
    </section>
  );
}
