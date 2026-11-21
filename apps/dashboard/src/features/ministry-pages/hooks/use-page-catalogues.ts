"use client";
/** The Worker and Project Pages family's catalogue read: the client half of `reads.pages.readPageCatalogues`, whose outcome set is `envelope | denied | unavailable`. */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { isNonEmptyString, isRecord } from "@/lib/guards";
import { PRESENTATION_CHOICES } from "@/modules/content/document";
import type { ReadEnvelope, Scope, reads } from "@/modules/data-service";
import { isOutcome, isReadResult, unavailable, type DeniedOutcome, type InvalidOutcome, type ReadResult, type UnavailableOutcome } from "@/modules/data-service/outcome";
import { pageCataloguesKey } from "./page-query-keys";

/** What `reads.pages.readPageCatalogues` answers, taken from the service so this hook cannot drift from it. */
export type PageCataloguesAnswer = Awaited<ReturnType<typeof reads.pages.readPageCatalogues>>;
/** The envelope arm of {@link PageCataloguesAnswer}: both catalogues and the facts that state what they are. */
export type PageCataloguesEnvelope = Extract<PageCataloguesAnswer, { readonly kind: "envelope" }>["envelope"];
/** The catalogue payload — two family catalogues, the admitted section types and their bounded presentation choices. Mirrors the service's payload, which remains authoritative for it. */
export type PageCataloguesData = PageCataloguesEnvelope["data"];
/** This read's whole answer: the envelope, a denial, or an outage. */
export type PageCataloguesRead = ReadResult<ReadEnvelope<PageCataloguesData>>;

/** The catalogues read: `GET /api/pages` with the family's `view` discriminator. */
const CATALOGUES_ENDPOINT = "/api/pages?view=catalogues";
/** The source named when a request produced no readable answer: the transport, because that is where the failure happened. Opaque, and never parsed. */
const HANDLER_SOURCE_SYSTEM = "data-service";
/** A read has no operation identity of its own; the service names read-level outcomes with this one, and so does this hook. */
const READ_ATTEMPT_ID = "read";

const ENVELOPE_STATUS = 200;

/** The two statuses a denial answers with: 403 for a refused authority, and 401 for a session that expired or could not be established. */
const DENIED_STATUSES: ReadonlySet<number> = new Set([401, 403]);

const UNAVAILABLE_STATUS = 503;

/** A request this read does not admit answers 422 with the field-keyed refusal, which is the request's own fault and not a source that did not answer. */
const REFUSED_STATUS = 422;

const TRANSPORT_GUIDANCE = "The catalogue request did not reach the application, so the family catalogues are unavailable rather than empty. Reload this surface to read them again.";

// Shape guards: what the surface promises to render, checked before it is handed on
/** Reports whether one presentation option set holds only values the content profile admits, so a fifth option — or free-form CSS, HTML or an embed — is refused rather than styled. */
function isAdmittedValueSet(value: unknown, admitted: readonly string[]): boolean {
  return Array.isArray(value) && value.length > 0 && value.every((member: unknown) => typeof member === "string" && admitted.includes(member));
}

function isPresentationChoices(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return isAdmittedValueSet(value["treatment"], PRESENTATION_CHOICES.treatment) && isAdmittedValueSet(value["layout"], PRESENTATION_CHOICES.layout) && isAdmittedValueSet(value["alignment"], PRESENTATION_CHOICES.alignment) && isAdmittedValueSet(value["imageFit"], PRESENTATION_CHOICES.imageFit);
}

function isCatalogueSection(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const lockReasonKey = value["lockReasonKey"];
  const fields = value["fields"];
  return (
    isNonEmptyString(value["key"]) && isNonEmptyString(value["labelKey"]) && typeof value["managed"] === "boolean" && (lockReasonKey === null || typeof lockReasonKey === "string") && Array.isArray(fields) && fields.every((field: unknown) => typeof field === "string") && isPresentationChoices(value["presentation"])
  );
}

function isCatalogue(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const sections = value["sections"];
  return isNonEmptyString(value["family"]) && isNonEmptyString(value["labelKey"]) && Array.isArray(sections) && sections.every(isCatalogueSection);
}

function isCatalogueData(value: unknown): value is PageCataloguesData {
  if (!isRecord(value)) {
    return false;
  }
  const catalogues = value["catalogues"];
  const structuralOperations = value["structuralOperations"];
  const presets = value["presets"];
  // The family list is never empty: a curated catalogue is one catalogue per family, so an empty list
  // is an answer this read does not give and is treated as unreadable rather than as nothing to offer.
  return Array.isArray(catalogues) && catalogues.length > 0 && catalogues.every(isCatalogue) && isPresentationChoices(value["presentation"]) && Array.isArray(structuralOperations) && structuralOperations.every((operation: unknown) => typeof operation === "string") && Array.isArray(presets);
}

function isCatalogueEnvelope(value: unknown): value is PageCataloguesEnvelope {
  if (!isRecord(value)) {
    return false;
  }
  return isCatalogueData(value["data"]) && isRecord(value["scope"]) && isRecord(value["source"]) && isNonEmptyString(value["revision"]) && isNonEmptyString(value["asOf"]) && isRecord(value["coverage"]) && isRecord(value["valueStates"]) && Array.isArray(value["actions"]);
}

function isDeniedAnswer(value: unknown): value is DeniedOutcome {
  return isOutcome(value) && value.outcome === "denied";
}

function isUnavailableAnswer(value: unknown): value is UnavailableOutcome {
  return isOutcome(value) && value.outcome === "unavailable";
}

function isRefusedAnswer(value: unknown): value is InvalidOutcome {
  return isOutcome(value) && value.outcome === "invalid";
}

// The transport: one GET, and the service's own answer out of it
function unavailableAnswer(guidance: string): PageCataloguesRead {
  return { kind: "unavailable", unavailable: unavailable({ operationId: READ_ATTEMPT_ID, source: { system: HANDLER_SOURCE_SYSTEM, reference: CATALOGUES_ENDPOINT }, guidance }) };
}

function unreadableAnswer(status: number): PageCataloguesRead {
  return unavailableAnswer(`${TRANSPORT_GUIDANCE} The handler answered ${String(status)} with no catalogue this surface can read.`);
}

async function readJsonBody(answer: Response): Promise<unknown> {
  try {
    return await answer.json();
  } catch {
    return undefined;
  }
}

/** Turns whatever came back into this read's own answer; every branch that is not the service's answer is an outage. */
function asCataloguesRead(body: unknown, status: number): PageCataloguesRead {
  if (isReadResult(body)) {
    if (body.kind === "denied") {
      return { kind: "denied", denied: body.denied };
    }
    if (body.kind === "unavailable") {
      return { kind: "unavailable", unavailable: body.unavailable };
    }
    if (body.kind === "refused") {
      return { kind: "refused", refused: body.refused };
    }
    return isCatalogueEnvelope(body.envelope) ? { kind: "envelope", envelope: body.envelope } : unreadableAnswer(status);
  }
  if (status === ENVELOPE_STATUS && isCatalogueEnvelope(body)) {
    return { kind: "envelope", envelope: body };
  }
  if (DENIED_STATUSES.has(status) && isDeniedAnswer(body)) {
    return { kind: "denied", denied: body };
  }
  if (status === UNAVAILABLE_STATUS && isUnavailableAnswer(body)) {
    return { kind: "unavailable", unavailable: body };
  }
  if (status === REFUSED_STATUS && isRefusedAnswer(body)) {
    return { kind: "refused", refused: body };
  }
  return unreadableAnswer(status);
}

async function requestCatalogues(): Promise<PageCataloguesRead> {
  let answer: Response;
  try {
    answer = await fetch(CATALOGUES_ENDPOINT, { method: "GET", credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
  } catch {
    return unavailableAnswer(TRANSPORT_GUIDANCE);
  }
  return asCataloguesRead(await readJsonBody(answer), answer.status);
}

/** Reads the two guided family catalogues in the given scope. */
export function usePageCatalogues(scope: Scope): UseQueryResult<ReadResult<ReadEnvelope<PageCataloguesData>>, never> {
  return useQuery<PageCataloguesRead, never>({ queryKey: pageCataloguesKey(scope), queryFn: requestCatalogues, retry: false });
}
