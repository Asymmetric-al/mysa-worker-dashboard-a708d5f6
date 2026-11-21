/**
 * The one owner of "what may be an in-application destination".
 *
 * Two surfaces offer a link whose value arrives as data: Home's triage rows, where the destination is
 * a query-carrying route, and the audience inbox's protected notice, where it is the link the message
 * carried. Both must refuse the same values for the same reason — a `javascript:` or `data:`
 * destination executes when it is followed — and neither may import the other, because a feature
 * folder is composed by `src/app` and never by another feature. So the rule is stated once here,
 * below both callers, and each caller renders the refusal in its own words (AAP 0.3.4, 0.15.1).
 *
 * It imports nothing and holds no copy, so a Server Component, a Client Component, a schema and a
 * Vitest test can each read it.
 */

/**
 * Why a value is not an application destination.
 *
 * The members stay apart because they are different mistakes: an absent value, a URL that names
 * another site, a path that resolves to another host, an address with a scheme, and text whose
 * characters change how the rest of the line is read. A caller that states its own sentence per
 * member reports the actual problem instead of a generic "invalid link".
 */
export type DestinationProblem =
  | "empty"
  | "not-relative"
  | "protocol-relative"
  | "backslash"
  | "control-character";

/**
 * Answers why `href` is not an application destination, or `undefined` when it is one.
 *
 * An application destination is a path this application serves: one leading `/`, then anything the
 * route carries, including the query string and fragment that make returning to a filtered list
 * useful. Everything else is refused rather than repaired, in this order, so the reason a caller
 * reports is the first one that applies.
 *
 * The backslash and control-character cases are stated here rather than left to the caller because
 * each one reads like a path and still resolves somewhere else. Browsers treat `\` as `/`, so
 * `/\host` is `//host` and leaves the site; and a C0 control character (U+0000–U+001F) or DEL
 * (U+007F) can terminate or reorder the text a reader sees, which no route of this application
 * carries.
 */
export function destinationProblemOf(href: string): DestinationProblem | undefined {
  if (href.trim().length === 0) {
    return "empty";
  }

  for (const character of href) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) {
      return "control-character";
    }
  }

  if (href.startsWith("//")) {
    return "protocol-relative";
  }

  if (href.includes("\\")) {
    return "backslash";
  }

  return href.startsWith("/") ? undefined : "not-relative";
}
