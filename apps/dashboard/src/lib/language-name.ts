/** The one name for a language tag: the language's own name where the runtime has one, and the tag as it stands where it has none, so no surface invents a name for a tag it cannot resolve. */
export function languageNameOf(tag: string): string {
  const trimmed = tag.trim();
  if (trimmed === "") return "";
  const language = (trimmed.split("-")[0] ?? trimmed).toLowerCase();
  try {
    const names = new Intl.DisplayNames([language], { type: "language" });
    const name = names.of(language);
    return name === undefined || name.trim() === "" ? trimmed : name;
  } catch {
    return trimmed;
  }
}
