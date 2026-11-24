import { languageNameOf } from "@/lib/language-name";
import { LOCALE_DISPLAY_NAMES } from "./copy/updates-copy";
/** The endonym a content-locale tag states: the display name this application maps for it, else the name the language gives itself, else the tag as it stands. */ export function endonymOf(tag: string): string {
  const trimmed = tag.trim();
  if (trimmed === "") return "";
  const named = LOCALE_DISPLAY_NAMES[trimmed]?.trim() ?? "";
  return named !== "" ? named : languageNameOf(trimmed);
}
