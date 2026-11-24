import { renderJSONContentToString, JSONNodeType, MarkProps, NodeProps, type JSONMarkType } from "@tiptap/static-renderer/json/html-string";
import { parseDocument, type AdmittedMarkType, type AdmittedNodeType, type ContentBlockNode, type ContentDirection, type ContentDocumentJson, type ContentSection, type DocumentIssue, type PresentationChoice } from "./document";
const HTML_ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
export const isolateValue = (value: string): string => `<bdi>${escapeHtml(value)}</bdi>`;
// The weak and neutral runs a right-to-left sentence cannot place on its own — an address, an email address, a telephone number, a civil date, a number — in the order each is recognised, so a value keeps its own direction inside prose that runs the other way.
const ISOLATED_RUN_PATTERNS: readonly RegExp[] = [/^(?:https?:\/\/|www\.)[^\s<>"'`]+/u, /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u, /^\+\d[\d ().-]{4,}\d/u, /^\d{4}-\d{2}-\d{2}/u, /^(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?)/u];
// The mark a sentence puts after a value belongs to the sentence rather than to the value: `1,250.` isolates the number and leaves the full stop in the prose around it.
const TRAILING_MARKS = /[.,;:!?'")\]}]+$/u;
function isolatedRunAt(text: string): string {
  for (const pattern of ISOLATED_RUN_PATTERNS) {
    const found = pattern.exec(text)?.[0] ?? "";
    const value = found.replace(TRAILING_MARKS, "");
    if (value.length > 0) return value;
  }
  return "";
}
/** A stored value's text as HTML: every weak or neutral run escapes inside an isolation element of its own, and everything between them is escaped prose. */ function isolateRuns(text: string): string {
  const parts: string[] = [];
  let plain = "";
  let index = 0;
  while (index < text.length) {
    const rest = text.slice(index);
    const run = isolatedRunAt(rest);
    if (run.length === 0) {
      plain += rest.slice(0, 1);
      index += 1;
      continue;
    }
    if (plain.length > 0) parts.push(escapeHtml(plain));
    plain = "";
    parts.push(`<bdi>${escapeHtml(run)}</bdi>`);
    index += run.length;
  }
  if (plain.length > 0) parts.push(escapeHtml(plain));
  return parts.join("");
}
/** One database-driven value, escaped and isolated as a whole from the direction of the prose around it, with each weak or neutral run inside it isolated in its turn: a nested `<bdi>` is valid phrasing content. */ const isolateStoredValue = (text: string): string => `<bdi>${isolateRuns(text)}</bdi>`;
export type RenderMediaMode = "inline" | "links-only";
export type RenderRenditionPurpose = "display" | "playback" | "poster" | "captions" | "transcript";
export type RenderRendition = { readonly src: string; readonly purpose: RenderRenditionPurpose };
export type RenderRenditions = Readonly<Record<string, RenderRendition>>;
/** One placement as the renderer meets it: its own words, the rendition identities the read supplied for it, and the section it was composed into. */ export type RenderMediaPlacement = {
  readonly placementId: string;
  readonly kind: "image" | "video";
  readonly altText: string;
  readonly caption?: string;
  readonly credit?: string;
  readonly language?: string;
  readonly posterId?: string;
  readonly captionsId?: string;
  readonly captionsLanguage?: string;
  readonly captionsLabel?: string;
  readonly transcriptId?: string;
  readonly sectionElement?: string | null;
};
export type RenderOptions = { readonly media?: RenderMediaMode; readonly placements?: readonly RenderMediaPlacement[]; readonly renditions?: RenderRenditions; readonly lang?: string };
export type RenderResult = { readonly status: "rendered"; readonly html: string } | { readonly status: "invalid"; readonly issues: readonly DocumentIssue[] };
type HtmlNodeRender = (props: NodeProps<JSONNodeType, string | string[]>) => string;
type HtmlMarkRender = (props: MarkProps<JSONMarkType, string | string[], JSONNodeType>) => string;
const joinChildren = (children: string | string[] | undefined): string => (children === undefined ? "" : typeof children === "string" ? children : children.join(""));
const textOf = (node: JSONNodeType): string => (typeof node.text === "string" ? node.text : "");
const headingTag = (node: JSONNodeType): "h2" | "h3" | "h4" => (node.attrs?.level === 3 ? "h3" : node.attrs?.level === 4 ? "h4" : "h2");
function orderedListStart(node: JSONNodeType): string {
  const start = node.attrs?.start;
  return typeof start !== "number" || !Number.isSafeInteger(start) || start < 0 || start === 1 ? "" : ` start="${start}"`;
}
const NODE_RENDERERS = {
  doc: ({ children }) => joinChildren(children),
  paragraph: ({ children }) => `<p>${joinChildren(children)}</p>`,
  heading: ({ node, children }) => {
    const tag = headingTag(node);
    return `<${tag}>${joinChildren(children)}</${tag}>`;
  },
  bulletList: ({ children }) => `<ul>${joinChildren(children)}</ul>`,
  orderedList: ({ node, children }) => `<ol${orderedListStart(node)}>${joinChildren(children)}</ol>`,
  listItem: ({ children }) => `<li>${joinChildren(children)}</li>`,
  blockquote: ({ children }) => `<blockquote>${joinChildren(children)}</blockquote>`,
  codeBlock: ({ children }) => `<pre><code>${joinChildren(children)}</code></pre>`,
  hardBreak: () => "<br>",
  text: ({ node }) => isolateStoredValue(textOf(node)),
} satisfies Record<AdmittedNodeType | "doc", HtmlNodeRender>;
function linkHref(mark: JSONMarkType): string | undefined {
  const href = mark.attrs?.href;
  return typeof href === "string" && href.length > 0 ? href : undefined;
}
const MARK_RENDERERS = {
  bold: ({ children }) => `<strong>${joinChildren(children)}</strong>`,
  italic: ({ children }) => `<em>${joinChildren(children)}</em>`,
  strike: ({ children }) => `<s>${joinChildren(children)}</s>`,
  underline: ({ children }) => `<u>${joinChildren(children)}</u>`,
  code: ({ children }) => `<code>${joinChildren(children)}</code>`,
  link: ({ mark, children }) => {
    const href = linkHref(mark);
    return href === undefined ? joinChildren(children) : `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${joinChildren(children)}</a>`;
  },
} satisfies Record<AdmittedMarkType, HtmlMarkRender>;
const renderContent = renderJSONContentToString({ nodeMapping: NODE_RENDERERS, markMapping: MARK_RENDERERS });
const LANGUAGE_TAG_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;
function renditionAt(renditions: RenderRenditions, renditionId: string | undefined, purpose: RenderRenditionPurpose): string | undefined {
  const rendition = renditionId === undefined ? undefined : renditions[renditionId];
  return rendition === undefined || rendition.purpose !== purpose || rendition.src.length === 0 ? undefined : rendition.src;
}
function captionTrack(renditions: RenderRenditions, placement: RenderMediaPlacement): string {
  const captions = renditionAt(renditions, placement.captionsId, "captions");
  if (captions === undefined) return "";
  const language = placement.captionsLanguage;
  const srclang = language !== undefined && LANGUAGE_TAG_PATTERN.test(language) ? ` srclang="${escapeHtml(language)}"` : "";
  const name = placement.captionsLabel?.trim() ?? "";
  const label = name.length > 0 ? ` label="${escapeHtml(name)}"` : "";
  return `<track kind="captions" src="${escapeHtml(captions)}"${srclang}${label}>`;
}
const TRANSCRIPT_LABEL = "Read the transcript"; // The transcript's own words, matching the label the receiving preview offers for the same rendition, so one alternative is named the same way wherever a reader meets it.
function transcriptLink(renditions: RenderRenditions, placement: RenderMediaPlacement): string {
  const transcript = renditionAt(renditions, placement.transcriptId, "transcript");
  if (transcript === undefined) return "";
  const name = placement.altText.trim();
  return `<a href="${escapeHtml(transcript)}" rel="noopener noreferrer">${escapeHtml(name.length === 0 ? TRANSCRIPT_LABEL : `${TRANSCRIPT_LABEL} for ${name}`)}</a>`;
}
function inlineMedia(src: string, renditions: RenderRenditions, placement: RenderMediaPlacement): string {
  if (placement.kind === "image") return `<img src="${escapeHtml(src)}" alt="${escapeHtml(placement.altText)}">`;
  const poster = renditionAt(renditions, placement.posterId, "poster");
  // The player is named by the placement's own text alternative: a `<video>` with no accessible name is a control a screen reader announces as nothing, and the transcript beside it states the same alternative in words. A transcript is a reading alternative beside the player and never inside it: `video` admits only `track` and `source` children, so the link is appended under the player in the same figure.
  return `<video controls aria-label="${escapeHtml(placement.altText)}" src="${escapeHtml(src)}"${poster === undefined ? "" : ` poster="${escapeHtml(poster)}"`}>${captionTrack(renditions, placement)}</video>${transcriptLink(renditions, placement)}`;
}
const linkedMedia = (src: string, placement: RenderMediaPlacement): string => `<a href="${escapeHtml(src)}" rel="noopener noreferrer">${isolateStoredValue(placement.altText.length > 0 ? placement.altText : src)}</a>`;
// A placement states the caption, the credit of the work and the language it is in wherever it holds them, in the words the video player already uses for a credit and a language — the credit bare, the language as `Language: <tag>` — so a placement reads the same way in the preview as in the editor. Each is one database-driven value, escaped and isolated from the prose around it.
const LANGUAGE_LABEL = "Language:";
function figcaptionOf(placement: RenderMediaPlacement): string {
  const parts: string[] = [];
  const caption = placement.caption?.trim() ?? "";
  if (caption.length > 0) parts.push(isolateStoredValue(caption));
  const credit = placement.credit?.trim() ?? "";
  if (credit.length > 0) parts.push(isolateStoredValue(credit));
  const language = placement.language?.trim() ?? "";
  if (language.length > 0) parts.push(`${LANGUAGE_LABEL} ${isolateStoredValue(language)}`);
  return parts.length === 0 ? "" : `<figcaption>${parts.join(" ")}</figcaption>`;
}
function renderPlacement(placement: RenderMediaPlacement, media: RenderMediaMode, renditions: RenderRenditions): string {
  const parts: string[] = [];
  const main = renditionAt(renditions, placement.placementId, placement.kind === "image" ? "display" : "playback");
  // With no rendition to play, the placement states its text alternative in the player's place, and that sentence is a stored value too, so it keeps its own direction inside the prose around it.
  if (main === undefined) parts.push(`<p>${isolateStoredValue(placement.altText)}</p>`);
  else if (media === "links-only") parts.push(linkedMedia(main, placement));
  else parts.push(inlineMedia(main, renditions, placement));
  const figcaption = figcaptionOf(placement);
  if (figcaption.length > 0) parts.push(figcaption);
  return `<figure>${parts.join("")}</figure>`;
}
const asJsonNode = (node: ContentBlockNode): JSONNodeType => node as JSONNodeType;
const renderProse = (document: ContentDocumentJson): string => renderContent({ content: { type: "doc", content: document.content.map((node) => asJsonNode(node)) } });
// Presentation: every admitted member of the four bounded choices maps to one class of its own, keyed by the member itself, so the styling surface of a section is this table and a value read from a document never becomes part of a class name.
const PRESENTATION_CLASSES: { readonly [Choice in keyof PresentationChoice]: Readonly<Record<PresentationChoice[Choice], string>> } = {
  treatment: { normal: "content-treatment-normal", emphasized: "content-treatment-emphasized" },
  layout: { "single-column": "content-layout-single-column", "two-column-image-text": "content-layout-two-column-image-text" },
  alignment: { start: "content-alignment-start", center: "content-alignment-center" },
  imageFit: { cover: "content-image-fit-cover", contain: "content-image-fit-contain" },
};
const presentationClasses = (presentation: PresentationChoice): string => [PRESENTATION_CLASSES.treatment[presentation.treatment], PRESENTATION_CLASSES.layout[presentation.layout], PRESENTATION_CLASSES.alignment[presentation.alignment], PRESENTATION_CLASSES.imageFit[presentation.imageFit]].join(" ");
// A blank line in a saved value separates one paragraph from the next, which is what the field's own help text promises a writer, so the value is rendered as the paragraphs it states instead of as one block holding the newlines.
const PARAGRAPH_BREAK = /\r?\n[ \t]*\r?\n/u;
/** One section's field values, escaped and isolated, in the order the catalogue's own keys sort in: one paragraph per blank-line-separated part, and the parts in the author's own order. */ const sectionParagraphs = (section: ContentSection): readonly string[] =>
  Object.keys(section.fields)
    .sort()
    .flatMap((key) => {
      const value = section.fields[key];
      if (value === undefined || value.trim().length === 0) return [];
      return value
        .split(PARAGRAPH_BREAK)
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .map((part) => `<p>${isolateStoredValue(part)}</p>`);
    });
/** One rendered section: its declared direction where it differs from the document's, the four admitted choices as classes beside the section's own frame, its text, and the media composed into it. */
function renderSection(section: ContentSection, documentDirection: ContentDirection, paragraphs: readonly string[], media: readonly string[]): string {
  const direction = section.direction !== undefined && section.direction !== documentDirection ? ` dir="${section.direction}"` : "";
  const mediaBlock = media.length === 0 ? "" : `<div class="content-section-media">${media.join("")}</div>`;
  return `<section${direction} class="content-section ${presentationClasses(section.presentation)}"><div class="content-section-text">${paragraphs.join("")}</div>${mediaBlock}</section>`;
}
function composeDocument(document: ContentDocumentJson, options: RenderOptions): string {
  const placements = options.placements ?? [];
  // A section is rendered when it states text of its own or holds a placement: an image or video section states its words in the placement rather than in a field, so its media belongs in its own frame instead of at the end of the document, detached from the section it was composed into.
  const sections = document.sections.map((section) => ({ section, paragraphs: sectionParagraphs(section) })).filter((entry) => entry.paragraphs.length > 0 || placements.some((placement) => placement.sectionElement === entry.section.element));
  const inSections = sections.map(() => [] as string[]);
  const trailing: string[] = [];
  // A placement naming a rendered section is rendered inside it, beside that section's own text; one that names no section, or one this document does not render, stays at the end of the document in the order the read supplied it, and where two sections share one catalogue element the first of them carries the media so it is rendered exactly once.
  for (const placement of placements) {
    const rendered = renderPlacement(placement, options.media ?? "inline", options.renditions ?? {});
    const named = placement.sectionElement;
    const index = named === undefined || named === null ? -1 : sections.findIndex((entry) => entry.section.element === named);
    if (index < 0) trailing.push(rendered);
    else inSections[index]?.push(rendered);
  }
  const parts: string[] = [renderProse(document)];
  sections.forEach((entry, index) => parts.push(renderSection(entry.section, document.direction, entry.paragraphs, inSections[index] ?? [])));
  parts.push(...trailing);
  // The block declares the language of the content it holds beside the direction of that content, so assistive technology reading the article alone is told both; a caller that knows no language states none rather than inventing one.
  const language = (options.lang ?? "").trim();
  const langAttribute = language.length === 0 ? "" : ` lang="${escapeHtml(language)}"`;
  return `<article dir="${document.direction}"${langAttribute}>${parts.join("")}</article>`;
}
export function renderToHtml(input: unknown, options: RenderOptions = {}): RenderResult {
  const parsed = parseDocument(input);
  if (parsed.status === "invalid") return { status: "invalid", issues: parsed.issues };
  try {
    return { status: "rendered", html: composeDocument(parsed.document, options) };
  } catch {
    return { status: "invalid", issues: [{ path: "", message: "The content document holds a node this renderer does not produce." }] };
  }
}
