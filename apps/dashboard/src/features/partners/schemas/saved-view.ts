/**
 * The Partners family's `saveView`, `renameView` and `deleteView` payload schemas, and the
 * repair-on-drift check the saved-view bar runs before it applies a stored view.
 */
import { z } from "zod";
import type { RecordListQueryState } from "@/components/record-list";
// The roster's pager
/** The two page sizes the partner roster's pager offers, smallest first: the release's 50-row default and its 200-row ceiling (AAP 0.8.7). */
export const PARTNER_LIST_PAGE_SIZE_OPTIONS = [50, 200] as const;
// Wording
//
// `../copy/{facets,privacy,states}.ts` carry this family's guidance and the outcome wording a
// surface shows; none of them words a schema refusal, so the sentences a field shows for a payload
// the form stopped live here, declared once and referenced by every rule that can raise one.
const SAVED_VIEW_MESSAGES = {
  searchInvalid: "A saved view states the search text it was saved with, empty when it had none.",
  facetKeyEmpty: "A stored filter is missing the facet it belongs to.",
  facetValueInvalid: "A selected filter value is empty, so it matches nothing.",
  facetSelectionEmpty: "A selected filter needs at least one value; clear the facet instead of storing it empty.",
  repeatedValue: "Remove the repeated value from this filter.",
  sortFieldMissing: "A stored sort needs the column it orders by.",
  sortDirectionInvalid: "A stored sort runs ascending or descending.",
  columnKeyEmpty: "A stored column entry is missing the column it names.",
  pageSizeTooSmall: "A stored page holds at least one row.",
  viewIdInvalid: "A saved view is named by text, so choose the view again from the list.",
  viewIdEmpty: "An empty identifier names no saved view.",
  nameInvalid: "A view's name is text, so type the name this view should be saved under.",
  nameEmpty: "Give this view a name.",
} as const;
// The choices a view stores
/** The values selected inside one facet, as the roster emits them and the service stores them. */
export const savedViewFacetValuesSchema = z.array(z.string().min(1, SAVED_VIEW_MESSAGES.facetValueInvalid)).min(1, SAVED_VIEW_MESSAGES.facetSelectionEmpty);

type SortDirectionOf<Desc extends boolean> = Desc extends true ? "desc" : "asc";

type RosterSortAsStored = {
  readonly field: RecordListQueryState["sort"][number]["id"];
  readonly direction: SortDirectionOf<RecordListQueryState["sort"][number]["desc"]>;
};
/** One ordering a stored view keeps. */
export const savedViewSortSchema = z.strictObject({
  field: z.string().min(1, SAVED_VIEW_MESSAGES.sortFieldMissing),
  direction: z.enum(["asc", "desc"], SAVED_VIEW_MESSAGES.sortDirectionInvalid),
}) satisfies z.ZodType<RosterSortAsStored>;
type StoredQueryAsRosterState = {
  readonly search: string;
  readonly applied: Readonly<Record<string, readonly string[]>>;
  readonly columnVisibility?: RecordListQueryState["columnVisibility"];
  readonly sort?: RosterSortAsStored;
  readonly pageSize?: number;
};
/** The choices a saved view stores, in the service payload's own members: the search text, the values selected per facet, the visible columns and, when the roster's own page state is included. */
export const savedViewQuerySchema = z
  .strictObject({
    search: z.string({ error: SAVED_VIEW_MESSAGES.searchInvalid }),
    applied: z.record(z.string().min(1, SAVED_VIEW_MESSAGES.facetKeyEmpty), savedViewFacetValuesSchema),
    columnVisibility: z.record(z.string().min(1, SAVED_VIEW_MESSAGES.columnKeyEmpty), z.boolean()).optional(),
    sort: savedViewSortSchema.optional(),
    pageSize: z.int().min(1, SAVED_VIEW_MESSAGES.pageSizeTooSmall).optional(),
  })
  .superRefine((query, context) => {
    for (const [facetId, values] of Object.entries(query.applied)) {
      const seen = new Set<string>();
      values.forEach((value, index) => {
        if (!seen.has(value)) {
          seen.add(value);
          return;
        }
        // The path points at the repeated entry, so a form marks that value rather than the whole
        // facet: one chip selected twice says the selection was assembled twice.
        context.addIssue({
          code: "custom",
          message: SAVED_VIEW_MESSAGES.repeatedValue,
          path: ["applied", facetId, index],
        });
      });
    }
  }) satisfies z.ZodType<StoredQueryAsRosterState>;
// The payloads
const savedViewIdSchema = z.string({ error: SAVED_VIEW_MESSAGES.viewIdInvalid }).min(1, SAVED_VIEW_MESSAGES.viewIdEmpty);

const savedViewNameSchema = z.string({ error: SAVED_VIEW_MESSAGES.nameInvalid }).refine((name) => name.trim() !== "", { error: SAVED_VIEW_MESSAGES.nameEmpty });
/** Validates the `saveView` payload: the name, the choices, and an existing view to replace. */
export const saveViewPayloadSchema = z.strictObject({
  name: savedViewNameSchema,
  queryState: savedViewQuerySchema,
  viewId: savedViewIdSchema.optional(),
});
/** Validates the `renameView` payload: one view and its new name, and nothing else. */
export const renameViewPayloadSchema = z.strictObject({
  viewId: savedViewIdSchema,
  name: savedViewNameSchema,
});
/** Validates the `deleteView` payload: the one view to remove. */
export const deleteViewPayloadSchema = z.strictObject({
  viewId: savedViewIdSchema,
});
/** The validated `saveView` payload: the name, the stored choices and an optional view to replace. */
export type SaveViewPayload = z.infer<typeof saveViewPayloadSchema>;
/** The validated `renameView` payload: the view and its new name, with no choices to rewrite. */
export type RenameViewPayload = z.infer<typeof renameViewPayloadSchema>;
/** The validated `deleteView` payload: the single view to remove. */
export type DeleteViewPayload = z.infer<typeof deleteViewPayloadSchema>;
/** The choices a saved view stores, exactly as this file validates and the service reads them. */
export type SavedViewQuery = z.infer<typeof savedViewQuerySchema>;
// Drift: what a stored view names that the envelope no longer admits
type StoredChoices = {
  readonly applied: Readonly<Record<string, readonly string[]>>;
  readonly columnVisibility?: Readonly<Record<string, boolean>>;
};
type AdmittedFacet = {
  readonly id: string;
  readonly state?: "available" | "unavailable";
  readonly options: ReadonlyArray<{ readonly id: string }>;
};
type AdmittedChoices = {
  readonly facets: ReadonlyArray<AdmittedFacet>;
  readonly columns: ReadonlyArray<string>;
};
/** What a stored view refers to that the current envelope no longer offers. */
export type SavedViewDrift =
  | { readonly state: "clean" }
  | {
      readonly state: "drifted";
      readonly deadFacets: readonly string[];
      readonly deadValues: readonly { readonly facet: string; readonly value: string }[];
      readonly deadColumns: readonly string[];
    };
/** Reports which of a saved view's choices the current envelope no longer admits. */
export function checkSavedViewDrift(query: StoredChoices, admitted: AdmittedChoices): SavedViewDrift {
  const deadFacets: string[] = [];
  const deadValues: { facet: string; value: string }[] = [];
  const reported = new Set<string>();
  for (const [facetId, values] of Object.entries(query.applied)) {
    const facet = admitted.facets.find((candidate) => candidate.id === facetId);
    if (facet === undefined || facet.state === "unavailable" || facet.options.length === 0) {
      // The whole selection is dead, so its values are not reported one by one: naming them would
      // suggest the facet itself still works and only its values changed.
      deadFacets.push(facetId);
      continue;
    }
    const offered = new Set(facet.options.map((option) => option.id));
    for (const value of values) {
      if (offered.has(value)) {
        continue;
      }
      const key = `${facetId}\u0000${value}`;
      if (reported.has(key)) {
        continue;
      }
      reported.add(key);
      deadValues.push({ facet: facetId, value });
    }
  }
  const deadColumns: string[] = [];
  for (const columnId of Object.keys(query.columnVisibility ?? {})) {
    if (!admitted.columns.includes(columnId)) {
      deadColumns.push(columnId);
    }
  }
  if (deadFacets.length === 0 && deadValues.length === 0 && deadColumns.length === 0) {
    return { state: "clean" };
  }
  return { state: "drifted", deadFacets, deadValues, deadColumns };
}
