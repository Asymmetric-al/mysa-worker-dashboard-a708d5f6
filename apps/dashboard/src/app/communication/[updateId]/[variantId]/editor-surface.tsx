"use client";
/**
 * The composition of one Update edition's editing surface, rendered by `/communication/[updateId]/[variantId]`.
 *
 * The editing surface belongs to the updates feature, and a feature may not reach another feature's provider, so the route
 * states the browser's publishing preference here and hands it to the body: the release mode a new submission of this
 * edition asks for. Nothing else about the edition depends on it — the submission records the mode, a reviewer cannot
 * change it, and the mode sends no notice by itself.
 */
import type { ReactElement } from "react";
import { useViewerPreferences } from "@/features/shell/components/viewer-preferences-provider";
import { EditorShell, type EditorShellProps } from "@/features/updates/components/editor-shell";

/** The route's one `h1`: it names the job, never a record, so the same heading is honest whatever the read answers. */
const SURFACE_TITLE = "Update edition";

/**
 * The level of the editor's own heading. `EditorShell` states its heading beneath this page's `h1` and can only compose
 * levels 2 to 4, so the page supplies the level that nests under the heading it owns.
 */
const EDITOR_HEADING_LEVEL = 2;

const TITLE_ID = "update-edition-heading";

const ROOT_CLASS = "flex min-w-0 flex-col gap-6 text-start";

const TITLE_CLASS = "text-2xl font-semibold text-pretty wrap-anywhere";

/** The envelope arm of the draft read, taken from the editor's own props so a change to that contract is a compile error here rather than a copy that drifts from it. */
type DraftEnvelope = Extract<NonNullable<EditorShellProps["initialDraft"]>, { readonly kind: "envelope" }>["envelope"];

export interface EditorSurfaceProps {
  /** The Update the address names, which every edition link inside the editor is built from. */
  readonly updateId: string;
  /** The envelope the route already read, in the plain encoding a Client Component accepts. */
  readonly envelope: DraftEnvelope;
}

/**
 * The route's one `h1` and the family's editor beneath it, authored in the edition's own direction. The envelope is the
 * only copy of the draft anywhere in this request: `EditorShell` seeds its own reads from it and takes every save,
 * conflict and recovery path from the hooks it owns, so nothing here holds a second copy that could drift from it.
 */
export default function EditorSurface({ updateId, envelope }: EditorSurfaceProps): ReactElement {
  // The preference is read once, here: the editor states the mode a new submission asks for and never edits it, because
  // the submission fixes it and a reviewer cannot change it afterwards.
  const { publishing } = useViewerPreferences();
  return (
    <section aria-labelledby={TITLE_ID} dir={envelope.data.locale.direction} className={ROOT_CLASS}>
      <h1 id={TITLE_ID} className={TITLE_CLASS}>
        {SURFACE_TITLE}
      </h1>
      <EditorShell scope={envelope.scope} updateId={updateId} variantId={envelope.data.variant.variantId} initialDraft={{ kind: "envelope", envelope }} headingLevel={EDITOR_HEADING_LEVEL} publishing={publishing} />
    </section>
  );
}
