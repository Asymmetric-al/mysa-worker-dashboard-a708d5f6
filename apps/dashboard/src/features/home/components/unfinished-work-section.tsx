/** Home's Unfinished work section: the envelope's third partition, where work already begun is picked up again, and the one section that keeps a saved draft or a frozen candidate apart from a release. */
import { useId, type ReactElement } from "react";

import StateNotice from "@/components/state-notice";

import { NOTICE_COPY, SECTION_COPY } from "../copy";
import { parseHomeSectionGroup, type HomeSectionGroup } from "../home-schema";
import HomeItemRow from "./home-item-row";
import SectionHeading from "./section-heading";

const SECTION_KEY = "unfinished-work" as const;
const COPY = SECTION_COPY[SECTION_KEY];
const STACK_CLASS = "flex min-w-0 flex-col gap-3";

/** The envelope's payload validated, or `null` when this section's payload never arrived: a section that was not sent is an outage, never a quiet day. */
function readGroup(candidate: unknown): HomeSectionGroup | null {
  if (candidate === undefined || candidate === null) {
    return null;
  }
  try {
    return parseHomeSectionGroup(candidate);
  } catch {
    // A payload the parser itself cannot finish is reported as unreadable rather than thrown out of the page.
    return null;
  }
}

/** A React key taken from the identity the envelope gave the item, and from its position only when it stated none a row could read. */
function keyOf(item: unknown, index: number): string {
  if (typeof item === "object" && item !== null) {
    const id: unknown = Reflect.get(item, "id");
    if (typeof id === "string" && id.length > 0) {
      return id;
    }
  }
  return `${SECTION_KEY}-${index}`;
}

/** Unfinished work: one labelled section whose items keep the envelope's order, and whose rows carry the life-cycle word that makes a draft resumable rather than published. */
export default function UnfinishedWorkSection(props: { group: unknown }): ReactElement {
  // Per instance, because the heading names this section and the notice or list beneath it belongs to that name.
  const headingId = useId();
  const group = readGroup(props.group);
  let count: number | undefined;
  let content: ReactElement;
  if (group === null || group.state === "unavailable" || group.state === "unknown") {
    // A payload that never arrived, or one this section cannot read, is the outage it presents: never an empty section and never a zero. `StateNotice`'s "unknown" kind describes a change whose acknowledgement was lost, which a section read never is.
    content = <StateNotice kind="unavailable" title={NOTICE_COPY.unavailable.title} description={NOTICE_COPY.unavailable.body} />;
  } else if (group.state === "denied") {
    // No count, no item and no source, so the answer is the same whether or not unfinished work exists in the context this session may not read.
    content = <StateNotice kind="denied" title={NOTICE_COPY.denied.title} description={NOTICE_COPY.denied.body} />;
  } else {
    // The envelope's own count, never the rendered rows: what is on this page is not a count of what is unfinished.
    count = group.count;
    content =
      group.items.length === 0 ? (
        <StateNotice kind="empty" title={COPY.emptyTitle} description={COPY.emptyBody} action={COPY.firstAction} />
      ) : (
        <ul className={STACK_CLASS}>
          {group.items.map((item, index) => (
            <HomeItemRow key={keyOf(item, index)} item={item} variant={SECTION_KEY} />
          ))}
        </ul>
      );
  }
  return (
    <section aria-labelledby={headingId} className={STACK_CLASS} data-slot="unfinished-work-section">
      <SectionHeading id={headingId} sectionKey={SECTION_KEY} count={count} />
      {content}
    </section>
  );
}
