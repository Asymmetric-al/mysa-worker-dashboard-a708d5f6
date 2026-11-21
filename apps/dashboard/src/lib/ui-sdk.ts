"use client";
/** The one adapter between the application and the pinned UI SDK's behaviours. */
import { bindLayer, createRovingFocus, createTypeahead, isComposing, isTypeaheadKey, keepFocus, type LayerDismissReason, type RovingFocus, type RovingOrientation, type Store } from "@ui-sdk/core";
import { mergeProps } from "@ui-sdk/react/primitive";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
/** Why a dismissable layer or a modal asked to close: Escape, a pointer press outside it and outside its trigger, or the window losing focus. */
export type DismissReason = "escape-key" | "outside-press" | "window-blur";
function toDismissReason(reason: LayerDismissReason): DismissReason {
  switch (reason) {
    case "escape-key":
    case "outside-press":
    case "window-blur":
      return reason;
  }
}
const TYPEAHEAD_IDLE_MS = 500;
const TABBABLE_SELECTOR = ["a[href]", "button", 'input:not([type="hidden"])', "select", "textarea", "iframe", "summary", '[contenteditable]:not([contenteditable="false"])', "[tabindex]"].join(",");
function tabbableWithin(root: HTMLElement): HTMLElement[] {
  const found = Array.from(root.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR));
  return found.filter((element) => {
    if (element.hasAttribute("disabled")) return false;
    if (element.tabIndex < 0) return false;
    return element.closest("[inert]") !== null ? false : element.getClientRects().length > 0;
  });
}
function allowProgrammaticFocus(element: HTMLElement): void {
  if (!element.hasAttribute("tabindex")) element.tabIndex = -1;
  element.focus();
}
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
export type DismissableLayerOptions = { open: boolean; layerRef: RefObject<HTMLElement | null>; triggerRef?: RefObject<HTMLElement | null>; onDismiss: (reason: DismissReason) => void; modal?: boolean; topLayer?: boolean; closeOnBlur?: boolean };
export type DismissableLayerApi = { restoreFocus: () => void };
/** Dismisses a layer on Escape or a press outside it and outside its trigger, and returns focus to the trigger when it closes. */
export function useDismissableLayer(options: DismissableLayerOptions): DismissableLayerApi {
  const { open, layerRef, triggerRef, onDismiss, modal = false, topLayer = false } = options;
  const closeOnBlur = options.closeOnBlur ?? false;
  // Handlers below read the newest callbacks and refs through this, so a parent render never forces the layer to unbind and rebind mid-interaction.
  const latest = useRef({ onDismiss, triggerRef });
  useEffect(() => {
    latest.current = { onDismiss, triggerRef };
  }, [onDismiss, triggerRef]);
  const restoreFocus = useCallback(() => {
    keepFocus(() => latest.current.triggerRef?.current ?? undefined);
  }, []);
  useEffect(() => {
    const layer = layerRef.current;
    if (!open || layer === null) return;
    return bindLayer(layer, {
      modal,
      topLayer,
      closeOnBlur,
      // A press on the trigger is the caller's to handle, not an outside press.
      contains: (target) => latest.current.triggerRef?.current?.contains(target) ?? false,
      onDismiss: (reason) => latest.current.onDismiss(toDismissReason(reason)),
    });
  }, [open, layerRef, modal, topLayer, closeOnBlur]);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) restoreFocus();
    wasOpen.current = open;
  }, [open, restoreFocus]);
  return { restoreFocus };
}
type RovingConfig = { orientation: RovingFocusOrientation; loop: boolean; disabled?: (key: string) => boolean; preferred?: (key: string) => boolean; onActiveKeyChange?: (key: string | null) => void };
type RovingState = { stop: string | null; options: RovingConfig };
type RovingPart = { readonly key: string };
type RovingStoreListener = (liveOnly: boolean, delivered: boolean, changed: readonly string[]) => void;
type RovingStore = Store<RovingState> & { setOptions(options: RovingConfig): void };
function createRovingStore(initial: RovingConfig): RovingStore {
  let state: RovingState = { stop: null, options: initial };
  const listeners = new Set<RovingStoreListener>();
  return {
    get: () => state,
    set: (patch, delivered) => {
      const next = { ...state, ...patch };
      if (next.stop === state.stop) return;
      state = next;
      for (const listener of Array.from(listeners)) listener(false, delivered ?? false, ["stop"]);
    },
    setOptions: (options) => {
      state = { ...state, options };
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setFanout: () => {
      // Controlled state belongs to a primitive; a roving group has none.
    },
    follow: () => {
      // Nothing writes this group's state from outside, so there is nothing to follow.
    },
    view: (_next, read) => read(),
  };
}
/** Which arrows walk a roving group: one axis, or all four as a rating does. */
export type RovingFocusOrientation = RovingOrientation | "both";
export type RovingFocusOptions = { orientation?: RovingFocusOrientation; loop?: boolean; disabled?: (key: string) => boolean; preferred?: (key: string) => boolean; onActiveKeyChange?: (key: string | null) => void };
/** The props one item of a roving group spreads onto its element: the behaviour's own props, which `getItemProps` composes with the caller's own element props. */
export type RovingItemProps = { ref: (element: HTMLElement | null) => void | (() => void); tabIndex: 0 | -1; onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void; onFocus: () => void };
export type RovingFocusApi = { activeKey: string | null; getItemProps: <Own extends Record<string, unknown> = Record<string, never>>(key: string, ownProps?: Own) => RovingItemProps & Own; focusItem: (key: string) => void };
type RovingRegistration = { elements: Map<string, HTMLElement>; refs: Map<string, (element: HTMLElement | null) => void | (() => void)> };
type RovingGroup = { readonly teardowns: Set<() => void>; readonly roving: RovingFocus };
function rovingConfigOf(options: RovingFocusOptions): RovingConfig {
  return { orientation: options.orientation ?? "vertical", loop: options.loop ?? false, disabled: options.disabled, preferred: options.preferred, onActiveKeyChange: options.onActiveKeyChange };
}
/** Gives a list one tab stop and moves focus between its items with the arrow keys, Home and End; it never traps focus, so Tab leaves the group. */
export function useRovingFocus(options: RovingFocusOptions = {}): RovingFocusApi {
  // The SDK reads these options on each key press rather than while rendering, so the group's store carries them and the group itself is built once.
  const [store] = useState<RovingStore>(() => createRovingStore(rovingConfigOf(options)));
  useEffect(() => {
    store.setOptions(rovingConfigOf(options));
  }, [store, options]);
  const [group] = useState<RovingGroup>(() => {
    const teardowns = new Set<() => void>();
    return {
      teardowns,
      roving: createRovingFocus<RovingState, RovingPart>(
        { store, onDestroy: (cleanup) => teardowns.add(cleanup) },
        { slot: "item", key: "stop", orientation: () => store.get().options.orientation, loop: () => store.get().options.loop, disabled: (item) => store.get().options.disabled?.(item.key) ?? false, preferred: (item) => store.get().options.preferred?.(item.key) ?? false },
      ),
    };
  });
  const roving = group.roving;
  const [activeKey, setActiveKey] = useState<string | null>(null);
  useEffect(() => {
    return store.subscribe(() => {
      const next = store.get().stop;
      setActiveKey(next);
      store.get().options.onActiveKeyChange?.(next);
    });
  }, [store]);
  const [registration] = useState<RovingRegistration>(() => ({ elements: new Map<string, HTMLElement>(), refs: new Map<string, (element: HTMLElement | null) => void | (() => void)>() }));
  const refFor = useCallback(
    (key: string) => {
      const cached = registration.refs.get(key);
      if (cached !== undefined) return cached;
      const ref = (element: HTMLElement | null): void | (() => void) => {
        if (element === null) return;
        registration.elements.set(key, element);
        const unbind = roving.bind(element, { key, props: { key } });
        return () => {
          if (registration.elements.get(key) === element) registration.elements.delete(key);
          unbind();
        };
      };
      registration.refs.set(key, ref);
      return ref;
    },
    [registration, roving],
  );
  // Runs after every render so a change to `disabled` or `preferred` re-decides the stop; the store ignores a stop that has not moved, so this settles.
  useEffect(() => {
    roving.check();
  });
  const getItemProps = useCallback(
    <Own extends Record<string, unknown> = Record<string, never>>(key: string, ownProps?: Own): RovingItemProps & Own => {
      // The stop comes from React state so the item re-renders with it; the store's options only feed the SDK's own `claims` rule.
      const state: RovingState = { stop: activeKey, options: store.get().options };
      // The behaviour's props come first, so the caller's own handlers run ahead of them and a refusal there skips the move, while the registering `ref` and the class names combine and a plain prop the caller repeats wins.
      const composed: Record<string, unknown> = mergeProps(
        {
          ref: refFor(key),
          tabIndex: roving.tabIndex(state, { key, props: { key } }) === "0" ? 0 : -1,
          onKeyDown: (event) => {
            if (event.defaultPrevented) return;
            const element = registration.elements.get(key);
            if (element !== undefined) roving.keydown(event.nativeEvent, element);
          },
          onFocus: () => roving.remember(key),
        } satisfies RovingItemProps,
        ownProps ?? {},
      );
      return composed as RovingItemProps & Own;
    },
    [activeKey, refFor, registration, roving, store],
  );
  const focusItem = useCallback((key: string) => roving.focus(key), [roving]);
  // The SDK's own subscription belongs to this group; dropping it on unmount is the whole teardown, and `check` above keeps the stop decided either way.
  useEffect(() => {
    const teardowns = group.teardowns;
    return () => {
      for (const cleanup of Array.from(teardowns)) cleanup();
      teardowns.clear();
    };
  }, [group]);
  return { activeKey, getItemProps, focusItem };
}
export type TypeaheadOptions = { labels: () => readonly string[]; currentIndex?: () => number; onMatch: (index: number) => void; idleMs?: number; enabled?: boolean };
export type TypeaheadApi = { onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => boolean; reset: () => void; isActive: () => boolean };
/** Accumulates printable characters into a query that moves selection, cycling through the items that share the prefix and clearing after a short idle. */
export function useTypeahead(options: TypeaheadOptions): TypeaheadApi {
  const { labels, onMatch, currentIndex, idleMs = TYPEAHEAD_IDLE_MS, enabled = true } = options;
  const search = useMemo(() => createTypeahead(idleMs), [idleMs]);
  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>): boolean => {
      // A text entry keeps every printable character: it filters, it does not jump.
      if (!enabled || event.defaultPrevented || isTextEntry(event.target)) return false;
      if (event.ctrlKey || event.metaKey || event.altKey || isComposing(event)) return false;
      if (!isTypeaheadKey(event.nativeEvent)) return false;
      const items = labels();
      if (items.length === 0) return false;
      const offered = Array.from(items);
      const from = currentIndex?.() ?? 0;
      let index = search(event.key, offered, from);
      if (index < 0) {
        // A buffer that stops matching must not swallow the next characters: drop it and let this one start a fresh query, as typeahead expects.
        search.reset();
        index = search(event.key, offered, from);
      }
      if (index < 0) return false;
      event.preventDefault();
      onMatch(index);
      return true;
    },
    [enabled, labels, onMatch, currentIndex, search],
  );
  const reset = useCallback(() => {
    search.reset();
  }, [search]);
  const isActive = useCallback(() => search.active(), [search]);
  return { onKeyDown, reset, isActive };
}
export type ModalFocusContainmentOptions = { open: boolean; dialogRef: RefObject<HTMLElement | null>; triggerRef?: RefObject<HTMLElement | null>; initialFocusRef?: RefObject<HTMLElement | null>; onDismiss: (reason: DismissReason) => void };
export type ModalFocusContainmentApi = { restoreFocus: () => void };
/** Keeps focus inside an open dialog — initial focus within it, Tab and Shift+Tab wrapping — dismisses on Escape and returns focus to the invoking control when it closes. */
export function useModalFocusContainment(options: ModalFocusContainmentOptions): ModalFocusContainmentApi {
  const { open, dialogRef, triggerRef, initialFocusRef, onDismiss } = options;
  const latest = useRef({ onDismiss, triggerRef, initialFocusRef });
  useEffect(() => {
    latest.current = { onDismiss, triggerRef, initialFocusRef };
  }, [onDismiss, triggerRef, initialFocusRef]);
  // Where focus came from, captured as the dialog opens: the trigger when the caller names one, else whatever held focus before the dialog took it.
  const invoking = useRef<HTMLElement | null>(null);
  const restoreFocus = useCallback(() => {
    const target = invoking.current;
    invoking.current = null;
    keepFocus(() => target ?? undefined);
  }, []);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || dialog === null) return;
    const from = latest.current.triggerRef?.current;
    invoking.current = from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const preferred = latest.current.initialFocusRef?.current ?? null;
    if (preferred !== null) {
      preferred.focus();
    } else {
      const [first] = tabbableWithin(dialog);
      if (first !== undefined) {
        first.focus();
      } else {
        allowProgrammaticFocus(dialog);
      }
    }
    // The SDK's dialog preset is the only place it contains focus, and it needs a whole popup primitive; on its own `bindLayer` dismisses and blocks outside presses but leaves the Tab cycle alone. This is that cycle.
    const containTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const stops = tabbableWithin(dialog);
      const active = document.activeElement;
      const inside = active instanceof HTMLElement && dialog.contains(active);
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (first === undefined || last === undefined) {
        event.preventDefault();
        allowProgrammaticFocus(dialog);
        return;
      }
      if (event.shiftKey) {
        if (!inside || active === first || active === dialog) {
          event.preventDefault();
          last.focus();
        }
        return;
      }
      if (!inside || active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const releaseLayer = bindLayer(dialog, { modal: true, onDismiss: (reason) => latest.current.onDismiss(toDismissReason(reason)) });
    document.addEventListener("keydown", containTab, true);
    // Both go in one cleanup, so the page is fully reachable again the moment the dialog closes and a keyboard user is never left without a way out.
    return () => {
      document.removeEventListener("keydown", containTab, true);
      releaseLayer();
    };
  }, [open, dialogRef]);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) restoreFocus();
    wasOpen.current = open;
  }, [open, restoreFocus]);
  return { restoreFocus };
}
