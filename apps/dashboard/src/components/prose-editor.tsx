"use client";
/** The one prose editing surface in the application, and the only place a Tiptap editor is constructed (AAP 0.3.4 "one editor surface, shared by both families"; 0.11.1; 0.4.4 gap 3). */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";
import { EditorContent, useEditor, useEditorState, type Editor, type JSONContent } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Bold, CircleAlert, Code, Heading2, Heading3, Heading4, ImagePlus, Italic, Link2, List, ListOrdered, Redo2, SquareCode, Strikethrough, TextQuote, Underline, Undo2, Unlink, Video, X } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { ADMITTED_HEADING_LEVELS, CONTENT_PROFILE_VERSION, admittedPasteDecision, checksum, parseDocument, type ContentBlockNode, type ContentDirection, type ContentDocumentJson, type ContentSection, type DocumentIssue, type PasteDecision } from "@/modules/content/document";
import { ROOT_FIELD_KEY, type ConflictOutcome, type DeniedOutcome, type FieldMessages, type InvalidOutcome, type MutationOutcome, type UnavailableOutcome, type UnknownOutcome } from "@/modules/data-service/outcome";
const AUTOSAVE_DELAY_MS = 600;
const LIST_LIMIT = 4;
const PREVIEW_LIMIT = 600;
const EDITOR_PROSE_CLASS = cn(
  "min-h-40 w-full px-3 py-2.5 text-sm leading-6 text-foreground outline-none",
  "[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
  "[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:leading-snug [&_h2]:font-semibold",
  "[&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold",
  "[&_h4]:mt-3 [&_h4]:mb-1.5 [&_h4]:text-sm [&_h4]:font-semibold",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:ps-6",
  "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:ps-6",
  "[&_li]:my-0.5",
  "[&_blockquote]:my-3 [&_blockquote]:border-s-2 [&_blockquote]:border-border [&_blockquote]:ps-3 [&_blockquote]:text-muted-foreground",
  "[&_pre]:my-3 [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-xs [&_pre]:whitespace-pre-wrap [&_pre]:break-words",
  "[&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-3",
);
const HEADING_PRESENTATION: Readonly<Record<(typeof ADMITTED_HEADING_LEVELS)[number], { readonly label: string; readonly Icon: typeof Heading2 }>> = { 2: { label: "Heading 2", Icon: Heading2 }, 3: { label: "Heading 3", Icon: Heading3 }, 4: { label: "Heading 4", Icon: Heading4 } };
/** The accessible name of the editing region is also the region's own name. */
export type ProseEditorProps = {
  readonly initialDocument: ContentDocumentJson;
  readonly expectedRevision: number;
  readonly direction: ContentDirection;
  readonly label: string;
  readonly onSave: (document: ContentDocumentJson, expectedRevision: number) => Promise<MutationOutcome>;
  readonly onRequestMedia?: () => void;
  readonly readOnly?: boolean;
};
type SaveFailureKind = "conflict" | "denied" | "invalid" | "unavailable" | "unknown" | "unreadable";
type SaveFailure = { readonly kind: SaveFailureKind; readonly message: string; readonly details: readonly string[]; readonly operationId: string | null; readonly halts: boolean; readonly tone: "default" | "destructive"; readonly retry: "check-result" | "save-again" | null };
type SaveState = { readonly status: "idle" } | { readonly status: "saving" } | { readonly status: "saved" } | ({ readonly status: "failed" } & SaveFailure);
type SaveAttempt = { readonly document: ContentDocumentJson; readonly revision: number; readonly digest: string };
type PendingPaste = { readonly json: unknown; readonly text: string; readonly preview: string; readonly previewTruncated: boolean; readonly dropped: readonly string[]; readonly blocks: number; readonly from: number; readonly to: number };
const toEditorContent = (nodes: readonly ContentBlockNode[]): JSONContent[] => JSON.parse(JSON.stringify(nodes)) as JSONContent[];
function buildDocument(editor: Editor, direction: ContentDirection, sections: readonly ContentSection[]): unknown {
  return { type: "doc", profileVersion: CONTENT_PROFILE_VERSION, direction, content: editor.getJSON().content ?? [], sections };
}
function advanceRevision(current: number, revision: string): number {
  const parsed = Number(revision);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : current + 1;
}
function headingLevelOf(value: string): (typeof ADMITTED_HEADING_LEVELS)[number] | undefined {
  const parsed = Number(value);
  return ADMITTED_HEADING_LEVELS.find((level) => level === parsed);
}
function textOfJson(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((entry) => textOfJson(entry)).join("");
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if (typeof record["text"] === "string") return record["text"];
    if (Array.isArray(record["content"])) return record["content"].map((entry) => textOfJson(entry)).join("\n");
  }
  return "";
}
function previewOf(text: string): { readonly preview: string; readonly truncated: boolean } {
  if (text.length <= PREVIEW_LIMIT) return { preview: text, truncated: false };
  return { preview: text.slice(0, PREVIEW_LIMIT), truncated: true };
}
function plainTextBlocks(text: string): JSONContent[] {
  return text
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => (line === "" ? { type: "paragraph" } : { type: "paragraph", content: [{ type: "text", text: line }] }));
}
function fieldMessages(fields: FieldMessages): string[] {
  const lines: string[] = [];
  for (const [path, messages] of Object.entries(fields)) {
    for (const message of messages) {
      if (lines.length === LIST_LIMIT) {
        lines.push("There are more problems than these; fix these first.");
        return lines;
      }
      lines.push(path === ROOT_FIELD_KEY ? message : `${path}: ${message}`);
    }
  }
  return lines;
}
type SaveFailureShape = { readonly halts: boolean; readonly tone: "default" | "destructive"; readonly retry?: SaveFailure["retry"]; readonly operationId?: string };
/** One refusal, assembled once: every arm below states only what it adds to the shape. */
const refusalOf = (kind: SaveFailureKind, message: string, details: readonly string[], shape: SaveFailureShape): SaveFailure => ({ kind, message, details, operationId: shape.operationId ?? null, halts: shape.halts, tone: shape.tone, retry: shape.retry ?? null });
function describeFailure(outcome: ConflictOutcome | DeniedOutcome | InvalidOutcome | UnavailableOutcome | UnknownOutcome, attemptRevision: number): SaveFailure {
  switch (outcome.outcome) {
    case "conflict":
      return refusalOf(
        "conflict",
        "A newer version is on the record, so this text was not saved over it.",
        [
          outcome.reason === "changed-intent" ? "This save reused an earlier attempt's identity with different text, so it was refused instead of applied twice." : `The record now stands at revision ${outcome.currentRevision}; this editor started from revision ${attemptRevision}.`,
          "Your text is still in this editor and nothing was overwritten. Compare it with the saved version before you apply it again.",
        ],
        { halts: true, tone: "destructive" },
      );
    case "denied":
      return refusalOf("denied", "You do not have permission to change this content.", ["Your text is still in this editor and nothing was saved."], { halts: true, tone: "destructive" });
    case "invalid": {
      const lines = fieldMessages(outcome.fields);
      return refusalOf("invalid", "This text cannot be saved yet.", lines.length > 0 ? lines : ["The content did not pass the profile's checks."], { halts: false, tone: "destructive" });
    }
    case "unavailable":
      return refusalOf("unavailable", `The ${outcome.source.system} source could not be read, so nothing was saved.`, [outcome.guidance, "Your text is still in this editor."], { halts: false, tone: "default", retry: "save-again" });
    case "unknown":
      return refusalOf("unknown", "This save may or may not have been applied, and its result is not known.", ["Your text is still in this editor. Check the result of the same attempt rather than saving it again under a new one, so a second effect can never be created."], {
        halts: true,
        tone: "default",
        retry: "check-result",
        operationId: outcome.operationId,
      });
  }
}
function unreadableFailure(issues: readonly DocumentIssue[]): SaveFailure {
  const lines = issues.slice(0, LIST_LIMIT).map((issue) => (issue.path === "" ? issue.message : `${issue.path}: ${issue.message}`));
  return refusalOf("unreadable", "This text cannot be saved yet.", lines.length > 0 ? lines : ["The content did not pass the profile's checks."], { halts: false, tone: "destructive" });
}
type ToolbarControlProps = { readonly label: string; readonly icon: ReactNode; readonly onSelect: () => void; readonly pressed?: boolean; readonly disabled?: boolean };
function ToolbarControl({ label, icon, onSelect, pressed, disabled }: ToolbarControlProps) {
  const control =
    pressed === undefined ? (
      <Button type="button" variant="ghost" size="icon-sm" aria-label={label} disabled={disabled} onClick={onSelect}>
        {icon}
      </Button>
    ) : (
      <Toggle type="button" size="sm" aria-label={label} pressed={pressed} disabled={disabled} onPressedChange={onSelect}>
        {icon}
      </Toggle>
    );
  return (
    <Tooltip>
      <TooltipTrigger render={control} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
type EditorToolbarProps = { readonly editor: Editor; readonly onOpenLink: () => void; readonly onRequestMedia?: () => void };
function EditorToolbar({ editor, onOpenLink, onRequestMedia }: EditorToolbarProps) {
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      underline: current.isActive("underline"),
      strike: current.isActive("strike"),
      code: current.isActive("code"),
      heading: ADMITTED_HEADING_LEVELS.find((level) => current.isActive("heading", { level })) ?? null,
      bulletList: current.isActive("bulletList"),
      orderedList: current.isActive("orderedList"),
      blockquote: current.isActive("blockquote"),
      codeBlock: current.isActive("codeBlock"),
      link: current.isActive("link"),
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
    }),
  });
  const headingValue = active.heading === null ? [] : [String(active.heading)];
  return (
    <fieldset aria-label="Text formatting" className="flex min-w-0 flex-wrap items-center gap-1 border-0 p-0">
      <ToolbarControl label="Bold" icon={<Bold aria-hidden="true" />} pressed={active.bold} onSelect={() => editor.chain().focus().toggleBold().run()} />
      <ToolbarControl label="Italic" icon={<Italic aria-hidden="true" />} pressed={active.italic} onSelect={() => editor.chain().focus().toggleItalic().run()} />
      <ToolbarControl label="Underline" icon={<Underline aria-hidden="true" />} pressed={active.underline} onSelect={() => editor.chain().focus().toggleUnderline().run()} />
      <ToolbarControl label="Strikethrough" icon={<Strikethrough aria-hidden="true" />} pressed={active.strike} onSelect={() => editor.chain().focus().toggleStrike().run()} />
      <ToolbarControl label="Code" icon={<Code aria-hidden="true" />} pressed={active.code} onSelect={() => editor.chain().focus().toggleCode().run()} />
      <Separator orientation="vertical" className="mx-0.5 h-6 self-center" />
      <ToggleGroup
        multiple={false}
        value={headingValue}
        onValueChange={(next) => {
          const level = headingLevelOf(next[0] ?? "");
          if (level === undefined) {
            editor.chain().focus().setParagraph().run();
            return;
          }
          editor.chain().focus().setHeading({ level }).run();
        }}
        size="sm"
        aria-label="Heading level"
      >
        {ADMITTED_HEADING_LEVELS.map((level) => {
          const { label, Icon } = HEADING_PRESENTATION[level];
          return (
            <Tooltip key={level}>
              <TooltipTrigger
                render={
                  <ToggleGroupItem type="button" value={String(level)} aria-label={label}>
                    <Icon aria-hidden="true" />
                  </ToggleGroupItem>
                }
              />
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          );
        })}
      </ToggleGroup>
      <Separator orientation="vertical" className="mx-0.5 h-6 self-center" />
      <ToolbarControl label="Bulleted list" icon={<List aria-hidden="true" />} pressed={active.bulletList} onSelect={() => editor.chain().focus().toggleBulletList().run()} />
      <ToolbarControl label="Numbered list" icon={<ListOrdered aria-hidden="true" />} pressed={active.orderedList} onSelect={() => editor.chain().focus().toggleOrderedList().run()} />
      <ToolbarControl label="Quotation" icon={<TextQuote aria-hidden="true" />} pressed={active.blockquote} onSelect={() => editor.chain().focus().toggleBlockquote().run()} />
      <ToolbarControl label="Code block" icon={<SquareCode aria-hidden="true" />} pressed={active.codeBlock} onSelect={() => editor.chain().focus().toggleCodeBlock().run()} />
      <Separator orientation="vertical" className="mx-0.5 h-6 self-center" />
      <ToolbarControl label="Link" icon={<Link2 aria-hidden="true" />} onSelect={onOpenLink} />
      <ToolbarControl label="Remove link" icon={<Unlink aria-hidden="true" />} disabled={!active.link} onSelect={() => editor.chain().focus().extendMarkRange("link").unsetLink().run()} />
      {onRequestMedia === undefined ? null : (
        <>
          <Separator orientation="vertical" className="mx-0.5 h-6 self-center" />
          <ToolbarControl label="Insert image" icon={<ImagePlus aria-hidden="true" />} onSelect={onRequestMedia} />
          <ToolbarControl label="Insert video" icon={<Video aria-hidden="true" />} onSelect={onRequestMedia} />
        </>
      )}
      <Separator orientation="vertical" className="mx-0.5 h-6 self-center" />
      <ToolbarControl label="Undo" icon={<Undo2 aria-hidden="true" />} disabled={!active.canUndo} onSelect={() => editor.chain().focus().undo().run()} />
      <ToolbarControl label="Redo" icon={<Redo2 aria-hidden="true" />} disabled={!active.canRedo} onSelect={() => editor.chain().focus().redo().run()} />
    </fieldset>
  );
}
type PasteDecisionDialogProps = { readonly pending: PendingPaste | null; readonly onChoose: (decision: PasteDecision) => void };
function PasteDecisionDialog({ pending, onChoose }: PasteDecisionDialogProps) {
  const preview = pending?.preview ?? "";
  const convertRef = useRef<HTMLButtonElement>(null);
  const plainTextRef = useRef<HTMLButtonElement>(null);
  // A paste that carries no admitted structure has nothing to convert, so plain text becomes the action the dialog opens on rather than leaving a disabled primary button in front of the author.
  const canConvert = (pending?.blocks ?? 0) > 0;
  return (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) onChoose("cancel");
      }}
    >
      <DialogContent initialFocus={() => (canConvert ? convertRef.current : plainTextRef.current)}>
        <DialogHeader>
          <DialogTitle>Choose how to paste</DialogTitle>
          <DialogDescription>Nothing is inserted until you choose. Formatting outside this editor&apos;s text profile is dropped, and direction-control characters are removed rather than stored.</DialogDescription>
        </DialogHeader>
        {pending === null ? null : (
          <div className="grid gap-2">
            <div className="max-h-40 overflow-y-auto rounded-lg border border-border bg-muted/40 p-3 text-xs break-words whitespace-pre-wrap">
              <bdi>{preview === "" ? "This clipboard carries no text to preview." : preview}</bdi>
            </div>
            {pending.previewTruncated ? <p className="text-xs text-muted-foreground">The preview is shortened.</p> : null}
            {pending.dropped.length === 0 ? null : (
              <p className="text-xs text-muted-foreground">
                Not kept: <bdi>{pending.dropped.join(", ")}</bdi>.
              </p>
            )}
            {canConvert ? null : <p className="text-xs text-muted-foreground">Converting keeps only the supported structure, and this paste brings none of it, so it would insert nothing. Inserting it as plain text keeps the words.</p>}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onChoose("cancel")}>
            Cancel
          </Button>
          <Button ref={plainTextRef} type="button" variant={canConvert ? "outline" : "default"} onClick={() => onChoose("plain-text")}>
            Insert as plain text
          </Button>
          <Button ref={convertRef} type="button" variant={canConvert ? "default" : "outline"} onClick={() => onChoose("convert")} disabled={!canConvert}>
            Convert to supported text
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
type LinkDestinationDialogProps = { readonly open: boolean; readonly href: string; readonly error: string | null; readonly onHrefChange: (href: string) => void; readonly onApply: () => void; readonly onCancel: () => void };
function LinkDestinationDialog({ open, href, error, onHrefChange, onApply, onCancel }: LinkDestinationDialogProps) {
  const fieldId = useId();
  const errorId = useId();
  const fieldRef = useRef<HTMLInputElement>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent initialFocus={() => fieldRef.current}>
        <DialogHeader>
          <DialogTitle>Link destination</DialogTitle>
          <DialogDescription>An absolute http or https address, or a path beginning with /. A link opens only where the content is read, never inside this editor.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor={fieldId}>Web address</Label>
          <Input
            ref={fieldRef}
            id={fieldId}
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={href}
            onChange={(event) => onHrefChange(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onApply();
              }
            }}
            aria-invalid={error !== null}
            aria-describedby={error === null ? undefined : errorId}
          />
          {error === null ? null : (
            <p id={errorId} className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={onApply}>
            Apply link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
/** The single editing surface for Update prose and Page section prose. */
export function ProseEditor({ initialDocument, expectedRevision, direction, label, onSave, onRequestMedia, readOnly = false }: ProseEditorProps) {
  const labelId = useId();
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const [pendingPaste, setPendingPaste] = useState<PendingPaste | null>(null);
  const [contentIssue, setContentIssue] = useState<string | null>(null);
  const [mediaPasteNotice, setMediaPasteNotice] = useState(false);
  const [linkDraft, setLinkDraft] = useState<{ open: boolean; href: string; error: string | null }>({ open: false, href: "", error: null });
  const editorRef = useRef<Editor | null>(null);
  const revisionRef = useRef(expectedRevision);
  const attemptRef = useRef<SaveAttempt | null>(null);
  const inFlightRef = useRef(false);
  const queuedRef = useRef(false);
  const haltedRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const sectionsRef = useRef(initialDocument.sections);
  const propsRef = useRef({ direction, readOnly, onSave });
  const savedDigestRef = useRef<string | null>(null);
  if (savedDigestRef.current === null) savedDigestRef.current = checksum(initialDocument);
  const submit = useCallback(async (attempt: SaveAttempt): Promise<boolean> => {
    if (inFlightRef.current) {
      queuedRef.current = true;
      return false;
    }
    inFlightRef.current = true;
    attemptRef.current = attempt;
    setSaveState({ status: "saving" });
    let outcome: MutationOutcome | null = null;
    try {
      outcome = await propsRef.current.onSave(attempt.document, attempt.revision);
    } catch {
      // A rejected promise is not one of the eight outcomes. The honest reading is that this surface does not know what happened, so the text stays and the author may save it again.
      outcome = null;
    }
    inFlightRef.current = false;
    if (!mountedRef.current) return false;
    if (outcome === null) {
      setSaveState({ status: "failed", ...refusalOf("unavailable", "The save did not complete, and its result is not known here.", ["Your text is still in this editor.", "Saving again sends the text that is here now, against the revision it was read at."], { halts: false, tone: "default", retry: "save-again" }) });
      return false;
    }
    if (outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unchanged") {
      savedDigestRef.current = attempt.digest;
      revisionRef.current = advanceRevision(attempt.revision, outcome.revision);
      haltedRef.current = false;
      setSaveState({ status: "saved" });
      return true;
    }
    const failure = describeFailure(outcome, attempt.revision);
    haltedRef.current = failure.halts;
    setSaveState({ status: "failed", ...failure });
    return false;
  }, []);
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const flush = useCallback(async (): Promise<void> => {
    const current = editorRef.current;
    if (current === null || current.isDestroyed) return;
    const props = propsRef.current;
    if (props.readOnly || haltedRef.current) return;
    if (inFlightRef.current) {
      queuedRef.current = true;
      return;
    }
    const parsed = parseDocument(buildDocument(current, props.direction, sectionsRef.current));
    if (parsed.status === "invalid") {
      setSaveState({ status: "failed", ...unreadableFailure(parsed.issues) });
      return;
    }
    const digest = checksum(parsed.document);
    if (digest === savedDigestRef.current) {
      setSaveState((state) => (state.status === "failed" ? state : { status: "saved" }));
      return;
    }
    const saved = await submit({ document: parsed.document, revision: revisionRef.current, digest });
    const queued = queuedRef.current;
    queuedRef.current = false;
    if (saved && queued) await flushRef.current();
  }, [submit]);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);
  const scheduleSave = useCallback(() => {
    if (propsRef.current.readOnly || haltedRef.current) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void flushRef.current();
    }, AUTOSAVE_DELAY_MS);
  }, []);
  const editor = useEditor({
    immediatelyRender: false,
    editable: !readOnly,
    extensions: [StarterKit.configure({ heading: { levels: [...ADMITTED_HEADING_LEVELS] }, horizontalRule: false, link: { openOnClick: false, autolink: true, linkOnPaste: false, protocols: ["http", "https"], HTMLAttributes: { rel: "noopener noreferrer nofollow" } } })],
    content: { type: "doc", content: toEditorContent(initialDocument.content) },
    editorProps: {
      attributes: { role: "textbox", "aria-multiline": "true", "aria-readonly": readOnly ? "true" : "false", "aria-labelledby": labelId, class: EDITOR_PROSE_CLASS },
      handlePaste: (view, event) => {
        const clipboard = event.clipboardData;
        if (clipboard === null) return false;
        const html = clipboard.getData("text/html");
        const text = clipboard.getData("text/plain");
        const hasFiles = clipboard.files.length > 0;
        if (html.trim() === "" && text.trim() === "" && !hasFiles) return false;
        if (html.trim() === "" && text.trim() === "") {
          // Media is never a prose node: a pasted file is reported and routed to the picker instead of being dropped into the document, where it would vanish or bypass preparation.
          event.preventDefault();
          setMediaPasteNotice(true);
          return true;
        }
        let json: unknown;
        if (html.trim() !== "") {
          try {
            // An inert document: no script runs and no resource is fetched while the clipboard is read, and the parse uses this editor's own schema, so the fragment offered to the choice is expressed in exactly the vocabulary the record accepts.
            const parsedHtml = new window.DOMParser().parseFromString(html, "text/html");
            json = ProseMirrorDOMParser.fromSchema(view.state.schema).parse(parsedHtml.body).toJSON();
          } catch {
            json = undefined;
          }
        }
        const converted = admittedPasteDecision("convert", { json, text });
        const blocks = converted.status === "converted" ? converted.content.content : [];
        const dropped = converted.status === "converted" ? converted.dropped : [];
        const previewSource = text.trim() === "" ? textOfJson(blocks) : text;
        const { preview, truncated } = previewOf(previewSource);
        event.preventDefault();
        setPendingPaste({ json, text, preview, previewTruncated: truncated, dropped, blocks: blocks.length, from: view.state.selection.from, to: view.state.selection.to });
        return true;
      },
    },
    enableContentCheck: true,
    onContentError: ({ error }) => setContentIssue(error.message),
  });
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);
  useEffect(() => {
    propsRef.current = { direction, readOnly, onSave };
  }, [direction, readOnly, onSave]);
  useEffect(() => {
    sectionsRef.current = initialDocument.sections;
  }, [initialDocument]);
  useEffect(() => {
    revisionRef.current = expectedRevision;
  }, [expectedRevision]);
  useEffect(() => {
    if (editor === null) return;
    editor.setEditable(!readOnly);
    editor.view.dom.setAttribute("aria-readonly", readOnly ? "true" : "false");
  }, [editor, readOnly]);
  useEffect(() => {
    if (editor === null) return;
    const handleUpdate = () => scheduleSave();
    // A surface that loses focus with a save still pending does not wait out the debounce: leaving the field is the last moment this component knows the author has finished the sentence.
    const handleBlur = () => {
      if (timerRef.current === null) return;
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
      void flushRef.current();
    };
    editor.on("update", handleUpdate);
    editor.on("blur", handleBlur);
    return () => {
      editor.off("update", handleUpdate);
      editor.off("blur", handleBlur);
    };
  }, [editor, scheduleSave]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);
  function applyPendingPaste(decision: PasteDecision) {
    const pending = pendingPaste;
    const current = editorRef.current;
    setPendingPaste(null);
    if (current === null || current.isDestroyed) return;
    if (decision === "cancel") {
      current.commands.focus();
      return;
    }
    const result = admittedPasteDecision(decision, { json: pending?.json, text: pending?.text ?? "" });
    if (pending !== null) {
      const size = current.state.doc.content.size;
      if (pending.from <= size && pending.to <= size) {
        current.commands.setTextSelection({ from: pending.from, to: pending.to });
      }
    }
    if (result.status === "plain-text") {
      current.chain().focus().insertContent(plainTextBlocks(result.content.text)).run();
      return;
    }
    if (result.status === "converted") {
      const content = toEditorContent(result.content.content);
      if (content.length === 0) {
        current.commands.focus();
        return;
      }
      current.chain().focus().insertContent(content).run();
    }
  }
  function openLinkDialog() {
    const current = editorRef.current;
    if (current === null) return;
    const existing: unknown = current.getAttributes("link").href;
    setLinkDraft({ open: true, href: typeof existing === "string" ? existing : "", error: null });
  }
  function applyLink() {
    const current = editorRef.current;
    if (current === null) return;
    const href = linkDraft.href.trim();
    const probe = parseDocument({ type: "doc", profileVersion: CONTENT_PROFILE_VERSION, direction: propsRef.current.direction, content: [{ type: "paragraph", content: [{ type: "text", text: "link", marks: [{ type: "link", attrs: { href } }] }] }], sections: [] });
    if (probe.status === "invalid") {
      setLinkDraft((draft) => ({ ...draft, error: probe.issues[0]?.message ?? "That destination cannot be used." }));
      return;
    }
    current.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLinkDraft({ open: false, href: "", error: null });
  }
  async function saveAgain() {
    haltedRef.current = false;
    await flushRef.current();
  }
  async function checkResult() {
    const attempt = attemptRef.current;
    haltedRef.current = false;
    if (attempt === null) {
      await flushRef.current();
      return;
    }
    const saved = await submit(attempt);
    if (saved) await flushRef.current();
  }
  const statusText = saveState.status === "saving" ? "Saving…" : saveState.status === "saved" ? "Saved" : saveState.status === "failed" ? "Not saved — the text in this editor is the only copy." : "";
  return (
    <section dir={direction} aria-labelledby={labelId} className="flex w-full min-w-0 flex-col gap-2">
      <span id={labelId} className="sr-only">
        {label}
      </span>
      {readOnly || editor === null ? null : (
        <TooltipProvider>
          <EditorToolbar editor={editor} onOpenLink={openLinkDialog} onRequestMedia={onRequestMedia} />
        </TooltipProvider>
      )}
      <div className={cn("min-h-40 min-w-0 rounded-lg border border-input bg-input/30 motion-safe:transition-colors", "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring", readOnly && "border-transparent bg-transparent")}>
        <EditorContent editor={editor} />
      </div>
      {/* `output` carries the status role natively, so the save state is announced once as it changes and is never proved by a notification that disappears. It stays mounted while idle, so the region exists before its text does. */}
      {readOnly ? null : (
        <output aria-live="polite" className="block min-h-4 text-xs text-muted-foreground">
          {statusText}
        </output>
      )}
      {contentIssue === null ? null : (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>Some content could not be read</AlertTitle>
          <AlertDescription>
            <p>{contentIssue}</p>
            <p>The rest of the text is here and can still be edited.</p>
          </AlertDescription>
          <AlertAction>
            <Button type="button" variant="ghost" size="icon-xs" aria-label="Dismiss the content message" onClick={() => setContentIssue(null)}>
              <X aria-hidden="true" />
            </Button>
          </AlertAction>
        </Alert>
      )}
      {saveState.status === "failed" ? (
        <Alert variant={saveState.tone}>
          <CircleAlert aria-hidden="true" />
          <AlertTitle>Not saved</AlertTitle>
          <AlertDescription>
            <p>{saveState.message}</p>
            <ul className="list-disc ps-5">
              {saveState.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
            {saveState.operationId === null ? null : (
              <p>
                Attempt <bdi className="mono-identifier break-all">{saveState.operationId}</bdi>
              </p>
            )}
          </AlertDescription>
          {saveState.retry === null ? null : (
            <AlertAction>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (saveState.retry === "check-result") {
                    void checkResult();
                    return;
                  }
                  void saveAgain();
                }}
              >
                {saveState.retry === "check-result" ? "Check the result" : "Save again"}
              </Button>
            </AlertAction>
          )}
        </Alert>
      ) : null}
      {mediaPasteNotice ? (
        <Alert>
          <AlertTitle>A file was pasted</AlertTitle>
          <AlertDescription>Images and video are added with the toolbar buttons, so they are prepared, placed and saved with the content. Nothing was inserted here.</AlertDescription>
          <AlertAction>
            <Button type="button" variant="ghost" size="icon-xs" aria-label="Dismiss the paste message" onClick={() => setMediaPasteNotice(false)}>
              <X aria-hidden="true" />
            </Button>
          </AlertAction>
        </Alert>
      ) : null}
      <PasteDecisionDialog pending={pendingPaste} onChoose={applyPendingPaste} />
      <LinkDestinationDialog
        open={linkDraft.open}
        href={linkDraft.href}
        error={linkDraft.error}
        onHrefChange={(href) => {
          setLinkDraft((draft) => ({ ...draft, href, error: null }));
        }}
        onApply={applyLink}
        onCancel={() => {
          setLinkDraft({ open: false, href: "", error: null });
        }}
      />
    </section>
  );
}
export default ProseEditor;
