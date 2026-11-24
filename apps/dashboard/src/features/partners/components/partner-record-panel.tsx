"use client";
/** One partner record as it appears in place beside the roster: the family's one record body over the family's own browser reads, in the panel presentation on a desktop and the sheet presentation on a phone. The body is the one the record's own route renders, composed from the same facts, so every section, action and destination is offered here against the revision this panel read. It merges nothing and re-projects nothing, so a denial, an outage and a refused request read here exactly as they read on the record's own route, and no private note body is read outside the worker's own preparation read. */
import type { ReactElement, ReactNode } from "react";
import { scopeKey } from "@/components/context-switch-guard";
import type { RecordDetailLayout } from "@/components/record-detail";
import { isNonEmptyString, isRecord } from "@/lib/guards";
import { envelopeIn, fetchRead, useReadQuery, type ReadQueryResult } from "@/lib/read-transport";
import type { Scope, reads } from "@/modules/data-service";
import type { InteractionRecord } from "@/modules/data-service/envelope";
import { PARTNER_KEY, type PartnerKeySegment } from "../hooks/use-partner-mutations";
import type { PartnerDetailData, PartnerPrivateData, PartnerReadResult } from "./partner-detail-sections";
import PartnerRecordBody, { type PartnerRecordFacts } from "./partner-record-body";
/** The record body's payload, the worker's own preparation and the activity, taken from the service's reads rather than restated. */ type RecordPayload = Extract<Awaited<ReturnType<typeof reads.partners.readPartner>>, { readonly kind: "envelope" }>["envelope"]["data"];
type PreparationPayload = Extract<Awaited<ReturnType<typeof reads.partners.readPrivatePreparation>>, { readonly kind: "envelope" }>["envelope"]["data"];
type InteractionPayload = Extract<Awaited<ReturnType<typeof reads.interactions.readInteractions>>, { readonly kind: "envelope" }>["envelope"]["data"];
const ROSTER_CRUMB = [{ label: "Partners", href: "/partners" }] as const;
const READ_JOB = { record: "record", preparation: "preparation", interactions: "interactions" } as const;
const isRecordPayload = (data: unknown): boolean => isRecord(data) && isRecord(data["partner"]) && isNonEmptyString(data["partner"]["partnerId"]) && Array.isArray(data["relationshipContext"]) && Array.isArray(data["openTasks"]);
const isPreparationPayload = (data: unknown): boolean => isRecord(data) && Array.isArray(data["notes"]);
const isInteractionPayload = (data: unknown): boolean => isRecord(data) && Array.isArray(data["interactions"]) && typeof data["total"] === "number" && isRecord(data["page"]);
/** Whether a read of this record can be issued at all: the context it runs under is resolved and the address names a record. */
const isAddressed = (scope: Scope, partnerId: string): boolean => partnerId.trim() !== "" && [scope.organizationId, scope.ministryId, scope.supportSubjectId, scope.principalId].every((identifier) => typeof identifier === "string" && identifier !== "");
/** Reads one named job of this record through the family's transport, keyed by the cache segment the family's mutations refresh, so a settled change re-reads exactly this entry. */
const useRecordJob = <TPayload,>(scope: Scope, partnerId: string, segment: PartnerKeySegment, job: string, admits: (data: unknown) => boolean): ReadQueryResult<TPayload> =>
  useReadQuery<TPayload>({ key: scopeKey(scope), job: segment, segment: [partnerId], read: () => fetchRead<TPayload>({ url: `/api/partners/${encodeURIComponent(partnerId)}?job=${job}`, admits }), enabled: isAddressed(scope, partnerId) });
/** One query's answer in the body's own vocabulary: a request that has not answered is `loading` and the same request that failed is `unavailable` with the read offered again — neither is a record that holds nothing. */
function readStateOf<TData, Shown>(query: ReadQueryResult<TData>, project: (data: TData) => Shown, retry: () => void): PartnerReadResult<Shown> {
  const answer = query.data;
  if (answer === undefined) return query.isError ? { kind: "unavailable", onRetry: retry } : { kind: "loading" };
  switch (answer.kind) {
    case "envelope":
      return { kind: "read", envelope: { ...answer.envelope, data: project(answer.envelope.data) } };
    case "denied":
      return { kind: "denied", reasonCode: answer.denied.reasonCode }; // A denial travels with its closed reason code and nothing about the record behind it.
    case "unavailable":
      return { kind: "unavailable", source: answer.unavailable.source, onRetry: retry };
    case "refused":
      return { kind: "refused", fields: answer.refused.fields };
  }
}
/** The facts the record's own actions are derived from, taken from the two envelopes this panel already read: a record read that has not answered states none, so the body offers no action against a revision it has not read, and a preparation read without a preparation record states no archive control. */
function factsOf(record: ReadQueryResult<RecordPayload>, preparation: ReadQueryResult<PreparationPayload>, tagSuggestions: readonly string[]): PartnerRecordFacts | undefined {
  const envelope = envelopeIn(record.data);
  if (envelope === null) return undefined;
  const { partner } = envelope.data;
  const preparationRecord = envelopeIn(preparation.data)?.data.preparation;
  return {
    scope: envelope.scope,
    revision: envelope.revision,
    actions: envelope.actions,
    partner: { partnerId: partner.partnerId, kind: partner.kind, displayName: partner.displayName, tags: partner.tags, favourite: partner.favourite },
    tagSuggestions,
    ...(preparationRecord === undefined ? {} : { preparationArchived: preparationRecord.archived }),
  };
}
export type PartnerRecordPanelProps = { readonly scope: Scope; readonly partnerId: string; readonly layout: Extract<RecordDetailLayout, "panel" | "sheet">; readonly tagSuggestions?: readonly string[]; readonly introduction?: ReactNode };
/** One partner record presented in place: the shared facts, the worker's own private preparation and the activity that actually happened, each read on its own so a refusal or an outage costs its own section rather than the whole record. */
export default function PartnerRecordPanel({ scope, partnerId, layout, tagSuggestions = [], introduction }: PartnerRecordPanelProps): ReactElement {
  const record = useRecordJob<RecordPayload>(scope, partnerId, PARTNER_KEY.record, READ_JOB.record, isRecordPayload);
  const preparation = useRecordJob<PreparationPayload>(scope, partnerId, PARTNER_KEY.preparation, READ_JOB.preparation, isPreparationPayload);
  const interactions = useRecordJob<InteractionPayload>(scope, partnerId, PARTNER_KEY.interactions, READ_JOB.interactions, isInteractionPayload);
  return (
    <PartnerRecordBody
      partner={readStateOf(
        record,
        (data: RecordPayload): PartnerDetailData => data,
        () => void record.refetch(),
      )}
      privatePreparation={readStateOf(
        preparation,
        (data: PreparationPayload): PartnerPrivateData => data,
        () => void preparation.refetch(),
      )}
      interactions={readStateOf(
        interactions,
        (data: InteractionPayload): readonly InteractionRecord[] => data.interactions,
        () => void interactions.refetch(),
      )}
      layout={layout}
      locale={"en-GB"}
      breadcrumb={ROSTER_CRUMB}
      facts={factsOf(record, preparation, tagSuggestions)}
      introduction={introduction}
    />
  );
}
