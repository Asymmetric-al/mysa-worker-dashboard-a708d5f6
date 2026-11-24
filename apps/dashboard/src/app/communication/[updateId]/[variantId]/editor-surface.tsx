"use client";
/** The composition of one Update edition's editing surface, rendered by `/communication/[updateId]/[variantId]`. The editing surface belongs to the updates feature, and a feature may not reach another feature's provider, so the route states the browser's publishing preference here and hands it to the body: the release mode a new submission of this edition asks for. Nothing else about the edition depends on it — the submission records the mode, a reviewer cannot change it, and the mode sends no notice by itself. */
import type { ReactElement } from "react";
import { useViewerPreferences } from "@/features/shell/components/viewer-preferences-provider";
import { EditorShell, type EditorShellProps } from "@/features/updates/components/editor-shell";
import { PageSurface } from "../../../page-frame";
/** The level of the editor's own heading. `EditorShell` states its heading beneath this page's `h1` and can only compose levels 2 to 4, so the page supplies the level that nests under the heading it owns. */ const EDITOR_HEADING_LEVEL = 2;
/** The route's own title, stated once so the page's `h1` and the refusal arms its route states above the same heading cannot drift apart. */ export const PAGE_TITLE = "Update edition";
/** The envelope arm of the draft read, taken from the editor's own props so a change to that contract is a compile error here rather than a copy that drifts from it. */ type DraftEnvelope = Extract<NonNullable<EditorShellProps["initialDraft"]>, { readonly kind: "envelope" }>["envelope"];
export type EditorSurfaceProps = { /** The Update the address names, which every edition link inside the editor is built from. */ readonly updateId: string; /** The envelope the route already read, in the plain encoding a Client Component accepts. */ readonly envelope: DraftEnvelope };
/** The route's one `h1` and the family's editor beneath it, authored in the edition's own direction. The envelope is the only copy of the draft anywhere in this request: `EditorShell` seeds its own reads from it and takes every save, conflict and recovery path from the hooks it owns, so nothing here holds a second copy that could drift from it. */
export default function EditorSurface({ updateId, envelope }: EditorSurfaceProps): ReactElement {
  const { publishing } = useViewerPreferences(); // The preference is read once, here: the editor states the mode a new submission asks for and never edits it, because the submission fixes it and a reviewer cannot change it afterwards.
  return (
    <PageSurface headingId="update-edition-heading" title={PAGE_TITLE} dir={envelope.data.locale.direction}>
      <EditorShell scope={envelope.scope} updateId={updateId} variantId={envelope.data.variant.variantId} initialDraft={{ kind: "envelope", envelope }} headingLevel={EDITOR_HEADING_LEVEL} publishing={publishing} />
    </PageSurface>
  );
}
