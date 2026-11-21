"use client";
/**
 * The Partners roster's filter binding: the facet descriptors the roster read admitted, and the one shared query
 * toolbar composed with them.
 *
 * The service owns the facet set and authorises it before it enumerates, so this file derives its descriptors from the
 * envelope it was handed and never from a list of filter keys: a filter the read did not admit produces no descriptor,
 * no chip and no control. Nothing here filters, sorts, pages or counts a record. The whole-result count of each value
 * and the state that count is in arrive on the envelope and are passed on untouched.
 */
import type { ReactElement } from "react";
import { QueryToolbar, type AmountRangeScope, type FacetSpec, type FacetValueSpec, type QueryToolbarProps } from "@/components/query-toolbar";
import { CURRENCY_SCOPE_COPY, FACET_LABELS, FACET_VALUE_LABELS, type FacetKey } from "../copy/facets";
import type { RosterFacetsEnvelope, RosterFacetSummary, RosterFacetValueSummary } from "../hooks/use-roster-query";

/** The filter keys the Partners family names, taken from the one copy module the family's filter wording lives in. */
export type PartnerFacetKey = FacetKey;

/**
 * The facet key the shared toolbar reserves for an amount range, restated here so the scope this binding passes and the
 * control the toolbar draws cannot end up naming two different filters.
 */
export const PARTNER_AMOUNT_RANGE_FACET_ID = "amount-range";

/**
 * The facet the roster read states its giving currencies in: its values are currency codes, so an amount comparison is
 * scoped to exactly one of them by selecting it there and nowhere else.
 */
export const PARTNER_CURRENCY_FACET_ID = "giving-total";

/** How one admitted filter is presented: a list of values, one chosen value, or an entered amount range. */
export type PartnerFacetControlKind = "multi" | "single" | "range";

/** One admitted filter as the shared toolbar takes it, plus the Partners facts the toolbar cannot decide for itself. */
export interface PartnerFacetDescriptor extends FacetSpec {
  /**
   * The family's own key for this filter, or `null` when the read admits a filter this build's copy does not name — the
   * descriptor still renders, labelled from the read's own key, because hiding an admitted filter would leave a
   * selection the worker cannot see or clear.
   */
  readonly key: PartnerFacetKey | null;
  readonly kind: PartnerFacetControlKind;
  /** The one currency an amount range is scoped to; present only on a range facet, and only while one currency is selected. */
  readonly currencyScope?: string;
}

/** One filter and the values selected in it: the shape a stored view keeps and a restored selection hands back. */
export interface PartnerFacetSelection {
  readonly facet: PartnerFacetKey;
  readonly values: readonly string[];
}

/** What the builder reads beyond the envelope: the selection in force, which decides whether an amount range can be scoped. */
export interface PartnerFacetBuildOptions {
  readonly applied?: Readonly<Record<string, readonly string[]>>;
}

/** What the roster surface hands its filter block: the toolbar's own contract, minus the two members this family derives. */
export type PartnerFacetsProps = Omit<QueryToolbarProps, "facets" | "amountRange"> & {
  /**
   * The facet set the read admitted for this caller, or `null` while there is none. A refused or failed facet read
   * reaches the surface as `null` and is stated there, because a filter block that invented controls for it would
   * offer filters the service never authorised.
   */
  readonly facetsEnvelope: RosterFacetsEnvelope | null;
};

const NO_SELECTION: Readonly<Record<string, readonly string[]>> = Object.freeze({});

const NO_DESCRIPTORS: readonly PartnerFacetDescriptor[] = Object.freeze([]);

/** The length that states no value, used where an empty selection must narrow nothing rather than select nothing. */
const NO_VALUES = 0;

/** The length that states exactly one value, which is the only condition under which a currency scopes an amount. */
const ONE_VALUE = 1;

// Reading the selection, and the admitted envelope
/** Whether a facet identifier is one the family names, so its wording comes from the one copy module rather than from the source string. */
function isPartnerFacetKey(identifier: string): identifier is PartnerFacetKey {
  return Object.prototype.hasOwnProperty.call(FACET_LABELS, identifier);
}

/** The values selected inside one facet, as the query states them; a facet no expression names has none. */
function selectedValuesOf(applied: Readonly<Record<string, readonly string[]>>, facetKey: string): readonly string[] {
  const selected = applied[facetKey];
  return selected === undefined ? [] : selected;
}

/**
 * The one currency the giving filters are stated in, or `null` while none or several are selected. Amounts in different
 * currencies are never compared, so this is the only condition under which an amount range means anything.
 */
function singleSelectedCurrency(applied: Readonly<Record<string, readonly string[]>>): string | null {
  const selected = selectedValuesOf(applied, PARTNER_CURRENCY_FACET_ID);
  if (selected.length !== ONE_VALUE) {
    return null;
  }
  const [only] = selected;
  return only === undefined ? null : only;
}

/** The descriptor's label: the family's wording for a key it names, else the key the read itself stated. */
function facetLabelOf(key: PartnerFacetKey | null, facet: RosterFacetSummary): string {
  if (key !== null) {
    return FACET_LABELS[key];
  }
  const stated = facet.labelKey.trim();
  return stated === "" ? facet.id : stated;
}

/**
 * One value's label: the family's wording for a closed value set, else the label the source supplied. An open value
 * set — a tag, a relationship, a geography, a currency — is therefore rendered exactly as the read stated it, because
 * a label invented here would name something the service has not enumerated.
 *
 * Every value this file renders names a state the read admitted — "Private record", "Favourites only", "USD" — and never
 * the content behind it, so a private preparation's own text and a gift's amount are facts this filter block cannot
 * carry. Preparation state and the giving filters stay separate facts for the same reason: one of them being applied
 * says nothing about the other.
 */
function facetValueLabelOf(key: PartnerFacetKey | null, option: RosterFacetValueSummary): string {
  const named = key === null ? undefined : FACET_VALUE_LABELS[key][option.id];
  if (named !== undefined) {
    return named;
  }
  const stated = option.label.trim();
  return stated === "" ? option.id : stated;
}

/** Whether the read admits this facet as the amount range the toolbar scopes to one currency. */
function isAmountRangeFacet(facet: RosterFacetSummary): boolean {
  return facet.id === PARTNER_AMOUNT_RANGE_FACET_ID;
}

/** How the toolbar should present one admitted facet, decided from its own arity and from whether it is the range. */
function controlKindOf(facet: RosterFacetSummary, range: boolean): PartnerFacetControlKind {
  if (range) {
    return "range";
  }
  return facet.multi ? "multi" : "single";
}

/**
 * Why a facet cannot be used, if it cannot: the read's own reason always wins, because only it knows which source did
 * not answer. Where the read states none, the amount range states the one rule it obeys — amounts in different
 * currencies are never compared — so a range spanning currencies is unavailable with the reason in view.
 */
function disabledReasonOf(facet: RosterFacetSummary, range: boolean, currencyScope: string | null): string {
  const stated = facet.disabledReason === undefined ? "" : facet.disabledReason.trim();
  if (stated !== "") {
    return stated;
  }
  if (range && currencyScope === null) {
    return CURRENCY_SCOPE_COPY.chooseCurrencyFirst;
  }
  return "";
}

/**
 * The descriptors the toolbar renders, built only from the facets this envelope admits.
 *
 * One descriptor per facet, each holding the values selected inside it, which is how "every selected filter must match,
 * any selected value within one filter may match" is expressed as a shape rather than as a flat list of conditions.
 * The amount range is offered only on a facet the read admits under the toolbar's range key, and only while exactly one
 * currency is selected: with every currency in view the control is unavailable and states why, because an amount range
 * spanning currencies compares amounts that are not comparable.
 */
export function buildPartnerFacetDescriptors(facetsEnvelope: RosterFacetsEnvelope | null, options: PartnerFacetBuildOptions = {}): readonly PartnerFacetDescriptor[] {
  if (facetsEnvelope === null) {
    return NO_DESCRIPTORS;
  }
  const applied = options.applied ?? NO_SELECTION;
  const currencyScope = singleSelectedCurrency(applied);
  const descriptors: PartnerFacetDescriptor[] = [];
  for (const facet of facetsEnvelope.data) {
    const key = isPartnerFacetKey(facet.id) ? facet.id : null;
    const range = isAmountRangeFacet(facet);
    const values: FacetValueSpec[] = [];
    for (const option of facet.options) {
      values.push({ id: option.id, label: facetValueLabelOf(key, option), count: option.count, countState: option.countState });
    }
    const disabledReason = disabledReasonOf(facet, range, currencyScope);
    descriptors.push({ id: facet.id, key, label: facetLabelOf(key, facet), values, multi: facet.multi, kind: controlKindOf(facet, range), ...(range && currencyScope !== null ? { currencyScope } : {}), ...(disabledReason === "" ? {} : { disabledReason }) });
  }
  return descriptors;
}

/**
 * The currency scope the toolbar enforces, stated only when the read admits an amount range: a roster that admits none
 * offers no range control at all, because a filter the service cannot apply is a control that would silently do nothing.
 */
export function partnerAmountRangeScope(descriptors: readonly PartnerFacetDescriptor[]): AmountRangeScope | undefined {
  for (const descriptor of descriptors) {
    if (descriptor.kind === "range") {
      return { facetId: descriptor.id, currencyFacetId: PARTNER_CURRENCY_FACET_ID };
    }
  }
  return undefined;
}

/**
 * The selection a set of stored choices asks for, as the applied record the toolbar is handed: facets combine with AND,
 * and the values of one facet with OR. Empty selections are left out, because a filter with no value narrows nothing
 * and the toolbar's own contract omits such a facet rather than storing it empty.
 */
export function appliedFromSelections(selections: readonly PartnerFacetSelection[]): Record<string, string[]> {
  const applied: Record<string, string[]> = {};
  for (const selection of selections) {
    if (selection.values.length === NO_VALUES) {
      continue;
    }
    const kept = applied[selection.facet] ?? [];
    for (const value of selection.values) {
      if (value !== "" && !kept.includes(value)) {
        kept.push(value);
      }
    }
    if (kept.length > NO_VALUES) {
      applied[selection.facet] = kept;
    }
  }
  return applied;
}

/**
 * The Partners filter block: the admitted facets with their selected values as the toolbar's own chips, each filter's
 * value list or single picker, and a Clear all action — all of them the shared toolbar's, composed here with the two
 * things only this family can supply: its filter wording, and the currency an amount range is scoped to.
 *
 * The selection arrives as a prop and every change leaves through `onAppliedChange`; this component keeps no query
 * state of its own. A selection naming a filter this context no longer offers is passed through untouched rather than
 * dropped, so a drifted saved view can be repaired instead of a filter quietly disappearing.
 */
export function PartnerFacets({ facetsEnvelope, applied, className, ...toolbarProps }: PartnerFacetsProps): ReactElement {
  // Derived on every render rather than memoised: the work is one short pass over the admitted facets, and a memo
  // keyed on a selection object the caller recreates each render would recompute anyway.
  const facets = buildPartnerFacetDescriptors(facetsEnvelope, { applied });
  const amountRange = partnerAmountRangeScope(facets);
  return <QueryToolbar {...toolbarProps} applied={applied} facets={facets} amountRange={amountRange} className={className} />;
}
