/**
 * The application's one static content renderer: a validated content document and its media
 * placements become a single HTML string, produced with no editor instance, no browser, no DOM and
 * no React.
 *
 * Plan items that put this file in scope:
 * - AAP 0.3.4 "Prose editor and renderer" and 0.11.1: exactly one renderer serves preview, the
 *   receiving view, print and message HTML. There is no second renderer, no converter and no stored
 *   HTML, so a document cannot reach a reader through two different renderings.
 * - AAP 0.9.2: this file renders an admitted document statically for preview, reading, print and
 *   message HTML; AAP 0.6.1 fixes the exported name `renderToHtml`.
 * - AAP 0.2.1 (Tiptap research): `@tiptap/static-renderer` renders from stored JSON with no browser,
 *   DOM or editor instance, so the same call works in a Server Component, in the client preview and
 *   in a Node-environment test.
 * - AAP 0.8.6 and the internationalisation rule: direction is a `dir` attribute on the block that
 *   states it, order is logical only, nothing is mirrored and no physical left/right property is
 *   written; `document.ts` refuses bidi control characters at the boundary, and every value of
 *   unknown direction is isolated through `isolateValue`.
 *
 * Decisions this file holds:
 *
 * - Entry point. `renderJSONContentToString` from the package's `./json/html-string` subpath is the
 *   JSON-to-string renderer `@tiptap/static-renderer@3.34.0` publishes (verified against its
 *   `exports` map and declarations). Its node and mark maps are declared from this profile's own
 *   admitted sets, so the renderer cannot produce an element the profile does not admit. The
 *   `./json/react` and `./pm/*` entries are not used: this module has no React runtime and no editor
 *   instance to render from.
 * - Output attributes. `href` and `rel` on a link, `dir` on the block that states direction, `start`
 *   on a numbered list that does not begin at 1, and `label` on a caption track are the only
 *   attributes written here; no `class`, `style`, `id`, `on*`, `srcdoc` or data attribute can be
 *   produced from stored JSON. `start` is written because the profile admits it precisely so a stored
 *   list keeps its numbering, and it is a validated non-negative integer rather than text. `label` is
 *   the caption track's name in the player's caption menu, in the edition's own language, and it comes
 *   from the caller: this module renders no translated text and resolves no locale, so a fixed menu
 *   name would mislabel every edition that reads in another language, an RTL one included.
 * - Presentation choices are admitted and validated, and emit no attribute: this profile stores no
 *   styling, so a treatment, layout, alignment or image-fit value never becomes a class, an inline
 *   style or CSS here.
 * - Media are references. A placement renders the scoped `/api/media/<assetId>/<rendition>` path its
 *   caller was authorised for, never bytes, an original or a public URL, and a placement with no
 *   admitted rendition renders its alternative text instead of an empty element or a placeholder.
 * - Determinism. No clock, no randomness, no `Intl`, no locale-dependent formatting and no iteration
 *   order that depends on how a map was built: a section renders its fields in sorted key order and
 *   every rendition is looked up by key, so the same document always produces the same string.
 *
 * The module is framework-free and DOM-free. It imports the content profile and the static renderer
 * and nothing else: no store, no data service, no media bytes, no `next/*`. Insertion into a page
 * belongs to the one component that inserts the string it returns, so this folder produces HTML and
 * never injects it.
 */
import type {
  JSONMarkType,
  JSONNodeType,
  MarkProps,
  NodeProps,
} from "@tiptap/static-renderer/json/html-string";
import { renderJSONContentToString } from "@tiptap/static-renderer/json/html-string";

import {
  type AdmittedMarkType,
  type AdmittedNodeType,
  type ContentBlockNode,
  type ContentDirection,
  type ContentDocumentJson,
  type ContentSection,
  type DocumentIssue,
  parseDocument,
} from "./document";

// ---------------------------------------------------------------------------------------------
// Escaping and isolation: the folder's only two text-safety paths
// ---------------------------------------------------------------------------------------------

/**
 * The five characters that can end a text node or a quoted attribute value early. The table is the
 * one declaration of that mapping, so text escaping and attribute escaping cannot diverge.
 */
const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escapes a value for HTML text content or for a quoted attribute value: the single escaping helper
 * of `modules/content`, so one value cannot render differently in prose, in an attribute and in a
 * caption.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

/**
 * Wraps a caller-supplied value of unknown direction — a name, an amount, a date, a URL, a
 * leading-zero identifier — in a `<bdi>` element after escaping it. The element keeps the value's own
 * characters from reordering the text around it, and the characters of the value itself are never
 * rewritten: a leading zero, a non-Latin script and an emoji all survive unchanged. Prose text does
 * not go through here, because it is authored in the direction the document declares.
 */
export function isolateValue(value: string): string {
  return `<bdi>${escapeHtml(value)}</bdi>`;
}

// ---------------------------------------------------------------------------------------------
// The render options and the result statuses a caller branches on
// ---------------------------------------------------------------------------------------------

/** How a placement's media is emitted: an inline element, or a link only for the message context. */
export type RenderMediaMode = "inline" | "links-only";

/**
 * The purpose a rendition serves, mirroring the closed set `modules/media` records. This module
 * never reads bytes and never imports that module, so the vocabulary is restated rather than
 * reached for; a purpose that is not the one a placement needs is treated as not admitted, which is
 * what keeps a display path from being used as playback or the reverse.
 */
export type RenderRenditionPurpose = "display" | "playback" | "poster" | "captions";

/** One rendition path the route layer has already authorised and scoped for this read. */
export interface RenderRendition {
  /** An application path of the form `/api/media/<assetId>/<rendition>`, never a public original. */
  readonly src: string;
  /** What the path serves, so it can only be used as the kind of media it holds. */
  readonly purpose: RenderRenditionPurpose;
}

/** The renditions available to this render, keyed by rendition id. */
export type RenderRenditions = Readonly<Record<string, RenderRendition>>;

/**
 * One media placement a revision states, described by references only. `placementId` is also the key
 * of the placement's main rendition — a `display` rendition for an image, a `playback` rendition for
 * a video — and a video's poster and caption track are named by `posterId` and `captionsId`.
 */
export interface RenderMediaPlacement {
  /** The placement's identity within the revision, and the key of its main rendition. */
  readonly placementId: string;
  /** What the placement holds: it decides the element and the purpose its main rendition serves. */
  readonly kind: "image" | "video";
  /** The alternative text; it also stands in for the media when no rendition is admitted. */
  readonly altText: string;
  /** Optional visible caption, rendered as a `<figcaption>` when the author stated one. */
  readonly caption?: string;
  /** Key of a `poster` rendition, for a video. */
  readonly posterId?: string;
  /** Key of a `captions` rendition, for a video. */
  readonly captionsId?: string;
  /** BCP-47 language of the caption track, when that track states one. */
  readonly captionsLanguage?: string;
  /**
   * The caption track's name in the player's caption menu, in the edition's own language. The caller
   * states it: this module renders no translated text and resolves no locale. An absent label leaves
   * the attribute off, and the player then names the track from `srclang`.
   */
  readonly captionsLabel?: string;
}

/**
 * Everything a caller may vary between surfaces. There is no per-surface layout option: preview, the
 * receiving view and print pass the same document and the same placements, and the message context
 * differs only in `media: "links-only"`.
 */
export interface RenderOptions {
  /** How placements render; defaults to `inline`. */
  readonly media?: RenderMediaMode;
  /** The revision's media placements, in the order the authoring surface listed them. */
  readonly placements?: readonly RenderMediaPlacement[];
  /** The authorised rendition paths for those placements, keyed by rendition id. */
  readonly renditions?: RenderRenditions;
}

/**
 * The result of a render: `rendered` with the HTML, or `invalid` with the document's own issues and
 * no HTML at all, so a partially read document can never reach a reader.
 */
export type RenderResult =
  | { readonly status: "rendered"; readonly html: string }
  | { readonly status: "invalid"; readonly issues: readonly DocumentIssue[] };

// ---------------------------------------------------------------------------------------------
// The node and mark renderers: one per admitted type, proven exhaustive at compile time
// ---------------------------------------------------------------------------------------------

/** A node renderer in the static renderer's string contract. */
type HtmlNodeRender = (props: NodeProps<JSONNodeType, string | string[]>) => string;

/** A mark renderer in the static renderer's string contract. */
type HtmlMarkRender = (props: MarkProps<JSONMarkType, string | string[], JSONNodeType>) => string;

/**
 * Joins the children the renderer hands over: a node receives an array of rendered children and a
 * mark receives the single string it wraps, so both arrive here and neither is joined by the
 * library.
 */
function joinChildren(children: string | string[] | undefined): string {
  if (children === undefined) {
    return "";
  }
  return typeof children === "string" ? children : children.join("");
}

/**
 * The text of a text node, verbatim. A text node without text renders nothing rather than the
 * string "undefined", and no trimming, case change or numeric coercion happens here.
 */
function textOf(node: JSONNodeType): string {
  const text = node.text;
  return typeof text === "string" ? text : "";
}

/**
 * The heading element for an admitted level. Validation has already refused anything outside H2–H4,
 * so the fallback only keeps a single unrenderable node from producing an H1: heading level 1 is a
 * managed field, not prose, and must never appear in a rendered body.
 */
function headingTag(node: JSONNodeType): "h2" | "h3" | "h4" {
  const level = node.attrs?.level;
  if (level === 3) {
    return "h3";
  }
  if (level === 4) {
    return "h4";
  }
  return "h2";
}

/**
 * The `start` attribute of a numbered list, or nothing when the list begins at HTML's default of 1.
 * The profile admits the attribute so a stored or pasted list keeps its numbering, and it is written
 * only as a safe, non-negative integer.
 */
function orderedListStart(node: JSONNodeType): string {
  const start = node.attrs?.start;
  if (typeof start !== "number" || !Number.isSafeInteger(start) || start < 0 || start === 1) {
    return "";
  }
  return ` start="${start}"`;
}

/**
 * One renderer per admitted node type plus the document root. `satisfies` proves at compile time that
 * every node the profile admits has a renderer, so an admitted node cannot fall through a default
 * branch that invents markup for it.
 */
const NODE_RENDERERS = {
  doc: ({ children }) => joinChildren(children),
  paragraph: ({ children }) => `<p>${joinChildren(children)}</p>`,
  heading: ({ node, children }) => {
    const tag = headingTag(node);
    return `<${tag}>${joinChildren(children)}</${tag}>`;
  },
  bulletList: ({ children }) => `<ul>${joinChildren(children)}</ul>`,
  orderedList: ({ node, children }) =>
    `<ol${orderedListStart(node)}>${joinChildren(children)}</ol>`,
  listItem: ({ children }) => `<li>${joinChildren(children)}</li>`,
  blockquote: ({ children }) => `<blockquote>${joinChildren(children)}</blockquote>`,
  codeBlock: ({ children }) => `<pre><code>${joinChildren(children)}</code></pre>`,
  hardBreak: () => "<br>",
  text: ({ node }) => escapeHtml(textOf(node)),
} satisfies Record<AdmittedNodeType | "doc", HtmlNodeRender>;

/**
 * The destination of a link mark, or `undefined` when the mark carries none. Validation has already
 * refused every destination outside the profile, so an empty value is unreachable; returning the
 * children unwrapped keeps a malformed stored link from producing an `<a>` with no destination.
 */
function linkHref(mark: JSONMarkType): string | undefined {
  const href = mark.attrs?.href;
  return typeof href === "string" && href.length > 0 ? href : undefined;
}

/**
 * One renderer per admitted mark. A link is the only mark with an attribute, and `rel` is written by
 * this file rather than stored in content: the editor's link extension writes `target`, `rel` and
 * `class` on every link, and none of them is ever saved, so the safe pair is added here.
 */
const MARK_RENDERERS = {
  bold: ({ children }) => `<strong>${joinChildren(children)}</strong>`,
  italic: ({ children }) => `<em>${joinChildren(children)}</em>`,
  strike: ({ children }) => `<s>${joinChildren(children)}</s>`,
  underline: ({ children }) => `<u>${joinChildren(children)}</u>`,
  code: ({ children }) => `<code>${joinChildren(children)}</code>`,
  link: ({ mark, children }) => {
    const href = linkHref(mark);
    if (href === undefined) {
      return joinChildren(children);
    }
    return `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${joinChildren(children)}</a>`;
  },
} satisfies Record<AdmittedMarkType, HtmlMarkRender>;

/**
 * The one renderer instance, created once at module scope so every surface renders through the same
 * mappings. Each map is exhaustive over its profile set (checked with `satisfies` above), so adding a
 * node or a mark the profile admits without giving it a renderer fails to compile rather than
 * reaching output through a default that invents markup.
 */
const renderContent = renderJSONContentToString({
  nodeMapping: NODE_RENDERERS,
  markMapping: MARK_RENDERERS,
});

// ---------------------------------------------------------------------------------------------
// Media placements: references, never bytes and never a public original
// ---------------------------------------------------------------------------------------------

/** A BCP-47 language tag, so a caption track's `srclang` can never carry markup or a path. */
const LANGUAGE_TAG_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;

/**
 * The scoped path of one rendition, or `undefined` when the caller admitted none under that id or
 * admitted one whose purpose is not what this placement needs. A purpose mismatch is treated as no
 * rendition rather than coerced or repaired, so a path is never served as the wrong kind of media.
 */
function renditionAt(
  renditions: RenderRenditions,
  renditionId: string | undefined,
  purpose: RenderRenditionPurpose,
): string | undefined {
  if (renditionId === undefined) {
    return undefined;
  }
  const rendition = renditions[renditionId];
  if (rendition === undefined || rendition.purpose !== purpose || rendition.src.length === 0) {
    return undefined;
  }
  return rendition.src;
}

/**
 * The caption track of a video placement, rendered inside the player, or nothing when no captions
 * rendition is admitted. The track's path is a scoped request like the video's own, so a caption
 * cannot become a route around a denied video. Its menu name comes from the placement, in the
 * edition's own language: an absent or blank label writes no attribute at all, and the player then
 * names the track from `srclang`.
 */
function captionTrack(renditions: RenderRenditions, placement: RenderMediaPlacement): string {
  const captions = renditionAt(renditions, placement.captionsId, "captions");
  if (captions === undefined) {
    return "";
  }
  const language = placement.captionsLanguage;
  const srclang =
    language !== undefined && LANGUAGE_TAG_PATTERN.test(language)
      ? ` srclang="${escapeHtml(language)}"`
      : "";
  const name = placement.captionsLabel?.trim() ?? "";
  const label = name.length > 0 ? ` label="${escapeHtml(name)}"` : "";
  return `<track kind="captions" src="${escapeHtml(captions)}"${srclang}${label}>`;
}

/**
 * The media element of one placement: an image, or a video player carrying an optional poster and
 * caption track. The player never starts on its own, and a video's source is the admitted rendition
 * itself rather than a `<source>` element that could state a type nothing validated.
 */
function inlineMedia(
  src: string,
  renditions: RenderRenditions,
  placement: RenderMediaPlacement,
): string {
  if (placement.kind === "image") {
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(placement.altText)}">`;
  }
  const poster = renditionAt(renditions, placement.posterId, "poster");
  const posterAttribute = poster === undefined ? "" : ` poster="${escapeHtml(poster)}"`;
  return `<video controls src="${escapeHtml(src)}"${posterAttribute}>${captionTrack(
    renditions,
    placement,
  )}</video>`;
}

/**
 * A placement in the message context: one link to the scoped path and no player or image. The link's
 * text is the placement's alternative text, so the message says what the recipient would be opening.
 */
function linkedMedia(src: string, placement: RenderMediaPlacement): string {
  const label = placement.altText.length > 0 ? placement.altText : src;
  return `<a href="${escapeHtml(src)}" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

/**
 * One placement as a `<figure>`. When no rendition is admitted the figure carries the alternative
 * text and no media element at all — an honest unavailable rendering, never an empty element and
 * never a placeholder path that would fetch something no one authorised.
 */
function renderPlacement(
  placement: RenderMediaPlacement,
  media: RenderMediaMode,
  renditions: RenderRenditions,
): string {
  const parts: string[] = [];
  const main = renditionAt(
    renditions,
    placement.placementId,
    placement.kind === "image" ? "display" : "playback",
  );
  if (main === undefined) {
    parts.push(`<p>${escapeHtml(placement.altText)}</p>`);
  } else if (media === "links-only") {
    parts.push(linkedMedia(main, placement));
  } else {
    parts.push(inlineMedia(main, renditions, placement));
  }
  const caption = placement.caption;
  if (caption !== undefined && caption.trim().length > 0) {
    parts.push(`<figcaption>${escapeHtml(caption)}</figcaption>`);
  }
  return `<figure>${parts.join("")}</figure>`;
}

// ---------------------------------------------------------------------------------------------
// The document: prose body, then composed sections, then the revision's media placements
// ---------------------------------------------------------------------------------------------

/**
 * The profile's block nodes in the renderer's generic JSON shape. The two shapes are the same — the
 * profile declares its arrays readonly and the renderer's contract declares them mutable — so this
 * is the one place the profile's node type meets the renderer's, and nothing is validated here
 * because `parseDocument` has already admitted every node.
 */
function asJsonNode(node: ContentBlockNode): JSONNodeType {
  return node as JSONNodeType;
}

/** The prose body, rendered in the direction the document declares. */
function renderProse(document: ContentDocumentJson): string {
  return renderContent({
    content: { type: "doc", content: document.content.map((node) => asJsonNode(node)) },
  });
}

/**
 * One composed section: each stated field as a paragraph, in sorted key order so the same section
 * always renders the same way. A field the author left blank produces no empty paragraph, and a
 * section whose fields are all blank renders nothing rather than an empty element. The section emits
 * `dir` only where its own direction differs from the document's, so direction is stated once and
 * inherited elsewhere.
 */
function renderSection(section: ContentSection, documentDirection: ContentDirection): string {
  const paragraphs: string[] = [];
  for (const key of Object.keys(section.fields).sort()) {
    const value = section.fields[key];
    if (value === undefined || value.trim().length === 0) {
      continue;
    }
    paragraphs.push(`<p>${escapeHtml(value)}</p>`);
  }
  if (paragraphs.length === 0) {
    return "";
  }
  const direction =
    section.direction !== undefined && section.direction !== documentDirection
      ? ` dir="${section.direction}"`
      : "";
  return `<section${direction}>${paragraphs.join("")}</section>`;
}

/**
 * The whole document as one string: the prose body, the composed sections in authoring order, then
 * the revision's media placements. A placement has no authored position inside this profile — media
 * are their own records with their own per-request scope check — so the body keeps the order the
 * author stated and the placements follow it in the order the revision lists them. The document's
 * direction is stated once, on the block that contains everything.
 */
function composeDocument(document: ContentDocumentJson, options: RenderOptions): string {
  const parts: string[] = [renderProse(document)];
  for (const section of document.sections) {
    const rendered = renderSection(section, document.direction);
    if (rendered.length > 0) {
      parts.push(rendered);
    }
  }
  const media = options.media ?? "inline";
  const renditions = options.renditions ?? {};
  for (const placement of options.placements ?? []) {
    parts.push(renderPlacement(placement, media, renditions));
  }
  return `<article dir="${document.direction}">${parts.join("")}</article>`;
}

// ---------------------------------------------------------------------------------------------
// The render
// ---------------------------------------------------------------------------------------------

/**
 * Renders a stored or submitted content document to HTML for every reading surface: `rendered` with
 * the HTML, or `invalid` with the document's own issues and no HTML. The document is admitted through
 * `parseDocument` before anything is produced, so a node, a mark, a heading level or a presentation
 * value the profile does not admit is reported at its own path instead of reaching a reader.
 */
export function renderToHtml(input: unknown, options: RenderOptions = {}): RenderResult {
  const parsed = parseDocument(input);
  if (parsed.status === "invalid") {
    return { status: "invalid", issues: parsed.issues };
  }
  try {
    return { status: "rendered", html: composeDocument(parsed.document, options) };
  } catch {
    // Validation has already refused every unadmitted node, so an unrenderable node is unreachable
    // in practice. Catching keeps a renderer fault from escaping as an exception with a partial
    // document behind it, and reports it in the statuses the caller already branches on.
    return {
      status: "invalid",
      issues: [
        { path: "", message: "The content document holds a node this renderer does not produce." },
      ],
    };
  }
}
