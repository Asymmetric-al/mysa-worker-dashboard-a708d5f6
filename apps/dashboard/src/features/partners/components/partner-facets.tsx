"use client";
import type { ReactElement } from "react";
import { QueryToolbar, type FacetSpec, type FacetValueSpec, type QueryToolbarProps } from "@/components/query-toolbar";
import { FACET_LABELS, FACET_VALUE_LABELS, type FacetKey } from "../copy/facets";
import type { RosterFacetsEnvelope, RosterFacetSummary, RosterFacetValueSummary } from "../hooks/use-roster-query";
export type PartnerFacetKey = FacetKey;
export type PartnerFacetDescriptor = FacetSpec & { readonly key: PartnerFacetKey | null };
export type PartnerFacetsProps = Omit<QueryToolbarProps, "facets" | "amountRange"> & { readonly facetsEnvelope: RosterFacetsEnvelope | null };
const NO_DESCRIPTORS: readonly PartnerFacetDescriptor[] = Object.freeze([]);
const isPartnerFacetKey = (identifier: string): identifier is PartnerFacetKey => Object.prototype.hasOwnProperty.call(FACET_LABELS, identifier);
const facetLabelOf = (key: PartnerFacetKey | null, facet: RosterFacetSummary): string => (key !== null ? FACET_LABELS[key] : facet.labelKey.trim() || facet.id);
const facetValueLabelOf = (key: PartnerFacetKey | null, option: RosterFacetValueSummary): string => (key === null ? undefined : FACET_VALUE_LABELS[key][option.id]) ?? (option.label.trim() || option.id);
/** The descriptors the toolbar renders, built only from the facets this envelope admits. */ export function buildPartnerFacetDescriptors(facetsEnvelope: RosterFacetsEnvelope | null): readonly PartnerFacetDescriptor[] {
  if (facetsEnvelope === null) return NO_DESCRIPTORS;
  const descriptors: PartnerFacetDescriptor[] = [];
  for (const facet of facetsEnvelope.data) {
    const key = isPartnerFacetKey(facet.id) ? facet.id : null;
    const values: FacetValueSpec[] = facet.options.map((option) => ({ id: option.id, label: facetValueLabelOf(key, option), count: option.count, countState: option.countState }));
    const disabledReason = facet.disabledReason?.trim() ?? "";
    descriptors.push({ id: facet.id, key, label: facetLabelOf(key, facet), values, multi: facet.multi, ...(disabledReason === "" ? {} : { disabledReason }) });
  }
  return descriptors;
}
/** The Partners filter block: the admitted facets as the shared toolbar's own chips, value lists and Clear all action. */ export function PartnerFacets({ facetsEnvelope, applied, className, ...toolbarProps }: PartnerFacetsProps): ReactElement {
  const facets = buildPartnerFacetDescriptors(facetsEnvelope);
  return <QueryToolbar {...toolbarProps} applied={applied} facets={facets} className={className} />;
}
