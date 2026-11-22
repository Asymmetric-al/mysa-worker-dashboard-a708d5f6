"use client";
/**
 * Saved views for the Partners roster: the family's four operations — save, update, rename and delete — plus the
 * deliberate repair of a view whose stored choices this context no longer offers.
 *
 * The shared query toolbar draws the filter surface and cannot own these commands: a shared component may not import a
 * feature, so the mutations, the stored payload and the drift rule live here. A view that has drifted is never applied
 * as a dead filter and never discarded silently: the notice below the bar names each unavailable part and offers
 * Repair, which stores the same choices with only those parts dropped, or Delete.
 */
import { Fragment, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { BookmarkIcon, ChevronDownIcon, WrenchIcon } from "lucide-react";
import ActionReview from "@/components/action-review";
import { FormField, fieldErrorsFromInvalid, refusalSummary } from "@/components/form-field";
import OperationResult from "@/components/operation-result";
import StateNotice from "@/components/state-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";
import { assertNever } from "@/lib/result";
import type { ReadEnvelope, Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome, ReadResult } from "@/modules/data-service/outcome";
import { FACET_LABELS, FACET_VALUE_LABELS, type FacetKey } from "../copy/facets";
import { SAVED_VIEW_COPY } from "../copy/privacy";
import { PARTNER_ACTION_LABELS, SURFACE_STATE_COPY } from "../copy/states";
import { useDeleteView, useRenameView, useSaveView } from "../hooks/use-partner-mutations";
import { useRosterQuery, type RosterEnvelope, type RosterQueryState } from "../hooks/use-roster-query";
import { PARTNER_LIST_PAGE_SIZE_OPTIONS, checkSavedViewDrift, type DeleteViewPayload, type RenameViewPayload, type SaveViewPayload } from "../schemas/saved-view";
import { partnerColumnCatalogue, type PartnerColumn } from "./column-chooser";
import { buildPartnerFacetDescriptors, type PartnerFacetDescriptor } from "./partner-facets";

// The stored choices, and the shape a view is read in
/**
 * The choices one view stores, exactly as the roster's query is re-issued with them. `sort` and `pageSize` are optional
 * because a view may store neither; a read that projects only the search, the filters and the columns still satisfies
 * this shape, which is what lets the same drift rule judge a view the service returned and a view this surface holds.
 */
export interface SavedViewQueryState {
  readonly search: string;
  readonly applied: Readonly<Record<string, readonly string[]>>;
  readonly columnVisibility?: Readonly<Record<string, boolean>>;
  readonly sort?: { readonly field: string; readonly direction: "asc" | "desc" };
  readonly pageSize?: number;
}

/** One saved view as this bar needs it: what it is called, the choices it stores, and the revision those choices were read at. */
export interface SavedViewDefinition {
  readonly id: string;
  readonly name: string;
  /** The revision a change must present. A view read without one can be applied but not changed here. */
  readonly revision?: string;
  readonly query: SavedViewQueryState;
}

/** One filter the view selects that this context no longer admits at all. */
export interface DeadFacet {
  readonly facetId: string;
  readonly label: string;
}

/** One selected value inside a filter that is still admitted but no longer offers that value. */
export interface DeadValue {
  readonly facetId: string;
  readonly facetLabel: string;
  readonly valueId: string;
  readonly label: string;
}

/** One stored column the roster's catalogue no longer carries. */
export interface DeadColumn {
  readonly columnId: string;
  readonly label: string;
}

/**
 * What a stored view would have to drop to match what this context offers, with every unavailable part named as the
 * worker reads it, and the choices a repair would store.
 */
export interface ViewDrift {
  readonly drifted: boolean;
  readonly deadFacets: readonly DeadFacet[];
  readonly deadValues: readonly DeadValue[];
  readonly deadColumns: readonly DeadColumn[];
  /** The stored page size when the roster no longer offers it, otherwise `null`. */
  readonly pageSize: number | null;
  /** The choices a repair stores: only the parts above dropped, with the search, the surviving values, the sort and the visible columns kept. */
  readonly repaired: SaveViewPayload["queryState"];
}

// Naming an unavailable part by what it showed, not by the key it was stored under
function isFacetKey(identifier: string): identifier is FacetKey {
  return Object.prototype.hasOwnProperty.call(FACET_LABELS, identifier);
}

/** The label of a filter: the admitted filter's own wording, the family's wording for a filter that is gone, else the stored key. */
function facetLabelOf(facetId: string, admittedFacets: readonly PartnerFacetDescriptor[]): string {
  const admitted = admittedFacets.find((facet) => facet.id === facetId);
  if (admitted !== undefined) {
    return admitted.label;
  }
  return isFacetKey(facetId) ? FACET_LABELS[facetId] : facetId;
}

/** The label of one value: what the filter offered it as, the family's wording for a closed set, else the stored value. */
function valueLabelOf(facetId: string, valueId: string, admittedFacets: readonly PartnerFacetDescriptor[]): string {
  const admitted = admittedFacets.find((facet) => facet.id === facetId);
  const offered = admitted === undefined ? undefined : admitted.values.find((value) => value.id === valueId);
  if (offered !== undefined) {
    return offered.label;
  }
  const named = isFacetKey(facetId) ? FACET_VALUE_LABELS[facetId][valueId] : undefined;
  return named ?? valueId;
}

/** The label of a column: the catalogue's own name, else the key the stored set carries. */
function columnLabelOf(columnId: string, catalogue: readonly PartnerColumn[]): string {
  const catalogued = catalogue.find((column) => column.key === columnId);
  return catalogued === undefined ? columnId : catalogued.displayName;
}

/** The stored page size when the roster no longer offers it, and `null` when it states none or states an offered one. */
function pageSizeDriftOf(pageSize: number | undefined): number | null {
  if (pageSize === undefined) {
    return null;
  }
  return PARTNER_LIST_PAGE_SIZE_OPTIONS.some((option) => option === pageSize) ? null : pageSize;
}

interface DeadParts {
  readonly deadFacets: readonly DeadFacet[];
  readonly deadValues: readonly DeadValue[];
  readonly deadColumns: readonly DeadColumn[];
  readonly dropPageSize: boolean;
}

/** The choices a repair stores: the same search, sort, visible columns and page size, minus exactly the parts that are unavailable. */
function repairedQueryOf(query: SavedViewQueryState, dead: DeadParts): SaveViewPayload["queryState"] {
  const deadFacetIds = new Set(dead.deadFacets.map((facet) => facet.facetId));
  const deadValueKeys = new Set(dead.deadValues.map((value) => `${value.facetId}\u0000${value.valueId}`));
  const applied: Record<string, string[]> = {};
  for (const [facetId, values] of Object.entries(query.applied)) {
    if (deadFacetIds.has(facetId)) {
      continue;
    }
    const kept = values.filter((value) => !deadValueKeys.has(`${facetId}\u0000${value}`));
    if (kept.length > 0) {
      applied[facetId] = [...kept];
    }
  }
  const columnVisibility: Record<string, boolean> = {};
  const deadColumnIds = new Set(dead.deadColumns.map((column) => column.columnId));
  for (const [columnId, visible] of Object.entries(query.columnVisibility ?? {})) {
    if (!deadColumnIds.has(columnId)) {
      columnVisibility[columnId] = visible;
    }
  }
  return {
    search: query.search,
    applied,
    ...(Object.keys(columnVisibility).length === 0 ? {} : { columnVisibility }),
    ...(query.sort === undefined ? {} : { sort: { field: query.sort.field, direction: query.sort.direction } }),
    ...(query.pageSize === undefined || dead.dropPageSize ? {} : { pageSize: query.pageSize }),
  };
}

/**
 * The drift a stored view carries against the filters, values and columns this context admits, and the choices a repair
 * would store. A filter that is no longer admitted is reported once rather than value by value, because naming its
 * values would suggest the filter still works and only its values changed.
 */
export function detectViewDrift(view: SavedViewDefinition, admittedFacets: readonly PartnerFacetDescriptor[], catalogue: readonly PartnerColumn[] = partnerColumnCatalogue): ViewDrift {
  const checked = checkSavedViewDrift(
    { applied: view.query.applied, ...(view.query.columnVisibility === undefined ? {} : { columnVisibility: view.query.columnVisibility }) },
    { facets: admittedFacets.map((facet) => ({ id: facet.id, state: facet.disabledReason === undefined ? "available" : "unavailable", options: facet.values.map((value) => ({ id: value.id })) })), columns: catalogue.map((column) => column.key) },
  );
  const deadFacets: DeadFacet[] = [];
  const deadValues: DeadValue[] = [];
  const deadColumns: DeadColumn[] = [];
  if (checked.state === "drifted") {
    for (const facetId of checked.deadFacets) {
      deadFacets.push({ facetId, label: facetLabelOf(facetId, admittedFacets) });
    }
    for (const dead of checked.deadValues) {
      deadValues.push({ facetId: dead.facet, facetLabel: facetLabelOf(dead.facet, admittedFacets), valueId: dead.value, label: valueLabelOf(dead.facet, dead.value, admittedFacets) });
    }
    for (const columnId of checked.deadColumns) {
      deadColumns.push({ columnId, label: columnLabelOf(columnId, catalogue) });
    }
  }
  const pageSize = pageSizeDriftOf(view.query.pageSize);
  const drifted = deadFacets.length > 0 || deadValues.length > 0 || deadColumns.length > 0 || pageSize !== null;
  return { drifted, deadFacets, deadValues, deadColumns, pageSize, repaired: repairedQueryOf(view.query, { deadFacets, deadValues, deadColumns, dropPageSize: pageSize !== null }) };
}

/** Every unavailable part of one drifted view, in the words of the copy beside it: a filter, a value inside one, a column, or a page size. */
function unavailablePartsOf(drift: ViewDrift): readonly string[] {
  const parts: string[] = [];
  for (const facet of drift.deadFacets) {
    parts.push(`${SAVED_VIEW_PART_COPY.filter}: ${facet.label}`);
  }
  for (const value of drift.deadValues) {
    parts.push(`${SAVED_VIEW_PART_COPY.value(value.facetLabel)}: ${value.label}`);
  }
  for (const column of drift.deadColumns) {
    parts.push(`${SAVED_VIEW_PART_COPY.column}: ${column.label}`);
  }
  if (drift.pageSize !== null) {
    parts.push(`${SAVED_VIEW_PART_COPY.pageSize}: ${String(drift.pageSize)}`);
  }
  return parts;
}

/** The choices the roster's query holds now, in the shape one view stores: every empty selection left out, as the payload schema requires, and a page size recorded only when the roster offers it. */
function storedChoicesOf(query: RosterQueryState): SaveViewPayload["queryState"] {
  const applied: Record<string, string[]> = {};
  for (const [facetId, values] of Object.entries(query.facets)) {
    if (values.length > 0) {
      applied[facetId] = [...values];
    }
  }
  const columnVisibility: Record<string, boolean> = {};
  for (const [columnId, visible] of Object.entries(query.columnVisibility)) {
    columnVisibility[columnId] = visible;
  }
  // A page size the roster does not offer is not stored, because storing it would make a fresh view need repair at once.
  const storedPageSize = pageSizeDriftOf(query.pageSize) === null ? query.pageSize : undefined;
  return { search: query.search, applied, ...(Object.keys(columnVisibility).length === 0 ? {} : { columnVisibility }), ...(query.sort === null ? {} : { sort: { field: query.sort.field, direction: query.sort.direction } }), ...(storedPageSize === undefined ? {} : { pageSize: storedPageSize }) };
}

/** Whether the choices on screen are the ones this view stores, which is what "in use" states and nothing more. */
function viewIsInUse(view: SavedViewQueryState, query: RosterQueryState): boolean {
  if (view.search.trim() !== query.search.trim() || !sameSelection(view.applied, query.facets)) {
    return false;
  }
  if (view.columnVisibility === undefined) {
    return true;
  }
  const stored = Object.entries(view.columnVisibility);
  return stored.every(([columnId, visible]) => query.columnVisibility[columnId] === visible);
}

/** Whether two selections name the same values per filter, under any order. */
function sameSelection(left: Readonly<Record<string, readonly string[]>>, right: Readonly<Record<string, readonly string[]>>): boolean {
  const leftKeys = Object.keys(left).filter((key) => (left[key] ?? []).length > 0);
  const rightKeys = Object.keys(right).filter((key) => (right[key] ?? []).length > 0);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key) => {
    const mine = left[key] ?? [];
    const theirs = right[key];
    return theirs !== undefined && mine.length === theirs.length && mine.every((value) => theirs.includes(value));
  });
}

// Wording this surface states, built on the family's own copy
const SAVED_VIEW_PART_COPY = { filter: "Filter", value: (facet: string): string => `Value in the ${facet} filter`, column: "Column", pageSize: "Rows per page" } as const;

const SAVED_VIEW_BAR_COPY = {
  trigger: "Saved views",
  triggerName: (repairCount: number): string => (repairCount === 0 ? "Saved views" : `Saved views, ${String(repairCount)} needs repair`),
  loading: "Reading your saved views.",
  empty: "No view is stored for this roster yet. Save the choices on screen to keep them.",
  unavailableNow: "Unavailable in this context now:",
  needsRepair: "Needs repair",
  driftUnknown: "The filters this context offers have not been read, so a stored view cannot be checked against them and is not applied until they are.",
  apply: "Apply",
  update: "Update with the choices on screen",
  rename: "Rename",
  delete: "Delete",
  saveCurrent: "Save current view",
  saveNameLabel: "Name this view",
  renameNameLabel: "New name",
  saveSubmit: "Save view",
  renameSubmit: "Save name",
  cancel: "Cancel",
  working: "Saving once. The receipt appears below when the partner source answers.",
  saveOperation: "Saved view",
  updateOperation: "Updated view",
  repairOperation: "Repaired view",
  renameOperation: "Renamed view",
  checkResult: "Check the result",
  outageTitle: "This change did not reach the source",
  outageBody: "The stored view is as it was: the request did not arrive, so nothing about its choices changed.",
  unconfirmedTitle: "This change is not confirmed",
  browseOnly: "This context admits reading a stored view and not changing one, so no view is saved, renamed or deleted here.",
} as const;

/** The heading level every receipt and notice inside the bar renders at, under the roster's own page heading. */
const RECEIPT_HEADING_LEVEL = 3;

/** The longest name the stored-view schemas and the service accept, restated so the field stops where the schema does. */
const VIEW_NAME_MAX_LENGTH = 80;

/**
 * The path segment the three saved-view mutations travel under. The route awaits this segment and reads it as the
 * placement of a saved-view change, never as a view's identity, so it names the surface the view belongs to.
 */
const SAVED_VIEW_ROUTE_SEGMENT = "roster";

const SAVE_FIELD_LABELS: Readonly<Record<string, string>> = { name: "View name", viewId: "View", queryState: "Stored choices", "queryState.search": "Search text", "queryState.applied": "Selected filters", "queryState.pageSize": "Rows per page" };

const RENAME_FIELD_LABELS: Readonly<Record<string, string>> = { name: "View name", viewId: "View" };

const DELETE_FIELD_LABELS: Readonly<Record<string, string>> = { viewId: "View" };

// The receipt for one settled change
/** The four operations this file performs, named once so a receipt can state which one it records. */
type SavedViewOperation = "save" | "update" | "repair" | "rename";

const OPERATION_CAPTION: Readonly<Record<SavedViewOperation, string>> = { save: SAVED_VIEW_BAR_COPY.saveOperation, update: SAVED_VIEW_BAR_COPY.updateOperation, repair: SAVED_VIEW_BAR_COPY.repairOperation, rename: SAVED_VIEW_BAR_COPY.renameOperation };

/**
 * The line above a receipt: which operation settled, on which view. A refusal states the operation alone, because a
 * denial may not name, count or hint at anything the caller is not admitted to see.
 */
function ReceiptCaption({ operation, viewName, outcome }: { readonly operation: SavedViewOperation; readonly viewName: string; readonly outcome: MutationOutcome }): ReactElement {
  const label = OPERATION_CAPTION[operation];
  if (outcome.outcome === "denied") {
    return <p className="text-sm font-medium text-muted-foreground">{label}</p>;
  }
  return (
    <p className="text-sm font-medium text-muted-foreground">
      {label}: <bdi className="wrap-anywhere">{viewName}</bdi>
    </p>
  );
}

interface OutcomeReceiptProps {
  readonly operation: SavedViewOperation;
  readonly viewName: string;
  readonly outcome: MutationOutcome;
  readonly onCheckResult: () => void;
  readonly onRetrySameWork: () => void;
  readonly onReapply: (currentRevision: string) => void;
  readonly fieldLabels: Readonly<Record<string, string>>;
}

/**
 * One settled change, stated as exactly one outcome. The three answers that carry no result of their own read as
 * notices — a refusal names nothing, an outage names its source, an unconfirmed change names its operation identity —
 * and the five that carry a result read through the one receipt pattern.
 */
function OutcomeReceipt({ operation, viewName, outcome, onCheckResult, onRetrySameWork, onReapply, fieldLabels }: OutcomeReceiptProps): ReactElement {
  switch (outcome.outcome) {
    case "denied":
      return (
        <>
          <ReceiptCaption operation={operation} viewName={viewName} outcome={outcome} />
          <StateNotice kind="denied" title={SURFACE_STATE_COPY["saved-view"].denied.title} description={SURFACE_STATE_COPY["saved-view"].denied.body} reasonCode={outcome.reasonCode} headingLevel={RECEIPT_HEADING_LEVEL} />
        </>
      );
    case "unavailable":
      // Retrying re-sends this same operation, so a change that had already been applied comes back as its own result.
      return (
        <>
          <ReceiptCaption operation={operation} viewName={viewName} outcome={outcome} />
          <StateNotice kind="unavailable" title={SAVED_VIEW_BAR_COPY.outageTitle} description={SAVED_VIEW_BAR_COPY.outageBody} source={outcome.source} retry={{ label: PARTNER_ACTION_LABELS.retry, onClick: onRetrySameWork }} headingLevel={RECEIPT_HEADING_LEVEL} />
        </>
      );
    case "unknown":
      return (
        <>
          <ReceiptCaption operation={operation} viewName={viewName} outcome={outcome} />
          <StateNotice kind="unknown" title={SAVED_VIEW_BAR_COPY.unconfirmedTitle} operationId={outcome.operationId} action={{ label: SAVED_VIEW_BAR_COPY.checkResult, onClick: onCheckResult }} headingLevel={RECEIPT_HEADING_LEVEL} />
        </>
      );
    case "accepted":
    case "alreadyAccepted":
    case "unchanged":
    case "conflict":
    case "invalid":
      return (
        <>
          <ReceiptCaption operation={operation} viewName={viewName} outcome={outcome} />
          <OperationResult outcome={outcome} headingLevel={RECEIPT_HEADING_LEVEL} onCheckResult={onCheckResult} onRetrySameWork={onRetrySameWork} onReapply={outcome.outcome === "conflict" ? () => onReapply(outcome.currentRevision) : undefined} fieldLabels={fieldLabels} />
        </>
      );
    default:
      return assertNever(outcome, "Unhandled saved-view outcome");
  }
}

// One view in the menu
interface ViewMenuSectionProps {
  readonly view: SavedViewDefinition;
  /** The drift this view carries, or `null` while the filters that would judge it have not been read. */
  readonly drift: ViewDrift | null;
  readonly inUse: boolean;
  readonly canWrite: boolean;
  readonly busy: boolean;
  readonly driftNoteId: string;
  readonly onApply: (choices: SaveViewPayload["queryState"]) => void;
  readonly onUpdate: (view: SavedViewDefinition) => void;
  readonly onRename: (view: SavedViewDefinition) => void;
  readonly onRepair: (view: SavedViewDefinition, drift: ViewDrift) => void;
  readonly onDelete: (view: SavedViewDefinition) => void;
}

/**
 * One saved view and the four things that can be done with it. Applying is refused while the view has drifted or while
 * the filters that would judge it are unread, so a dead filter is never run and never silently discarded; a view read
 * without a revision can be applied but not changed, because a change must present the revision it saw.
 */
function ViewMenuSection({ view, drift, inUse, canWrite, busy, driftNoteId, onApply, onUpdate, onRename, onRepair, onDelete }: ViewMenuSectionProps): ReactElement {
  const drifted = drift !== null && drift.drifted;
  const changeable = canWrite && view.revision !== undefined;
  const applyBlocked = busy || drift === null || drifted;
  const itemClass = "h-auto min-h-8 whitespace-normal";
  return (
    <Fragment>
      <DropdownMenuLabel className="flex flex-wrap items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          <bdi>{view.name}</bdi>
        </span>
        {inUse ? <Badge variant="secondary">In use</Badge> : null}
        {drifted ? <Badge variant="outline">{SAVED_VIEW_BAR_COPY.needsRepair}</Badge> : null}
      </DropdownMenuLabel>
      <DropdownMenuItem
        className={itemClass}
        disabled={applyBlocked}
        aria-describedby={applyBlocked && drift === null ? driftNoteId : undefined}
        aria-label={`${SAVED_VIEW_BAR_COPY.apply}: ${view.name}`}
        onClick={() => {
          if (drift !== null) onApply(drift.repaired);
        }}
      >
        {SAVED_VIEW_BAR_COPY.apply}
      </DropdownMenuItem>
      {changeable ? (
        <DropdownMenuItem className={itemClass} disabled={busy} aria-label={`${SAVED_VIEW_BAR_COPY.update}: ${view.name}`} onClick={() => onUpdate(view)}>
          {SAVED_VIEW_BAR_COPY.update}
        </DropdownMenuItem>
      ) : null}
      {changeable ? (
        <DropdownMenuItem className={itemClass} disabled={busy} aria-label={`${SAVED_VIEW_BAR_COPY.rename}: ${view.name}`} onClick={() => onRename(view)}>
          {SAVED_VIEW_BAR_COPY.rename}
        </DropdownMenuItem>
      ) : null}
      {changeable && drift !== null && drifted ? (
        <DropdownMenuItem className={itemClass} disabled={busy} aria-label={`${SAVED_VIEW_COPY.repair.title}: ${view.name}`} onClick={() => onRepair(view, drift)}>
          {SAVED_VIEW_COPY.repair.title}
        </DropdownMenuItem>
      ) : null}
      {changeable ? (
        <DropdownMenuItem className={itemClass} variant="destructive" disabled={busy} aria-label={`${SAVED_VIEW_BAR_COPY.delete}: ${view.name}`} onClick={() => onDelete(view)}>
          {SAVED_VIEW_BAR_COPY.delete}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuSeparator />
    </Fragment>
  );
}

// The name of a view
/** Which operation the name dialog is collecting a name for, so one dialog serves Save and Rename without a second field. */
type NamePanel = { readonly mode: "save" } | { readonly mode: "rename"; readonly view: SavedViewDefinition };

interface NameViewDialogProps {
  readonly panel: NamePanel | null;
  readonly name: string;
  readonly error: string | readonly string[] | undefined;
  readonly pending: boolean;
  readonly onNameChange: (next: string) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}

/**
 * The one field that names a view. The dialog moves focus into the field and returns it to the saved-view trigger when
 * it closes, and a refused name leaves the dialog open with the typed name and the schema's own message beside it, so
 * nothing typed has to be entered twice.
 */
function NameViewDialog({ panel, name, error, pending, onNameChange, onSubmit, onCancel }: NameViewDialogProps): ReactElement {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const renaming = panel?.mode === "rename";
  return (
    <Dialog
      open={panel !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent initialFocus={() => inputRef.current}>
        <DialogHeader>
          <DialogTitle>{renaming ? SAVED_VIEW_COPY.rename.title : SAVED_VIEW_COPY.save.title}</DialogTitle>
          <DialogDescription>{renaming ? SAVED_VIEW_COPY.rename.body : SAVED_VIEW_COPY.save.body}</DialogDescription>
        </DialogHeader>
        <form
          className="flex min-w-0 flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <FormField name="name" label={renaming ? SAVED_VIEW_BAR_COPY.renameNameLabel : SAVED_VIEW_BAR_COPY.saveNameLabel} error={error} required>
            {(field) => (
              <Input
                ref={inputRef}
                id={field.id}
                value={name}
                maxLength={VIEW_NAME_MAX_LENGTH}
                autoComplete="off"
                disabled={pending}
                aria-describedby={field.describedBy}
                aria-invalid={field.invalid ? true : undefined}
                onChange={(event) => {
                  onNameChange(event.target.value);
                }}
              />
            )}
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
              {SAVED_VIEW_BAR_COPY.cancel}
            </Button>
            <Button type="submit" disabled={pending || name.trim() === ""}>
              {pending ? <Spinner /> : null}
              {renaming ? SAVED_VIEW_BAR_COPY.renameSubmit : SAVED_VIEW_BAR_COPY.saveSubmit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// The component
/** Props of {@link SavedViewBar}. */
export interface SavedViewBarProps {
  /** The authority every saved-view change is made in: the service re-derives it from the session and re-checks it on submit. */
  readonly scope: Scope;
  /** The columns the roster itself admits. The same keys are given to the one URL parser, so this bar and the roster read one query state rather than two. */
  readonly admittedColumnKeys?: readonly string[];
  /**
   * The answer the composing route already read for this same scope and view, handed on exactly as the roster receives
   * it. This bar composes the same roster query for the query state and the views it stores, so it is a second observer
   * of that one cache entry: without the seed its own mount would turn the route's answer back into the identical read
   * the seed exists to avoid, and with it the entry stands as the server read it.
   */
  readonly initialResult?: ReadResult<RosterEnvelope>;
  readonly className?: string;
}

/** One saved view with the drift it carries, or `null` while the filters that would judge it have not been read. */
interface ViewEntry {
  readonly view: SavedViewDefinition;
  readonly drift: ViewDrift | null;
}

/** The envelope a read answered with, or `null` for a read that has not answered, was refused or found its source down. */
function envelopeOf<T>(result: ReadResult<ReadEnvelope<T>> | undefined): ReadEnvelope<T> | null {
  return result !== undefined && result.kind === "envelope" ? result.envelope : null;
}

/**
 * The Partners roster's saved-view surface: save the choices on screen under a name, replace them, rename the view,
 * delete it, and repair one whose stored choices this context no longer offers.
 *
 * The query state stays the roster's own — it is read from the URL by the same hook the roster uses, and applying a
 * view writes it back there — so no selection is kept in a cookie, a storage key or a second copy here. Every change
 * carries the revision the view was read at, and one attempt identity per intent: a retry of the same rename or delete
 * replays it, while a changed intent, a repair included, is a new operation.
 */
export default function SavedViewBar({ scope, admittedColumnKeys, initialResult, className }: SavedViewBarProps): ReactElement {
  const roster = useRosterQuery(scope, admittedColumnKeys === undefined ? {} : { admittedColumnKeys }, initialResult);
  const saveView = useSaveView(SAVED_VIEW_ROUTE_SEGMENT);
  const renameView = useRenameView(SAVED_VIEW_ROUTE_SEGMENT);
  const deleteView = useDeleteView(SAVED_VIEW_ROUTE_SEGMENT);
  const [panel, setPanel] = useState<NamePanel | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<SavedViewDefinition | null>(null);
  const [saveOperation, setSaveOperation] = useState<{ readonly kind: "save" | "update" | "repair"; readonly viewName: string } | null>(null);
  const [renameOperation, setRenameOperation] = useState<{ readonly viewName: string } | null>(null);
  const driftNoteId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const saveReceiptRef = useRef<HTMLDivElement | null>(null);
  const renameReceiptRef = useRef<HTMLDivElement | null>(null);
  const deleteReviewRef = useRef<HTMLDivElement | null>(null);
  // The attempt each form last sent, kept so a retry replays it under its own identity and a conflict can re-apply it.
  const saveAttemptRef = useRef<{ readonly expectedRevision: string; readonly payload: SaveViewPayload } | null>(null);
  const renameAttemptRef = useRef<{ readonly expectedRevision: string; readonly payload: RenameViewPayload } | null>(null);
  const savedViewsResult = roster.savedViews.data;
  const savedViews = envelopeOf(savedViewsResult);
  const facetsEnvelope = envelopeOf(roster.facets.data);
  // Derived on every render rather than memoised: the work is one short pass over the admitted filters and the stored
  // views, and a memo keyed on objects the caller recreates each render would recompute anyway.
  const descriptors = buildPartnerFacetDescriptors(facetsEnvelope, { applied: roster.query.facets });
  // A filter set that has not answered cannot judge a view, and guessing that a view is clean would run a dead filter.
  const driftKnown = facetsEnvelope !== null;
  const saveAction = savedViews === null ? undefined : savedViews.actions.find((action) => action.name === "saveView");
  const canWrite = saveAction !== undefined && saveAction.available;
  const withheldReason = saveAction === undefined || saveAction.available ? "" : (saveAction.reason?.trim() ?? "");
  const entries: readonly ViewEntry[] = savedViews === null ? [] : savedViews.data.map((view) => ({ view, drift: driftKnown ? detectViewDrift(view, descriptors) : null }));
  const driftedEntries = entries.filter((entry): entry is ViewEntry & { readonly drift: ViewDrift } => entry.drift !== null && entry.drift.drifted);
  const busy = saveView.isPending || renameView.isPending || deleteView.isPending;
  // A settled change is the record of what happened, so the keyboard position follows it instead of resting on a control
  // that may no longer exist.
  useEffect(() => {
    if (saveView.outcome !== null) {
      saveReceiptRef.current?.focus();
    }
  }, [saveView.outcome]);
  useEffect(() => {
    if (renameView.outcome !== null) {
      renameReceiptRef.current?.focus();
    }
  }, [renameView.outcome]);
  useEffect(() => {
    if (deleteTarget !== null) {
      deleteReviewRef.current?.focus();
    }
  }, [deleteTarget]);
  const checkResult = (): void => {
    void roster.savedViews.refetch();
  };
  function openSave(): void {
    // Opening a form begins a new entry, so the identity and the receipt of an earlier attempt are released.
    saveView.reset();
    setNameDraft("");
    setPanel({ mode: "save" });
  }
  function openRename(view: SavedViewDefinition): void {
    renameView.reset();
    setNameDraft(view.name);
    setPanel({ mode: "rename", view });
  }
  function closePanel(): void {
    setPanel(null);
    // The dialog opens from the saved-view trigger, so the keyboard position returns to that control rather than to a
    // document position whose place in the page has changed.
    triggerRef.current?.focus();
  }
  /** The choices an applied view writes back into the roster's URL: what the view stores, and nothing it does not state. */
  function applyChoices(choices: SaveViewPayload["queryState"]): void {
    const facets: Record<string, readonly string[]> = {};
    for (const [facetId, values] of Object.entries(choices.applied)) {
      facets[facetId] = [...values];
    }
    roster.setQuery({
      search: choices.search,
      facets,
      ...(choices.sort === undefined ? {} : { sort: { field: choices.sort.field, direction: choices.sort.direction } }),
      ...(choices.pageSize === undefined ? {} : { pageSize: choices.pageSize }),
      ...(choices.columnVisibility === undefined ? {} : { columnVisibility: choices.columnVisibility }),
    });
  }
  async function submitName(): Promise<void> {
    const name = nameDraft.trim();
    if (panel === null || name === "" || saveView.isPending || renameView.isPending) {
      return;
    }
    if (panel.mode === "save") {
      if (savedViews === null) {
        return;
      }
      // A new view compares no revision, so the token presented is the revision of the list this form was opened from.
      const attempt = { expectedRevision: savedViews.revision, payload: { name, queryState: storedChoicesOf(roster.query) } };
      saveAttemptRef.current = attempt;
      setSaveOperation({ kind: "save", viewName: name });
      const outcome = await saveView.submit({ scope, expectedRevision: attempt.expectedRevision, payload: attempt.payload });
      // A refused name keeps the dialog open with the text that was typed and the field message beside it.
      if (outcome.outcome !== "invalid") {
        closePanel();
      }
      return;
    }
    const target = panel.view;
    if (target.revision === undefined) {
      return;
    }
    const attempt = { expectedRevision: target.revision, payload: { viewId: target.id, name } };
    renameAttemptRef.current = attempt;
    setRenameOperation({ viewName: name });
    const outcome = await renameView.submit({ scope, expectedRevision: attempt.expectedRevision, payload: attempt.payload });
    if (outcome.outcome !== "invalid") {
      closePanel();
    }
  }
  async function updateView(view: SavedViewDefinition): Promise<void> {
    if (view.revision === undefined || saveView.isPending) {
      return;
    }
    const payload = { viewId: view.id, name: view.name, queryState: storedChoicesOf(roster.query) };
    saveAttemptRef.current = { expectedRevision: view.revision, payload };
    setSaveOperation({ kind: "update", viewName: view.name });
    await saveView.submit({ scope, expectedRevision: view.revision, payload });
  }
  async function repairView(view: SavedViewDefinition, drift: ViewDrift): Promise<void> {
    if (view.revision === undefined || saveView.isPending) {
      return;
    }
    // A repair stores different choices, so it is a changed intent: the mutation hook mints it a new attempt identity,
    // and repeating the same repair replays that one rather than saving the view twice.
    const payload = { viewId: view.id, name: view.name, queryState: drift.repaired };
    saveAttemptRef.current = { expectedRevision: view.revision, payload };
    setSaveOperation({ kind: "repair", viewName: view.name });
    await saveView.submit({ scope, expectedRevision: view.revision, payload });
  }
  function startDelete(view: SavedViewDefinition): void {
    closePanel();
    deleteView.reset();
    setDeleteTarget(view);
  }
  // Recovery of a save: the same attempt replayed under its own identity, or the caller's input re-applied against the
  // revision the conflict reports. Neither path mints a second identity for one intent.
  const replaySave = (): void => {
    const attempt = saveAttemptRef.current;
    if (attempt !== null) {
      void saveView.submit({ scope, expectedRevision: attempt.expectedRevision, payload: attempt.payload });
    }
  };
  const reapplySave = (revision: string): void => {
    const attempt = saveAttemptRef.current;
    if (attempt !== null) {
      void saveView.submit({ scope, expectedRevision: revision, payload: attempt.payload });
    }
  };
  const replayRename = (): void => {
    const attempt = renameAttemptRef.current;
    if (attempt !== null) {
      void renameView.submit({ scope, expectedRevision: attempt.expectedRevision, payload: attempt.payload });
    }
  };
  const reapplyRename = (revision: string): void => {
    const attempt = renameAttemptRef.current;
    if (attempt !== null) {
      void renameView.submit({ scope, expectedRevision: revision, payload: attempt.payload });
    }
  };
  const nameOutcome = panel?.mode === "rename" ? renameView.outcome : saveView.outcome;
  const nameErrors = nameOutcome !== null && nameOutcome.outcome === "invalid" ? fieldErrorsFromInvalid(nameOutcome).byField["name"] : undefined;
  /** The trigger, or the reason this context offers no view list at all — never an empty list standing in for a failed read. */
  function renderControl(): ReactNode {
    if (savedViewsResult === undefined) {
      return (
        <Button type="button" variant="outline" size="sm" className="max-w-full" disabled aria-busy="true">
          <Spinner />
          <span className="truncate">{SAVED_VIEW_BAR_COPY.trigger}</span>
          <span className="sr-only">{SAVED_VIEW_BAR_COPY.loading}</span>
        </Button>
      );
    }
    switch (savedViewsResult.kind) {
      case "envelope":
        return (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button ref={triggerRef} type="button" variant="outline" size="sm" className="max-w-full" aria-label={SAVED_VIEW_BAR_COPY.triggerName(driftedEntries.length)} />}>
              <BookmarkIcon aria-hidden="true" className="size-3.5" />
              <span className="truncate">{SAVED_VIEW_BAR_COPY.trigger}</span>
              {driftedEntries.length === 0 ? null : (
                <Badge variant="outline" aria-hidden="true" className="h-5 min-w-5 justify-center px-1 tabular-figures">
                  {String(driftedEntries.length)}
                </Badge>
              )}
              <ChevronDownIcon aria-hidden="true" className="size-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
              <DropdownMenuLabel className="text-sm text-foreground">{SAVED_VIEW_BAR_COPY.trigger}</DropdownMenuLabel>
              <p className="px-3 pb-2 text-xs leading-snug text-muted-foreground">{SAVED_VIEW_COPY.leavesRecordsAlone.body}</p>
              {entries.length > 0 ? null : <p className="px-3 pb-2 text-xs leading-snug text-muted-foreground">{SAVED_VIEW_BAR_COPY.empty}</p>}
              {entries.length > 0 && !driftKnown ? (
                <p id={driftNoteId} className="px-3 pb-2 text-xs leading-snug text-muted-foreground">
                  {SAVED_VIEW_BAR_COPY.driftUnknown}
                </p>
              ) : null}
              {entries.length === 0 ? null : <DropdownMenuSeparator />}
              {entries.map((entry) => (
                <ViewMenuSection
                  key={entry.view.id}
                  view={entry.view}
                  drift={entry.drift}
                  inUse={viewIsInUse(entry.view.query, roster.query)}
                  canWrite={canWrite}
                  busy={busy}
                  driftNoteId={driftNoteId}
                  onApply={applyChoices}
                  onUpdate={(view) => {
                    void updateView(view);
                  }}
                  onRename={openRename}
                  onRepair={(view, drift) => {
                    void repairView(view, drift);
                  }}
                  onDelete={startDelete}
                />
              ))}
              {canWrite ? (
                <DropdownMenuItem className="h-auto min-h-8 whitespace-normal" disabled={busy} onClick={openSave}>
                  {SAVED_VIEW_BAR_COPY.saveCurrent}
                </DropdownMenuItem>
              ) : (
                <p className="px-3 py-2 text-xs leading-snug text-muted-foreground">{withheldReason === "" ? SAVED_VIEW_BAR_COPY.browseOnly : withheldReason}</p>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      case "denied":
        return <StateNotice kind="denied" title={SURFACE_STATE_COPY["saved-view"].denied.title} description={SURFACE_STATE_COPY["saved-view"].denied.body} reasonCode={savedViewsResult.denied.reasonCode} headingLevel={RECEIPT_HEADING_LEVEL} />;
      case "unavailable":
        return (
          <StateNotice
            kind="unavailable"
            title={SURFACE_STATE_COPY["saved-view"].unavailable.title}
            description={SURFACE_STATE_COPY["saved-view"].unavailable.body}
            source={savedViewsResult.unavailable.source}
            retry={{
              label: PARTNER_ACTION_LABELS.retry,
              onClick: () => {
                void roster.savedViews.refetch();
              },
            }}
            headingLevel={RECEIPT_HEADING_LEVEL}
          />
        );
      case "refused":
        return <StateNotice kind="refused" title={SURFACE_STATE_COPY["saved-view"].refused.title} description={`${SURFACE_STATE_COPY["saved-view"].refused.body} ${refusalSummary(savedViewsResult.refused)}`} headingLevel={RECEIPT_HEADING_LEVEL} />;
      default:
        return assertNever(savedViewsResult, "Unhandled saved-view read result");
    }
  }
  /** Every drifted view, stated in the worker's own words with the parts that are unavailable and the two actions that resolve it. */
  function renderDrift(): ReactNode {
    if (driftedEntries.length === 0) {
      return null;
    }
    return (
      <div className="flex min-w-0 flex-col gap-2">
        {driftedEntries.map(({ view, drift }) => (
          <Alert key={view.id} data-slot="saved-view-drift" data-view-id={view.id}>
            <WrenchIcon aria-hidden="true" />
            <AlertTitle>
              {SAVED_VIEW_COPY.drift.title}: <bdi>{view.name}</bdi>
            </AlertTitle>
            <AlertDescription>
              <p>{SAVED_VIEW_COPY.drift.body}</p>
              <p className="mt-2 font-medium text-foreground">{SAVED_VIEW_BAR_COPY.unavailableNow}</p>
              <ul className="mt-1 flex list-disc flex-col gap-1 ps-5">
                {unavailablePartsOf(drift).map((part) => (
                  <li key={part}>
                    <bdi>{part}</bdi>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-auto min-h-8 whitespace-normal"
                  disabled={busy || view.revision === undefined}
                  onClick={() => {
                    void repairView(view, drift);
                  }}
                >
                  {SAVED_VIEW_COPY.repair.title}
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-auto min-h-8 whitespace-normal" disabled={busy || view.revision === undefined} onClick={() => startDelete(view)}>
                  {SAVED_VIEW_COPY.delete.title}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ))}
      </div>
    );
  }
  return (
    <section data-slot="saved-view-bar" aria-busy={busy ? true : undefined} className={cn("flex min-w-0 flex-col gap-3", className)}>
      {renderControl()}
      {renderDrift()}
      {deleteTarget === null || deleteTarget.revision === undefined ? null : (
        <div ref={deleteReviewRef} tabIndex={-1} data-slot="saved-view-delete-review" className="flex min-w-0 flex-col gap-3">
          <ActionReview<DeleteViewPayload>
            key={deleteTarget.id}
            title={SAVED_VIEW_COPY.delete.title}
            headingLevel={RECEIPT_HEADING_LEVEL}
            consequential
            confirmLabel={SAVED_VIEW_COPY.delete.title}
            cancelLabel={SAVED_VIEW_BAR_COPY.cancel}
            onCancel={() => {
              setDeleteTarget(null);
            }}
            description={
              <p className="text-pretty">
                {SAVED_VIEW_COPY.delete.body} The view named <bdi>{deleteTarget.name}</bdi> is the only thing removed, and no saved-view action brings a deleted view back.
              </p>
            }
            input={{ scope, expectedRevision: deleteTarget.revision, payload: { viewId: deleteTarget.id } }}
            submit={deleteView.submit}
            checkResult={checkResult}
            fieldLabels={DELETE_FIELD_LABELS}
          />
        </div>
      )}
      {saveView.outcome === null || saveOperation === null ? null : (
        <div ref={saveReceiptRef} tabIndex={-1} data-slot="saved-view-receipt" data-operation={saveOperation.kind} data-outcome={saveView.outcome.outcome} className="flex min-w-0 flex-col gap-3">
          <OutcomeReceipt operation={saveOperation.kind} viewName={saveOperation.viewName} outcome={saveView.outcome} onCheckResult={checkResult} onRetrySameWork={replaySave} onReapply={reapplySave} fieldLabels={SAVE_FIELD_LABELS} />
        </div>
      )}
      {renameView.outcome === null || renameOperation === null ? null : (
        <div ref={renameReceiptRef} tabIndex={-1} data-slot="saved-view-receipt" data-operation="rename" data-outcome={renameView.outcome.outcome} className="flex min-w-0 flex-col gap-3">
          <OutcomeReceipt operation="rename" viewName={renameOperation.viewName} outcome={renameView.outcome} onCheckResult={checkResult} onRetrySameWork={replayRename} onReapply={reapplyRename} fieldLabels={RENAME_FIELD_LABELS} />
        </div>
      )}
      {busy ? <output className="text-sm text-muted-foreground text-pretty">{SAVED_VIEW_BAR_COPY.working}</output> : null}
      <NameViewDialog
        panel={panel}
        name={nameDraft}
        error={nameErrors}
        pending={panel?.mode === "rename" ? renameView.isPending : saveView.isPending}
        onNameChange={setNameDraft}
        onSubmit={() => {
          void submitName();
        }}
        onCancel={closePanel}
      />
    </section>
  );
}
