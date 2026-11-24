import type { ReactElement, ReactNode } from "react";
import LocaleSwitcher, { type LocaleEdition } from "@/components/locale-switcher";
import RenderedContent from "@/components/rendered-content";
import SimulationLabel from "@/components/simulation-label";
import { StateNotice, type NoticeHeadingLevel, type NoticeRetry } from "@/components/state-notice";
import { NOTICE_HEADING_TAG, nestedNoticeHeadingLevel } from "@/lib/notice-heading";
import StatusBadge from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import type { PreviewDenialReason } from "@/modules/content/preview";
import { AUDIENCE_LABELS, LOCALE_DISPLAY_NAMES, SIMULATED_EFFECT_BY_TRIGGER, UPDATE_KIND_LABELS, WITHDRAWAL_WORDING } from "../copy/updates-copy";
type PreviewDirection = "ltr" | "rtl";
export type PreviewSource = { readonly system: string; readonly reference: string };
export type PreviewRendition = { readonly renditionId: string; readonly purpose: string; readonly path: string };
export type PreviewPlacement = {
  readonly placementId: string;
  readonly kind: "image" | "video";
  readonly altText: string;
  readonly caption?: string | null;
  readonly state: "ready" | "unavailable";
  readonly reason?: { readonly label: string; readonly action?: string } | null;
  readonly renditions?: readonly PreviewRendition[];
};
export type PreviewAuthorised = {
  readonly status: "authorised";
  readonly variantId: string;
  readonly audience: keyof typeof AUDIENCE_LABELS;
  readonly locale: { readonly tag: string; readonly direction: PreviewDirection };
  readonly revision: { readonly revisionId: string };
  readonly renderedHtml: string;
  readonly placements: readonly PreviewPlacement[];
  readonly renditionIds: readonly string[];
  readonly inert: true;
  readonly givingAction: "none";
  readonly document?: { readonly kind: keyof typeof UPDATE_KIND_LABELS };
};
export type PreviewView =
  | { readonly status: "loading" }
  | PreviewAuthorised
  | { readonly status: "invalid"; readonly issues: readonly { readonly message: string }[] }
  | { readonly status: "denied"; readonly reason: PreviewDenialReason }
  | { readonly status: "unavailable"; readonly source?: PreviewSource; readonly guidance?: string };
export type PreviewFrameProps = {
  readonly preview: PreviewView;
  /** The language the surface asked this edition for, when it asked for one. It words a refusal and is never compared with the served language here: the read admits only the edition's own language. */ readonly requestedLocale?: string;
  /** The editions this reader may open, when the surface offers a language switch. Given none, the frame states the edition's language as a fact instead. */ readonly locales?: readonly LocaleEdition[];
  readonly onRequestLocale?: (tag: string) => void;
  /** A re-request of the same preview, offered by any notice whose state a second read could clear. */ readonly onRetry?: () => void | Promise<void>;
  readonly headingLevel?: NoticeHeadingLevel;
  readonly className?: string;
};
const PREVIEW_HEADING = "Preview";
/** The one type scale's heading utility for each level, so this surface's headings take the measure of the level they are given rather than one fixed size. */
const HEADING_SCALE: Readonly<Record<NoticeHeadingLevel, string>> = { 1: "type-page-title", 2: "type-section-title", 3: "type-subsection-title", 4: "type-group-title" };
const NOTE_CLASS = "min-w-0 type-supporting text-pretty wrap-anywhere";
const FIELD_LABELS = { revision: "Revision", language: "Language" } as const;
const RETRY_LABEL = "Try reading this preview again";
const DIRECTION_WORDS: Readonly<Record<PreviewDirection, string>> = { ltr: "left to right", rtl: "right to left" };
const INERT_STATEMENT =
  "This preview is inert. It cannot publish the edition, it cannot submit a notification to any recipient, it cannot subscribe a reader, and it cannot start giving. The read that authorised it offers no action of any kind, so nothing on this surface changes the edition, its audience or its giving destination.";
const MEDIA_HEADING = "Media in this preview";
const MEDIA_NOT_READY_TITLE: Readonly<Record<PreviewPlacement["kind"], string>> = { image: "This image is unavailable", video: "This video is unavailable" };
const PREVIEW_PROSE = cn(
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
function Heading({ level, className, children }: { readonly level: NoticeHeadingLevel; readonly className?: string; readonly children: ReactNode }): ReactElement {
  const Tag = NOTICE_HEADING_TAG[level];
  return <Tag className={cn(HEADING_SCALE[level], className)}>{children}</Tag>;
}
const IdentityPair = ({ label, children }: { readonly label: string; readonly children: ReactNode }): ReactElement => (
  <div className="flex min-w-0 items-baseline gap-1.5 wrap-anywhere">
    <dt>{label}</dt>
    <dd className="min-w-0">{children}</dd>
  </div>
);
function languageLabelOf(tag: string): string {
  const trimmed = tag.trim();
  if (trimmed.length === 0) return "";
  const base = (trimmed.split("-")[0] ?? "").toLowerCase();
  const name = LOCALE_DISPLAY_NAMES[trimmed] ?? LOCALE_DISPLAY_NAMES[base];
  return name === undefined ? trimmed : `${name} (${trimmed})`;
}
function servedPathOf(path: string): string | undefined {
  const trimmed = path.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return undefined;
  return trimmed;
}
const retryOf = (onRetry: (() => void | Promise<void>) | undefined, label: string): NoticeRetry | undefined => (onRetry === undefined ? undefined : { label, onClick: onRetry });
const sameTag = (left: string, right: string): boolean => left.trim().toLowerCase() === right.trim().toLowerCase();
type TranscriptLink = { readonly key: string; readonly href: string; readonly label: string };
function transcriptLinksOf(preview: PreviewAuthorised): readonly TranscriptLink[] {
  const admitted = new Set<string>(preview.renditionIds);
  return preview.placements.flatMap((placement) => {
    if (placement.state !== "ready" || placement.kind !== "video") return [];
    return (placement.renditions ?? []).flatMap((rendition): readonly TranscriptLink[] => {
      if (rendition.purpose !== "transcript" || !admitted.has(rendition.renditionId)) return [];
      const href = servedPathOf(rendition.path);
      return href === undefined ? [] : [{ key: `${placement.placementId}:${rendition.renditionId}`, href, label: ((placement: PreviewPlacement): string => (placement.altText.trim() === "" ? "the video in this revision" : placement.altText.trim()))(placement) }];
    });
  });
}
function unreadyDescriptionOf(placement: PreviewPlacement): string {
  const reason = placement.reason ?? null;
  const parts: string[] = [];
  const label = reason === null ? "" : reason.label.trim();
  const action = reason === null ? "" : (reason.action ?? "").trim();
  if (label.length === 0) {
    parts.push("The revision still names this placement and the source could not serve it, so it is stated as unavailable rather than omitted or replaced.");
  } else {
    parts.push(label);
    if (action.length > 0) parts.push(action);
  }
  parts.push("The revision's own text alternative stands in its place in the reading above, so nothing here substitutes a picture or a player for what is missing.");
  return parts.join(" ");
}
function MediaNotes({ preview, headingLevel, onRetry }: { readonly preview: PreviewAuthorised; readonly headingLevel: NoticeHeadingLevel; readonly onRetry: (() => void | Promise<void>) | undefined }): ReactElement | null {
  const transcripts = transcriptLinksOf(preview);
  const unready = preview.placements.filter((placement) => placement.state !== "ready");
  if (transcripts.length === 0 && unready.length === 0) return null;
  return (
    <section aria-label={MEDIA_HEADING} data-slot="preview-media" className="flex min-w-0 flex-col gap-3">
      <Heading {...{ level: headingLevel }}>{MEDIA_HEADING}</Heading>
      {transcripts.length === 0 ? null : (
        <div className="flex min-w-0 flex-col gap-1">
          <ul className="flex min-w-0 list-none flex-col gap-1 p-0 text-sm">
            {transcripts.map((transcript) => (
              <li key={transcript.key} className="min-w-0 wrap-anywhere">
                <a href={transcript.href} className="inline-flex min-h-6 items-center text-primary inline-link">
                  {"Read the transcript"} {"for"} <bdi>{transcript.label}</bdi>
                </a>
              </li>
            ))}
          </ul>
          <p className="min-w-0 text-xs text-muted-foreground text-pretty wrap-anywhere">{"Each transcript is the video's own admitted rendition, requested from the address this read named, and that request is authorised again when it is made."}</p>
        </div>
      )}
      {unready.map((placement) => (
        <StateNotice key={placement.placementId} kind="unavailable" title={MEDIA_NOT_READY_TITLE[placement.kind]} description={unreadyDescriptionOf(placement)} retry={retryOf(onRetry, "Try loading this media again")} headingLevel={nestedNoticeHeadingLevel(headingLevel)} />
      ))}
    </section>
  );
}
const LOADING = { title: "Reading this preview", description: "A preview is authorised per request, so nothing is shown until the read answers. An empty frame never stands in for one." } as const;
const NOT_ACKNOWLEDGED = { title: "This revision is not one this edition serves", description: "The preview was asked for a revision this edition does not stand on, so nothing is rendered in its place and no newer revision is substituted for it." } as const;
const LANGUAGE_ABSENT = { title: "Language unavailable", description: "The language requested is not the language this edition is written in, so nothing is rendered in its place: a preview never re-renders an edition into another language and never names a sibling edition to fall back to." } as const;
const UNRELEASED = { title: "This revision is not a readable release of this edition", description: "No readable release of this edition stands on the revision the preview acknowledged, so nothing is rendered in its place. A draft is not a publication, and a preview does not stand in for one." } as const;
const WITHDRAWN = { title: "This edition was withdrawn", description: `${WITHDRAWAL_WORDING.whatItDoes} ${WITHDRAWAL_WORDING.whatItDoesNotDo}` } as const;
const UNAVAILABLE = { title: "This preview could not be read", description: "The source behind this preview could not be read, so this surface reports the outage instead of an empty page or a newer revision." } as const;
const INVALID = { title: "This revision cannot be rendered", description: "The stored revision is not one the content profile can read, so nothing is shown in its place and no substitute is invented for it." } as const;
const EMPTY_BODY = { title: "This revision carries no readable content", description: "The acknowledged revision rendered to nothing, so there is no reading to show. Nothing has been substituted for what the revision does not carry." } as const;
type AuthorisedPreviewProps = {
  readonly preview: PreviewAuthorised;
  readonly requestedLocale: string | undefined;
  readonly headingLevel: NoticeHeadingLevel;
  readonly locales: readonly LocaleEdition[] | undefined;
  readonly onRequestLocale: ((tag: string) => void) | undefined;
  readonly onRetry: (() => void | Promise<void>) | undefined;
};
function AuthorisedPreview({ preview, requestedLocale, headingLevel, locales, onRequestLocale, onRetry }: AuthorisedPreviewProps): ReactElement {
  const audience = AUDIENCE_LABELS[preview.audience];
  const kindLabel = preview.document === undefined ? undefined : UPDATE_KIND_LABELS[preview.document.kind];
  const { tag, direction } = preview.locale;
  const requested = requestedLocale === undefined ? "" : requestedLocale.trim();
  const canSwitch = locales !== undefined && locales.length > 0 && onRequestLocale !== undefined && locales.some((edition) => sameTag(edition.tag, tag));
  const switcher = locales === undefined || onRequestLocale === undefined || !canSwitch ? undefined : <LocaleSwitcher locales={locales} requested={tag} served={tag} onRequest={onRequestLocale} label="Language of this edition" />;
  const body =
    preview.renderedHtml.trim().length === 0 ? (
      <StateNotice kind="empty" title={EMPTY_BODY.title} description={EMPTY_BODY.description} headingLevel={headingLevel} />
    ) : (
      <Card data-slot="preview-document" className="min-w-0">
        <CardContent className={PREVIEW_PROSE}>
          {/* The one renderer's output for the acknowledged revision, placed exactly as the read produced it. */}
          <RenderedContent html={preview.renderedHtml} direction={direction} lang={tag} slot="update-preview-body" />
        </CardContent>
      </Card>
    );
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <StatusBadge label={audience.label} tone={audience.tone} srPrefix="Audience" />
        {kindLabel === undefined ? null : <Badge variant="outline">{kindLabel}</Badge>}
      </div>
      <p className={NOTE_CLASS}>{audience.whoReceives}</p>
      <dl className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <IdentityPair label={FIELD_LABELS.revision}>
          <bdi className="mono-identifier wrap-anywhere">{preview.revision.revisionId}</bdi>
        </IdentityPair>
        {switcher === undefined ? (
          <IdentityPair label={FIELD_LABELS.language}>
            <bdi>{languageLabelOf(tag)}</bdi> <span>{`read ${DIRECTION_WORDS[direction]}.`}</span>
          </IdentityPair>
        ) : null}
      </dl>
      {switcher}
      <p className={NOTE_CLASS}>{"A preview shows an edition in the language it is written in and never re-renders it in another, so no fallback is disclosed or concealed here."}</p>
      {requested.length === 0 || sameTag(requested, tag) ? null : (
        <p className={NOTE_CLASS}>
          {"Requested "}
          <bdi>{languageLabelOf(requested)}</bdi>
          {" — this edition is written in "}
          <bdi>{languageLabelOf(tag)}</bdi>
          {", and that is the language shown here."}
        </p>
      )}
      <p className={NOTE_CLASS}>{"This is the exact revision this preview acknowledged: the markup below is the one renderer's output for it. A later draft edit cannot change what is shown here, and a preview never follows the edition forward to a newer revision."}</p>
      <Alert role={undefined} data-slot="preview-inert">
        <AlertDescription>{INERT_STATEMENT}</AlertDescription>
      </Alert>
      <SimulationLabel effect={SIMULATED_EFFECT_BY_TRIGGER.publish} />
      {body}
      <MediaNotes preview={preview} headingLevel={headingLevel} onRetry={onRetry} />
      <p className={NOTE_CLASS}>{"Every request this preview makes is authorised again when it is made, including each image, video, poster, caption track and transcript. A copied address or a switched language therefore admits nothing the reader could not already open."}</p>
    </div>
  );
}
function DenialPreview({ reason, requestedLocale, headingLevel, onRetry }: { readonly reason: PreviewDenialReason; readonly requestedLocale: string | undefined; readonly headingLevel: NoticeHeadingLevel; readonly onRetry: (() => void | Promise<void>) | undefined }): ReactElement {
  switch (reason) {
    case "not-authorised":
      return <StateNotice kind="denied" title={({ title: "This preview cannot be shown" } as const).title} headingLevel={headingLevel} />;
    case "revision-not-acknowledged":
      return <StateNotice kind="refused" title={NOT_ACKNOWLEDGED.title} description={NOT_ACKNOWLEDGED.description} headingLevel={headingLevel} />;
    case "locale-not-admitted":
      return <StateNotice kind="language-unavailable" title={languageAbsentTitle(requestedLocale)} description={LANGUAGE_ABSENT.description} headingLevel={headingLevel} />;
    case "unreleased":
      return <StateNotice kind="empty" title={UNRELEASED.title} description={UNRELEASED.description} headingLevel={headingLevel} />;
    case "withdrawn":
      return <StateNotice kind="empty" title={WITHDRAWN.title} description={WITHDRAWN.description} headingLevel={headingLevel} />;
    case "unavailable":
      return <StateNotice kind="unavailable" title={UNAVAILABLE.title} description={UNAVAILABLE.description} retry={retryOf(onRetry, RETRY_LABEL)} headingLevel={headingLevel} />;
  }
}
function languageAbsentTitle(requestedLocale: string | undefined): string {
  const requested = requestedLocale === undefined ? "" : requestedLocale.trim();
  if (requested.length === 0) return LANGUAGE_ABSENT.title;
  return `${LANGUAGE_ABSENT.title}: ${languageLabelOf(requested)}`;
}
function InvalidPreview({ issues, headingLevel, onRetry }: { readonly issues: readonly { readonly message: string }[]; readonly headingLevel: NoticeHeadingLevel; readonly onRetry: (() => void | Promise<void>) | undefined }): ReactElement {
  const messages = issues.map((issue) => issue.message.trim()).filter((message) => message.length > 0);
  const description = messages.length === 0 ? INVALID.description : `${INVALID.description} ${messages.join(" ")}`;
  return <StateNotice kind="refused" title={INVALID.title} description={description} retry={retryOf(onRetry, RETRY_LABEL)} headingLevel={headingLevel} />;
}
const UnavailablePreview = ({ source, guidance, headingLevel, onRetry }: { readonly source: PreviewSource | undefined; readonly guidance: string | undefined; readonly headingLevel: NoticeHeadingLevel; readonly onRetry: (() => void | Promise<void>) | undefined }): ReactElement => (
  <StateNotice kind="unavailable" title={UNAVAILABLE.title} description={guidance === undefined || guidance.trim() === "" ? UNAVAILABLE.description : guidance.trim()} source={source} retry={retryOf(onRetry, RETRY_LABEL)} headingLevel={headingLevel} />
);
type PreviewBodyProps = {
  readonly preview: PreviewView;
  readonly headingLevel: NoticeHeadingLevel;
  readonly requestedLocale: string | undefined;
  readonly locales: readonly LocaleEdition[] | undefined;
  readonly onRequestLocale: ((tag: string) => void) | undefined;
  readonly onRetry: (() => void | Promise<void>) | undefined;
};
function PreviewBody({ preview, headingLevel, requestedLocale, locales, onRequestLocale, onRetry }: PreviewBodyProps): ReactElement {
  switch (preview.status) {
    case "loading":
      return <StateNotice kind="loading" title={LOADING.title} description={LOADING.description} headingLevel={headingLevel} />;
    case "authorised":
      return <AuthorisedPreview preview={preview} requestedLocale={requestedLocale} headingLevel={headingLevel} locales={locales} onRequestLocale={onRequestLocale} onRetry={onRetry} />;
    case "invalid":
      return <InvalidPreview issues={preview.issues} headingLevel={headingLevel} onRetry={onRetry} />;
    case "denied":
      return <DenialPreview reason={preview.reason} requestedLocale={requestedLocale} headingLevel={headingLevel} onRetry={onRetry} />;
    case "unavailable":
      return <UnavailablePreview source={preview.source} guidance={preview.guidance} headingLevel={headingLevel} onRetry={onRetry} />;
    default: {
      const unhandled: never = preview;
      return unhandled;
    }
  }
}
export const PreviewFrame = ({ preview, requestedLocale, locales, onRequestLocale, onRetry, headingLevel = 2, className }: PreviewFrameProps): ReactElement => (
  <section
    aria-label={PREVIEW_HEADING}
    data-slot="preview-frame"
    data-preview-status={preview.status}
    data-preview-variant={preview.status === "authorised" ? preview.variantId : undefined}
    data-preview-revision={preview.status === "authorised" ? preview.revision.revisionId : undefined}
    data-preview-locale={preview.status === "authorised" ? preview.locale.tag : undefined}
    data-preview-direction={preview.status === "authorised" ? preview.locale.direction : undefined}
    className={cn("flex min-w-0 flex-col gap-4 text-start", className)}
  >
    <Heading {...{ level: headingLevel, className: "text-pretty" }}>{PREVIEW_HEADING}</Heading>
    <PreviewBody preview={preview} headingLevel={nestedNoticeHeadingLevel(headingLevel)} requestedLocale={requestedLocale} locales={locales} onRequestLocale={onRequestLocale} onRetry={onRetry} />
  </section>
);
export default PreviewFrame;
