/** The one owner of "what may be an in-application destination". */ export type DestinationProblem = "empty" | "not-relative" | "protocol-relative" | "backslash" | "control-character";
/** Answers why `href` is not an application destination, or `undefined` when it is one. */ export function destinationProblemOf(href: string): DestinationProblem | undefined {
  if (href.trim().length === 0) return "empty";
  for (const character of href) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return "control-character";
  }
  if (href.startsWith("//")) return "protocol-relative";
  if (href.includes("\\")) return "backslash";
  return href.startsWith("/") ? undefined : "not-relative";
}
