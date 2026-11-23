"use client";
import type { ReactElement } from "react";
import { QueryToolbar, type AmountRangeScope, type FacetSpec, type FacetValueSpec, type QueryToolbarProps } from "@/components/query-toolbar";
import { CURRENCY_SCOPE_COPY, FACET_LABELS, FACET_VALUE_LABELS, type FacetKey } from "../copy/facets";
import type { RosterFacetsEnvelope, RosterFacetSummary, RosterFacetValueSummary } from "../hooks/use-roster-query";
export type PartnerFacetKey = FacetKey;
export const PARTNER_CURRENCY_FACET_ID = "giving-total";
export type PartnerFacetControlKind = "multi" | "single" | "range";
export interface PartnerFacetDescriptor extends FacetSpec {
  readonly key: PartnerFacetKey | null;
  readonly kind: PartnerFacetControlKind;
  readonly currencyScope?: string;
}
export type PartnerFacetBuildOptions = { readonly applied?: Readonly<Record<string, readonly string[]>> };
export type PartnerFacetsProps = Omit<QueryToolbarProps, "facets" | "amountRange"> & { readonly facetsEnvelope: RosterFacetsEnvelope | null };
const NO_SELECTION: Readonly<Record<string, readonly string[]>> = Object.freeze({});
const NO_DESCRIPTORS: readonly PartnerFacetDescriptor[] = Object.freeze([]);
const isPartnerFacetKey = (identifier: string): identifier is PartnerFacetKey => Object.prototype.hasOwnProperty.call(FACET_LABELS, identifier);
const selectedValuesOf = (applied: Readonly<Record<string, readonly string[]>>, facetKey: string): readonly string[] => applied[facetKey] ?? [];
const singleSelectedCurrency = (applied: Readonly<Record<string, readonly string[]>>): string | null => {
  const selected = selectedValuesOf(applied, PARTNER_CURRENCY_FACET_ID);
  return selected.length === 1 ? (selected[0] ?? null) : null;
};
const facetLabelOf = (key: PartnerFacetKey | null, facet: RosterFacetSummary): string => (key !== null ? FACET_LABELS[key] : facet.labelKey.trim() || facet.id);
const facetValueLabelOf = (key: PartnerFacetKey | null, option: RosterFacetValueSummary): string => (key === null ? undefined : FACET_VALUE_LABELS[key][option.id]) ?? (option.label.trim() || option.id);
const isAmountRangeFacet = (facet: RosterFacetSummary): boolean => facet.id === "amount-range";
const controlKindOf = (facet: RosterFacetSummary, range: boolean): PartnerFacetControlKind => (range ? "range" : facet.multi ? "multi" : "single");
function disabledReasonOf(facet: RosterFacetSummary, range: boolean, currencyScope: string | null): string {
  const stated = facet.disabledReason?.trim() ?? "";
  if (stated !== "") return stated;
  return range && currencyScope === null ? CURRENCY_SCOPE_COPY.chooseCurrencyFirst : "";
}
/** The descriptors the toolbar renders, built only from the facets this envelope admits. */
export function buildPartnerFacetDescriptors(facetsEnvelope: RosterFacetsEnvelope | null, options: PartnerFacetBuildOptions = {}): readonly PartnerFacetDescriptor[] {
  if (facetsEnvelope === null) return NO_DESCRIPTORS;
  const applied = options.applied ?? NO_SELECTION;
  const currencyScope = singleSelectedCurrency(applied);
  const descriptors: PartnerFacetDescriptor[] = [];
  for (const facet of facetsEnvelope.data) {
    const key = isPartnerFacetKey(facet.id) ? facet.id : null;
    const range = isAmountRangeFacet(facet);
    const values: FacetValueSpec[] = facet.options.map((option) => ({ id: option.id, label: facetValueLabelOf(key, option), count: option.count, countState: option.countState }));
    const disabledReason = disabledReasonOf(facet, range, currencyScope);
    descriptors.push({ id: facet.id, key, label: facetLabelOf(key, facet), values, multi: facet.multi, kind: controlKindOf(facet, range), ...(range && currencyScope !== null ? { currencyScope } : {}), ...(disabledReason === "" ? {} : { disabledReason }) });
  }
  return descriptors;
}
/** The currency scope the toolbar enforces, stated only when the read admits an amount range. */
export function partnerAmountRangeScope(descriptors: readonly PartnerFacetDescriptor[]): AmountRangeScope | undefined {
  const range = descriptors.find((descriptor) => descriptor.kind === "range");
  return range === undefined ? undefined : { facetId: range.id, currencyFacetId: PARTNER_CURRENCY_FACET_ID };
}
/** The Partners filter block: the admitted facets as the shared toolbar's own chips, value lists and Clear all action. */
export function PartnerFacets({ facetsEnvelope, applied, className, ...toolbarProps }: PartnerFacetsProps): ReactElement {
  const facets = buildPartnerFacetDescriptors(facetsEnvelope, { applied });
  const amountRange = partnerAmountRangeScope(facets);
  return <QueryToolbar {...toolbarProps} applied={applied} facets={facets} amountRange={amountRange} className={className} />;
}
