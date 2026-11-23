import type { ReactElement, ReactNode } from "react";
import RenderedContent from "@/components/rendered-content";
import { SimulationLabel } from "@/components/simulation-label";
import { StateNotice } from "@/components/state-notice";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import type { SourceReference } from "@/lib/ids";
import { copy } from "../copy";
import { GivingDesignation, type GivingBindingView } from "./giving-designation";
/** A preview that may be rendered: the exact revision, the language and direction it is read in, and the markup the single renderer produced. */
export type PagePreviewAuthorisedView = { readonly status: "authorised"; readonly variantId: string; readonly revisionId: string; readonly servedLocale: string; readonly requestedLocale?: string; readonly direction: "ltr" | "rtl"; readonly html: string; readonly inert: true; readonly givingAction: "none" };
/** A preview that may not be rendered: one reason code and nothing else. */
export type PagePreviewDeniedView = { readonly status: "denied"; readonly reason: string };
/** A preview whose edition could not be read: the source that failed, named honestly. */
export type PagePreviewUnavailableView = { readonly status: "unavailable"; readonly source: SourceReference };
/** A preview whose own request was refused: the read answered, and the edition, revision or language asked for is not one it admits. */
export type PagePreviewRefusedView = { readonly status: "refused" };
/** A preview whose requested language no edition of this Page holds: the language asked for, and nothing about any other edition. */
export type PagePreviewLanguageUnavailableView = { readonly status: "language-unavailable"; readonly requestedLocale: string };
/** A preview whose edition has neither a draft nor a released revision, so there is nothing exact to render. */
export type PagePreviewUnreleasedView = { readonly status: "unreleased"; readonly locale: string };
/** Every answer this surface renders. */
export type PagePreviewView = PagePreviewAuthorisedView | PagePreviewDeniedView | PagePreviewUnavailableView | PagePreviewRefusedView | PagePreviewLanguageUnavailableView | PagePreviewUnreleasedView;
/** Props of {@link PagePreviewFrame}. */
export type PagePreviewFrameProps = { readonly layout: "builder" | "route"; readonly preview: PagePreviewView; readonly givingBinding?: GivingBindingView; readonly className?: string };
const FIELD_LABELS = { revision: "Revision", requestedLanguage: "Language requested" } as const;
const PREVIEW_HEADING = copy.builder.preview;
const PREVIEW_CONTENT = cn(
  "min-w-0 text-sm leading-relaxed break-words",
  "[&_p]:mb-3 [&_p:last-child]:mb-0",
  "[&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:font-heading [&_h2]:text-lg [&_h2]:font-medium [&_h2:first-child]:mt-0",
  "[&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:font-heading [&_h3]:text-base [&_h3]:font-medium",
  "[&_h4]:mt-4 [&_h4]:mb-2 [&_h4]:font-heading [&_h4]:text-sm [&_h4]:font-medium",
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
const BODY_CLASS = "flex min-w-0 flex-col gap-4";
const HEADING_CLASS = "font-heading text-lg font-medium";
const NOTE_CLASS = "text-xs text-muted-foreground text-pretty wrap-anywhere";
const PreviewHeading = (): ReactElement => <h2 className={HEADING_CLASS}>{PREVIEW_HEADING}</h2>;
const IdentityPair = ({ label, children }: { readonly label: string; readonly children: ReactNode }): ReactElement => (
  <div className={"flex items-baseline gap-1.5"}>
    <dt>{label}</dt>
    <dd>{children}</dd>
  </div>
);
function EditionIdentity({ preview, layout }: { readonly preview: PagePreviewAuthorisedView; readonly layout: PagePreviewFrameProps["layout"] }): ReactElement {
  const requested = preview.requestedLocale?.trim() ?? "";
  const fallback = requested.length > 0 && requested !== preview.servedLocale;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <dl className={"flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted-foreground"}>
          <IdentityPair label={copy.editions.localeLabel}>
            <bdi>{preview.servedLocale}</bdi>
          </IdentityPair>
          {fallback ? (
            <IdentityPair label={FIELD_LABELS.requestedLanguage}>
              <bdi>{requested}</bdi>
            </IdentityPair>
          ) : null}
          <IdentityPair label={FIELD_LABELS.revision}>
            <bdi className="mono-identifier wrap-anywhere">{preview.revisionId}</bdi>
          </IdentityPair>
        </dl>
        {layout === "route" ? <SimulationLabel effect={copy.release.simulatedEffectKey} context="inline" /> : null}
      </div>
      {fallback ? <p className={NOTE_CLASS}>{copy.editions.fallbackNote}</p> : null}
      <p className={NOTE_CLASS}>{copy.preview.exactRevisionNote}</p>
    </div>
  );
}
const AuthorisedPreview = ({ preview, layout, givingBinding }: { readonly preview: PagePreviewAuthorisedView; readonly layout: PagePreviewFrameProps["layout"]; readonly givingBinding: GivingBindingView | undefined }): ReactElement => (
  <>
    <EditionIdentity preview={preview} layout={layout} />
    <Alert role={undefined} data-slot="page-preview-inert">
      <AlertDescription>{copy.preview.inertBanner}</AlertDescription>
    </Alert>
    <RenderedContent html={preview.html} direction={preview.direction} lang={preview.servedLocale} slot="page-preview-content" className={PREVIEW_CONTENT} />
    {givingBinding === undefined ? null : <GivingDesignation binding={givingBinding} layout="inline" />}
    <p className={NOTE_CLASS}>{copy.preview.recheckedOnOpen}</p>
  </>
);
function previewBody(preview: PagePreviewView, layout: PagePreviewFrameProps["layout"], givingBinding: GivingBindingView | undefined): ReactElement {
  switch (preview.status) {
    case "authorised":
      return <AuthorisedPreview preview={preview} layout={layout} givingBinding={givingBinding} />;
    case "denied":
      return (
        <div data-slot="page-preview-denied" data-denial-reason={preview.reason}>
          <StateNotice kind="denied" title={copy.states.deniedTitle} headingLevel={3} />
        </div>
      );
    case "unavailable":
      return <StateNotice kind="unavailable" title={copy.states.unavailableTitle} source={preview.source} headingLevel={3} />;
    case "refused":
      return <StateNotice kind="refused" title={copy.states.refusedTitle} headingLevel={3} />;
    case "language-unavailable":
      return (
        <div data-slot="page-preview-language-unavailable" data-requested-locale={preview.requestedLocale}>
          <StateNotice kind="language-unavailable" title={copy.editions.languageUnavailable} headingLevel={3} />
        </div>
      );
    case "unreleased":
      return (
        <div data-slot="page-preview-unreleased" data-edition-locale={preview.locale}>
          <StateNotice kind="empty" title={copy.editions.unreleasedTitle} description={copy.editions.unreleasedDescription} headingLevel={3} />
        </div>
      );
    default: {
      return preview;
    }
  }
}
/** The exact, currently authorised, inert preview of one Page edition. */
export function PagePreviewFrame({ layout, preview, givingBinding, className }: PagePreviewFrameProps): ReactElement {
  const body = previewBody(preview, layout, givingBinding);
  // The builder composes this frame inside the pane that already names and titles this region, so there the frame states neither a landmark name nor a heading of its own: one region called "Preview" with one heading, rather than a region nested in a region of the same name and a second heading saying the same words. The route preview has no such pane, so it keeps both.
  const named = layout === "route" ? { "aria-label": PREVIEW_HEADING } : {};
  return (
    <section data-slot="page-preview-frame" data-layout={layout} data-preview-status={preview.status} {...named} className={cn("flex min-w-0 flex-col gap-3 text-start", className)}>
      {layout === "route" ? (
        <div className={BODY_CLASS}>
          <PreviewHeading />
          {body}
        </div>
      ) : (
        <Card size="sm" className="min-w-0 text-start">
          <CardContent className={BODY_CLASS}>{body}</CardContent>
        </Card>
      )}
    </section>
  );
}
export default PagePreviewFrame;
