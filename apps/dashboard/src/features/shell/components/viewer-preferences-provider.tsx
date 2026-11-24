"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { DEFAULT_INTERFACE_LOCALE } from "@/lib/count-format";
export type ViewerAppearance = "system" | "light" | "dark";
/** The closed set of appearance choices, exported so a settings surface renders the same three options this module validates against rather than a second hand-written list. */ export const VIEWER_APPEARANCES = ["system", "light", "dark"] as const satisfies readonly ViewerAppearance[];
/** The closed set of release modes a new submission asks for, exported so the settings control renders the same two options this module validates against rather than a second hand-written list. */ export const PUBLISHING_PREFERENCES = ["publish-only", "publish-and-notify"] as const;
export type PublishingPreference = (typeof PUBLISHING_PREFERENCES)[number];
export type ViewerPreferences = { readonly appearance: ViewerAppearance; readonly interfaceLocale: string; readonly displayTimeZone: string; readonly publishing: PublishingPreference };
export type ViewerPreferencesContextValue = ViewerPreferences & { setAppearance: (appearance: ViewerAppearance) => void; setInterfaceLocale: (interfaceLocale: string) => void; setDisplayTimeZone: (displayTimeZone: string) => void; setPublishingPreference: (next: PublishingPreference) => void };
export type ViewerPreferencesProviderProps = { children: ReactNode };
const STORAGE_KEY = "dashboard:viewer-preferences";
const DARK_CLASS = "dark";
const PRE_HYDRATION_TIME_ZONE = "UTC";
const DEFAULT_PREFERENCES: ViewerPreferences = { appearance: "system", interfaceLocale: DEFAULT_INTERFACE_LOCALE, displayTimeZone: PRE_HYDRATION_TIME_ZONE, publishing: "publish-only" };
type ViewerPreferencesPatch = { appearance?: ViewerAppearance; interfaceLocale?: string; displayTimeZone?: string; publishing?: PublishingPreference };
let currentPreferences: ViewerPreferences = DEFAULT_PREFERENCES;
const listeners = new Set<() => void>();
function subscribeToViewerPreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
const readViewerPreferences = (): ViewerPreferences => currentPreferences;
const readServerViewerPreferences = (): ViewerPreferences => DEFAULT_PREFERENCES;
function announceViewerPreferences(next: ViewerPreferences): boolean {
  if (next.appearance === currentPreferences.appearance && next.interfaceLocale === currentPreferences.interfaceLocale && next.displayTimeZone === currentPreferences.displayTimeZone && next.publishing === currentPreferences.publishing) return false;
  currentPreferences = next;
  for (const listener of listeners) listener();
  return true;
}
const isViewerAppearance = (value: string): value is ViewerAppearance => (VIEWER_APPEARANCES as readonly string[]).includes(value);
const isPublishingPreference = (value: string): value is PublishingPreference => (PUBLISHING_PREFERENCES as readonly string[]).includes(value);
/** Whether this platform can resolve an IANA zone at all: the one answer the display-zone setter, the stored read and the settings panel all ask, so a platform without one offers no zone list. */ export const canResolveTimeZone = (): boolean => typeof Intl !== "undefined" && typeof Intl.DateTimeFormat === "function";
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
const adoptedTimeZone = (value: string): string | null => (!canResolveTimeZone() ? (value.trim().length === 0 ? null : value) : canonicalTimeZone(value));
function browserTimeZone(): string {
  try {
    return canonicalTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? PRE_HYDRATION_TIME_ZONE;
  } catch {
    return PRE_HYDRATION_TIME_ZONE;
  }
}
function darkPreferenceQuery(): MediaQueryList | null {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)");
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
  if (storage === null) return {};
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const record = parsed as Record<string, unknown>;
    const stored: ViewerPreferencesPatch = {};
    if (typeof record.appearance === "string" && isViewerAppearance(record.appearance)) stored.appearance = record.appearance;
    if (typeof record.interfaceLocale === "string") {
      const locale = canonicalLocale(record.interfaceLocale);
      if (locale !== null) stored.interfaceLocale = locale;
    }
    if (typeof record.displayTimeZone === "string") {
      const timeZone = adoptedTimeZone(record.displayTimeZone);
      if (timeZone !== null) stored.displayTimeZone = timeZone;
    }
    if (typeof record.publishing === "string" && isPublishingPreference(record.publishing)) stored.publishing = record.publishing;
    return stored;
  } catch {
    return {};
  }
}
function persistPreferences(preferences: ViewerPreferences): void {
  const storage = browserStorage();
  if (storage === null) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {}
}
function hydrateViewerPreferences(): void {
  const stored = readStoredPreferences();
  announceViewerPreferences({ appearance: stored.appearance ?? DEFAULT_PREFERENCES.appearance, interfaceLocale: stored.interfaceLocale ?? DEFAULT_PREFERENCES.interfaceLocale, displayTimeZone: stored.displayTimeZone ?? browserTimeZone(), publishing: stored.publishing ?? DEFAULT_PREFERENCES.publishing });
}
function commitViewerPreferences(patch: ViewerPreferencesPatch): void {
  const next: ViewerPreferences = { appearance: patch.appearance ?? currentPreferences.appearance, interfaceLocale: patch.interfaceLocale ?? currentPreferences.interfaceLocale, displayTimeZone: patch.displayTimeZone ?? currentPreferences.displayTimeZone, publishing: patch.publishing ?? currentPreferences.publishing };
  if (announceViewerPreferences(next)) persistPreferences(next);
}
const ViewerPreferencesContext = createContext<ViewerPreferencesContextValue | null>(null);
/** Provides the viewer's four preferences to the shell: appearance, interface locale, display time zone and publishing, the last deciding only the release mode a new submission asks for. */ export function ViewerPreferencesProvider({ children }: ViewerPreferencesProviderProps) {
  const preferences = useSyncExternalStore(subscribeToViewerPreferences, readViewerPreferences, readServerViewerPreferences);
  useEffect(() => hydrateViewerPreferences(), []);
  const { appearance, interfaceLocale } = preferences;
  useEffect(() => {
    const root = document.documentElement;
    const clearDark = (): void => void root.classList.remove(DARK_CLASS);
    if (appearance !== "system") {
      root.classList.toggle(DARK_CLASS, appearance === "dark");
      return clearDark;
    }
    const query = darkPreferenceQuery();
    if (query === null) {
      clearDark();
      return clearDark;
    }
    const applySystemAppearance = (prefersDark: boolean): void => void root.classList.toggle(DARK_CLASS, prefersDark);
    applySystemAppearance(query.matches);
    const handleSystemAppearanceChange = (event: MediaQueryListEvent): void => applySystemAppearance(event.matches);
    query.addEventListener("change", handleSystemAppearanceChange);
    return () => {
      query.removeEventListener("change", handleSystemAppearanceChange);
      clearDark();
    };
  }, [appearance]);
  useEffect(() => {
    const html = document.documentElement;
    const previousLocale = html.getAttribute("lang");
    html.setAttribute("lang", interfaceLocale);
    return () => {
      if (previousLocale === null) {
        html.removeAttribute("lang");
      } else html.setAttribute("lang", previousLocale);
    };
  }, [interfaceLocale]);
  const setAppearance = useCallback((nextAppearance: ViewerAppearance) => commitViewerPreferences({ appearance: nextAppearance }), []);
  const setInterfaceLocale = useCallback((nextLocale: string) => {
    const locale = canonicalLocale(nextLocale);
    if (locale === null) return;
    commitViewerPreferences({ interfaceLocale: locale });
  }, []);
  const setDisplayTimeZone = useCallback((nextTimeZone: string) => {
    const timeZone = adoptedTimeZone(nextTimeZone);
    if (timeZone === null) return;
    commitViewerPreferences({ displayTimeZone: timeZone });
  }, []);
  const setPublishingPreference = useCallback((next: PublishingPreference) => commitViewerPreferences({ publishing: next }), []); // A value from outside the closed pair this module declares is a compile error here rather than a preference a submission would refuse.
  const value = useMemo<ViewerPreferencesContextValue>(
    () => ({ appearance: preferences.appearance, interfaceLocale: preferences.interfaceLocale, displayTimeZone: preferences.displayTimeZone, publishing: preferences.publishing, setAppearance, setInterfaceLocale, setDisplayTimeZone, setPublishingPreference }),
    [preferences, setAppearance, setInterfaceLocale, setDisplayTimeZone, setPublishingPreference],
  );
  return <ViewerPreferencesContext.Provider value={value}>{children}</ViewerPreferencesContext.Provider>;
}
export function useViewerPreferences(): ViewerPreferencesContextValue {
  const value = useContext(ViewerPreferencesContext);
  if (value === null) throw new Error("useViewerPreferences must be called inside a ViewerPreferencesProvider. The shell mounts " + "one provider above the application shell, so a surface that needs a preference is " + "rendered below it rather than beside it.");
  return value;
}
/** An instant the service supplied: an ISO 8601 string from a read envelope, or epoch millis. */ export type ViewerInstant = string | number;
const DEFAULT_INSTANT_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };
export function formatViewerInstant(instant: ViewerInstant, preferences: Pick<ViewerPreferences, "interfaceLocale" | "displayTimeZone">, options: Intl.DateTimeFormatOptions = DEFAULT_INSTANT_FORMAT): string {
  const milliseconds = typeof instant === "number" ? instant : Date.parse(instant);
  const moment = new Date(milliseconds);
  if (Number.isNaN(moment.getTime())) throw new RangeError(`formatViewerInstant received a value that is not an ISO 8601 instant: ${String(instant)}`);
  try {
    return Intl.DateTimeFormat(preferences.interfaceLocale, { ...options, timeZone: preferences.displayTimeZone }).format(milliseconds);
  } catch {}
  const platformOptions: Intl.DateTimeFormatOptions = { ...options };
  delete platformOptions.timeZone;
  try {
    return Intl.DateTimeFormat(preferences.interfaceLocale, platformOptions).format(milliseconds);
  } catch {}
  return moment.toISOString();
}
