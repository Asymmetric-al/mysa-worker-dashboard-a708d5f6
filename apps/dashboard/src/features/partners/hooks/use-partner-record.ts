"use client";
/**
 * The three named reads of one partner record, each in its own query: the shared facts the record body renders, the worker's own private preparation, and the activity that actually happened.
 *
 * They are three reads rather than one merged result, on purpose. Private preparation is a different record class from the shared operational facts, so a denial on it says nothing about the record and a shared section never carries private text; contactability, communication consent for a publisher and a purpose, and protected-content reader grants stay three separate facts, each read where the envelope states it. Nothing here merges, joins, groups or orders records, and nothing compares a name, an e-mail address, a postal address or an identifier fragment: equal-looking values establish neither identity nor authority.
 *
 * The service owns every projection, every value state and every available action. Each hook hands its envelope on untouched — no selection, no re-projection, no local total, no locally derived date — and answers `envelope | denied | unavailable | refused`, so a refusal never degrades into an empty record and an outage is never rendered as a record that holds nothing.
 *
 * These hooks are for the browser only. The direct route renders its own body from the service's reads in a Server Component, and no code path here reads the application's HTTP surface from the server side.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { scopeKey } from "@/components/context-switch-guard";
import { isNonEmptyString, isRecord } from "@/lib/guards";
import type { ReadEnvelope, ReadResult, Scope, reads } from "@/modules/data-service";
import { PARTNER_KEY, PARTNER_READ_JOBS, PartnerReadTransportError, fetchPartnerRead, partnerRecordReadUrl, type PartnerReadJob } from "./use-partner-mutations";
import { ROSTER_PAGE_SIZE_CAP, ROSTER_PAGE_SIZE_DEFAULT } from "./use-roster-query";

// The reads' own contracts, derived from the service rather than restated beside it
/** The record body's payload: the record as this caller may read it, its relationship context, its open work and the authorised support history. */
export type PartnerRecordData = Extract<Awaited<ReturnType<typeof reads.partners.readPartner>>, { readonly kind: "envelope" }>["envelope"]["data"];

/** The private preparation payload: the note bodies this caller wrote and, where the record is the caller's own preparation, whether it is archived. */
export type PartnerPreparationData = Extract<Awaited<ReturnType<typeof reads.partners.readPrivatePreparation>>, { readonly kind: "envelope" }>["envelope"]["data"];

/** The activity payload: one page of what actually happened, each record carrying the precision its date is known to. */
export type PartnerInteractionData = Extract<Awaited<ReturnType<typeof reads.interactions.readInteractions>>, { readonly kind: "envelope" }>["envelope"]["data"];

/** The envelope the record body read answers with. */
export type PartnerRecordEnvelope = ReadEnvelope<PartnerRecordData>;

/** The envelope the private preparation read answers with. */
export type PartnerPreparationEnvelope = ReadEnvelope<PartnerPreparationData>;

/** The envelope the activity read answers with. */
export type PartnerInteractionEnvelope = ReadEnvelope<PartnerInteractionData>;

/** The record body read's four-way answer: the envelope, a denial, an outage, or the refusal of a request the read does not admit. */
export type PartnerRecordResult = ReadResult<PartnerRecordEnvelope>;

/** The private preparation read's four-way answer, in the same vocabulary. */
export type PartnerPreparationResult = ReadResult<PartnerPreparationEnvelope>;

/** The activity read's four-way answer, in the same vocabulary. */
export type PartnerInteractionResult = ReadResult<PartnerInteractionEnvelope>;

/** What a caller may state about the page of activity it is showing: the page a person reads, counted from one, and how many records that page holds. */
export interface PartnerActivityPaging {
  readonly page?: number;
  readonly pageSize?: number;
}

/** What {@link usePartnerRecord} hands the record body: the read's own answer, and the revision an edit of this record must present. */
export interface PartnerRecordRead {
  /** The shared-facts read, exactly as it answered: `envelope`, `denied`, `unavailable` or `refused`. */
  readonly query: UseQueryResult<PartnerRecordResult, Error>;
  /**
   * The revision the record envelope stands at, passed on untouched so `saveContactEdits` submits exactly the revision that was read; `null` until an envelope exists, and a caller must then not submit an edit at all rather than mint a revision of its own.
   */
  readonly expectedRevision: string | null;
}

// The jobs this file issues, the address they are asked at, and the one window a paged read states
/** The record's shared-facts job, taken from the family's closed vocabulary so a renamed or removed job fails to compile here. */
const RECORD_JOB = PARTNER_READ_JOBS[0];

/** The caller's own private preparation job, from that same vocabulary. */
const PREPARATION_JOB = PARTNER_READ_JOBS[1];

/** The activity job: the only one of the three whose read states a page window. */
const INTERACTIONS_JOB = PARTNER_READ_JOBS[2];

/** The separator between the record's address and the read job it is asked for. */
const READ_JOB_SEPARATOR = "?";

/** The first page as the transport counts it, and the smallest window this file will ask for. */
const FIRST_PAGE = 1;

/** One page window, resolved from what the caller stated and within the limits the roster read already declares. */
interface ResolvedPaging {
  readonly page: number;
  readonly pageSize: number;
}

/**
 * Resolves the page a caller states into the window this file asks for: a page counted from one, never beyond the family's cap, and the family's default size for a size that was not stated or is not a whole number of at least one.
 */
function resolvedPaging(paging: PartnerActivityPaging | undefined): ResolvedPaging {
  const statedPage = paging?.page;
  const statedSize = paging?.pageSize;
  const page = statedPage !== undefined && Number.isSafeInteger(statedPage) && statedPage >= FIRST_PAGE ? statedPage : FIRST_PAGE;
  const pageSize = statedSize !== undefined && Number.isSafeInteger(statedSize) && statedSize >= 1 ? Math.min(ROSTER_PAGE_SIZE_CAP, statedSize) : ROSTER_PAGE_SIZE_DEFAULT;
  return { page, pageSize };
}

/**
 * The address of one partner record, without a read job: the spelling this family links to, derived from the family's own builder so the path itself is stated once and a job is the only thing ever added to it. The identifier is opaque — it is encoded here and reaches the read exactly as it arrived, never parsed, split, trimmed of a prefix or compared with another identifier.
 */
export function PARTNER_RECORD_READ_PATH(partnerId: string): string {
  const addressedWithJob = partnerRecordReadUrl(partnerId, RECORD_JOB);
  const separatorAt = addressedWithJob.indexOf(READ_JOB_SEPARATOR);
  return separatorAt === -1 ? addressedWithJob : addressedWithJob.slice(0, separatorAt);
}

/** The URL of one named read of the record: the job the path dispatches on, and the page window only where that read states one. */
function recordReadUrl(partnerId: string, job: PartnerReadJob, paging: ResolvedPaging | null): string {
  const addressed = partnerRecordReadUrl(partnerId, job);
  if (paging === null) {
    return addressed;
  }
  const window = new URLSearchParams({ page: String(paging.page), pageSize: String(paging.pageSize) });
  return `${addressed}&${window.toString()}`;
}

// The response boundary: the envelope's frame is checked once for every read by the family's transport, so the payload is the one member left to state
/** Whether a payload is the record body the read documents: a record identified by its own opaque identifier, its relationship context and its open work. */
function isPartnerRecordPayload(payload: unknown): boolean {
  if (!isRecord(payload)) {
    return false;
  }
  const record = payload["partner"];
  return isRecord(record) && isNonEmptyString(record["partnerId"]) && Array.isArray(payload["relationshipContext"]) && Array.isArray(payload["openTasks"]);
}

/** Whether a payload is the private preparation the read documents: the caller's own note bodies, kept apart from any shared section. */
function isPartnerPreparationPayload(payload: unknown): boolean {
  return isRecord(payload) && Array.isArray(payload["notes"]);
}

/** Whether a payload is the activity the read documents: one page of recorded activity with the whole-result count it was cut from. */
function isPartnerInteractionPayload(payload: unknown): boolean {
  return isRecord(payload) && Array.isArray(payload["interactions"]) && typeof payload["total"] === "number" && isRecord(payload["page"]);
}

/**
 * Reads one of the record's jobs and hands its answer on unchanged, unless the envelope carries a payload of another member. The envelope's own frame is the shared transport's check; a payload that is not the read this hook asked for is a fault of the response boundary rather than a state of the records, so it reaches the query's error state instead of rendering as an empty section, a zero or a missing note.
 */
async function readRecordJob<TPayload>(url: string, accepts: (payload: unknown) => boolean): Promise<ReadResult<ReadEnvelope<TPayload>>> {
  const result = await fetchPartnerRead<TPayload>(url);
  if (result.kind !== "envelope" || accepts(result.envelope.data)) {
    return result;
  }
  throw new PartnerReadTransportError(url, undefined, "an envelope whose payload is not the read this hook asked for");
}

/** Whether the scope carries the four identifiers a read runs under, so a read with an unresolved context is never issued. */
function scopeIsAddressed(scope: Scope): boolean {
  return [scope.organizationId, scope.ministryId, scope.supportSubjectId, scope.principalId].every((identifier) => typeof identifier === "string" && identifier.length > 0);
}

/** Whether a read of this record can be issued at all: the context it runs under is resolved and the address names a record. */
function addressesRecord(scope: Scope, partnerId: string): boolean {
  return scopeIsAddressed(scope) && partnerId.trim().length > 0;
}

/** The envelope a settled answer carries, or `null` while it carries none: a denial, an outage and a refusal all carry no envelope. */
function envelopeOf<T>(result: ReadResult<ReadEnvelope<T>> | undefined): ReadEnvelope<T> | null {
  return result !== undefined && result.kind === "envelope" ? result.envelope : null;
}

/**
 * Reads one partner's shared facts under `scope` — identity, the contact methods this caller may use, restrictions, relationship context, open work and the authorised support history — keyed by the scope segments and the record's opaque identifier, and answers `envelope`, `denied`, `unavailable` or `refused` untouched, beside the revision an edit must present.
 */
export function usePartnerRecord(scope: Scope, partnerId: string): PartnerRecordRead {
  const query = useQuery<PartnerRecordResult, Error>({
    // The scope leads the key and the record follows the job segment, which is the shape the family's own refresh policy invalidates: an accepted `saveContactEdits` re-reads `[scope, "partner", partnerId]` and nothing beside it.
    queryKey: [...scopeKey(scope), PARTNER_KEY.record, partnerId],
    queryFn: () => readRecordJob<PartnerRecordData>(recordReadUrl(partnerId, RECORD_JOB, null), isPartnerRecordPayload),
    // A read for an unresolved context or an unnamed record invents nothing: no request is sent, and no envelope is cached under a key that names no record.
    enabled: addressesRecord(scope, partnerId),
    // One view issues one read. A transport that did not answer reaches the query's error state rather than being retried into repeated attempts of the same failure; the surface states the outage and offers its own retry.
    retry: false,
    // No placeholder is carried here, deliberately: an envelope kept from another record while this one landed would render one record's facts under another record's address.
  });
  const envelope = envelopeOf(query.data);
  return { query, expectedRevision: envelope === null ? null : envelope.revision };
}

/**
 * Reads the caller's own private preparation for one record under `scope` — the note bodies this caller wrote and, for the caller's own preparation record, whether it is archived — and answers `envelope`, `denied`, `unavailable` or `refused` untouched. It is a different record class from the shared facts, meant for its own audience-labelled region and never mixed into a shared section.
 */
export function usePartnerPreparation(scope: Scope, partnerId: string): UseQueryResult<PartnerPreparationResult, Error> {
  return useQuery<PartnerPreparationResult, Error>({
    // The same shape as the record key, one segment apart: an accepted `savePrivateNote` or archive re-reads this entry, and a denial here leaves the shared facts on screen untouched.
    queryKey: [...scopeKey(scope), PARTNER_KEY.preparation, partnerId],
    queryFn: () => readRecordJob<PartnerPreparationData>(recordReadUrl(partnerId, PREPARATION_JOB, null), isPartnerPreparationPayload),
    enabled: addressesRecord(scope, partnerId),
    retry: false,
  });
}

/**
 * Reads the activity that actually happened on one record under `scope` — one page of it, newest first, every recorded date carrying the precision it is known to — and answers `envelope`, `denied`, `unavailable` or `refused` untouched. Nothing here counts, dates or reconciles an interaction: the envelope states its own count and each record its own precision.
 */
export function usePartnerInteractions(scope: Scope, partnerId: string, paging?: PartnerActivityPaging): UseQueryResult<PartnerInteractionResult, Error> {
  const window = resolvedPaging(paging);
  return useQuery<PartnerInteractionResult, Error>({
    // Every variable the request states sits in the key, beside the record it belongs to, so two pages are two entries and never one entry serving the other's window.
    queryKey: [...scopeKey(scope), PARTNER_KEY.interactions, partnerId, { page: window.page, pageSize: window.pageSize }],
    queryFn: () => readRecordJob<PartnerInteractionData>(recordReadUrl(partnerId, INTERACTIONS_JOB, window), isPartnerInteractionPayload),
    enabled: addressesRecord(scope, partnerId),
    retry: false,
  });
}
