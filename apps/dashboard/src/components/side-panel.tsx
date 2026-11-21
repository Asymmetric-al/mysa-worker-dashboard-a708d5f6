"use client";

/**
 * The one shell for the two in-place presentations of a record: the column beside a list on a
 * desktop, and the full-width sheet a phone shows. The third presentation is the record's own
 * route, which renders the body directly and needs no chrome from here.
 *
 * One body, three chromes. Every section, heading, action, empty state and unavailable notice
 * comes from the record detail body this shell composes; the shell renders no record field of
 * its own, so a fact cannot appear in a panel and vanish at the route. `layout` is the only thing
 * this file sets on that body — `panel` for the desktop column, `sheet` for the phone — and it
 * changes density and heading level only, never which sections or actions exist.
 *
 * Desktop. A labelled complementary landmark (`<aside>`, named by `aria-labelledby`) occupying
 * its own column beside the list at the desktop breakpoint. It is deliberately not modal and
 * holds no focus trap, because the list behind it must stay scrollable, clickable and reachable
 * by keyboard: a worker compares rows, opens the next record and works the filters without
 * closing anything. Dismissal — Escape, or a press outside the panel — arrives through the UI
 * SDK's dismissable layer, which is the one route this application takes to that behaviour. A
 * press inside a design-system popup this panel opened is not a press outside the panel: without
 * that distinction a menu, picker or dialog opened from the panel would dismiss the panel on the
 * press that was about to choose one of its own items, and the action would be lost. The panel
 * pushes no history and touches no query state, so closing it returns to the same rows, filters,
 * sort and scroll position, and the back button still means the list.
 *
 * Phone. The design system's `Sheet`, which is a modal dialog: the surface is named by its title,
 * the page behind it is isolated from assistive technology, and Escape, the backdrop and the close
 * control dismiss it. Focus never leaves it — the containment hook places initial focus on the
 * heading, wraps Tab and Shift+Tab inside the surface, and hands focus back as it closes. The
 * dialog supplies the modal semantics and the adapter supplies the one Tab cycle, because a modal
 * surface whose focus can still reach the page behind it is not modal for a keyboard user.
 *
 * Focus. Opening either variant moves focus to the panel's heading rather than to the first
 * control, so a reader hears what they opened before hearing what it can do. Closing returns
 * focus to `returnFocusTo` when the caller names the row that opened it, otherwise to the control
 * that held focus when the panel opened, and finally to the first control in the record list's
 * first row. The phone sheet hands that target to its dialog's own exit step, which alone knows
 * when the exiting surface has released the page; the desktop column has no dialog and returns
 * focus itself. Focus is returned only when it was released — a close caused by activating another
 * row leaves that row's focus alone.
 *
 * Direction and tokens. Nothing here sets `dir`: the sheet takes its direction from the design
 * system's provider and the desktop column uses a logical border and logical padding, so the
 * panel sits on the correct side in a right-to-left interface. Every class is a semantic token
 * utility or a spacing-scale utility; no colour, radius, shadow or arbitrary length is stated.
 * The shell declares no transition of its own, and the stylesheet collapses every transition and
 * animation under `prefers-reduced-motion`, so nothing moves for a reader who asked it not to.
 *
 * What it refuses. It fetches nothing and holds no record state: it presents the envelope the
 * route or the list already read, so the service stays the only owner of filtering, totals,
 * revisions and scope. It re-implements no section, so a feature that needs a new one adds it to
 * the body. It never closes itself — every dismissal is a request the caller may refuse, which is
 * how a body holding unsaved input keeps its Save, Discard or Stay choice — and it imports no
 * primitive directly, because the behaviour it needs arrives through `@/lib/ui-sdk`. The body
 * never imports this file, so the import direction stays one-way.
 *
 * Accessibility. Both variants are a named landmark or dialog, both put focus on the heading,
 * both offer a visible close control at 32 CSS px (above the 24x24 floor of WCAG 2.2 2.5.8), and
 * both keep the focused control clear of the sticky action bar because the stylesheet's global
 * scroll padding applies to the panel's own scroll port (2.4.11). The body is the only vertical
 * scroll port on either surface; neither variant scrolls horizontally, so a wide table inside
 * the body keeps its own labelled region.
 */

import { XIcon } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";

import RecordDetail, { type RecordDetailProps } from "@/components/record-detail";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/cn";
import { useDismissableLayer, useModalFocusContainment, type DismissReason } from "@/lib/ui-sdk";

// ---------------------------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------------------------

/**
 * The presentations this shell renders.
 *
 * The record's own route is not a member: it renders the body on its own and has no chrome to
 * share, so the closed union names exactly the two surfaces that need a shell.
 */
export type SidePanelVariant = "desktop" | "phone";

/** Props of {@link SidePanel}. */
export interface SidePanelProps {
  /** Whether the panel is shown. The caller owns this, so closing a panel never opens another. */
  readonly open: boolean;

  /**
   * Called with the requested visibility whenever the shell asks to close — its close control,
   * Escape, a press outside the desktop column, or the sheet's backdrop. The caller decides, and
   * the shell never closes itself: a surface whose body holds unsaved input refuses the request
   * here and puts its Save, Discard or Stay choice to the reader, so a dismissal can never
   * silently throw work away. Nothing else in the shell reads the panel's state.
   */
  readonly onOpenChange: (open: boolean) => void;

  /** Which chrome presents the body. See {@link SidePanelVariant}. */
  readonly variant: SidePanelVariant;

  /**
   * The accessible name of the region or dialog, and the visible label of the desktop column —
   * for example "Partner record". It names the shell, not the record: the record's own name is
   * the identity heading the body renders.
   */
  readonly title: string;

  /**
   * The body to present. `layout` is intentionally absent: this shell sets it from the variant,
   * so a caller cannot hand a phone a page-density body (or a desktop column a page heading) and
   * have the two presentations disagree about the same record.
   */
  readonly detail: Omit<RecordDetailProps, "layout">;

  /**
   * The control that opened the panel — the row a worker activated — so focus returns exactly
   * there on close.
   *
   * Typed to accept a ref that may hold `null`, which is what `useRef<HTMLButtonElement>(null)`
   * and every other hook-built ref is, so a caller never has to cast or narrow a ref to pass it.
   * Omitted, focus returns to the control that held it when the panel opened, and failing that
   * to the first control in the record list's first row.
   */
  readonly returnFocusTo?: RefObject<HTMLElement | null>;

  /** Layout classes for the shell's own surface. Never a colour, radius or shadow. */
  readonly className?: string;
}

// ---------------------------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------------------------

/**
 * The desktop column.
 *
 * `border-s` puts the boundary on the inline-start edge, so the panel is separated from the list
 * on the correct side in either direction, and `shrink-0` keeps the column from being squeezed by
 * the list beside it — which is what stops a wide table from pushing the page sideways. At the
 * desktop breakpoint it sticks below the shell's own offset, capped at the viewport height so its
 * body scrolls instead of the page.
 */
const DESKTOP_SURFACE_CLASS =
  "flex w-full min-w-0 shrink-0 flex-col border-s border-border bg-card text-card-foreground lg:sticky lg:top-0 lg:max-h-dvh lg:w-96 lg:self-start";

/** The desktop header: the region's label and its close control, above the scrolling body. */
const DESKTOP_HEADER_CLASS =
  "flex items-start justify-between gap-2 border-b border-border px-4 py-3";

/**
 * The desktop label's type.
 *
 * It is deliberately quieter than the record's identity heading, which the body renders a moment
 * later: the label says what this column is, the heading says who it is about. `break-words`
 * keeps a long caller-supplied label inside the column rather than widening it.
 */
const DESKTOP_HEADING_CLASS =
  "min-w-0 break-words font-heading text-sm font-medium text-muted-foreground";

/**
 * The scroll port that holds the body.
 *
 * `overflow-y-auto` gives the column its own vertical scroll; `overflow-x-clip` keeps that from
 * turning into a second horizontal scroller (a scroll port on one axis makes the other `auto`),
 * so the only horizontal scrolling on the surface is a table's own labelled region.
 */
const DESKTOP_BODY_CLASS = "min-h-0 flex-1 overflow-y-auto overflow-x-clip px-4";

/**
 * The phone sheet's surface: full width on a bottom sheet, never taller than the viewport, and
 * without the header's default padding so the header and body below can own their own rhythm.
 */
const PHONE_SURFACE_CLASS = "max-h-dvh p-0";

/**
 * The phone header.
 *
 * The end padding clears the design-system close control, which the sheet positions in the
 * corner of its own surface; `ps`/`pe` rather than `pl`/`pr` keeps that clearance on the correct
 * side when the interface reads right to left.
 */
const PHONE_HEADER_CLASS = "gap-1.5 border-b border-border py-3 ps-4 pe-14";

/** The phone sheet's scroll port, with the same one-axis rule as the desktop column. */
const PHONE_BODY_CLASS = "min-h-0 flex-1 overflow-y-auto overflow-x-clip px-4";

/** The close control's name, identical in both variants for consistent identification. */
const CLOSE_LABEL = "Close";

// ---------------------------------------------------------------------------------------------
// Dismissal and focus helpers
// ---------------------------------------------------------------------------------------------

/**
 * The design-system popups whose open state makes a press "inside the surface the person is
 * using" rather than a press beside the panel.
 *
 * Every one of these is portalled to the document body, so a press on it lands outside the
 * panel's own element and would otherwise dismiss the panel on the way to choosing an item — the
 * popup would unmount before the press completed and the action would be lost. Tooltips are
 * absent on purpose: they carry no action, so a press while one is visible is still a press
 * outside the panel.
 */
const OPEN_POPUP_SELECTOR = [
  '[data-slot="dialog-content"][data-open]',
  '[data-slot="alert-dialog-content"][data-open]',
  '[data-slot="sheet-content"][data-open]',
  '[data-slot="popover-content"][data-open]',
  '[data-slot="select-content"][data-open]',
  '[data-slot="dropdown-menu-content"][data-open]',
  '[data-slot="combobox-content"][data-open]',
].join(", ");

/**
 * Whether a design-system popup that can hold an action is open anywhere in the document,
 * ignoring the surface named in `own`.
 *
 * `own` is the modal surface this shell is presenting, when it has one: its own dialog counts as
 * an open popup, and refusing to dismiss it on that basis would leave the sheet unable to close
 * from its own backdrop. What the argument filters out is the surface itself, not the popups a
 * person opened inside it.
 */
function hasOpenPopup(own: HTMLElement | null): boolean {
  for (const popup of document.querySelectorAll(OPEN_POPUP_SELECTOR)) {
    if (own !== null && (popup === own || popup.contains(own) || own.contains(popup))) {
      continue;
    }
    return true;
  }
  return false;
}

/**
 * Whether a dismissal may close the surface it belongs to.
 *
 * Two reasons are refused. The window losing focus is not the worker closing the panel. And a
 * press or an Escape that lands inside a design-system popup opened from this surface belongs to
 * that popup: dismissing here would unmount it before the press completed, and the action the
 * press was choosing would be lost. `own` names the surface's own dialog, when it has one, so its
 * own backdrop still closes it.
 */
function mayDismiss(reason: DismissReason, own: HTMLElement | null): boolean {
  return reason !== "window-blur" && !hasOpenPopup(own);
}

/**
 * The first control in the record list's first row, which is where focus goes when neither the
 * caller's ref nor any remembered control can take it.
 *
 * The lookup is by the shared list's own `data-slot`, so it is a contract between two shared
 * components rather than a guess about a feature's markup, and it returns nothing when no list is
 * on the surface — an absent list is not an error, it is simply no destination.
 */
function firstRecordListControl(): HTMLElement | null {
  const control = document.querySelector(
    '[data-slot="record-list"] tbody tr:first-child a[href], [data-slot="record-list"] tbody tr:first-child button',
  );
  return control instanceof HTMLElement ? control : null;
}

/**
 * Whether the panel's close released focus, rather than moving it somewhere real.
 *
 * A close caused by activating another row leaves focus on that row, and dragging it back to the
 * previous one would undo the activation the worker just made. Focus counts as released when
 * nothing holds it (the page body) or when the element that held it has left the document —
 * which is what happens to a control inside the panel that has just been removed.
 */
function focusWasReleased(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body || !active.isConnected;
}

/**
 * A heading id that is safe to reference from `aria-labelledby` and to read in a DOM snapshot.
 *
 * `useId` is unique per render tree but may contain characters that make an id awkward to quote,
 * so it is reduced to identifier characters and prefixed: the value names this shell, not the
 * record, and two panels on one page still get two ids.
 */
function toHeadingId(generated: string): string {
  return `side-panel-${generated.replace(/[^a-zA-Z0-9_-]/g, "")}-title`;
}

// ---------------------------------------------------------------------------------------------
// The shell
// ---------------------------------------------------------------------------------------------

/**
 * Presents one record beside a list on a desktop, or as a sheet on a phone.
 *
 * Both variants render the record detail body and add nothing of their own beyond a heading and a
 * close control; what differs is chrome — a labelled, non-modal column that leaves the list usable,
 * or a modal sheet that contains focus. The focus, direction, dismissal and token rules this
 * component implements are stated once at the top of this file.
 */
export function SidePanel({
  open,
  onOpenChange,
  variant,
  title,
  detail,
  returnFocusTo,
  className,
}: SidePanelProps) {
  const generatedId = useId();
  const titleId = toHeadingId(generatedId);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  // The sheet's dialog element, kept as state so the containment below binds the moment the
  // dialog exists. The design system's dialog mounts its popup a render after it opens, so a plain
  // ref would still be empty when the containment first ran, and nothing would tell it to run
  // again — leaving the modal surface without its Tab cycle.
  const [sheetElement, setSheetElement] = useState<HTMLDivElement | null>(null);
  const sheetRef = useMemo<RefObject<HTMLDivElement | null>>(
    () => ({ current: sheetElement }),
    [sheetElement],
  );
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  /**
   * Where focus goes on close: the row the caller named, else the control that held focus when
   * the panel opened, else the record list's first control.
   */
  const resolveReturnTarget = useCallback((): HTMLElement | null => {
    const named = returnFocusTo?.current ?? null;
    if (named !== null && named.isConnected) {
      return named;
    }

    const remembered = openerRef.current;
    if (remembered !== null && remembered.isConnected) {
      return remembered;
    }

    return firstRecordListControl();
  }, [returnFocusTo]);

  const restoreFocus = useCallback(() => {
    // A close that left focus on another real control released it deliberately; pulling it back
    // would undo the activation the worker just made.
    if (!focusWasReleased()) {
      return;
    }
    resolveReturnTarget()?.focus();
  }, [resolveReturnTarget]);

  const requestClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  // Remembers the control that held focus while the panel was closed. The answer is needed at
  // open time rather than at close time, because opening the panel moves focus into it and the
  // row that started the visit is no longer the active element afterwards.
  useEffect(() => {
    if (open) {
      return;
    }

    const remember = (event: FocusEvent): void => {
      const target = event.target;
      if (target instanceof HTMLElement) {
        openerRef.current = target;
      }
    };

    document.addEventListener("focusin", remember, true);
    return () => {
      document.removeEventListener("focusin", remember, true);
    };
  }, [open]);

  // Focus moves to the heading as the panel opens and back out as it closes. The phone variant's
  // containment hook places and returns focus for the sheet, so only the desktop column — which
  // has no dialog to do either — is handled here.
  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;

    if (open) {
      if (!wasOpen && variant === "desktop") {
        headingRef.current?.focus();
      }
      return;
    }

    if (wasOpen && variant === "desktop") {
      restoreFocus();
    }
  }, [open, variant, restoreFocus]);

  const handleDismiss = useCallback(
    (reason: DismissReason) => {
      if (mayDismiss(reason, null)) {
        requestClose();
      }
    },
    [requestClose],
  );

  const handleSheetDismiss = useCallback(
    (reason: DismissReason) => {
      if (mayDismiss(reason, sheetRef.current)) {
        requestClose();
      }
    },
    [requestClose, sheetRef],
  );

  // The desktop column's dismissal: Escape and a press outside it, non-modal, so the press still
  // reaches the list and the panel leaves no focus trap behind.
  useDismissableLayer({
    open: open && variant === "desktop",
    layerRef: panelRef,
    onDismiss: handleDismiss,
  });

  // The phone sheet's containment: initial focus on the heading, Tab and Shift+Tab wrapped inside
  // the dialog, Escape and a press outside it, and focus returned when it closes. The design
  // system's dialog gives the surface its modal semantics and isolates the page behind it; this
  // hook is what keeps the Tab cycle inside, because a modal surface whose focus can still reach
  // the page behind it is not modal for a keyboard user.
  useModalFocusContainment({
    open: open && variant === "phone",
    dialogRef: sheetRef,
    initialFocusRef: headingRef,
    onDismiss: handleSheetDismiss,
  });

  if (variant === "phone") {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          ref={setSheetElement}
          side="bottom"
          className={cn(PHONE_SURFACE_CLASS, className)}
          // The dialog places no focus of its own: initial focus and the Tab cycle are the
          // containment hook's in this component, so one behaviour has one owner and the surface
          // never carries two sets of focus guards. Focus on the way out is the `finalFocus` step.
          initialFocus={false}
          // The sheet's dialog returns focus, at the moment its exiting surface stops holding the
          // page; this shell decides only where. `true` keeps the dialog's own default when
          // nothing on the surface can take focus, rather than stranding focus on the document.
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

  if (!open) {
    return null;
  }

  return (
    <aside
      ref={panelRef}
      data-slot="side-panel"
      data-side-panel="desktop"
      aria-labelledby={titleId}
      className={cn(DESKTOP_SURFACE_CLASS, className)}
    >
      <div className={DESKTOP_HEADER_CLASS}>
        {/* Focusable only programmatically: it is where the panel puts focus on open, and it is
            never a tab stop between the page and the body's own controls. */}
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
