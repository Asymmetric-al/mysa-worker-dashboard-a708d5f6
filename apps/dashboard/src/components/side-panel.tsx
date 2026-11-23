"use client";
import { XIcon } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import RecordDetail, { type RecordDetailProps } from "@/components/record-detail";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/cn";
import { useDismissableLayer, useModalFocusContainment, type DismissReason } from "@/lib/ui-sdk";
export type SidePanelVariant = "desktop" | "phone";
/** The two ways a caller states the panel's body, of which it states exactly one: the shared record body as a `detail` statement, which this shell lays out for the variant it presents, or a family's own body, which already carries its own headings and its own layout for the presentation it lands in. A family body is the same one its direct route renders, so the panel adds no second implementation of it. */
export type SidePanelDetailBody = { readonly detail: Omit<RecordDetailProps, "layout"> };
export type SidePanelOwnBody = { readonly body: ReactNode };
export type SidePanelChrome = { readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly variant: SidePanelVariant; readonly title: string; readonly returnFocusTo?: RefObject<HTMLElement | null>; readonly className?: string };
export type SidePanelProps = SidePanelChrome & (SidePanelDetailBody | SidePanelOwnBody);
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
const toHeadingId = (generated: string): string => `side-panel-${generated.replace(/[^a-zA-Z0-9_-]/g, "")}-title`;
/** Presents one record beside a list on a desktop, or as a sheet on a phone. */
/** The body this shell presents in the layout its variant is, from whichever of the two statements the caller made. */
const panelBodyOf = (props: SidePanelProps, layout: "panel" | "sheet"): ReactNode => ("detail" in props ? <RecordDetail {...props.detail} layout={layout} /> : props.body);
export function SidePanel(props: SidePanelProps) {
  const { open, onOpenChange, variant, title, returnFocusTo, className } = props;
  const generatedId = useId();
  const titleId = toHeadingId(generatedId);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
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
    if (!focusWasReleased()) return;
    resolveReturnTarget()?.focus();
  }, [resolveReturnTarget]);
  const requestClose = useCallback(() => onOpenChange(false), [onOpenChange]);
  useEffect(() => {
    if (open) return;
    const remember = (event: FocusEvent): void => {
      const target = event.target;
      if (target instanceof HTMLElement) openerRef.current = target;
    };
    document.addEventListener("focusin", remember, true);
    return () => document.removeEventListener("focusin", remember, true);
  }, [open]);
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
  useDismissableLayer({ open: open && variant === "desktop", layerRef: panelRef, onDismiss: handleDismiss });
  useModalFocusContainment({ open: open && variant === "phone", dialogRef: sheetRef, initialFocusRef: headingRef, onDismiss: handleSheetDismiss });
  if (variant === "phone") {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent ref={setSheetElement} side="bottom" className={cn(PHONE_SURFACE_CLASS, className)} initialFocus={false} finalFocus={() => resolveReturnTarget() ?? true} data-side-panel="phone">
          <SheetHeader className={PHONE_HEADER_CLASS}>
            <SheetTitle ref={headingRef} tabIndex={-1} className="break-words">
              {title}
            </SheetTitle>
          </SheetHeader>
          <div className={PHONE_BODY_CLASS}>{panelBodyOf(props, "sheet")}</div>
        </SheetContent>
      </Sheet>
    );
  }
  if (!open) return null;
  return (
    <aside ref={panelRef} data-slot="side-panel" data-side-panel="desktop" aria-labelledby={titleId} className={cn(DESKTOP_SURFACE_CLASS, className)}>
      <div className={DESKTOP_HEADER_CLASS}>
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className={DESKTOP_HEADING_CLASS}>
          {title}
        </h2>
        <Button type="button" variant="ghost" size="icon-sm" onClick={requestClose}>
          <XIcon />
          <span className="sr-only">{CLOSE_LABEL}</span>
        </Button>
      </div>
      <div className={DESKTOP_BODY_CLASS}>{panelBodyOf(props, "panel")}</div>
    </aside>
  );
}
export default SidePanel;
