import type { ReactElement } from "react";
import { DirectionProvider } from "@/components/ui/direction";
import { cn } from "@/lib/cn";
/** The one utility set a surface showing the renderer's output composes its prose with: the element rules the content profile admits, stated once so an Update preview, a Page preview and any later reading surface style the same markup the same way. */ export const RENDERED_PROSE = cn(
  "min-w-0 type-body break-words",
  "[&_p]:mb-3 [&_p:last-child]:mb-0",
  "[&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:type-section-title [&_h2:first-child]:mt-0",
  "[&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:type-subsection-title",
  "[&_h4]:mt-4 [&_h4]:mb-2 [&_h4]:type-group-title",
  "[&_ul]:mb-3 [&_ul]:list-disc [&_ul]:ps-5 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:ps-5 [&_li]:mb-1",
  "[&_blockquote]:my-3 [&_blockquote]:border-s-2 [&_blockquote]:border-border [&_blockquote]:ps-3",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4",
  "[&_strong]:font-semibold [&_em]:italic",
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-xs",
  "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3",
  "[&_hr]:my-4 [&_hr]:border-border",
  "[&_section]:mb-4 [&_section:last-child]:mb-0",
  "[&_figure]:my-4 [&_figure]:flex [&_figure]:flex-col [&_figure]:gap-2",
  "[&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-lg",
  "[&_video]:h-auto [&_video]:w-full [&_video]:max-w-full [&_video]:rounded-lg",
  "[&_figcaption]:text-xs [&_figcaption]:text-muted-foreground",
);
export type RenderedContentDirection = "ltr" | "rtl";
export type RenderedContentProps = { readonly html: string; readonly direction: RenderedContentDirection; readonly lang?: string; readonly slot?: string; readonly className?: string };
/** Renders the content module's HTML inside the block that carries its direction and language. */ export function RenderedContent({ html, direction, lang, slot, className }: RenderedContentProps): ReactElement | null {
  if (html.trim().length === 0) return null;
  // The raw-markup insertion is the application's one, and the reason this component exists: see the contract at the top of this file for what makes the string safe to insert. A caller that states no utilities gets no `class` attribute rather than an empty one. The direction is stated to the provider as well as the block, so portalled content inside the rendered HTML follows the edition rather than the page.
  return (
    <DirectionProvider direction={direction}>
      <div dangerouslySetInnerHTML={{ __html: html }} dir={direction} lang={lang} data-slot={slot} className={className === undefined ? undefined : cn(className)} />
    </DirectionProvider>
  );
}
export default RenderedContent;
