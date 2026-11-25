import type { ReactElement, ReactNode } from "react";
import RenderedContent, { RENDERED_PROSE } from "@/components/rendered-content";
import { SimulationLabel } from "@/components/simulation-label";
import { StateNotice, type NoticeAction, type NoticeRetry } from "@/components/state-notice";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { ViewportPreviewStage } from "@/components/ui/viewport-preview-bar";
import { cn } from "@/lib/cn";
import type { SourceReference } from "@/lib/ids";
import type { PreviewDenialReason } from "@/modules/content/preview";
import { copy } from "../copy";
import { GivingDesignation, type GivingBindingView } from "./giving-designation";
export type PagePreviewUnreadyMedia = { readonly placementId: string; readonly kind: "image" | "video"; readonly altText: string; readonly caption: string | null; readonly reason: { readonly label: string; readonly action?: string } | null };
export type PagePreviewAuthorisedView = {
  readonly status: "authorised";
  readonly variantId: string;
  readonly revisionId: string;
  readonly servedLocale: string;
  readonly requestedLocale?: string;
  readonly direction: "ltr" | "rtl";
  readonly html: string;
  readonly unreadyMedia: readonly PagePreviewUnreadyMedia[];
  readonly inert: true;
  readonly givingAction: "none";
};
export type PagePreviewDeniedView = { readonly status: "denied"; readonly reason: string };
/** A preview of an edition that has been withdrawn: the withdrawal is the state this surface reports, so nothing here reads as a denial or a refusal of access. */ export type PagePreviewWithdrawnView = { readonly status: "withdrawn" };
/** A preview whose edition could not be read: the source that failed, named honestly. */ export type PagePreviewUnavailableView = { readonly status: "unavailable"; readonly source: SourceReference };
/** A preview whose own request was refused: the read answered, and the edition, revision or language asked for is not one it admits. */ export type PagePreviewRefusedView = { readonly status: "refused" };
/** A preview whose requested language no edition of this Page holds: the language asked for, and nothing about any other edition. */ export type PagePreviewLanguageUnavailableView = { readonly status: "language-unavailable"; readonly requestedLocale: string };
/** A preview whose edition has neither a draft nor a released revision, so there is nothing exact to render. */ export type PagePreviewUnreleasedView = { readonly status: "unreleased"; readonly locale: string };
export type PagePreviewView = PagePreviewAuthorisedView | PagePreviewDeniedView | PagePreviewWithdrawnView | PagePreviewUnavailableView | PagePreviewRefusedView | PagePreviewLanguageUnavailableView | PagePreviewUnreleasedView;
/** The one preview refusal that is not a denial: `withdrawn` states what happened to the edition, and the type above holds the domain's own reason so the two cannot drift apart. */ const WITHDRAWN_PREVIEW_REASON: PreviewDenialReason = "withdrawn";
/** The view a preview read's refusal maps to, in the builder and on the route alike: a withdrawn edition states its withdrawal, and every other reason stays the denial it is. */
export const previewRefusalViewOf = (reason: string): PagePreviewView => (reason === WITHDRAWN_PREVIEW_REASON ? { status: "withdrawn" } : { status: "denied", reason });
/** How a surface re-reads the preview it shows: an address that answers the same exact revision again, or the callback that re-runs the read the surface already holds. */ export type PagePreviewRetry = { readonly label: string; readonly href?: string; readonly onClick?: () => void };
export type PagePreviewFrameProps = { readonly layout: "builder" | "route"; readonly preview: PagePreviewView; readonly givingBinding?: GivingBindingView; readonly retry?: PagePreviewRetry; readonly className?: string };
const FIELD_LABELS = { revision: "Revision", requestedLanguage: "Language requested" } as const;
const PREVIEW_HEADING = copy.builder.preview;
const BODY_CLASS = "flex min-w-0 flex-col gap-4";
const NOTE_CLASS = "text-xs text-muted-foreground text-pretty wrap-anywhere";
const PreviewHeading = (): ReactElement => <h2 className={"type-section-title"}>{PREVIEW_HEADING}</h2>;
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
/** The one control a notice offers for reading this preview again: a link where the surface names the address that re-reads it, and an in-page action where it holds the read's own callback. */
function retryControlsOf(retry: PagePreviewRetry | undefined): { readonly action?: NoticeAction; readonly retry?: NoticeRetry } {
  return retry === undefined ? {} : retry.href !== undefined ? { action: { label: retry.label, href: retry.href } } : retry.onClick === undefined ? {} : { retry: { label: retry.label, onClick: retry.onClick } };
}
const UNREADY_MEDIA_TITLE: Readonly<Record<PagePreviewUnreadyMedia["kind"], string>> = copy.preview.unreadyMediaTitle;
function unreadyMediaDescriptionOf(placement: PagePreviewUnreadyMedia): string {
  const reason = placement.reason;
  const label = reason === null ? "" : reason.label.trim();
  const action = reason === null ? "" : (reason.action ?? "").trim();
  return [label.length === 0 ? copy.preview.unreadyMediaFallback : label, ...(action.length === 0 ? [] : [action]), copy.preview.unreadyMediaNote].join(" ");
}
/** Every placement this preview's rendering could not reach, stated one by one: an empty revision and a fully readable one both render nothing here, so the notice never stands in for media the revision does not place. */
function UnreadyMediaNotes({ placements, retry }: { readonly placements: readonly PagePreviewUnreadyMedia[]; readonly retry: PagePreviewRetry | undefined }): ReactElement | null {
  if (placements.length === 0) return null;
  return (
    <section aria-label={copy.preview.unreadyMediaHeading} data-slot="page-preview-media" className="flex min-w-0 flex-col gap-3">
      {placements.map((placement) => (
        <StateNotice key={placement.placementId} kind="unavailable" headingLevel={3} title={UNREADY_MEDIA_TITLE[placement.kind]} description={unreadyMediaDescriptionOf(placement)} {...retryControlsOf(retry)} />
      ))}
    </section>
  );
}
const AuthorisedPreview = ({ preview, layout, givingBinding, retry }: { readonly preview: PagePreviewAuthorisedView; readonly layout: PagePreviewFrameProps["layout"]; readonly givingBinding: GivingBindingView | undefined; readonly retry: PagePreviewRetry | undefined }): ReactElement => {
  const renderedBody = (
    <div className="flex min-w-0 flex-col gap-4">
      <RenderedContent html={preview.html} direction={preview.direction} lang={preview.servedLocale} slot="page-preview-content" className={RENDERED_PROSE} />
      <UnreadyMediaNotes placements={preview.unreadyMedia} retry={retry} />
      {givingBinding === undefined ? null : <GivingDesignation binding={givingBinding} layout="inline" />}
    </div>
  );
  return (
    <>
      <EditionIdentity preview={preview} layout={layout} />
      <Alert role={undefined} data-slot="page-preview-inert">
        <AlertDescription>{copy.preview.inertBanner}</AlertDescription>
      </Alert>
      {layout === "builder" ? (
        <ViewportPreviewStage revisionId={preview.revisionId} localeLabel={preview.servedLocale}>
          {renderedBody}
        </ViewportPreviewStage>
      ) : (
        renderedBody
      )}
      <p className={NOTE_CLASS}>{copy.preview.recheckedOnOpen}</p>
    </>
  );
};
function previewBody(preview: PagePreviewView, layout: PagePreviewFrameProps["layout"], givingBinding: GivingBindingView | undefined, retry: PagePreviewRetry | undefined): ReactElement {
  switch (preview.status) {
    case "authorised":
      return <AuthorisedPreview preview={preview} layout={layout} givingBinding={givingBinding} retry={retry} />;
    case "denied":
      return (
        <div data-slot="page-preview-denied" data-denial-reason={preview.reason}>
          <StateNotice kind="denied" title={copy.states.deniedTitle} headingLevel={3} />
        </div>
      );
    case "withdrawn":
      return (
        <div data-slot="page-preview-withdrawn">
          <StateNotice kind="empty" title={copy.preview.withdrawnTitle} description={copy.preview.withdrawnDescription} headingLevel={3} />
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
/** The exact, currently authorised, inert preview of one Page edition. */ export function PagePreviewFrame({ layout, preview, givingBinding, retry, className }: PagePreviewFrameProps): ReactElement {
  const body = previewBody(preview, layout, givingBinding, retry);
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
        <Card className="min-w-0 text-start">
          <CardContent className={BODY_CLASS}>{body}</CardContent>
        </Card>
      )}
    </section>
  );
}
export default PagePreviewFrame;
