/** The one bridge from the search parameters Next hands a route to the query-string view a URL grammar parses, so a Server Component and the browser call the same parser on the same address. */

/**
 * Reads the parameters a route received as a query string, keeping every value a repeated parameter carries: a grammar
 * then parses exactly the address the caller wrote, rather than one value per name chosen on its behalf.
 */
export function querySearchParamsOf(stated: Readonly<Record<string, string | readonly string[] | undefined>>): URLSearchParams {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(stated)) {
    for (const entry of typeof value === "string" ? [value] : (value ?? [])) {
      search.append(name, entry);
    }
  }
  return search;
}
