"use client";
/**
 * The viewer's presentation preferences — appearance, interface locale and display time zone — and the
 * one owner the application has for them.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
/** The three appearance choices. */
export type ViewerAppearance = "system" | "light" | "dark";
/** The closed set of appearance choices, exported so a settings surface renders the same three options this module validates against rather than a second hand-written list. */
export const VIEWER_APPEARANCES = ["system", "light", "dark"] as const satisfies readonly ViewerAppearance[];
/** The interface locale used until the viewer chooses another one. */
export const DEFAULT_INTERFACE_LOCALE = "en-GB";
/** The three values this module owns. */
export interface ViewerPreferences {
  readonly appearance: ViewerAppearance;
  readonly interfaceLocale: string;
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
const STORAGE_KEY = "dashboard:viewer-preferences";

const DARK_CLASS = "dark";

const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

const PRE_HYDRATION_TIME_ZONE = "UTC";

const DEFAULT_PREFERENCES: ViewerPreferences = {
  appearance: "system",
  interfaceLocale: DEFAULT_INTERFACE_LOCALE,
  displayTimeZone: PRE_HYDRATION_TIME_ZONE,
};
interface ViewerPreferencesPatch {
  appearance?: ViewerAppearance;
  interfaceLocale?: string;
  displayTimeZone?: string;
}
let currentPreferences: ViewerPreferences = DEFAULT_PREFERENCES;

const listeners = new Set<() => void>();

function subscribeToViewerPreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function readViewerPreferences(): ViewerPreferences {
  return currentPreferences;
}
function readServerViewerPreferences(): ViewerPreferences {
  return DEFAULT_PREFERENCES;
}
function samePreferences(left: ViewerPreferences, right: ViewerPreferences): boolean {
  return left.appearance === right.appearance && left.interfaceLocale === right.interfaceLocale && left.displayTimeZone === right.displayTimeZone;
}
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
/** Whether this platform can resolve an IANA zone at all: the one answer to that question, which the display-zone setter, the stored read and the settings panel all ask, so a platform without. */
export function canResolveTimeZone(): boolean {
  return typeof Intl !== "undefined" && typeof Intl.DateTimeFormat === "function";
}
function canonicalLocale(value: string): string | null {
  try {
    const [locale] = Intl.getCanonicalLocales(value);
    return locale ?? null;
  } catch {
    return null;
  }
}
function canonicalTimeZone(value: string): string | null {
  try {
    return Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}
function adoptedTimeZone(value: string): string | null {
  if (!canResolveTimeZone()) {
    return value.trim().length === 0 ? null : value;
  }
  return canonicalTimeZone(value);
}
function browserTimeZone(): string {
  try {
    return canonicalTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? PRE_HYDRATION_TIME_ZONE;
  } catch {
    return PRE_HYDRATION_TIME_ZONE;
  }
}
function darkPreferenceQuery(): MediaQueryList | null {
  try {
    return window.matchMedia(DARK_MEDIA_QUERY);
  } catch {
    return null;
  }
}
function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
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
function hydrateViewerPreferences(): void {
  const stored = readStoredPreferences();
  announceViewerPreferences({
    appearance: stored.appearance ?? DEFAULT_PREFERENCES.appearance,
    interfaceLocale: stored.interfaceLocale ?? DEFAULT_PREFERENCES.interfaceLocale,
    displayTimeZone: stored.displayTimeZone ?? browserTimeZone(),
  });
}
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
  const preferences = useSyncExternalStore(subscribeToViewerPreferences, readViewerPreferences, readServerViewerPreferences);
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
  return <ViewerPreferencesContext.Provider value={value}>{children}</ViewerPreferencesContext.Provider>;
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

const DEFAULT_INSTANT_FORMAT: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
  timeStyle: "short",
};
/** Renders one instant in the viewer's interface locale and display time zone. */
export function formatViewerInstant(
  instant: ViewerInstant,
  preferences: Pick<ViewerPreferences, "interfaceLocale" | "displayTimeZone">,
  options: Intl.DateTimeFormatOptions = DEFAULT_INSTANT_FORMAT,
): string {
  const milliseconds = typeof instant === "number" ? instant : Date.parse(instant);
  const moment = new Date(milliseconds);
  if (Number.isNaN(moment.getTime())) {
    throw new RangeError(`formatViewerInstant received a value that is not an ISO 8601 instant: ${String(instant)}`);
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
