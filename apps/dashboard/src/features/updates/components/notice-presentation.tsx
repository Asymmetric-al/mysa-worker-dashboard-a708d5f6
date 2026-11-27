import type { ReactElement } from "react";
import RenderedContent from "@/components/rendered-content";
import SimulationLabel from "@/components/simulation-label";
import StatusBadge, { type StatusTone } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DirectionProvider } from "@/components/ui/direction";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import type { Notice, NoticeVideoPoster } from "@/modules/content/notice";
import { AUDIENCE_LABELS, SIMULATED_EFFECT_BY_TRIGGER } from "../copy/updates-copy";
export type NoticeRecipientDisplay = { readonly displayName?: string; readonly address?: string };
export type NoticePosterFacts = { readonly admitted: NoticeVideoPoster; readonly alt?: string; readonly captionLanguages?: readonly string[]; readonly transcriptAvailable?: boolean };
export type NoticePresentationProps = { readonly notice: Notice; readonly recipient?: NoticeRecipientDisplay; readonly poster?: NoticePosterFacts; readonly className?: string };
const AUDIENCE_TONES: Readonly<Record<Notice["pinned"]["audience"], StatusTone>> = { public: "neutral", "approved-supporter": "info" };
const NOTICE_TAB_LABELS = { html: "HTML", plain: "Plain text" } as const;
const FIELD_LABELS = { from: "From", to: "To", subject: "Subject", language: "Language", pinned: "Pinned release", link: "Link", revision: "revision" } as const;
const ABSENCE_WORDING = { sender: "No sender specified.", recipientName: "No recipient attached.", link: "No link included." } as const;
const MISSING_RENDERING = {
  html: "No HTML version included — showing plain text below.",
  plain: "No plain-text version included — showing HTML above.",
  both: "No HTML or plain-text body is included in this message.",
  neitherReconstructed: "Nothing was synthesized in its place.",
} as const;
const RENDERED_MESSAGE = cn(
  "min-w-0 type-body break-words [overflow-wrap:anywhere]",
  "[&_p]:mb-3 [&_p:last-child]:mb-0",
  "[&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:type-section-title [&_h2:first-child]:mt-0",
  "[&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:type-subsection-title",
  "[&_h4]:mt-4 [&_h4]:mb-2 [&_h4]:type-group-title",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4",
  "[&_img]:my-3 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-lg",
);
const PANEL_CLASS = "rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring";
type NoticeBodies = { readonly html: string; readonly text: string };
type AdmittedPoster = { readonly path: string; readonly alt: string; readonly captionLanguages?: readonly string[]; readonly transcriptAvailable?: boolean };
const textOf = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const Fact = ({ label, value, absent, mono }: { readonly label: string; readonly value: string; readonly absent?: string; readonly mono?: boolean }): ReactElement => (
  <span className="break-words">
    <span className="sr-only">{label}</span>
    {value.length === 0 ? absent : <bdi className={mono === true ? "font-mono" : undefined}>{value}</bdi>}
  </span>
);
function servedPathOf(value: unknown): string | undefined {
  const path = textOf(value);
  if (!path.startsWith("/") || path.startsWith("//")) return undefined;
  return path;
}
function admittedPosterOf(notice: Notice, facts: NoticePosterFacts | undefined): AdmittedPoster | undefined {
  if (facts === undefined) return undefined;
  const pinned = notice.pinned;
  if (pinned.audience !== "public") return undefined;
  const admitted = facts.admitted;
  if (admitted.purpose !== "poster" || !admitted.admittedPublic) return undefined;
  if (textOf(admitted.releaseId) !== textOf(pinned.releaseId)) return undefined;
  const path = servedPathOf(admitted.path);
  if (path === undefined) return undefined;
  const alt = textOf(facts.alt);
  const languages = (facts.captionLanguages ?? []).map((language) => textOf(language)).filter((language) => language.length > 0);
  return { path, alt: alt.length === 0 ? "Poster image for the video in the linked edition" : alt, captionLanguages: facts.captionLanguages === undefined ? undefined : languages, transcriptAvailable: facts.transcriptAvailable };
}
const omissionItemsOf = (input: { readonly protectedCopy: boolean; readonly posterShown: boolean; readonly ancillaryAvailable: boolean }): readonly string[] => [
  input.protectedCopy ? "No protected text — no title, excerpt, body, or sensitive subject detail." : "No full update text — readers open the link to view the published update.",
  input.posterShown ? "No additional images beyond the single approved video poster shown above." : "No images or embedded media.",
  "No locations, addresses, maps, or travel details.",
  input.ancillaryAvailable ? "No transcripts or captions in the email — both stay on the linked update page." : "No transcripts or caption files.",
  "No hidden preview snippets or attachments.",
  "No personalised tracking links, bearer tokens, or open-tracking pixels.",
];
const MissingRendering = ({ which }: { readonly which: "html" | "plain" | "both" }): ReactElement => (
  <Alert variant="default" role={undefined} data-notice-missing-rendering={which}>
    <AlertDescription>
      {MISSING_RENDERING[which]} {MISSING_RENDERING.neitherReconstructed}
    </AlertDescription>
  </Alert>
);
function MessageBodies({ bodies, direction, lang }: { readonly bodies: NoticeBodies; readonly direction: Notice["pinned"]["locale"]["direction"]; readonly lang?: string }): ReactElement {
  const hasHtml = bodies.html.length > 0;
  const hasText = bodies.text.length > 0;
  const htmlRendering = <RenderedContent html={bodies.html} direction={direction} lang={lang} className={RENDERED_MESSAGE} />;
  const textRendering = <pre className="min-w-0 font-mono type-body whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{bodies.text}</pre>;
  if (!hasHtml && !hasText) return <MissingRendering which="both" />;
  if (hasHtml && hasText) {
    return (
      <Tabs defaultValue="html">
        <TabsList aria-label="Notice rendering">
          <TabsTrigger value="html">{NOTICE_TAB_LABELS.html}</TabsTrigger>
          <TabsTrigger value="plain">{NOTICE_TAB_LABELS.plain}</TabsTrigger>
        </TabsList>
        <DirectionProvider direction={direction}>
          <div className="min-w-0" dir={direction} lang={lang}>
            <TabsContent {...{ value: "html", className: PANEL_CLASS }}>{htmlRendering}</TabsContent>
            <TabsContent {...{ value: "plain", className: PANEL_CLASS }}>{textRendering}</TabsContent>
          </div>
        </DirectionProvider>
      </Tabs>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <DirectionProvider direction={direction}>
        <div {...{ className: "min-w-0", dir: direction, lang }}>{hasHtml ? htmlRendering : textRendering}</div>
      </DirectionProvider>
      <MissingRendering which={hasHtml ? "plain" : "html"} />
    </div>
  );
}
function AdmittedPosterBlock({ poster }: { readonly poster: AdmittedPoster }): ReactElement {
  const languages = poster.captionLanguages ?? [];
  const captionFact = poster.captionLanguages !== undefined && languages.length === 0 ? "No caption track is recorded for the linked edition." : undefined;
  const transcriptFact = poster.transcriptAvailable === undefined ? undefined : poster.transcriptAvailable ? "A transcript is available at the linked edition." : "No transcript is recorded for the linked edition.";
  // Served by this application, which re-authorises each media request on the way out; the image optimiser would fetch and hold it outside that check.
  // oxlint-disable-next-line next/no-img-element
  const posterImage = <img src={poster.path} alt={poster.alt} loading="lazy" decoding="async" className="aspect-video w-full max-w-full rounded-lg bg-muted object-cover" />;
  return (
    <figure className="flex min-w-0 flex-col gap-2" data-slot="notice-poster">
      {posterImage}
      <figcaption className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{"The poster this notice carries"}</span>
        <span className="break-words">{"This is a still image from the video the linked edition carries. No player is embedded in the notice, nothing starts on its own, and the video, its caption tracks and its transcript are served only at the link."}</span>
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
const OmissionsBlock = ({ items, hasLink }: { readonly items: readonly string[]; readonly hasLink: boolean }): ReactElement => (
  <Alert variant="default" role={undefined} data-slot="notice-omissions">
    <AlertTitle>{"Excluded from email for privacy"}</AlertTitle>
    <AlertDescription>
      <ul className="flex list-disc flex-col gap-1 text-start ps-5">
        {items.map((item) => (
          <li key={item} className="break-words">
            {item}
          </li>
        ))}
      </ul>
      <p className="mt-3 break-words">{hasLink ? "Opening the link checks the reader’s current access each time — the email itself never grants access." : ABSENCE_WORDING.link}</p>
    </AlertDescription>
  </Alert>
);
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
  const bodies = ((notice: Notice): NoticeBodies => ({ html: textOf(notice.htmlBody), text: textOf(notice.textBody) }))(notice);
  const admittedPoster = admittedPosterOf(notice, poster);
  const protectedCopy = pinned.audience === "approved-supporter";
  const ancillaryAvailable = admittedPoster !== undefined && ((admittedPoster.captionLanguages?.length ?? 0) > 0 || admittedPoster.transcriptAvailable === true);
  const omissions = omissionItemsOf({ protectedCopy, posterShown: admittedPoster !== undefined, ancillaryAvailable });
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
    <article aria-label={subject.length === 0 ? undefined : `${subject} — ${audience.label}${languageTag.length === 0 ? "" : ` (${languageTag})`}`} dir={direction} data-slot="notice-presentation" data-notice-audience={pinned.audience} data-notice-rendering={rendering} className={cn("min-w-0", className)}>
      <Card>
        <CardHeader>
          <div className="flex min-w-0 flex-col gap-1">
            <CardDescription className="break-words">
              <Fact label={`${FIELD_LABELS.from}: `} value={sender} absent={ABSENCE_WORDING.sender} />
            </CardDescription>
            {subject.length === 0 ? null : (
              <CardTitle className="break-words">
                <Fact label={`${FIELD_LABELS.subject}: `} value={subject} />
              </CardTitle>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge label={audience.label} tone={AUDIENCE_TONES[pinned.audience]} srPrefix="Audience" />
              {languageTag.length === 0 ? null : (
                <Badge variant="outline">
                  <Fact label={`${FIELD_LABELS.language}: `} value={languageTag} />
                </Badge>
              )}
            </div>
            <p className="text-xs break-words text-muted-foreground">{audience.whoReceives}</p>
          </div>
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {recipientLine}
            {releaseId.length === 0 ? null : (
              <span className="break-words">
                <Fact label={`${FIELD_LABELS.pinned}: `} value={releaseId} mono />
                {revisionId.length === 0 ? null : (
                  <>
                    <span {...{ "aria-hidden": "true", className: "mx-1" }}>·</span>
                    <Fact label={`${FIELD_LABELS.revision}: `} value={revisionId} mono />
                  </>
                )}
              </span>
            )}
            {link === undefined ? null : <Fact label={`${FIELD_LABELS.link}: `} value={link} mono />}
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
