import { z } from "zod";
import { isRecord } from "@/lib/guards";
export const CONTENT_PROFILE_VERSION = 1;
export const CONTENT_DIRECTIONS = ["ltr", "rtl"] as const;
export type ContentDirection = (typeof CONTENT_DIRECTIONS)[number];
export const ADMITTED_HEADING_LEVELS = [2, 3, 4] as const;
export const ADMITTED_NODE_TYPES = ["paragraph", "heading", "bulletList", "orderedList", "listItem", "blockquote", "codeBlock", "hardBreak", "text"] as const;
export type AdmittedNodeType = (typeof ADMITTED_NODE_TYPES)[number];
export const FORMATTING_MARK_TYPES = ["bold", "italic", "strike", "underline", "code"] as const;
export const LINK_MARK_TYPE = "link" as const;
export const ADMITTED_MARK_TYPES = [...FORMATTING_MARK_TYPES, LINK_MARK_TYPE] as const;
export type AdmittedMarkType = (typeof ADMITTED_MARK_TYPES)[number];
const ADMITTED_NODE_TYPE_SET: ReadonlySet<string> = new Set(ADMITTED_NODE_TYPES);
const ADMITTED_MARK_TYPE_SET: ReadonlySet<string> = new Set(ADMITTED_MARK_TYPES);
const ADMITTED_HEADING_LEVEL_SET: ReadonlySet<number> = new Set(ADMITTED_HEADING_LEVELS);
export const PRESENTATION_CHOICES = { treatment: ["normal", "emphasized"], layout: ["single-column", "two-column-image-text"], alignment: ["start", "center"], imageFit: ["cover", "contain"] } as const;
const MAX_CONTENT_DEPTH = 64;
export type ContentFormattingMark = { readonly type: (typeof FORMATTING_MARK_TYPES)[number] };
export type ContentLinkMark = { readonly type: typeof LINK_MARK_TYPE; readonly attrs: { readonly href: string } };
export type ContentMarkNode = ContentFormattingMark | ContentLinkMark;
export type ContentTextNode = { readonly type: "text"; readonly text: string; readonly marks?: readonly ContentMarkNode[] };
export type ContentHardBreakNode = { readonly type: "hardBreak" };
export type ContentInlineNode = ContentTextNode | ContentHardBreakNode;
export type ContentParagraphNode = { readonly type: "paragraph"; readonly content?: readonly ContentInlineNode[] };
export type ContentHeadingNode = { readonly type: "heading"; readonly attrs: { readonly level: (typeof ADMITTED_HEADING_LEVELS)[number] }; readonly content?: readonly ContentInlineNode[] };
export type ContentListItemNode = { readonly type: "listItem"; readonly content?: readonly ContentBlockNode[] };
export type ContentBulletListNode = { readonly type: "bulletList"; readonly content?: readonly ContentListItemNode[] };
export type ContentOrderedListNode = { readonly type: "orderedList"; readonly attrs?: { readonly start?: number }; readonly content?: readonly ContentListItemNode[] };
export type ContentBlockquoteNode = { readonly type: "blockquote"; readonly content?: readonly ContentBlockNode[] };
export type ContentCodeTextNode = { readonly type: "text"; readonly text: string };
export type ContentCodeBlockNode = { readonly type: "codeBlock"; readonly content?: readonly ContentCodeTextNode[] };
export type ContentBlockNode = ContentParagraphNode | ContentHeadingNode | ContentBulletListNode | ContentOrderedListNode | ContentBlockquoteNode | ContentCodeBlockNode;
export type ContentSection = { readonly element: string; readonly fields: Readonly<Record<string, string>>; readonly presentation: PresentationChoice; readonly direction?: ContentDirection };
export type ContentDocumentJson = { readonly type: "doc"; readonly profileVersion: typeof CONTENT_PROFILE_VERSION; readonly direction: ContentDirection; readonly content: readonly ContentBlockNode[]; readonly sections: readonly ContentSection[] };
export type DocumentIssue = { readonly path: string; readonly message: string };
export type ParseDocumentResult = { readonly status: "valid"; readonly document: ContentDocumentJson } | { readonly status: "invalid"; readonly issues: readonly DocumentIssue[] };
function linkHrefProblem(href: string): string | undefined {
  if (href.length === 0) return "A link needs a destination.";
  if (href.startsWith("//")) return "A link may not be protocol-relative: use an https URL or a path beginning with /.";
  if (href.startsWith("/")) return undefined;
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(href)?.[1]?.toLowerCase();
  if (scheme === undefined) return "A link is an absolute https URL or a path beginning with /.";
  return scheme !== "http" && scheme !== "https" ? `A link may not use the "${scheme}:" scheme: use an https URL or a path beginning with /.` : /^https?:\/\/[^\s/]/.test(href) ? undefined : "An http(s) link needs a host.";
}
const linkHrefSchema = z.string().superRefine((href, ctx) => {
  const problem = linkHrefProblem(href);
  if (problem !== undefined) ctx.addIssue({ code: "custom", message: problem });
});
const formattingMarkSchema: z.ZodType<ContentFormattingMark> = z.object({ type: z.literal(FORMATTING_MARK_TYPES) });
const linkMarkSchema: z.ZodType<ContentLinkMark> = z.object({ type: z.literal(LINK_MARK_TYPE), attrs: z.object({ href: linkHrefSchema }) });
const contentMarkNodeSchema = z.union([formattingMarkSchema, linkMarkSchema]);
const contentTextNodeSchema: z.ZodType<ContentTextNode> = z.object({ type: z.literal("text"), text: z.string(), marks: z.array(contentMarkNodeSchema).optional() });
const contentHardBreakNodeSchema: z.ZodType<ContentHardBreakNode> = z.object({ type: z.literal("hardBreak") });
const contentInlineNodeSchema = z.union([contentTextNodeSchema, contentHardBreakNodeSchema]);
const paragraphSchema: z.ZodType<ContentParagraphNode> = z.object({ type: z.literal("paragraph"), content: z.array(contentInlineNodeSchema).optional() });
const headingLevelSchema = z.literal(ADMITTED_HEADING_LEVELS, { error: "A heading is H2, H3 or H4: level 1 is the managed title rather than prose, and levels 5 and 6 are not admitted." });
const headingSchema: z.ZodType<ContentHeadingNode> = z.object({ type: z.literal("heading"), attrs: z.object({ level: headingLevelSchema }), content: z.array(contentInlineNodeSchema).optional() });
const codeTextSchema = z.object({ type: z.literal("text"), text: z.string() });
const codeBlockSchema: z.ZodType<ContentCodeBlockNode> = z.object({ type: z.literal("codeBlock"), content: z.array(codeTextSchema).optional() });
const listItemSchema: z.ZodType<ContentListItemNode> = z.lazy(() => z.object({ type: z.literal("listItem"), content: blockSequenceSchema.optional() }));
const bulletListNodeSchema: z.ZodType<ContentBulletListNode> = z.lazy(() => z.object({ type: z.literal("bulletList"), content: z.array(listItemSchema).optional() }));
const orderedListNodeSchema: z.ZodType<ContentOrderedListNode> = z.lazy(() => z.object({ type: z.literal("orderedList"), attrs: z.object({ start: z.number().int().min(0, "A numbered list starts at 0 or later.").optional() }).optional(), content: z.array(listItemSchema).optional() }));
const blockquoteSchema: z.ZodType<ContentBlockquoteNode> = z.lazy(() => z.object({ type: z.literal("blockquote"), content: blockSequenceSchema.optional() }));
const contentBlockNodeSchema: z.ZodType<ContentBlockNode> = z.lazy(() => z.union([paragraphSchema, headingSchema, bulletListNodeSchema, orderedListNodeSchema, blockquoteSchema, codeBlockSchema]));
const blockSequenceSchema: z.ZodType<readonly ContentBlockNode[]> = z.lazy(() => z.array(contentBlockNodeSchema));
export type PresentationChoice = { readonly treatment: (typeof PRESENTATION_CHOICES)["treatment"][number]; readonly layout: (typeof PRESENTATION_CHOICES)["layout"][number]; readonly alignment: (typeof PRESENTATION_CHOICES)["alignment"][number]; readonly imageFit: (typeof PRESENTATION_CHOICES)["imageFit"][number] };
export const presentationChoiceSchema: z.ZodType<PresentationChoice> = z.strictObject({
  treatment: z.enum(PRESENTATION_CHOICES.treatment, { error: "Treatment is normal or emphasized." }),
  layout: z.enum(PRESENTATION_CHOICES.layout, { error: "Layout is single-column or two-column-image-text." }),
  alignment: z.enum(PRESENTATION_CHOICES.alignment, { error: "Alignment is start or center." }),
  imageFit: z.enum(PRESENTATION_CHOICES.imageFit, { error: "Image fit is cover or contain." }),
});
export const sectionSchema: z.ZodType<ContentSection> = z.strictObject({
  element: z.string().superRefine((value, ctx) => {
    if (value.trim().length === 0) ctx.addIssue({ code: "custom", message: "A section states the catalogue element it was composed from." });
  }),
  fields: z.record(z.string(), z.string()),
  presentation: presentationChoiceSchema,
  direction: z.enum(CONTENT_DIRECTIONS, { error: "A section reads ltr or rtl." }).optional(),
});
export const contentDocumentSchema: z.ZodType<ContentDocumentJson> = z.strictObject({
  type: z.literal("doc", "A content document's root node is the Tiptap document."),
  profileVersion: z.literal(CONTENT_PROFILE_VERSION, `A content document states content profile version ${CONTENT_PROFILE_VERSION}.`),
  direction: z.enum(CONTENT_DIRECTIONS, { error: "A document states its direction as ltr or rtl." }),
  content: blockSequenceSchema,
  sections: z.array(sectionSchema),
});
const BIDI_CONTROL_PATTERN = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/;
const BIDI_CONTROL_PATTERN_GLOBAL = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
const bidiControlIndex = (text: string): number | undefined => BIDI_CONTROL_PATTERN.exec(text)?.index;
const codePointLabel = (codeUnit: number): string => `U+${codeUnit.toString(16).toUpperCase().padStart(4, "0")}`;
const stripBidiControls = (text: string): string => text.replace(BIDI_CONTROL_PATTERN_GLOBAL, "");
function checkTextHasNoBidiControl(value: string, path: string, issues: DocumentIssue[]): void {
  const index = bidiControlIndex(value);
  if (index === undefined) return;
  issues.push({ path, message: `Text contains the bidi control character ${codePointLabel(value.charCodeAt(index))}: direction is a document property, so no directional mark is stored in content.` });
}
const scanMarks = (marks: readonly unknown[], path: string, issues: DocumentIssue[]): void =>
  void marks.forEach((mark, index) => {
    const markPath = `${path}.${index}`;
    if (!isRecord(mark)) return void issues.push({ path: markPath, message: "Each mark must be an object." });
    const markType = mark["type"];
    if (typeof markType !== "string") return void issues.push({ path: `${markPath}.type`, message: "Each mark must state its type." });
    if (!ADMITTED_MARK_TYPE_SET.has(markType)) return void issues.push({ path: `${markPath}.type`, message: `"${markType}" is not an admitted mark; the admitted marks are ${ADMITTED_MARK_TYPES.join(", ")}.` });
    if (markType !== "link") return;
    const attrs = mark["attrs"];
    const href = isRecord(attrs) ? attrs["href"] : undefined;
    if (typeof href !== "string") return void issues.push({ path: `${markPath}.attrs.href`, message: "A link states its destination." });
    checkTextHasNoBidiControl(href, `${markPath}.attrs.href`, issues);
    const problem = linkHrefProblem(href);
    if (problem !== undefined) issues.push({ path: `${markPath}.attrs.href`, message: problem });
  });
function scanHeadingAttrs(attrs: unknown, path: string, issues: DocumentIssue[]): void {
  if (!isRecord(attrs)) return;
  const level = attrs["level"];
  if (typeof level !== "number" || ADMITTED_HEADING_LEVEL_SET.has(level)) return;
  issues.push({ path: `${path}.level`, message: `Heading level ${level} is not admitted; this profile admits H2, H3 and H4, and level 1 is the managed title rather than prose.` });
}
function scanNode(node: unknown, path: string, issues: DocumentIssue[], depth: number): void {
  if (depth > MAX_CONTENT_DEPTH) return void issues.push({ path, message: `Content nests deeper than ${MAX_CONTENT_DEPTH} levels, which this profile does not admit.` });
  if (!isRecord(node)) return void issues.push({ path, message: "Each content node must be an object." });
  const nodeType = node["type"];
  if (typeof nodeType !== "string") return void issues.push({ path: `${path}.type`, message: "Each content node must state its type." });
  if (!ADMITTED_NODE_TYPE_SET.has(nodeType)) return void issues.push({ path: `${path}.type`, message: `"${nodeType}" is not an admitted content node; the admitted nodes are ${ADMITTED_NODE_TYPES.join(", ")}.` });
  const marks = node["marks"];
  if (Array.isArray(marks))
    if (nodeType === "text") scanMarks(marks, `${path}.marks`, issues);
    else issues.push({ path: `${path}.marks`, message: `A mark formats text, so a "${nodeType}" node cannot carry marks.` });
  if (nodeType === "text") {
    const text = node["text"];
    if (typeof text === "string") checkTextHasNoBidiControl(text, `${path}.text`, issues);
    return;
  }
  if (nodeType === "heading") scanHeadingAttrs(node["attrs"], `${path}.attrs`, issues);
  const children = node["content"];
  if (Array.isArray(children)) children.forEach((child, index) => scanNode(child, `${path}.content.${index}`, issues, depth + 1));
}
function scanSection(section: unknown, path: string, issues: DocumentIssue[]): void {
  if (!isRecord(section)) return;
  const element = section["element"];
  if (typeof element === "string") checkTextHasNoBidiControl(element, `${path}.element`, issues);
  const fields = section["fields"];
  if (!isRecord(fields)) return;
  for (const [key, value] of Object.entries(fields)) if (typeof value === "string") checkTextHasNoBidiControl(value, `${path}.fields.${key}`, issues);
}
function scanDocument(input: unknown): DocumentIssue[] {
  if (!isRecord(input)) return [{ path: "", message: "A content document must be an object." }];
  const issues: DocumentIssue[] = [];
  if (input["type"] !== "doc") issues.push({ path: "type", message: 'A content document\'s root node is the Tiptap document, so its type is "doc".' });
  const profileVersion = input["profileVersion"];
  if (typeof profileVersion !== "number") issues.push({ path: "profileVersion", message: "A content document states the content profile version it was written against." });
  else if (profileVersion !== CONTENT_PROFILE_VERSION) issues.push({ path: "profileVersion", message: `Content profile version ${profileVersion} is not admitted: this build reads and writes version ${CONTENT_PROFILE_VERSION} only, so the document is not migrated silently.` });
  const content = input["content"];
  if (Array.isArray(content)) content.forEach((node, index) => scanNode(node, `content.${index}`, issues, 0));
  const sections = input["sections"];
  if (Array.isArray(sections)) sections.forEach((section, index) => scanSection(section, `sections.${index}`, issues));
  return issues;
}
type ZodIssueLike = { readonly path?: readonly PropertyKey[]; readonly message?: string; readonly errors?: readonly (readonly ZodIssueLike[])[] };
function appendZodIssues(issues: readonly ZodIssueLike[], prefix: readonly string[], out: DocumentIssue[], seen: Set<string>): void {
  for (const issue of issues) {
    const path = [...prefix, ...(issue.path ?? []).map((segment) => String(segment))];
    const nested = issue.errors;
    if (nested !== undefined) {
      for (const group of nested) appendZodIssues(group, path, out, seen);
      continue;
    }
    const message = issue.message ?? "This value is not admitted.";
    const key = `${path.join(".")}|${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path: path.join("."), message });
  }
}
const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));
/** Validates untrusted document input — a stored revision body, a submitted draft or a parsed paste — and reports every problem at the path the authoring form uses for that field. */ export function parseDocument(input: unknown): ParseDocumentResult {
  try {
    const issues = scanDocument(input);
    if (issues.length > 0) return { status: "invalid", issues };
    const parsed = contentDocumentSchema.safeParse(input);
    if (!parsed.success) {
      const mapped: DocumentIssue[] = [];
      appendZodIssues(parsed.error.issues, [], mapped, new Set<string>());
      return { status: "invalid", issues: mapped.length > 0 ? mapped : [{ path: "", message: "The content document could not be read." }] };
    }
    return { status: "valid", document: parsed.data };
  } catch (error) {
    return { status: "invalid", issues: [{ path: "", message: `The content document could not be read: ${errorMessage(error)}` }] };
  }
}
function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (isRecord(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) sorted[key] = canonicalise(value[key]);
    return sorted;
  }
  return value;
}
export const serialise = (document: ContentDocumentJson): string => JSON.stringify(canonicalise(document));
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
/** A deterministic 32-bit FNV-1a digest of the canonical serialisation, as eight lowercase hex digits: change detection only, because 32 bits collide. A document, variant, revision or release is identified by its own identifier, so no digest here is ever the sole comparison of two renditions. */
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
export type PasteDecision = "convert" | "plain-text" | "cancel";
export type PasteInput = { readonly json?: unknown; readonly text?: string };
export type PasteDocumentFragment = { readonly type: "doc"; readonly content: readonly ContentBlockNode[] };
export type PasteOutcome = { readonly status: "converted"; readonly content: PasteDocumentFragment; readonly dropped: readonly string[] } | { readonly status: "plain-text"; readonly content: ContentTextNode } | { readonly status: "cancelled"; readonly content: null };
type DroppedNames = { note(name: string): void; list(): readonly string[] };
function createDroppedNames(): DroppedNames {
  const names: string[] = [];
  const seen = new Set<string>();
  return {
    note(name: string): void {
      if (seen.has(name)) return;
      seen.add(name);
      names.push(name);
    },
    list: () => names,
  };
}
const childrenOf = (node: Record<string, unknown>): readonly unknown[] => (Array.isArray(node["content"]) ? node["content"] : []);
function pasteNodeCandidates(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  const content = value["content"];
  return typeof value["type"] === "string" ? (value["type"] === "doc" && Array.isArray(content) ? content : [value]) : Array.isArray(content) ? content : [];
}
function plainTextOf(value: unknown, depth = 0): string {
  if (depth > MAX_CONTENT_DEPTH) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value))
    return value
      .map((item) => plainTextOf(item, depth + 1))
      .join(" ")
      .trim();
  if (!isRecord(value)) return "";
  const text = value["text"];
  return typeof text === "string" ? text : value.content === undefined ? "" : plainTextOf(value["content"], depth + 1);
}
const paragraphOfText = (text: string): ContentParagraphNode | undefined => (text.trim().length === 0 ? undefined : { type: "paragraph", content: [{ type: "text", text }] });
const paragraphWith = (inline: readonly ContentInlineNode[]): ContentParagraphNode => (inline.length === 0 ? { type: "paragraph" } : { type: "paragraph", content: inline });
const headingLevelOf = (level: number): ContentHeadingNode["attrs"]["level"] | undefined => ADMITTED_HEADING_LEVELS.find((admitted) => admitted === level);
const FORMATTING_MARKS: Readonly<Record<(typeof FORMATTING_MARK_TYPES)[number], ContentFormattingMark>> = Object.freeze({ bold: { type: "bold" }, italic: { type: "italic" }, strike: { type: "strike" }, underline: { type: "underline" }, code: { type: "code" } });
const formattingMarkOf = (markType: string): ContentFormattingMark | undefined => FORMATTING_MARKS[markType as ContentFormattingMark["type"]];
function convertMarks(value: unknown, dropped: DroppedNames): ContentMarkNode[] {
  if (!Array.isArray(value)) return [];
  const kept = new Set<string>();
  return value.flatMap((item): ContentMarkNode[] => {
    if (!isRecord(item) || typeof item["type"] !== "string") return [];
    const markType = item["type"];
    if (!ADMITTED_MARK_TYPE_SET.has(markType)) {
      dropped.note(markType);
      return [];
    }
    if (markType !== "link") {
      const formatting = formattingMarkOf(markType);
      if (formatting === undefined || kept.has(formatting.type)) return [];
      kept.add(formatting.type);
      return [formatting];
    }
    const attrs = item["attrs"];
    const href = isRecord(attrs) ? attrs["href"] : undefined;
    if (typeof href !== "string" || linkHrefProblem(href) !== undefined) {
      dropped.note("link");
      return [];
    }
    if (kept.has("link")) return [];
    kept.add("link");
    return [{ type: "link", attrs: { href: stripBidiControls(href) } }];
  });
}
const convertInlineNodes = (values: readonly unknown[], dropped: DroppedNames): ContentInlineNode[] =>
  values.flatMap((value): ContentInlineNode[] => {
    if (typeof value === "string") {
      const text = stripBidiControls(value);
      return text.length > 0 ? [{ type: "text", text }] : [];
    }
    if (!isRecord(value)) return [];
    const nodeType = value["type"];
    if (nodeType === "hardBreak") return [{ type: "hardBreak" }];
    if (nodeType !== "text") {
      if (typeof nodeType === "string") dropped.note(nodeType);
      return [];
    }
    const rawText = value["text"];
    const text = typeof rawText === "string" ? stripBidiControls(rawText) : "";
    if (text.length === 0) return [];
    const marks = convertMarks(value["marks"], dropped);
    return [marks.length === 0 ? { type: "text", text } : { type: "text", text, marks }];
  });
const convertListItems = (values: readonly unknown[], dropped: DroppedNames, depth: number): ContentListItemNode[] =>
  values.flatMap((value) => {
    if (!isRecord(value)) return [];
    const nodeType = value["type"];
    if (nodeType !== "listItem" && typeof nodeType === "string" && !ADMITTED_NODE_TYPE_SET.has(nodeType)) dropped.note(nodeType);
    const content = convertBlockNodes(childrenOf(value), dropped, depth + 1);
    return content.length > 0 ? [{ type: "listItem", content }] : [];
  });
function convertBlockNode(value: unknown, dropped: DroppedNames, depth: number): ContentBlockNode | undefined {
  if (depth > MAX_CONTENT_DEPTH) return undefined;
  if (!isRecord(value)) return undefined;
  const nodeType = value["type"];
  if (typeof nodeType !== "string") return undefined;
  switch (nodeType) {
    case "paragraph":
      return paragraphWith(convertInlineNodes(childrenOf(value), dropped));
    case "heading": {
      const attrs = value["attrs"];
      const level = isRecord(attrs) ? attrs["level"] : undefined;
      const inline = convertInlineNodes(childrenOf(value), dropped);
      const admittedLevel = typeof level === "number" ? headingLevelOf(level) : undefined;
      if (admittedLevel !== undefined) return { type: "heading", attrs: { level: admittedLevel }, content: inline };
      dropped.note(typeof level === "number" ? `heading level ${level}` : "heading without a level");
      return paragraphWith(inline);
    }
    case "codeBlock": {
      const lines = childrenOf(value).flatMap((child) => (typeof child === "string" ? [stripBidiControls(child)] : isRecord(child) && typeof child["text"] === "string" ? [stripBidiControls(child["text"])] : []));
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
      if (items.length === 0) return undefined;
      if (nodeType === "bulletList") return { type: "bulletList", content: items };
      const attrs = value["attrs"];
      const start = isRecord(attrs) ? attrs["start"] : undefined;
      if (start === undefined) return { type: "orderedList", content: items };
      if (typeof start === "number" && Number.isInteger(start) && start >= 0) return { type: "orderedList", attrs: { start }, content: items };
      dropped.note("ordered list start");
      return { type: "orderedList", content: items };
    }
    case "hardBreak":
    case "text":
      return paragraphWith(convertInlineNodes([value], dropped));
    default:
      dropped.note(nodeType);
      return undefined;
  }
}
const convertBlockNodes = (values: readonly unknown[], dropped: DroppedNames, depth: number): ContentBlockNode[] =>
  values.flatMap((value) => {
    if (isRecord(value) && typeof value["type"] !== "string" && Array.isArray(value["content"])) return convertBlockNodes(value["content"], dropped, depth + 1);
    const block = convertBlockNode(value, dropped, depth);
    if (block === undefined) return [];
    const parsed = contentBlockNodeSchema.safeParse(block);
    if (parsed.success) return [parsed.data];
    dropped.note(block.type);
    const fallback = paragraphOfText(plainTextOf(block));
    return fallback === undefined ? [] : [fallback];
  });
export function admittedPasteDecision(decision: PasteDecision, input: PasteInput): PasteOutcome {
  if (decision === "cancel") return { status: "cancelled", content: null };
  const source: PasteInput = isRecord(input) ? input : {};
  if (decision === "plain-text") {
    const text = typeof source.text === "string" ? stripBidiControls(source.text) : "";
    return { status: "plain-text", content: { type: "text", text } };
  }
  const dropped = createDroppedNames();
  const content = convertBlockNodes(pasteNodeCandidates(source.json), dropped, 0);
  return { status: "converted", content: { type: "doc", content }, dropped: dropped.list() };
}
