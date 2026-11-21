/**
 * The Partners family's `saveView`, `renameView` and `deleteView` payload schemas, and the
 * repair-on-drift check the saved-view bar runs before it applies a stored view.
 *
 * This is the payload half of `{ operationId, scope, expectedRevision, payload }` only: the attempt
 * identity, the selected context and the expected revision are composed in
 * `../hooks/use-partner-mutations.ts`, so nothing here declares an operation, a scope or a revision,
 * reads a clock or reaches the service. The service's own schemas in
 * `modules/data-service/mutations/partners.ts` stay the authority and re-check everything; these
 * spare the worker a round trip for a mistake the form can already see, and give
 * `@/components/form-field` a field path for every refusal.
 *
 * The stored query is the query state the roster itself emits, so saving a view cannot store a filter
 * the surface could never have produced. `checkSavedViewDrift` is the other half of that promise: a
 * stored choice the current envelope no longer admits is reported with its parts named, so the bar
 * offers Repair instead of silently applying a filter that narrows nothing.
 *
 * A view stores choices and never records. No payload here names a partner, an audience, a consent, a
 * campaign or a notification, and renaming or deleting a view cannot reach a record.
 * (AAP 0.6.1 saved views; AAP 0.7.1 "Find and open a partner"; AAP 0.8.7 list page sizes;
 * AAP 0.10.1 saved views with Save, Update, Rename, Delete and repair-on-drift.)
 */
import { z } from "zod";

import type { RecordListQueryState } from "@/components/record-list";

// ---------------------------------------------------------------------------------------------
// The roster's pager
// ---------------------------------------------------------------------------------------------

/**
 * The two page sizes the partner roster's pager offers, smallest first: the release's 50-row default
 * and its 200-row ceiling (AAP 0.8.7).
 *
 * An option list for the control, never a validation bound. The read serves 50 when a request states
 * no size and clamps anything above 200, so a schema here that refused 201 would restate the same
 * rule more strictly, and would be the copy that goes stale when the read's rule changes.
 */
export const PARTNER_LIST_PAGE_SIZE_OPTIONS = [50, 200] as const;

// ---------------------------------------------------------------------------------------------
// Wording
//
// `../copy/{facets,privacy,states}.ts` carry this family's guidance and the outcome wording a
// surface shows; none of them words a schema refusal, so the sentences a field shows for a payload
// the form stopped live here, declared once and referenced by every rule that can raise one.
// ---------------------------------------------------------------------------------------------

/** The refusals these schemas state, each naming the value that was refused and what to do about it. */
const SAVED_VIEW_MESSAGES = {
  searchInvalid: "A saved view states the search text it was saved with, empty when it had none.",
  facetKeyEmpty: "A stored filter is missing the facet it belongs to.",
  facetValueInvalid: "A selected filter value is empty, so it matches nothing.",
  facetSelectionEmpty:
    "A selected filter needs at least one value; clear the facet instead of storing it empty.",
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

// ---------------------------------------------------------------------------------------------
// The choices a view stores
// ---------------------------------------------------------------------------------------------

/**
 * The values selected inside one facet, as the roster emits them and the service stores them.
 *
 * Non-empty by rule: a facet with no selected value is not a selection, and the service drops such an
 * entry when it stores one — refusing it here tells the worker rather than sending a member that
 * means nothing. The values are opaque identifiers the envelope admitted: untrimmed, and not checked
 * against a list, because a stored value naming a choice this context no longer offers is drift,
 * which {@link checkSavedViewDrift} reports and Repair resolves.
 */
export const savedViewFacetValuesSchema = z
  .array(z.string().min(1, SAVED_VIEW_MESSAGES.facetValueInvalid))
  .min(1, SAVED_VIEW_MESSAGES.facetSelectionEmpty);

/**
 * The direction a roster sort entry with this `desc` flag applies.
 *
 * Distributive, so the roster's `boolean` yields both directions rather than collapsing to one.
 */
type SortDirectionOf<Desc extends boolean> = Desc extends true ? "desc" : "asc";

/**
 * A stored sort in the roster's own vocabulary, derived from the table preset's query state so the
 * two cannot drift apart: the field is the column id the roster sorted by, and the direction is the
 * one its `desc` flag expresses. Used as a bound on the schema below, so a change to the roster's
 * sort entry stops this file compiling instead of leaving a stored sort the roster cannot restore.
 */
type RosterSortAsStored = {
  readonly field: RecordListQueryState["sort"][number]["id"];
  readonly direction: SortDirectionOf<RecordListQueryState["sort"][number]["desc"]>;
};

/**
 * One ordering a stored view keeps.
 *
 * A single entry rather than the table's array: the service payload states one ordering per view, and
 * the roster applies one sort at a time. The drift check below judges the selected filters and the
 * visible columns, which is the extent of what the saved-view read reports, so an ordering is stored
 * as it was chosen rather than being silently cleared here.
 */
export const savedViewSortSchema = z.strictObject({
  field: z.string().min(1, SAVED_VIEW_MESSAGES.sortFieldMissing),
  direction: z.enum(["asc", "desc"], SAVED_VIEW_MESSAGES.sortDirectionInvalid),
}) satisfies z.ZodType<RosterSortAsStored>;

/**
 * The stored choices in the roster's own vocabulary, used as a bound on the schema below.
 *
 * The visible-column map a view keeps is the roster's `ColumnVisibilityState` itself, and its sort is
 * the derived shape above, so a change to either of the roster's members stops this file compiling
 * instead of leaving a stored view the roster cannot restore. Filters are compared through the shape
 * the toolbar and the read both use rather than through the table's query state, which carries none:
 * the service filters, and the preset only presents the page it is given.
 */
type StoredQueryAsRosterState = {
  readonly search: string;
  readonly applied: Readonly<Record<string, readonly string[]>>;
  readonly columnVisibility?: RecordListQueryState["columnVisibility"];
  readonly sort?: RosterSortAsStored;
  readonly pageSize?: number;
};

/**
 * The choices a saved view stores, in the service payload's own members: the search text, the values
 * selected per facet, the visible columns and, when the roster's own page state is included, the
 * ordering and page size.
 *
 * `applied` is a map from facet key to selected values, which is the service's shape and not this
 * family's invention: one entry per facet is therefore structural — AND across facets — and the
 * values inside an entry combine with OR. A second entry for the same facet is not expressible in a
 * map at all, so the shape itself carries that half of the rule; a repeated value inside one entry is
 * expressible, and is refused below. A rename carries no `queryState` member at all, so it cannot
 * rewrite these choices.
 *
 * The facet keys are deliberately not an enum. The set the roster offers is whatever `readFacets`
 * admits in the current scope — the giving facets appear only with the authority to state them — so a
 * constant list here would be a second vocabulary that rejects a legitimate view in one context and
 * accepts an impossible one in another. Reproducibility is enforced by shape plus
 * {@link checkSavedViewDrift} against the admitted set, which is the repair-on-drift behaviour itself.
 *
 * `pageSize` accepts any positive whole number rather than repeating the service's ceiling. The
 * service states that bound once and answers a larger stored value as `invalid` instead of truncating
 * it, so its verdict is the one that counts and a copy here would be the one that goes stale.
 */
export const savedViewQuerySchema = z
  .strictObject({
    search: z.string({ error: SAVED_VIEW_MESSAGES.searchInvalid }),
    applied: z.record(
      z.string().min(1, SAVED_VIEW_MESSAGES.facetKeyEmpty),
      savedViewFacetValuesSchema,
    ),
    columnVisibility: z
      .record(z.string().min(1, SAVED_VIEW_MESSAGES.columnKeyEmpty), z.boolean())
      .optional(),
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

// ---------------------------------------------------------------------------------------------
// The payloads
// ---------------------------------------------------------------------------------------------

/**
 * The identifier of the saved view a change addresses.
 *
 * Opaque and untrimmed, for the reason the service states: an identifier is a value this application
 * mints, and silently repairing one would let a request act on a record it did not name. Only its
 * absence is refused, and the view's name is never its identity — two views may share a name.
 */
const savedViewIdSchema = z
  .string({ error: SAVED_VIEW_MESSAGES.viewIdInvalid })
  .min(1, SAVED_VIEW_MESSAGES.viewIdEmpty);

/**
 * The name a view carries: the text the worker typed, refused only when it holds nothing.
 *
 * The emptiness check is on the trimmed value and the value itself is not transformed, so "  Kept  "
 * saves exactly as it was typed instead of being silently rewritten. The length bound belongs to the
 * service, which states it once.
 */
const savedViewNameSchema = z
  .string({ error: SAVED_VIEW_MESSAGES.nameInvalid })
  .refine((name) => name.trim() !== "", { error: SAVED_VIEW_MESSAGES.nameEmpty });

/**
 * Validates the `saveView` payload: the name, the choices, and an existing view to replace.
 *
 * `viewId` present replaces that view the caller owns; absent saves a new one, which is the
 * Save/Update pair AAP 0.10.1 requires. The service payload names the choices `queryState`, and this
 * schema keeps that name so a payload built here is the payload the service reads. The expected
 * revision travels in the mutation input, not in the payload.
 *
 * No `audience`, `partnerIds`, `consent`, `campaign`, `notify` or `revision` member exists, and an
 * unrecognised key is refused rather than dropped: a view is a filter, never a recipient set.
 */
export const saveViewPayloadSchema = z.strictObject({
  name: savedViewNameSchema,
  queryState: savedViewQuerySchema,
  viewId: savedViewIdSchema.optional(),
});

/**
 * Validates the `renameView` payload: one view and its new name, and nothing else.
 *
 * The `queryState` member is deliberately absent, so a rename submitted with a filter attached is
 * refused rather than quietly rewriting the choices the view stores.
 */
export const renameViewPayloadSchema = z.strictObject({
  viewId: savedViewIdSchema,
  name: savedViewNameSchema,
});

/**
 * Validates the `deleteView` payload: the one view to remove.
 *
 * No `cascade`, `partnerIds` or "also clear the filters" member exists, because deleting a view
 * removes that view and touches no record, no tag and no note.
 */
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

// ---------------------------------------------------------------------------------------------
// Drift: what a stored view names that the envelope no longer admits
// ---------------------------------------------------------------------------------------------

/**
 * The choices a stored view holds, as any surface holding one states them.
 *
 * Structural and read-only on purpose: the stored form the read reports, a validated payload and the
 * toolbar's own draft all satisfy it, so the check below can judge a view the surface has in hand
 * without this module importing the read, calling the service or knowing whose envelope it came from.
 */
type StoredChoices = {
  readonly applied: Readonly<Record<string, readonly string[]>>;
  readonly columnVisibility?: Readonly<Record<string, boolean>>;
};

/**
 * One filter the current envelope admits, as `readFacets` reports it.
 *
 * `state` is `unavailable` when the source behind that facet did not answer — such a facet admits
 * nothing, exactly as an absent one admits nothing — and `options` are the values it now offers.
 * Absent `state` is read as available, so a caller with a plain list of facets may omit it.
 */
type AdmittedFacet = {
  readonly id: string;
  readonly state?: "available" | "unavailable";
  readonly options: ReadonlyArray<{ readonly id: string }>;
};

/** Everything the current envelope still admits: its facets and its configurable columns. */
type AdmittedChoices = {
  readonly facets: ReadonlyArray<AdmittedFacet>;
  readonly columns: ReadonlyArray<string>;
};

/**
 * What a stored view refers to that the current envelope no longer offers.
 *
 * A discriminated result rather than a boolean, because the bar has to say which part no longer
 * matches and repair only that part: a dead facet key, a value one facet stopped offering, and a
 * column the roster no longer has are three different repairs. The wording stays in this family's
 * copy module — this type carries the structure and no sentence.
 */
export type SavedViewDrift =
  | { readonly state: "clean" }
  | {
      readonly state: "drifted";
      /** Facet keys the envelope no longer offers, or offers without a usable value. */
      readonly deadFacets: readonly string[];
      /** Values a still-admitted facet no longer offers, each keeping the facet it belongs to. */
      readonly deadValues: readonly { readonly facet: string; readonly value: string }[];
      /** Column ids the roster no longer has, taken from the visibility map the view stores. */
      readonly deadColumns: readonly string[];
    };

/**
 * Reports which of a saved view's choices the current envelope no longer admits.
 *
 * Pure: no read, no store, no clock, no React and no fetch — the caller hands over the facets it is
 * holding, so the check runs while the bar renders and judges exactly the choices that surface would
 * offer. The judgement is the one the saved-view read applies to a stored view (an absent,
 * unavailable or empty facet is dead; a value outside its facet's options is dead; a visibility entry
 * naming no roster column is dead), so the surface and the read cannot disagree about the same view.
 * Nothing is dropped: a drifted view keeps every choice it holds, which is what lets a worker repair
 * it deliberately instead of finding that its filters quietly changed.
 */
export function checkSavedViewDrift(
  query: StoredChoices,
  admitted: AdmittedChoices,
): SavedViewDrift {
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
