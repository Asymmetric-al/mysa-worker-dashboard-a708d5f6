"use client";
/**
 * The Worker and Project Pages family's catalogue read: the client half of
 * `reads.pages.readPageCatalogues`, whose outcome set is `envelope | denied | unavailable`.
 *
 * Reads the two guided family catalogues and the eight admitted section types with their bounded
 * presentation choices; returns an envelope or a `denied`/`unavailable` outcome. Nothing else in the
 * family states a section type or a presentation option of its own: both come from this answer.
 *
 * **Why `view=catalogues`.** The family has six handler paths and no per-Page route file, so its four
 * Page reads share `GET /api/pages` and are told apart by one required `view` parameter —
 * `catalogues`, `page`, `locales` or `giving-binding`. That is the family's client-edge convention,
 * and the handler reads this hook's discriminator.
 *
 * **What the wire carries.** A read is flattened onto the status: 200 is the envelope itself, 403 the
 * denial and 503 the outage, none of them wrapped in a `kind`. Both that form and a `kind`-wrapped
 * result are the service's own answer and both are accepted; a rejected request, a body that is not
 * JSON and a body of neither shape become the service's `unavailable` outcome. A catalogue that did
 * not arrive is unavailable, never empty, because "this family offers no sections" and "the source
 * did not answer" must not render alike.
 *
 * **One GET, one key.** This is the only place the catalogues request is made and `pageCataloguesKey`
 * is the only key it uses. The cache holds this read's envelope alone: no value is derived here, and
 * `asOf`, `coverage`, `valueStates` and `actions` are never recomputed. The payload type is taken from
 * the service rather than restated, so the section-type vocabulary and the presentation sets remain
 * the service's to define.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { isNonEmptyString, isRecord } from "@/lib/guards";
import { PRESENTATION_CHOICES } from "@/modules/content/document";
import type { ReadEnvelope, Scope, reads } from "@/modules/data-service";
import { isOutcome, isReadResult, unavailable, type DeniedOutcome, type ReadResult, type UnavailableOutcome } from "@/modules/data-service/outcome";
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

const DENIED_STATUS = 403;

const UNAVAILABLE_STATUS = 503;

const TRANSPORT_GUIDANCE = "The catalogue request did not reach the application, so the family catalogues are unavailable rather than empty. Reload this surface to read them again.";

// Shape guards: what the surface promises to render, checked before it is handed on
/**
 * Reports whether one presentation option set holds only values the content profile admits, so a
 * fifth option — or free-form CSS, HTML or an embed — is refused rather than styled. The admitted
 * values come from `modules/content/document`, never from a list restated here.
 */
function isAdmittedValueSet(value: unknown, admitted: readonly string[]): boolean {
  return Array.isArray(value) && value.length > 0 && value.every((member: unknown) => typeof member === "string" && admitted.includes(member));
}

function isPresentationChoices(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isAdmittedValueSet(value["treatment"], PRESENTATION_CHOICES.treatment) &&
    isAdmittedValueSet(value["layout"], PRESENTATION_CHOICES.layout) &&
    isAdmittedValueSet(value["alignment"], PRESENTATION_CHOICES.alignment) &&
    isAdmittedValueSet(value["imageFit"], PRESENTATION_CHOICES.imageFit)
  );
}

function isCatalogueSection(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const lockReasonKey = value["lockReasonKey"];
  const fields = value["fields"];
  return (
    isNonEmptyString(value["key"]) &&
    isNonEmptyString(value["labelKey"]) &&
    typeof value["managed"] === "boolean" &&
    (lockReasonKey === null || typeof lockReasonKey === "string") &&
    Array.isArray(fields) &&
    fields.every((field: unknown) => typeof field === "string") &&
    isPresentationChoices(value["presentation"])
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
  return (
    Array.isArray(catalogues) &&
    catalogues.length > 0 &&
    catalogues.every(isCatalogue) &&
    isPresentationChoices(value["presentation"]) &&
    Array.isArray(structuralOperations) &&
    structuralOperations.every((operation: unknown) => typeof operation === "string") &&
    Array.isArray(presets)
  );
}

function isCatalogueEnvelope(value: unknown): value is PageCataloguesEnvelope {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isCatalogueData(value["data"]) &&
    isRecord(value["scope"]) &&
    isRecord(value["source"]) &&
    isNonEmptyString(value["revision"]) &&
    isNonEmptyString(value["asOf"]) &&
    isRecord(value["coverage"]) &&
    isRecord(value["valueStates"]) &&
    Array.isArray(value["actions"])
  );
}

function isDeniedAnswer(value: unknown): value is DeniedOutcome {
  return isOutcome(value) && value.outcome === "denied";
}

function isUnavailableAnswer(value: unknown): value is UnavailableOutcome {
  return isOutcome(value) && value.outcome === "unavailable";
}

// The transport: one GET, and the service's own answer out of it
function unavailableAnswer(guidance: string): PageCataloguesRead {
  return {
    kind: "unavailable",
    unavailable: unavailable({
      operationId: READ_ATTEMPT_ID,
      source: { system: HANDLER_SOURCE_SYSTEM, reference: CATALOGUES_ENDPOINT },
      guidance,
    }),
  };
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
    return isCatalogueEnvelope(body.envelope) ? { kind: "envelope", envelope: body.envelope } : unreadableAnswer(status);
  }
  if (status === ENVELOPE_STATUS && isCatalogueEnvelope(body)) {
    return { kind: "envelope", envelope: body };
  }
  if (status === DENIED_STATUS && isDeniedAnswer(body)) {
    return { kind: "denied", denied: body };
  }
  if (status === UNAVAILABLE_STATUS && isUnavailableAnswer(body)) {
    return { kind: "unavailable", unavailable: body };
  }
  return unreadableAnswer(status);
}

async function requestCatalogues(): Promise<PageCataloguesRead> {
  let answer: Response;
  try {
    answer = await fetch(CATALOGUES_ENDPOINT, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
  } catch {
    return unavailableAnswer(TRANSPORT_GUIDANCE);
  }
  return asCataloguesRead(await readJsonBody(answer), answer.status);
}

/**
 * Reads the two guided family catalogues in the given scope.
 *
 * The key leads with the scope, so a context switch reads a different entry, and the query is never
 * retried: a denial and an outage are answers the surface states at once, not transient faults. There
 * is no initial data and no placeholder — either would render an empty catalogue before the source
 * answered — and no stale time, because nothing here reads a clock.
 */
export function usePageCatalogues(scope: Scope): UseQueryResult<ReadResult<ReadEnvelope<PageCataloguesData>>, never> {
  return useQuery<PageCataloguesRead, never>({
    queryKey: pageCataloguesKey(scope),
    queryFn: requestCatalogues,
    retry: false,
  });
}
