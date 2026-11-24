/** The one copy of the search-parameter judgement every query-shaped read shares: a read declares the parameters it applies, and a name it does not declare is refused by name rather than dropped before the grammar can see it — a read that ignored a mistyped parameter would answer a page, a total or a result the caller did not ask for. */
import { z } from "zod";
/** The refusal one search parameter earns when the read does not declare it. */
export const unadmittedSearchParameterMessage = (name: string): string => `This read accepts no search parameter named "${name}", so remove it: a name the read does not declare is refused rather than ignored, because a read that ignored it would answer a page or a result the caller did not ask for.`;
/** Every parameter the request states, by name, so a strict grammar sees the names it must refuse: a name stated more than once is read once, which is what the grammars below judge. */
export function statedSearchValues(search: URLSearchParams): Record<string, string> {
  const stated = [...new Set(search.keys())].map((name): readonly [string, string | null] => [name, search.get(name)]);
  return Object.fromEntries(stated.filter((pair): pair is readonly [string, string] => pair[1] !== null));
}
/** The grammar's refusal with every undeclared name spelled out: a Zod `unrecognized_keys` issue names its keys only in its own detail, so each one becomes its own per-field message at the path the caller sent. */
export function refusedSearchParameters(error: z.ZodError): z.ZodError {
  const issues: NonNullable<ConstructorParameters<typeof z.ZodError>[0]>[number][] = [];
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const name of issue.keys) issues.push({ code: "custom", path: [...issue.path, name], message: unadmittedSearchParameterMessage(name) });
    } else {
      issues.push(issue);
    }
  }
  return new z.ZodError(issues);
}
