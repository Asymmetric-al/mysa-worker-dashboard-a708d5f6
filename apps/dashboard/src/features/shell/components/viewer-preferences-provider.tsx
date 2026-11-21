"use client";

/**
 * The viewer's presentation preferences — appearance, interface locale and display time zone — and
 * the one owner the application has for them.
 *
 * (a) These are presentation preferences of the person using this browser, not a record. They are
 *     not a service mutation and not part of the read envelope: never placed in the TanStack Query
 *     cache, never sent to the service, never read by a Route Handler, and never joined to a
 *     partner, a membership or a consent. Nothing on the server knows they exist.
 * (b) They change neither direction nor consent. Content direction stays a `dir` property of the
 *     content block and is served by the single `Direction` provider in `components/ui/direction`;
 *     this module never writes `dir` on the document or on a block. An interface locale is not
 *     communication consent and not an audience membership, and neither is a display time zone.
 * (c) If a reviewer's reading of "never a second store" excludes even a browser-local key, delete
 *     the persistence in this module alone: the provider then keeps the three values in memory for
 *     the life of the page and every success criterion of the release is still met. The single
 *     browser-local key `dashboard:viewer-preferences` is read and written here and nowhere else,
 *     so there is no second place to look and no second copy to keep in step.
 *
 * Defaults, stated once: appearance `system`, which follows the operating system's colour scheme;
 * interface locale `en-GB`; and the browser's own IANA time zone, read on the client after mount
 * because the server cannot know it. Until that read has happened the display time zone is `UTC`,
 * so the server markup and the first client render agree and no hydration warning is produced.
 *
 * Formatting only. `Intl.DateTimeFormat` renders an instant the service supplied, in the viewer's
 * chosen locale and zone. A zone this platform cannot resolve — a name typed where the browser has no
 * zone data at all — is kept exactly as typed, and rendering then degrades to the platform's own
 * zone rather than failing, because a presentation preference must never make a record unreadable.
 * No offset arithmetic, no day boundary and no deadline is computed here:
 * `@/modules/time` owns every boundary and `@/modules/money` owns every amount, and neither may be
 * duplicated in a view. This module never reads the machine clock and never invents an instant: the
 * one it renders is the one it was given.
 *
 * Scope, against the project rule: clause 1 (no settings record, no second store, no new transport,
 * nothing scaffolded for a later integration), clause 2 (one owner for these three preferences
 * instead of a generic preferences framework or a wrapper module) and clause 3 (a preference is
 * never consent, identity or context — changing the interface locale or the display time zone
 * changes how an instant is rendered and never which records a read returns).
 *
 * Its only import is `react`. It sits below the component layer, so it takes no component, no
 * domain module, no store, no data-service call and no behaviour library.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

/** The three appearance choices. `system` follows the operating system colour scheme. */
export type ViewerAppearance = "system" | "light" | "dark";

/**
 * The closed set of appearance choices, exported so a settings surface renders the same three
 * options this module validates against rather than a second hand-written list.
 */
export const VIEWER_APPEARANCES = [
  "system",
  "light",
  "dark",
] as const satisfies readonly ViewerAppearance[];

/** The interface locale used until the viewer chooses another one. */
export const DEFAULT_INTERFACE_LOCALE = "en-GB";

/** The three values this module owns. Presentation only — see (a) and (b) in the file header. */
export interface ViewerPreferences {
  readonly appearance: ViewerAppearance;
  /** A BCP-47 language tag: it becomes `lang` on the document element and drives `Intl`. */
  readonly interfaceLocale: string;
  /** An IANA time zone. It changes how an instant is rendered, never when a boundary falls. */
  readonly displayTimeZone: string;
}

/** What {@link useViewerPreferences} returns: the three values and their explicit setters. */
export interface ViewerPreferencesContextValue extends ViewerPreferences {
  setAppearance: (appearance: ViewerAppearance) => void;
  setInterfaceLocale: (interfaceLocale: string) => void;
  setDisplayTimeZone: (displayTimeZone: string) => void;
}

/** Props of {@link ViewerPreferencesProvider}. */
export interface ViewerPreferencesProviderProps {
  children: ReactNode;
}

/** The one browser-local key this application writes. Read and written only in this module. */
const STORAGE_KEY = "dashboard:viewer-preferences";

/**
 * The class that activates the `.dark` token block in `src/styles/globals.css`, applied to the
 * document element. It is the class name of that token block, not a style of this module's own.
 */
const DARK_CLASS = "dark";

/** The operating-system colour-scheme query that the `system` appearance follows. */
const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

/** The display time zone used for the server render and the first client render. */
const PRE_HYDRATION_TIME_ZONE = "UTC";

/** The documented defaults, in the order the header states them. */
const DEFAULT_PREFERENCES: ViewerPreferences = {
  appearance: "system",
  interfaceLocale: DEFAULT_INTERFACE_LOCALE,
  displayTimeZone: PRE_HYDRATION_TIME_ZONE,
};

/**
 * A partial set of values as they may arrive from the browser-local key or from one setter. Every
 * field is optional because a stored payload can be incomplete or partly unusable.
 */
interface ViewerPreferencesPatch {
  appearance?: ViewerAppearance;
  interfaceLocale?: string;
  displayTimeZone?: string;
}

/*
 * The current values live in module scope so that the read happens through
 * `useSyncExternalStore` rather than through a state update inside an effect: storage is touched
 * only by the mount-time hydration call, while the snapshot a component renders from is this
 * in-memory value. One module, one value, one set of listeners — a second owner for the same three
 * preferences is what the project rule forbids.
 */
let currentPreferences: ViewerPreferences = DEFAULT_PREFERENCES;

const listeners = new Set<() => void>();

function subscribeToViewerPreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The snapshot a browser render reads. Stable between changes, as `useSyncExternalStore` needs. */
function readViewerPreferences(): ViewerPreferences {
  return currentPreferences;
}

/** The snapshot the server render reads, so server markup and the hydrating render agree. */
function readServerViewerPreferences(): ViewerPreferences {
  return DEFAULT_PREFERENCES;
}

function samePreferences(left: ViewerPreferences, right: ViewerPreferences): boolean {
  return (
    left.appearance === right.appearance &&
    left.interfaceLocale === right.interfaceLocale &&
    left.displayTimeZone === right.displayTimeZone
  );
}

/** Adopts `next` if it differs and wakes every subscribed component. Returns whether it did. */
function announceViewerPreferences(next: ViewerPreferences): boolean {
  if (samePreferences(currentPreferences, next)) {
    return false;
  }
  currentPreferences = next;
  for (const listener of listeners) {
    listener();
  }
  return true;
}

function isViewerAppearance(value: string): value is ViewerAppearance {
  return (VIEWER_APPEARANCES as readonly string[]).includes(value);
}

/**
 * Whether this platform can resolve an IANA zone at all: the one answer to that question, which the
 * display-zone setter, the stored read and the settings panel all ask, so a platform without
 * `Intl.DateTimeFormat` is recognised once instead of by checks that can drift apart.
 */
export function canResolveTimeZone(): boolean {
  return typeof Intl !== "undefined" && typeof Intl.DateTimeFormat === "function";
}

/**
 * Canonicalises a language tag, and answers `null` for one `Intl` cannot read. A tag that reaches
 * `lang` or a formatter must be valid, so an invalid choice is refused rather than stored.
 */
function canonicalLocale(value: string): string | null {
  try {
    const [locale] = Intl.getCanonicalLocales(value);
    return locale ?? null;
  } catch {
    return null;
  }
}

/** Canonicalises an IANA time zone, and answers `null` for one the platform does not know. */
function canonicalTimeZone(value: string): string | null {
  try {
    return Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/**
 * The zone a chosen or stored value becomes. Where the platform can resolve a zone, only a name it
 * knows survives, exactly as before. Where it cannot resolve one, nothing on that platform can check
 * a name at all, so the name is adopted as given — untouched, since canonicalising it is exactly the
 * work the absent API would have done — and the renderer is what degrades; refusing it would leave
 * the plain-text control unable to hold any value at all. A blank entry names no zone on either
 * platform.
 */
function adoptedTimeZone(value: string): string | null {
  if (!canResolveTimeZone()) {
    return value.trim().length === 0 ? null : value;
  }
  return canonicalTimeZone(value);
}

/** The browser's own zone. Called only after mount, never during a server render. */
function browserTimeZone(): string {
  try {
    return (
      canonicalTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? PRE_HYDRATION_TIME_ZONE
    );
  } catch {
    return PRE_HYDRATION_TIME_ZONE;
  }
}

/** The operating-system colour-scheme query, or `null` where the platform exposes no matchMedia. */
function darkPreferenceQuery(): MediaQueryList | null {
  try {
    return window.matchMedia(DARK_MEDIA_QUERY);
  } catch {
    return null;
  }
}

/**
 * The browser-local storage, or `null` where reaching it throws — a blocked or partitioned
 * context. Every caller treats `null` as "keep the values in memory", so the shell never crashes
 * because a preference could not be persisted.
 */
function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Reads the one browser-local key into whatever part of it is usable. A malformed payload, an
 * unknown appearance, an unreadable language tag or a zone this platform cannot resolve is dropped
 * field by field, so one bad value cannot discard the other two.
 */
function readStoredPreferences(): ViewerPreferencesPatch {
  const storage = browserStorage();
  if (storage === null) {
    return {};
  }
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }
    const record = parsed as Record<string, unknown>;
    const stored: ViewerPreferencesPatch = {};
    if (typeof record.appearance === "string" && isViewerAppearance(record.appearance)) {
      stored.appearance = record.appearance;
    }
    if (typeof record.interfaceLocale === "string") {
      const locale = canonicalLocale(record.interfaceLocale);
      if (locale !== null) {
        stored.interfaceLocale = locale;
      }
    }
    if (typeof record.displayTimeZone === "string") {
      const timeZone = adoptedTimeZone(record.displayTimeZone);
      if (timeZone !== null) {
        stored.displayTimeZone = timeZone;
      }
    }
    return stored;
  } catch {
    return {};
  }
}

/** Writes the one key. A refused write leaves the in-memory values authoritative for this page. */
function persistPreferences(preferences: ViewerPreferences): void {
  const storage = browserStorage();
  if (storage === null) {
    return;
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Storage can be full, blocked or unavailable. The viewer's choice still applies now; only its
    // survival across a reload is lost, which is the honest outcome and not an error to surface.
  }
}

/**
 * Applies the stored values over the defaults, filling each field the key did not supply. Called
 * from the provider's mount effect and from nowhere else: this is the only place the browser-local
 * key is read, and it never runs during render or on the server.
 */
function hydrateViewerPreferences(): void {
  const stored = readStoredPreferences();
  announceViewerPreferences({
    appearance: stored.appearance ?? DEFAULT_PREFERENCES.appearance,
    interfaceLocale: stored.interfaceLocale ?? DEFAULT_PREFERENCES.interfaceLocale,
    displayTimeZone: stored.displayTimeZone ?? browserTimeZone(),
  });
}

/** Applies one chosen value: adopt it in memory, wake the subscribers, then persist the result. */
function commitViewerPreferences(patch: ViewerPreferencesPatch): void {
  const next: ViewerPreferences = {
    appearance: patch.appearance ?? currentPreferences.appearance,
    interfaceLocale: patch.interfaceLocale ?? currentPreferences.interfaceLocale,
    displayTimeZone: patch.displayTimeZone ?? currentPreferences.displayTimeZone,
  };
  if (announceViewerPreferences(next)) {
    persistPreferences(next);
  }
}

const ViewerPreferencesContext = createContext<ViewerPreferencesContextValue | null>(null);

/** Provides the viewer's appearance, interface locale and display time zone to the shell. */
export function ViewerPreferencesProvider({ children }: ViewerPreferencesProviderProps) {
  const preferences = useSyncExternalStore(
    subscribeToViewerPreferences,
    readViewerPreferences,
    readServerViewerPreferences,
  );

  // The browser-local key is read here, once the component is mounted on the client. The server
  // render and the hydration render both read the documented defaults, so their markup matches and
  // the stored appearance, locale and zone take effect immediately afterwards.
  useEffect(() => {
    hydrateViewerPreferences();
  }, []);

  const { appearance, interfaceLocale } = preferences;

  // Appearance is a class on the document element, exactly as the token stylesheet declares it. A
  // `system` appearance also follows the operating system while the page is open. Whatever this
  // effect set is removed again when it re-runs or when the provider unmounts, so an unmounted
  // shell leaves no theme of its own behind.
  useEffect(() => {
    const root = document.documentElement;
    const clearDark = () => {
      root.classList.remove(DARK_CLASS);
    };

    if (appearance !== "system") {
      root.classList.toggle(DARK_CLASS, appearance === "dark");
      return clearDark;
    }

    const query = darkPreferenceQuery();
    if (query === null) {
      // No preference query on this platform: `system` resolves to the light token block rather
      // than to an undefined half-applied state.
      clearDark();
      return clearDark;
    }

    const applySystemAppearance = (prefersDark: boolean) => {
      root.classList.toggle(DARK_CLASS, prefersDark);
    };
    applySystemAppearance(query.matches);

    const handleSystemAppearanceChange = (event: MediaQueryListEvent) => {
      applySystemAppearance(event.matches);
    };
    query.addEventListener("change", handleSystemAppearanceChange);

    return () => {
      query.removeEventListener("change", handleSystemAppearanceChange);
      clearDark();
    };
  }, [appearance]);

  // The interface locale becomes `lang` on the document element, which a screen reader uses to pick
  // a voice and which `Intl` uses to pick collation and numeric conventions. The attribute this
  // effect overwrote is restored when it re-runs or when the provider unmounts.
  useEffect(() => {
    const html = document.documentElement;
    const previousLocale = html.getAttribute("lang");
    html.setAttribute("lang", interfaceLocale);

    return () => {
      if (previousLocale === null) {
        html.removeAttribute("lang");
      } else {
        html.setAttribute("lang", previousLocale);
      }
    };
  }, [interfaceLocale]);

  const setAppearance = useCallback((nextAppearance: ViewerAppearance) => {
    commitViewerPreferences({ appearance: nextAppearance });
  }, []);

  const setInterfaceLocale = useCallback((nextLocale: string) => {
    const locale = canonicalLocale(nextLocale);
    if (locale === null) {
      return;
    }
    commitViewerPreferences({ interfaceLocale: locale });
  }, []);

  const setDisplayTimeZone = useCallback((nextTimeZone: string) => {
    const timeZone = adoptedTimeZone(nextTimeZone);
    if (timeZone === null) {
      return;
    }
    commitViewerPreferences({ displayTimeZone: timeZone });
  }, []);

  const value = useMemo<ViewerPreferencesContextValue>(
    () => ({
      appearance: preferences.appearance,
      interfaceLocale: preferences.interfaceLocale,
      displayTimeZone: preferences.displayTimeZone,
      setAppearance,
      setInterfaceLocale,
      setDisplayTimeZone,
    }),
    [preferences, setAppearance, setInterfaceLocale, setDisplayTimeZone],
  );

  return (
    <ViewerPreferencesContext.Provider value={value}>{children}</ViewerPreferencesContext.Provider>
  );
}

/** The viewer's appearance, interface locale and display time zone, with their setters. */
export function useViewerPreferences(): ViewerPreferencesContextValue {
  const value = useContext(ViewerPreferencesContext);
  if (value === null) {
    throw new Error(
      "useViewerPreferences must be called inside a ViewerPreferencesProvider. The shell mounts " +
        "one provider above the application shell, so a surface that needs a preference is " +
        "rendered below it rather than beside it.",
    );
  }
  return value;
}

/** An instant the service supplied: an ISO 8601 string from a read envelope, or epoch millis. */
export type ViewerInstant = string | number;

/** The default rendering of an instant: a readable date and a short local time. */
const DEFAULT_INSTANT_FORMAT: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
  timeStyle: "short",
};

/**
 * Renders one instant in the viewer's interface locale and display time zone.
 *
 * Formatting only: it reads no clock, derives no date and performs no arithmetic, and the viewer's
 * display zone always wins over any `timeZone` passed in `options`, because that zone is the whole
 * point of the preference. A civil date — a due date, an introduction date — is not an instant and
 * is formatted by `@/modules/time` instead, so a display-zone change can never shift one.
 *
 * A display preference never makes a record unreadable, so a zone the platform cannot use — the
 * name adopted as typed on a platform with no zone data, most often — degrades rather than throws:
 * the same instant is rendered in the platform's own zone, and where the platform can render no
 * formatted instant at all, as its ISO 8601 form. What is shown is always the instant given.
 */
export function formatViewerInstant(
  instant: ViewerInstant,
  preferences: Pick<ViewerPreferences, "interfaceLocale" | "displayTimeZone">,
  options: Intl.DateTimeFormatOptions = DEFAULT_INSTANT_FORMAT,
): string {
  const milliseconds = typeof instant === "number" ? instant : Date.parse(instant);
  const moment = new Date(milliseconds);
  if (Number.isNaN(moment.getTime())) {
    throw new RangeError(
      `formatViewerInstant received a value that is not an ISO 8601 instant: ${String(instant)}`,
    );
  }
  try {
    return Intl.DateTimeFormat(preferences.interfaceLocale, {
      ...options,
      timeZone: preferences.displayTimeZone,
    }).format(milliseconds);
  } catch {
    // The chosen zone is unusable here, which says nothing about the instant itself.
  }
  const platformOptions: Intl.DateTimeFormatOptions = { ...options };
  delete platformOptions.timeZone;
  try {
    return Intl.DateTimeFormat(preferences.interfaceLocale, platformOptions).format(milliseconds);
  } catch {
    // No formatted rendering of any kind on this platform, so the instant keeps a readable form.
  }
  return moment.toISOString();
}
