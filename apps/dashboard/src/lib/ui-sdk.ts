"use client";

/**
 * The one adapter between the application and the pinned UI SDK's behaviours.
 *
 * Every generic interaction the application needs from a third party comes from
 * `@ui-sdk/*` 0.1.0-beta.13 and is reached here, so no component, feature or
 * domain module imports the SDK itself. The four behaviours below are the whole
 * contract: browser-only hooks that each take the caller's own options type and
 * return the caller's own result type, which keeps the SDK's surface out of
 * every consumer and lets a behaviour the SDK does not fully supply be finished
 * here without touching a single caller.
 *
 * The SDK supplies dismissal (`bindLayer`), focus return (`keepFocus`), roving
 * focus (`createRovingFocus`) and typeahead (`createTypeahead`). It exposes
 * modal focus containment only inside its dialog popup primitive, so that one
 * step — initial focus and the Tab cycle — is completed here and recorded in the
 * design-system gap register in `docs/architecture.md`. Everything else is
 * delegated: no focus management, arrow-key movement or dismissal logic is
 * reimplemented in this file.
 *
 * The application never reaches for the Base UI primitives from here. Base UI is
 * the substrate inside `src/components/ui` and the documented fallback there, so
 * this adapter exists to make the generic behaviours the shared patterns need
 * arrive through the UI SDK first.
 */

import {
  bindLayer,
  createRovingFocus,
  createTypeahead,
  isComposing,
  isTypeaheadKey,
  keepFocus,
  type LayerDismissReason,
  type RovingFocus,
  type RovingOrientation,
  type Store,
} from "@ui-sdk/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";

/**
 * Why a dismissable layer or a modal asked to close: Escape, a pointer press
 * outside it and outside its trigger, or the window losing focus.
 */
export type DismissReason = "escape-key" | "outside-press" | "window-blur";

/**
 * Maps the SDK's dismissal reason onto this module's own union. The SDK marks
 * its union `@experimental`; naming every member makes a future fourth reason a
 * compile error here rather than a silent pass-through to a consumer.
 */
function toDismissReason(reason: LayerDismissReason): DismissReason {
  switch (reason) {
    case "escape-key":
    case "outside-press":
    case "window-blur":
      return reason;
  }
}

/** How long partly typed typeahead characters stay one query; the SDK's own default. */
const TYPEAHEAD_IDLE_MS = 500;

/**
 * The focusable elements a Tab cycle can land on, as the browser orders them.
 * The SDK keeps its copy inside its primitives, so the selector is restated for
 * the containment step the SDK does not export (see the gap register).
 */
const TABBABLE_SELECTOR = [
  "a[href]",
  "button",
  'input:not([type="hidden"])',
  "select",
  "textarea",
  "iframe",
  "summary",
  '[contenteditable]:not([contenteditable="false"])',
  "[tabindex]",
].join(",");

/** The Tab stops inside a dialog, in document order, with disabled, inert and hidden ones left out. */
function tabbableWithin(root: HTMLElement): HTMLElement[] {
  const found = Array.from(root.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR));

  return found.filter((element) => {
    if (element.hasAttribute("disabled")) {
      return false;
    }
    if (element.tabIndex < 0) {
      return false;
    }
    if (element.closest("[inert]") !== null) {
      return false;
    }
    return element.getClientRects().length > 0;
  });
}

/** Makes an element a focus landing place when the dialog holds nothing focusable. */
function allowProgrammaticFocus(element: HTMLElement): void {
  if (!element.hasAttribute("tabindex")) {
    element.tabIndex = -1;
  }
  element.focus();
}

/** Whether a key press belongs to a text entry, which gets every printable character. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** The options a dismissable layer takes. */
export type DismissableLayerOptions = {
  /** Whether the layer is shown; it is bound to the SDK's layer stack only while it is. */
  open: boolean;
  /** The element holding the layer's content. */
  layerRef: RefObject<HTMLElement | null>;
  /** The element that opened the layer; focus returns here when the layer closes. */
  triggerRef?: RefObject<HTMLElement | null>;
  /** Called for Escape, a press outside the layer and, when `closeOnBlur` is set, the window losing focus. */
  onDismiss: (reason: DismissReason) => void;
  /** Whether a press outside only dismisses, without reaching the page beneath. */
  modal?: boolean;
  /** Whether the layer joins the browser's top layer. */
  topLayer?: boolean;
  /** Whether the window losing focus dismisses the layer. */
  closeOnBlur?: boolean;
};

/** What a dismissable layer gives back to its caller. */
export type DismissableLayerApi = {
  /** Returns focus to the trigger, for a close that happened without a dismiss reason. */
  restoreFocus: () => void;
};

/**
 * Dismisses a layer on Escape or a press outside it and outside its trigger, and
 * returns focus to the trigger when it closes.
 */
export function useDismissableLayer(options: DismissableLayerOptions): DismissableLayerApi {
  const { open, layerRef, triggerRef, onDismiss, modal = false, topLayer = false } = options;
  const closeOnBlur = options.closeOnBlur ?? false;

  // Handlers below read the newest callbacks and refs through this, so a parent
  // render never forces the layer to unbind and rebind mid-interaction.
  const latest = useRef({ onDismiss, triggerRef });
  useEffect(() => {
    latest.current = { onDismiss, triggerRef };
  }, [onDismiss, triggerRef]);

  const restoreFocus = useCallback(() => {
    keepFocus(() => latest.current.triggerRef?.current ?? undefined);
  }, []);

  useEffect(() => {
    const layer = layerRef.current;
    if (!open || layer === null) {
      return;
    }

    return bindLayer(layer, {
      modal,
      topLayer,
      closeOnBlur,
      // A press on the trigger is the caller's to handle, not an outside press.
      contains: (target) => latest.current.triggerRef?.current?.contains(target) ?? false,
      onDismiss: (reason) => {
        latest.current.onDismiss(toDismissReason(reason));
      },
    });
  }, [open, layerRef, modal, topLayer, closeOnBlur]);

  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) {
      restoreFocus();
    }
    wasOpen.current = open;
  }, [open, restoreFocus]);

  return { restoreFocus };
}

/** The options a group's callbacks read on each key press, with the defaults applied. */
type RovingConfig = {
  orientation: RovingFocusOrientation;
  loop: boolean;
  disabled?: (key: string) => boolean;
  preferred?: (key: string) => boolean;
  onActiveKeyChange?: (key: string | null) => void;
};

/** What a roving group's store holds: the key of the item with the tab stop, and the options it reads. */
type RovingState = { stop: string | null; options: RovingConfig };

/** The props a roving item offers the SDK, which asks an item only for its key. */
type RovingPart = { readonly key: string };

type RovingStoreListener = (
  liveOnly: boolean,
  delivered: boolean,
  changed: readonly string[],
) => void;

/** The store the SDK drives, plus the one call this module makes on it. */
type RovingStore = Store<RovingState> & { setOptions(options: RovingConfig): void };

/**
 * A store the SDK's roving focus can drive outside a primitive instance.
 *
 * `createRovingFocus` takes a primitive's context, whose store it reads and
 * writes to move the tab stop; a group composed in a shared pattern has no
 * primitive, so it gets this one. It also carries the group's options, because
 * the SDK calls back into them on each key press and a store keeps that read out
 * of rendering. The members the primitive kernel uses for controlled state stay
 * inert: a roving group owns its stop outright.
 */
function createRovingStore(initial: RovingConfig): RovingStore {
  let state: RovingState = { stop: null, options: initial };
  const listeners = new Set<RovingStoreListener>();

  return {
    get: () => state,
    set: (patch, delivered) => {
      const next = { ...state, ...patch };
      if (next.stop === state.stop) {
        return;
      }
      state = next;
      for (const listener of Array.from(listeners)) {
        listener(false, delivered ?? false, ["stop"]);
      }
    },
    setOptions: (options) => {
      state = { ...state, options };
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
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

/** The options a roving group takes. */
export type RovingFocusOptions = {
  /** Which arrows move focus. Defaults to Up and Down. */
  orientation?: RovingFocusOrientation;
  /** Whether moving past either end wraps around. Defaults to false. */
  loop?: boolean;
  /** Whether an item cannot be activated; enabled items take the tab stop first. */
  disabled?: (key: string) => boolean;
  /** Whether an item takes the tab stop before focus has been in the group. */
  preferred?: (key: string) => boolean;
  /** Called whenever the tab stop moves, with the item that now holds it. */
  onActiveKeyChange?: (key: string | null) => void;
};

/** What one item of a roving group spreads onto its element. */
export type RovingItemProps = {
  /** Registers the item's element with the group. */
  ref: (element: HTMLElement | null) => void | (() => void);
  /** `0` for the single item with the group's tab stop, `-1` for the rest. */
  tabIndex: 0 | -1;
  /** Moves the group for an arrow, Home or End press, wrapping where the group asks it to. */
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  /** Keeps the tab stop on the item the user last focused. */
  onFocus: () => void;
};

/** What a roving group gives back to its caller. */
export type RovingFocusApi = {
  /** The item holding the group's tab stop, or `null` before the group decides. */
  activeKey: string | null;
  /** The props for one item, by the key the caller gives it. */
  getItemProps: (key: string) => RovingItemProps;
  /** Moves focus to an item, including one that has not rendered yet. */
  focusItem: (key: string) => void;
};

/** The registered elements of a group's items, and the ref callback that registered each one. */
type RovingRegistration = {
  elements: Map<string, HTMLElement>;
  refs: Map<string, (element: HTMLElement | null) => void | (() => void)>;
};

/** The group the SDK built, and the cleanups it asked this hook to run on unmount. */
type RovingGroup = {
  readonly teardowns: Set<() => void>;
  readonly roving: RovingFocus;
};

function rovingConfigOf(options: RovingFocusOptions): RovingConfig {
  return {
    orientation: options.orientation ?? "vertical",
    loop: options.loop ?? false,
    disabled: options.disabled,
    preferred: options.preferred,
    onActiveKeyChange: options.onActiveKeyChange,
  };
}

/**
 * Gives a list one tab stop and moves focus between its items with the arrow
 * keys, Home and End; it never traps focus, so Tab leaves the group.
 */
export function useRovingFocus(options: RovingFocusOptions = {}): RovingFocusApi {
  // The SDK reads these options on each key press rather than while rendering,
  // so the group's store carries them and the group itself is built once.
  const [store] = useState<RovingStore>(() => createRovingStore(rovingConfigOf(options)));
  useEffect(() => {
    store.setOptions(rovingConfigOf(options));
  }, [store, options]);

  const [group] = useState<RovingGroup>(() => {
    const teardowns = new Set<() => void>();
    return {
      teardowns,
      roving: createRovingFocus<RovingState, RovingPart>(
        {
          store,
          onDestroy: (cleanup) => {
            teardowns.add(cleanup);
          },
        },
        {
          slot: "item",
          key: "stop",
          orientation: () => store.get().options.orientation,
          loop: () => store.get().options.loop,
          disabled: (item) => store.get().options.disabled?.(item.key) ?? false,
          preferred: (item) => store.get().options.preferred?.(item.key) ?? false,
        },
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

  const [registration] = useState<RovingRegistration>(() => ({
    elements: new Map<string, HTMLElement>(),
    refs: new Map<string, (element: HTMLElement | null) => void | (() => void)>(),
  }));

  const refFor = useCallback(
    (key: string) => {
      const cached = registration.refs.get(key);
      if (cached !== undefined) {
        return cached;
      }

      const ref = (element: HTMLElement | null): void | (() => void) => {
        if (element === null) {
          return;
        }
        registration.elements.set(key, element);
        const unbind = roving.bind(element, { key, props: { key } });
        return () => {
          if (registration.elements.get(key) === element) {
            registration.elements.delete(key);
          }
          unbind();
        };
      };

      registration.refs.set(key, ref);
      return ref;
    },
    [registration, roving],
  );

  // Runs after every render so a change to `disabled` or `preferred` re-decides
  // the stop; the store ignores a stop that has not moved, so this settles.
  useEffect(() => {
    roving.check();
  });

  const getItemProps = useCallback(
    (key: string): RovingItemProps => {
      // The stop comes from React state so the item re-renders with it; the
      // store's options only feed the SDK's own `claims` rule.
      const state: RovingState = { stop: activeKey, options: store.get().options };

      return {
        ref: refFor(key),
        tabIndex: roving.tabIndex(state, { key, props: { key } }) === "0" ? 0 : -1,
        onKeyDown: (event) => {
          if (event.defaultPrevented) {
            return;
          }
          const element = registration.elements.get(key);
          if (element !== undefined) {
            roving.keydown(event.nativeEvent, element);
          }
        },
        onFocus: () => {
          roving.remember(key);
        },
      };
    },
    [activeKey, refFor, registration, roving, store],
  );

  const focusItem = useCallback(
    (key: string) => {
      roving.focus(key);
    },
    [roving],
  );

  // The SDK's own subscription belongs to this group; dropping it on unmount is
  // the whole teardown, and `check` above keeps the stop decided either way.
  useEffect(() => {
    const teardowns = group.teardowns;
    return () => {
      for (const cleanup of Array.from(teardowns)) {
        cleanup();
      }
      teardowns.clear();
    };
  }, [group]);

  return { activeKey, getItemProps, focusItem };
}

/** The options typeahead takes. */
export type TypeaheadOptions = {
  /** The labels of the selectable items, in the order they are offered to the user. */
  labels: () => readonly string[];
  /** The index of the item that holds selection now; the search continues after it. */
  currentIndex?: () => number;
  /** Receives the index of the item the typed characters select. */
  onMatch: (index: number) => void;
  /** How long a partly typed query survives, in milliseconds. Defaults to 500. */
  idleMs?: number;
  /** Turns the behaviour off, for instance while the list is empty. */
  enabled?: boolean;
};

/** What typeahead gives back to its caller. */
export type TypeaheadApi = {
  /** Handles one key press; returns true when it was a typeahead character and the selection moved. */
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => boolean;
  /** Drops the typed query, so the next character starts a new one. */
  reset: () => void;
  /** Whether a query is being accumulated, so Space continues it rather than activating an item. */
  isActive: () => boolean;
};

/**
 * Accumulates printable characters into a query that moves selection, cycling
 * through the items that share the prefix and clearing after a short idle.
 */
export function useTypeahead(options: TypeaheadOptions): TypeaheadApi {
  const { labels, onMatch, currentIndex, idleMs = TYPEAHEAD_IDLE_MS, enabled = true } = options;
  const search = useMemo(() => createTypeahead(idleMs), [idleMs]);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>): boolean => {
      // A text entry keeps every printable character: it filters, it does not jump.
      if (!enabled || event.defaultPrevented || isTextEntry(event.target)) {
        return false;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || isComposing(event)) {
        return false;
      }
      if (!isTypeaheadKey(event.nativeEvent)) {
        return false;
      }

      const items = labels();
      if (items.length === 0) {
        return false;
      }

      const offered = Array.from(items);
      const from = currentIndex?.() ?? 0;
      let index = search(event.key, offered, from);
      if (index < 0) {
        // A buffer that stops matching must not swallow the next characters:
        // drop it and let this one start a fresh query, as typeahead expects.
        search.reset();
        index = search(event.key, offered, from);
      }
      if (index < 0) {
        return false;
      }

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

/** The options modal focus containment takes. */
export type ModalFocusContainmentOptions = {
  /** Whether the dialog is shown. */
  open: boolean;
  /** The dialog element; focus stays inside it while it is open. */
  dialogRef: RefObject<HTMLElement | null>;
  /** The control that opened the dialog; focus returns here when it closes. */
  triggerRef?: RefObject<HTMLElement | null>;
  /** The control that takes focus first; the first tabbable child of the dialog by default. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Called for Escape and for a press outside the dialog. */
  onDismiss: (reason: DismissReason) => void;
};

/** What modal focus containment gives back to its caller. */
export type ModalFocusContainmentApi = {
  /** Returns focus to the invoking control, for a close that happened without a dismiss reason. */
  restoreFocus: () => void;
};

/**
 * Keeps focus inside an open dialog — initial focus within it, Tab and
 * Shift+Tab wrapping — dismisses on Escape and returns focus to the invoking
 * control when it closes.
 *
 * This hook owns focus and dismissal; a press outside is blocked by the SDK's
 * modal layer, and the dialog's own markup keeps its `role`, name and
 * `aria-modal`, which no behaviour hook can supply on the caller's behalf.
 */
export function useModalFocusContainment(
  options: ModalFocusContainmentOptions,
): ModalFocusContainmentApi {
  const { open, dialogRef, triggerRef, initialFocusRef, onDismiss } = options;

  const latest = useRef({ onDismiss, triggerRef, initialFocusRef });
  useEffect(() => {
    latest.current = { onDismiss, triggerRef, initialFocusRef };
  }, [onDismiss, triggerRef, initialFocusRef]);

  // Where focus came from, captured as the dialog opens: the trigger when the
  // caller names one, else whatever held focus before the dialog took it.
  const invoking = useRef<HTMLElement | null>(null);

  const restoreFocus = useCallback(() => {
    const target = invoking.current;
    invoking.current = null;
    keepFocus(() => target ?? undefined);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || dialog === null) {
      return;
    }

    const from = latest.current.triggerRef?.current;
    invoking.current =
      from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);

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

    // The SDK's dialog preset is the only place it contains focus, and it needs
    // a whole popup primitive; on its own `bindLayer` dismisses and blocks
    // outside presses but leaves the Tab cycle alone. This is that cycle.
    const containTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab") {
        return;
      }

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

    const releaseLayer = bindLayer(dialog, {
      modal: true,
      onDismiss: (reason) => {
        latest.current.onDismiss(toDismissReason(reason));
      },
    });
    document.addEventListener("keydown", containTab, true);

    // Both go in one cleanup, so the page is fully reachable again the moment the
    // dialog closes and a keyboard user is never left without a way out.
    return () => {
      document.removeEventListener("keydown", containTab, true);
      releaseLayer();
    };
  }, [open, dialogRef]);

  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) {
      restoreFocus();
    }
    wasOpen.current = open;
  }, [open, restoreFocus]);

  return { restoreFocus };
}
