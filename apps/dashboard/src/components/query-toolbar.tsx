"use client";
/** The one search, facet and saved-view toolbar that every list and report composes. */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { BookmarkIcon, ChevronDownIcon, Columns3Icon, SearchIcon, WrenchIcon, XIcon } from "lucide-react";
import StatusBadge, { valueStateWord, type StatusTone } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { useRovingFocus, useTypeahead } from "@/lib/ui-sdk";
import type { ValueState } from "@/modules/data-service/envelope";
// The public contract
/** One value a facet offers. */
export interface FacetValueSpec {
  readonly id: string;
  readonly label: string;
  readonly count?: number;
  readonly countState?: ValueState;
  readonly tone?: StatusTone;
}
/** One filter the read envelope offers, with the values it admits in the caller's scope. */
export interface FacetSpec {
  readonly id: string;
  readonly label: string;
  readonly values: readonly FacetValueSpec[];
  readonly multi: boolean;
  readonly disabledReason?: string;
}
/** One column the owner may show or hide. */
export interface ColumnSpec {
  readonly id: string;
  readonly label: string;
  readonly hideable?: boolean;
}
/** Column id to visibility. */
export type ColumnVisibility = Readonly<Record<string, boolean>>;
/** Everything a saved view stores: the search text, the values selected per facet and, when the surface offers configurable columns, the visible set. */
export interface SavedViewQuery {
  readonly search: string;
  readonly applied: Readonly<Record<string, readonly string[]>>;
  readonly columnVisibility?: ColumnVisibility;
}
/** One stored view: a name, the choices it stores, and the revision the service reported for it. */
export interface SavedView {
  readonly id: string;
  readonly name: string;
  readonly query: SavedViewQuery;
  readonly revision?: string;
}
/** The choices a new view would store, as the toolbar hands them to `onSaveView`. */
export interface SavedViewDraft {
  readonly name: string;
  readonly query: SavedViewQuery;
}
/** Which facet is the amount range and which is the currency it is scoped to. */
export interface AmountRangeScope {
  readonly facetId?: string;
  readonly currencyFacetId?: string;
}
/** The search field, controlled by the owner and debounced here. */
export interface QueryToolbarSearch {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
  readonly debounceMs?: number;
}
/** Props of {@link QueryToolbar}. */
export interface QueryToolbarProps {
  readonly label: string;
  readonly search: QueryToolbarSearch;
  readonly facets: readonly FacetSpec[];
  readonly applied: Readonly<Record<string, readonly string[]>>;
  readonly onAppliedChange: (next: Record<string, string[]>) => void;
  readonly savedViews?: readonly SavedView[];
  readonly onSaveView?: (draft: SavedViewDraft) => void;
  readonly onUpdateView?: (viewId: string) => void;
  readonly onRenameView?: (viewId: string, name: string) => void;
  readonly onDeleteView?: (viewId: string) => void;
  readonly onRepairView?: (viewId: string) => void;
  readonly columns?: readonly ColumnSpec[];
  readonly columnVisibility?: ColumnVisibility;
  readonly onColumnVisibilityChange?: (next: Record<string, boolean>) => void;
  readonly amountRange?: AmountRangeScope;
  readonly pending?: boolean;
  readonly className?: string;
}
// Wording
const TOOLBAR_COPY = {
  searchLabel: "Search",
  clearSearch: "Clear the search text",
  acrossFacets: "Every selected filter must match.",
  withinFacet: "Within one filter, any selected value may match.",
  singleValue: "Choose one value.",
  facetEmpty: "This filter offers no value in the context you are working in.",
  facetLoading: "Loading filter options.",
  clearFacet: "Clear this filter",
  appliedCount: (count: number): string => `${count} selected`,
  facetUnavailableLabel: (facet: string): string => `${facet}, unavailable`,
  activeFilters: "Selected filters",
  removeFilter: "Remove this filter",
  clearAll: "Clear all filters",
  noFilterApplied: "No filter is applied, so this list shows the whole result.",
  currencyScopeReason: "Amounts in different currencies are not compared, so choose one currency before setting an amount range.",
  savedViews: "Saved views",
  savedViewsTitle: "Saved views",
  savedViewsDescription: "A view stores your search, filters and columns. It never changes a record, and it is only replaced when you choose Update.",
  savedViewsEmpty: "No view is stored for this surface yet. Name the choices on screen to keep them.",
  saveView: "Save this view",
  saveViewName: "Name this view",
  saveViewSubmit: "Save view",
  renameViewName: "Rename this view",
  renameViewSubmit: "Save name",
  cancel: "Cancel",
  applyView: "Apply",
  updateView: "Update",
  renameView: "Rename",
  deleteView: "Delete",
  repairView: "Repair",
  inUse: "In use",
  drifted: "Needs repair",
  driftExplanation: "This view refers to a filter this context no longer offers, so it is not applied as it stands. Repairing saves the selection again; the view and every record are otherwise unchanged.",
  viewActionLabel: (action: string, view: string): string => `${action}: ${view}`,
  columns: "Columns",
  columnsTitle: "Columns",
  columnsNote: "At least one column stays visible, so the list always shows something to read.",
  showAllColumns: "Show all columns",
  columnActionLabel: (column: string): string => `Show the ${column} column`,
} as const;
const DEFAULT_SEARCH_DEBOUNCE_MS = 250;

const LOADING_PLACEHOLDER_ROWS = 4;

const countFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const DEFAULT_AMOUNT_RANGE_FACET_ID = "amount-range";

const DEFAULT_CURRENCY_FACET_ID = "currency";

const VIEW_NAME_MAX_LENGTH = 80;
// Pure query helpers
//
// Each of these names the query the worker chose and returns a fresh value. None of them reads a
// record, so "which rows match" never becomes a question this file answers.
function appliedValuesOf(applied: Readonly<Record<string, readonly string[]>>, facetId: string): readonly string[] {
  const values = applied[facetId];
  return values === undefined ? [] : values;
}
function withFacetValues(applied: Readonly<Record<string, readonly string[]>>, facetId: string, values: readonly string[]): Record<string, string[]> {
  const next: Record<string, string[]> = {};
  for (const [key, current] of Object.entries(applied)) {
    if (key !== facetId) {
      next[key] = [...current];
    }
  }
  if (values.length > 0) {
    next[facetId] = [...values];
  }
  return next;
}
function withValueAdded(current: readonly string[], valueId: string, multi: boolean): readonly string[] {
  if (!multi) {
    return [valueId];
  }
  return current.includes(valueId) ? current : [...current, valueId];
}
function withValueRemoved(current: readonly string[], valueId: string): readonly string[] {
  const next: string[] = [];
  for (const id of current) {
    if (id !== valueId) {
      next.push(id);
    }
  }
  return next;
}
function sameValueSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (const id of left) {
    if (!right.includes(id)) {
      return false;
    }
  }
  return true;
}
function sameSelection(left: Readonly<Record<string, readonly string[]>>, right: Readonly<Record<string, readonly string[]>>): boolean {
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) {
    return false;
  }
  for (const key of leftKeys) {
    const mine = left[key];
    const other = right[key];
    if (mine === undefined || other === undefined || !sameValueSet(mine, other)) {
      return false;
    }
  }
  return true;
}
function facetById(facets: readonly FacetSpec[], facetId: string): FacetSpec | undefined {
  for (const facet of facets) {
    if (facet.id === facetId) {
      return facet;
    }
  }
  return undefined;
}
function facetValueById(facet: FacetSpec, valueId: string): FacetValueSpec | undefined {
  for (const value of facet.values) {
    if (value.id === valueId) {
      return value;
    }
  }
  return undefined;
}
function labelOfValue(facet: FacetSpec, valueId: string): string {
  const value = facetValueById(facet, valueId);
  return value === undefined ? valueId : value.label;
}
function offersValue(facet: FacetSpec, valueId: string): boolean {
  return facetValueById(facet, valueId) !== undefined;
}
function singleSelectedValue(applied: Readonly<Record<string, readonly string[]>>, facetId: string): string | null {
  const values = appliedValuesOf(applied, facetId);
  if (values.length !== 1) {
    return null;
  }
  const [only] = values;
  return only === undefined ? null : only;
}
type AppliedChip = { readonly kind: "facet"; readonly facetId: string; readonly valueId: string; readonly facetLabel: string; readonly valueLabel: string } | { readonly kind: "search"; readonly facetLabel: string; readonly valueLabel: string };
// The search narrows the list exactly as a facet value does, so it is stated in the same list, and it
// is listed first because it is the filter the worker typed rather than one the read offered.
function appliedChips(facets: readonly FacetSpec[], applied: Readonly<Record<string, readonly string[]>>, searchText: string): readonly AppliedChip[] {
  const chips: AppliedChip[] = [];
  if (searchText.length > 0) {
    chips.push({ kind: "search", facetLabel: TOOLBAR_COPY.searchLabel, valueLabel: searchText });
  }
  const offered = new Set<string>();
  for (const facet of facets) {
    offered.add(facet.id);
    for (const valueId of appliedValuesOf(applied, facet.id)) {
      chips.push({ kind: "facet", facetId: facet.id, valueId, facetLabel: facet.label, valueLabel: labelOfValue(facet, valueId) });
    }
  }
  for (const [facetId, values] of Object.entries(applied)) {
    if (offered.has(facetId)) {
      continue;
    }
    for (const valueId of values) {
      chips.push({ kind: "facet", facetId, valueId, facetLabel: facetId, valueLabel: valueId });
    }
  }
  return chips;
}
type FacetCountView = { readonly kind: "number"; readonly text: string } | { readonly kind: "number-with-state"; readonly text: string; readonly label: string; readonly tone: StatusTone } | { readonly kind: "word"; readonly label: string; readonly tone: StatusTone } | { readonly kind: "none" };
function countViewOf(value: FacetValueSpec): FacetCountView {
  const state = value.countState;
  const counted = value.count !== undefined && Number.isFinite(value.count) ? countFormat.format(Math.max(0, Math.trunc(value.count))) : undefined;
  if (state !== undefined && state !== "value" && state !== "zero") {
    const word = valueStateWord(state);
    if (word !== undefined) {
      return state === "incomplete-subtotal" && counted !== undefined ? { kind: "number-with-state", text: counted, label: word.label, tone: word.tone } : { kind: "word", label: word.label, tone: word.tone };
    }
  }
  if (counted !== undefined) {
    return { kind: "number", text: counted };
  }
  if (state === "zero") {
    return { kind: "number", text: countFormat.format(0) };
  }
  return { kind: "none" };
}
interface SavedViewDrift {
  readonly missing: readonly string[];
  readonly drifted: boolean;
}
function driftOf(view: SavedView, facets: readonly FacetSpec[]): SavedViewDrift {
  const missing: string[] = [];
  for (const [facetId, values] of Object.entries(view.query.applied)) {
    const facet = facetById(facets, facetId);
    if (facet === undefined) {
      missing.push(facetId);
      continue;
    }
    for (const valueId of values) {
      if (!offersValue(facet, valueId)) {
        missing.push(`${facet.label}: ${valueId}`);
      }
    }
  }
  return { missing, drifted: missing.length > 0 };
}
function viewIsInUse(view: SavedView, applied: Readonly<Record<string, readonly string[]>>, searchText: string): boolean {
  return view.query.search === searchText && sameSelection(view.query.applied, applied);
}
function visibleColumnIds(columns: readonly ColumnSpec[], visibility: ColumnVisibility): readonly string[] {
  const visible: string[] = [];
  for (const column of columns) {
    if (visibility[column.id] !== false) {
      visible.push(column.id);
    }
  }
  return visible;
}
function allColumnsVisible(columns: readonly ColumnSpec[]): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  for (const column of columns) {
    next[column.id] = true;
  }
  return next;
}
// Small presentational pieces
function FacetCount({ value }: { readonly value: FacetValueSpec }): ReactNode {
  const view = countViewOf(value);
  if (view.kind === "number") {
    return <span className="ms-auto shrink-0 tabular-figures text-xs text-muted-foreground">{view.text}</span>;
  }
  if (view.kind === "number-with-state") {
    return (
      <span className="ms-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1">
        <span className="tabular-figures text-xs text-muted-foreground">{view.text}</span>
        <StatusBadge label={view.label} tone={view.tone} srPrefix="Matches" />
      </span>
    );
  }
  if (view.kind === "word") {
    return <StatusBadge label={view.label} tone={view.tone} srPrefix="Matches" className="ms-auto shrink-0" />;
  }
  return null;
}
function FacetLoading(): ReactNode {
  const rows = Array.from({ length: LOADING_PLACEHOLDER_ROWS }, (_, index) => index);
  return (
    <div className="flex flex-col gap-2 py-1" aria-hidden="true">
      {rows.map((row) => (
        <Skeleton key={row} className={cn("h-5", row === rows.length - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}
function LayerNote({ children }: { readonly children: ReactNode }): ReactNode {
  return <p className="text-sm leading-snug text-muted-foreground">{children}</p>;
}
function ViewNameForm({ fieldLabel, submitLabel, defaultValue = "", onSubmit, onCancel }: { readonly fieldLabel: string; readonly submitLabel: string; readonly defaultValue?: string; readonly onSubmit: (name: string) => void; readonly onCancel: () => void }): ReactNode {
  const fieldId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState(defaultValue);
  const trimmed = name.trim();
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed.length === 0) {
          return;
        }
        onSubmit(trimmed);
      }}
    >
      <Label htmlFor={fieldId} className="text-muted-foreground">
        {fieldLabel}
      </Label>
      <Input
        ref={inputRef}
        id={fieldId}
        value={name}
        maxLength={VIEW_NAME_MAX_LENGTH}
        autoComplete="off"
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={trimmed.length === 0}>
          {submitLabel}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {TOOLBAR_COPY.cancel}
        </Button>
      </div>
    </form>
  );
}
// Facet controls
//
// Three presentations, one rule: the toolbar offers exactly what the read offered and says in words
// why a filter is unavailable. A facet that admits several values opens a list of checkboxes; a facet
// that admits one opens a searchable picker; a facet that admits nothing here opens its reason.
interface FacetControlProps {
  readonly facet: FacetSpec;
  readonly selected: readonly string[];
  readonly onSelectionChange: (values: readonly string[]) => void;
  readonly pending: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly describedBy?: string;
}
function FacetTriggerContent({ facet, selectedCount }: { readonly facet: FacetSpec; readonly selectedCount: number }): ReactNode {
  return (
    <>
      <span className="truncate">
        <bdi>{facet.label}</bdi>
      </span>
      {selectedCount > 0 ? (
        <Badge variant="secondary" className="h-5 min-w-5 justify-center px-1 tabular-figures" aria-hidden="true">
          {countFormat.format(selectedCount)}
        </Badge>
      ) : null}
      <ChevronDownIcon aria-hidden="true" className="size-3" />
    </>
  );
}
function UnavailableFacetControl({ facet, reason, open, onOpenChange, describedBy }: FacetControlProps & { readonly reason: string }): ReactNode {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={<Button variant="outline" size="sm" className="max-w-full" aria-label={TOOLBAR_COPY.facetUnavailableLabel(facet.label)} aria-describedby={describedBy} />}>
        <span className="truncate">
          <bdi>{facet.label}</bdi>
        </span>
        <ChevronDownIcon aria-hidden="true" className="size-3" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
        <PopoverHeader>
          <PopoverTitle className="text-sm">
            <bdi>{facet.label}</bdi>
          </PopoverTitle>
        </PopoverHeader>
        <LayerNote>{reason}</LayerNote>
      </PopoverContent>
    </Popover>
  );
}
function MultiFacetControl({ facet, selected, onSelectionChange, pending, open, onOpenChange }: FacetControlProps): ReactNode {
  const optionBaseId = useId();
  const values = facet.values;
  const labels = useMemo(() => values.map((value) => value.label), [values]);
  const roving = useRovingFocus({ orientation: "vertical", preferred: (key) => selected.includes(key) });
  const currentIndex = (): number => {
    const activeKey = roving.activeKey;
    if (activeKey === null) {
      return -1;
    }
    for (let index = 0; index < values.length; index += 1) {
      if (values[index]?.id === activeKey) {
        return index;
      }
    }
    return -1;
  };
  const typeahead = useTypeahead({
    labels: () => labels,
    currentIndex,
    onMatch: (index) => {
      const value = values[index];
      if (value !== undefined) {
        roving.focusItem(value.id);
      }
    },
    enabled: values.length > 0,
  });
  function setValue(valueId: string, next: boolean): void {
    onSelectionChange(next ? withValueAdded(selected, valueId, true) : withValueRemoved(selected, valueId));
  }
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={<Button variant="outline" size="sm" className="max-w-full" aria-label={selected.length > 0 ? `${facet.label}, ${TOOLBAR_COPY.appliedCount(selected.length)}` : facet.label} />}>
        <FacetTriggerContent facet={facet} selectedCount={selected.length} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
        <PopoverHeader>
          <PopoverTitle className="text-sm">
            <bdi>{facet.label}</bdi>
          </PopoverTitle>
          <PopoverDescription className="text-xs">{`${TOOLBAR_COPY.acrossFacets} ${facet.multi ? TOOLBAR_COPY.withinFacet : TOOLBAR_COPY.singleValue}`}</PopoverDescription>
        </PopoverHeader>
        {pending && values.length === 0 ? (
          <div aria-busy="true">
            <span className="sr-only">{TOOLBAR_COPY.facetLoading}</span>
            <FacetLoading />
          </div>
        ) : values.length === 0 ? (
          <LayerNote>{TOOLBAR_COPY.facetEmpty}</LayerNote>
        ) : (
          <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto overscroll-contain">
            {values.map((value, index) => {
              const optionId = `${optionBaseId}-${index}`;
              const isSelected = selected.includes(value.id);
              return (
                <div key={value.id} className="flex items-start gap-2.5 rounded-xl px-2 py-1.5">
                  <Checkbox
                    {...roving.getItemProps(value.id, {
                      id: optionId,
                      checked: isSelected,
                      onCheckedChange: (checked: boolean) => {
                        setValue(value.id, checked);
                      },
                      onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
                        typeahead.onKeyDown(event);
                      },
                      className: "mt-0.5",
                    })}
                  />
                  <Label htmlFor={optionId} className="min-w-0 flex-1 cursor-pointer items-start font-normal leading-snug">
                    <span className="min-w-0 break-words">
                      <bdi>{value.label}</bdi>
                    </span>
                  </Label>
                  <FacetCount value={value} />
                </div>
              );
            })}
          </div>
        )}
        {selected.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => {
              onSelectionChange([]);
            }}
          >
            {TOOLBAR_COPY.clearFacet}
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
function SingleFacetControl({ facet, selected, onSelectionChange, pending }: FacetControlProps): ReactNode {
  const valueIds = useMemo(() => facet.values.map((value) => value.id), [facet.values]);
  const candidate = selected.length === 1 ? selected[0] : undefined;
  const current = candidate !== undefined && facetValueById(facet, candidate) !== undefined ? candidate : null;
  const loading = pending && facet.values.length === 0;
  return (
    <Combobox
      items={valueIds}
      value={current}
      itemToStringLabel={(valueId: string) => labelOfValue(facet, valueId)}
      onValueChange={(next: string | null) => {
        onSelectionChange(next === null ? [] : [next]);
      }}
    >
      <ComboboxInput aria-label={facet.label} placeholder={facet.label} showClear={current !== null} className="w-44 max-w-full" />
      <ComboboxContent className="w-64 max-w-[calc(100vw-2rem)]">
        {loading ? (
          <div className="p-3" aria-busy="true">
            <span className="sr-only">{TOOLBAR_COPY.facetLoading}</span>
            <FacetLoading />
          </div>
        ) : (
          <>
            <ComboboxEmpty>{TOOLBAR_COPY.facetEmpty}</ComboboxEmpty>
            <ComboboxList>
              {(valueId: string) => (
                <ComboboxItem key={valueId} value={valueId}>
                  <span className="min-w-0 flex-1 break-words">
                    <bdi>{labelOfValue(facet, valueId)}</bdi>
                  </span>
                  <FacetCount value={facetValueById(facet, valueId) ?? { id: valueId, label: valueId }} />
                </ComboboxItem>
              )}
            </ComboboxList>
          </>
        )}
      </ComboboxContent>
    </Combobox>
  );
}
function FacetControl(props: FacetControlProps & { readonly reason: string | null }): ReactNode {
  const { reason, ...rest } = props;
  if (reason !== null) {
    return <UnavailableFacetControl {...rest} reason={reason} />;
  }
  if (rest.facet.multi) {
    return <MultiFacetControl {...rest} />;
  }
  return <SingleFacetControl {...rest} />;
}
function FilterChip({ chip, onRemove }: { readonly chip: AppliedChip; readonly onRemove: () => void }): ReactNode {
  const text = `${chip.facetLabel}: ${chip.valueLabel}`;
  return (
    <Badge render={<button type="button" aria-label={`${TOOLBAR_COPY.removeFilter}: ${text}`} onClick={onRemove} />} variant="secondary" className="h-6 cursor-pointer gap-1.5 ps-2 pe-1.5">
      <span className="max-w-64 truncate">
        <bdi>{text}</bdi>
      </span>
      <XIcon aria-hidden="true" className="size-3 shrink-0" />
    </Badge>
  );
}
// Saved views
function plainSelection(applied: Readonly<Record<string, readonly string[]>>): Record<string, string[]> {
  const next: Record<string, string[]> = {};
  for (const [facetId, values] of Object.entries(applied)) {
    next[facetId] = [...values];
  }
  return next;
}
type ViewFormState = { readonly mode: "save" } | { readonly mode: "rename"; readonly viewId: string };

interface SavedViewActions {
  readonly onSaveView?: (draft: SavedViewDraft) => void;
  readonly onUpdateView?: (viewId: string) => void;
  readonly onRenameView?: (viewId: string, name: string) => void;
  readonly onDeleteView?: (viewId: string) => void;
  readonly onRepairView?: (viewId: string) => void;
}
function SavedViewRow({
  view,
  drift,
  inUse,
  onApply,
  onUpdate,
  onRename,
  onDelete,
  onRepair,
}: {
  readonly view: SavedView;
  readonly drift: SavedViewDrift;
  readonly inUse: boolean;
  readonly onApply: () => void;
  readonly onUpdate?: () => void;
  readonly onRename?: () => void;
  readonly onDelete?: () => void;
  readonly onRepair?: () => void;
}): ReactNode {
  const driftId = useId();
  const missingText = drift.missing.length === 0 ? "" : ` (${drift.missing.join(", ")})`;
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-border p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          <bdi>{view.name}</bdi>
        </span>
        {inUse ? <Badge variant="secondary">{TOOLBAR_COPY.inUse}</Badge> : null}
        {drift.drifted ? <StatusBadge label={TOOLBAR_COPY.drifted} tone="caution" /> : null}
      </div>
      {drift.drifted ? (
        <p id={driftId} className="text-xs leading-snug text-muted-foreground">
          {TOOLBAR_COPY.driftExplanation}
          {missingText}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        <Button size="xs" variant="outline" disabled={drift.drifted} aria-describedby={drift.drifted ? driftId : undefined} aria-label={TOOLBAR_COPY.viewActionLabel(TOOLBAR_COPY.applyView, view.name)} onClick={onApply}>
          {TOOLBAR_COPY.applyView}
        </Button>
        {onUpdate === undefined ? null : (
          <Button size="xs" variant="ghost" aria-label={TOOLBAR_COPY.viewActionLabel(TOOLBAR_COPY.updateView, view.name)} onClick={onUpdate}>
            {TOOLBAR_COPY.updateView}
          </Button>
        )}
        {onRename === undefined ? null : (
          <Button size="xs" variant="ghost" aria-label={TOOLBAR_COPY.viewActionLabel(TOOLBAR_COPY.renameView, view.name)} onClick={onRename}>
            {TOOLBAR_COPY.renameView}
          </Button>
        )}
        {drift.drifted && onRepair !== undefined ? (
          <Button size="xs" variant="secondary" aria-label={TOOLBAR_COPY.viewActionLabel(TOOLBAR_COPY.repairView, view.name)} onClick={onRepair}>
            <WrenchIcon aria-hidden="true" className="size-3" />
            {TOOLBAR_COPY.repairView}
          </Button>
        ) : null}
        {onDelete === undefined ? null : (
          <Button size="xs" variant="ghost" aria-label={TOOLBAR_COPY.viewActionLabel(TOOLBAR_COPY.deleteView, view.name)} onClick={onDelete}>
            {TOOLBAR_COPY.deleteView}
          </Button>
        )}
      </div>
    </li>
  );
}
function SavedViewsControl({
  views,
  facets,
  searchText,
  applied,
  currentQuery,
  actions,
  open,
  onOpenChange,
  onApplyView,
}: {
  readonly views: readonly SavedView[];
  readonly facets: readonly FacetSpec[];
  readonly searchText: string;
  readonly applied: Readonly<Record<string, readonly string[]>>;
  readonly currentQuery: SavedViewQuery;
  readonly actions: SavedViewActions;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onApplyView: (view: SavedView) => void;
}): ReactNode {
  const [form, setForm] = useState<ViewFormState | null>(null);
  let driftedCount = 0;
  for (const view of views) {
    if (driftOf(view, facets).drifted) {
      driftedCount += 1;
    }
  }
  const { onSaveView, onUpdateView, onRenameView, onDeleteView, onRepairView } = actions;
  const canSave = onSaveView !== undefined;
  function closeForm(): void {
    setForm(null);
  }
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={<Button variant="outline" size="sm" className="max-w-full" aria-label={driftedCount === 0 ? TOOLBAR_COPY.savedViews : `${TOOLBAR_COPY.savedViews}, ${driftedCount} needs repair`} />}>
        <BookmarkIcon aria-hidden="true" className="size-3.5" />
        <span className="truncate">{TOOLBAR_COPY.savedViews}</span>
        {driftedCount > 0 ? (
          <Badge variant="outline" className="h-5 min-w-5 justify-center px-1 tabular-figures">
            {countFormat.format(driftedCount)}
          </Badge>
        ) : null}
        <ChevronDownIcon aria-hidden="true" className="size-3" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 max-w-[calc(100vw-2rem)]">
        <PopoverHeader>
          <PopoverTitle className="text-sm">{TOOLBAR_COPY.savedViewsTitle}</PopoverTitle>
          <PopoverDescription className="text-xs">{TOOLBAR_COPY.savedViewsDescription}</PopoverDescription>
        </PopoverHeader>
        {views.length === 0 ? <LayerNote>{TOOLBAR_COPY.savedViewsEmpty}</LayerNote> : null}
        {views.length > 0 ? (
          <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto overscroll-contain">
            {views.map((view) => {
              if (form !== null && form.mode === "rename" && form.viewId === view.id) {
                return (
                  <li key={view.id} className="rounded-xl border border-border p-2">
                    <ViewNameForm
                      fieldLabel={TOOLBAR_COPY.renameViewName}
                      submitLabel={TOOLBAR_COPY.renameViewSubmit}
                      defaultValue={view.name}
                      onSubmit={(name) => {
                        onRenameView?.(view.id, name);
                        closeForm();
                      }}
                      onCancel={closeForm}
                    />
                  </li>
                );
              }
              return (
                <SavedViewRow
                  key={view.id}
                  view={view}
                  drift={driftOf(view, facets)}
                  inUse={viewIsInUse(view, applied, searchText)}
                  onApply={() => {
                    onApplyView(view);
                  }}
                  onUpdate={onUpdateView === undefined ? undefined : () => onUpdateView(view.id)}
                  onRename={
                    onRenameView === undefined
                      ? undefined
                      : () => {
                          setForm({ mode: "rename", viewId: view.id });
                        }
                  }
                  onDelete={onDeleteView === undefined ? undefined : () => onDeleteView(view.id)}
                  onRepair={onRepairView === undefined ? undefined : () => onRepairView(view.id)}
                />
              );
            })}
          </ul>
        ) : null}
        {canSave ? (
          <div className="border-t border-border pt-3">
            {form !== null && form.mode === "save" ? (
              <ViewNameForm
                fieldLabel={TOOLBAR_COPY.saveViewName}
                submitLabel={TOOLBAR_COPY.saveViewSubmit}
                onSubmit={(name) => {
                  onSaveView?.({ name, query: currentQuery });
                  closeForm();
                }}
                onCancel={closeForm}
              />
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setForm({ mode: "save" });
                }}
              >
                {TOOLBAR_COPY.saveView}
              </Button>
            )}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
// Columns
function ColumnsControl({ columns, columnVisibility, onChange }: { readonly columns: readonly ColumnSpec[]; readonly columnVisibility: ColumnVisibility; readonly onChange: (next: Record<string, boolean>) => void }): ReactNode {
  const visible = visibleColumnIds(columns, columnVisibility);
  function setColumn(columnId: string, shown: boolean): void {
    const next: Record<string, boolean> = {};
    for (const column of columns) {
      next[column.id] = columnVisibility[column.id] !== false;
    }
    next[columnId] = shown;
    onChange(next);
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="max-w-full" aria-label={`${TOOLBAR_COPY.columns}, ${countFormat.format(visible.length)} of ${countFormat.format(columns.length)} shown`} />}>
        <Columns3Icon aria-hidden="true" className="size-3.5" />
        <span className="hidden sm:inline">{TOOLBAR_COPY.columns}</span>
        <ChevronDownIcon aria-hidden="true" className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>{TOOLBAR_COPY.columnsTitle}</DropdownMenuLabel>
        {columns.map((column) => {
          const shown = columnVisibility[column.id] !== false;
          const locked = column.hideable === false || (shown && visible.length === 1);
          return (
            <DropdownMenuCheckboxItem
              key={column.id}
              checked={shown}
              disabled={locked}
              aria-label={TOOLBAR_COPY.columnActionLabel(column.label)}
              onCheckedChange={(checked: boolean) => {
                setColumn(column.id, checked);
              }}
            >
              <bdi>{column.label}</bdi>
            </DropdownMenuCheckboxItem>
          );
        })}
        <DropdownMenuSeparator />
        <p className="px-3 py-1.5 text-xs leading-snug text-muted-foreground">{TOOLBAR_COPY.columnsNote}</p>
        <DropdownMenuItem
          onClick={() => {
            onChange(allColumnsVisible(columns));
          }}
        >
          {TOOLBAR_COPY.showAllColumns}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
// The toolbar
const FACET_LAYER_PREFIX = "facet:";

const SAVED_VIEWS_LAYER = "saved-views";

const NO_SAVED_VIEWS: readonly SavedView[] = [];
const NO_COLUMNS: readonly ColumnSpec[] = [];
const NO_COLUMN_VISIBILITY: ColumnVisibility = {};

interface SearchState {
  readonly external: string;
  readonly text: string;
}
interface UnavailableFilterNote {
  readonly facetId: string;
  readonly label: string;
  readonly reason: string;
  readonly reasonId: string;
}
interface FacetControlEntry {
  readonly facet: FacetSpec;
  readonly reason: string | null;
  readonly reasonId: string;
}
/** The only filter surface in the application. */
export function QueryToolbar({
  label,
  search,
  facets,
  applied,
  onAppliedChange,
  savedViews = NO_SAVED_VIEWS,
  onSaveView,
  onUpdateView,
  onRenameView,
  onDeleteView,
  onRepairView,
  columns = NO_COLUMNS,
  columnVisibility = NO_COLUMN_VISIBILITY,
  onColumnVisibilityChange,
  amountRange,
  pending = false,
  className,
}: QueryToolbarProps): ReactNode {
  const searchFieldId = useId();
  const [openLayer, setOpenLayer] = useState<string | null>(null);
  const [searchState, setSearchState] = useState<SearchState>({ external: search.value, text: search.value });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emitRef = useRef(search.onChange);
  const debounceMs = search.debounceMs ?? DEFAULT_SEARCH_DEBOUNCE_MS;
  // The owner's callback is reached through a ref, so a parent that recreates it on every render
  // never restarts a debounce the worker is in the middle of typing into.
  useEffect(() => {
    emitRef.current = search.onChange;
  }, [search.onChange]);
  // An external change — a view applied, a filter cleared elsewhere, a restored query — wins over the
  // text being typed, and the field follows it. Adjusting during render rather than in an effect is
  // what keeps the two in step before the browser paints, and keeps the field from showing a stale
  // search beside a list that was read with a different one.
  if (searchState.external !== search.value) {
    setSearchState({ external: search.value, text: search.value });
  }
  const searchText = searchState.external === search.value ? searchState.text : search.value;
  // Typing settles before the query is dispatched, so a word is one read rather than one per letter.
  useEffect(() => {
    if (searchText === searchState.external) {
      return;
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      emitRef.current(searchText);
    }, debounceMs);
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [searchText, searchState.external, debounceMs]);
  const rangeFacetId = amountRange?.facetId ?? DEFAULT_AMOUNT_RANGE_FACET_ID;
  const currencyFacetId = amountRange?.currencyFacetId ?? DEFAULT_CURRENCY_FACET_ID;
  const singleCurrency = singleSelectedValue(applied, currencyFacetId);
  const rangeFacet = facetById(facets, rangeFacetId);
  const hasRangeValues = appliedValuesOf(applied, rangeFacetId).length > 0;
  const hasColumns = columns.length > 0 && onColumnVisibilityChange !== undefined;
  const showsSavedViews = savedViews.length > 0 || onSaveView !== undefined;
  // A range left behind when the currency selection stops naming exactly one currency would compare
  // amounts across currencies, which no surface may do, so the range is dropped rather than kept as
  // a filter the worker can no longer see the meaning of.
  useEffect(() => {
    if (rangeFacet === undefined || !hasRangeValues || singleCurrency !== null) {
      return;
    }
    onAppliedChange(withFacetValues(applied, rangeFacetId, []));
  }, [applied, hasRangeValues, onAppliedChange, rangeFacet, rangeFacetId, singleCurrency]);
  const chips = appliedChips(facets, applied, searchText);
  const currentQuery: SavedViewQuery = hasColumns ? { search: searchText, applied: plainSelection(applied), columnVisibility: { ...columnVisibility } } : { search: searchText, applied: plainSelection(applied) };
  function updateSearchText(next: string): void {
    setSearchState((previous) => (previous.text === next ? previous : { external: previous.external, text: next }));
  }
  function dispatchSearch(next: string): void {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    emitRef.current(next);
  }
  function commitSearch(): void {
    if (searchText === searchState.external) {
      return;
    }
    dispatchSearch(searchText);
  }
  function clearSearchText(): void {
    updateSearchText("");
    dispatchSearch("");
  }
  function clearAll(): void {
    updateSearchText("");
    dispatchSearch("");
    onAppliedChange({});
  }
  function setFacetValues(facetId: string, values: readonly string[]): void {
    onAppliedChange(withFacetValues(applied, facetId, values));
  }
  function reasonFor(facet: FacetSpec): string | null {
    const declared = facet.disabledReason;
    if (declared !== undefined && declared.trim() !== "") {
      return declared.trim();
    }
    if (facet.id === rangeFacetId && singleCurrency === null) {
      return TOOLBAR_COPY.currencyScopeReason;
    }
    return null;
  }
  function applyView(view: SavedView): void {
    updateSearchText(view.query.search);
    dispatchSearch(view.query.search);
    onAppliedChange(plainSelection(view.query.applied));
    if (view.query.columnVisibility !== undefined && onColumnVisibilityChange !== undefined) {
      onColumnVisibilityChange({ ...view.query.columnVisibility });
    }
    setOpenLayer(null);
  }
  // One pass decides every facet's availability, so the controls and the explanations rendered below
  // them come from the same decision and cannot disagree about whether a filter can be applied.
  const notesBaseId = useId();
  const facetControls: FacetControlEntry[] = [];
  const unavailableFilters: UnavailableFilterNote[] = [];
  facets.forEach((facet, index) => {
    const reason = reasonFor(facet);
    const reasonId = `${notesBaseId}-filter-${index}`;
    facetControls.push({ facet, reason, reasonId });
    if (reason !== null) {
      unavailableFilters.push({ facetId: facet.id, label: facet.label, reason, reasonId });
    }
  });
  return (
    <section data-slot="query-toolbar" aria-label={label} className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-48 flex-1 basis-56">
          <Label htmlFor={searchFieldId} className="sr-only">
            {TOOLBAR_COPY.searchLabel}
          </Label>
          <InputGroup>
            <InputGroupAddon align="inline-start">
              <SearchIcon aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              id={searchFieldId}
              type="search"
              value={searchText}
              placeholder={search.placeholder}
              autoComplete="off"
              enterKeyHint="search"
              onChange={(event) => {
                updateSearchText(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitSearch();
                }
              }}
              onBlur={commitSearch}
            />
            {searchText.length === 0 ? null : (
              <InputGroupAddon align="inline-end">
                <InputGroupButton size="icon-xs" variant="ghost" aria-label={TOOLBAR_COPY.clearSearch} onClick={clearSearchText}>
                  <XIcon aria-hidden="true" />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>
        </div>
        {facetControls.map(({ facet, reason, reasonId }) => {
          const layer = `${FACET_LAYER_PREFIX}${facet.id}`;
          return (
            <FacetControl
              key={facet.id}
              facet={facet}
              selected={appliedValuesOf(applied, facet.id)}
              onSelectionChange={(values) => {
                setFacetValues(facet.id, values);
              }}
              pending={pending}
              open={openLayer === layer}
              onOpenChange={(open) => {
                setOpenLayer(open ? layer : null);
              }}
              reason={reason}
              describedBy={reason === null ? undefined : reasonId}
            />
          );
        })}
        {showsSavedViews ? (
          <SavedViewsControl
            views={savedViews}
            facets={facets}
            searchText={searchText}
            applied={applied}
            currentQuery={currentQuery}
            actions={{ onSaveView, onUpdateView, onRenameView, onDeleteView, onRepairView }}
            open={openLayer === SAVED_VIEWS_LAYER}
            onOpenChange={(open) => {
              setOpenLayer(open ? SAVED_VIEWS_LAYER : null);
            }}
            onApplyView={applyView}
          />
        ) : null}
        {hasColumns ? <ColumnsControl columns={columns} columnVisibility={columnVisibility} onChange={onColumnVisibilityChange} /> : null}
        {chips.length === 0 ? null : (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            {TOOLBAR_COPY.clearAll}
          </Button>
        )}
      </div>
      {chips.length > 0 ? (
        <ul aria-label={TOOLBAR_COPY.activeFilters} className="flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <li key={chip.kind === "search" ? "search" : `${chip.facetId}\u001f${chip.valueId}`}>
              <FilterChip
                chip={chip}
                onRemove={() => {
                  if (chip.kind === "search") {
                    clearSearchText();
                    return;
                  }
                  setFacetValues(chip.facetId, withValueRemoved(appliedValuesOf(applied, chip.facetId), chip.valueId));
                }}
              />
            </li>
          ))}
        </ul>
      ) : facets.length === 0 ? null : (
        <p className="text-xs text-muted-foreground">{TOOLBAR_COPY.noFilterApplied}</p>
      )}
      {unavailableFilters.length === 0 ? null : (
        <ul className="flex flex-col gap-1">
          {unavailableFilters.map((filter) => (
            <li key={filter.facetId} id={filter.reasonId} className="text-xs leading-snug text-muted-foreground">
              <span className="font-medium text-foreground">{`${filter.label}: `}</span>
              {filter.reason}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
export default QueryToolbar;
