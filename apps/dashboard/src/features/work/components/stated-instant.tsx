"use client";
import type { ReactElement } from "react";
import { parseCivilDate, serialiseCivilDate } from "@/modules/time/civil";
const NOT_STATED_TEXT = "Not stated"; /** One date or instant a read already stated as text, isolated from the surrounding direction and kept machine-readable in a `time`. */
export function StatedInstant({ iso, text, className }: { readonly iso: string; readonly text?: string; readonly className?: string }): ReactElement {
  return (
    <bdi>
      <time className={className} dateTime={iso}>
        {text ?? iso}
      </time>
    </bdi>
  );
}
/** One civil date a plan or a read states: the day itself, or the text it arrived as when it is not a day this application can read. */ export default function StatedDate({ value, className }: { readonly value: string; readonly className?: string }): ReactElement {
  const stored = value.trim();
  const parsed = parseCivilDate(stored);
  return parsed.status === "refused" ? <span className="min-w-0 wrap-anywhere">{stored === "" ? NOT_STATED_TEXT : stored}</span> : <StatedInstant iso={serialiseCivilDate(parsed.date)} className={className} />;
}
