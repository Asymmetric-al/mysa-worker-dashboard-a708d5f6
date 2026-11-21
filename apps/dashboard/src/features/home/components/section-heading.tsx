import type { ReactElement } from "react";
import { SECTION_COPY } from "../copy";
import type { HomeSectionKey } from "../home-schema";

const showableCount = (count: number | null | undefined): number | null => (typeof count === "number" && Number.isInteger(count) && count > 0 ? count : null);

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
