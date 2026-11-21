"use client";
/** The one shell for the two in-place presentations of a record: the column beside a list on a desktop, and the full-width sheet a phone shows. */
import { XIcon } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import RecordDetail, { type RecordDetailProps } from "@/components/record-detail";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/cn";
import { useDismissableLayer, useModalFocusContainment, type DismissReason } from "@/lib/ui-sdk";
export type SidePanelVariant = "desktop" | "phone";
export type SidePanelProps = { readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly variant: SidePanelVariant; readonly title: string; readonly detail: Omit<RecordDetailProps, "layout">; readonly returnFocusTo?: RefObject<HTMLElement | null>; readonly className?: string };
const DESKTOP_SURFACE_CLASS = "flex w-full min-w-0 shrink-0 flex-col border-s border-border bg-card text-card-foreground lg:sticky lg:top-0 lg:max-h-dvh lg:w-96 lg:self-start";
const DESKTOP_HEADER_CLASS = "flex items-start justify-between gap-2 border-b border-border px-4 py-3";
const DESKTOP_HEADING_CLASS = "min-w-0 break-words font-heading text-sm font-medium text-muted-foreground";
const DESKTOP_BODY_CLASS = "min-h-0 flex-1 overflow-y-auto overflow-x-clip px-4";
const PHONE_SURFACE_CLASS = "max-h-dvh p-0";
const PHONE_HEADER_CLASS = "gap-1.5 border-b border-border py-3 ps-4 pe-14";
const PHONE_BODY_CLASS = "min-h-0 flex-1 overflow-y-auto overflow-x-clip px-4";
const CLOSE_LABEL = "Close";
const OPEN_POPUP_SELECTOR = [
  '[data-slot="dialog-content"][data-open]',
  '[data-slot="alert-dialog-content"][data-open]',
  '[data-slot="sheet-content"][data-open]',
  '[data-slot="popover-content"][data-open]',
  '[data-slot="select-content"][data-open]',
  '[data-slot="dropdown-menu-content"][data-open]',
  '[data-slot="combobox-content"][data-open]',
].join(", ");
function hasOpenPopup(own: HTMLElement | null): boolean {
  for (const popup of document.querySelectorAll(OPEN_POPUP_SELECTOR)) {
    if (own !== null && (popup === own || popup.contains(own) || own.contains(popup))) continue;
    return true;
  }
  return false;
}
const mayDismiss = (reason: DismissReason, own: HTMLElement | null): boolean => reason !== "window-blur" && !hasOpenPopup(own);
function firstRecordListControl(): HTMLElement | null {
  const control = document.querySelector('[data-slot="record-list"] tbody tr:first-child a[href], [data-slot="record-list"] tbody tr:first-child button');
  return control instanceof HTMLElement ? control : null;
}
function focusWasReleased(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body || !active.isConnected;
}
function toHeadingId(generated: string): string {
  return `side-panel-${generated.replace(/[^a-zA-Z0-9_-]/g, "")}-title`;
}
/** Presents one record beside a list on a desktop, or as a sheet on a phone. */
export function SidePanel({ open, onOpenChange, variant, title, detail, returnFocusTo, className }: SidePanelProps) {
  const generatedId = useId();
  const titleId = toHeadingId(generatedId);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  // The sheet's dialog element is kept as state so the containment binds the moment the dialog exists: the design system mounts its popup a render after opening, so a ref would still be empty and the modal surface would lose its Tab cycle.
  const [sheetElement, setSheetElement] = useState<HTMLDivElement | null>(null);
  const sheetRef = useMemo<RefObject<HTMLDivElement | null>>(() => ({ current: sheetElement }), [sheetElement]);
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const resolveReturnTarget = useCallback((): HTMLElement | null => {
    const named = returnFocusTo?.current ?? null;
    if (named !== null && named.isConnected) return named;
    const remembered = openerRef.current;
    return remembered !== null && remembered.isConnected ? remembered : firstRecordListControl();
  }, [returnFocusTo]);
  const restoreFocus = useCallback(() => {
    // A close that left focus on another real control released it deliberately; pulling it back would undo the activation the worker just made.
    if (!focusWasReleased()) return;
    resolveReturnTarget()?.focus();
  }, [resolveReturnTarget]);
  const requestClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);
  // Remembers the control that held focus while the panel was closed. The answer is needed at open time rather than at close time, because opening the panel moves focus into it and the row that started the visit is no longer the active element afterwards.
  useEffect(() => {
    if (open) return;
    const remember = (event: FocusEvent): void => {
      const target = event.target;
      if (target instanceof HTMLElement) openerRef.current = target;
    };
    document.addEventListener("focusin", remember, true);
    return () => document.removeEventListener("focusin", remember, true);
  }, [open]);
  // Focus moves to the heading as the panel opens and back out as it closes. The phone variant's containment hook places and returns focus for the sheet, so only the desktop column — which has no dialog to do either — is handled here.
  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;
    if (open) {
      if (!wasOpen && variant === "desktop") headingRef.current?.focus();
      return;
    }
    if (wasOpen && variant === "desktop") restoreFocus();
  }, [open, variant, restoreFocus]);
  const handleDismiss = useCallback(
    (reason: DismissReason) => {
      if (mayDismiss(reason, null)) requestClose();
    },
    [requestClose],
  );
  const handleSheetDismiss = useCallback(
    (reason: DismissReason) => {
      if (mayDismiss(reason, sheetRef.current)) requestClose();
    },
    [requestClose, sheetRef],
  );
  // The desktop column's dismissal: Escape and a press outside it, non-modal, so the press still reaches the list and the panel leaves no focus trap behind.
  useDismissableLayer({ open: open && variant === "desktop", layerRef: panelRef, onDismiss: handleDismiss });
  // The phone sheet's containment: initial focus on the heading, Tab and Shift+Tab wrapped inside, Escape and outside presses dismissing, and focus returned on close — the design system supplies the dialog's semantics, this hook keeps the Tab cycle inside it.
  useModalFocusContainment({ open: open && variant === "phone", dialogRef: sheetRef, initialFocusRef: headingRef, onDismiss: handleSheetDismiss });
  if (variant === "phone") {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          ref={setSheetElement}
          side="bottom"
          className={cn(PHONE_SURFACE_CLASS, className)}
          // The dialog places no focus of its own: initial focus and the Tab cycle are the containment hook's in this component, so one behaviour has one owner and the surface never carries two sets of focus guards. Focus on the way out is the `finalFocus` step.
          initialFocus={false}
          // The sheet's dialog returns focus, at the moment its exiting surface stops holding the page; this shell decides only where. `true` keeps the dialog's own default when nothing on the surface can take focus, rather than stranding focus on the document.
          finalFocus={() => resolveReturnTarget() ?? true}
          data-side-panel="phone"
        >
          <SheetHeader className={PHONE_HEADER_CLASS}>
            <SheetTitle ref={headingRef} tabIndex={-1} className="break-words">
              {title}
            </SheetTitle>
          </SheetHeader>
          <div className={PHONE_BODY_CLASS}>
            <RecordDetail {...detail} layout="sheet" />
          </div>
        </SheetContent>
      </Sheet>
    );
  }
  if (!open) return null;
  return (
    <aside ref={panelRef} data-slot="side-panel" data-side-panel="desktop" aria-labelledby={titleId} className={cn(DESKTOP_SURFACE_CLASS, className)}>
      <div className={DESKTOP_HEADER_CLASS}>
        {/* Focusable only programmatically: it is where the panel puts focus on open, and it is never a tab stop between the page and the body's own controls. */}
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className={DESKTOP_HEADING_CLASS}>
          {title}
        </h2>
        <Button type="button" variant="ghost" size="icon-sm" onClick={requestClose}>
          <XIcon />
          <span className="sr-only">{CLOSE_LABEL}</span>
        </Button>
      </div>
      <div className={DESKTOP_BODY_CLASS}>
        <RecordDetail {...detail} layout="panel" />
      </div>
    </aside>
  );
}
export default SidePanel;
