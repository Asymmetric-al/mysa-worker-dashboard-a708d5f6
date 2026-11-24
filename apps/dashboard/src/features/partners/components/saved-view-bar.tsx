"use client";
import { Fragment, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { BookmarkIcon, ChevronDownIcon, WrenchIcon } from "lucide-react";
import ActionReview from "@/components/action-review";
import { outcomeNotice, type OutcomeNoticeCopy } from "@/components/attempt";
import { FormField, fieldErrorsFromInvalid, refusalSummary } from "@/components/form-field";
import OperationResult from "@/components/operation-result";
import StateNotice from "@/components/state-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, BUTTON_WRAP_CLASS } from "@/components/ui/button";
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
export type SavedViewQueryState = { readonly search: string; readonly applied: Readonly<Record<string, readonly string[]>>; readonly columnVisibility?: Readonly<Record<string, boolean>>; readonly sort?: { readonly field: string; readonly direction: "asc" | "desc" }; readonly pageSize?: number };
export type SavedViewDefinition = { readonly id: string; readonly name: string; readonly revision?: string; readonly query: SavedViewQueryState };
export type DeadFacet = { readonly facetId: string; readonly label: string };
export type DeadValue = { readonly facetId: string; readonly facetLabel: string; readonly valueId: string; readonly label: string };
export type DeadColumn = { readonly columnId: string; readonly label: string };
export type ViewDrift = { readonly drifted: boolean; readonly deadFacets: readonly DeadFacet[]; readonly deadValues: readonly DeadValue[]; readonly deadColumns: readonly DeadColumn[]; readonly pageSize: number | null; readonly repaired: SaveViewPayload["queryState"] };
const isFacetKey = (identifier: string): identifier is FacetKey => Object.prototype.hasOwnProperty.call(FACET_LABELS, identifier);
const facetLabelOf = (facetId: string, admittedFacets: readonly PartnerFacetDescriptor[]): string => admittedFacets.find((facet) => facet.id === facetId)?.label ?? (isFacetKey(facetId) ? FACET_LABELS[facetId] : facetId);
const valueLabelOf = (facetId: string, valueId: string, admittedFacets: readonly PartnerFacetDescriptor[]): string => admittedFacets.find((facet) => facet.id === facetId)?.values.find((value) => value.id === valueId)?.label ?? (isFacetKey(facetId) ? FACET_VALUE_LABELS[facetId][valueId] : undefined) ?? valueId;
const pageSizeDriftOf = (pageSize: number | undefined): number | null => (pageSize === undefined || PARTNER_LIST_PAGE_SIZE_OPTIONS.some((option) => option === pageSize) ? null : pageSize);
function repairedQueryOf(query: SavedViewQueryState, dead: { readonly deadFacets: readonly DeadFacet[]; readonly deadValues: readonly DeadValue[]; readonly deadColumns: readonly DeadColumn[]; readonly dropPageSize: boolean }): SaveViewPayload["queryState"] {
  const deadFacetIds = new Set(dead.deadFacets.map((facet) => facet.facetId));
  const deadValueKeys = new Set(dead.deadValues.map((value) => `${value.facetId}\u0000${value.valueId}`));
  const applied: Record<string, string[]> = {};
  for (const [facetId, values] of Object.entries(query.applied)) {
    const kept = values.filter((value) => !deadValueKeys.has(`${facetId}\u0000${value}`));
    if (!deadFacetIds.has(facetId) && kept.length > 0) applied[facetId] = [...kept];
  }
  const deadColumnIds = new Set(dead.deadColumns.map((column) => column.columnId));
  const columnVisibility: Record<string, boolean> = Object.fromEntries(Object.entries(query.columnVisibility ?? {}).filter(([columnId]) => !deadColumnIds.has(columnId)));
  return {
    search: query.search,
    applied,
    ...(Object.keys(columnVisibility).length === 0 ? {} : { columnVisibility }),
    ...(query.sort === undefined ? {} : { sort: { field: query.sort.field, direction: query.sort.direction } }),
    ...(query.pageSize === undefined || dead.dropPageSize ? {} : { pageSize: query.pageSize }),
  };
}
/** The drift a stored view carries against the filters, values and columns this context admits, and the choices a repair would store. */
export function detectViewDrift(view: SavedViewDefinition, admittedFacets: readonly PartnerFacetDescriptor[], catalogue: readonly PartnerColumn[] = partnerColumnCatalogue): ViewDrift {
  const checked = checkSavedViewDrift(
    { applied: view.query.applied, ...(view.query.columnVisibility === undefined ? {} : { columnVisibility: view.query.columnVisibility }) },
    { facets: admittedFacets.map((facet) => ({ id: facet.id, state: facet.disabledReason === undefined ? "available" : "unavailable", options: facet.values.map((value) => ({ id: value.id })) })), columns: catalogue.map((column) => column.key) },
  );
  const drifted = checked.state === "drifted";
  const deadFacets = drifted ? checked.deadFacets.map((facetId) => ({ facetId, label: facetLabelOf(facetId, admittedFacets) })) : [];
  const deadValues = drifted ? checked.deadValues.map((dead) => ({ facetId: dead.facet, facetLabel: facetLabelOf(dead.facet, admittedFacets), valueId: dead.value, label: valueLabelOf(dead.facet, dead.value, admittedFacets) })) : [];
  const deadColumns = drifted ? checked.deadColumns.map((columnId) => ({ columnId, label: catalogue.find((column) => column.key === columnId)?.displayName ?? columnId })) : [];
  const pageSize = pageSizeDriftOf(view.query.pageSize);
  return { drifted: deadFacets.length > 0 || deadValues.length > 0 || deadColumns.length > 0 || pageSize !== null, deadFacets, deadValues, deadColumns, pageSize, repaired: repairedQueryOf(view.query, { deadFacets, deadValues, deadColumns, dropPageSize: pageSize !== null }) };
}
const unavailablePartsOf = (drift: ViewDrift): readonly string[] => [
  ...drift.deadFacets.map((facet) => `${SAVED_VIEW_PART_COPY.filter}: ${facet.label}`),
  ...drift.deadValues.map((value) => `${SAVED_VIEW_PART_COPY.value(value.facetLabel)}: ${value.label}`),
  ...drift.deadColumns.map((column) => `${SAVED_VIEW_PART_COPY.column}: ${column.label}`),
  ...(drift.pageSize === null ? [] : [`${SAVED_VIEW_PART_COPY.pageSize}: ${String(drift.pageSize)}`]),
];
function storedChoicesOf(query: RosterQueryState): SaveViewPayload["queryState"] {
  const applied: Record<string, string[]> = {};
  for (const [facetId, values] of Object.entries(query.facets)) if (values.length > 0) applied[facetId] = [...values];
  const columnVisibility: Record<string, boolean> = { ...query.columnVisibility };
  const storedPageSize = pageSizeDriftOf(query.pageSize) === null ? query.pageSize : undefined;
  return { search: query.search, applied, ...(Object.keys(columnVisibility).length === 0 ? {} : { columnVisibility }), ...(query.sort === null ? {} : { sort: { field: query.sort.field, direction: query.sort.direction } }), ...(storedPageSize === undefined ? {} : { pageSize: storedPageSize }) };
}
function sameSelection(left: Readonly<Record<string, readonly string[]>>, right: Readonly<Record<string, readonly string[]>>): boolean {
  const leftKeys = Object.keys(left).filter((key) => (left[key] ?? []).length > 0);
  const rightKeys = Object.keys(right).filter((key) => (right[key] ?? []).length > 0);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => {
    const mine = left[key] ?? [];
    const theirs = right[key];
    return theirs !== undefined && mine.length === theirs.length && mine.every((value) => theirs.includes(value));
  });
}
/** Whether the ordering on screen is the one the view states: a view that states none leaves the list's ordering as it found it, so it claims nothing about it. */
const sameStoredSort = (stored: SavedViewQueryState["sort"], applied: RosterQueryState["sort"]): boolean => stored === undefined || (applied !== null && applied.field === stored.field && applied.direction === stored.direction);
/** Whether the choices on screen are the choices this view stores, member by member: the search, the selection, the stored ordering and the stored page size, each compared only where the view states one — a view that stores no ordering or size says nothing about it, so the badge never claims an ordering the list does not show. */
function viewIsInUse(view: SavedViewQueryState, query: RosterQueryState): boolean {
  if (view.search.trim() !== query.search.trim() || !sameSelection(view.applied, query.facets) || !sameStoredSort(view.sort, query.sort)) return false;
  if (view.pageSize !== undefined && view.pageSize !== query.pageSize) return false;
  return view.columnVisibility === undefined || Object.entries(view.columnVisibility).every(([columnId, visible]) => query.columnVisibility[columnId] === visible);
}
const SAVED_VIEW_PART_COPY = { filter: "Filter", value: (facet: string): string => `Value in the ${facet} filter`, column: "Column", pageSize: "Rows per page" } as const;
const SAVED_VIEW_BAR_COPY = { trigger: "Saved views", triggerName: (repairCount: number): string => (repairCount === 0 ? "Saved views" : `Saved views, ${String(repairCount)} needs repair`), apply: "Apply", cancel: "Cancel" } as const;
const RECEIPT_HEADING_LEVEL = 3;
const SAVE_FIELD_LABELS: Readonly<Record<string, string>> = { name: "View name", viewId: "View", queryState: "Stored choices", "queryState.search": "Search text", "queryState.applied": "Selected filters", "queryState.pageSize": "Rows per page" };
const RENAME_FIELD_LABELS: Readonly<Record<string, string>> = { name: "View name", viewId: "View" };
const DELETE_FIELD_LABELS: Readonly<Record<string, string>> = { viewId: "View" };
const ITEM_CLASS = "h-auto min-h-8 whitespace-normal";
type SavedViewOperation = "save" | "update" | "repair" | "rename";
const OPERATION_CAPTION: Readonly<Record<SavedViewOperation, string>> = { save: "Saved view", update: "Updated view", repair: "Repaired view", rename: "Renamed view" };
const RECEIPT_NOTICE_COPY: OutcomeNoticeCopy = {
  denied: { title: SURFACE_STATE_COPY["saved-view"].denied.title, description: SURFACE_STATE_COPY["saved-view"].denied.body },
  unavailable: { title: "This change did not reach the source", description: "The stored view is as it was: the request did not arrive, so nothing about its choices changed." },
  unknown: { title: "This change is not confirmed" },
  retryLabel: PARTNER_ACTION_LABELS.retry,
  checkResultLabel: "Check the result",
};
type OutcomeReceiptProps = { readonly operation: SavedViewOperation; readonly viewName: string; readonly outcome: MutationOutcome; readonly onCheckResult: () => void; readonly onRetrySameWork: () => void; readonly onReapply: (currentRevision: string) => void; readonly fieldLabels: Readonly<Record<string, string>> };
function OutcomeReceipt({ operation, viewName, outcome, onCheckResult, onRetrySameWork, onReapply, fieldLabels }: OutcomeReceiptProps): ReactElement {
  const notice = outcomeNotice(outcome, RECEIPT_NOTICE_COPY, { onRetrySameWork, onCheckResult, headingLevel: RECEIPT_HEADING_LEVEL });
  const label = OPERATION_CAPTION[operation];
  const denied = outcome.outcome === "denied";
  return (
    <>
      <p className="type-group-title text-muted-foreground">
        {denied ? label : `${label}: `}
        {denied ? null : <bdi className="wrap-anywhere">{viewName}</bdi>}
      </p>
      {notice === null ? <OperationResult outcome={outcome} headingLevel={RECEIPT_HEADING_LEVEL} onCheckResult={onCheckResult} onRetrySameWork={onRetrySameWork} onReapply={outcome.outcome === "conflict" ? () => onReapply(outcome.currentRevision) : undefined} fieldLabels={fieldLabels} /> : <StateNotice {...notice} />}
    </>
  );
}
interface ViewMenuSectionProps {
  readonly view: SavedViewDefinition;
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
function ViewMenuSection({ view, drift, inUse, canWrite, busy, driftNoteId, onApply, onUpdate, onRename, onRepair, onDelete }: ViewMenuSectionProps): ReactElement {
  const drifted = drift !== null && drift.drifted;
  const changeable = canWrite && view.revision !== undefined;
  const applyBlocked = busy || drift === null || drifted;
  const changes: ReadonlyArray<{ readonly key: string; readonly label: string; readonly onSelect: () => void; readonly destructive?: boolean }> = changeable
    ? [
        { key: "update", label: "Update with the choices on screen", onSelect: () => onUpdate(view) },
        { key: "rename", label: "Rename", onSelect: () => onRename(view) },
        ...(drift !== null && drifted ? [{ key: "repair", label: SAVED_VIEW_COPY.repair.title, onSelect: () => onRepair(view, drift) }] : []),
        { key: "delete", label: "Delete", onSelect: () => onDelete(view), destructive: true },
      ]
    : [];
  return (
    <Fragment>
      <DropdownMenuLabel className="flex flex-wrap items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          <bdi>{view.name}</bdi>
        </span>
        {inUse ? <Badge variant="secondary">In use</Badge> : null}
        {drifted ? <Badge variant="outline">Needs repair</Badge> : null}
      </DropdownMenuLabel>
      <DropdownMenuItem
        className={ITEM_CLASS}
        disabled={applyBlocked}
        aria-describedby={applyBlocked && drift === null ? driftNoteId : undefined}
        aria-label={`${SAVED_VIEW_BAR_COPY.apply}: ${view.name}`}
        onClick={() => {
          if (drift !== null) onApply(drift.repaired);
        }}
      >
        {SAVED_VIEW_BAR_COPY.apply}
      </DropdownMenuItem>
      {changes.map((change) => (
        <DropdownMenuItem key={change.key} className={ITEM_CLASS} variant={change.destructive === true ? "destructive" : undefined} disabled={busy} aria-label={`${change.label}: ${view.name}`} onClick={change.onSelect}>
          {change.label}
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
    </Fragment>
  );
}
type NamePanel = { readonly mode: "save" } | { readonly mode: "rename"; readonly view: SavedViewDefinition };
type NameViewDialogProps = { readonly panel: NamePanel | null; readonly name: string; readonly error: string | readonly string[] | undefined; readonly pending: boolean; readonly onNameChange: (next: string) => void; readonly onSubmit: () => void; readonly onCancel: () => void };
function NameViewDialog({ panel, name, error, pending, onNameChange, onSubmit, onCancel }: NameViewDialogProps): ReactElement {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const renaming = panel?.mode === "rename";
  return (
    <Dialog open={panel !== null} onOpenChange={(open) => (open ? undefined : onCancel())}>
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
          <FormField name="name" label={renaming ? "New name" : "Name this view"} error={error} required>
            {(field) => <Input ref={inputRef} id={field.id} value={name} maxLength={80} autoComplete="off" disabled={pending} aria-describedby={field.describedBy} aria-invalid={field.invalid ? true : undefined} onChange={(event) => onNameChange(event.target.value)} />}
          </FormField>
          <DialogFooter>
            <Button {...{ type: "button" as const, variant: "outline" as const, onClick: onCancel, disabled: pending }}>{SAVED_VIEW_BAR_COPY.cancel}</Button>
            <Button type="submit" disabled={pending || name.trim() === ""}>
              {pending ? <Spinner /> : null}
              {renaming ? "Save name" : "Save view"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export type SavedViewBarProps = { readonly scope: Scope; readonly admittedColumnKeys?: readonly string[]; readonly initialResult?: ReadResult<RosterEnvelope>; readonly className?: string };
type ViewEntry = { readonly view: SavedViewDefinition; readonly drift: ViewDrift | null };
const envelopeOf = <T,>(result: ReadResult<ReadEnvelope<T>> | undefined): ReadEnvelope<T> | null => (result !== undefined && result.kind === "envelope" ? result.envelope : null);
/** The Partners roster's saved-view surface: save the choices on screen under a name, replace them, rename the view, delete it, and repair one whose stored choices this context no longer offers. */
export default function SavedViewBar({ scope, admittedColumnKeys, initialResult, className }: SavedViewBarProps): ReactElement {
  // This bar composes the same roster query for the state and the views it stores, so it is a second observer of that one cache entry: without the seed its own mount would turn the route's answer back into the identical read the seed exists to avoid.
  const roster = useRosterQuery(scope, admittedColumnKeys === undefined ? {} : { admittedColumnKeys }, initialResult);
  const saveView = useSaveView();
  const renameView = useRenameView();
  const deleteView = useDeleteView();
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
  const saveAttemptRef = useRef<{ readonly expectedRevision: string; readonly payload: SaveViewPayload } | null>(null);
  const renameAttemptRef = useRef<{ readonly expectedRevision: string; readonly payload: RenameViewPayload } | null>(null);
  const savedViewsResult = roster.savedViews.data;
  const savedViews = envelopeOf(savedViewsResult);
  const facetsEnvelope = envelopeOf(roster.facets.data);
  const descriptors = buildPartnerFacetDescriptors(facetsEnvelope);
  const driftKnown = facetsEnvelope !== null;
  const saveAction = savedViews === null ? undefined : savedViews.actions.find((action) => action.name === "saveView");
  const canWrite = saveAction !== undefined && saveAction.available;
  const withheldReason = saveAction === undefined || saveAction.available ? "" : (saveAction.reason?.trim() ?? "");
  const entries: readonly ViewEntry[] = savedViews === null ? [] : savedViews.data.map((view) => ({ view, drift: driftKnown ? detectViewDrift(view, descriptors) : null }));
  const driftedEntries = entries.filter((entry): entry is ViewEntry & { readonly drift: ViewDrift } => entry.drift !== null && entry.drift.drifted);
  const busy = saveView.isPending || renameView.isPending || deleteView.isPending;
  const replaySave = (revision?: string): void => {
    const attempt = saveAttemptRef.current;
    if (attempt !== null) void saveView.submit({ scope, expectedRevision: revision ?? attempt.expectedRevision, payload: attempt.payload });
  };
  const replayRename = (revision?: string): void => {
    const attempt = renameAttemptRef.current;
    if (attempt !== null) void renameView.submit({ scope, expectedRevision: revision ?? attempt.expectedRevision, payload: attempt.payload });
  };
  useEffect(() => (saveView.outcome === null ? undefined : saveReceiptRef.current?.focus()), [saveView.outcome]);
  useEffect(() => (renameView.outcome === null ? undefined : renameReceiptRef.current?.focus()), [renameView.outcome]);
  useEffect(() => (deleteTarget === null ? undefined : deleteReviewRef.current?.focus()), [deleteTarget]);
  const checkResult = (): void => void roster.savedViews.refetch();
  function openSave(): void {
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
    triggerRef.current?.focus();
  }
  function applyChoices(choices: SaveViewPayload["queryState"]): void {
    const facets: Record<string, readonly string[]> = Object.fromEntries(Object.entries(choices.applied).map(([facetId, values]) => [facetId, [...values]]));
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
    if (panel === null || name === "" || saveView.isPending || renameView.isPending) return;
    if (panel.mode === "save") {
      if (savedViews === null) return;
      const attempt = { expectedRevision: savedViews.revision, payload: { name, queryState: storedChoicesOf(roster.query) } };
      saveAttemptRef.current = attempt;
      setSaveOperation({ kind: "save", viewName: name });
      if ((await saveView.submit({ scope, expectedRevision: attempt.expectedRevision, payload: attempt.payload })).outcome !== "invalid") closePanel();
      return;
    }
    const target = panel.view;
    if (target.revision === undefined) return;
    const attempt = { expectedRevision: target.revision, payload: { viewId: target.id, name } };
    renameAttemptRef.current = attempt;
    setRenameOperation({ viewName: name });
    if ((await renameView.submit({ scope, expectedRevision: attempt.expectedRevision, payload: attempt.payload })).outcome !== "invalid") closePanel();
  }
  async function saveExisting(view: SavedViewDefinition, kind: "update" | "repair", queryState: SaveViewPayload["queryState"]): Promise<void> {
    if (view.revision === undefined || saveView.isPending) return;
    const payload = { viewId: view.id, name: view.name, queryState };
    saveAttemptRef.current = { expectedRevision: view.revision, payload };
    setSaveOperation({ kind, viewName: view.name });
    await saveView.submit({ scope, expectedRevision: view.revision, payload });
  }
  function startDelete(view: SavedViewDefinition): void {
    closePanel();
    deleteView.reset();
    setDeleteTarget(view);
  }
  const nameOutcome = panel?.mode === "rename" ? renameView.outcome : saveView.outcome;
  const nameErrors = nameOutcome !== null && nameOutcome.outcome === "invalid" ? fieldErrorsFromInvalid(nameOutcome).byField["name"] : undefined;
  function renderControl(): ReactNode {
    const copy = SURFACE_STATE_COPY["saved-view"];
    if (savedViewsResult === undefined) {
      return (
        <Button type="button" variant="outline" size="sm" className="max-w-full" disabled aria-busy="true">
          <Spinner />
          <span className="truncate">{SAVED_VIEW_BAR_COPY.trigger}</span>
          <span className="sr-only">Reading your saved views.</span>
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
              {driftedEntries.length === 0 ? null : <Badge {...{ variant: "outline" as const, "aria-hidden": "true" as const, className: "h-5 min-w-5 justify-center px-1 tabular-figures" as const }}>{String(driftedEntries.length)}</Badge>}
              <ChevronDownIcon aria-hidden="true" className="size-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
              <DropdownMenuLabel className="text-sm text-foreground">{SAVED_VIEW_BAR_COPY.trigger}</DropdownMenuLabel>
              <p className="px-3 pb-2 type-supporting">{SAVED_VIEW_COPY.leavesRecordsAlone.body}</p>
              {entries.length > 0 ? null : <p className="px-3 pb-2 type-supporting">No view is stored for this roster yet. Save the choices on screen to keep them.</p>}
              {entries.length > 0 && !driftKnown ? (
                <p id={driftNoteId} className="px-3 pb-2 type-supporting">
                  The filters this context offers have not been read, so a stored view cannot be checked against them and is not applied until they are.
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
                  onUpdate={(view) => void saveExisting(view, "update", storedChoicesOf(roster.query))}
                  onRename={openRename}
                  onRepair={(view, drift) => void saveExisting(view, "repair", drift.repaired)}
                  onDelete={startDelete}
                />
              ))}
              {canWrite ? (
                <DropdownMenuItem className={ITEM_CLASS} disabled={busy} onClick={openSave}>
                  Save current view
                </DropdownMenuItem>
              ) : (
                <p className="px-3 py-2 type-supporting">{withheldReason === "" ? "This context admits reading a stored view and not changing one, so no view is saved, renamed or deleted here." : withheldReason}</p>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      case "denied":
        return <StateNotice kind="denied" title={copy.denied.title} description={copy.denied.body} reasonCode={savedViewsResult.denied.reasonCode} headingLevel={RECEIPT_HEADING_LEVEL} />;
      case "unavailable":
        return <StateNotice kind="unavailable" title={copy.unavailable.title} description={copy.unavailable.body} source={savedViewsResult.unavailable.source} retry={{ label: PARTNER_ACTION_LABELS.retry, onClick: checkResult }} headingLevel={RECEIPT_HEADING_LEVEL} />;
      case "refused":
        return <StateNotice kind="refused" title={copy.refused.title} description={`${copy.refused.body} ${refusalSummary(savedViewsResult.refused)}`} headingLevel={RECEIPT_HEADING_LEVEL} />;
      default:
        return assertNever(savedViewsResult, "Unhandled saved-view read result");
    }
  }
  function renderDrift(): ReactNode {
    if (driftedEntries.length === 0) return null;
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
              <p className="mt-2 type-group-title text-foreground">Unavailable in this context now:</p>
              <ul className="mt-1 flex list-disc flex-col gap-1 ps-5">
                {unavailablePartsOf(drift).map((part) => (
                  <li key={part}>
                    <bdi>{part}</bdi>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button {...{ type: "button" as const, size: "sm" as const, variant: "secondary" as const, className: BUTTON_WRAP_CLASS, disabled: busy || view.revision === undefined, onClick: () => void saveExisting(view, "repair", drift.repaired) }}>{SAVED_VIEW_COPY.repair.title}</Button>
                <Button {...{ type: "button" as const, size: "sm" as const, variant: "outline" as const, className: BUTTON_WRAP_CLASS, disabled: busy || view.revision === undefined, onClick: () => startDelete(view) }}>{SAVED_VIEW_COPY.delete.title}</Button>
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
            onCancel={() => setDeleteTarget(null)}
            description={
              <p className="type-supporting text-pretty">
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
          <OutcomeReceipt operation={saveOperation.kind} viewName={saveOperation.viewName} outcome={saveView.outcome} onCheckResult={checkResult} onRetrySameWork={() => replaySave()} onReapply={replaySave} fieldLabels={SAVE_FIELD_LABELS} />
        </div>
      )}
      {renameView.outcome === null || renameOperation === null ? null : (
        <div ref={renameReceiptRef} tabIndex={-1} data-slot="saved-view-receipt" data-operation="rename" data-outcome={renameView.outcome.outcome} className="flex min-w-0 flex-col gap-3">
          <OutcomeReceipt operation="rename" viewName={renameOperation.viewName} outcome={renameView.outcome} onCheckResult={checkResult} onRetrySameWork={() => replayRename()} onReapply={replayRename} fieldLabels={RENAME_FIELD_LABELS} />
        </div>
      )}
      {busy ? <output className="text-sm text-muted-foreground text-pretty">Saving once. The receipt appears below when the partner source answers.</output> : null}
      <NameViewDialog panel={panel} name={nameDraft} error={nameErrors} pending={panel?.mode === "rename" ? renameView.isPending : saveView.isPending} onNameChange={setNameDraft} onSubmit={() => void submitName()} onCancel={closePanel} />
    </section>
  );
}
