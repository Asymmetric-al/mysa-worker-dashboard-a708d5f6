"use client";
/** The locale editions of one Worker or Project Page, as one browser read. */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { isRecord } from "@/lib/guards";
import { assertNever } from "@/lib/result";
import type { reads } from "@/modules/data-service";
import type { ReadEnvelope, Scope } from "@/modules/data-service/envelope";
// The outcome module rather than the service barrel, because this is a browser module: a value import
// of the barrel would pull every read, every mutation and the store into the client bundle. The barrel
// carries the contract types a boundary names; the guard and the constructor a client answers with are
// owned here, and are imported from their owner rather than restated, so a fourth read-result member
// or a changed outage shape reaches this file as a compile error instead of drifting. The sibling
// `use-page-mutation.ts` reads the same module for the same reason.
import { isOutcome, isReadResult, unavailable, type ReadResult } from "@/modules/data-service/outcome";
import { pageLocalesKey } from "./page-query-keys";

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** The pages family's read handler: the one path its Page reads share (AAP 0.6.3). */
const PAGES_READ_ENDPOINT = "/api/pages";

/** The discriminator that selects the locale editions among the reads that handler answers. */
const LOCALES_VIEW = "locales";

/** The status a read envelope arrives under; the read's other two answers arrive as a denial (403, or 401 when the session expired or could not be established) or an outage (503). */
const ENVELOPE_STATUS = 200;

/** The source this read names when it produced no readable answer. */
const TRANSPORT_SOURCE_SYSTEM = "browser-transport";

/** The attempt marker a failed read carries where a mutation would carry its operation id. */
const READ_ATTEMPT_ID = "read";

/** The key a Page's editions are cached under while no Page is named; the query is disabled then, so it is never sent. */
const UNNAMED_DOCUMENT = "";

/** Why a request that never completed could not answer, stated for the reader's next step. */
const TRANSPORT_GUIDANCE = "The request for this Page's language editions did not complete, so this list states nothing about which editions exist. Reading it changes nothing, so retrying the same read is safe.";

// ---------------------------------------------------------------------------------------------
// The payload, taken from the read that produces it
// ---------------------------------------------------------------------------------------------

/** What the named read answers, derived from the read itself: `ReadResult<ReadEnvelope<PageLocalesData>>`. */
type PageLocalesServiceResult = Awaited<ReturnType<typeof reads.pages.readPageLocales>>;

/** The payload of that answer: the canonical Page, how the requested language was resolved, one entry per edition, and the locales a reader may open. */
export type PageLocalesData = Extract<PageLocalesServiceResult, { readonly kind: "envelope" }>["envelope"]["data"];

/** One edition of the Page as the service states it. */
export type PageLocaleEdition = PageLocalesData["editions"][number];

/** One locale a reader may open: the tag and direction that would be served, and the release that serves it. */
export type PageAdmittedLocale = PageLocalesData["admittedLocales"][number];

/** How the requested language was answered: the served edition, whether serving it was a fallback, or *Language unavailable*. */
export type PageLocaleResolution = PageLocalesData["resolution"];

/** The envelope this read returns: the payload with the scope, source, revision, as-of, coverage and value states the service stated. */
export type PageLocalesEnvelope = ReadEnvelope<PageLocalesData>;

/** What this read answers: the scoped envelope, a denial, or an unavailable source. */
export type PageLocalesReadResult = ReadResult<PageLocalesEnvelope>;

// ---------------------------------------------------------------------------------------------
// Narrowing one answer
// ---------------------------------------------------------------------------------------------

/** Whether a value is the locale payload this read renders. */
function isPageLocalesData(value: unknown): value is PageLocalesData {
  if (!isRecord(value)) {
    return false;
  }
  const { document, requestedLocale, resolution, editions, admittedLocales } = value;
  return isRecord(document) && typeof requestedLocale === "string" && isRecord(resolution) && Array.isArray(editions) && Array.isArray(admittedLocales);
}

/** Whether the parsed body is the read envelope this hook renders: the payload inside the eight members every read returns. */
function isPageLocalesEnvelope(value: unknown): value is PageLocalesEnvelope {
  if (!isRecord(value)) {
    return false;
  }
  const { data, scope, source, revision, asOf, coverage, valueStates, actions } = value;
  return isPageLocalesData(data) && isRecord(scope) && isRecord(source) && typeof revision === "string" && typeof asOf === "string" && isRecord(coverage) && isRecord(valueStates) && Array.isArray(actions);
}

/** Narrows one answer to this read's own result. */
function readResultOf(body: unknown, status: number): PageLocalesReadResult | undefined {
  if (isReadResult(body)) {
    switch (body.kind) {
      case "envelope":
        return isPageLocalesEnvelope(body.envelope) ? { kind: "envelope", envelope: body.envelope } : undefined;
      case "denied":
        return { kind: "denied", denied: body.denied };
      case "unavailable":
        return { kind: "unavailable", unavailable: body.unavailable };
      case "refused":
        return { kind: "refused", refused: body.refused };
      default:
        return assertNever(body, "Unhandled read result");
    }
  }
  if (isOutcome(body)) {
    // A read answers with exactly three of the eight outcomes; any other one is not this read's answer.
    if (body.outcome === "denied") {
      return { kind: "denied", denied: body };
    }
    if (body.outcome === "unavailable") {
      return { kind: "unavailable", unavailable: body };
    }
    if (body.outcome === "invalid") {
      // The request named something this read does not admit: the field-keyed refusal is the read's own
      // answer, and no source behind it failed.
      return { kind: "refused", refused: body };
    }
  }
  if (status === ENVELOPE_STATUS && isPageLocalesEnvelope(body)) {
    return { kind: "envelope", envelope: body };
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// The transport
// ---------------------------------------------------------------------------------------------

async function readJsonBody(answer: Response): Promise<unknown> {
  try {
    return await answer.json();
  } catch {
    return undefined;
  }
}

/** The outage this read answers with when it produced no readable answer: never an empty list and never a zero. */
function unavailableRead(guidance: string): PageLocalesReadResult {
  return { kind: "unavailable", unavailable: unavailable({ operationId: READ_ATTEMPT_ID, source: { system: TRANSPORT_SOURCE_SYSTEM, reference: PAGES_READ_ENDPOINT }, guidance }) };
}

/** Why a body that reached the application still could not be read as this read's answer. */
function unrecognisedAnswerGuidance(status: number): string {
  return `The language-edition read at ${PAGES_READ_ENDPOINT} answered ${String(status)} with a body that is not one of this read's answers, so the editions are unavailable rather than empty. Reading it again changes nothing, so retrying is safe.`;
}

async function requestPageLocales(documentId: string): Promise<PageLocalesReadResult> {
  let answer: Response;
  try {
    answer = await fetch(`${PAGES_READ_ENDPOINT}?view=${LOCALES_VIEW}&documentId=${encodeURIComponent(documentId)}`, { method: "GET", credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
  } catch {
    return unavailableRead(TRANSPORT_GUIDANCE);
  }
  const body = await readJsonBody(answer);
  const result = readResultOf(body, answer.status);
  return result ?? unavailableRead(unrecognisedAnswerGuidance(answer.status));
}

// ---------------------------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------------------------

/** Reads the admitted locale editions of one Page, each with its own draft/candidate/release and direction; returns an envelope or a `denied`/`unavailable` outcome. */
export function usePageLocales(scope: Scope, documentId: string | undefined): UseQueryResult<PageLocalesReadResult, never> {
  return useQuery<PageLocalesReadResult, never>({ queryKey: pageLocalesKey(scope, documentId ?? UNNAMED_DOCUMENT), queryFn: () => requestPageLocales(documentId ?? UNNAMED_DOCUMENT), enabled: Boolean(documentId), retry: false });
}
