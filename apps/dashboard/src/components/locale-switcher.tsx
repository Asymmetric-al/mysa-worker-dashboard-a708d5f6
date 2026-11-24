"use client";
import { useEffect, useId, useRef, type ReactElement, type ReactNode } from "react";
import { StateNotice } from "@/components/state-notice";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/cn";
import { languageNameOf } from "@/lib/language-name";
import type { ContentLocale } from "@/modules/content/locale";
type ContentDirection = ContentLocale["direction"];
const DIRECTION_WORDS: Readonly<Record<ContentDirection, string>> = { ltr: "left to right", rtl: "right to left" };
export type LocaleEdition = ContentLocale & { readonly endonym?: string; readonly label?: string; readonly releaseId?: string; readonly isSiteDefault?: boolean };
export type LocaleSwitcherProps = {
  readonly locales: readonly LocaleEdition[];
  readonly requested: string;
  readonly served?: string;
  readonly fallbackOccurred?: boolean;
  readonly onRequest: (tag: string) => void;
  readonly onDirectionChange?: (servedDirection: ContentDirection) => void;
  readonly unavailable?: boolean;
  readonly label: string;
  readonly className?: string;
};
const normaliseTag = (tag: string): string => tag.trim().toLowerCase();
function findEdition(locales: readonly LocaleEdition[], tag: string | undefined): LocaleEdition | undefined {
  if (tag === undefined) return undefined;
  const wanted = normaliseTag(tag);
  return wanted === "" ? undefined : locales.find((locale) => normaliseTag(locale.tag) === wanted);
}
function displayNameOf(edition: LocaleEdition): string {
  const endonym = edition.endonym?.trim() ?? "";
  if (endonym !== "") return endonym;
  const label = edition.label?.trim() ?? "";
  return label !== "" ? label : languageNameOf(edition.tag);
}
function optionTextOf(edition: LocaleEdition): string {
  const name = displayNameOf(edition);
  return name === "" || normaliseTag(name) === normaliseTag(edition.tag) ? edition.tag : `${name} (${edition.tag})`;
}
/** The single locale-edition and direction selector. */ export function LocaleSwitcher({ locales, requested, served, fallbackOccurred = false, onRequest, onDirectionChange, unavailable = false, label, className }: LocaleSwitcherProps): ReactElement {
  const selectId = useId();
  const servedSentenceId = useId();
  const requestedTag = requested.trim();
  const hasEditions = locales.length > 0;
  const isUnavailable = unavailable || !hasEditions;
  const requestedEdition = isUnavailable ? undefined : findEdition(locales, requestedTag);
  const servedEdition = isUnavailable ? undefined : (findEdition(locales, served) ?? (fallbackOccurred ? undefined : requestedEdition));
  const servedTag = servedEdition?.tag ?? "";
  const servedDirection: ContentDirection | undefined = servedEdition?.direction;
  const requestedName = requestedEdition === undefined ? languageNameOf(requestedTag) : displayNameOf(requestedEdition);
  const directionHandler = useRef(onDirectionChange);
  const reportedDirection = useRef<ContentDirection | undefined>(undefined);
  useEffect(() => {
    directionHandler.current = onDirectionChange;
  });
  useEffect(() => {
    if (reportedDirection.current === servedDirection) return;
    reportedDirection.current = servedDirection;
    if (servedDirection !== undefined) directionHandler.current?.(servedDirection);
  }, [servedDirection]);
  let servedSentence: ReactNode;
  if (servedEdition === undefined) {
    servedSentence = isUnavailable ? null : <span className="min-w-0 text-muted-foreground text-pretty wrap-anywhere">{fallbackOccurred ? "A language other than the one requested is being shown; choose the edition to read below." : "No language is being read yet."}</span>;
  } else {
    servedSentence = (
      <>
        {servedEdition !== undefined && requestedTag !== "" && normaliseTag(servedTag) !== normaliseTag(requestedTag) ? (
          <span className="min-w-0 text-muted-foreground text-pretty wrap-anywhere">
            Requested <bdi className="font-medium text-foreground">{requestedName}</bdi> <bdi className="mono-identifier">{requestedTag}</bdi>.
          </span>
        ) : null}
        <span className="text-muted-foreground">showing</span>
        <Badge variant="outline">
          <bdi className="min-w-0 break-words">{servedEdition === undefined ? "" : displayNameOf(servedEdition)}</bdi>
        </Badge>
        <bdi className="mono-identifier">{servedTag}</bdi>
        <span className="text-muted-foreground">read {DIRECTION_WORDS[servedEdition.direction]}.</span>
        {servedEdition.isSiteDefault === true ? <Badge variant="secondary">Site default</Badge> : null}
      </>
    );
  }
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)} data-slot="locale-switcher" data-served-locale={servedTag === "" ? undefined : servedTag} data-served-direction={servedDirection}>
      <Label htmlFor={selectId}>{label}</Label>
      <NativeSelect
        id={selectId}
        className="w-full max-w-full"
        value={servedTag}
        disabled={!hasEditions}
        aria-describedby={servedSentenceId}
        onChange={(event) => {
          const chosen = findEdition(locales, event.target.value);
          if (chosen === undefined) return;
          onRequest(chosen.tag);
        }}
      >
        {servedTag === "" ? (
          <NativeSelectOption value="" disabled>
            {isUnavailable ? "No edition in the requested language" : "No language selected"}
          </NativeSelectOption>
        ) : null}
        {locales.map((edition) => (
          <NativeSelectOption key={edition.tag} value={edition.tag}>
            {optionTextOf(edition)}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <output id={servedSentenceId} htmlFor={selectId} aria-atomic="true" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-start text-xs">
        {servedSentence}
      </output>
      {isUnavailable ? (
        <StateNotice
          kind="language-unavailable"
          title={requestedName === "" ? "Language unavailable" : `Language unavailable: ${requestedName}`}
          description={hasEditions ? "Choose another language from the list to read this edition in one you are permitted to read." : "No edition you are permitted to read exists in the language you asked for, and there is no other language to offer here."}
        />
      ) : null}
    </div>
  );
}
export default LocaleSwitcher;
