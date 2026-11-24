"use client";
import { useCallback, useId, useMemo, useState, useSyncExternalStore, type ReactElement } from "react";
import SectionCard from "@/components/section-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { PUBLISHING_PREFERENCES, VIEWER_APPEARANCES, canResolveTimeZone, useViewerPreferences, type PublishingPreference, type ViewerAppearance } from "./viewer-preferences-provider";
type ChoiceCopy = { readonly label: string; readonly description: string };
const APPEARANCE_COPY: Record<ViewerAppearance, ChoiceCopy> = {
  system: { label: "Match your device", description: "Follows your operating system's light or dark setting while this page is open." },
  light: { label: "Light", description: "Always shows this application's light colour scheme." },
  dark: { label: "Dark", description: "Always shows this application's dark colour scheme." },
};
/** The two release modes a new submission can ask for: each value is the provider's own, so no mode the preference does not hold can be offered. */ const PUBLISHING_COPY: Record<PublishingPreference, ChoiceCopy> = {
  "publish-only": { label: "Publish only", description: "Releases the exact frozen candidate and submits no notice." },
  "publish-and-notify": { label: "Publish and notify now", description: "Asks for one simulated notice for each eligible recipient." },
};
const LANGUAGE_SHORTLIST: readonly string[] = ["en-GB", "en-US", "en-AU", "en-CA", "fr-FR", "de-DE", "es-ES", "pt-BR", "ar", "he", "ko-KR", "ja-JP"];
const TIME_ZONE_SHORTLIST: readonly string[] =
  "UTC Europe/London Europe/Berlin Europe/Paris Europe/Madrid Europe/Warsaw Africa/Lagos Africa/Nairobi America/New_York America/Chicago America/Denver America/Los_Angeles America/Sao_Paulo Asia/Dubai Asia/Kolkata Asia/Singapore Asia/Seoul Asia/Tokyo Australia/Sydney Pacific/Auckland".split(" ");
type IntlNames = { of: (code: string) => string | undefined };
type IntlNamesConstructor = new (locales: readonly string[], options: { readonly type: string }) => IntlNames;
const namesCache = new Map<string, IntlNames | null>();
function intlNames(type: "language" | "region" | "script"): IntlNames | null {
  const cached = namesCache.get(type);
  if (cached !== undefined) return cached;
  let names: IntlNames | null = null;
  try {
    const Constructor = (Intl as unknown as { DisplayNames?: IntlNamesConstructor }).DisplayNames;
    if (typeof Constructor === "function") names = new Constructor(["en"], { type });
  } catch {
    names = null;
  }
  namesCache.set(type, names);
  return names;
}
function languageLabel(tag: string): string {
  let locale: Intl.Locale;
  try {
    locale = new Intl.Locale(tag);
  } catch {
    return tag;
  }
  const languageName = intlNames("language")?.of(locale.language);
  if (languageName === undefined || languageName.length === 0) return tag;
  const qualifiers = [locale.script === undefined ? undefined : intlNames("script")?.of(locale.script), locale.region === undefined ? undefined : intlNames("region")?.of(locale.region)].filter((name): name is string => name !== undefined && name.length > 0);
  return qualifiers.length === 0 ? languageName : `${languageName} (${qualifiers.join(", ")})`;
}
function languageChoices(current: string): readonly string[] {
  const choices: string[] = [...LANGUAGE_SHORTLIST];
  if (!choices.includes(current)) choices.unshift(current);
  return choices;
}
type TimeZoneMode = "enumerated" | "documented" | "text";
function enumerableTimeZones(): readonly string[] {
  try {
    const supportedValuesOf = (Intl as unknown as { supportedValuesOf?: (key: string) => unknown }).supportedValuesOf;
    if (typeof supportedValuesOf !== "function") return [];
    const zones = supportedValuesOf("timeZone");
    return !Array.isArray(zones) ? [] : zones.filter((zone): zone is string => typeof zone === "string");
  } catch {
    return [];
  }
}
const timeZoneMode = (platformReady: boolean): TimeZoneMode => (!platformReady ? "documented" : !canResolveTimeZone() ? "text" : enumerableTimeZones().length > 0 ? "enumerated" : "documented");
function timeZoneChoices(current: string, mode: TimeZoneMode): { readonly common: readonly string[]; readonly all: readonly string[] } {
  const common: string[] = [...TIME_ZONE_SHORTLIST];
  if (!common.includes(current)) common.unshift(current);
  if (mode !== "enumerated") return { common, all: [] };
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
const APPEARANCE_CARD_DESCRIPTION = "Appearance, language and time zone are presentation preferences for this browser. They change only how dates, times and numbers are formatted on screen — not which records you can see, the ministry you are working in, or anything a partner receives.";
const APPEARANCE_HINT = "Applies to this browser only and takes effect immediately. “Match your device” follows your operating system while this page is open.";
const PUBLISHING_HINT = "This sets the release mode a new submission asks for. The submission records that mode, a reviewer cannot change it, and this control sends nothing itself: the release and the notice are separate deliberate steps.";
const isAppearanceChoice = (value: string): value is ViewerAppearance => (VIEWER_APPEARANCES as readonly string[]).includes(value);
const isPublishingChoice = (value: string): value is PublishingPreference => (PUBLISHING_PREFERENCES as readonly string[]).includes(value); /** One closed choice rendered as radios: appearance and publishing both state their options through it, so neither can offer a value its preference does not hold. */
function ChoiceRadios<Key extends string>({
  legend,
  legendId,
  hint,
  hintId,
  value,
  choices,
  copy,
  onChoose,
}: {
  readonly legend: string;
  readonly legendId: string;
  readonly hint: string;
  readonly hintId: string;
  readonly value: string;
  readonly choices: readonly Key[];
  readonly copy: Readonly<Record<Key, ChoiceCopy>>;
  readonly onChoose: (next: string) => void;
}): ReactElement {
  return (
    <fieldset className="min-w-0">
      <legend {...{ id: legendId, className: "mb-3 text-sm font-medium" }}>{legend}</legend>
      <div className="flex flex-col gap-3">
        <p {...{ id: hintId, className: "type-supporting" }}>{hint}</p>
        <RadioGroup value={value} onValueChange={onChoose} aria-labelledby={legendId} aria-describedby={hintId}>
          {choices.map((choice) => {
            const entry = copy[choice];
            const choiceId = `${legendId}-${choice}`;
            const descriptionId = `${choiceId}-description`;
            return (
              <label key={choice} htmlFor={choiceId} className="flex min-h-6 items-start gap-3 py-1">
                <RadioGroupItem id={choiceId} value={choice} aria-label={entry.label} aria-describedby={descriptionId} className="mt-0.5" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium">{entry.label}</span>
                  <span {...{ id: descriptionId, className: "text-sm text-muted-foreground" }}>{entry.description}</span>
                </span>
              </label>
            );
          })}
        </RadioGroup>
      </div>
    </fieldset>
  );
}
export function SettingsPreferencePanel() {
  const { appearance, interfaceLocale, displayTimeZone, publishing, setAppearance, setInterfaceLocale, setDisplayTimeZone, setPublishingPreference } = useViewerPreferences();
  const platformReady = usePlatformReady();
  const [announcement, setAnnouncement] = useState("");
  const idPrefix = useId();
  const languageId = `${idPrefix}-language`;
  const languageHintId = `${idPrefix}-language-hint`;
  const timeZoneId = `${idPrefix}-time-zone`;
  const timeZoneHintId = `${idPrefix}-time-zone-hint`;
  const languages = useMemo(() => languageChoices(interfaceLocale), [interfaceLocale]);
  const mode = useMemo(() => timeZoneMode(platformReady), [platformReady]);
  const zones = useMemo(() => timeZoneChoices(displayTimeZone, mode), [displayTimeZone, mode]);
  const announce = useCallback((next: string, current: string, said: string): boolean => {
    if (next === current) return false;
    setAnnouncement(said);
    return true;
  }, []);
  const chooseAppearance = (next: string): void => {
    if (isAppearanceChoice(next) && announce(next, appearance, `Appearance: ${next}`)) setAppearance(next);
  };
  const chooseLanguage = (next: string): void => {
    if (announce(next, interfaceLocale, `Interface language: ${languageLabel(next)}`)) setInterfaceLocale(next);
  };
  const chooseTimeZone = (next: string): void => {
    if (announce(next, displayTimeZone, `Display time zone: ${next}`)) setDisplayTimeZone(next);
  };
  const choosePublishing = (next: string): void => {
    if (isPublishingChoice(next) && announce(next, publishing, `Publishing preference: ${PUBLISHING_COPY[next].label}`)) setPublishingPreference(next);
  };
  const announceTypedTimeZone = useCallback(() => setAnnouncement(`Display time zone: ${displayTimeZone}. This browser cannot check time-zone names, so the name is used exactly as typed.`), [displayTimeZone]);
  return (
    <>
      <SectionCard title="Appearance, language and time zone" description={APPEARANCE_CARD_DESCRIPTION} contentClassName="flex min-w-0 flex-col gap-6">
        <ChoiceRadios legend="Appearance" legendId={`${idPrefix}-appearance-legend`} hint={APPEARANCE_HINT} hintId={`${idPrefix}-appearance-hint`} value={appearance} choices={VIEWER_APPEARANCES} copy={APPEARANCE_COPY} onChoose={chooseAppearance} />
        <Separator />
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor={languageId}>Interface language</Label>
            <NativeSelect id={languageId} className="w-full" value={interfaceLocale} aria-describedby={languageHintId} onChange={(event) => chooseLanguage(event.target.value)}>
              {languages.map((tag) => (
                <NativeSelectOption key={tag} value={tag}>
                  {languageLabel(tag)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <p {...{ id: languageHintId, className: "type-supporting" }}>Sets the language of the dates, times and numbers you see here. It does not translate the interface, and it is never the language of something sent to a partner.</p>
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor={timeZoneId}>Display time zone</Label>
            {mode === "text" ? (
              <Input id={timeZoneId} type="text" value={displayTimeZone} placeholder="Europe/Berlin" autoComplete="off" spellCheck={false} aria-describedby={timeZoneHintId} onChange={(event) => setDisplayTimeZone(event.currentTarget.value)} onBlur={() => announceTypedTimeZone()} />
            ) : (
              <NativeSelect id={timeZoneId} className="w-full" value={displayTimeZone} aria-describedby={timeZoneHintId} onChange={(event) => chooseTimeZone(event.target.value)}>
                {[{ label: "Common time zones", zones: zones.common }, ...(zones.all.length === 0 ? [] : [{ label: "All time zones", zones: zones.all }])].map((group) => (
                  <NativeSelectOptGroup key={group.label} label={group.label}>
                    {group.zones.map((zone) => (
                      <NativeSelectOption key={zone} value={zone}>
                        {zone}
                      </NativeSelectOption>
                    ))}
                  </NativeSelectOptGroup>
                ))}
              </NativeSelect>
            )}
            <p id={timeZoneHintId} className="type-supporting">
              Changes how dates and times are shown to you. A date with no time of day — a due date, an introduction date — keeps the day the service recorded, and no deadline moves.
              {mode === "text" ? " This browser cannot list or check time-zone names, so the name you type is used exactly as typed, for example Europe/Berlin." : ""}
            </p>
          </div>
        </div>
      </SectionCard>
      <SectionCard title="Publishing" description="The release mode a new submission of an edition asks for. Nothing on this screen publishes, notifies or sends anything." contentClassName="flex min-w-0 flex-col gap-6">
        <ChoiceRadios legend="Publishing preferences" legendId={`${idPrefix}-publishing-legend`} hint={PUBLISHING_HINT} hintId={`${idPrefix}-publishing-hint`} value={publishing} choices={PUBLISHING_PREFERENCES} copy={PUBLISHING_COPY} onChoose={choosePublishing} />
      </SectionCard>
      {/* One polite region for all four controls, placed after both cards: every change is announced once, in words. */}
      <output className="sr-only">{announcement}</output>
    </>
  );
}
export default SettingsPreferencePanel;
