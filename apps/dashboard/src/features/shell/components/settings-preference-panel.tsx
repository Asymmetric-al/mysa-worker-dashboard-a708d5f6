"use client";

/**
 * The three viewer presentation preferences — appearance, interface language and display time zone —
 * and nothing else.
 *
 * AAP item: 0.10.1 family "Shell, Home, Settings, Help", which requires that "Settings covers
 * appearance, locale, display time zone, source status and reset". This file owns the three
 * preferences alone; the source status belongs to its own panel and the reset control belongs to the
 * development region, so neither is repeated here.
 *
 * Closed inventory. `useViewerPreferences` from `./viewer-preferences-provider` is the one owner of
 * these three values and this panel's only way in and out. Nothing here saves settings: there is no
 * settings record, no Route Handler, no query cache key and no service import, because the named
 * inventory this release defines is closed and a preference of the person at this browser is not one
 * of its entries. Each control commits the moment it changes — there is no Save button — and a commit can
 * only reach the provider, so it re-fetches, invalidates and clears nothing: no component here
 * touches the query cache, and none of the three values can change the selected context, the session
 * state or a record.
 *
 * A preference is not identity, context, private information, financial fact, consent, publication or
 * communication. The interface language decides how `Intl` renders a date, a number and a name; it is
 * not a translation system and not a language of record for anything a partner receives. The display
 * time zone decides how an instant the service supplied is rendered and never when a boundary falls:
 * civil dates, deadlines and windows are computed in `@/modules/time` and are untouched by it.
 * Direction stays a property of the content, served by the single `Direction` provider, so nothing
 * here writes `dir` and nothing here treats the interface language as a language setting.
 *
 * Both lists are derived in this module from the platform's own `Intl` data, never from a locale or
 * time-zone data package:
 *   - the language list is a short documented shortlist plus the language already in use, labelled
 *     through `Intl.DisplayNames` ("English (United Kingdom)", "Arabic");
 *   - the time-zone list is the same shortlist plus, where the platform can enumerate them, every
 *     IANA zone from `Intl.supportedValuesOf("timeZone")`. The shortlist is not redundant: `UTC` is a
 *     valid zone that enumeration does not return, and a platform that cannot enumerate still gets a
 *     usable list. A platform that cannot resolve a zone at all degrades to a plain text field, which
 *     is the only case free text is accepted.
 *
 * Enumeration is read only after hydration (`usePlatformReady`), so the server render, the hydration
 * render and the browser render never disagree about the option list, and no zone data is shipped
 * with the application.
 */

import { useCallback, useId, useMemo, useState, useSyncExternalStore } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";

import {
  VIEWER_APPEARANCES,
  useViewerPreferences,
  type ViewerAppearance,
} from "./viewer-preferences-provider";

/**
 * What each appearance choice is called and what it does. `VIEWER_APPEARANCES` — not this map —
 * decides which choices exist, so the panel cannot offer a value the provider would refuse.
 */
const APPEARANCE_COPY: Record<
  ViewerAppearance,
  { readonly label: string; readonly description: string }
> = {
  system: {
    label: "Match your device",
    description: "Follows your operating system's light or dark setting while this page is open.",
  },
  light: {
    label: "Light",
    description: "Always shows this application's light colour scheme.",
  },
  dark: {
    label: "Dark",
    description: "Always shows this application's dark colour scheme.",
  },
};

/**
 * The documented language shortlist: what the panel offers before the platform has any further
 * language to add, and every entry is a tag `Intl.getCanonicalLocales` accepts, so a choice can
 * always be applied. A language the viewer already has is added to the list rather than replacing it,
 * so the selected option is always present in the control that shows it.
 */
const LANGUAGE_SHORTLIST: readonly string[] = [
  "en-GB",
  "en-US",
  "en-AU",
  "en-CA",
  "fr-FR",
  "de-DE",
  "es-ES",
  "pt-BR",
  "ar",
  "he",
  "ko-KR",
  "ja-JP",
];

/**
 * The documented time-zone shortlist. `UTC` is here because `Intl.supportedValuesOf("timeZone")` does
 * not return it, and the rest are the zones the seeded workers, ministries and partners work in.
 */
const TIME_ZONE_SHORTLIST: readonly string[] = [
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Madrid",
  "Europe/Warsaw",
  "Africa/Lagos",
  "Africa/Nairobi",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Seoul",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

/** The English names a label is built from; `null` where the platform names nothing. */
interface IntlNames {
  of: (code: string) => string | undefined;
}

type IntlNamesConstructor = new (
  locales: readonly string[],
  options: { readonly type: string },
) => IntlNames;

/** Names are read once per kind: they never change while the page is open. */
const namesCache = new Map<string, IntlNames | null>();

/** `Intl.DisplayNames` for one kind of code, or `null` on a platform that does not provide it. */
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

/**
 * The label a viewer reads for a language tag — "English (United Kingdom)", "Arabic", "Chinese
 * (Traditional, Taiwan)". It is assembled from the tag's own subtags so the region is never lost, and
 * it falls back to the tag itself when the platform cannot name a part of it.
 */
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

/** The languages the language control offers, with the one in use guaranteed present. */
function languageChoices(current: string): readonly string[] {
  const choices: string[] = [...LANGUAGE_SHORTLIST];
  if (!choices.includes(current)) {
    choices.unshift(current);
  }
  return choices;
}

/**
 * How the display time zone is offered. `enumerated` lists every zone the platform publishes,
 * `documented` the shortlist above, and `text` is the fallback for a platform that cannot resolve a
 * zone at all.
 */
type TimeZoneMode = "enumerated" | "documented" | "text";

/** The two groups of the time-zone control: `all` is empty unless the zones were enumerated. */
interface TimeZoneChoices {
  readonly common: readonly string[];
  readonly all: readonly string[];
}

/** Whether this platform can resolve an IANA zone, which is the least the control needs. */
function canResolveTimeZone(): boolean {
  return typeof Intl !== "undefined" && typeof Intl.DateTimeFormat === "function";
}

/** Every IANA zone the platform publishes, or none where it cannot enumerate them. */
function enumerableTimeZones(): readonly string[] {
  try {
    const supportedValuesOf = (Intl as unknown as { supportedValuesOf?: (key: string) => unknown })
      .supportedValuesOf;
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

/** The mode this render can offer: enumeration only once the browser has hydrated. */
function timeZoneMode(platformReady: boolean): TimeZoneMode {
  if (!canResolveTimeZone()) {
    return "text";
  }
  return platformReady && enumerableTimeZones().length > 0 ? "enumerated" : "documented";
}

/** The zones the time-zone control offers, with the zone in use guaranteed present. */
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

/** A subscription that never fires: a platform's capabilities do not change while a page is open. */
const noSubscription = (): void => {};

function subscribeToPlatform(): () => void {
  return noSubscription;
}

/** A browser render can read the platform's own capabilities. */
function readPlatformReady(): boolean {
  return true;
}

/** The server render cannot know them, so it answers as the hydration render must. */
function readServerPlatformReady(): boolean {
  return false;
}

/**
 * `true` only in a browser render that has hydrated. The server cannot know which zones the browser
 * will enumerate and the hydration render must match the server's markup, so both use the documented
 * shortlist and the full list appears immediately afterwards, once.
 */
function usePlatformReady(): boolean {
  return useSyncExternalStore(subscribeToPlatform, readPlatformReady, readServerPlatformReady);
}

/** Whether a value from the radio group is one of the three appearance choices. */
function isAppearanceChoice(value: string): value is ViewerAppearance {
  return (VIEWER_APPEARANCES as readonly string[]).includes(value);
}

/**
 * Shows the three presentation preferences of the person using this browser and applies each change
 * the moment it is made.
 */
export function SettingsPreferencePanel() {
  const {
    appearance,
    interfaceLocale,
    displayTimeZone,
    setAppearance,
    setInterfaceLocale,
    setDisplayTimeZone,
  } = useViewerPreferences();

  const platformReady = usePlatformReady();

  /* The text of the one polite live region. It is the only local state this panel keeps: it repeats
   * nothing the provider owns, and the value that was applied is always read back from the provider. */
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

  /* The text field applies every keystroke, because the provider keeps the zone it can resolve and
   * refuses the rest. It announces on blur, where the typed text and the applied zone can be compared
   * — and that comparison is also what restores the field, since re-rendering a controlled input puts
   * the applied zone back into it. No second copy of the preference is kept to do this. */
  const announceTypedTimeZone = useCallback(
    (typed: string) => {
      const candidate = typed.trim();
      if (candidate === displayTimeZone) {
        setAnnouncement(`Display time zone: ${displayTimeZone}`);
        return;
      }
      if (candidate.length === 0) {
        setAnnouncement(
          `Display time zone: ${displayTimeZone}. No time zone was entered, so this has not changed.`,
        );
        return;
      }
      setAnnouncement(
        `Display time zone: ${displayTimeZone}. ${candidate} is not a time zone this browser knows, so this has not changed.`,
      );
    },
    [displayTimeZone],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Appearance, language and time zone</h2>
        </CardTitle>
        <CardDescription>
          These are presentation preferences for this browser. They change only how dates, times and
          numbers are formatted on screen — not which records you can see, the ministry you are
          working in, or anything a partner receives.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-6">
        <fieldset className="min-w-0">
          <legend id={appearanceLegendId} className="mb-3 text-sm font-medium">
            Appearance
          </legend>
          <div className="flex flex-col gap-3">
            <p id={appearanceHintId} className="text-sm text-muted-foreground">
              Applies to this browser only and takes effect immediately. “Match your device” follows
              your operating system while this page is open.
            </p>
            <RadioGroup
              value={appearance}
              onValueChange={chooseAppearance}
              aria-labelledby={appearanceLegendId}
              aria-describedby={appearanceHintId}
            >
              {VIEWER_APPEARANCES.map((choice) => {
                const copy = APPEARANCE_COPY[choice];
                /* The id lands on the radio's own input, so the label is associated with a control
                   that exists in the markup as well as wrapping the choice. */
                const choiceId = `${idPrefix}-appearance-${choice}-choice`;
                const descriptionId = `${idPrefix}-appearance-${choice}-description`;
                return (
                  <label
                    key={choice}
                    htmlFor={choiceId}
                    className="flex min-h-6 items-start gap-3 py-1"
                  >
                    <RadioGroupItem
                      id={choiceId}
                      value={choice}
                      aria-label={copy.label}
                      aria-describedby={descriptionId}
                      className="mt-0.5"
                    />
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
              Sets the language of the dates, times and numbers you see here. It does not translate
              the interface, and it is never the language of something sent to a partner.
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
                onBlur={(event) => {
                  announceTypedTimeZone(event.currentTarget.value);
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
              Changes how dates and times are shown to you. A date with no time of day — a due date,
              an introduction date — keeps the day the service recorded, and no deadline moves.
              {mode === "text"
                ? " This browser cannot list time zones, so type the zone name, for example Europe/Berlin."
                : ""}
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
