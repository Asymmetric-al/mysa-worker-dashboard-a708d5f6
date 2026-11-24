/** The Partners family's one reading of the tag vocabulary a record is filed against: the roster's own `tag` facet states the labels this ministry already uses, and a record's filing surface offers exactly those labels as its suggestions. The helper states a function rather than a component because both a Server Component route and the roster's browser read answer with the same facet entries, so neither surface issues the facet read of its own. */
import type { FacetKey } from "./copy/facets";
/** The roster facet whose options are the tags this ministry already files records under. */
export const TAG_FACET_ID = "tag" satisfies FacetKey;
/** The tag labels one facet set carries, in the order the read states them; a set that did not answer, or that states no tag facet, offers no suggestion rather than a guessed one. */
export function tagSuggestionsOf(facets: readonly { readonly id: string; readonly options: readonly { readonly label: string }[] }[] | null | undefined): readonly string[] {
  const tagFacet = facets?.find((facet) => facet.id === TAG_FACET_ID);
  return tagFacet === undefined ? [] : tagFacet.options.map((option) => option.label);
}
