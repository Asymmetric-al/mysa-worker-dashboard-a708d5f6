import { z } from "zod";
import type { RecordListQueryState } from "@/components/record-list";
export const PARTNER_LIST_PAGE_SIZE_OPTIONS = [50, 200] as const;
export const savedViewFacetValuesSchema = z.array(z.string().min(1, "A selected filter value is empty, so it matches nothing.")).min(1, "A selected filter needs at least one value; clear the facet instead of storing it empty.");
type SortDirectionOf<Desc extends boolean> = Desc extends true ? "desc" : "asc";
type RosterSortAsStored = { readonly field: RecordListQueryState["sort"][number]["id"]; readonly direction: SortDirectionOf<RecordListQueryState["sort"][number]["desc"]> };
export const savedViewSortSchema = z.strictObject({ field: z.string().min(1, "A stored sort needs the column it orders by."), direction: z.enum(["asc", "desc"], "A stored sort runs ascending or descending.") }) satisfies z.ZodType<RosterSortAsStored>;
export const savedViewQuerySchema = z
  .strictObject({
    search: z.string({ error: "A saved view states the search text it was saved with, empty when it had none." }),
    applied: z.record(z.string().min(1, "A stored filter is missing the facet it belongs to."), savedViewFacetValuesSchema),
    columnVisibility: z.record(z.string().min(1, "A stored column entry is missing the column it names."), z.boolean()).optional(),
    sort: savedViewSortSchema.optional(),
    pageSize: z.int().min(1, "A stored page holds at least one row.").optional(),
  })
  .superRefine((query, context) => {
    for (const [facetId, values] of Object.entries(query.applied)) {
      const seen = new Set<string>();
      values.forEach((value, index) => {
        if (!seen.has(value)) {
          seen.add(value);
          return;
        }
        context.addIssue({ code: "custom", message: "Remove the repeated value from this filter.", path: ["applied", facetId, index] });
      });
    }
  }) satisfies z.ZodType<{ readonly search: string; readonly applied: Readonly<Record<string, readonly string[]>>; readonly columnVisibility?: RecordListQueryState["columnVisibility"]; readonly sort?: RosterSortAsStored; readonly pageSize?: number }>;
const savedViewIdSchema = z.string({ error: "A saved view is named by text, so choose the view again from the list." }).min(1, "An empty identifier names no saved view.");
const savedViewNameSchema = z.string({ error: "A view's name is text, so type the name this view should be saved under." }).refine((name) => name.trim() !== "", { error: "Give this view a name." });
export const saveViewPayloadSchema = z.strictObject({ name: savedViewNameSchema, queryState: savedViewQuerySchema, viewId: savedViewIdSchema.optional() });
export const renameViewPayloadSchema = z.strictObject({ viewId: savedViewIdSchema, name: savedViewNameSchema });
export const deleteViewPayloadSchema = z.strictObject({ viewId: savedViewIdSchema });
export type SaveViewPayload = z.infer<typeof saveViewPayloadSchema>;
export type RenameViewPayload = z.infer<typeof renameViewPayloadSchema>;
export type DeleteViewPayload = z.infer<typeof deleteViewPayloadSchema>;
export type SavedViewQuery = z.infer<typeof savedViewQuerySchema>;
type AdmittedFacet = { readonly id: string; readonly state?: "available" | "unavailable"; readonly options: ReadonlyArray<{ readonly id: string }> };
export type SavedViewDrift = { readonly state: "clean" } | { readonly state: "drifted"; readonly deadFacets: readonly string[]; readonly deadValues: readonly { readonly facet: string; readonly value: string }[]; readonly deadColumns: readonly string[] };
export function checkSavedViewDrift(query: { readonly applied: Readonly<Record<string, readonly string[]>>; readonly columnVisibility?: Readonly<Record<string, boolean>> }, admitted: { readonly facets: ReadonlyArray<AdmittedFacet>; readonly columns: ReadonlyArray<string> }): SavedViewDrift {
  const deadFacets: string[] = [];
  const deadValues: { facet: string; value: string }[] = [];
  const reported = new Set<string>();
  for (const [facetId, values] of Object.entries(query.applied)) {
    const facet = admitted.facets.find((candidate) => candidate.id === facetId);
    if (facet === undefined || facet.state === "unavailable" || facet.options.length === 0) {
      deadFacets.push(facetId);
      continue;
    }
    const offered = new Set(facet.options.map((option) => option.id));
    for (const value of values) {
      if (offered.has(value)) continue;
      const key = `${facetId}\u0000${value}`;
      if (reported.has(key)) continue;
      reported.add(key);
      deadValues.push({ facet: facetId, value });
    }
  }
  const deadColumns: string[] = [];
  for (const columnId of Object.keys(query.columnVisibility ?? {})) if (!admitted.columns.includes(columnId)) deadColumns.push(columnId);
  if (deadFacets.length === 0 && deadValues.length === 0 && deadColumns.length === 0) return { state: "clean" };
  return { state: "drifted", deadFacets, deadValues, deadColumns };
}
