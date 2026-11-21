"use client";

/**
 * The one prose editing surface in the application, and the only place a Tiptap editor is
 * constructed (AAP 0.3.4 "one editor surface, shared by both families"; 0.11.1; 0.4.4 gap 3).
 * Update prose and Page section prose both render this component, so a second `useEditor`, a second
 * schema and a second content engine are absent by construction rather than by convention.
 *
 * What the surface decides, and why each decision lives here:
 *
 * - The editor's extension set is derived from `modules/content/document.ts`. `StarterKit` is the
 *   single extension source, the heading extension is narrowed to the profile's levels 2-4, and the
 *   one starter that adds a node type the profile has no node for — the horizontal rule — is switched
 *   off. The starters that add only behaviour (drop cursor, gap cursor, trailing paragraph, list
 *   keymaps, undo history) stay on, because none of them introduces a node or a mark. A document
 *   therefore cannot gain a node the profile would refuse at save time, and the editor and the
 *   renderer read one vocabulary instead of two.
 * - The persisted value is the profile's JSON, not HTML. `parseDocument` validates what the editor
 *   holds, `checksum` decides whether a save is needed at all, and `onSave` receives the parsed
 *   document, so a caller cannot be handed a shape the record would reject.
 * - Paste is deliberate. `handlePaste` cancels the browser's own insertion and offers the three
 *   answers `admittedPasteDecision` defines (convert, plain text, cancel). ProseMirror is liberal in
 *   what it accepts and strict in what it emits, so an unprompted paste is how content disappears
 *   without anyone being told; the paste event itself is never blocked, only redirected, which keeps
 *   the paste gesture available (WCAG 3.3.8).
 * - Saving is an autosave that always states the revision it expects. A conflict keeps the author's
 *   text and stops; an unknown outcome is resolved by checking the same attempt, never by repeating
 *   the work under a new identity; an unreadable source leaves the text in place. Every result is
 *   rendered durably in this component, because a notification that disappears would be the only
 *   evidence of a save that may not have happened.
 * - Direction is a property of the content: `dir` is set on the block from the `direction` prop and
 *   inherited by the editing region and the toolbar. No CSS base direction is declared anywhere, and
 *   no bidi control character is written into content.
 * - Section composition (add, move, duplicate, remove) belongs to the Page builder
 *   (`features/ministry-pages`). This editor edits prose inside one section or one Update body and
 *   preserves the `sections` it was handed unchanged.
 *
 * The component is a client boundary: it owns editor state and React state, reaches no store and no
 * service directly, builds no URL, and performs no I/O of its own. Its single outbound call is the
 * `onSave` the owning feature supplied, and its single inbound dependency for media is the
 * `onRequestMedia` callback that opens `components/media-picker.tsx`.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";
import {
  EditorContent,
  useEditor,
  useEditorState,
  type Editor,
  type JSONContent,
} from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import {
  Bold,
  CircleAlert,
  Code,
  Heading2,
  Heading3,
  Heading4,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Redo2,
  SquareCode,
  Strikethrough,
  TextQuote,
  Underline,
  Undo2,
  Unlink,
  Video,
  X,
} from "lucide-react";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import {
  ADMITTED_HEADING_LEVELS,
  CONTENT_PROFILE_VERSION,
  admittedPasteDecision,
  checksum,
  parseDocument,
  type ContentBlockNode,
  type ContentDirection,
  type ContentDocumentJson,
  type ContentSection,
  type DocumentIssue,
  type PasteDecision,
} from "@/modules/content/document";
import {
  ROOT_FIELD_KEY,
  type ConflictOutcome,
  type DeniedOutcome,
  type FieldMessages,
  type InvalidOutcome,
  type MutationOutcome,
  type UnavailableOutcome,
  type UnknownOutcome,
} from "@/modules/data-service/outcome";

/** How long the editor waits after the last edit before it saves. */
const AUTOSAVE_DELAY_MS = 600;

/** How many problems or dropped names one message lists before it summarises the rest. */
const LIST_LIMIT = 4;

/** How much pasted text the choice dialog shows before it truncates the preview. */
const PREVIEW_LIMIT = 600;

/**
 * The prose look, expressed entirely in token utilities. Tailwind's typography plugin is not part of
 * the pinned stack, so the block rhythm of the editing region is stated here against the semantic
 * tokens: no colour literal, no radius literal and no shadow. Logical properties (`ps-*`, `border-s`)
 * keep the indentation of lists and quotations on the reading side in right-to-left authoring.
 */
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
  "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-xs",
  "[&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-3",
);

/**
 * One label and icon per profile heading level, keyed by the level itself so a change to
 * `ADMITTED_HEADING_LEVELS` fails the type check here instead of leaving an offering the profile no
 * longer accepts.
 */
const HEADING_PRESENTATION: Readonly<
  Record<
    (typeof ADMITTED_HEADING_LEVELS)[number],
    { readonly label: string; readonly Icon: typeof Heading2 }
  >
> = {
  2: { label: "Heading 2", Icon: Heading2 },
  3: { label: "Heading 3", Icon: Heading3 },
  4: { label: "Heading 4", Icon: Heading4 },
};

/** The accessible name of the editing region is also the region's own name. */
export interface ProseEditorProps {
  /** The body this surface starts from: a profile document read from the record. */
  readonly initialDocument: ContentDocumentJson;
  /** The revision the record was read at. Every autosave presents it. */
  readonly expectedRevision: number;
  /** The direction the content reads in; applied as `dir` on the editing block. */
  readonly direction: ContentDirection;
  /** The accessible name of the editing region. */
  readonly label: string;
  /**
   * Persists one draft body.
   *
   * The same document with the same `expectedRevision` is one attempt: the owning feature keeps the
   * `operationId` for that pair, so a repeated call after an unknown outcome replays the stored
   * result instead of performing a second effect.
   */
  readonly onSave: (
    document: ContentDocumentJson,
    expectedRevision: number,
  ) => Promise<MutationOutcome>;
  /** Opens the single media picker. The editor never renders a file input and never embeds bytes. */
  readonly onRequestMedia?: () => void;
  /** Renders the body without an editing surface, its toolbar or its save status. */
  readonly readOnly?: boolean;
}

/** The five ways a save can fail, plus the one the editor finds before it asks. */
type SaveFailureKind = "conflict" | "denied" | "invalid" | "unavailable" | "unknown" | "unreadable";

/** Everything a failed save says, and the one action (if any) that is honest to offer. */
interface SaveFailure {
  readonly kind: SaveFailureKind;
  readonly message: string;
  readonly details: readonly string[];
  /** The attempt identity an unknown outcome may be checked with; never an invitation to resend. */
  readonly operationId: string | null;
  /** Whether autosave stops until the author acts, so a stale revision is never republished. */
  readonly halts: boolean;
  readonly tone: "default" | "destructive";
  /** `check-result` replays the same attempt; `save-again` saves what is in the editor now. */
  readonly retry: "check-result" | "save-again" | null;
}

/**
 * The durable inline status of this surface: rendered in place for as long as it holds, never as a
 * notification that disappears, and never inferred from the absence of an error.
 */
type SaveState =
  | { readonly status: "idle" }
  | { readonly status: "saving" }
  | { readonly status: "saved" }
  | ({ readonly status: "failed" } & SaveFailure);

/** One save attempt, held so an unknown outcome can be checked with the same identity. */
interface SaveAttempt {
  readonly document: ContentDocumentJson;
  readonly revision: number;
  readonly digest: string;
}

/** A paste waiting for one of the three answers; nothing is inserted while it is held. */
interface PendingPaste {
  readonly json: unknown;
  readonly text: string;
  readonly preview: string;
  readonly previewTruncated: boolean;
  readonly dropped: readonly string[];
  readonly blocks: number;
  readonly from: number;
  readonly to: number;
}

/**
 * The profile's document is deeply readonly while the editor's content API takes mutable JSON, so
 * this is the one place the two representations meet. The values are the same JSON: nothing is
 * reshaped, only copied out of a readonly view.
 */
function toEditorContent(nodes: readonly ContentBlockNode[]): JSONContent[] {
  return JSON.parse(JSON.stringify(nodes)) as JSONContent[];
}

/**
 * The candidate document: the editor's body, the direction the edition states, and the sections the
 * surface was handed. It is deliberately untyped at this boundary so `parseDocument` — not this
 * component — decides whether the shape is admissible.
 */
function buildDocument(
  editor: Editor,
  direction: ContentDirection,
  sections: readonly ContentSection[],
): unknown {
  return {
    type: "doc",
    profileVersion: CONTENT_PROFILE_VERSION,
    direction,
    content: editor.getJSON().content ?? [],
    sections,
  };
}

/**
 * The revision to present on the next save. A record's revision is an opaque string at the service
 * boundary, so it is adopted only when it is an integer this surface can present again; otherwise
 * the surface advances its own count, which a following conflict would correct rather than hide.
 */
function advanceRevision(current: number, revision: string): number {
  const parsed = Number(revision);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : current + 1;
}

/** The profile heading level a toggle-group value stands for, or `undefined` for a paragraph. */
function headingLevelOf(value: string): (typeof ADMITTED_HEADING_LEVELS)[number] | undefined {
  const parsed = Number(value);
  return ADMITTED_HEADING_LEVELS.find((level) => level === parsed);
}

/** Reads the text a pasted JSON fragment would contribute, for the dialog's preview. */
function textOfJson(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => textOfJson(entry)).join("");
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if (typeof record["text"] === "string") {
      return record["text"];
    }
    if (Array.isArray(record["content"])) {
      return record["content"].map((entry) => textOfJson(entry)).join("\n");
    }
  }
  return "";
}

/** Cuts pasted text to what the dialog shows, reporting whether anything was left out. */
function previewOf(text: string): { readonly preview: string; readonly truncated: boolean } {
  if (text.length <= PREVIEW_LIMIT) {
    return { preview: text, truncated: false };
  }
  return { preview: text.slice(0, PREVIEW_LIMIT), truncated: true };
}

/**
 * One plain-text insertion as admitted blocks: a line per paragraph, and an empty line kept as an
 * empty paragraph so the pasted line structure survives. Only the profile's own nodes are produced,
 * so nothing here can introduce a node the record would refuse.
 */
function plainTextBlocks(text: string): JSONContent[] {
  return text
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) =>
      line === ""
        ? { type: "paragraph" }
        : { type: "paragraph", content: [{ type: "text", text: line }] },
    );
}

/** Flattens an `invalid` outcome's per-field messages into the lines a person can act on. */
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

/** Turns the five failing outcomes into the durable message, tone and action this surface shows. */
function describeFailure(
  outcome: ConflictOutcome | DeniedOutcome | InvalidOutcome | UnavailableOutcome | UnknownOutcome,
  attemptRevision: number,
): SaveFailure {
  switch (outcome.outcome) {
    case "conflict":
      return {
        kind: "conflict",
        message: "A newer version is on the record, so this text was not saved over it.",
        details: [
          outcome.reason === "changed-intent"
            ? "This save reused an earlier attempt's identity with different text, so it was refused instead of applied twice."
            : `The record now stands at revision ${outcome.currentRevision}; this editor started from revision ${attemptRevision}.`,
          "Your text is still in this editor and nothing was overwritten. Compare it with the saved version before you apply it again.",
        ],
        operationId: null,
        halts: true,
        tone: "destructive",
        retry: null,
      };
    case "denied":
      return {
        kind: "denied",
        message: "You do not have permission to change this content.",
        details: ["Your text is still in this editor and nothing was saved."],
        operationId: null,
        halts: true,
        tone: "destructive",
        retry: null,
      };
    case "invalid": {
      const lines = fieldMessages(outcome.fields);
      return {
        kind: "invalid",
        message: "This text cannot be saved yet.",
        details:
          lines.length > 0 ? lines : ["The content did not pass the profile's checks."],
        operationId: null,
        halts: false,
        tone: "destructive",
        retry: null,
      };
    }
    case "unavailable":
      return {
        kind: "unavailable",
        message: `The ${outcome.source.system} source could not be read, so nothing was saved.`,
        details: [outcome.guidance, "Your text is still in this editor."],
        operationId: null,
        halts: false,
        tone: "default",
        retry: "save-again",
      };
    case "unknown":
      return {
        kind: "unknown",
        message: "This save may or may not have been applied, and its result is not known.",
        details: [
          "Your text is still in this editor. Check the result of the same attempt rather than saving it again under a new one, so a second effect can never be created.",
        ],
        operationId: outcome.operationId,
        halts: true,
        tone: "default",
        retry: "check-result",
      };
  }
}

/** The failure the editor finds itself, before any request is made. */
function unreadableFailure(issues: readonly DocumentIssue[]): SaveFailure {
  const lines = issues
    .slice(0, LIST_LIMIT)
    .map((issue) => (issue.path === "" ? issue.message : `${issue.path}: ${issue.message}`));
  return {
    kind: "unreadable",
    message: "This text cannot be saved yet.",
    details: lines.length > 0 ? lines : ["The content did not pass the profile's checks."],
    operationId: null,
    halts: false,
    tone: "destructive",
    retry: null,
  };
}


/**
 * One toolbar control: a named, tooltipped button, or a toggle that also reports its state through
 * `aria-pressed`. Every control is at least 32 CSS px square (above the 24 px minimum), carries an
 * accessible name, and is reachable and operable from the keyboard.
 *
 * BLITZY [A11Y]: the design system's pressed treatment (`aria-pressed:bg-muted` on a transparent
 * toggle) measures about 1.06:1 against the unpressed surface, below WCAG 2.2 SC 1.4.11's 3:1 for a
 * state indicator. It is implemented as the system ships it — `aria-pressed` still carries the state
 * for assistive technology — and flagged for designer review rather than darkened here.
 */
interface ToolbarControlProps {
  readonly label: string;
  readonly icon: ReactNode;
  readonly onSelect: () => void;
  /** The state of a mark or block; omitted for a control that only performs an action. */
  readonly pressed?: boolean;
  readonly disabled?: boolean;
}

function ToolbarControl({ label, icon, onSelect, pressed, disabled }: ToolbarControlProps) {
  const control =
    pressed === undefined ? (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        disabled={disabled}
        onClick={onSelect}
      >
        {icon}
      </Button>
    ) : (
      <Toggle
        type="button"
        size="sm"
        aria-label={label}
        pressed={pressed}
        disabled={disabled}
        onPressedChange={onSelect}
      >
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

/**
 * The bounded toolbar, and the whole of the authoring surface: the marks and blocks the profile
 * admits, the three admitted heading levels, link set and remove, the media handoff, and undo/redo.
 * Nothing else is offered, so a control cannot produce a node the record would refuse on save.
 *
 * The heading levels are one single-select group rather than three independent toggles, because a
 * block has exactly one level: pressing the active level returns the block to a paragraph.
 *
 * The controls sit in a `fieldset`: the markup states the grouping rather than asserting a role for
 * it. The toolbar wraps at narrow viewports instead of scrolling, so no job needs a horizontal drag
 * and the page never scrolls sideways at 320 CSS px.
 */
interface EditorToolbarProps {
  readonly editor: Editor;
  readonly onOpenLink: () => void;
  readonly onRequestMedia?: () => void;
}

function EditorToolbar({ editor, onOpenLink, onRequestMedia }: EditorToolbarProps) {
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      underline: current.isActive("underline"),
      strike: current.isActive("strike"),
      code: current.isActive("code"),
      heading:
        ADMITTED_HEADING_LEVELS.find((level) => current.isActive("heading", { level })) ?? null,
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
    <fieldset
      aria-label="Text formatting"
      className="flex min-w-0 flex-wrap items-center gap-1 border-0 p-0"
    >
      <ToolbarControl
        label="Bold"
        icon={<Bold aria-hidden="true" />}
        pressed={active.bold}
        onSelect={() => {
          editor.chain().focus().toggleBold().run();
        }}
      />
      <ToolbarControl
        label="Italic"
        icon={<Italic aria-hidden="true" />}
        pressed={active.italic}
        onSelect={() => {
          editor.chain().focus().toggleItalic().run();
        }}
      />
      <ToolbarControl
        label="Underline"
        icon={<Underline aria-hidden="true" />}
        pressed={active.underline}
        onSelect={() => {
          editor.chain().focus().toggleUnderline().run();
        }}
      />
      <ToolbarControl
        label="Strikethrough"
        icon={<Strikethrough aria-hidden="true" />}
        pressed={active.strike}
        onSelect={() => {
          editor.chain().focus().toggleStrike().run();
        }}
      />
      <ToolbarControl
        label="Code"
        icon={<Code aria-hidden="true" />}
        pressed={active.code}
        onSelect={() => {
          editor.chain().focus().toggleCode().run();
        }}
      />

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

      <ToolbarControl
        label="Bulleted list"
        icon={<List aria-hidden="true" />}
        pressed={active.bulletList}
        onSelect={() => {
          editor.chain().focus().toggleBulletList().run();
        }}
      />
      <ToolbarControl
        label="Numbered list"
        icon={<ListOrdered aria-hidden="true" />}
        pressed={active.orderedList}
        onSelect={() => {
          editor.chain().focus().toggleOrderedList().run();
        }}
      />
      <ToolbarControl
        label="Quotation"
        icon={<TextQuote aria-hidden="true" />}
        pressed={active.blockquote}
        onSelect={() => {
          editor.chain().focus().toggleBlockquote().run();
        }}
      />
      <ToolbarControl
        label="Code block"
        icon={<SquareCode aria-hidden="true" />}
        pressed={active.codeBlock}
        onSelect={() => {
          editor.chain().focus().toggleCodeBlock().run();
        }}
      />

      <Separator orientation="vertical" className="mx-0.5 h-6 self-center" />

      <ToolbarControl label="Link" icon={<Link2 aria-hidden="true" />} onSelect={onOpenLink} />
      <ToolbarControl
        label="Remove link"
        icon={<Unlink aria-hidden="true" />}
        disabled={!active.link}
        onSelect={() => {
          editor.chain().focus().extendMarkRange("link").unsetLink().run();
        }}
      />

      {onRequestMedia === undefined ? null : (
        <>
          <Separator orientation="vertical" className="mx-0.5 h-6 self-center" />
          <ToolbarControl
            label="Insert image"
            icon={<ImagePlus aria-hidden="true" />}
            onSelect={onRequestMedia}
          />
          <ToolbarControl
            label="Insert video"
            icon={<Video aria-hidden="true" />}
            onSelect={onRequestMedia}
          />
        </>
      )}

      <Separator orientation="vertical" className="mx-0.5 h-6 self-center" />

      <ToolbarControl
        label="Undo"
        icon={<Undo2 aria-hidden="true" />}
        disabled={!active.canUndo}
        onSelect={() => {
          editor.chain().focus().undo().run();
        }}
      />
      <ToolbarControl
        label="Redo"
        icon={<Redo2 aria-hidden="true" />}
        disabled={!active.canRedo}
        onSelect={() => {
          editor.chain().focus().redo().run();
        }}
      />
    </fieldset>
  );
}

/**
 * The deliberate paste choice: the only way pasted content enters the document.
 *
 * Three answers and no default. Converting keeps the admitted nodes and marks and names everything
 * left out, plain text keeps the words and drops the formatting, and cancelling changes nothing.
 * Escape and the close control both cancel, so dismissing the dialog never inserts anything.
 */
interface PasteDecisionDialogProps {
  readonly pending: PendingPaste | null;
  readonly onChoose: (decision: PasteDecision) => void;
}

function PasteDecisionDialog({ pending, onChoose }: PasteDecisionDialogProps) {
  const preview = pending?.preview ?? "";
  const convertRef = useRef<HTMLButtonElement>(null);
  const plainTextRef = useRef<HTMLButtonElement>(null);
  // A paste that carries no admitted structure has nothing to convert, so plain text becomes the
  // action the dialog opens on rather than leaving a disabled primary button in front of the author.
  const canConvert = (pending?.blocks ?? 0) > 0;

  return (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) {
          onChoose("cancel");
        }
      }}
    >
      <DialogContent initialFocus={() => (canConvert ? convertRef.current : plainTextRef.current)}>
        <DialogHeader>
          <DialogTitle>Choose how to paste</DialogTitle>
          <DialogDescription>
            Nothing is inserted until you choose. Formatting outside this editor&apos;s text profile
            is dropped, and direction-control characters are removed rather than stored.
          </DialogDescription>
        </DialogHeader>

        {pending === null ? null : (
          <div className="grid gap-2">
            <div className="max-h-40 overflow-y-auto rounded-lg border border-border bg-muted/40 p-3 text-xs break-words whitespace-pre-wrap">
              <bdi>{preview === "" ? "This clipboard carries no text to preview." : preview}</bdi>
            </div>
            {pending.previewTruncated ? (
              <p className="text-xs text-muted-foreground">The preview is shortened.</p>
            ) : null}
            {pending.dropped.length === 0 ? null : (
              <p className="text-xs text-muted-foreground">
                Not kept: <bdi>{pending.dropped.join(", ")}</bdi>.
              </p>
            )}
            {canConvert ? null : (
              <p className="text-xs text-muted-foreground">
                Converting keeps only the supported structure, and this paste brings none of it, so
                it would insert nothing. Inserting it as plain text keeps the words.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onChoose("cancel")}>
            Cancel
          </Button>
          <Button
            ref={plainTextRef}
            type="button"
            variant={canConvert ? "outline" : "default"}
            onClick={() => onChoose("plain-text")}
          >
            Insert as plain text
          </Button>
          <Button
            ref={convertRef}
            type="button"
            variant={canConvert ? "default" : "outline"}
            onClick={() => onChoose("convert")}
            disabled={!canConvert}
          >
            Convert to supported text
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The link destination form. The destination is validated by the content profile itself rather than
 * by a second set of rules here: a probe document carrying the candidate href is parsed, and the
 * profile's own message is what the field shows, so a `javascript:` or protocol-relative destination
 * is refused with the same wording the record would use.
 */
interface LinkDestinationDialogProps {
  readonly open: boolean;
  readonly href: string;
  readonly error: string | null;
  readonly onHrefChange: (href: string) => void;
  readonly onApply: () => void;
  readonly onCancel: () => void;
}

function LinkDestinationDialog({
  open,
  href,
  error,
  onHrefChange,
  onApply,
  onCancel,
}: LinkDestinationDialogProps) {
  const fieldId = useId();
  const errorId = useId();
  const fieldRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onCancel();
        }
      }}
    >
      <DialogContent initialFocus={() => fieldRef.current}>
        <DialogHeader>
          <DialogTitle>Link destination</DialogTitle>
          <DialogDescription>
            An absolute http or https address, or a path beginning with /. A link opens only where
            the content is read, never inside this editor.
          </DialogDescription>
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
            onFocus={(event) => {
              event.currentTarget.select();
            }}
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

/**
 * The single editing surface for Update prose and Page section prose.
 *
 * The editor is created once and never re-created for a keystroke; everything a handler needs that
 * can change — the direction, the save callback, the sections the caller handed over, the read-only
 * flag — is read through a ref, so an autosave triggered by a late timer still saves the current
 * content under the current context.
 */
export function ProseEditor({
  initialDocument,
  expectedRevision,
  direction,
  label,
  onSave,
  onRequestMedia,
  readOnly = false,
}: ProseEditorProps) {
  const labelId = useId();

  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const [pendingPaste, setPendingPaste] = useState<PendingPaste | null>(null);
  const [contentIssue, setContentIssue] = useState<string | null>(null);
  const [mediaPasteNotice, setMediaPasteNotice] = useState(false);
  const [linkDraft, setLinkDraft] = useState<{
    open: boolean;
    href: string;
    error: string | null;
  }>({ open: false, href: "", error: null });

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

  /**
   * The digest of the body the record holds. A change that returns the text to exactly this content
   * needs no save at all, which is what keeps an undo from producing a second, identical revision.
   * The ref is seeded lazily with the profile's own checksum — the same digest the record stores — so
   * "Saved" means the stored revision matches what is on screen, not that a request left.
   */
  const savedDigestRef = useRef<string | null>(null);
  if (savedDigestRef.current === null) {
    savedDigestRef.current = checksum(initialDocument);
  }

  /** Sends one attempt and renders exactly one outcome of the closed set. */
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
      // A rejected promise is not one of the eight outcomes. The honest reading is that this
      // surface does not know what happened, so the text stays and the author may save it again.
      outcome = null;
    }
    inFlightRef.current = false;

    if (!mountedRef.current) {
      return false;
    }

    if (outcome === null) {
      setSaveState({
        status: "failed",
        kind: "unavailable",
        message: "The save did not complete, and its result is not known here.",
        details: [
          "Your text is still in this editor.",
          "Saving again sends the text that is here now, against the revision it was read at.",
        ],
        operationId: null,
        halts: false,
        tone: "default",
        retry: "save-again",
      });
      return false;
    }

    if (
      outcome.outcome === "accepted" ||
      outcome.outcome === "alreadyAccepted" ||
      outcome.outcome === "unchanged"
    ) {
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

  /**
   * Builds the document the editor currently holds, validates it against the profile, and saves it
   * only when the content actually differs from what the record has. A document the profile refuses
   * is reported instead of sent, so the author learns about it before the server does.
   */
  const flush = useCallback(async (): Promise<void> => {
    const current = editorRef.current;
    if (current === null || current.isDestroyed) {
      return;
    }
    const props = propsRef.current;
    if (props.readOnly || haltedRef.current) {
      return;
    }
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

    const saved = await submit({
      document: parsed.document,
      revision: revisionRef.current,
      digest,
    });
    const queued = queuedRef.current;
    queuedRef.current = false;
    if (saved && queued) {
      await flushRef.current();
    }
  }, [submit]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  /** Restarts the autosave timer; a halted surface waits for the author instead of retrying blind. */
  const scheduleSave = useCallback(() => {
    if (propsRef.current.readOnly || haltedRef.current) {
      return;
    }
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void flushRef.current();
    }, AUTOSAVE_DELAY_MS);
  }, []);

  /**
   * The one editor in the application. `StarterKit` is narrowed to the profile: the heading levels
   * are the admitted three, the horizontal rule is switched off because the record has no node for
   * it, and links are configured never to navigate from inside the editor. Content checking is on so
   * an unreadable body is reported rather than silently repaired, and a paste never reaches the
   * document without the choice the `handlePaste` handler opens.
   */
  const editor = useEditor({
    immediatelyRender: false,
    editable: !readOnly,
    extensions: [
      StarterKit.configure({
        heading: { levels: [...ADMITTED_HEADING_LEVELS] },
        horizontalRule: false,
        link: {
          openOnClick: false,
          autolink: true,
          linkOnPaste: false,
          protocols: ["http", "https"],
          HTMLAttributes: { rel: "noopener noreferrer nofollow" },
        },
      }),
    ],
    content: { type: "doc", content: toEditorContent(initialDocument.content) },
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-readonly": readOnly ? "true" : "false",
        "aria-labelledby": labelId,
        class: EDITOR_PROSE_CLASS,
      },
      handlePaste: (view, event) => {
        const clipboard = event.clipboardData;
        if (clipboard === null) {
          return false;
        }
        const html = clipboard.getData("text/html");
        const text = clipboard.getData("text/plain");
        const hasFiles = clipboard.files.length > 0;
        if (html.trim() === "" && text.trim() === "" && !hasFiles) {
          return false;
        }

        if (html.trim() === "" && text.trim() === "") {
          // Media is never a prose node: a pasted file is reported and routed to the picker instead
          // of being dropped into the document, where it would vanish or bypass preparation.
          event.preventDefault();
          setMediaPasteNotice(true);
          return true;
        }

        let json: unknown;
        if (html.trim() !== "") {
          try {
            // An inert document: no script runs and no resource is fetched while the clipboard is
            // read, and the parse uses this editor's own schema, so the fragment offered to the
            // choice is expressed in exactly the vocabulary the record accepts.
            const parsedHtml = new window.DOMParser().parseFromString(html, "text/html");
            json = ProseMirrorDOMParser.fromSchema(view.state.schema)
              .parse(parsedHtml.body)
              .toJSON();
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
        setPendingPaste({
          json,
          text,
          preview,
          previewTruncated: truncated,
          dropped,
          blocks: blocks.length,
          from: view.state.selection.from,
          to: view.state.selection.to,
        });
        return true;
      },
    },
    enableContentCheck: true,
    onContentError: ({ error }) => {
      setContentIssue(error.message);
    },
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
    if (editor === null) {
      return;
    }
    editor.setEditable(!readOnly);
    editor.view.dom.setAttribute("aria-readonly", readOnly ? "true" : "false");
  }, [editor, readOnly]);

  useEffect(() => {
    if (editor === null) {
      return;
    }
    const handleUpdate = () => {
      scheduleSave();
    };
    // A surface that loses focus with a save still pending does not wait out the debounce: leaving
    // the field is the last moment this component knows the author has finished the sentence.
    const handleBlur = () => {
      if (timerRef.current === null) {
        return;
      }
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

  /** Applies one answer from the paste dialog; cancelling inserts nothing and returns the caret. */
  function applyPendingPaste(decision: PasteDecision) {
    const pending = pendingPaste;
    const current = editorRef.current;
    setPendingPaste(null);
    if (current === null || current.isDestroyed) {
      return;
    }
    if (decision === "cancel") {
      current.commands.focus();
      return;
    }

    const result = admittedPasteDecision(decision, {
      json: pending?.json,
      text: pending?.text ?? "",
    });

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

  /** Opens the link form on the destination the selection already carries, if it has one. */
  function openLinkDialog() {
    const current = editorRef.current;
    if (current === null) {
      return;
    }
    const existing: unknown = current.getAttributes("link").href;
    setLinkDraft({ open: true, href: typeof existing === "string" ? existing : "", error: null });
  }

  /** Applies the destination, or shows the profile's own refusal in the field. */
  function applyLink() {
    const current = editorRef.current;
    if (current === null) {
      return;
    }
    const href = linkDraft.href.trim();
    const probe = parseDocument({
      type: "doc",
      profileVersion: CONTENT_PROFILE_VERSION,
      direction: propsRef.current.direction,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "link", marks: [{ type: "link", attrs: { href } }] }],
        },
      ],
      sections: [],
    });
    if (probe.status === "invalid") {
      setLinkDraft((draft) => ({
        ...draft,
        error: probe.issues[0]?.message ?? "That destination cannot be used.",
      }));
      return;
    }
    current.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLinkDraft({ open: false, href: "", error: null });
  }

  /** Saves what the editor holds now — the recovery offered after an unreadable or lost save. */
  async function saveAgain() {
    haltedRef.current = false;
    await flushRef.current();
  }

  /**
   * Checks the result of the attempt whose fate was unknown: the same document against the same
   * revision, so the feature replays the stored result instead of creating a second effect. Anything
   * typed since is saved afterwards, without the author having to repeat the work.
   */
  async function checkResult() {
    const attempt = attemptRef.current;
    haltedRef.current = false;
    if (attempt === null) {
      await flushRef.current();
      return;
    }
    const saved = await submit(attempt);
    if (saved) {
      await flushRef.current();
    }
  }

  const statusText =
    saveState.status === "saving"
      ? "Saving…"
      : saveState.status === "saved"
        ? "Saved"
        : saveState.status === "failed"
          ? "Not saved — the text in this editor is the only copy."
          : "";

  return (
    <section
      dir={direction}
      aria-labelledby={labelId}
      className="flex w-full min-w-0 flex-col gap-2"
    >
      <span id={labelId} className="sr-only">
        {label}
      </span>

      {readOnly || editor === null ? null : (
        <TooltipProvider>
          <EditorToolbar
            editor={editor}
            onOpenLink={openLinkDialog}
            onRequestMedia={onRequestMedia}
          />
        </TooltipProvider>
      )}

      <div
        className={cn(
          "min-h-40 min-w-0 rounded-lg border border-input bg-input/30 motion-safe:transition-colors",
          "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
          readOnly && "border-transparent bg-transparent",
        )}
      >
        <EditorContent editor={editor} />
      </div>

      {/* `output` carries the status role natively, so the save state is announced once as it
          changes and is never proved by a notification that disappears. It stays mounted while
          idle, so the region exists before its text does. */}
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
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Dismiss the content message"
              onClick={() => {
                setContentIssue(null);
              }}
            >
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
                Attempt{" "}
                <bdi className="font-mono break-all">{saveState.operationId}</bdi>
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
          <AlertDescription>
            Images and video are added with the toolbar buttons, so they are prepared, placed and
            saved with the content. Nothing was inserted here.
          </AlertDescription>
          <AlertAction>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Dismiss the paste message"
              onClick={() => {
                setMediaPasteNotice(false);
              }}
            >
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
