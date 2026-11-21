"use client";

/**
 * The one search, facet and saved-view toolbar that every list and report composes.
 *
 * Why it exists, and why it is one component rather than a bar per feature. Every list in this
 * application asks the same four questions — what am I searching for, which values am I keeping,
 * which stored view am I in, and which columns do I read — and the specification fixes the answers
 * once: filters combine with AND across facets and OR among the values selected inside one facet, a
 * saved view stores choices and never records, and an amount range is only ever compared inside a
 * single currency. Four organisations of that logic would be four chances to disagree, so this
 * component is the only filter surface in the application.
 *
 * What it does not do. It never filters, sorts, slices, counts or aggregates a result. The service
 * applies the whole query to the whole authorised dataset and the toolbar only *names* the query: it
 * reports the values the worker chose, the text they typed and the columns they want, and it renders
 * the facets the read envelope actually offered. A facet the caller may not use is never invented
 * here, and a count it prints is the whole-result count it was given — where the envelope withheld a
 * count, its {@link ValueState} word is printed instead of a zero, because a withheld count and a
 * genuine zero are different facts.
 *
 * It holds no record data. Its whole state is which layer is open and the text being typed: the
 * search field is debounced but its value is controlled by the owner, applying a saved view
 * dispatches the owner's own callbacks, and nothing here caches a result. Query results live in the
 * owner's TanStack Query cache as envelopes only.
 *
 * Filters survive a detail visit because the owner holds them in its query state and passes the same
 * `applied` map back in; this component rebuilds its display from that map alone, so returning from a
 * record restores the identical selection, the same chips and the same unapplied facets.
 *
 * Keyboard and pointer parity. Every facet opens with Enter or Space, its values move with the arrow
 * keys and Home/End through the UI SDK's roving focus, each value toggles with Space, Escape closes
 * the layer and focus returns to the trigger. List navigation, typeahead and dismissal all arrive
 * through `@/lib/ui-sdk` and the installed design-system primitives; this file imports no primitive
 * library of its own, so a behaviour the platform lacks is fixed once in the adapter rather than
 * here. No affordance requires a drag (WCAG 2.2 2.5.7): values are chosen from a popover and columns
 * from a menu, both of which are single-pointer and keyboard operable.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";

import {
  BookmarkIcon,
  ChevronDownIcon,
  Columns3Icon,
  SearchIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";

import StatusBadge, { valueStateWord, type StatusTone } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { useRovingFocus, useTypeahead } from "@/lib/ui-sdk";
import type { ValueState } from "@/modules/data-service/envelope";

// ---------------------------------------------------------------------------------------------
// The public contract
// ---------------------------------------------------------------------------------------------

/**
 * One value a facet offers.
 *
 * `id` is the identifier the service filters by and `label` is what the worker reads; the two are
 * never assumed to be the same string. `count` is the whole-result count the read reported for this
 * value — a genuine `0` prints as `0` — and `countState` qualifies it: a state whose count is not a
 * number at all (withheld, unknown, unavailable) prints as its word, and an incomplete subtotal
 * prints its number with the state's own word beside it.
 */
export interface FacetValueSpec {
  readonly id: string;
  readonly label: string;
  /** The whole-result count of matching records for this value, when the read supplied one. */
  readonly count?: number;
  /**
   * The state of `count`. `withheld`, `unknown` and `unavailable` print as words and never as a
   * number; `incomplete-subtotal` prints its number with the state's word beside it, because the
   * figure is known and only the coverage behind it is partial.
   */
  readonly countState?: ValueState;
  /** The tone of a value that carries a condition of its own, for example an expired referral status. */
  readonly tone?: StatusTone;
}

/**
 * One filter the read envelope offers, with the values it admits in the caller's scope.
 *
 * The toolbar renders exactly the facets it is given: it invents no facet, admits no value the
 * envelope withheld and orders values as supplied. `multi` is the OR-inside-a-facet half of the
 * rule — a facet that admits several values lets the worker select them independently.
 */
export interface FacetSpec {
  readonly id: string;
  readonly label: string;
  /** The values this facet offers, in the order the read reported them. */
  readonly values: readonly FacetValueSpec[];
  /** Whether several values may be selected at once, combined with OR inside this facet. */
  readonly multi: boolean;
  /**
   * Why this facet cannot be applied now, as the read reported it. When present the sentence is
   * rendered as visible text beside the control — a silently disabled filter is a defect, because a
   * worker cannot tell an unavailable filter from a broken one.
   */
  readonly disabledReason?: string;
}

/** One column the owner may show or hide. Columns absent from the menu are not configurable here. */
export interface ColumnSpec {
  readonly id: string;
  readonly label: string;
  /** Whether the column may be hidden. Defaults to `true`; a non-hideable column is always visible. */
  readonly hideable?: boolean;
}

/** Column id to visibility. An absent id is visible; `false` hides the column. */
export type ColumnVisibility = Readonly<Record<string, boolean>>;

/**
 * Everything a saved view stores: the search text, the values selected per facet and, when the
 * surface offers configurable columns, the visible set. Sort, page and page size belong to the
 * owner's query state and are not stored here, so a view never silently changes the row the worker
 * was reading.
 */
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
  /** The stored revision, so an Update or a Delete can present the revision it expects. */
  readonly revision?: string;
}

/** The choices a new view would store, as the toolbar hands them to `onSaveView`. */
export interface SavedViewDraft {
  readonly name: string;
  readonly query: SavedViewQuery;
}

/**
 * Which facet is the amount range and which is the currency it is scoped to.
 *
 * The rule is that an amount range is compared only inside one selected currency (AAP 0.8.1), so the
 * range is refused while no single currency is selected. The identifiers default to the roster's own
 * vocabulary; a surface that names its facets differently states them here rather than weakening the
 * rule.
 */
export interface AmountRangeScope {
  /** The facet whose values are amount buckets. Defaults to `amount-range`. */
  readonly facetId?: string;
  /** The facet whose single selected value scopes the range. Defaults to `currency`. */
  readonly currencyFacetId?: string;
}

/** The search field, controlled by the owner and debounced here. */
export interface QueryToolbarSearch {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
  /** How long typing settles before the query is dispatched. Defaults to 250 ms. */
  readonly debounceMs?: number;
}

/** Props of {@link QueryToolbar}. */
export interface QueryToolbarProps {
  /**
   * The toolbar's accessible name, announced as its region label. State the subject, for example
   * "Partner roster filters" — never a count, which belongs to the read.
   */
  readonly label: string;
  /** The search field, controlled and debounced. */
  readonly search: QueryToolbarSearch;
  /** The facets the read envelope offers, in display order. The toolbar invents none. */
  readonly facets: readonly FacetSpec[];
  /** The values selected per facet id. AND across facets; OR among the values of one facet. */
  readonly applied: Readonly<Record<string, readonly string[]>>;
  /**
   * Called with the whole selection after any change, as a fresh plain record, so the owner can put
   * it straight into its query state. Keys with no selected values are dropped.
   */
  readonly onAppliedChange: (next: Record<string, string[]>) => void;
  /** The views the owner stored for this surface. Omit where the surface stores none. */
  readonly savedViews?: readonly SavedView[];
  /** Called with a name and the choices on screen when the worker saves a new view. */
  readonly onSaveView?: (draft: SavedViewDraft) => void;
  /** Called when the worker chooses to overwrite a stored view with the choices on screen. */
  readonly onUpdateView?: (viewId: string) => void;
  /** Called with the view and the new name when the worker renames it. */
  readonly onRenameView?: (viewId: string, name: string) => void;
  /** Called when the worker deletes a stored view. No record is touched by deleting a view. */
  readonly onDeleteView?: (viewId: string) => void;
  /** Called when the worker repairs a view that refers to a filter the source no longer offers. */
  readonly onRepairView?: (viewId: string) => void;
  /** The configurable columns this surface offers. Omit where the surface has no column menu. */
  readonly columns?: readonly ColumnSpec[];
  /** Which columns are visible, keyed by column id. */
  readonly columnVisibility?: ColumnVisibility;
  /** Called with the whole visibility map after a change, as a fresh plain record. */
  readonly onColumnVisibilityChange?: (next: Record<string, boolean>) => void;
  /** Which facet is the amount range and which the currency it is scoped to. */
  readonly amountRange?: AmountRangeScope;
  /**
   * True while the facet read is in flight. The facet popovers then show placeholders and say they
   * are loading, because "no options" while a read is in flight is a false statement about the data.
   */
  readonly pending?: boolean;
  /** Layout classes for the toolbar itself. Colour and spacing come from the token scale. */
  readonly className?: string;
}

// ---------------------------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------------------------

/**
 * Every sentence this toolbar says, declared once.
 *
 * The wording is the release's own: filters combine so that "every selected filter must match" and
 * so that inside one filter "any selected value may match", an amount range belongs to one currency,
 * and a saved view's repair restores the choices rather than the records. Semantics and the unit of
 * comparison are stated in words beside the control that needs them, because a filter whose scope is
 * only implied is one a worker can misread.
 */
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
  currencyScopeReason:
    "Amounts in different currencies are not compared, so choose one currency before setting an amount range.",
  savedViews: "Saved views",
  savedViewsTitle: "Saved views",
  savedViewsDescription:
    "A view stores your search, filters and columns. It never changes a record, and it is only replaced when you choose Update.",
  savedViewsEmpty:
    "No view is stored for this surface yet. Name the choices on screen to keep them.",
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
  driftExplanation:
    "This view refers to a filter this context no longer offers, so it is not applied as it stands. Repairing saves the selection again; the view and every record are otherwise unchanged.",
  viewActionLabel: (action: string, view: string): string => `${action}: ${view}`,
  columns: "Columns",
  columnsTitle: "Columns",
  columnsNote: "At least one column stays visible, so the list always shows something to read.",
  showAllColumns: "Show all columns",
  columnActionLabel: (column: string): string => `Show the ${column} column`,
} as const;

/** How long typing settles before the search dispatches, unless the caller states its own delay. */
const DEFAULT_SEARCH_DEBOUNCE_MS = 250;

/** How many placeholder rows a facet shows while its options are in flight. */
const LOADING_PLACEHOLDER_ROWS = 4;

/**
 * Counts are grouped with one fixed locale rather than the reader's.
 *
 * The toolbar renders on the server and again in the browser, and an environment-derived format would
 * produce two different strings for the same count and trip hydration. Only fragment-free integers are
 * formatted here, so a fixed grouping is faithful.
 */
const countFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** The facet an unconfigured surface is assumed to bucket amounts in. */
const DEFAULT_AMOUNT_RANGE_FACET_ID = "amount-range";

/** The facet an unconfigured surface is assumed to select its single currency in. */
const DEFAULT_CURRENCY_FACET_ID = "currency";

/** The longest name a saved view may carry. */
const VIEW_NAME_MAX_LENGTH = 80;

// ---------------------------------------------------------------------------------------------
// Pure query helpers
//
// Each of these names the query the worker chose and returns a fresh value. None of them reads a
// record, so "which rows match" never becomes a question this file answers.
// ---------------------------------------------------------------------------------------------

/** The values selected for one facet, or an empty list when the facet has none. */
function appliedValuesOf(
  applied: Readonly<Record<string, readonly string[]>>,
  facetId: string,
): readonly string[] {
  const values = applied[facetId];
  return values === undefined ? [] : values;
}

/** The whole selection with one facet's values replaced, or dropped when nothing is selected there. */
function withFacetValues(
  applied: Readonly<Record<string, readonly string[]>>,
  facetId: string,
  values: readonly string[],
): Record<string, string[]> {
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

/** The selection with one value added. A single-value facet replaces whatever it held. */
function withValueAdded(
  current: readonly string[],
  valueId: string,
  multi: boolean,
): readonly string[] {
  if (!multi) {
    return [valueId];
  }
  return current.includes(valueId) ? current : [...current, valueId];
}

/** The selection with one value removed, and nothing else changed. */
function withValueRemoved(current: readonly string[], valueId: string): readonly string[] {
  const next: string[] = [];
  for (const id of current) {
    if (id !== valueId) {
      next.push(id);
    }
  }
  return next;
}

/** Whether two value lists hold the same identifiers, in any order. */
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

/** Whether two selections name the same query selection. */
function sameSelection(
  left: Readonly<Record<string, readonly string[]>>,
  right: Readonly<Record<string, readonly string[]>>,
): boolean {
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

/** The facet with this identifier, when the read offered it. */
function facetById(facets: readonly FacetSpec[], facetId: string): FacetSpec | undefined {
  for (const facet of facets) {
    if (facet.id === facetId) {
      return facet;
    }
  }
  return undefined;
}

/** The value with this identifier inside one facet, when the read offered it. */
function facetValueById(facet: FacetSpec, valueId: string): FacetValueSpec | undefined {
  for (const value of facet.values) {
    if (value.id === valueId) {
      return value;
    }
  }
  return undefined;
}

/** The label of one offered value, falling back to the identifier the query holds. */
function labelOfValue(facet: FacetSpec, valueId: string): string {
  const value = facetValueById(facet, valueId);
  return value === undefined ? valueId : value.label;
}

/** Whether a facet still offers a value a stored view refers to. */
function offersValue(facet: FacetSpec, valueId: string): boolean {
  return facetValueById(facet, valueId) !== undefined;
}

/**
 * The single selected value of a facet, or `null` when it holds none or several.
 *
 * Used for the currency scope: an amount range is comparable only when exactly one currency is
 * selected, because two currencies share no unit to compare in.
 */
function singleSelectedValue(
  applied: Readonly<Record<string, readonly string[]>>,
  facetId: string,
): string | null {
  const values = appliedValuesOf(applied, facetId);
  if (values.length !== 1) {
    return null;
  }
  const [only] = values;
  return only === undefined ? null : only;
}

/** One removable filter: the value chosen in one facet, with the words that name both. */
interface AppliedChip {
  readonly facetId: string;
  readonly valueId: string;
  readonly facetLabel: string;
  readonly valueLabel: string;
}

/**
 * Every selected value as its own chip, in facet order.
 *
 * A facet the envelope no longer offers can still carry a selected value — a facet withheld in this
 * context, for instance — so its chip is rendered from the identifiers alone. Dropping such a chip
 * would leave a filter in the query that the worker could neither see nor remove.
 */
function appliedChips(
  facets: readonly FacetSpec[],
  applied: Readonly<Record<string, readonly string[]>>,
): readonly AppliedChip[] {
  const chips: AppliedChip[] = [];
  const offered = new Set<string>();
  for (const facet of facets) {
    offered.add(facet.id);
    for (const valueId of appliedValuesOf(applied, facet.id)) {
      chips.push({
        facetId: facet.id,
        valueId,
        facetLabel: facet.label,
        valueLabel: labelOfValue(facet, valueId),
      });
    }
  }
  for (const [facetId, values] of Object.entries(applied)) {
    if (offered.has(facetId)) {
      continue;
    }
    for (const valueId of values) {
      chips.push({ facetId, valueId, facetLabel: facetId, valueLabel: valueId });
    }
  }
  return chips;
}

/**
 * How a facet value's count renders: a number, a number carrying its state's word, a state word
 * alone, or nothing.
 *
 * `number-with-state` is the one variant that carries both, because exactly one state carries a
 * figure as well as a condition: a partial subtotal is a real count over coverage the source did not
 * complete, so it prints its digits and the state's own word beside them. A state word alone is used
 * where there is no number to print, which is why `withheld`, `unknown` and `unavailable` never
 * render as a figure.
 */
type FacetCountView =
  | { readonly kind: "number"; readonly text: string }
  | {
      readonly kind: "number-with-state";
      readonly text: string;
      readonly label: string;
      readonly tone: StatusTone;
    }
  | { readonly kind: "word"; readonly label: string; readonly tone: StatusTone }
  | { readonly kind: "none" };

/**
 * The rendering of one count, decided by the state the read recorded.
 *
 * The order matters. A withheld, unknown or unavailable count prints its word and never a number, so
 * an unread count can never be mistaken for a zero. An incomplete subtotal prints its number with
 * that same word beside it, because the figure is known and only the coverage behind it is partial:
 * printing the digits alone would let a partial subtotal pass for a complete count. The word itself
 * comes from `valueStateWord`, so no count can spell a state differently from the rest of the
 * application. A count the read did supply prints as an integer, and `0` prints as `0`, because a
 * value that genuinely matches nothing is a fact worth stating.
 */
function countViewOf(value: FacetValueSpec): FacetCountView {
  const state = value.countState;
  const counted =
    value.count !== undefined && Number.isFinite(value.count)
      ? countFormat.format(Math.max(0, Math.trunc(value.count)))
      : undefined;
  if (state !== undefined && state !== "value" && state !== "zero") {
    const word = valueStateWord(state);
    if (word !== undefined) {
      return state === "incomplete-subtotal" && counted !== undefined
        ? { kind: "number-with-state", text: counted, label: word.label, tone: word.tone }
        : { kind: "word", label: word.label, tone: word.tone };
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

/** What a stored view refers to that the current read no longer offers. */
interface SavedViewDrift {
  /** One phrase per missing reference, for the sentence the worker reads. */
  readonly missing: readonly string[];
  readonly drifted: boolean;
}

/**
 * Compares a stored view with the facets the read currently offers.
 *
 * A view drifts when it stores a facet this context no longer offers, or a value that facet no longer
 * offers. Drift is deliberately not "the view differs from the selection on screen" — applying a view
 * is exactly how those are made to agree — so a view the worker has since moved past is simply not
 * the one in use, and it is neither marked nor rewritten.
 */
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

/** Whether the choices on screen are exactly the ones a stored view holds. */
function viewIsInUse(
  view: SavedView,
  applied: Readonly<Record<string, readonly string[]>>,
  searchText: string,
): boolean {
  return view.query.search === searchText && sameSelection(view.query.applied, applied);
}

/** The column identifiers that are visible, given the caller's visibility map. */
function visibleColumnIds(
  columns: readonly ColumnSpec[],
  visibility: ColumnVisibility,
): readonly string[] {
  const visible: string[] = [];
  for (const column of columns) {
    if (visibility[column.id] !== false) {
      visible.push(column.id);
    }
  }
  return visible;
}

/** Every column id set visible, as a fresh plain record. */
function allColumnsVisible(columns: readonly ColumnSpec[]): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  for (const column of columns) {
    next[column.id] = true;
  }
  return next;
}

// ---------------------------------------------------------------------------------------------
// Small presentational pieces
// ---------------------------------------------------------------------------------------------

/**
 * One facet value's count: its number, its number with the word that qualifies it, or the word that
 * says why there is no number.
 *
 * A word carries its own text as well as its own tone, so `withheld`, `unknown` and `unavailable`
 * never share the rendering of a count, and a screen reader hears the condition rather than silence.
 * An incomplete subtotal shows both parts — the count, which is known, and the state's word beside
 * it, which says the coverage behind that count is partial — so a partial subtotal cannot read as a
 * complete one. The pair stays one wrapping line at the row's end, so the badge moves below the
 * number rather than pushing the facet higher than its 320 px container.
 */
function FacetCount({ value }: { readonly value: FacetValueSpec }): ReactNode {
  const view = countViewOf(value);
  if (view.kind === "number") {
    return (
      <span className="ms-auto shrink-0 tabular-figures text-xs text-muted-foreground">
        {view.text}
      </span>
    );
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
    return (
      <StatusBadge
        label={view.label}
        tone={view.tone}
        srPrefix="Matches"
        className="ms-auto shrink-0"
      />
    );
  }
  return null;
}

/**
 * The placeholders a facet shows while its options are in flight.
 *
 * A read that has not returned is not an empty filter, so the layer states that it is loading and
 * shows placeholder rows rather than "no options".
 */
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

/** A plain statement inside a layer: no value offered, no view stored, and so on. */
function LayerNote({ children }: { readonly children: ReactNode }): ReactNode {
  return <p className="text-sm leading-snug text-muted-foreground">{children}</p>;
}

/**
 * The name field shared by saving a new view and renaming a stored one.
 *
 * The field takes focus when it appears, because the control that opened it has been replaced and
 * focus would otherwise fall back to the page. An empty name is refused by the disabled submit as
 * well as by the handler, so a view is never stored without a way to recognise it.
 */
function ViewNameForm({
  fieldLabel,
  submitLabel,
  defaultValue = "",
  onSubmit,
  onCancel,
}: {
  readonly fieldLabel: string;
  readonly submitLabel: string;
  readonly defaultValue?: string;
  readonly onSubmit: (name: string) => void;
  readonly onCancel: () => void;
}): ReactNode {
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

// ---------------------------------------------------------------------------------------------
// Facet controls
//
// Three presentations, one rule: the toolbar offers exactly what the read offered and says in words
// why a filter is unavailable. A facet that admits several values opens a list of checkboxes; a facet
// that admits one opens a searchable picker; a facet that admits nothing here opens its reason.
// ---------------------------------------------------------------------------------------------

/** What every facet control receives. */
interface FacetControlProps {
  readonly facet: FacetSpec;
  /** The values selected in this facet, as the query holds them. */
  readonly selected: readonly string[];
  /** Called with the values this facet should now hold. */
  readonly onSelectionChange: (values: readonly string[]) => void;
  /** True while the facet read is in flight. */
  readonly pending: boolean;
  /** Whether this facet's layer is the open one. */
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The id of the element stating why the facet is unavailable, when it is. */
  readonly describedBy?: string;
}

/** The trigger's content, shared by every facet so one filter looks like every other filter. */
function FacetTriggerContent({
  facet,
  selectedCount,
}: {
  readonly facet: FacetSpec;
  readonly selectedCount: number;
}): ReactNode {
  return (
    <>
      <span className="truncate">
        <bdi>{facet.label}</bdi>
      </span>
      {selectedCount > 0 ? (
        <Badge
          variant="secondary"
          className="h-5 min-w-5 justify-center px-1 tabular-figures"
          aria-hidden="true"
        >
          {countFormat.format(selectedCount)}
        </Badge>
      ) : null}
      <ChevronDownIcon aria-hidden="true" className="size-3" />
    </>
  );
}

/**
 * A facet this context cannot apply, with its reason in words.
 *
 * The trigger stays operable on purpose: opening it repeats the reason inside the layer, so a
 * keyboard or screen-reader user can reach the explanation. Neither the trigger nor the layer offers
 * a value, so an unavailable filter can never be applied.
 */
function UnavailableFacetControl({
  facet,
  reason,
  open,
  onOpenChange,
  describedBy,
}: FacetControlProps & { readonly reason: string }): ReactNode {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="max-w-full"
            aria-label={TOOLBAR_COPY.facetUnavailableLabel(facet.label)}
            aria-describedby={describedBy}
          />
        }
      >
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

/**
 * A facet that admits several values, as a list of checkboxes inside a popover.
 *
 * Selecting a value is the OR half of the rule: each chosen value stands on its own, and the whole
 * facet still has to match alongside every other facet (the AND half). The list keeps one tab stop
 * and moves between its values with the arrow keys, Home and End, and typeahead jumps to a value by
 * its first letters — all from `@/lib/ui-sdk`, so the behaviour is the platform's and not a second
 * implementation here.
 */
function MultiFacetControl({
  facet,
  selected,
  onSelectionChange,
  pending,
  open,
  onOpenChange,
}: FacetControlProps): ReactNode {
  const optionBaseId = useId();
  const values = facet.values;
  const labels = useMemo(() => values.map((value) => value.label), [values]);

  const roving = useRovingFocus({
    orientation: "vertical",
    preferred: (key) => selected.includes(key),
  });

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
    onSelectionChange(
      next ? withValueAdded(selected, valueId, true) : withValueRemoved(selected, valueId),
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="max-w-full"
            aria-label={
              selected.length > 0
                ? `${facet.label}, ${TOOLBAR_COPY.appliedCount(selected.length)}`
                : facet.label
            }
          />
        }
      >
        <FacetTriggerContent facet={facet} selectedCount={selected.length} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
        <PopoverHeader>
          <PopoverTitle className="text-sm">
            <bdi>{facet.label}</bdi>
          </PopoverTitle>
          <PopoverDescription className="text-xs">
            {`${TOOLBAR_COPY.acrossFacets} ${
              facet.multi ? TOOLBAR_COPY.withinFacet : TOOLBAR_COPY.singleValue
            }`}
          </PopoverDescription>
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
                  <Label
                    htmlFor={optionId}
                    className="min-w-0 flex-1 cursor-pointer items-start font-normal leading-snug"
                  >
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

/**
 * A facet that admits one value, as a searchable picker.
 *
 * The combobox is the design system's searchable single choice: typing narrows the offered values by
 * their labels, the arrow keys move through them and Enter selects, so a long value list such as a tag
 * vocabulary is reachable without a drag or a scroll hunt. The value it hands back is the facet value's
 * identifier, never its label, so no display string becomes a query key.
 */
function SingleFacetControl({
  facet,
  selected,
  onSelectionChange,
  pending,
}: FacetControlProps): ReactNode {
  const valueIds = useMemo(() => facet.values.map((value) => value.id), [facet.values]);
  const candidate = selected.length === 1 ? selected[0] : undefined;
  const current =
    candidate !== undefined && facetValueById(facet, candidate) !== undefined ? candidate : null;
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
      <ComboboxInput
        aria-label={facet.label}
        placeholder={facet.label}
        showClear={current !== null}
        className="w-44 max-w-full"
      />
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
                  <FacetCount
                    value={facetValueById(facet, valueId) ?? { id: valueId, label: valueId }}
                  />
                </ComboboxItem>
              )}
            </ComboboxList>
          </>
        )}
      </ComboboxContent>
    </Combobox>
  );
}

/**
 * A facet's one presentation, chosen from what the read offered.
 *
 * The three branches are three components rather than three paths inside one, so no branch carries
 * another branch's hooks or state.
 */
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

/**
 * One applied filter, as a chip that removes exactly its own value.
 *
 * The chip is the design system's badge rendered as a button, so it is one focusable target rather
 * than a label with a nested control: pressing it removes this value and nothing else, which is the
 * behaviour the specification asks a selected filter to have. Its height is raised from the badge's
 * own to meet the 24 px target minimum.
 */
function FilterChip({
  chip,
  onRemove,
}: {
  readonly chip: AppliedChip;
  readonly onRemove: () => void;
}): ReactNode {
  const text = `${chip.facetLabel}: ${chip.valueLabel}`;
  return (
    <Badge
      render={
        <button
          type="button"
          aria-label={`${TOOLBAR_COPY.removeFilter}: ${text}`}
          onClick={onRemove}
        />
      }
      variant="secondary"
      className="h-6 cursor-pointer gap-1.5 ps-2 pe-1.5"
    >
      <span className="max-w-64 truncate">
        <bdi>{text}</bdi>
      </span>
      <XIcon aria-hidden="true" className="size-3 shrink-0" />
    </Badge>
  );
}

// ---------------------------------------------------------------------------------------------
// Saved views
// ---------------------------------------------------------------------------------------------

/** The selection as a fresh plain record, which is what the owner and a stored view both hold. */
function plainSelection(
  applied: Readonly<Record<string, readonly string[]>>,
): Record<string, string[]> {
  const next: Record<string, string[]> = {};
  for (const [facetId, values] of Object.entries(applied)) {
    next[facetId] = [...values];
  }
  return next;
}

/** The form the saved-view layer is showing: naming a new view, or renaming a stored one. */
type ViewFormState =
  | { readonly mode: "save" }
  | { readonly mode: "rename"; readonly viewId: string };

/** Which saved-view actions a surface offers. An action the owner does not supply is not rendered. */
interface SavedViewActions {
  readonly onSaveView?: (draft: SavedViewDraft) => void;
  readonly onUpdateView?: (viewId: string) => void;
  readonly onRenameView?: (viewId: string, name: string) => void;
  readonly onDeleteView?: (viewId: string) => void;
  readonly onRepairView?: (viewId: string) => void;
}

/**
 * One stored view inside the saved-view layer.
 *
 * The row states three different facts and keeps them apart: the view is *in use* when its stored
 * choices are exactly the ones on screen, it *needs repair* when it refers to a value this context no
 * longer offers, and otherwise it is simply a view the worker can apply. A view that needs repair is
 * never applied as it stands — repairing it is the offered recovery — because applying it silently
 * would drop the very filter the worker is looking for.
 */
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
        <Button
          size="xs"
          variant="outline"
          disabled={drift.drifted}
          aria-describedby={drift.drifted ? driftId : undefined}
          aria-label={TOOLBAR_COPY.viewActionLabel(TOOLBAR_COPY.applyView, view.name)}
          onClick={onApply}
        >
          {TOOLBAR_COPY.applyView}
        </Button>
        {onUpdate === undefined ? null : (
          <Button
            size="xs"
            variant="ghost"
            aria-label={TOOLBAR_COPY.viewActionLabel(TOOLBAR_COPY.updateView, view.name)}
            onClick={onUpdate}
          >
            {TOOLBAR_COPY.updateView}
          </Button>
        )}
        {onRename === undefined ? null : (
          <Button
            size="xs"
            variant="ghost"
            aria-label={TOOLBAR_COPY.viewActionLabel(TOOLBAR_COPY.renameView, view.name)}
            onClick={onRename}
          >
            {TOOLBAR_COPY.renameView}
          </Button>
        )}
        {drift.drifted && onRepair !== undefined ? (
          <Button
            size="xs"
            variant="secondary"
            aria-label={TOOLBAR_COPY.viewActionLabel(TOOLBAR_COPY.repairView, view.name)}
            onClick={onRepair}
          >
            <WrenchIcon aria-hidden="true" className="size-3" />
            {TOOLBAR_COPY.repairView}
          </Button>
        ) : null}
        {onDelete === undefined ? null : (
          <Button
            size="xs"
            variant="ghost"
            aria-label={TOOLBAR_COPY.viewActionLabel(TOOLBAR_COPY.deleteView, view.name)}
            onClick={onDelete}
          >
            {TOOLBAR_COPY.deleteView}
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * The saved-view layer: the stored views, the rename field for one of them, and saving a new one.
 *
 * Saving always creates a view, and never replaces one, so the only way a stored view changes is an
 * explicit Update or Rename on that view. Deleting a view removes the stored choices and touches no
 * record, which is why it needs no confirmation step: the copy says so and re-saving restores it.
 */
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
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="max-w-full"
            aria-label={
              driftedCount === 0
                ? TOOLBAR_COPY.savedViews
                : `${TOOLBAR_COPY.savedViews}, ${driftedCount} needs repair`
            }
          />
        }
      >
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
          <PopoverDescription className="text-xs">
            {TOOLBAR_COPY.savedViewsDescription}
          </PopoverDescription>
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

// ---------------------------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------------------------

/**
 * The configurable-columns menu.
 *
 * Unchecking a column dispatches a visibility change and nothing else: this file never renders a
 * table, so the menu cannot disagree with the one that does. The last visible column cannot be
 * hidden, because a list with no columns is a list with nothing to read; the menu says so in words
 * rather than leaving a disabled item unexplained.
 */
function ColumnsControl({
  columns,
  columnVisibility,
  onChange,
}: {
  readonly columns: readonly ColumnSpec[];
  readonly columnVisibility: ColumnVisibility;
  readonly onChange: (next: Record<string, boolean>) => void;
}): ReactNode {
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
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="max-w-full"
            aria-label={`${TOOLBAR_COPY.columns}, ${countFormat.format(visible.length)} of ${countFormat.format(
              columns.length,
            )} shown`}
          />
        }
      >
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
        <p className="px-3 py-1.5 text-xs leading-snug text-muted-foreground">
          {TOOLBAR_COPY.columnsNote}
        </p>
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

// ---------------------------------------------------------------------------------------------
// The toolbar
// ---------------------------------------------------------------------------------------------

/** The prefix that keeps a facet's layer distinct from the toolbar's other layers. */
const FACET_LAYER_PREFIX = "facet:";

/** The saved-view layer's key in the toolbar's one open-layer slot. */
const SAVED_VIEWS_LAYER = "saved-views";

/** Stable empties, so a surface without views or columns does not hand a new identity every render. */
const NO_SAVED_VIEWS: readonly SavedView[] = [];
const NO_COLUMNS: readonly ColumnSpec[] = [];
const NO_COLUMN_VISIBILITY: ColumnVisibility = {};

/** The search field's value: what the owner holds, and what the worker has typed since. */
interface SearchState {
  readonly external: string;
  readonly text: string;
}

/** One facet the context does not offer, with the sentence that says why. */
interface UnavailableFilterNote {
  readonly facetId: string;
  readonly label: string;
  readonly reason: string;
  readonly reasonId: string;
}

/** One facet's control, with the sentence that explains it when the context does not offer it. */
interface FacetControlEntry {
  readonly facet: FacetSpec;
  readonly reason: string | null;
  readonly reasonId: string;
}

/**
 * The only filter surface in the application.
 *
 * Three rules live here and nowhere else. Filters combine with AND across facets and OR among the
 * values selected inside one facet, so "two tags" means either tag and "a tag and an open task" means
 * both. An amount range is offered only while exactly one currency is selected, and a range left over
 * from a previous currency is dropped rather than compared across currencies. And a facet the context
 * does not offer is shown with the reason in words — never silently disabled, because a worker cannot
 * tell an unavailable filter from a broken one.
 *
 * It is fully controlled and holds no record data: `applied` in, `onAppliedChange` out, the search
 * text debounced but owned by the caller, and a saved view applied by dispatching exactly those same
 * callbacks. The owner keeps the selection in its query state, so returning from a record restores the
 * same filters, chips and columns without this component remembering anything.
 */
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
  const [searchState, setSearchState] = useState<SearchState>({
    external: search.value,
    text: search.value,
  });
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

  const chips = appliedChips(facets, applied);
  const currentQuery: SavedViewQuery = hasColumns
    ? {
        search: searchText,
        applied: plainSelection(applied),
        columnVisibility: { ...columnVisibility },
      }
    : { search: searchText, applied: plainSelection(applied) };

  function updateSearchText(next: string): void {
    setSearchState((previous) =>
      previous.text === next ? previous : { external: previous.external, text: next },
    );
  }

  /** Dispatches the search now, cancelling the debounce that would have dispatched it later. */
  function dispatchSearch(next: string): void {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    emitRef.current(next);
  }

  /** Dispatches what has been typed when the worker presses Enter or leaves the field. */
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

  /**
   * Why a facet cannot be applied, or `null` when it can.
   *
   * A reason the read stated comes first: it is the more specific fact, and a facet whose whole source
   * is withheld should not be described in terms of the currency rule.
   */
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

  /**
   * Applies a stored view by dispatching its choices through the owner's own callbacks.
   *
   * Nothing is written here: the search, the selection and the visible columns are named to the owner
   * exactly as if the worker had chosen them, so the view cannot bypass whatever the owner does with a
   * query change.
   */
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
    <section
      data-slot="query-toolbar"
      aria-label={label}
      className={cn("flex flex-col gap-3", className)}
    >
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
                <InputGroupButton
                  size="icon-xs"
                  variant="ghost"
                  aria-label={TOOLBAR_COPY.clearSearch}
                  onClick={clearSearchText}
                >
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

        {hasColumns ? (
          <ColumnsControl
            columns={columns}
            columnVisibility={columnVisibility}
            onChange={onColumnVisibilityChange}
          />
        ) : null}

        {chips.length === 0 && searchText.length === 0 ? null : (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            {TOOLBAR_COPY.clearAll}
          </Button>
        )}
      </div>

      {chips.length > 0 ? (
        <ul aria-label={TOOLBAR_COPY.activeFilters} className="flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <li key={`${chip.facetId}\u001f${chip.valueId}`}>
              <FilterChip
                chip={chip}
                onRemove={() => {
                  setFacetValues(
                    chip.facetId,
                    withValueRemoved(appliedValuesOf(applied, chip.facetId), chip.valueId),
                  );
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
            <li
              key={filter.facetId}
              id={filter.reasonId}
              className="text-xs leading-snug text-muted-foreground"
            >
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
