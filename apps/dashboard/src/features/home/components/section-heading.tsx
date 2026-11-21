/**
 * One Home section's heading: the section's `h2`, the count the read envelope stated beside it, and
 * the sentence that says what the section holds.
 */
import type { ReactElement } from "react";
import { SECTION_COPY } from "../copy";
import type { HomeSectionKey } from "../home-schema";

/**
 * The count this heading can show, or `null` when it shows none. A genuine zero and a count the
 * envelope never stated both stay unspoken, so neither is rendered as if it were the other.
 */
function showableCount(count: number | null | undefined): number | null {
  return typeof count === "number" && Number.isInteger(count) && count > 0 ? count : null;
}

/** One Home section's heading, with its description and the positive count the envelope stated. */
export default function SectionHeading(props: { id: string; sectionKey: HomeSectionKey; count?: number | null; description?: string }): ReactElement {
  const copy = SECTION_COPY[props.sectionKey];
  const count = showableCount(props.count);
  const description = props.description ?? copy.description;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <h2 id={props.id} className="font-heading text-lg font-medium text-pretty break-words">
        <bdi>{count === null ? copy.heading : `${copy.heading} (${count})`}</bdi>
      </h2>
      {description.trim().length > 0 ? <p className="text-sm text-pretty break-words text-muted-foreground">{description}</p> : null}
    </div>
  );
}
