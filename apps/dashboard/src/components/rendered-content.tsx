import type { ReactElement } from "react";
import { DirectionProvider } from "@/components/ui/direction";
import { cn } from "@/lib/cn";
export type RenderedContentDirection = "ltr" | "rtl";
export type RenderedContentProps = { readonly html: string; readonly direction: RenderedContentDirection; readonly lang?: string; readonly slot?: string; readonly className?: string };
/** Renders the content module's HTML inside the block that carries its direction and language. */
export function RenderedContent({ html, direction, lang, slot, className }: RenderedContentProps): ReactElement | null {
  if (html.trim().length === 0) return null;
  // The raw-markup insertion is the application's one, and the reason this component exists: see the contract at the top of this file for what makes the string safe to insert. A caller that states no utilities gets no `class` attribute rather than an empty one. The direction is stated to the provider as well as the block, so portalled content inside the rendered HTML follows the edition rather than the page.
  return (
    <DirectionProvider direction={direction}>
      <div dangerouslySetInnerHTML={{ __html: html }} dir={direction} lang={lang} data-slot={slot} className={className === undefined ? undefined : cn(className)} />
    </DirectionProvider>
  );
}
export default RenderedContent;
