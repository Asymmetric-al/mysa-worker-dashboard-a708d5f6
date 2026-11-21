/**
 * The application's single versioned content profile: the Tiptap JSON document shape, its Zod
 * validation, its canonical serialisation, the admitted node and mark sets, the bounded presentation
 * choices, the document direction property and the deliberate paste decision.
 */
import { z } from "zod";
import { isRecord } from "@/lib/guards";
// The profile's closed vocabularies, declared once and consumed by both the schemas and the editor
/** Version of the content profile stored on every document. */
export const CONTENT_PROFILE_VERSION = 1;
/** The two directions a document may state; direction is content, never interface language. */
export const CONTENT_DIRECTIONS = ["ltr", "rtl"] as const;
/** The direction a document or a section declares. */
export type ContentDirection = (typeof CONTENT_DIRECTIONS)[number];
/** The heading levels the profile admits: H2, H3 and H4. */
export const ADMITTED_HEADING_LEVELS = [2, 3, 4] as const;
/** Every node type a document may hold; `hardBreak` and `text` are the inline pair. */
export const ADMITTED_NODE_TYPES = ["paragraph", "heading", "bulletList", "orderedList", "listItem", "blockquote", "codeBlock", "hardBreak", "text"] as const;
/** A node type the profile admits. */
export type AdmittedNodeType = (typeof ADMITTED_NODE_TYPES)[number];
/** The marks that format text without carrying a value. */
export const FORMATTING_MARK_TYPES = ["bold", "italic", "strike", "underline", "code"] as const;
/** The only mark that carries an attribute: a typed link destination. */
export const LINK_MARK_TYPE = "link" as const;
/** Every mark a document may hold, built from the two groups above so the admitted list and the mark schemas below read from one source and cannot diverge. */
export const ADMITTED_MARK_TYPES = [...FORMATTING_MARK_TYPES, LINK_MARK_TYPE] as const;
/** A mark the profile admits. */
export type AdmittedMarkType = (typeof ADMITTED_MARK_TYPES)[number];

const ADMITTED_NODE_TYPE_SET: ReadonlySet<string> = new Set(ADMITTED_NODE_TYPES);
const ADMITTED_MARK_TYPE_SET: ReadonlySet<string> = new Set(ADMITTED_MARK_TYPES);
const ADMITTED_HEADING_LEVEL_SET: ReadonlySet<number> = new Set(ADMITTED_HEADING_LEVELS);
/** The four bounded presentation choices a section may state, each with the only values it admits. */
export const PRESENTATION_CHOICES = {
  treatment: ["normal", "emphasized"],
  layout: ["single-column", "two-column-image-text"],
  alignment: ["start", "center"],
  imageFit: ["cover", "contain"],
} as const;
const MAX_CONTENT_DEPTH = 64;
// Document shapes
/** A mark that formats text without carrying a value. */
export interface ContentFormattingMark {
  readonly type: (typeof FORMATTING_MARK_TYPES)[number];
}
/** The only mark with an attribute: a typed link destination. */
export interface ContentLinkMark {
  readonly type: typeof LINK_MARK_TYPE;
  readonly attrs: { readonly href: string };
}
/** A mark stored on a text node. */
export type ContentMarkNode = ContentFormattingMark | ContentLinkMark;
/** A run of text, stored verbatim: leading zeros, mixed direction and scripts are never rewritten. */
export interface ContentTextNode {
  readonly type: "text";
  readonly text: string;
  readonly marks?: readonly ContentMarkNode[];
}
/** A deliberate line break inside a block. */
export interface ContentHardBreakNode {
  readonly type: "hardBreak";
}
/** A node admitted inside a paragraph or a heading. */
export type ContentInlineNode = ContentTextNode | ContentHardBreakNode;
/** A paragraph of inline content. */
export interface ContentParagraphNode {
  readonly type: "paragraph";
  readonly content?: readonly ContentInlineNode[];
}
/** A heading at an admitted level. */
export interface ContentHeadingNode {
  readonly type: "heading";
  readonly attrs: { readonly level: (typeof ADMITTED_HEADING_LEVELS)[number] };
  readonly content?: readonly ContentInlineNode[];
}
/** One item of a bulleted or numbered list. */
export interface ContentListItemNode {
  readonly type: "listItem";
  readonly content?: readonly ContentBlockNode[];
}
/** A bulleted list. */
export interface ContentBulletListNode {
  readonly type: "bulletList";
  readonly content?: readonly ContentListItemNode[];
}
/** A numbered list. */
export interface ContentOrderedListNode {
  readonly type: "orderedList";
  readonly attrs?: { readonly start?: number };
  readonly content?: readonly ContentListItemNode[];
}
/** A quotation block. */
export interface ContentBlockquoteNode {
  readonly type: "blockquote";
  readonly content?: readonly ContentBlockNode[];
}
/** The text a code block holds: no marks, because a code block formats none of them. */
export interface ContentCodeTextNode {
  readonly type: "text";
  readonly text: string;
}
/** A preformatted code block. */
export interface ContentCodeBlockNode {
  readonly type: "codeBlock";
  readonly content?: readonly ContentCodeTextNode[];
}
/** A node admitted at block level. */
export type ContentBlockNode = ContentParagraphNode | ContentHeadingNode | ContentBulletListNode | ContentOrderedListNode | ContentBlockquoteNode | ContentCodeBlockNode;
/** Any node a document may hold. */
export type ContentNode = ContentBlockNode | ContentInlineNode;
/** One composed section of a page-family document. */
export interface ContentSection {
  readonly element: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly presentation: PresentationChoice;
  readonly direction?: ContentDirection;
}
/** A complete content document: the Tiptap document root, carrying the profile version it was written against, the direction it reads in, its prose body and its composed sections. */
export interface ContentDocumentJson {
  readonly type: "doc";
  readonly profileVersion: typeof CONTENT_PROFILE_VERSION;
  readonly direction: ContentDirection;
  readonly content: readonly ContentBlockNode[];
  readonly sections: readonly ContentSection[];
}
/** One problem with a document, at the path the authoring form uses for that field. */
export interface DocumentIssue {
  readonly path: string;
  readonly message: string;
}
/** The result of validating untrusted document input; `invalid` carries every issue found. */
export type ParseDocumentResult = { readonly status: "valid"; readonly document: ContentDocumentJson } | { readonly status: "invalid"; readonly issues: readonly DocumentIssue[] };
// The schemas: one per admitted node, one per mark, one per section, one for the document
function linkHrefProblem(href: string): string | undefined {
  if (href.length === 0) {
    return "A link needs a destination.";
  }
  if (href.startsWith("//")) {
    return "A link may not be protocol-relative: use an https URL or a path beginning with /.";
  }
  if (href.startsWith("/")) {
    return undefined;
  }
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(href)?.[1]?.toLowerCase();
  if (scheme === undefined) {
    return "A link is an absolute https URL or a path beginning with /.";
  }
  if (scheme !== "http" && scheme !== "https") {
    return `A link may not use the "${scheme}:" scheme: use an https URL or a path beginning with /.`;
  }
  return /^https?:\/\/[^\s/]/.test(href) ? undefined : "An http(s) link needs a host.";
}
const linkHrefSchema = z.string().superRefine((href, ctx) => {
  const problem = linkHrefProblem(href);
  if (problem !== undefined) {
    ctx.addIssue({ code: "custom", message: problem });
  }
});
const formattingMarkSchema: z.ZodType<ContentFormattingMark> = z.object({
  type: z.literal(FORMATTING_MARK_TYPES),
});
const linkMarkSchema: z.ZodType<ContentLinkMark> = z.object({
  type: z.literal(LINK_MARK_TYPE),
  attrs: z.object({ href: linkHrefSchema }),
});
const contentMarkNodeSchema = z.union([formattingMarkSchema, linkMarkSchema]);

const contentTextNodeSchema: z.ZodType<ContentTextNode> = z.object({
  type: z.literal("text"),
  text: z.string(),
  marks: z.array(contentMarkNodeSchema).optional(),
});
const contentHardBreakNodeSchema: z.ZodType<ContentHardBreakNode> = z.object({
  type: z.literal("hardBreak"),
});
const contentInlineNodeSchema = z.union([contentTextNodeSchema, contentHardBreakNodeSchema]);

const paragraphSchema: z.ZodType<ContentParagraphNode> = z.object({
  type: z.literal("paragraph"),
  content: z.array(contentInlineNodeSchema).optional(),
});
const headingLevelSchema = z.literal(ADMITTED_HEADING_LEVELS, {
  error: "A heading is H2, H3 or H4: level 1 is the managed title rather than prose, and levels 5 and 6 are not admitted.",
});
const headingSchema: z.ZodType<ContentHeadingNode> = z.object({
  type: z.literal("heading"),
  attrs: z.object({ level: headingLevelSchema }),
  content: z.array(contentInlineNodeSchema).optional(),
});
const codeTextSchema = z.object({ type: z.literal("text"), text: z.string() });

const codeBlockSchema: z.ZodType<ContentCodeBlockNode> = z.object({
  type: z.literal("codeBlock"),
  content: z.array(codeTextSchema).optional(),
});
// The four container schemas are mutually recursive through a list item, so each resolves its
// children through a deferred getter: no document shape can be written without the cycle, and the
// depth guard in the scan below keeps a hostile one from exhausting the stack while it is read.
const listItemSchema: z.ZodType<ContentListItemNode> = z.lazy(() => z.object({ type: z.literal("listItem"), content: blockSequenceSchema.optional() }));

const bulletListNodeSchema: z.ZodType<ContentBulletListNode> = z.lazy(() => z.object({ type: z.literal("bulletList"), content: z.array(listItemSchema).optional() }));

const orderedListNodeSchema: z.ZodType<ContentOrderedListNode> = z.lazy(() =>
  z.object({
    type: z.literal("orderedList"),
    attrs: z
      .object({
        start: z.number().int().min(0, "A numbered list starts at 0 or later.").optional(),
      })
      .optional(),
    content: z.array(listItemSchema).optional(),
  }),
);
const blockquoteSchema: z.ZodType<ContentBlockquoteNode> = z.lazy(() => z.object({ type: z.literal("blockquote"), content: blockSequenceSchema.optional() }));

const contentBlockNodeSchema: z.ZodType<ContentBlockNode> = z.lazy(() => z.union([paragraphSchema, headingSchema, bulletListNodeSchema, orderedListNodeSchema, blockquoteSchema, codeBlockSchema]));

const blockSequenceSchema: z.ZodType<readonly ContentBlockNode[]> = z.lazy(() => z.array(contentBlockNodeSchema));
/** The four bounded presentation choices of a section, each drawn from {@link PRESENTATION_CHOICES}. */
export interface PresentationChoice {
  readonly treatment: (typeof PRESENTATION_CHOICES)["treatment"][number];
  readonly layout: (typeof PRESENTATION_CHOICES)["layout"][number];
  readonly alignment: (typeof PRESENTATION_CHOICES)["alignment"][number];
  readonly imageFit: (typeof PRESENTATION_CHOICES)["imageFit"][number];
}
/** Validates one section's presentation choices; a value outside its set is invalid, never coerced. */
export const presentationChoiceSchema: z.ZodType<PresentationChoice> = z.strictObject({
  treatment: z.enum(PRESENTATION_CHOICES.treatment, {
    error: "Treatment is normal or emphasized.",
  }),
  layout: z.enum(PRESENTATION_CHOICES.layout, {
    error: "Layout is single-column or two-column-image-text.",
  }),
  alignment: z.enum(PRESENTATION_CHOICES.alignment, { error: "Alignment is start or center." }),
  imageFit: z.enum(PRESENTATION_CHOICES.imageFit, { error: "Image fit is cover or contain." }),
});
/** Validates one composed section: the catalogue element it was composed from, its plain-text field values stored verbatim, and its admitted presentation choices. */
export const sectionSchema: z.ZodType<ContentSection> = z.strictObject({
  element: z.string().superRefine((value, ctx) => {
    if (value.trim().length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "A section states the catalogue element it was composed from.",
      });
    }
  }),
  fields: z.record(z.string(), z.string()),
  presentation: presentationChoiceSchema,
  direction: z.enum(CONTENT_DIRECTIONS, { error: "A section reads ltr or rtl." }).optional(),
});
/** Validates a whole stored or submitted document: the Tiptap document root, its profile version, its direction, its prose body and its composed sections. */
export const contentDocumentSchema: z.ZodType<ContentDocumentJson> = z.strictObject({
  type: z.literal("doc", "A content document's root node is the Tiptap document."),
  profileVersion: z.literal(CONTENT_PROFILE_VERSION, `A content document states content profile version ${CONTENT_PROFILE_VERSION}.`),
  direction: z.enum(CONTENT_DIRECTIONS, {
    error: "A document states its direction as ltr or rtl.",
  }),
  content: blockSequenceSchema,
  sections: z.array(sectionSchema),
});
// The scan: what a schema cannot phrase, reported before the schema runs
const BIDI_CONTROL_PATTERN = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/;

const BIDI_CONTROL_PATTERN_GLOBAL = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

function bidiControlIndex(text: string): number | undefined {
  const match = BIDI_CONTROL_PATTERN.exec(text);
  return match === null ? undefined : match.index;
}
function codePointLabel(codeUnit: number): string {
  return `U+${codeUnit.toString(16).toUpperCase().padStart(4, "0")}`;
}
function stripBidiControls(text: string): string {
  return text.replace(BIDI_CONTROL_PATTERN_GLOBAL, "");
}
function checkTextHasNoBidiControl(value: string, path: string, issues: DocumentIssue[]): void {
  const index = bidiControlIndex(value);
  if (index === undefined) {
    return;
  }
  issues.push({
    path,
    message: `Text contains the bidi control character ${codePointLabel(value.charCodeAt(index))}: direction is a document property, so no directional mark is stored in content.`,
  });
}
function scanMarks(marks: readonly unknown[], path: string, issues: DocumentIssue[]): void {
  marks.forEach((mark, index) => {
    const markPath = `${path}.${index}`;
    if (!isRecord(mark)) {
      issues.push({ path: markPath, message: "Each mark must be an object." });
      return;
    }
    const markType = mark["type"];
    if (typeof markType !== "string") {
      issues.push({ path: `${markPath}.type`, message: "Each mark must state its type." });
      return;
    }
    if (!ADMITTED_MARK_TYPE_SET.has(markType)) {
      issues.push({
        path: `${markPath}.type`,
        message: `"${markType}" is not an admitted mark; the admitted marks are ${ADMITTED_MARK_TYPES.join(", ")}.`,
      });
      return;
    }
    if (markType !== "link") {
      return;
    }
    const attrs = mark["attrs"];
    const href = isRecord(attrs) ? attrs["href"] : undefined;
    if (typeof href !== "string") {
      issues.push({ path: `${markPath}.attrs.href`, message: "A link states its destination." });
      return;
    }
    checkTextHasNoBidiControl(href, `${markPath}.attrs.href`, issues);
    const problem = linkHrefProblem(href);
    if (problem !== undefined) {
      issues.push({ path: `${markPath}.attrs.href`, message: problem });
    }
  });
}
function scanHeadingAttrs(attrs: unknown, path: string, issues: DocumentIssue[]): void {
  if (!isRecord(attrs)) {
    return;
  }
  const level = attrs["level"];
  if (typeof level !== "number" || ADMITTED_HEADING_LEVEL_SET.has(level)) {
    return;
  }
  issues.push({
    path: `${path}.level`,
    message: `Heading level ${level} is not admitted; this profile admits H2, H3 and H4, and level 1 is the managed title rather than prose.`,
  });
}
function scanNode(node: unknown, path: string, issues: DocumentIssue[], depth: number): void {
  if (depth > MAX_CONTENT_DEPTH) {
    issues.push({
      path,
      message: `Content nests deeper than ${MAX_CONTENT_DEPTH} levels, which this profile does not admit.`,
    });
    return;
  }
  if (!isRecord(node)) {
    issues.push({ path, message: "Each content node must be an object." });
    return;
  }
  const nodeType = node["type"];
  if (typeof nodeType !== "string") {
    issues.push({ path: `${path}.type`, message: "Each content node must state its type." });
    return;
  }
  if (!ADMITTED_NODE_TYPE_SET.has(nodeType)) {
    issues.push({
      path: `${path}.type`,
      message: `"${nodeType}" is not an admitted content node; the admitted nodes are ${ADMITTED_NODE_TYPES.join(", ")}.`,
    });
    return;
  }
  const marks = node["marks"];
  if (Array.isArray(marks)) {
    if (nodeType === "text") {
      scanMarks(marks, `${path}.marks`, issues);
    } else {
      // A mark formats text, so only a text node can carry one. The schemas declare `marks` on text
      // alone and would strip it elsewhere, which is the silent loss this profile refuses to make.
      issues.push({
        path: `${path}.marks`,
        message: `A mark formats text, so a "${nodeType}" node cannot carry marks.`,
      });
    }
  }
  if (nodeType === "text") {
    const text = node["text"];
    if (typeof text === "string") {
      checkTextHasNoBidiControl(text, `${path}.text`, issues);
    }
    return;
  }
  if (nodeType === "heading") {
    scanHeadingAttrs(node["attrs"], `${path}.attrs`, issues);
  }
  const children = node["content"];
  if (Array.isArray(children)) {
    children.forEach((child, index) => {
      scanNode(child, `${path}.content.${index}`, issues, depth + 1);
    });
  }
}
function scanSection(section: unknown, path: string, issues: DocumentIssue[]): void {
  if (!isRecord(section)) {
    return;
  }
  const element = section["element"];
  if (typeof element === "string") {
    checkTextHasNoBidiControl(element, `${path}.element`, issues);
  }
  const fields = section["fields"];
  if (!isRecord(fields)) {
    return;
  }
  for (const key of Object.keys(fields)) {
    const value = fields[key];
    if (typeof value === "string") {
      checkTextHasNoBidiControl(value, `${path}.fields.${key}`, issues);
    }
  }
}
function scanDocument(input: unknown): DocumentIssue[] {
  if (!isRecord(input)) {
    return [{ path: "", message: "A content document must be an object." }];
  }
  const issues: DocumentIssue[] = [];
  const documentType = input["type"];
  if (documentType !== "doc") {
    issues.push({
      path: "type",
      message: 'A content document\'s root node is the Tiptap document, so its type is "doc".',
    });
  }
  const profileVersion = input["profileVersion"];
  if (typeof profileVersion !== "number") {
    issues.push({
      path: "profileVersion",
      message: "A content document states the content profile version it was written against.",
    });
  } else if (profileVersion !== CONTENT_PROFILE_VERSION) {
    issues.push({
      path: "profileVersion",
      message: `Content profile version ${profileVersion} is not admitted: this build reads and writes version ${CONTENT_PROFILE_VERSION} only, so the document is not migrated silently.`,
    });
  }
  const content = input["content"];
  if (Array.isArray(content)) {
    content.forEach((node, index) => {
      scanNode(node, `content.${index}`, issues, 0);
    });
  }
  const sections = input["sections"];
  if (Array.isArray(sections)) {
    sections.forEach((section, index) => {
      scanSection(section, `sections.${index}`, issues);
    });
  }
  return issues;
}
interface ZodIssueLike {
  readonly path?: readonly PropertyKey[];
  readonly message?: string;
  readonly errors?: readonly (readonly ZodIssueLike[])[];
}
function appendZodIssues(issues: readonly ZodIssueLike[], prefix: readonly string[], out: DocumentIssue[], seen: Set<string>): void {
  for (const issue of issues) {
    const path = [...prefix, ...(issue.path ?? []).map((segment) => String(segment))];
    const nested = issue.errors;
    if (nested !== undefined) {
      for (const group of nested) {
        appendZodIssues(group, path, out, seen);
      }
      continue;
    }
    const message = issue.message ?? "This value is not admitted.";
    const key = `${path.join(".")}|${message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({ path: path.join("."), message });
  }
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
/** Validates untrusted document input — a stored revision body, a submitted draft or a parsed paste — and reports every problem at the path the authoring form uses for that field. */
export function parseDocument(input: unknown): ParseDocumentResult {
  try {
    const issues = scanDocument(input);
    if (issues.length > 0) {
      return { status: "invalid", issues };
    }
    const parsed = contentDocumentSchema.safeParse(input);
    if (!parsed.success) {
      const mapped: DocumentIssue[] = [];
      appendZodIssues(parsed.error.issues, [], mapped, new Set<string>());
      return {
        status: "invalid",
        issues: mapped.length > 0 ? mapped : [{ path: "", message: "The content document could not be read." }],
      };
    }
    return { status: "valid", document: parsed.data };
  } catch (error) {
    return {
      status: "invalid",
      issues: [{ path: "", message: `The content document could not be read: ${errorMessage(error)}` }],
    };
  }
}
// Canonical serialisation and the change-detection checksum
function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalise);
  }
  if (isRecord(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalise(value[key]);
    }
    return sorted;
  }
  return value;
}
/** Serialises a parsed document to its canonical form: keys sorted, no insignificant whitespace, array order preserved, no `Date` and no locale-dependent formatting. */
export function serialise(document: ContentDocumentJson): string {
  return JSON.stringify(canonicalise(document));
}
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
/** A deterministic 32-bit FNV-1a digest of the canonical serialisation, as eight lowercase hex digits. */
export function checksum(document: ContentDocumentJson): string {
  const input = serialise(document);
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < input.length; index += 1) {
    const unit = input.charCodeAt(index);
    hash = Math.imul(hash ^ (unit & 0xff), FNV_PRIME);
    hash = Math.imul(hash ^ (unit >>> 8), FNV_PRIME);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
// The deliberate paste decision
/** The three answers the paste prompt offers; nothing is pasted without one of them. */
export type PasteDecision = "convert" | "plain-text" | "cancel";
/** What the editor hands over when an author pastes: the clipboard parsed into Tiptap JSON by the editor's own schema, the clipboard's plain text, or both. */
export interface PasteInput {
  readonly json?: unknown;
  readonly text?: string;
}
/** Converted clipboard content: admitted block nodes, ready to insert at the selection. */
export interface PasteDocumentFragment {
  readonly type: "doc";
  readonly content: readonly ContentBlockNode[];
}
/** The outcome of one paste decision. */
export type PasteOutcome =
  | {
      readonly status: "converted";
      readonly content: PasteDocumentFragment;
      readonly dropped: readonly string[];
    }
  | { readonly status: "plain-text"; readonly content: ContentTextNode }
  | { readonly status: "cancelled"; readonly content: null };
interface DroppedNames {
  note(name: string): void;
  list(): readonly string[];
}
function createDroppedNames(): DroppedNames {
  const names: string[] = [];
  const seen = new Set<string>();
  return {
    note(name: string): void {
      if (!seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    },
    list(): readonly string[] {
      return names;
    },
  };
}
function childrenOf(node: Record<string, unknown>): readonly unknown[] {
  const content = node["content"];
  return Array.isArray(content) ? content : [];
}
function pasteNodeCandidates(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (!isRecord(value)) {
    return [];
  }
  const content = value["content"];
  if (typeof value["type"] === "string") {
    return value["type"] === "doc" && Array.isArray(content) ? content : [value];
  }
  return Array.isArray(content) ? content : [];
}
function plainTextOf(value: unknown, depth = 0): string {
  if (depth > MAX_CONTENT_DEPTH) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => plainTextOf(item, depth + 1))
      .join(" ")
      .trim();
  }
  if (!isRecord(value)) {
    return "";
  }
  const text = value["text"];
  if (typeof text === "string") {
    return text;
  }
  return value.content === undefined ? "" : plainTextOf(value["content"], depth + 1);
}
function paragraphOfText(text: string): ContentParagraphNode | undefined {
  if (text.trim().length === 0) {
    return undefined;
  }
  return { type: "paragraph", content: [{ type: "text", text }] };
}
function paragraphWith(inline: readonly ContentInlineNode[]): ContentParagraphNode {
  return inline.length === 0 ? { type: "paragraph" } : { type: "paragraph", content: inline };
}
function headingLevelOf(level: number): ContentHeadingNode["attrs"]["level"] | undefined {
  switch (level) {
    case 2:
      return 2;
    case 3:
      return 3;
    case 4:
      return 4;
    default:
      return undefined;
  }
}
function formattingMarkOf(markType: string): ContentFormattingMark | undefined {
  switch (markType) {
    case "bold":
      return { type: "bold" };
    case "italic":
      return { type: "italic" };
    case "strike":
      return { type: "strike" };
    case "underline":
      return { type: "underline" };
    case "code":
      return { type: "code" };
    default:
      return undefined;
  }
}
function convertMarks(value: unknown, dropped: DroppedNames): ContentMarkNode[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const marks: ContentMarkNode[] = [];
  const kept = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    const markType = item["type"];
    if (typeof markType !== "string") {
      continue;
    }
    if (!ADMITTED_MARK_TYPE_SET.has(markType)) {
      dropped.note(markType);
      continue;
    }
    if (markType === "link") {
      const attrs = item["attrs"];
      const href = isRecord(attrs) ? attrs["href"] : undefined;
      // A paste from a browser can carry a `javascript:` or relative destination; the text it wrapped
      // is still worth keeping, so the mark is dropped and disclosed while the text stays.
      if (typeof href !== "string" || linkHrefProblem(href) !== undefined) {
        dropped.note("link");
        continue;
      }
      if (kept.has("link")) {
        continue;
      }
      kept.add("link");
      marks.push({ type: "link", attrs: { href: stripBidiControls(href) } });
      continue;
    }
    const formatting = formattingMarkOf(markType);
    if (formatting === undefined || kept.has(formatting.type)) {
      continue;
    }
    kept.add(formatting.type);
    marks.push(formatting);
  }
  return marks;
}
function convertInlineNodes(values: readonly unknown[], dropped: DroppedNames): ContentInlineNode[] {
  const inline: ContentInlineNode[] = [];
  for (const value of values) {
    if (typeof value === "string") {
      const text = stripBidiControls(value);
      if (text.length > 0) {
        inline.push({ type: "text", text });
      }
      continue;
    }
    if (!isRecord(value)) {
      continue;
    }
    const nodeType = value["type"];
    if (nodeType === "hardBreak") {
      inline.push({ type: "hardBreak" });
      continue;
    }
    if (nodeType !== "text") {
      // An inline position can only hold text or a line break; anything else here is a structure the
      // profile does not admit, so it is named rather than pasted as an unrenderable node.
      if (typeof nodeType === "string") {
        dropped.note(nodeType);
      }
      continue;
    }
    const rawText = value["text"];
    const text = typeof rawText === "string" ? stripBidiControls(rawText) : "";
    if (text.length === 0) {
      continue;
    }
    const marks = convertMarks(value["marks"], dropped);
    inline.push(marks.length === 0 ? { type: "text", text } : { type: "text", text, marks });
  }
  return inline;
}
function convertListItems(values: readonly unknown[], dropped: DroppedNames, depth: number): ContentListItemNode[] {
  const items: ContentListItemNode[] = [];
  for (const value of values) {
    if (!isRecord(value)) {
      continue;
    }
    const nodeType = value["type"];
    if (nodeType !== "listItem" && typeof nodeType === "string" && !ADMITTED_NODE_TYPE_SET.has(nodeType)) {
      dropped.note(nodeType);
    }
    const content = convertBlockNodes(childrenOf(value), dropped, depth + 1);
    if (content.length > 0) {
      items.push({ type: "listItem", content });
    }
  }
  return items;
}
function convertBlockNode(value: unknown, dropped: DroppedNames, depth: number): ContentBlockNode | undefined {
  if (depth > MAX_CONTENT_DEPTH) {
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const nodeType = value["type"];
  if (typeof nodeType !== "string") {
    return undefined;
  }
  switch (nodeType) {
    case "paragraph":
      return paragraphWith(convertInlineNodes(childrenOf(value), dropped));
    case "heading": {
      const attrs = value["attrs"];
      const level = isRecord(attrs) ? attrs["level"] : undefined;
      const inline = convertInlineNodes(childrenOf(value), dropped);
      const admittedLevel = typeof level === "number" ? headingLevelOf(level) : undefined;
      if (admittedLevel !== undefined) {
        return { type: "heading", attrs: { level: admittedLevel }, content: inline };
      }
      // A pasted H1 is the managed title of another document, and H5/H6 are outside the authoring
      // surface: the text is kept as a paragraph and the level that was not kept is disclosed.
      dropped.note(typeof level === "number" ? `heading level ${level}` : "heading without a level");
      return paragraphWith(inline);
    }
    case "codeBlock": {
      const lines: string[] = [];
      for (const child of childrenOf(value)) {
        if (typeof child === "string") {
          lines.push(stripBidiControls(child));
          continue;
        }
        if (isRecord(child)) {
          const text = child["text"];
          if (typeof text === "string") {
            lines.push(stripBidiControls(text));
          }
        }
      }
      const code = lines.filter((line) => line.length > 0);
      return code.length === 0 ? { type: "codeBlock" } : { type: "codeBlock", content: [{ type: "text", text: code.join("\n") }] };
    }
    case "blockquote": {
      const content = convertBlockNodes(childrenOf(value), dropped, depth + 1);
      return content.length === 0 ? { type: "blockquote" } : { type: "blockquote", content };
    }
    case "bulletList":
    case "orderedList": {
      const items = convertListItems(childrenOf(value), dropped, depth + 1);
      if (items.length === 0) {
        return undefined;
      }
      if (nodeType === "bulletList") {
        return { type: "bulletList", content: items };
      }
      const attrs = value["attrs"];
      const start = isRecord(attrs) ? attrs["start"] : undefined;
      if (start === undefined) {
        return { type: "orderedList", content: items };
      }
      if (typeof start === "number" && Number.isInteger(start) && start >= 0) {
        return { type: "orderedList", attrs: { start }, content: items };
      }
      dropped.note("ordered list start");
      return { type: "orderedList", content: items };
    }
    case "hardBreak":
    case "text":
      // An inline node pasted where only a block fits keeps its text inside a paragraph.
      return paragraphWith(convertInlineNodes([value], dropped));
    default:
      dropped.note(nodeType);
      return undefined;
  }
}
function convertBlockNodes(values: readonly unknown[], dropped: DroppedNames, depth: number): ContentBlockNode[] {
  const blocks: ContentBlockNode[] = [];
  for (const value of values) {
    if (isRecord(value) && typeof value["type"] !== "string" && Array.isArray(value["content"])) {
      blocks.push(...convertBlockNodes(value["content"], dropped, depth + 1));
      continue;
    }
    const block = convertBlockNode(value, dropped, depth);
    if (block === undefined) {
      continue;
    }
    // Every produced node is proved against the schema, so a conversion can never hand the editor a
    // shape the profile would refuse on save.
    const parsed = contentBlockNodeSchema.safeParse(block);
    if (parsed.success) {
      blocks.push(parsed.data);
      continue;
    }
    dropped.note(block.type);
    const fallback = paragraphOfText(plainTextOf(block));
    if (fallback !== undefined) {
      blocks.push(fallback);
    }
  }
  return blocks;
}
/** Answers one paste. */
export function admittedPasteDecision(decision: PasteDecision, input: PasteInput): PasteOutcome {
  if (decision === "cancel") {
    return { status: "cancelled", content: null };
  }
  const source: PasteInput = isRecord(input) ? input : {};
  if (decision === "plain-text") {
    const text = typeof source.text === "string" ? stripBidiControls(source.text) : "";
    return { status: "plain-text", content: { type: "text", text } };
  }
  const dropped = createDroppedNames();
  const content = convertBlockNodes(pasteNodeCandidates(source.json), dropped, 0);
  return { status: "converted", content: { type: "doc", content }, dropped: dropped.list() };
}
