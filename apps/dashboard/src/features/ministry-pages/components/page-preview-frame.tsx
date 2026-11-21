/**
 * The one exact, currently authorised, inert preview of a Page edition.
 */
import type { ReactElement, ReactNode } from "react";
import RenderedContent from "@/components/rendered-content";
import { SimulationLabel } from "@/components/simulation-label";
import { StateNotice } from "@/components/state-notice";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import type { SourceReference } from "@/lib/ids";
import { copy } from "../copy";
import { GivingDesignation, type GivingBindingView } from "./giving-designation";
// What a preview read hands this surface
/** A preview that may be rendered: the exact revision, the language and direction it is read in, and the markup the single renderer produced. */
export interface PagePreviewAuthorisedView {
  readonly status: "authorised";
  readonly variantId: string;
  readonly revisionId: string;
  readonly servedLocale: string;
  readonly requestedLocale?: string;
  readonly direction: "ltr" | "rtl";
  readonly html: string;
  readonly inert: true;
  readonly givingAction: "none";
}
/** A preview that may not be rendered: one reason code and nothing else. */
export interface PagePreviewDeniedView {
  readonly status: "denied";
  readonly reason: string;
}
/** A preview whose edition could not be read: the source that failed, named honestly. */
export interface PagePreviewUnavailableView {
  readonly status: "unavailable";
  readonly source: SourceReference;
}
/** A preview whose requested language no edition of this Page holds: the language asked for, and nothing about any other edition. */
export interface PagePreviewLanguageUnavailableView {
  readonly status: "language-unavailable";
  readonly requestedLocale: string;
}
/** A preview whose edition has neither a draft nor a released revision, so there is nothing exact to render. */
export interface PagePreviewUnreleasedView {
  readonly status: "unreleased";
  readonly locale: string;
}
/** Every answer this surface renders. */
export type PagePreviewView = PagePreviewAuthorisedView | PagePreviewDeniedView | PagePreviewUnavailableView | PagePreviewLanguageUnavailableView | PagePreviewUnreleasedView;
/** Props of {@link PagePreviewFrame}. */
export interface PagePreviewFrameProps {
  readonly layout: "builder" | "route";
  readonly preview: PagePreviewView;
  readonly givingBinding?: GivingBindingView;
  readonly className?: string;
}
// The few words this surface owns
const FIELD_LABELS = {
  revision: "Revision",
  requestedLanguage: "Language requested",
} as const;
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
const FRAME_CLASS = "flex min-w-0 flex-col gap-3 text-start";

const BODY_CLASS = "flex min-w-0 flex-col gap-4";

const HEADING_CLASS: Readonly<Record<PagePreviewFrameProps["layout"], string>> = {
  builder: "font-heading text-base font-medium",
  route: "font-heading text-lg font-medium",
};
const IDENTITY_CLASS = "flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted-foreground";

const IDENTITY_PAIR_CLASS = "flex items-baseline gap-1.5";

const NOTE_CLASS = "text-xs text-muted-foreground text-pretty wrap-anywhere";

function PreviewHeading({ layout }: { readonly layout: PagePreviewFrameProps["layout"] }): ReactElement {
  return <h2 className={HEADING_CLASS[layout]}>{PREVIEW_HEADING}</h2>;
}
function IdentityPair({ label, children }: { readonly label: string; readonly children: ReactNode }): ReactElement {
  return (
    <div className={IDENTITY_PAIR_CLASS}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
// The edition identity
function EditionIdentity({ preview, layout }: { readonly preview: PagePreviewAuthorisedView; readonly layout: PagePreviewFrameProps["layout"] }): ReactElement {
  const requested = preview.requestedLocale?.trim() ?? "";
  const fallback = requested.length > 0 && requested !== preview.servedLocale;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <dl className={IDENTITY_CLASS}>
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
// The five answers
function AuthorisedPreview({
  preview,
  layout,
  givingBinding,
}: {
  readonly preview: PagePreviewAuthorisedView;
  readonly layout: PagePreviewFrameProps["layout"];
  readonly givingBinding: GivingBindingView | undefined;
}): ReactElement {
  return (
    <>
      <EditionIdentity preview={preview} layout={layout} />
      <Alert role={undefined} data-slot="page-preview-inert">
        <AlertDescription>{copy.preview.inertBanner}</AlertDescription>
      </Alert>
      {/* `preview.html` is the one renderer's output for the pinned revision, placed unchanged. It already places
          each image and video once, with the poster, caption track and figcaption the revision carries, so this
          surface adds no player of its own: a second one would stream the same rendition twice and state the
          edition's media twice. */}
      <RenderedContent html={preview.html} direction={preview.direction} lang={preview.servedLocale} slot="page-preview-content" className={PREVIEW_CONTENT} />
      {givingBinding === undefined ? null : <GivingDesignation binding={givingBinding} layout="inline" />}
      <p className={NOTE_CLASS}>{copy.preview.recheckedOnOpen}</p>
    </>
  );
}
function DeniedPreview({ preview }: { readonly preview: PagePreviewDeniedView }): ReactElement {
  return (
    <div data-slot="page-preview-denied" data-denial-reason={preview.reason}>
      <StateNotice kind="denied" title={copy.states.deniedTitle} headingLevel={3} />
    </div>
  );
}
function UnavailablePreview({ preview }: { readonly preview: PagePreviewUnavailableView }): ReactElement {
  return <StateNotice kind="unavailable" title={copy.states.unavailableTitle} source={preview.source} headingLevel={3} />;
}
// The requested language travels in the marker and in no prose, and no edition that exists is named or
// counted: which other languages this Page holds is not something this answer discloses.
function LanguageUnavailablePreview({ preview }: { readonly preview: PagePreviewLanguageUnavailableView }): ReactElement {
  return (
    <div data-slot="page-preview-language-unavailable" data-requested-locale={preview.requestedLocale}>
      <StateNotice kind="language-unavailable" title={copy.editions.languageUnavailable} headingLevel={3} />
    </div>
  );
}
// An edition with nothing to render is stated as that, never as a refusal and never as an empty page: the
// words say what is absent so no reader supplies a substitute of their own.
function UnreleasedPreview({ preview }: { readonly preview: PagePreviewUnreleasedView }): ReactElement {
  return (
    <div data-slot="page-preview-unreleased" data-edition-locale={preview.locale}>
      <StateNotice kind="empty" title={copy.editions.unreleasedTitle} description={copy.editions.unreleasedDescription} headingLevel={3} />
    </div>
  );
}
function previewBody(preview: PagePreviewView, layout: PagePreviewFrameProps["layout"], givingBinding: GivingBindingView | undefined): ReactElement {
  switch (preview.status) {
    case "authorised":
      return <AuthorisedPreview preview={preview} layout={layout} givingBinding={givingBinding} />;
    case "denied":
      return <DeniedPreview preview={preview} />;
    case "unavailable":
      return <UnavailablePreview preview={preview} />;
    case "language-unavailable":
      return <LanguageUnavailablePreview preview={preview} />;
    case "unreleased":
      return <UnreleasedPreview preview={preview} />;
    default: {
      const unhandled: never = preview;
      return unhandled;
    }
  }
}
/** The exact, currently authorised, inert preview of one Page edition. */
export function PagePreviewFrame({ layout, preview, givingBinding, className }: PagePreviewFrameProps): ReactElement {
  const body = previewBody(preview, layout, givingBinding);
  return (
    <section data-slot="page-preview-frame" data-layout={layout} data-preview-status={preview.status} aria-label={PREVIEW_HEADING} className={cn(FRAME_CLASS, className)}>
      {layout === "builder" ? (
        <Card size="sm" className="min-w-0 text-start">
          <CardHeader>
            <PreviewHeading layout={layout} />
          </CardHeader>
          <CardContent className={BODY_CLASS}>{body}</CardContent>
        </Card>
      ) : (
        <div className={BODY_CLASS}>
          <PreviewHeading layout={layout} />
          {body}
        </div>
      )}
    </section>
  );
}
export default PagePreviewFrame;
