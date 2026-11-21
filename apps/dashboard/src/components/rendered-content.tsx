/**
 * The application's single rendering boundary for the content module's rendered HTML: the one place
 * where the string `modules/content/render.ts` produces becomes DOM.
 */
import type { ReactElement } from "react";
import { cn } from "@/lib/cn";
/** The two writing directions a rendered document can state. */
export type RenderedContentDirection = "ltr" | "rtl";
/** Props of {@link RenderedContent}. */
export interface RenderedContentProps {
  readonly html: string;
  readonly direction: RenderedContentDirection;
  readonly lang?: string;
  readonly slot?: string;
  readonly className?: string;
}
/** Renders the content module's HTML inside the block that carries its direction and language. */
export function RenderedContent({ html, direction, lang, slot, className }: RenderedContentProps): ReactElement | null {
  if (html.trim().length === 0) {
    return null;
  }
  return (
    <div
      // The application's one raw-markup insertion, and the reason this component exists: see the
      // contract at the top of this file for what makes the string safe to insert.
      dangerouslySetInnerHTML={{ __html: html }}
      dir={direction}
      lang={lang}
      data-slot={slot}
      // A caller that states no utilities gets no `class` attribute rather than an empty one.
      className={className === undefined ? undefined : cn(className)}
    />
  );
}
export default RenderedContent;
