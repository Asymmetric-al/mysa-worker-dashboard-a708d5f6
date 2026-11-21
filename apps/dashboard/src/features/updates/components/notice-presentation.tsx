/**
 * The one surface that shows a notification notice the way its recipient receives it: the sender, the
 * generic subject, the two renderings the server produced, the copy the message points at, and the
 * list of everything the message deliberately does not carry.
 */
import type { ReactElement } from "react";
import RenderedContent from "@/components/rendered-content";
import SimulationLabel from "@/components/simulation-label";
import StatusBadge, { type StatusTone } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import type { Notice, NoticeVideoPoster } from "@/modules/content/notice";
import { AUDIENCE_LABELS, SIMULATED_EFFECT_BY_TRIGGER } from "../copy/updates-copy";
// The payload, and the two facts a caller adds to it
type PinnedAudience = Notice["pinned"]["audience"];
/** The recipient the notice was produced for, as the caller knows them. */
export interface NoticeRecipientDisplay {
  readonly displayName?: string;
  readonly address?: string;
}
/** The admitted public poster of a public video placement, plus the facts the media read supplies about the edition behind it. */
export interface NoticePosterFacts {
  readonly admitted: NoticeVideoPoster;
  readonly alt?: string;
  readonly captionLanguages?: readonly string[];
  readonly transcriptAvailable?: boolean;
}
/** Props of {@link NoticePresentation}. */
export interface NoticePresentationProps {
  readonly notice: Notice;
  readonly recipient?: NoticeRecipientDisplay;
  readonly poster?: NoticePosterFacts;
  readonly className?: string;
}
// The wording this file owns: labels, tab names, omissions and the link statement
const AUDIENCE_TONES: Readonly<Record<PinnedAudience, StatusTone>> = {
  public: "neutral",
  "approved-supporter": "info",
};
const NOTICE_TAB_LABELS = {
  html: "HTML",
  plain: "Plain text",
} as const;
const TAB_LIST_LABEL = "Notice rendering";

const FIELD_LABELS = {
  from: "From",
  to: "To",
  subject: "Subject",
  language: "Message language",
  pinned: "Pinned copy",
  link: "Link target",
  revision: "revision",
} as const;
const ABSENCE_WORDING = {
  sender: "This notice carries no sending identity, so no sender can be shown.",
  recipientName: "No recipient name is attached to this notice.",
  link: "This notice carries no link, so there is nothing to open from it.",
} as const;
const MISSING_RENDERING = {
  html: "This notice carries no HTML rendering; the plain text below is the copy it carries.",
  plain: "This notice carries no plain-text alternative; the HTML above is the copy it carries.",
  both: "This notice carries neither an HTML rendering nor a plain-text alternative, so there is no copy here to inspect.",
  neitherReconstructed: "Nothing has been reconstructed to stand in for what is missing.",
} as const;
const OMISSIONS_HEADING = "What this notice does not carry";

const ACCESS_STATEMENT =
  "Opening the link checks the reader's current access at that moment, so access is decided where the " +
  "edition is served rather than taken from the message that carried it. The message itself confers " +
  "no access on whoever receives it.";
const CREDENTIAL_OMISSION =
  "No per-recipient credential of any kind: the message carries no bearer token, no signed or " +
  "personalised link and no tracking pixel, so nothing in it reports whether, when or by whom it was " +
  "opened, and following the link reveals nothing about anyone else.";
const PROTECTED_PROSE_OMISSION = "No protected prose: no title, no excerpt, no body text, no summary and no subject detail beyond the " + "generic subject the message states.";

const PUBLIC_PROSE_OMISSION = "No Update prose: the message carries its generic wording and a link, not the published body, so the " + "copy a reader reads is the edition at the link.";

const IMAGE_OMISSION = "No image at all: no portrait, no poster, no thumbnail and no embedded media, so nothing from the " + "edition is previewed here.";

const ADMITTED_POSTER_OMISSION = "No image other than the one admitted poster shown on this notice: no further picture, no thumbnail " + "and no embedded media travels with the message.";

const LOCATION_OMISSION = "No location: no address, region, map, coordinate or travel detail appears in the message.";

const TRANSCRIPT_OMISSION = "No transcript and no caption: neither the text of either nor the track file itself travels with the " + "message.";

const ANCILLARY_OMISSION = "No transcript and no caption text: the linked edition offers them, and both stay at the link rather " + "than travelling in the message.";

const HIDDEN_ALTERNATIVE_OMISSION =
  "No hidden alternative: no preview snippet, no alternative text describing protected content and no " + "subject line detail that would disclose something the body withholds.";
const HIDDEN_ALTERNATIVE_OMISSION_PUBLIC = "No hidden alternative: nothing about the edition travels beyond the wording the sender wrote and the " + "one poster the notice admits, if it admits one.";

const ATTACHMENT_OMISSION = "No attachment of any kind: no document, no calendar invitation, no archive and no second file.";

const POSTER_HEADING = "The poster this notice carries";

const POSTER_STATEMENT =
  "This is a still image from the video the linked edition carries. No player is embedded in the " +
  "notice, nothing starts on its own, and the video, its caption tracks and its transcript are served " +
  "only at the link.";
const POSTER_ALT_FALLBACK = "Poster image for the video in the linked edition";

const RENDERED_MESSAGE = cn(
  "min-w-0 text-sm leading-relaxed break-words [overflow-wrap:anywhere]",
  "[&_p]:mb-3 [&_p:last-child]:mb-0",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4",
  "[&_img]:my-3 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-lg",
);
const PANEL_CLASS = "rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring";

type NoticeDirection = Notice["pinned"]["locale"]["direction"];

interface NoticeBodies {
  readonly html: string;
  readonly text: string;
}
interface AdmittedPoster {
  readonly path: string;
  readonly alt: string;
  readonly captionLanguages?: readonly string[];
  readonly transcriptAvailable?: boolean;
}
// Reading the payload: one value at a time, one path check and one poster
function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
function servedPathOf(value: unknown): string | undefined {
  const path = textOf(value);
  if (!path.startsWith("/") || path.startsWith("//")) {
    return undefined;
  }
  return path;
}
function bodiesOf(notice: Notice): NoticeBodies {
  return { html: textOf(notice.htmlBody), text: textOf(notice.textBody) };
}
function admittedPosterOf(notice: Notice, facts: NoticePosterFacts | undefined): AdmittedPoster | undefined {
  if (facts === undefined) {
    return undefined;
  }
  const pinned = notice.pinned;
  if (pinned.audience !== "public") {
    return undefined;
  }
  const admitted = facts.admitted;
  if (admitted.purpose !== "poster" || !admitted.admittedPublic) {
    return undefined;
  }
  if (textOf(admitted.releaseId) !== textOf(pinned.releaseId)) {
    return undefined;
  }
  const path = servedPathOf(admitted.path);
  if (path === undefined) {
    return undefined;
  }
  const alt = textOf(facts.alt);
  const languages = (facts.captionLanguages ?? []).map((language) => textOf(language)).filter((language) => language.length > 0);
  return {
    path,
    alt: alt.length === 0 ? POSTER_ALT_FALLBACK : alt,
    captionLanguages: facts.captionLanguages === undefined ? undefined : languages,
    transcriptAvailable: facts.transcriptAvailable,
  };
}
function omissionItemsOf(input: { readonly protectedCopy: boolean; readonly posterShown: boolean; readonly ancillaryAvailable: boolean }): readonly string[] {
  return [
    input.protectedCopy ? PROTECTED_PROSE_OMISSION : PUBLIC_PROSE_OMISSION,
    input.posterShown ? ADMITTED_POSTER_OMISSION : IMAGE_OMISSION,
    LOCATION_OMISSION,
    input.ancillaryAvailable ? ANCILLARY_OMISSION : TRANSCRIPT_OMISSION,
    input.protectedCopy ? HIDDEN_ALTERNATIVE_OMISSION : HIDDEN_ALTERNATIVE_OMISSION_PUBLIC,
    ATTACHMENT_OMISSION,
    CREDENTIAL_OMISSION,
  ];
}
function MissingRendering({ which }: { readonly which: "html" | "plain" | "both" }): ReactElement {
  return (
    <Alert variant="default" role={undefined} data-notice-missing-rendering={which}>
      <AlertDescription>
        {MISSING_RENDERING[which]} {MISSING_RENDERING.neitherReconstructed}
      </AlertDescription>
    </Alert>
  );
}
interface MessageBodiesProps {
  readonly bodies: NoticeBodies;
  readonly direction: NoticeDirection;
  readonly lang?: string;
}
function MessageBodies({ bodies, direction, lang }: MessageBodiesProps): ReactElement {
  const hasHtml = bodies.html.length > 0;
  const hasText = bodies.text.length > 0;
  const htmlRendering = (
    // `bodies.html` is the string the server produced for this notice, handed on exactly as it
    // arrived; the reading styles above are all this file adds to it.
    <RenderedContent html={bodies.html} direction={direction} lang={lang} className={RENDERED_MESSAGE} />
  );
  const textRendering = <pre className="min-w-0 font-mono text-sm leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{bodies.text}</pre>;
  if (!hasHtml && !hasText) {
    return <MissingRendering which="both" />;
  }
  if (hasHtml && hasText) {
    return (
      <Tabs defaultValue="html">
        <TabsList aria-label={TAB_LIST_LABEL}>
          <TabsTrigger value="html">{NOTICE_TAB_LABELS.html}</TabsTrigger>
          <TabsTrigger value="plain">{NOTICE_TAB_LABELS.plain}</TabsTrigger>
        </TabsList>
        <div className="min-w-0" dir={direction} lang={lang}>
          <TabsContent value="html" className={PANEL_CLASS}>
            {htmlRendering}
          </TabsContent>
          <TabsContent value="plain" className={PANEL_CLASS}>
            {textRendering}
          </TabsContent>
        </div>
      </Tabs>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="min-w-0" dir={direction} lang={lang}>
        {hasHtml ? htmlRendering : textRendering}
      </div>
      <MissingRendering which={hasHtml ? "plain" : "html"} />
    </div>
  );
}
interface AdmittedPosterBlockProps {
  readonly poster: AdmittedPoster;
}
function AdmittedPosterBlock({ poster }: AdmittedPosterBlockProps): ReactElement {
  const languages = poster.captionLanguages ?? [];
  const captionFact = poster.captionLanguages !== undefined && languages.length === 0 ? "No caption track is recorded for the linked edition." : undefined;
  const transcriptFact =
    poster.transcriptAvailable === undefined ? undefined : poster.transcriptAvailable ? "A transcript is available at the linked edition." : "No transcript is recorded for the linked edition.";
  // The application serves every rendition itself: a media request re-authorises on the way out, so this
  // still is a plain image element pointing at the path the notice admitted. The image optimiser would
  // fetch and hold the picture outside that check, which is why it is not used here — and the notice's own
  // HTML body carries a plain image element for the same reason.
  const posterImage = (
    // oxlint-disable-next-line next/no-img-element
    <img src={poster.path} alt={poster.alt} loading="lazy" decoding="async" className="aspect-video w-full max-w-full rounded-lg bg-muted object-cover" />
  );
  return (
    <figure className="flex min-w-0 flex-col gap-2" data-slot="notice-poster">
      {posterImage}
      <figcaption className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{POSTER_HEADING}</span>
        <span className="break-words">{POSTER_STATEMENT}</span>
        {languages.length === 0 ? null : (
          <span className="break-words">
            {"Caption tracks at the linked edition are tagged "}
            {languages.map((language, index) => (
              <span key={language}>
                <bdi className="font-mono">{language}</bdi>
                {index === languages.length - 1 ? "." : ", "}
              </span>
            ))}
          </span>
        )}
        {captionFact === undefined ? null : <span>{captionFact}</span>}
        {transcriptFact === undefined ? null : <span>{transcriptFact}</span>}
      </figcaption>
    </figure>
  );
}
interface OmissionsBlockProps {
  readonly items: readonly string[];
  readonly hasLink: boolean;
}
function OmissionsBlock({ items, hasLink }: OmissionsBlockProps): ReactElement {
  return (
    <Alert variant="default" role={undefined} data-slot="notice-omissions">
      <AlertTitle>{OMISSIONS_HEADING}</AlertTitle>
      <AlertDescription>
        <ul className="flex list-disc flex-col gap-1 text-start ps-5">
          {items.map((item) => (
            <li key={item} className="break-words">
              {item}
            </li>
          ))}
        </ul>
        <p className="mt-3 break-words">{hasLink ? ACCESS_STATEMENT : ABSENCE_WORDING.link}</p>
      </AlertDescription>
    </Alert>
  );
}
// The surface: one notice, as its recipient receives it
/** Renders one notice as the recipient receives it: who it is from, what it is called, which pinned copy it points at, both of its renderings, the still a public video notice may carry, and. */
export default function NoticePresentation({ notice, recipient, poster, className }: NoticePresentationProps): ReactElement {
  const pinned = notice.pinned;
  const audience = AUDIENCE_LABELS[pinned.audience];
  const direction = pinned.locale.direction;
  const subject = textOf(notice.subject);
  const sender = textOf(notice.sender);
  const languageTag = textOf(pinned.locale.tag);
  const releaseId = textOf(pinned.releaseId);
  const revisionId = textOf(pinned.revisionId);
  const link = servedPathOf(notice.link);
  const bodies = bodiesOf(notice);
  const admittedPoster = admittedPosterOf(notice, poster);
  const protectedCopy = pinned.audience === "approved-supporter";
  const ancillaryAvailable = admittedPoster !== undefined && ((admittedPoster.captionLanguages?.length ?? 0) > 0 || admittedPoster.transcriptAvailable === true);
  const omissions = omissionItemsOf({
    protectedCopy,
    posterShown: admittedPoster !== undefined,
    ancillaryAvailable,
  });
  const accessibleName = subject.length === 0 ? undefined : `${subject} — ${audience.label}${languageTag.length === 0 ? "" : ` (${languageTag})`}`;
  const recipientName = textOf(recipient?.displayName);
  const recipientAddress = textOf(recipient?.address);
  const rendering = bodies.html.length > 0 && bodies.text.length > 0 ? "both" : bodies.html.length > 0 ? "html" : bodies.text.length > 0 ? "plain" : "none";
  const recipientLine =
    recipient === undefined ? null : (
      <span className="break-words">
        <span className="sr-only">{`${FIELD_LABELS.to}: `}</span>
        {recipientName.length === 0 && recipientAddress.length === 0 ? (
          ABSENCE_WORDING.recipientName
        ) : (
          <>
            {recipientName.length === 0 ? null : <bdi>{recipientName}</bdi>}
            {recipientAddress.length === 0 ? null : <bdi className={recipientName.length === 0 ? undefined : "ms-2"}>{recipientAddress}</bdi>}
          </>
        )}
      </span>
    );
  return (
    <article aria-label={accessibleName} dir={direction} data-slot="notice-presentation" data-notice-audience={pinned.audience} data-notice-rendering={rendering} className={cn("min-w-0", className)}>
      <Card>
        <CardHeader>
          <div className="flex min-w-0 flex-col gap-1">
            <CardDescription className="break-words">
              <span className="sr-only">{`${FIELD_LABELS.from}: `}</span>
              {sender.length === 0 ? ABSENCE_WORDING.sender : <bdi>{sender}</bdi>}
            </CardDescription>
            {subject.length === 0 ? null : (
              <CardTitle className="break-words">
                <span className="sr-only">{`${FIELD_LABELS.subject}: `}</span>
                <bdi>{subject}</bdi>
              </CardTitle>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge label={audience.label} tone={AUDIENCE_TONES[pinned.audience]} srPrefix="Audience" />
              {languageTag.length === 0 ? null : (
                <Badge variant="outline">
                  <span className="sr-only">{`${FIELD_LABELS.language}: `}</span>
                  <bdi>{languageTag}</bdi>
                </Badge>
              )}
            </div>
            <p className="text-xs break-words text-muted-foreground">{audience.whoReceives}</p>
          </div>
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {recipientLine}
            {releaseId.length === 0 ? null : (
              <span className="break-words">
                <span className="sr-only">{`${FIELD_LABELS.pinned}: `}</span>
                <bdi className="font-mono">{releaseId}</bdi>
                {revisionId.length === 0 ? null : (
                  <>
                    <span aria-hidden="true" className="mx-1">
                      ·
                    </span>
                    <span className="sr-only">{`${FIELD_LABELS.revision}: `}</span>
                    <bdi className="font-mono">{revisionId}</bdi>
                  </>
                )}
              </span>
            )}
            {link === undefined ? null : (
              <span className="break-words">
                <span className="sr-only">{`${FIELD_LABELS.link}: `}</span>
                <bdi className="font-mono">{link}</bdi>
              </span>
            )}
          </p>
        </CardHeader>
        <Separator />
        <CardContent className="flex min-w-0 flex-col gap-4">
          <SimulationLabel effect={SIMULATED_EFFECT_BY_TRIGGER.notify} />
          <MessageBodies bodies={bodies} direction={direction} lang={languageTag.length === 0 ? undefined : languageTag} />
          {admittedPoster === undefined ? null : <AdmittedPosterBlock poster={admittedPoster} />}
          <Separator />
          <OmissionsBlock items={omissions} hasLink={link !== undefined} />
        </CardContent>
      </Card>
    </article>
  );
}
