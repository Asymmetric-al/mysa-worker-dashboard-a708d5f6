"use client";
/**
 * One partner record as it appears in place beside the roster: the family's own detail body, over the family's own
 * browser reads, in the panel presentation on a desktop and the sheet presentation on a phone.
 *
 * **Why this exists.** A record opens into one detail body, and that body has three presentations — the direct route,
 * a desktop side panel over the list, and the phone page (AAP 0.6.4). The route renders the body in a Server Component
 * from the service's own reads; this file renders the very same body from the same three reads issued in the browser,
 * so the panel adds a presentation and never a second implementation of the record.
 *
 * **What it does not do.** It merges nothing, re-projects nothing and totals nothing: each read's answer is handed to
 * the body in the vocabulary the body already speaks — `loading`, `read`, `unavailable`, `denied`, `refused` — with the
 * one narrowing the body states it wants (the activity read's page of interactions). A denial, an outage and a refused
 * request therefore read in the panel exactly as they read on the route: a refusal never degrades into an empty record
 * and an outage is never drawn as a record that holds nothing.
 *
 * **What it never carries.** No private note body is read outside the worker's own preparation read, no shared section
 * carries private text, and the panel states no action the route does not: tags, favourites, notes, preparation and
 * filing stay the record's own controls, mounted where the record states them.
 */
import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { RecordDetailLayout } from "@/components/record-detail";
import type { ReadEnvelope, ReadResult, Scope } from "@/modules/data-service";
import type { InteractionRecord } from "@/modules/data-service/envelope";
import { usePartnerInteractions, usePartnerPreparation, usePartnerRecord, type PartnerInteractionData, type PartnerPreparationData, type PartnerRecordData } from "../hooks/use-partner-record";
import PartnerDetailSections, { type PartnerDetailData, type PartnerPrivateData, type PartnerReadResult } from "./partner-detail-sections";

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** The interface language the body states, the same one the record's own route renders it in. */
const INTERFACE_LOCALE = "en-GB";

/** Where the worker came from, which is the list the panel is opened beside. */
const ROSTER_CRUMB = [{ label: "Partners", href: "/partners" }] as const;

// ---------------------------------------------------------------------------------------------
// One read's browser answer, and the three payloads the body renders, in its own vocabulary
// ---------------------------------------------------------------------------------------------

/**
 * Maps one query's answer onto the vocabulary the record body understands. A request that has not answered is
 * `loading`, and the same request that failed is `unavailable` with the read offered again: neither is a record that
 * holds nothing. An envelope is handed on with only the member the body states it renders, so the panel states the
 * section the read answered rather than one this file rebuilt.
 */
function recordReadOf<TData, Shown>(query: UseQueryResult<ReadResult<ReadEnvelope<TData>>, Error>, project: (data: TData) => Shown, onRetry: () => void): PartnerReadResult<Shown> {
  const answer = query.data;
  if (answer === undefined) {
    return query.isError ? { kind: "unavailable", onRetry } : { kind: "loading" };
  }
  switch (answer.kind) {
    case "envelope":
      return { kind: "read", envelope: { ...answer.envelope, data: project(answer.envelope.data) } };
    case "denied":
      // A denial travels with its closed reason code and nothing about the record behind it.
      return { kind: "denied", reasonCode: answer.denied.reasonCode };
    case "unavailable":
      return { kind: "unavailable", source: answer.unavailable.source, onRetry };
    case "refused":
      // The request this read was asked to serve is not one it admits, so the section states the refusal rather
      // than reporting the partner source as down.
      return { kind: "refused", fields: answer.refused.fields };
  }
}

/**
 * The record's payload as the read states it, which is the payload the body renders: the record, its relationship
 * context and its open work travel untouched, and nothing here rebuilds a field the service projected.
 */
const recordDataOf = (data: PartnerRecordData): PartnerDetailData => data;

/** The worker's own preparation as the read states it: the note bodies and, for that record, whether it is archived. */
const preparationDataOf = (data: PartnerPreparationData): PartnerPrivateData => data;

/** The activity the read answered, narrowed to the page of interactions the body's activity section renders. */
const interactionsOf = (data: PartnerInteractionData): readonly InteractionRecord[] => data.interactions;

// ---------------------------------------------------------------------------------------------
// The panel's body
// ---------------------------------------------------------------------------------------------

/** Props of {@link PartnerRecordPanel}. */
export interface PartnerRecordPanelProps {
  /** The exact authority the record is read under; the service re-derives scope from the session on every read. */
  readonly scope: Scope;
  /** The opaque identifier of the record the roster row names, never parsed and never compared with another one. */
  readonly partnerId: string;
  /** The presentation this body lands in: the desktop panel beside the list, or the phone sheet. */
  readonly layout: Extract<RecordDetailLayout, "panel" | "sheet">;
}

/**
 * One partner record presented in place: the shared facts, the worker's own private preparation and the activity that
 * actually happened, each read on its own so a refusal or an outage costs its own section rather than the whole record.
 */
export default function PartnerRecordPanel({ scope, partnerId, layout }: PartnerRecordPanelProps): ReactElement {
  const record = usePartnerRecord(scope, partnerId);
  const preparation = usePartnerPreparation(scope, partnerId);
  const interactions = usePartnerInteractions(scope, partnerId);
  const retryRecord = (): void => {
    void record.query.refetch();
  };
  const retryPreparation = (): void => {
    void preparation.refetch();
  };
  const retryInteractions = (): void => {
    void interactions.refetch();
  };
  return (
    <PartnerDetailSections
      partner={recordReadOf(record.query, recordDataOf, retryRecord)}
      privatePreparation={recordReadOf(preparation, preparationDataOf, retryPreparation)}
      interactions={recordReadOf(interactions, interactionsOf, retryInteractions)}
      layout={layout}
      locale={INTERFACE_LOCALE}
      breadcrumb={ROSTER_CRUMB}
    />
  );
}
