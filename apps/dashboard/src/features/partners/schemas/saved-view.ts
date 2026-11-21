import { z } from "zod";
import type { RecordListQueryState } from "@/components/record-list";
export const PARTNER_LIST_PAGE_SIZE_OPTIONS = [50, 200] as const;
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
export const savedViewFacetValuesSchema = z.array(z.string().min(1, SAVED_VIEW_MESSAGES.facetValueInvalid)).min(1, SAVED_VIEW_MESSAGES.facetSelectionEmpty);
type SortDirectionOf<Desc extends boolean> = Desc extends true ? "desc" : "asc";
type RosterSortAsStored = { readonly field: RecordListQueryState["sort"][number]["id"]; readonly direction: SortDirectionOf<RecordListQueryState["sort"][number]["desc"]> };
export const savedViewSortSchema = z.strictObject({ field: z.string().min(1, SAVED_VIEW_MESSAGES.sortFieldMissing), direction: z.enum(["asc", "desc"], SAVED_VIEW_MESSAGES.sortDirectionInvalid) }) satisfies z.ZodType<RosterSortAsStored>;
type StoredQueryAsRosterState = { readonly search: string; readonly applied: Readonly<Record<string, readonly string[]>>; readonly columnVisibility?: RecordListQueryState["columnVisibility"]; readonly sort?: RosterSortAsStored; readonly pageSize?: number };
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
        context.addIssue({ code: "custom", message: SAVED_VIEW_MESSAGES.repeatedValue, path: ["applied", facetId, index] });
      });
    }
  }) satisfies z.ZodType<StoredQueryAsRosterState>;
const savedViewIdSchema = z.string({ error: SAVED_VIEW_MESSAGES.viewIdInvalid }).min(1, SAVED_VIEW_MESSAGES.viewIdEmpty);
const savedViewNameSchema = z.string({ error: SAVED_VIEW_MESSAGES.nameInvalid }).refine((name) => name.trim() !== "", { error: SAVED_VIEW_MESSAGES.nameEmpty });
export const saveViewPayloadSchema = z.strictObject({ name: savedViewNameSchema, queryState: savedViewQuerySchema, viewId: savedViewIdSchema.optional() });
export const renameViewPayloadSchema = z.strictObject({ viewId: savedViewIdSchema, name: savedViewNameSchema });
export const deleteViewPayloadSchema = z.strictObject({ viewId: savedViewIdSchema });
export type SaveViewPayload = z.infer<typeof saveViewPayloadSchema>;
export type RenameViewPayload = z.infer<typeof renameViewPayloadSchema>;
export type DeleteViewPayload = z.infer<typeof deleteViewPayloadSchema>;
export type SavedViewQuery = z.infer<typeof savedViewQuerySchema>;
type StoredChoices = { readonly applied: Readonly<Record<string, readonly string[]>>; readonly columnVisibility?: Readonly<Record<string, boolean>> };
type AdmittedFacet = { readonly id: string; readonly state?: "available" | "unavailable"; readonly options: ReadonlyArray<{ readonly id: string }> };
type AdmittedChoices = { readonly facets: ReadonlyArray<AdmittedFacet>; readonly columns: ReadonlyArray<string> };
export type SavedViewDrift = { readonly state: "clean" } | { readonly state: "drifted"; readonly deadFacets: readonly string[]; readonly deadValues: readonly { readonly facet: string; readonly value: string }[]; readonly deadColumns: readonly string[] };
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
