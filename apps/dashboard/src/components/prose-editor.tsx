"use client";
import { useEffect, useId, useRef, useState, type ChangeEvent, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type ReactNode } from "react";
import { DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";
import { EditorContent, useEditor, useEditorState, type Editor, type JSONContent } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Bold, CircleAlert, Code, Heading2, Heading3, Heading4, ImagePlus, Italic, Link2, List, ListOrdered, Redo2, SquareCode, Strikethrough, TextQuote, Underline, Undo2, Unlink, Video, X } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DirectionProvider } from "@/components/ui/direction";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { ADMITTED_HEADING_LEVELS, CONTENT_PROFILE_VERSION, admittedPasteDecision, parseDocument, type ContentBlockNode, type ContentDirection, type ContentDocumentJson, type ContentSection, type PasteDecision } from "@/modules/content/document";
const PREVIEW_LIMIT = 600;
const PASTE_NOTICE = "Images and video are added with the toolbar buttons, so they are prepared, placed and saved with the content. Nothing was inserted here.";
const EDITOR_PROSE_CLASS = cn(
  "min-h-40 w-full px-3 py-2.5 text-sm leading-6 text-foreground outline-none",
  "[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
  // Document headings inside the editor take the one type scale, so what is authored reads at the size the preview and the released edition render at.
  "[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:type-section-title",
  "[&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:type-subsection-title",
  "[&_h4]:mt-3 [&_h4]:mb-1.5 [&_h4]:type-group-title",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:ps-6",
  "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:ps-6",
  "[&_li]:my-0.5",
  "[&_blockquote]:my-3 [&_blockquote]:border-s-2 [&_blockquote]:border-border [&_blockquote]:ps-3 [&_blockquote]:text-muted-foreground",
  "[&_pre]:my-3 [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-xs [&_pre]:whitespace-pre-wrap [&_pre]:break-words",
  "[&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4",
);
const HEADING_PRESENTATION: Readonly<Record<(typeof ADMITTED_HEADING_LEVELS)[number], { readonly label: string; readonly Icon: typeof Heading2 }>> = { 2: { label: "Heading 2", Icon: Heading2 }, 3: { label: "Heading 3", Icon: Heading3 }, 4: { label: "Heading 4", Icon: Heading4 } };
/** The accessible name of the editing region is also the region's own name. */
export type ProseEditorProps = { readonly initialDocument: ContentDocumentJson; readonly direction: ContentDirection; readonly label: string; readonly onChange: (document: ContentDocumentJson) => void; readonly onRequestMedia?: () => void; readonly readOnly?: boolean };
type PendingPaste = { readonly json: unknown; readonly text: string; readonly preview: string; readonly previewTruncated: boolean; readonly dropped: readonly string[]; readonly blocks: number; readonly from: number; readonly to: number };
const toEditorContent = (nodes: readonly ContentBlockNode[]): JSONContent[] => JSON.parse(JSON.stringify(nodes)) as JSONContent[];
/** The document as the editor holds it now. The service validates it through the content profile on save, so this reports the authored document and passes no judgement on it. */
const buildDocument = (editor: Editor, direction: ContentDirection, sections: readonly ContentSection[]): ContentDocumentJson => ({ type: "doc", profileVersion: CONTENT_PROFILE_VERSION, direction, content: (editor.getJSON().content ?? []) as readonly ContentBlockNode[], sections });
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
type ToolbarControlProps = { readonly label: string; readonly icon: ReactNode; readonly onSelect: () => void; readonly pressed?: boolean; readonly disabled?: boolean };
function ToolbarControl({ label, icon, onSelect, pressed, disabled }: ToolbarControlProps) {
  const control = pressed === undefined ? <Button {...{ type: "button", variant: "ghost", size: "icon-sm", "aria-label": label, disabled, onClick: onSelect }}>{icon}</Button> : <Toggle {...{ type: "button", size: "sm", "aria-label": label, pressed, disabled, onPressedChange: onSelect }}>{icon}</Toggle>;
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
  const chooseHeading = (next: readonly string[]): void => {
    const level = headingLevelOf(next[0] ?? "");
    if (level === undefined) editor.chain().focus().setParagraph().run();
    else editor.chain().focus().setHeading({ level }).run();
  };
  return (
    <fieldset aria-label="Text formatting" className="flex min-w-0 flex-wrap items-center gap-1 border-0 p-0">
      <ToolbarControl label="Bold" icon={<Bold aria-hidden="true" />} pressed={active.bold} onSelect={() => editor.chain().focus().toggleBold().run()} />
      <ToolbarControl label="Italic" icon={<Italic aria-hidden="true" />} pressed={active.italic} onSelect={() => editor.chain().focus().toggleItalic().run()} />
      <ToolbarControl label="Underline" icon={<Underline aria-hidden="true" />} pressed={active.underline} onSelect={() => editor.chain().focus().toggleUnderline().run()} />
      <ToolbarControl label="Strikethrough" icon={<Strikethrough aria-hidden="true" />} pressed={active.strike} onSelect={() => editor.chain().focus().toggleStrike().run()} />
      <ToolbarControl label="Code" icon={<Code aria-hidden="true" />} pressed={active.code} onSelect={() => editor.chain().focus().toggleCode().run()} />
      <Separator orientation="vertical" className="mx-0.5 h-6 self-center" />
      <ToggleGroup {...{ multiple: false, value: active.heading === null ? [] : [String(active.heading)], onValueChange: chooseHeading, size: "sm", "aria-label": "Heading level" }}>
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
type EditorDialogProps = { readonly open: boolean; readonly onClose: () => void; readonly title: string; readonly description: string; readonly initialFocus: () => HTMLElement | null; readonly footer: ReactNode; readonly children: ReactNode };
const EditorDialog = ({ open, onClose, title, description, initialFocus, footer, children }: EditorDialogProps): ReactNode => (
  <Dialog
    open={open}
    onOpenChange={(next) => {
      if (!next) onClose();
    }}
  >
    <DialogContent initialFocus={initialFocus}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {children}
      <DialogFooter>{footer}</DialogFooter>
    </DialogContent>
  </Dialog>
);
type PasteDecisionDialogProps = { readonly pending: PendingPaste | null; readonly onChoose: (decision: PasteDecision) => void };
type NoticeAlertProps = { readonly variant?: "default" | "destructive"; readonly icon?: true; readonly title: string; readonly children: ReactNode; readonly dismissLabel: string; readonly onDismiss: () => void };
const NoticeAlert = ({ variant = "default", icon, title, children, dismissLabel, onDismiss }: NoticeAlertProps): ReactElement => (
  <Alert variant={variant}>
    {icon === true ? <CircleAlert aria-hidden="true" /> : null}
    <AlertTitle>{title}</AlertTitle>
    <AlertDescription>{children}</AlertDescription>
    <AlertAction>
      <Button {...{ type: "button", variant: "ghost", size: "icon-xs", "aria-label": dismissLabel, onClick: onDismiss }}>
        <X aria-hidden="true" />
      </Button>
    </AlertAction>
  </Alert>
);
function PasteDecisionDialog({ pending, onChoose }: PasteDecisionDialogProps) {
  const preview = pending?.preview ?? "";
  const convertRef = useRef<HTMLButtonElement>(null);
  const plainTextRef = useRef<HTMLButtonElement>(null);
  const canConvert = (pending?.blocks ?? 0) > 0;
  const footer = (
    <>
      <Button {...{ type: "button", variant: "outline", onClick: () => onChoose("cancel") }}>Cancel</Button>
      <Button {...{ ref: plainTextRef, type: "button", variant: canConvert ? "outline" : "default", onClick: () => onChoose("plain-text") }}>Insert as plain text</Button>
      <Button {...{ ref: convertRef, type: "button", variant: canConvert ? "default" : "outline", onClick: () => onChoose("convert"), disabled: !canConvert }}>Convert to supported text</Button>
    </>
  );
  const description = "Nothing is inserted until you choose. Formatting outside this editor's text profile is dropped, and direction-control characters are removed rather than stored.";
  return (
    <EditorDialog open={pending !== null} onClose={() => onChoose("cancel")} title="Choose how to paste" description={description} initialFocus={() => (canConvert ? convertRef.current : plainTextRef.current)} footer={footer}>
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
    </EditorDialog>
  );
}
type LinkDestinationDialogProps = { readonly open: boolean; readonly href: string; readonly error: string | null; readonly onHrefChange: (href: string) => void; readonly onApply: () => void; readonly onCancel: () => void };
function LinkDestinationDialog({ open, href, error, onHrefChange, onApply, onCancel }: LinkDestinationDialogProps) {
  const fieldId = useId();
  const errorId = useId();
  const fieldRef = useRef<HTMLInputElement>(null);
  const changeHref = (event: ChangeEvent<HTMLInputElement>): void => onHrefChange(event.target.value);
  const selectHref = (event: FocusEvent<HTMLInputElement>): void => event.currentTarget.select();
  const submitOnEnter = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    onApply();
  };
  const footer = (
    <>
      <Button {...{ type: "button", variant: "outline", onClick: onCancel }}>Cancel</Button>
      <Button {...{ type: "button", onClick: onApply }}>Apply link</Button>
    </>
  );
  return (
    <EditorDialog open={open} onClose={onCancel} title="Link destination" description="An absolute http or https address, or a path beginning with /. A link opens only where the content is read, never inside this editor." initialFocus={() => fieldRef.current} footer={footer}>
      <div className="grid gap-1.5">
        <Label htmlFor={fieldId}>Web address</Label>
        <Input ref={fieldRef} id={fieldId} type="text" inputMode="url" autoComplete="off" spellCheck={false} value={href} onChange={changeHref} onFocus={selectHref} onKeyDown={submitOnEnter} aria-invalid={error !== null} aria-describedby={error === null ? undefined : errorId} />
        {error === null ? null : (
          <p id={errorId} className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </EditorDialog>
  );
}
/**
 * The single editing surface for Update prose and Page section prose. It edits the document and reports every change through `onChange`; the surface that owns the draft owns the autosave, its save state and its recovery, so exactly one place states whether this text is saved.
 */
export function ProseEditor({ initialDocument, direction, label, onChange, onRequestMedia, readOnly = false }: ProseEditorProps) {
  const labelId = useId();
  const [pendingPaste, setPendingPaste] = useState<PendingPaste | null>(null);
  const [contentIssue, setContentIssue] = useState<string | null>(null);
  const [mediaPasteNotice, setMediaPasteNotice] = useState(false);
  const [linkDraft, setLinkDraft] = useState<{ open: boolean; href: string; error: string | null }>({ open: false, href: "", error: null });
  const editorRef = useRef<Editor | null>(null);
  const sectionsRef = useRef(initialDocument.sections);
  const propsRef = useRef({ direction, readOnly, onChange });
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
          event.preventDefault();
          setMediaPasteNotice(true);
          return true;
        }
        let json: unknown;
        if (html.trim() !== "") {
          try {
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
    propsRef.current = { direction, readOnly, onChange };
    sectionsRef.current = initialDocument.sections;
  }, [editor, direction, onChange, initialDocument, readOnly]);
  useEffect(() => {
    if (editor === null) return;
    editor.setEditable(!readOnly);
    editor.view.dom.setAttribute("aria-readonly", readOnly ? "true" : "false");
  }, [editor, readOnly]);
  useEffect(() => {
    if (editor === null) return;
    const handleUpdate = (): void => {
      const props = propsRef.current;
      if (props.readOnly) return;
      props.onChange(buildDocument(editor, props.direction, sectionsRef.current));
    };
    editor.on("update", handleUpdate);
    return () => {
      editor.off("update", handleUpdate);
    };
  }, [editor]);
  function applyPendingPaste(decision: PasteDecision) {
    const pending = pendingPaste;
    const current = editorRef.current;
    setPendingPaste(null);
    if (current === null || current.isDestroyed) return;
    if (decision === "cancel") return current.commands.focus();
    const result = admittedPasteDecision(decision, { json: pending?.json, text: pending?.text ?? "" });
    if (pending !== null) {
      const size = current.state.doc.content.size;
      if (pending.from <= size && pending.to <= size) current.commands.setTextSelection({ from: pending.from, to: pending.to });
    }
    if (result.status === "plain-text") {
      current.chain().focus().insertContent(plainTextBlocks(result.content.text)).run();
      return;
    }
    if (result.status === "converted") {
      const content = toEditorContent(result.content.content);
      if (content.length === 0) return current.commands.focus();
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
  // The editor states the direction to the provider as well as the section, so the portalled toolbar and dialogs it opens follow the edition's direction rather than the page's.
  return (
    <DirectionProvider direction={direction}>
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
        {contentIssue === null ? null : (
          <NoticeAlert {...{ variant: "destructive", icon: true, title: "Some content could not be read", dismissLabel: "Dismiss the content message", onDismiss: () => setContentIssue(null) }}>
            <p>{contentIssue}</p>
            <p>The rest of the text is here and can still be edited.</p>
          </NoticeAlert>
        )}
        {mediaPasteNotice ? <NoticeAlert {...{ title: "A file was pasted", dismissLabel: "Dismiss the paste message", onDismiss: () => setMediaPasteNotice(false) }}>{PASTE_NOTICE}</NoticeAlert> : null}
        <PasteDecisionDialog pending={pendingPaste} onChoose={applyPendingPaste} />
        <LinkDestinationDialog open={linkDraft.open} href={linkDraft.href} error={linkDraft.error} onHrefChange={(href) => setLinkDraft((draft) => ({ ...draft, href, error: null }))} onApply={applyLink} onCancel={() => setLinkDraft({ open: false, href: "", error: null })} />
      </section>
    </DirectionProvider>
  );
}
export default ProseEditor;
