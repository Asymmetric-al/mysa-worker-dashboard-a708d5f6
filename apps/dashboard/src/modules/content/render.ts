/** The application's one static content renderer: a validated content document and its media placements become a single HTML string, produced with no editor instance, no browser, no DOM and no React. */
import { renderJSONContentToString, type JSONMarkType, JSONNodeType, MarkProps, NodeProps } from "@tiptap/static-renderer/json/html-string";
import { type AdmittedMarkType, type AdmittedNodeType, type ContentBlockNode, type ContentDirection, type ContentDocumentJson, type ContentSection, type DocumentIssue, parseDocument } from "./document";
const HTML_ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Escapes a value for HTML text content or for a quoted attribute value: the single escaping helper of `modules/content`, so one value cannot render differently in prose, in an attribute and. */
export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
/** Wraps a caller-supplied value of unknown direction — a name, an amount, a date, a URL, a leading-zero identifier — in a `<bdi>` element after escaping it. */
export const isolateValue = (value: string): string => `<bdi>${escapeHtml(value)}</bdi>`;
export type RenderMediaMode = "inline" | "links-only";
/** The purpose a rendition serves, mirroring the closed set `modules/media` records. */
export type RenderRenditionPurpose = "display" | "playback" | "poster" | "captions";
export type RenderRendition = { readonly src: string; readonly purpose: RenderRenditionPurpose };
export type RenderRenditions = Readonly<Record<string, RenderRendition>>;
export type RenderMediaPlacement = { readonly placementId: string; readonly kind: "image" | "video"; readonly altText: string; readonly caption?: string; readonly posterId?: string; readonly captionsId?: string; readonly captionsLanguage?: string; readonly captionsLabel?: string };
export type RenderOptions = { readonly media?: RenderMediaMode; readonly placements?: readonly RenderMediaPlacement[]; readonly renditions?: RenderRenditions };
export type RenderResult = { readonly status: "rendered"; readonly html: string } | { readonly status: "invalid"; readonly issues: readonly DocumentIssue[] };
type HtmlNodeRender = (props: NodeProps<JSONNodeType, string | string[]>) => string;
type HtmlMarkRender = (props: MarkProps<JSONMarkType, string | string[], JSONNodeType>) => string;

function joinChildren(children: string | string[] | undefined): string {
  if (children === undefined) return "";
  return typeof children === "string" ? children : children.join("");
}
function textOf(node: JSONNodeType): string {
  const text = node.text;
  return typeof text === "string" ? text : "";
}
function headingTag(node: JSONNodeType): "h2" | "h3" | "h4" {
  const level = node.attrs?.level;
  if (level === 3) return "h3";
  if (level === 4) return "h4";
  return "h2";
}
function orderedListStart(node: JSONNodeType): string {
  const start = node.attrs?.start;
  if (typeof start !== "number" || !Number.isSafeInteger(start) || start < 0 || start === 1) return "";
  return ` start="${start}"`;
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
  text: ({ node }) => escapeHtml(textOf(node)),
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
    if (href === undefined) return joinChildren(children);
    return `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${joinChildren(children)}</a>`;
  },
} satisfies Record<AdmittedMarkType, HtmlMarkRender>;
const renderContent = renderJSONContentToString({ nodeMapping: NODE_RENDERERS, markMapping: MARK_RENDERERS });
// Media placements: references, never bytes and never a public original
const LANGUAGE_TAG_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;

function renditionAt(renditions: RenderRenditions, renditionId: string | undefined, purpose: RenderRenditionPurpose): string | undefined {
  if (renditionId === undefined) return undefined;
  const rendition = renditions[renditionId];
  if (rendition === undefined || rendition.purpose !== purpose || rendition.src.length === 0) return undefined;
  return rendition.src;
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
function inlineMedia(src: string, renditions: RenderRenditions, placement: RenderMediaPlacement): string {
  if (placement.kind === "image") return `<img src="${escapeHtml(src)}" alt="${escapeHtml(placement.altText)}">`;
  const poster = renditionAt(renditions, placement.posterId, "poster");
  const posterAttribute = poster === undefined ? "" : ` poster="${escapeHtml(poster)}"`;
  return `<video controls src="${escapeHtml(src)}"${posterAttribute}>${captionTrack(renditions, placement)}</video>`;
}
function linkedMedia(src: string, placement: RenderMediaPlacement): string {
  const label = placement.altText.length > 0 ? placement.altText : src;
  return `<a href="${escapeHtml(src)}" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}
function renderPlacement(placement: RenderMediaPlacement, media: RenderMediaMode, renditions: RenderRenditions): string {
  const parts: string[] = [];
  const main = renditionAt(renditions, placement.placementId, placement.kind === "image" ? "display" : "playback");
  if (main === undefined) {
    parts.push(`<p>${escapeHtml(placement.altText)}</p>`);
  } else if (media === "links-only") {
    parts.push(linkedMedia(main, placement));
  } else parts.push(inlineMedia(main, renditions, placement));
  const caption = placement.caption;
  if (caption !== undefined && caption.trim().length > 0) parts.push(`<figcaption>${escapeHtml(caption)}</figcaption>`);
  return `<figure>${parts.join("")}</figure>`;
}
const asJsonNode = (node: ContentBlockNode): JSONNodeType => node as JSONNodeType;
const renderProse = (document: ContentDocumentJson): string => renderContent({ content: { type: "doc", content: document.content.map((node) => asJsonNode(node)) } });
function renderSection(section: ContentSection, documentDirection: ContentDirection): string {
  const paragraphs: string[] = [];
  for (const key of Object.keys(section.fields).sort()) {
    const value = section.fields[key];
    if (value === undefined || value.trim().length === 0) continue;
    paragraphs.push(`<p>${escapeHtml(value)}</p>`);
  }
  if (paragraphs.length === 0) return "";
  const direction = section.direction !== undefined && section.direction !== documentDirection ? ` dir="${section.direction}"` : "";
  return `<section${direction}>${paragraphs.join("")}</section>`;
}
function composeDocument(document: ContentDocumentJson, options: RenderOptions): string {
  const parts: string[] = [renderProse(document)];
  for (const section of document.sections) {
    const rendered = renderSection(section, document.direction);
    if (rendered.length > 0) parts.push(rendered);
  }
  const media = options.media ?? "inline";
  const renditions = options.renditions ?? {};
  for (const placement of options.placements ?? []) parts.push(renderPlacement(placement, media, renditions));
  return `<article dir="${document.direction}">${parts.join("")}</article>`;
}
export function renderToHtml(input: unknown, options: RenderOptions = {}): RenderResult {
  const parsed = parseDocument(input);
  if (parsed.status === "invalid") return { status: "invalid", issues: parsed.issues };
  try {
    return { status: "rendered", html: composeDocument(parsed.document, options) };
  } catch {
    // Validation has already refused every unadmitted node, so an unrenderable node is unreachable in practice; catching keeps a renderer fault from escaping as an exception with a partial document behind it.
    return { status: "invalid", issues: [{ path: "", message: "The content document holds a node this renderer does not produce." }] };
  }
}
