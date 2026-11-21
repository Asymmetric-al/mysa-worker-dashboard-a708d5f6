"use client";
import { useCallback, useId, useMemo, useState, useSyncExternalStore } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { VIEWER_APPEARANCES, canResolveTimeZone, useViewerPreferences, type ViewerAppearance } from "./viewer-preferences-provider";
const APPEARANCE_COPY: Record<ViewerAppearance, { readonly label: string; readonly description: string }> = {
  system: { label: "Match your device", description: "Follows your operating system's light or dark setting while this page is open." },
  light: { label: "Light", description: "Always shows this application's light colour scheme." },
  dark: { label: "Dark", description: "Always shows this application's dark colour scheme." },
};
const LANGUAGE_SHORTLIST: readonly string[] = ["en-GB", "en-US", "en-AU", "en-CA", "fr-FR", "de-DE", "es-ES", "pt-BR", "ar", "he", "ko-KR", "ja-JP"];
const TIME_ZONE_SHORTLIST: readonly string[] =
  "UTC Europe/London Europe/Berlin Europe/Paris Europe/Madrid Europe/Warsaw Africa/Lagos Africa/Nairobi America/New_York America/Chicago America/Denver America/Los_Angeles America/Sao_Paulo Asia/Dubai Asia/Kolkata Asia/Singapore Asia/Seoul Asia/Tokyo Australia/Sydney Pacific/Auckland".split(" ");
type IntlNames = { of: (code: string) => string | undefined };
type IntlNamesConstructor = new (locales: readonly string[], options: { readonly type: string }) => IntlNames;
const namesCache = new Map<string, IntlNames | null>();
function intlNames(type: "language" | "region" | "script"): IntlNames | null {
  const cached = namesCache.get(type);
  if (cached !== undefined) {
    return cached;
  }
  let names: IntlNames | null = null;
  try {
    const Constructor = (Intl as unknown as { DisplayNames?: IntlNamesConstructor }).DisplayNames;
    if (typeof Constructor === "function") {
      names = new Constructor(["en"], { type });
    }
  } catch {
    // A platform without `DisplayNames`: every label falls back to the tag itself below.
    names = null;
  }
  namesCache.set(type, names);
  return names;
}
function languageLabel(tag: string): string {
  let language: string;
  let script: string | undefined;
  let region: string | undefined;
  try {
    const locale = new Intl.Locale(tag);
    language = locale.language;
    script = locale.script;
    region = locale.region;
  } catch {
    return tag;
  }
  const languageName = intlNames("language")?.of(language);
  if (languageName === undefined || languageName.length === 0) {
    return tag;
  }
  const qualifiers: string[] = [];
  const scriptName = script === undefined ? undefined : intlNames("script")?.of(script);
  if (scriptName !== undefined && scriptName.length > 0) {
    qualifiers.push(scriptName);
  }
  const regionName = region === undefined ? undefined : intlNames("region")?.of(region);
  if (regionName !== undefined && regionName.length > 0) {
    qualifiers.push(regionName);
  }
  return qualifiers.length === 0 ? languageName : `${languageName} (${qualifiers.join(", ")})`;
}
function languageChoices(current: string): readonly string[] {
  const choices: string[] = [...LANGUAGE_SHORTLIST];
  if (!choices.includes(current)) {
    choices.unshift(current);
  }
  return choices;
}
type TimeZoneMode = "enumerated" | "documented" | "text";
type TimeZoneChoices = { readonly common: readonly string[]; readonly all: readonly string[] };
function enumerableTimeZones(): readonly string[] {
  try {
    const supportedValuesOf = (Intl as unknown as { supportedValuesOf?: (key: string) => unknown }).supportedValuesOf;
    if (typeof supportedValuesOf !== "function") {
      return [];
    }
    const zones = supportedValuesOf("timeZone");
    if (!Array.isArray(zones)) {
      return [];
    }
    return zones.filter((zone): zone is string => typeof zone === "string");
  } catch {
    return [];
  }
}
function timeZoneMode(platformReady: boolean): TimeZoneMode {
  if (!platformReady) {
    return "documented";
  }
  if (!canResolveTimeZone()) {
    return "text";
  }
  return enumerableTimeZones().length > 0 ? "enumerated" : "documented";
}
function timeZoneChoices(current: string, mode: TimeZoneMode): TimeZoneChoices {
  const common: string[] = [...TIME_ZONE_SHORTLIST];
  if (!common.includes(current)) {
    common.unshift(current);
  }
  if (mode !== "enumerated") {
    return { common, all: [] };
  }
  const listed = new Set(common);
  return { common, all: enumerableTimeZones().filter((zone) => !listed.has(zone)) };
}
const subscribeToPlatform = (): (() => void) => () => {};
const usePlatformReady = (): boolean =>
  useSyncExternalStore(
    subscribeToPlatform,
    () => true,
    () => false,
  );
function isAppearanceChoice(value: string): value is ViewerAppearance {
  return (VIEWER_APPEARANCES as readonly string[]).includes(value);
}
export function SettingsPreferencePanel() {
  const { appearance, interfaceLocale, displayTimeZone, setAppearance, setInterfaceLocale, setDisplayTimeZone } = useViewerPreferences();
  const platformReady = usePlatformReady();
  const [announcement, setAnnouncement] = useState("");
  const idPrefix = useId();
  const appearanceLegendId = `${idPrefix}-appearance-legend`;
  const appearanceHintId = `${idPrefix}-appearance-hint`;
  const languageId = `${idPrefix}-language`;
  const languageHintId = `${idPrefix}-language-hint`;
  const timeZoneId = `${idPrefix}-time-zone`;
  const timeZoneHintId = `${idPrefix}-time-zone-hint`;
  const languages = useMemo(() => languageChoices(interfaceLocale), [interfaceLocale]);
  const mode = useMemo(() => timeZoneMode(platformReady), [platformReady]);
  const zones = useMemo(() => timeZoneChoices(displayTimeZone, mode), [displayTimeZone, mode]);
  const chooseAppearance = useCallback(
    (next: string) => {
      if (next === appearance || !isAppearanceChoice(next)) {
        return;
      }
      setAppearance(next);
      setAnnouncement(`Appearance: ${next}`);
    },
    [appearance, setAppearance],
  );
  const chooseLanguage = useCallback(
    (next: string) => {
      if (next === interfaceLocale) {
        return;
      }
      setInterfaceLocale(next);
      setAnnouncement(`Interface language: ${languageLabel(next)}`);
    },
    [interfaceLocale, setInterfaceLocale],
  );
  const chooseTimeZone = useCallback(
    (next: string) => {
      if (next === displayTimeZone) {
        return;
      }
      setDisplayTimeZone(next);
      setAnnouncement(`Display time zone: ${next}`);
    },
    [displayTimeZone, setDisplayTimeZone],
  );
  const announceTypedTimeZone = useCallback(() => {
    setAnnouncement(`Display time zone: ${displayTimeZone}. This browser cannot check time-zone names, so the name is used exactly as typed.`);
  }, [displayTimeZone]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Appearance, language and time zone</h2>
        </CardTitle>
        <CardDescription>These are presentation preferences for this browser. They change only how dates, times and numbers are formatted on screen — not which records you can see, the ministry you are working in, or anything a partner receives.</CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-6">
        <fieldset className="min-w-0">
          <legend id={appearanceLegendId} className="mb-3 text-sm font-medium">
            Appearance
          </legend>
          <div className="flex flex-col gap-3">
            <p id={appearanceHintId} className="text-sm text-muted-foreground">
              Applies to this browser only and takes effect immediately. “Match your device” follows your operating system while this page is open.
            </p>
            <RadioGroup value={appearance} onValueChange={chooseAppearance} aria-labelledby={appearanceLegendId} aria-describedby={appearanceHintId}>
              {VIEWER_APPEARANCES.map((choice) => {
                const copy = APPEARANCE_COPY[choice];
                const choiceId = `${idPrefix}-appearance-${choice}-choice`;
                const descriptionId = `${idPrefix}-appearance-${choice}-description`;
                return (
                  <label key={choice} htmlFor={choiceId} className="flex min-h-6 items-start gap-3 py-1">
                    <RadioGroupItem id={choiceId} value={choice} aria-label={copy.label} aria-describedby={descriptionId} className="mt-0.5" />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-sm font-medium">{copy.label}</span>
                      <span id={descriptionId} className="text-sm text-muted-foreground">
                        {copy.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </RadioGroup>
          </div>
        </fieldset>
        <Separator />
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor={languageId}>Interface language</Label>
            <NativeSelect
              id={languageId}
              className="w-full"
              value={interfaceLocale}
              aria-describedby={languageHintId}
              onChange={(event) => {
                chooseLanguage(event.target.value);
              }}
            >
              {languages.map((tag) => (
                <NativeSelectOption key={tag} value={tag}>
                  {languageLabel(tag)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <p id={languageHintId} className="text-sm text-muted-foreground">
              Sets the language of the dates, times and numbers you see here. It does not translate the interface, and it is never the language of something sent to a partner.
            </p>
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor={timeZoneId}>Display time zone</Label>
            {mode === "text" ? (
              <Input
                id={timeZoneId}
                type="text"
                value={displayTimeZone}
                placeholder="Europe/Berlin"
                autoComplete="off"
                spellCheck={false}
                aria-describedby={timeZoneHintId}
                onChange={(event) => {
                  setDisplayTimeZone(event.currentTarget.value);
                }}
                onBlur={() => {
                  announceTypedTimeZone();
                }}
              />
            ) : (
              <NativeSelect
                id={timeZoneId}
                className="w-full"
                value={displayTimeZone}
                aria-describedby={timeZoneHintId}
                onChange={(event) => {
                  chooseTimeZone(event.target.value);
                }}
              >
                <NativeSelectOptGroup label="Common time zones">
                  {zones.common.map((zone) => (
                    <NativeSelectOption key={zone} value={zone}>
                      {zone}
                    </NativeSelectOption>
                  ))}
                </NativeSelectOptGroup>
                {zones.all.length > 0 ? (
                  <NativeSelectOptGroup label="All time zones">
                    {zones.all.map((zone) => (
                      <NativeSelectOption key={zone} value={zone}>
                        {zone}
                      </NativeSelectOption>
                    ))}
                  </NativeSelectOptGroup>
                ) : null}
              </NativeSelect>
            )}
            <p id={timeZoneHintId} className="text-sm text-muted-foreground">
              Changes how dates and times are shown to you. A date with no time of day — a due date, an introduction date — keeps the day the service recorded, and no deadline moves.
              {mode === "text" ? " This browser cannot list or check time-zone names, so the name you type is used exactly as typed, for example Europe/Berlin." : ""}
            </p>
          </div>
        </div>
        {/* One polite region for all three controls: every change is announced once, in words, so the
            applied value never depends on a checked mark or a colour alone. */}
        <output className="sr-only">{announcement}</output>
      </CardContent>
    </Card>
  );
}
export default SettingsPreferencePanel;
