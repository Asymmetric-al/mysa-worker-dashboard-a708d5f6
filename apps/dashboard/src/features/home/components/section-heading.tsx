import type { ReactElement } from "react";
import { AlertTriangleIcon, Clock3Icon, InfoIcon } from "lucide-react";
import { IconTile, type IconTileProps } from "@/components/ui/icon-tile";
import { SECTION_COPY } from "../copy";
import type { HomeSectionKey } from "../home-schema";

const SECTION_ICON: Readonly<Record<HomeSectionKey, { readonly variant: IconTileProps["variant"]; readonly icon: ReactElement }>> = { attention: { variant: "warning", icon: <AlertTriangleIcon /> }, information: { variant: "info", icon: <InfoIcon /> }, "unfinished-work": { variant: "soft", icon: <Clock3Icon /> } };

export default function SectionHeading(props: { id: string; sectionKey: HomeSectionKey; count?: number | null; description?: string }): ReactElement {
  const copy = SECTION_COPY[props.sectionKey];
  const count = typeof props.count === "number" && Number.isInteger(props.count) && props.count > 0 ? props.count : null;
  const description = props.description ?? copy.description;
  const visual = SECTION_ICON[props.sectionKey];
  return (
    <div className="flex min-w-0 items-start gap-3">
      <IconTile variant={visual.variant} size="sm" className="mt-0.5">
        {visual.icon}
      </IconTile>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 id={props.id} className="type-section-title text-pretty break-words">
          <bdi>{count === null ? copy.heading : `${copy.heading} (${count})`}</bdi>
        </h2>
        {description.trim().length > 0 ? <p className="type-supporting text-pretty break-words">{description}</p> : null}
      </div>
    </div>
  );
}
