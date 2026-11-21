/**
 * The one surface that shows a notification notice the way its recipient receives it: the sender,
 * the generic subject, the two renderings the server produced, the copy the message points at, and
 * the list of everything the message deliberately does not carry.
 *
 * Plan items that put this file in scope:
 * - AAP 0.8.5's notice rules, which are the whole contract held here: a protected notice is a minimal
 *   link-only message with a safe sender, subject and wording, holding no protected prose, image,
 *   location, poster, transcript, caption or hidden alternative; opening the link rechecks the
 *   reader's current access; a public video notice carries an admitted safe poster and a link and
 *   never an embedded player, autoplay or attachment.
 * - AAP 0.7.1's "Write and release an Update" job, whose notification submission produces exactly the
 *   artefact this file displays, and AAP 0.10.1 family 9, which retains it.
 * - Success criteria 10, 17 and 18: the rendered HTML and the plain-text alternative are both
 *   inspectable, a notice in a right-to-left locale reads right-to-left, and a public video notice
 *   shows a poster and a link with no player.
 *
 * What this file does and refuses to do:
 *
 * - It presents; it does not write. Every sentence of the message itself — the sender line, the
 *   subject, both bodies — arrives in the payload the server built, and this file inserts those
 *   strings unchanged. It authors no greeting, no body line, no subject and no footer, so there is
 *   nothing here that could disclose a title, an excerpt or a summary the message was never given.
 *   The words this file does own are the field labels, the two tab labels, the list of omissions and
 *   the statement about what follows the link; none of them describes the content behind it.
 * - One rendering site, no second renderer. The HTML is the string the content module produced on the
 *   server from the stored revision, handed to the browser exactly as it arrived. This file parses no
 *   content JSON, composes no markup from a document, escapes nothing the server escaped and adds no
 *   script, no authored inline style and no attribute of its own to that string. The inbox reader
 *   that the audience feature owns for its own surface stays that feature's; this one serves the
 *   notice payload, and no consumer should gain a second converter by using it.
 * - Identity is a value, never a key. The sender, the recipient and the pinned identities are
 *   direction-weak strings, so each is isolated in `<bdi>` instead of being allowed to reorder the
 *   line around it. Nothing here compares, parses or joins on any of them — the pin is displayed, not
 *   re-resolved, and no address is matched against a record.
 * - No claim about an outcome. Publication, submission, a sender's acceptance, delivery and reading
 *   are five separate facts, and this artefact states none of them: it is the message that was
 *   produced, and whether anything left the application, arrived or was read belongs to the send
 *   record the caller holds. The simulated submission is disclosed by `SimulationLabel`, whose
 *   sentence is the only wording in the application that says what did not happen.
 * - No network, no clock, no state. Nothing here fetches, reads the current instant or keeps a value
 *   between renders, so the same payload renders the same way on the server and in the browser and a
 *   replay can be compared with the original.
 *
 * Direction is content. The block carries `dir` from the pinned rendition's own locale — never a CSS
 * base direction and never an inference from a language's name — so a notice for a right-to-left
 * edition reads right-to-left with its labels, list and link in the same reading order. Mixed-
 * direction values inside it are isolated rather than reordered, and no bidirectionality control
 * character is written into any string.
 *
 * A poster is a still, never a player. When — and only when — the pinned copy is public and the caller
 * supplies the poster that `resolveRendition` admitted for it, this file renders that one image with a
 * text alternative and says what the notice does not do with it: nothing is embedded, nothing starts on
 * its own and nothing is attached. The video player belongs to the preview surface that plays a
 * released edition, not to a notice, so it is not composed here.
 *
 * Accessibility and layout: the root is an `<article>` named by the subject, the audience and the locale,
 * so three notices of one subject stay distinguishable in a landmark list; the two renderings are a real
 * tab pair a keyboard can switch; every control is a design-system component at or above the 24x24 CSS px
 * target floor; and state and audience words are always text rather than colour. Values wrap, so a long
 * address or identity cannot widen the page at 320 CSS px. The body is composed at its natural height
 * rather than inside a scroll box: a notice is a sentence and a link by rule, so a fixed-height region
 * would reserve several hundred CSS px of emptiness around a three-line message, and a second scroll
 * region nested in whatever panel a caller places this in is the trap the accessible-scrolling rules
 * warn about.
 *
 * Rule 1: family 9's notice presentation only — no provider client, sender integration, per-recipient
 * credential flow, webhook or deferred-owner surface; the shared surfaces are composed rather than
 * duplicated (`Tabs`, `Card`, `Alert`, `Badge`, `Separator`, `StatusBadge`, `SimulationLabel` and the
 * Updates copy module keep their single owners, and no second message renderer, badge or disclosure
 * pattern is introduced); and the meaning the specification fixes is preserved, because a notice stays
 * a link and a sentence, access stays a decision made at the link, and a simulated submission is
 * labelled as one by the component that owns that sentence.
 */

import type { ReactElement } from "react";

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

// ---------------------------------------------------------------------------------------------
// The payload, and the two facts a caller adds to it
// ---------------------------------------------------------------------------------------------

/**
 * The audience the notice was pinned for, taken from the pin rather than declared again, so the
 * content variant module stays the one place a third audience would have to be added.
 */
type PinnedAudience = Notice["pinned"]["audience"];

/**
 * The recipient the notice was produced for, as the caller knows them.
 *
 * Both members are display values. Neither is a key: an equal-looking name or address never establishes
 * which record, which consent or which membership a notice belongs to, and nothing here compares,
 * parses or resolves one. They are optional because a notice may be inspected before a recipient is
 * attached to it, and a caller that has neither renders the notice with no recipient line rather than
 * an invented one.
 */
export interface NoticeRecipientDisplay {
  /** The name the recipient is addressed by, when the caller holds one. */
  readonly displayName?: string;
  /** The address the notice was addressed to, as a value only. */
  readonly address?: string;
}

/**
 * The admitted public poster of a public video placement, plus the facts the media read supplies about
 * the edition behind it.
 *
 * `admitted` is the poster exactly as `resolveRendition` admitted it and `buildNotice` placed it, so its
 * `path` is used as given: this file builds no address and therefore cannot point a notice at anything
 * the media route would not re-authorise. The remaining members are what a reader may be told about the
 * linked edition — the poster's text alternative, the languages its caption tracks are in, and whether a
 * transcript exists — and never the content of any of them: a caption track and a transcript stay at the
 * link, because a notice carries no transcript and no caption.
 */
export interface NoticePosterFacts {
  /** The poster the notice admitted; its purpose, scope and release are checked before it is shown. */
  readonly admitted: NoticeVideoPoster;
  /** The text alternative the media read produced for this rendition, shown instead of the image. */
  readonly alt?: string;
  /** The BCP-47 tags of the caption tracks the linked edition carries, when the reader may be told. */
  readonly captionLanguages?: readonly string[];
  /** Whether the linked edition carries a transcript. */
  readonly transcriptAvailable?: boolean;
}

/** Props of {@link NoticePresentation}. */
export interface NoticePresentationProps {
  /**
   * The notice the server built for one recipient and one notification intent. Every sentence of the
   * message comes from here; nothing about the message is written in this file.
   */
  readonly notice: Notice;
  /** Who the notice was produced for, when the caller holds them. Displayed isolated, never parsed. */
  readonly recipient?: NoticeRecipientDisplay;
  /**
   * The admitted poster of a public video placement, when the caller holds it. It is shown only for a
   * public pin whose release matches the poster's own release; every other combination is ignored, so a
   * protected notice can never gain a poster through this prop.
   */
  readonly poster?: NoticePosterFacts;
  /** Layout classes for the surface that places the notice. Never a colour, radius or shadow. */
  readonly className?: string;
}

// ---------------------------------------------------------------------------------------------
// The wording this file owns: labels, tab names, omissions and the link statement
// ---------------------------------------------------------------------------------------------

/**
 * How each pinned audience reads, and the tone that word carries.
 *
 * The word itself comes from the Updates copy module, which is the family's own vocabulary for the two
 * variants; this record adds only the tone, and it is total over the closed audience union, so a third
 * audience fails to compile here instead of landing on a default tone.
 */
const AUDIENCE_TONES: Readonly<Record<PinnedAudience, StatusTone>> = {
  public: "neutral",
  "approved-supporter": "info",
};

/**
 * The names of the two renderings the notice carries, and the name of the pair.
 *
 * A message has exactly two forms and both are real: the HTML a reader's client would show and the
 * plain-text alternative of the same wording. The labels are plain nouns because they name a format, not
 * a state, and the pair carries a name of its own because several notices can sit on one screen.
 */
const NOTICE_TAB_LABELS = {
  html: "HTML",
  plain: "Plain text",
} as const;

/** The accessible name of the rendering switcher. */
const TAB_LIST_LABEL = "Notice rendering";

/**
 * The field labels of the header. They are the surface's own words about the payload's values, so no
 * label restates a value and none of them is ever the subject or the sender line itself.
 */
const FIELD_LABELS = {
  from: "From",
  to: "To",
  subject: "Subject",
  language: "Message language",
  pinned: "Pinned copy",
  link: "Link target",
  revision: "revision",
} as const;

/**
 * What the surface says when the payload states a fact it needs but holds no value for. Each sentence
 * names the absence instead of leaving a blank line that would read as an empty value.
 */
const ABSENCE_WORDING = {
  sender: "This notice carries no sending identity, so no sender can be shown.",
  recipientName: "No recipient name is attached to this notice.",
  link: "This notice carries no link, so there is nothing to open from it.",
} as const;

/**
 * What the surface says when a rendering is missing from the payload: which one is absent and that
 * nothing was reconstructed to stand in for it. A notice is inspected precisely because its two forms
 * are meant to say the same thing, so a missing form is stated rather than filled in.
 */
const MISSING_RENDERING = {
  html: "This notice carries no HTML rendering; the plain text below is the copy it carries.",
  plain: "This notice carries no plain-text alternative; the HTML above is the copy it carries.",
  both: "This notice carries neither an HTML rendering nor a plain-text alternative, so there is no copy here to inspect.",
  neitherReconstructed: "Nothing has been reconstructed to stand in for what is missing.",
} as const;

/** The heading over the list of everything a notice deliberately leaves out. */
const OMISSIONS_HEADING = "What this notice does not carry";

/**
 * The statement about the link, which is what keeps a notice from reading as an entitlement.
 *
 * Access is decided where the content is served, at the moment the link is followed, so the message is
 * never the authority for it — and a notice that reaches the wrong person opens nothing.
 */
const ACCESS_STATEMENT =
  "Opening the link checks the reader's current access at that moment, so access is decided where the " +
  "edition is served rather than taken from the message that carried it. The message itself confers " +
  "no access on whoever receives it.";

/**
 * The one sentence that denies a per-recipient credential and any report of opening.
 *
 * It is the only place in this file where either is named, and it names them to deny them: the link
 * identifies the edition, carries nothing that belongs to the person, and the message reports nothing
 * back about whether it was opened.
 */
const CREDENTIAL_OMISSION =
  "No per-recipient credential of any kind: the message carries no bearer token, no signed or " +
  "personalised link and no tracking pixel, so nothing in it reports whether, when or by whom it was " +
  "opened, and following the link reveals nothing about anyone else.";

/** The prose a protected notice omits: the absence that makes it a link rather than the Update. */
const PROTECTED_PROSE_OMISSION =
  "No protected prose: no title, no excerpt, no body text, no summary and no subject detail beyond the " +
  "generic subject the message states.";

/** The prose a public notice omits, stated as its own fact rather than as a weaker protection. */
const PUBLIC_PROSE_OMISSION =
  "No Update prose: the message carries its generic wording and a link, not the published body, so the " +
  "copy a reader reads is the edition at the link.";

/** The image a notice omits when no admitted poster travels with it. */
const IMAGE_OMISSION =
  "No image at all: no portrait, no poster, no thumbnail and no embedded media, so nothing from the " +
  "edition is previewed here.";

/** The image limit a public notice keeps: one admitted poster and nothing besides it. */
const ADMITTED_POSTER_OMISSION =
  "No image other than the one admitted poster shown on this notice: no further picture, no thumbnail " +
  "and no embedded media travels with the message.";

/** Where a person is: never in a notice. */
const LOCATION_OMISSION =
  "No location: no address, region, map, coordinate or travel detail appears in the message.";

/** The transcript and caption a notice omits when the linked edition carries neither. */
const TRANSCRIPT_OMISSION =
  "No transcript and no caption: neither the text of either nor the track file itself travels with the " +
  "message.";

/** The transcript and caption a notice omits even when the linked edition offers both. */
const ANCILLARY_OMISSION =
  "No transcript and no caption text: the linked edition offers them, and both stay at the link rather " +
  "than travelling in the message.";

/** The hidden alternative a protected notice omits, named item by item. */
const HIDDEN_ALTERNATIVE_OMISSION =
  "No hidden alternative: no preview snippet, no alternative text describing protected content and no " +
  "subject line detail that would disclose something the body withholds.";

/** The hidden alternative a public notice omits, whose limit is the admitted poster. */
const HIDDEN_ALTERNATIVE_OMISSION_PUBLIC =
  "No hidden alternative: nothing about the edition travels beyond the wording the sender wrote and the " +
  "one poster the notice admits, if it admits one.";

/** What is never attached to a notice, in any audience. */
const ATTACHMENT_OMISSION =
  "No attachment of any kind: no document, no calendar invitation, no archive and no second file.";

/** The heading over the poster a public video notice may carry. */
const POSTER_HEADING = "The poster this notice carries";

/**
 * What the poster is and what the notice does not do with it.
 *
 * A poster is a still image of one frame: the message names it and links to the edition, and the video
 * itself plays only inside the edition, after the reader's access has been checked there.
 */
const POSTER_STATEMENT =
  "This is a still image from the video the linked edition carries. No player is embedded in the " +
  "notice, nothing starts on its own, and the video, its caption tracks and its transcript are served " +
  "only at the link.";

/** The text alternative used when a caller supplies no usable one for an admitted poster. */
const POSTER_ALT_FALLBACK = "Poster image for the video in the linked edition";

/**
 * How the message's own markup reads inside the card.
 *
 * The server emits semantic markup with no classes of its own, so the reading styles for the few
 * elements a notice can contain live here, in the one component that displays it, rather than in a
 * second stylesheet or in per-caller class lists that would drift apart. Every value comes from the
 * design-system scale, links keep their underline so their meaning is not carried by colour alone,
 * and an image is bounded by the card so a wide poster cannot widen the page.
 */
const RENDERED_MESSAGE = cn(
  "min-w-0 text-sm leading-relaxed break-words [overflow-wrap:anywhere]",
  "[&_p]:mb-3 [&_p:last-child]:mb-0",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4",
  "[&_img]:my-3 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-lg",
);

/** The focus ring a panel carries so a keyboard reader can tell which rendering is in front of them. */
const PANEL_CLASS = "rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring";

/** The direction a notice is written in, taken from the pin rather than declared a second time. */
type NoticeDirection = Notice["pinned"]["locale"]["direction"];

/** The two renderings a notice can carry, each trimmed of the whitespace that would make it look absent. */
interface NoticeBodies {
  readonly html: string;
  readonly text: string;
}

/** An admitted poster, once the payload and the caller's facts have both been read and checked. */
interface AdmittedPoster {
  /** The served path, used exactly as the notice admitted it. */
  readonly path: string;
  /** The text alternative to use; never blank, because a still carries meaning here. */
  readonly alt: string;
  /** The caption-track languages the caller stated, or `undefined` when it stated none. */
  readonly captionLanguages?: readonly string[];
  /** Whether a transcript exists, or `undefined` when the caller stated nothing. */
  readonly transcriptAvailable?: boolean;
}

// ---------------------------------------------------------------------------------------------
// Reading the payload: one value at a time, one path check and one poster
// ---------------------------------------------------------------------------------------------

/**
 * Reads one string, trimmed, answering a blank string for anything that is not a usable string.
 *
 * A payload read back from storage can carry a member the type promises and the value does not, so every
 * value this surface displays passes through here rather than being trusted on the strength of its type.
 */
function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The path a notice may point at or show, or `undefined` when it is not one this application serves.
 *
 * Only a same-origin path qualifies. The notice's own builder already refused anything else, and this
 * check is defence in depth rather than a second decision: a caller assembling a poster by hand cannot
 * turn the presentation into a pointer at another origin, and no address is constructed here.
 */
function servedPathOf(value: unknown): string | undefined {
  const path = textOf(value);
  if (!path.startsWith("/") || path.startsWith("//")) {
    return undefined;
  }
  return path;
}

/** The two renderings of one notice, each trimmed so a whitespace-only body reads as absent. */
function bodiesOf(notice: Notice): NoticeBodies {
  return { html: textOf(notice.htmlBody), text: textOf(notice.textBody) };
}

/**
 * The poster this notice may show, or `undefined` when any condition fails.
 *
 * The conditions are the notice rule's own, re-checked at the presentation boundary: the pinned copy
 * must be public, the rendition must be a poster admitted for public reading, it must belong to the
 * pinned release, and its path must be one this application serves. A protected pin can therefore never
 * gain a poster through this prop, whatever a caller passes.
 */
function admittedPosterOf(
  notice: Notice,
  facts: NoticePosterFacts | undefined,
): AdmittedPoster | undefined {
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
  const languages = (facts.captionLanguages ?? [])
    .map((language) => textOf(language))
    .filter((language) => language.length > 0);

  return {
    path,
    alt: alt.length === 0 ? POSTER_ALT_FALLBACK : alt,
    captionLanguages: facts.captionLanguages === undefined ? undefined : languages,
    transcriptAvailable: facts.transcriptAvailable,
  };
}

/**
 * Everything the notice leaves out, as one list, with the members whose wording depends on the audience
 * and on what the message actually admits.
 *
 * The list is the surface's own statement about the message, so it names each omission rather than
 * implying it: a reader can confirm that no protected prose, image, location, transcript, caption,
 * hidden alternative or attachment travels with a notice, and that nothing in it reports an opening.
 */
function omissionItemsOf(input: {
  readonly protectedCopy: boolean;
  readonly posterShown: boolean;
  readonly ancillaryAvailable: boolean;
}): readonly string[] {
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

/**
 * What the surface says when one rendering is absent: which one, and that nothing was reconstructed.
 *
 * It is an explanation rather than an alarm, so it takes the informational variant and passes
 * `role={undefined}`, because a static statement about a payload is not something to announce on every
 * render.
 */
function MissingRendering({ which }: { readonly which: "html" | "plain" | "both" }): ReactElement {
  return (
    <Alert variant="default" role={undefined} data-notice-missing-rendering={which}>
      <AlertDescription>
        {MISSING_RENDERING[which]} {MISSING_RENDERING.neitherReconstructed}
      </AlertDescription>
    </Alert>
  );
}

/** Props of {@link MessageBodies}. */
interface MessageBodiesProps {
  readonly bodies: NoticeBodies;
  readonly direction: NoticeDirection;
}

/**
 * The two renderings of one notice, as a tab pair where both exist and as the one that exists where only
 * one does.
 *
 * The HTML is the server's string inserted once and unchanged: this is the single raw-markup site in the
 * file, and its contract is narrow — the string comes from the message builder, is never constructed,
 * concatenated, escaped or repaired here, and therefore carries no script, no embed and no arbitrary
 * markup. The plain text is the message's own alternative with its line breaks intact, so a reader who
 * takes only that view loses no wording. Neither view is ever left empty: a missing one is named.
 */
function MessageBodies({ bodies, direction }: MessageBodiesProps): ReactElement {
  const hasHtml = bodies.html.length > 0;
  const hasText = bodies.text.length > 0;

  const htmlRendering = (
    <div
      // The one raw-markup site in this file. `bodies.html` is the string the server produced for this
      // notice; it is inserted exactly as it arrived, so the reading styles above are all this file adds.
      dangerouslySetInnerHTML={{ __html: bodies.html }}
      className={RENDERED_MESSAGE}
    />
  );

  const textRendering = (
    <pre className="min-w-0 font-mono text-sm leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
      {bodies.text}
    </pre>
  );

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
        <div className="min-w-0" dir={direction}>
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
      <div className="min-w-0" dir={direction}>
        {hasHtml ? htmlRendering : textRendering}
      </div>
      <MissingRendering which={hasHtml ? "plain" : "html"} />
    </div>
  );
}

/** Props of {@link AdmittedPosterBlock}. */
interface AdmittedPosterBlockProps {
  readonly poster: AdmittedPoster;
}

/**
 * The one still a public video notice may carry, with the facts a reader may be told about the edition
 * behind it and nothing of that edition's own text.
 *
 * The image is bounded by its container and reserves its own box through an aspect ratio, so a wide
 * poster neither widens the page at 320 CSS px nor shifts the layout around it as it loads. The caption
 * states what the notice does with the poster — nothing plays here — and, where the caller stated them,
 * which caption languages the linked edition offers and whether it carries a transcript: both stay at the
 * link, because a notice carries no transcript and no caption.
 */
function AdmittedPosterBlock({ poster }: AdmittedPosterBlockProps): ReactElement {
  const languages = poster.captionLanguages ?? [];
  const captionFact =
    poster.captionLanguages !== undefined && languages.length === 0
      ? "No caption track is recorded for the linked edition."
      : undefined;
  const transcriptFact =
    poster.transcriptAvailable === undefined
      ? undefined
      : poster.transcriptAvailable
        ? "A transcript is available at the linked edition."
        : "No transcript is recorded for the linked edition.";

  // The application serves every rendition itself: a media request re-authorises on the way out, so this
  // still is a plain image element pointing at the path the notice admitted. The image optimiser would
  // fetch and hold the picture outside that check, which is why it is not used here — and the notice's own
  // HTML body carries a plain image element for the same reason.
  const posterImage = (
    // oxlint-disable-next-line next/no-img-element
    <img
      src={poster.path}
      alt={poster.alt}
      loading="lazy"
      decoding="async"
      className="aspect-video w-full max-w-full rounded-lg bg-muted object-cover"
    />
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

/** Props of {@link OmissionsBlock}. */
interface OmissionsBlockProps {
  /** The omissions this notice makes, in the order a reader should check them. */
  readonly items: readonly string[];
  /** Whether the message carries a link to follow, which decides what can be said about opening one. */
  readonly hasLink: boolean;
}

/**
 * What the notice deliberately leaves out, and what happens when its link is opened.
 *
 * The list is visible rather than implied, because the absence is the notice's design: a reader who can
 * see exactly what was withheld can tell a minimal message from an incomplete one, while a surface that
 * rendered an empty frame would leave the two indistinguishable. It is static text, so it takes the
 * informational variant and passes `role={undefined}` instead of announcing itself on every render.
 */
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

// ---------------------------------------------------------------------------------------------
// The surface: one notice, as its recipient receives it
// ---------------------------------------------------------------------------------------------

/**
 * Renders one notice as the recipient receives it: who it is from, what it is called, which pinned copy
 * it points at, both of its renderings, the still a public video notice may carry, and the list of what
 * it deliberately leaves out.
 *
 * Nothing about the message is written here. The sender line, the subject and both bodies arrive in the
 * payload and are inserted unchanged, so the surface cannot disclose a title, an excerpt or a summary the
 * message was never given, and it cannot drift from the message the inbox holds. The words it does hold —
 * field labels, tab labels, the omissions list and the statement about the link — describe the message or
 * its absences and never describe the content behind the link.
 *
 * Publication, submission, acceptance, delivery and reading stay five separate facts: this renders the
 * artefact a submission produced and captions none of them as an outcome, while `SimulationLabel` states,
 * in the one wording the application owns for it, that the submission itself is simulated.
 *
 * The block carries the pinned locale's own direction, so a right-to-left notice reads right-to-left, and
 * every supplied value of unknown direction is isolated rather than allowed to reorder the line around it.
 * The function is pure: no clock, no network, no state and no identifier generated, so a replay of the same
 * payload renders identically.
 */
export default function NoticePresentation({
  notice,
  recipient,
  poster,
  className,
}: NoticePresentationProps): ReactElement {
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
  const ancillaryAvailable =
    admittedPoster !== undefined &&
    ((admittedPoster.captionLanguages?.length ?? 0) > 0 ||
      admittedPoster.transcriptAvailable === true);
  const omissions = omissionItemsOf({
    protectedCopy,
    posterShown: admittedPoster !== undefined,
    ancillaryAvailable,
  });

  const accessibleName =
    subject.length === 0
      ? undefined
      : `${subject} — ${audience.label}${languageTag.length === 0 ? "" : ` (${languageTag})`}`;
  const recipientName = textOf(recipient?.displayName);
  const recipientAddress = textOf(recipient?.address);
  const rendering =
    bodies.html.length > 0 && bodies.text.length > 0
      ? "both"
      : bodies.html.length > 0
        ? "html"
        : bodies.text.length > 0
          ? "plain"
          : "none";

  const recipientLine =
    recipient === undefined ? null : (
      <span className="break-words">
        <span className="sr-only">{`${FIELD_LABELS.to}: `}</span>
        {recipientName.length === 0 && recipientAddress.length === 0 ? (
          ABSENCE_WORDING.recipientName
        ) : (
          <>
            {recipientName.length === 0 ? null : <bdi>{recipientName}</bdi>}
            {recipientAddress.length === 0 ? null : (
              <bdi className={recipientName.length === 0 ? undefined : "ms-2"}>
                {recipientAddress}
              </bdi>
            )}
          </>
        )}
      </span>
    );

  return (
    <article
      aria-label={accessibleName}
      dir={direction}
      data-slot="notice-presentation"
      data-notice-audience={pinned.audience}
      data-notice-rendering={rendering}
      className={cn("min-w-0", className)}
    >
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
              <StatusBadge
                label={audience.label}
                tone={AUDIENCE_TONES[pinned.audience]}
                srPrefix="Audience"
              />
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
          <MessageBodies bodies={bodies} direction={direction} />
          {admittedPoster === undefined ? null : <AdmittedPosterBlock poster={admittedPoster} />}
          <Separator />
          <OmissionsBlock items={omissions} hasLink={link !== undefined} />
        </CardContent>
      </Card>
    </article>
  );
}
