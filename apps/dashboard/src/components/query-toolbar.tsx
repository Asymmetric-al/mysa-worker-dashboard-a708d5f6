"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { ChevronDownIcon, SearchIcon, XIcon } from "lucide-react";
import StatusBadge, { valueStateWord, type StatusTone } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { useRovingFocus, useTypeahead } from "@/lib/ui-sdk";
import type { ValueState } from "@/modules/data-service/envelope";
/** One value a facet offers. */
export type FacetValueSpec = { readonly id: string; readonly label: string; readonly count?: number; readonly countState?: ValueState; readonly tone?: StatusTone };
/** One filter the read envelope offers, with the values it admits in the caller's scope. */
export type FacetSpec = { readonly id: string; readonly label: string; readonly values: readonly FacetValueSpec[]; readonly multi: boolean; readonly disabledReason?: string };
/** Which facet is the amount range and which is the currency it is scoped to. */
export type AmountRangeScope = { readonly facetId?: string; readonly currencyFacetId?: string };
/** The search field, controlled by the owner and debounced here. */
export type QueryToolbarSearch = { readonly value: string; readonly onChange: (value: string) => void; readonly placeholder: string; readonly debounceMs?: number };
/** Props of {@link QueryToolbar}. */
export type QueryToolbarProps = {
  readonly label: string;
  readonly search: QueryToolbarSearch;
  readonly facets: readonly FacetSpec[];
  readonly applied: Readonly<Record<string, readonly string[]>>;
  readonly onAppliedChange: (next: Record<string, string[]>) => void;
  readonly amountRange?: AmountRangeScope;
  readonly pending?: boolean;
  readonly className?: string;
};
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
} as const;
const DEFAULT_SEARCH_DEBOUNCE_MS = 250;
const LOADING_PLACEHOLDER_ROWS = 4;
const countFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const DEFAULT_AMOUNT_RANGE_FACET_ID = "amount-range";
const DEFAULT_CURRENCY_FACET_ID = "currency";
const appliedValuesOf = (applied: Readonly<Record<string, readonly string[]>>, facetId: string): readonly string[] => applied[facetId] ?? [];
function withFacetValues(applied: Readonly<Record<string, readonly string[]>>, facetId: string, values: readonly string[]): Record<string, string[]> {
  const next: Record<string, string[]> = Object.fromEntries(
    Object.entries(applied)
      .filter(([key]) => key !== facetId)
      .map(([key, current]) => [key, [...current]]),
  );
  if (values.length > 0) next[facetId] = [...values];
  return next;
}
const withValueAdded = (current: readonly string[], valueId: string, multi: boolean): readonly string[] => (!multi ? [valueId] : current.includes(valueId) ? current : [...current, valueId]);
const withValueRemoved = (current: readonly string[], valueId: string): readonly string[] => current.filter((id) => id !== valueId);
const facetById = (facets: readonly FacetSpec[], facetId: string): FacetSpec | undefined => facets.find((facet) => facet.id === facetId);
const facetValueById = (facet: FacetSpec, valueId: string): FacetValueSpec | undefined => facet.values.find((value) => value.id === valueId);
const labelOfValue = (facet: FacetSpec, valueId: string): string => facetValueById(facet, valueId)?.label ?? valueId;
function singleSelectedValue(applied: Readonly<Record<string, readonly string[]>>, facetId: string): string | null {
  const values = appliedValuesOf(applied, facetId);
  const [only] = values;
  return values.length === 1 && only !== undefined ? only : null;
}
type AppliedChip = { readonly kind: "facet"; readonly facetId: string; readonly valueId: string; readonly facetLabel: string; readonly valueLabel: string } | { readonly kind: "search"; readonly facetLabel: string; readonly valueLabel: string };
function appliedChips(facets: readonly FacetSpec[], applied: Readonly<Record<string, readonly string[]>>, searchText: string): readonly AppliedChip[] {
  const chips: AppliedChip[] = [];
  if (searchText.length > 0) chips.push({ kind: "search", facetLabel: TOOLBAR_COPY.searchLabel, valueLabel: searchText });
  const offered = new Set<string>();
  for (const facet of facets) {
    offered.add(facet.id);
    for (const valueId of appliedValuesOf(applied, facet.id)) chips.push({ kind: "facet", facetId: facet.id, valueId, facetLabel: facet.label, valueLabel: labelOfValue(facet, valueId) });
  }
  for (const [facetId, values] of Object.entries(applied)) {
    if (offered.has(facetId)) continue;
    for (const valueId of values) chips.push({ kind: "facet", facetId, valueId, facetLabel: facetId, valueLabel: valueId });
  }
  return chips;
}
type FacetCountView = { readonly kind: "number"; readonly text: string } | { readonly kind: "number-with-state"; readonly text: string; readonly label: string; readonly tone: StatusTone } | { readonly kind: "word"; readonly label: string; readonly tone: StatusTone } | { readonly kind: "none" };
function countViewOf(value: FacetValueSpec): FacetCountView {
  const state = value.countState;
  const counted = value.count !== undefined && Number.isFinite(value.count) ? countFormat.format(Math.max(0, Math.trunc(value.count))) : undefined;
  if (state !== undefined && state !== "value" && state !== "zero") {
    const word = valueStateWord(state);
    if (word !== undefined) return state === "incomplete-subtotal" && counted !== undefined ? { kind: "number-with-state", text: counted, label: word.label, tone: word.tone } : { kind: "word", label: word.label, tone: word.tone };
  }
  if (counted !== undefined) return { kind: "number", text: counted };
  if (state === "zero") return { kind: "number", text: countFormat.format(0) };
  return { kind: "none" };
}
function FacetCount({ value }: { readonly value: FacetValueSpec }): ReactNode {
  const view = countViewOf(value);
  if (view.kind === "number") return <span className="ms-auto shrink-0 tabular-figures text-xs text-muted-foreground">{view.text}</span>;
  if (view.kind === "number-with-state") {
    return (
      <span className="ms-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1">
        <span className="tabular-figures text-xs text-muted-foreground">{view.text}</span>
        <StatusBadge label={view.label} tone={view.tone} srPrefix="Matches" />
      </span>
    );
  }
  if (view.kind === "word") return <StatusBadge label={view.label} tone={view.tone} srPrefix="Matches" className="ms-auto shrink-0" />;
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
const LayerNote = ({ children }: { readonly children: ReactNode }): ReactNode => <p className="type-supporting">{children}</p>;
type FacetControlProps = { readonly facet: FacetSpec; readonly selected: readonly string[]; readonly onSelectionChange: (values: readonly string[]) => void; readonly pending: boolean; readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly describedBy?: string };
const FacetTriggerContent = ({ facet, selectedCount }: { readonly facet: FacetSpec; readonly selectedCount: number }): ReactNode => (
  <>
    <bdi className="truncate">{facet.label}</bdi>
    {selectedCount > 0 ? (
      <Badge variant="secondary" className="h-5 min-w-5 justify-center px-1 tabular-figures" aria-hidden="true">
        {countFormat.format(selectedCount)}
      </Badge>
    ) : null}
    <ChevronDownIcon aria-hidden="true" className="size-3" />
  </>
);
/** The one popover every facet control opens: the trigger that states the filter and how much of it is chosen, the filter's own title and sentence, and the body the control renders. A filter that cannot be used states why in that body instead of offering values. */
type FacetPopoverProps = { readonly facet: FacetSpec; readonly selectedCount: number; readonly label: string; readonly description?: string; readonly describedBy?: string; readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly children: ReactNode };
function FacetPopover(props: FacetPopoverProps): ReactNode {
  const { facet, selectedCount, label, description, describedBy, open, onOpenChange, children } = props;
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={<Button variant="outline" size="sm" className="max-w-full" aria-label={label} aria-describedby={describedBy} />}>
        <FacetTriggerContent facet={facet} selectedCount={selectedCount} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
        <PopoverHeader>
          <PopoverTitle className="text-sm">
            <bdi>{facet.label}</bdi>
          </PopoverTitle>
          {description === undefined ? null : <PopoverDescription className="text-xs">{description}</PopoverDescription>}
        </PopoverHeader>
        {children}
      </PopoverContent>
    </Popover>
  );
}
const UnavailableFacetControl = ({ facet, open, onOpenChange, describedBy, reason }: FacetControlProps & { readonly reason: string }): ReactNode => (
  <FacetPopover facet={facet} selectedCount={0} label={TOOLBAR_COPY.facetUnavailableLabel(facet.label)} describedBy={describedBy} open={open} onOpenChange={onOpenChange}>
    <LayerNote>{reason}</LayerNote>
  </FacetPopover>
);
function MultiFacetControl({ facet, selected, onSelectionChange, pending, open, onOpenChange }: FacetControlProps): ReactNode {
  const optionBaseId = useId();
  const values = facet.values;
  const labels = useMemo(() => values.map((value) => value.label), [values]);
  const roving = useRovingFocus({ orientation: "vertical", preferred: (key) => selected.includes(key) });
  const currentIndex = (): number => (roving.activeKey === null ? -1 : values.findIndex((value) => value.id === roving.activeKey));
  const typeahead = useTypeahead({
    labels: () => labels,
    currentIndex,
    onMatch: (index) => {
      const value = values[index];
      if (value !== undefined) roving.focusItem(value.id);
    },
    enabled: values.length > 0,
  });
  const setValue = (valueId: string, next: boolean): void => onSelectionChange(next ? withValueAdded(selected, valueId, true) : withValueRemoved(selected, valueId));
  const label = selected.length > 0 ? `${facet.label}, ${TOOLBAR_COPY.appliedCount(selected.length)}` : facet.label;
  return (
    <FacetPopover facet={facet} selectedCount={selected.length} label={label} description={`${TOOLBAR_COPY.acrossFacets} ${facet.multi ? TOOLBAR_COPY.withinFacet : TOOLBAR_COPY.singleValue}`} open={open} onOpenChange={onOpenChange}>
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
                <Checkbox {...roving.getItemProps(value.id, { id: optionId, checked: isSelected, onCheckedChange: (checked: boolean) => setValue(value.id, checked), onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => typeahead.onKeyDown(event), className: "mt-0.5" })} />
                <Label htmlFor={optionId} className="min-w-0 flex-1 cursor-pointer items-start font-normal leading-snug">
                  <bdi className="min-w-0 break-words">{value.label}</bdi>
                </Label>
                <FacetCount value={value} />
              </div>
            );
          })}
        </div>
      )}
      {selected.length > 0 ? (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => onSelectionChange([])}>
          {TOOLBAR_COPY.clearFacet}
        </Button>
      ) : null}
    </FacetPopover>
  );
}
function SingleFacetControl({ facet, selected, onSelectionChange, pending }: FacetControlProps): ReactNode {
  const valueIds = useMemo(() => facet.values.map((value) => value.id), [facet.values]);
  const candidate = selected.length === 1 ? selected[0] : undefined;
  const current = candidate !== undefined && facetValueById(facet, candidate) !== undefined ? candidate : null;
  const loading = pending && facet.values.length === 0;
  return (
    <Combobox items={valueIds} value={current} itemToStringLabel={(valueId: string) => labelOfValue(facet, valueId)} onValueChange={(next: string | null) => onSelectionChange(next === null ? [] : [next])}>
      <ComboboxInput aria-label={facet.label} placeholder={facet.label} showClear={current !== null} className="w-44 max-w-full" />
      <ComboboxContent className="w-80 max-w-[calc(100vw-2rem)]">
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
                  <bdi className="min-w-0 flex-1 break-words">{labelOfValue(facet, valueId)}</bdi>
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
  if (reason !== null) return <UnavailableFacetControl {...rest} reason={reason} />;
  if (rest.facet.multi) return <MultiFacetControl {...rest} />;
  return <SingleFacetControl {...rest} />;
}
function FilterChip({ chip, onRemove }: { readonly chip: AppliedChip; readonly onRemove: () => void }): ReactNode {
  const text = `${chip.facetLabel}: ${chip.valueLabel}`;
  return (
    <Badge render={<button type="button" aria-label={`${TOOLBAR_COPY.removeFilter}: ${text}`} onClick={onRemove} />} variant="secondary" className="h-6 cursor-pointer gap-1.5 ps-2 pe-1.5">
      <bdi className="max-w-64 truncate">{text}</bdi>
      <XIcon aria-hidden="true" className="size-3 shrink-0" />
    </Badge>
  );
}
const FACET_LAYER_PREFIX = "facet:";
type SearchState = { readonly external: string; readonly text: string };
type UnavailableFilterNote = { readonly facetId: string; readonly label: string; readonly reason: string; readonly reasonId: string };
type FacetControlEntry = { readonly facet: FacetSpec; readonly reason: string | null; readonly reasonId: string };
/** The only filter surface in the application. */
export function QueryToolbar({ label, search, facets, applied, onAppliedChange, amountRange, pending = false, className }: QueryToolbarProps): ReactNode {
  const searchFieldId = useId();
  const [openLayer, setOpenLayer] = useState<string | null>(null);
  const [searchState, setSearchState] = useState<SearchState>({ external: search.value, text: search.value });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emitRef = useRef(search.onChange);
  const debounceMs = search.debounceMs ?? DEFAULT_SEARCH_DEBOUNCE_MS;
  useEffect(() => {
    emitRef.current = search.onChange;
  }, [search.onChange]);
  if (searchState.external !== search.value) setSearchState({ external: search.value, text: search.value });
  const searchText = searchState.external === search.value ? searchState.text : search.value;
  useEffect(() => {
    if (searchText === searchState.external) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      emitRef.current(searchText);
    }, debounceMs);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [searchText, searchState.external, debounceMs]);
  const rangeFacetId = amountRange?.facetId ?? DEFAULT_AMOUNT_RANGE_FACET_ID;
  const currencyFacetId = amountRange?.currencyFacetId ?? DEFAULT_CURRENCY_FACET_ID;
  const singleCurrency = singleSelectedValue(applied, currencyFacetId);
  const rangeFacet = facetById(facets, rangeFacetId);
  const hasRangeValues = appliedValuesOf(applied, rangeFacetId).length > 0;
  useEffect(() => {
    if (rangeFacet === undefined || !hasRangeValues || singleCurrency !== null) return;
    onAppliedChange(withFacetValues(applied, rangeFacetId, []));
  }, [applied, hasRangeValues, onAppliedChange, rangeFacet, rangeFacetId, singleCurrency]);
  const chips = appliedChips(facets, applied, searchText);
  const updateSearchText = (next: string): void => setSearchState((previous) => (previous.text === next ? previous : { external: previous.external, text: next }));
  const searchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    commitSearch();
  };
  function dispatchSearch(next: string): void {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    emitRef.current(next);
  }
  function commitSearch(): void {
    if (searchText === searchState.external) return;
    dispatchSearch(searchText);
  }
  function clearSearchText(): void {
    updateSearchText("");
    dispatchSearch("");
  }
  function clearAll(): void {
    clearSearchText();
    onAppliedChange({});
  }
  const setFacetValues = (facetId: string, values: readonly string[]): void => onAppliedChange(withFacetValues(applied, facetId, values));
  const reasonFor = (facet: FacetSpec): string | null => {
    const declared = facet.disabledReason;
    if (declared !== undefined && declared.trim() !== "") return declared.trim();
    return facet.id === rangeFacetId && singleCurrency === null ? TOOLBAR_COPY.currencyScopeReason : null;
  };
  const notesBaseId = useId();
  const facetControls: readonly FacetControlEntry[] = facets.map((facet, index) => ({ facet, reason: reasonFor(facet), reasonId: `${notesBaseId}-filter-${index}` }));
  const unavailableFilters: readonly UnavailableFilterNote[] = facetControls.flatMap(({ facet, reason, reasonId }) => (reason === null ? [] : [{ facetId: facet.id, label: facet.label, reason, reasonId }]));
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
            <InputGroupInput {...{ id: searchFieldId, type: "search", value: searchText, placeholder: search.placeholder, autoComplete: "off", enterKeyHint: "search", onChange: (event) => updateSearchText(event.target.value), onKeyDown: searchKeyDown, onBlur: commitSearch }} />
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
          const selectedValues = appliedValuesOf(applied, facet.id);
          const describedBy = reason === null ? undefined : reasonId;
          return <FacetControl key={facet.id} facet={facet} selected={selectedValues} onSelectionChange={(values) => setFacetValues(facet.id, values)} pending={pending} open={openLayer === layer} onOpenChange={(open) => setOpenLayer(open ? layer : null)} reason={reason} describedBy={describedBy} />;
        })}
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
