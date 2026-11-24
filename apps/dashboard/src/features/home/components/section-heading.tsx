import type { ReactElement } from "react";
import { SECTION_COPY } from "../copy";
import type { HomeSectionKey } from "../home-schema";
export default function SectionHeading(props: { id: string; sectionKey: HomeSectionKey; count?: number | null; description?: string }): ReactElement {
  const copy = SECTION_COPY[props.sectionKey];
  const count = typeof props.count === "number" && Number.isInteger(props.count) && props.count > 0 ? props.count : null;
  const description = props.description ?? copy.description;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <h2 id={props.id} className="type-section-title text-pretty break-words">
        <bdi>{count === null ? copy.heading : `${copy.heading} (${count})`}</bdi>
      </h2>
      {description.trim().length > 0 ? <p className="type-supporting text-pretty break-words">{description}</p> : null}
    </div>
  );
}
