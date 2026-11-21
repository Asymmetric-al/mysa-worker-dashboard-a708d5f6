/**
 * The one exact, currently authorised, inert preview of a Page edition.
 *
 * A preview answers one question — what would a reader of this edition actually meet — and it answers
 * it without doing anything: it releases nothing, sends no notice, subscribes nobody and starts no
 * payment. That is why the whole surface is a function of its props, holds no state, fetches nothing,
 * reads no clock and carries no `use client` boundary: there is nothing here to operate.
 *
 * What it shows, and where each fact comes from:
 *
 * - The body is the markup the read already produced. The single content renderer for this
 *   application runs on the server, is handed the pinned revision and its placements, and hands back
 *   one HTML string, which this component passes unchanged to `components/rendered-content`, the
 *   application's single rendering boundary. It never builds, concatenates, parses or repairs
 *   markup, and it imports no renderer, editor, media or service module — the boundary is the props
 *   below.
 * - The edition is named by the language it serves and by the exact revision it renders, so the
 *   preview is provably of the frozen revision rather than of whatever the draft is now. A fallback is
 *   stated as a fallback: the requested language and the language actually shown are both named, in
 *   the family's own words, so a reader is never led to believe the edition is in a language it is not.
 * - Direction is a property of the content, so `dir` sits on the block that holds the rendered
 *   edition and comes from the read. Media are never mirrored: a flipped picture is a different
 *   picture, and a caption that describes position would be wrong.
 * - Playback goes through the application's one video surface (`@/components/video-player`), which is
 *   passed the scoped rendition addresses the read supplied. This file builds no media address, asks
 *   for no original, adds no download attribute and substitutes no placeholder of its own: where a
 *   read resolved no playable address, the exact markup already carries the placement and no second,
 *   empty player is invented beside it.
 * - The inert statement sits at the top of the preview in both layouts, and the Give placement below
 *   it is the one approved Designation — or the honest statement that giving is unavailable here —
 *   rendered by the placement's own component. No amount, total, percentage or progress is computed,
 *   formatted or implied anywhere in this file, so nothing shown can be mistaken for a figure the
 *   finance owner would have to stand behind.
 * - A refusal is a refusal and reveals nothing: no title, excerpt, count, language list, identifier or
 *   existence hint reaches the page, because the answer is identical whether or not a draft exists. An
 *   unreadable source names the source and never renders as an empty frame that would read as "there
 *   is no content".
 *
 * `layout` changes chrome only — a compact card in the builder's side pane, a full-width region on the
 * preview route. The content, its order, its heading levels and its honesty are identical in both, and
 * the region carries one level-2 heading because the route owns the page's single level-1 heading.
 *
 * Composition, never a second pattern (Rule 1 clause 2; AAP 0.3.4): the notice is `StateNotice`, the
 * player is `VideoPlayer`, the placement is `GivingDesignation`, the simulated effect is
 * `SimulationLabel`, the chrome is the design system's `Card` and `Alert`, and every sentence is a leaf
 * of `../copy`. No sentence is worded here, so an assertion on those words reads the family's single
 * source of them.
 *
 * Scope: AAP 0.8.6 (exact, currently authorised, inert preview; a preview cannot start a payment),
 * 0.3.2 (a denial reveals nothing), 0.3.4 (one player, one notice, one placement); evidence for success
 * criteria 12, 17 and 18.
 */

import type { ReactElement, ReactNode } from "react";

import RenderedContent from "@/components/rendered-content";
import { SimulationLabel } from "@/components/simulation-label";
import { StateNotice } from "@/components/state-notice";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { VideoPlayer, type VideoPlayerCaption } from "@/components/video-player";
import { cn } from "@/lib/cn";
import type { SourceReference } from "@/lib/ids";

import { copy } from "../copy";
import { GivingDesignation, type GivingBindingView } from "./giving-designation";

// ---------------------------------------------------------------------------------------------
// What a preview read hands this surface
// ---------------------------------------------------------------------------------------------

/**
 * The five purposes a rendition can serve, drawing the same closed set the content profile and the
 * media module record. Declared locally because this file reads the envelope's projection and may not
 * reach a module that renders or serves media: what arrives here is data, and the vocabulary it uses
 * is data too.
 */
export type PagePreviewRenditionPurpose =
  | "display"
  | "playback"
  | "poster"
  | "captions"
  | "transcript";

/**
 * One rendition the read admitted for the pinned revision.
 *
 * `renditionId` is opaque and is all a caller has to supply. `src` is the scoped address the read
 * resolved for that rendition, and it is optional on purpose: a read that already carried the
 * placement into the markup it produced has no separate address to offer, and a player rendered
 * without one would report an unavailable video beside a placement that is right there on the page.
 * So the address arrives only when the markup does not already hold the placement. Either way this
 * file only ever passes on what it was given — it never derives an address from the identity.
 *
 * A caption track also carries the language it is in, because a track without a language tag cannot
 * be offered honestly to a reader's player, and a label without one would be a guess.
 */
export interface PagePreviewRendition {
  /** Which of the five purposes this rendition serves. */
  readonly purpose: PagePreviewRenditionPurpose;
  /** The opaque identity of the rendition, exactly as the read supplied it. */
  readonly renditionId: string;
  /** The scoped address the read resolved for it, when the markup does not already carry it. */
  readonly src?: string;
  /** The name this rendition goes by on the surface, when the read gave it one. */
  readonly label?: string;
  /** The BCP-47 tag a caption track is in, when the rendition is one. */
  readonly language?: string;
}

/**
 * A preview that may be rendered: the exact revision, the language and direction it is read in, the
 * markup the single renderer produced, and the renditions admitted with it.
 *
 * `inert` and `givingAction` are literals rather than flags, so the type itself states that this
 * surface can never carry a live effect: no branch below could render a working giving control from an
 * answer shaped like this.
 */
export interface PagePreviewAuthorisedView {
  readonly status: "authorised";
  /** The edition whose revision is rendered. */
  readonly variantId: string;
  /** The exact revision rendered — the frozen one, not the draft as it stands now. */
  readonly revisionId: string;
  /** The BCP-47 language the edition serves. */
  readonly servedLocale: string;
  /** The language the reader asked for, when it differs from the one served. */
  readonly requestedLocale?: string;
  /** The direction the edition is authored and read in. */
  readonly direction: "ltr" | "rtl";
  /** The markup the single content renderer produced for that revision. */
  readonly html: string;
  /** The renditions admitted with this preview. */
  readonly renditionIds: readonly PagePreviewRendition[];
  /** Always true: a preview describes an inert surface and cannot describe anything else. */
  readonly inert: true;
  /** Always `none`: a preview never offers a live giving action. */
  readonly givingAction: "none";
}

/**
 * A preview that may not be rendered: one reason code and nothing else.
 *
 * The reason is the closed set the preview decision owns, arriving as a code. It is carried on the
 * region as data rather than as a sentence, because the refusal's wording is fixed and reveals
 * nothing; a code that named a record — a title, a language, an identifier — would defeat that.
 */
export interface PagePreviewDeniedView {
  readonly status: "denied";
  /** Which gate refused the preview. Never rendered as a record fact. */
  readonly reason: string;
}

/** A preview whose edition could not be read: the source that failed, named honestly. */
export interface PagePreviewUnavailableView {
  readonly status: "unavailable";
  readonly source: SourceReference;
}

/**
 * Every answer this surface renders. Three members, and deliberately no fourth: a load in progress is
 * the caller's concern and must never look like a refusal, so it is not modelled here at all.
 */
export type PagePreviewView =
  | PagePreviewAuthorisedView
  | PagePreviewDeniedView
  | PagePreviewUnavailableView;

/** Props of {@link PagePreviewFrame}. */
export interface PagePreviewFrameProps {
  /** Which chrome hosts the preview. Content, order and heading levels are the same in both. */
  readonly layout: "builder" | "route";
  /** The authorised preview, the refusal, or the unreadable source. */
  readonly preview: PagePreviewView;
  /** The one approved Designation for this placement, or the reason there is none. */
  readonly givingBinding?: GivingBindingView;
  /** Layout classes for the region. Never a colour, radius or shadow. */
  readonly className?: string;
}

// ---------------------------------------------------------------------------------------------
// The few words this surface owns
// ---------------------------------------------------------------------------------------------

/**
 * Field labels for the edition identity, beside the copy module's own sentences.
 *
 * A label is not a sentence: it names the value on the line it sits on, and the family's wording
 * module carries no leaf for either of these two because no other surface states them. The served
 * language reuses the module's own `Language` label so the common case has one home; the requested
 * language exists only where a fallback happened, and it must be named differently from the language
 * actually shown or the two values would be indistinguishable.
 */
const FIELD_LABELS = {
  revision: "Revision",
  requestedLanguage: "Language requested",
} as const;

/** The preview's own heading, in both layouts: the region and the heading carry the same name. */
const PREVIEW_HEADING = copy.builder.preview;

/**
 * How rendered prose reads inside the preview.
 *
 * The renderer emits semantic markup with no classes of its own, so the reading styles live here, in
 * the surface that displays it, rather than in a second stylesheet or in per-caller class lists. Every
 * value is a token utility: sizes from the type scale, spacing from the spacing scale, rules and code
 * surfaces from `--border` and `--muted`, and links keep their underline so their meaning never rests
 * on colour alone. Media are bounded rather than mirrored, so a wide picture or a player cannot widen
 * the page at 320 CSS px.
 */
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

/** The region, in both layouts: a column that can never widen the page past its container. */
const FRAME_CLASS = "flex min-w-0 flex-col gap-3 text-start";

/** The body's own column, shared by all three answers so their rhythm is the same. */
const BODY_CLASS = "flex min-w-0 flex-col gap-4";

/** The heading's own size per layout: the builder's pane is denser than the route's region. */
const HEADING_CLASS: Readonly<Record<PagePreviewFrameProps["layout"], string>> = {
  builder: "font-heading text-base font-medium",
  route: "font-heading text-lg font-medium",
};

/** The edition identity's line: labels and values on one wrapping row of small muted text. */
const IDENTITY_CLASS =
  "flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted-foreground";

/** A component's identity pair, kept together when the row wraps. */
const IDENTITY_PAIR_CLASS = "flex items-baseline gap-1.5";

/** The standing notes under the preview: readable, quiet, and never a control. */
const NOTE_CLASS = "text-xs text-muted-foreground text-pretty wrap-anywhere";

/** What a rendition's address reads as, trimmed: a blank address is no address at all. */
function addressOf(rendition: PagePreviewRendition): string {
  return rendition.src?.trim() ?? "";
}

/** The address a rendition carries, or nothing, so a player is never handed an empty string. */
function addressOrUndefined(rendition: PagePreviewRendition): string | undefined {
  const src = addressOf(rendition);
  return src.length === 0 ? undefined : src;
}

/** What a rendition is called on the surface, falling back to the catalogue's own word for a video. */
function nameOf(rendition: PagePreviewRendition): string {
  const label = rendition.label?.trim() ?? "";
  return label.length > 0 ? label : copy.catalogue.sections.video.label;
}

/**
 * The caption track one player offers, or nothing.
 *
 * A track needs both an address and the language it is in: a track with neither a language tag nor a
 * name would be offered to the reader as an unlabelled, un-specifiable option, which is worse than
 * playing the video with the transcript the exact markup already carries.
 */
function captionOf(rendition: PagePreviewRendition | undefined): readonly VideoPlayerCaption[] {
  if (rendition === undefined) {
    return [];
  }
  const src = addressOf(rendition);
  const language = rendition.language?.trim() ?? "";
  if (src.length === 0 || language.length === 0) {
    return [];
  }
  const label = rendition.label?.trim() ?? "";
  return [
    {
      src,
      srcLang: language,
      label: label.length > 0 ? label : language,
      default: true,
    },
  ];
}

/** The playable renditions of an authorised preview, with the addresses they were supplied with. */
interface PlayableRendition {
  readonly rendition: PagePreviewRendition;
  readonly src: string;
}

/**
 * The playback renditions this preview renders through the shared player.
 *
 * Only those the read supplied an address for, in the order the read listed them: an entry with no
 * address names a placement the markup already holds, and rendering a player without one would put an
 * unavailable video beside a placement that renders perfectly well on the page.
 */
function playableRenditions(preview: PagePreviewAuthorisedView): readonly PlayableRendition[] {
  const playable: PlayableRendition[] = [];
  for (const rendition of preview.renditionIds) {
    const src = addressOf(rendition);
    if (rendition.purpose === "playback" && src.length > 0) {
      playable.push({ rendition, src });
    }
  }
  return playable;
}

/** The renditions of one purpose, in the order the read listed them. */
function renditionsOf(
  preview: PagePreviewAuthorisedView,
  purpose: PagePreviewRenditionPurpose,
): readonly PagePreviewRendition[] {
  return preview.renditionIds.filter((rendition) => rendition.purpose === purpose);
}

/** The heading element every answer renders: one level, so the route keeps the page's only level 1. */
function PreviewHeading({
  layout,
}: {
  readonly layout: PagePreviewFrameProps["layout"];
}): ReactElement {
  return <h2 className={HEADING_CLASS[layout]}>{PREVIEW_HEADING}</h2>;
}

/** One label and value pair of the edition identity, so a wrapping row never splits them. */
function IdentityPair({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className={IDENTITY_PAIR_CLASS}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The edition identity
// ---------------------------------------------------------------------------------------------

/**
 * Which edition this preview renders: the language it serves, the language a reader asked for when
 * that is a different one, and the exact revision on screen.
 *
 * The two languages are named apart, and the family's fallback sentence explains what happened, so a
 * fallback can never be read as an edition in the requested language. The revision is presented
 * verbatim inside `<bdi>` with the identifier utility, so an opaque value keeps a leading zero and a
 * mixed-direction neighbour cannot reorder it.
 *
 * The simulated-publication label appears on the route only, beside the identity it qualifies: the
 * preview is how simulated reach is inspected, and a Page release sends no notice, so no mail-submission
 * label belongs anywhere on this surface.
 */
function EditionIdentity({
  preview,
  layout,
}: {
  readonly preview: PagePreviewAuthorisedView;
  readonly layout: PagePreviewFrameProps["layout"];
}): ReactElement {
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
        {layout === "route" ? (
          <SimulationLabel effect={copy.release.simulatedEffectKey} context="inline" />
        ) : null}
      </div>
      {fallback ? <p className={NOTE_CLASS}>{copy.editions.fallbackNote}</p> : null}
      <p className={NOTE_CLASS}>{copy.preview.exactRevisionNote}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Playback, through the one video surface
// ---------------------------------------------------------------------------------------------

/**
 * The playback placements this read resolved an address for, each rendered by the application's one
 * video surface.
 *
 * Poster and caption tracks are paired with a playback rendition by their position among the
 * renditions of that purpose, because that is the only order the read states: the nth video's tracks
 * are the nth poster and the nth caption track. A poster or a track the read did not supply is simply
 * absent, and the player then states what it has rather than being handed a stand-in.
 *
 * Nothing is rendered when the read resolved no playable address: the exact markup already carries
 * that placement, and a second, empty player beside it would present a working placement as an
 * unavailable video. No transcript text is passed either — the read supplies the transcript as a
 * served rendition, this surface holds no text for it, and composing text here would be a second
 * rendering of content the markup already states.
 */
function PreviewMedia({
  preview,
}: {
  readonly preview: PagePreviewAuthorisedView;
}): ReactElement | null {
  const playable = playableRenditions(preview);
  if (playable.length === 0) {
    return null;
  }

  const posters = renditionsOf(preview, "poster");
  const captions = renditionsOf(preview, "captions");

  return (
    <div data-slot="page-preview-media" className={BODY_CLASS}>
      {playable.map((entry, index) => {
        const poster = posters[index];
        return (
          <VideoPlayer
            key={entry.rendition.renditionId}
            title={nameOf(entry.rendition)}
            src={entry.src}
            poster={poster === undefined ? undefined : addressOrUndefined(poster)}
            captions={captionOf(captions[index])}
            state="ready"
            direction={preview.direction}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The three answers
// ---------------------------------------------------------------------------------------------

/**
 * What an authorised preview shows: the edition identity, the inert statement, the exact markup, the
 * media the read resolved separately, and the one Give placement.
 *
 * The inert statement sits above the content in both layouts, because the first thing a reader of a
 * preview needs to know is that nothing here is live — no payment starts, no mail leaves, nobody is
 * subscribed and nothing is released. It is a static disclosure rather than an alarm, so the alert
 * frame carries no announcing role of its own.
 *
 * The markup below it is the read's own string, placed exactly as it arrived through
 * `components/rendered-content` — the application's single rendering boundary, which carries the
 * edition's direction and language and states what makes that markup safe to insert. Nothing here
 * builds, joins, parses or repairs it, and nothing else in this file or this folder opens a second
 * site for markup: a second converter would be a second answer to "what does this edition say", which
 * the release forbids (Rule 1 clause 2; AAP 0.3.4).
 */
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
      {/* `preview.html` is the one renderer's output for the pinned revision, placed unchanged. */}
      <RenderedContent
        html={preview.html}
        direction={preview.direction}
        lang={preview.servedLocale}
        slot="page-preview-content"
        className={PREVIEW_CONTENT}
      />
      <PreviewMedia preview={preview} />
      {givingBinding === undefined ? null : (
        <GivingDesignation binding={givingBinding} layout="inline" />
      )}
      <p className={NOTE_CLASS}>{copy.preview.recheckedOnOpen}</p>
    </>
  );
}

/**
 * What a refused preview shows.
 *
 * The notice carries the family's own refusal title and states the refusal in the notice's fixed
 * words; nothing about the edition travels with it — no title, excerpt, count, language, revision or
 * identifier — so the answer is identical whether or not a draft exists and cannot be used to learn
 * that one does (AAP 0.3.2; criterion 19). The reason code sits on the region as data: it describes
 * the request rather than the record, and it is the same code either way.
 */
function DeniedPreview({ preview }: { readonly preview: PagePreviewDeniedView }): ReactElement {
  return (
    <div data-slot="page-preview-denied" data-denial-reason={preview.reason}>
      <StateNotice kind="denied" title={copy.states.deniedTitle} headingLevel={3} />
    </div>
  );
}

/**
 * What an unreadable edition shows: the source that could not be read, named.
 *
 * It is never an empty frame and never a blank page, both of which would read as "this page has no
 * content" — a different and untrue fact. The notice's own sentence states the outage, and the source
 * reference identifies which one failed.
 */
function UnavailablePreview({
  preview,
}: {
  readonly preview: PagePreviewUnavailableView;
}): ReactElement {
  return (
    <StateNotice
      kind="unavailable"
      title={copy.states.unavailableTitle}
      source={preview.source}
      headingLevel={3}
    />
  );
}

/** The body for whichever answer arrived, exhaustive over the three members. */
function previewBody(
  preview: PagePreviewView,
  layout: PagePreviewFrameProps["layout"],
  givingBinding: GivingBindingView | undefined,
): ReactElement {
  switch (preview.status) {
    case "authorised":
      return <AuthorisedPreview preview={preview} layout={layout} givingBinding={givingBinding} />;
    case "denied":
      return <DeniedPreview preview={preview} />;
    case "unavailable":
      return <UnavailablePreview preview={preview} />;
    default: {
      const unhandled: never = preview;
      return unhandled;
    }
  }
}

/**
 * The exact, currently authorised, inert preview of one Page edition.
 *
 * A labelled region in both layouts — the builder's side pane and the preview route — whose content,
 * order, heading levels and honesty are the same in each; only the chrome differs. One level-2 heading
 * joins the document outline under the heading the route owns, and the region carries the same name, so
 * a reader moving by landmark reaches the preview as one thing.
 */
export function PagePreviewFrame({
  layout,
  preview,
  givingBinding,
  className,
}: PagePreviewFrameProps): ReactElement {
  const body = previewBody(preview, layout, givingBinding);

  return (
    <section
      data-slot="page-preview-frame"
      data-layout={layout}
      data-preview-status={preview.status}
      aria-label={PREVIEW_HEADING}
      className={cn(FRAME_CLASS, className)}
    >
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
