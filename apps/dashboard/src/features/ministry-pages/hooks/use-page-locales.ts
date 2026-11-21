"use client";
/**
 * The locale editions of one Worker or Project Page, as one browser read.
 *
 * A Page holds one edition per content locale, and each edition carries its own draft, candidate and
 * release: editing the English edition neither overwrites an Arabic draft nor advances a French
 * release. So this read answers the editions as the service states them — every edition with its own
 * lifecycle pointers and its own direction — and this module adds, derives and decides nothing.
 *
 * **One request, one path.** The read goes to this family's own handler. `GET /api/pages` carries the
 * pages family's four Page reads in one place (AAP 0.6.3 gives the family no `/api/pages/[documentId]`
 * route), so the read is named by the `view=locales` discriminator — this family's client-edge
 * convention, since the paths separate reads by what they read rather than by identifier — and the
 * Page by `documentId`.
 *
 * **What the wire carries.** `toResponse` flattens both directions onto the status: for a read, 200
 * carries the envelope itself, 403 the denial and 503 the outage, with no `kind` wrapper. So a body is
 * accepted in either form — the read result union itself, and the flattened answers a Route Handler
 * actually returns — and handed on unchanged once it is one of them.
 *
 * **What it answers when there is no answer.** A request that never completes, and a body that is not
 * one of this read's answers, become `unavailable` built by the service's own constructor. They never
 * become an empty edition list, a synthesised default edition or a `language-unavailable` state: which
 * editions exist, and whether a requested language can be served, is the service's resolution to
 * state, and a surface that invented either would present a decision nobody made.
 *
 * **Direction is data.** Each edition's `direction` travels from the payload to whichever surface
 * places it on `dir`. Nothing here sets a style, a `dir` attribute or a locale of its own.
 *
 * **What it never does.** It holds no state (which edition is being worked on is the switcher's
 * transient selection), reads no clock (the envelope's `asOf` is the instant the answer was taken at),
 * applies no optimistic lifecycle and carries no translation-staleness verdict the service did not
 * send. `retry: false` because a read of a Page's editions is either answered or honestly unavailable,
 * and repeating it silently would only postpone that answer to the person waiting for it.
 */
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

/** The status a read envelope arrives under; the read's other two answers arrive as a denial (403) or an outage (503). */
const ENVELOPE_STATUS = 200;

/**
 * The source this read names when it produced no readable answer.
 *
 * It is the browser transport rather than the local store, because the request can fail before it
 * reaches the service and naming the store would claim knowledge of where the failure happened. An
 * opaque reference only: it is displayed as text and never parsed.
 */
const TRANSPORT_SOURCE_SYSTEM = "browser-transport";

/**
 * The attempt marker a failed read carries where a mutation would carry its operation id.
 *
 * A `GET` performs no effect, so it has no operation to name and mints no identifier: `"read"` is the
 * same non-unique marker the service's own read results carry, which keeps a failed read from being
 * mistaken for a change someone could replay.
 */
const READ_ATTEMPT_ID = "read";

/** The key a Page's editions are cached under while no Page is named; the query is disabled then, so it is never sent. */
const UNNAMED_DOCUMENT = "";

/** Why a request that never completed could not answer, stated for the reader's next step. */
const TRANSPORT_GUIDANCE =
  "The request for this Page's language editions did not complete, so this list states nothing about which editions exist. Reading it changes nothing, so retrying the same read is safe.";

// ---------------------------------------------------------------------------------------------
// The payload, taken from the read that produces it
// ---------------------------------------------------------------------------------------------

/** What the named read answers, derived from the read itself: `ReadResult<ReadEnvelope<PageLocalesData>>`. */
type PageLocalesServiceResult = Awaited<ReturnType<typeof reads.pages.readPageLocales>>;

/**
 * The payload of that answer: the canonical Page, how the requested language was resolved, one entry
 * per edition, and the locales a reader may open.
 *
 * It is the service's own payload rather than a second description of it, so the draft, candidate and
 * release pointers, the reach metadata and the language resolution a surface reads are exactly the
 * ones the read stated — the shape cannot drift from the wire, and an edition that a later change adds
 * a member to reaches every surface as a compile error instead of a silently missing field.
 */
export type PageLocalesData = Extract<PageLocalesServiceResult, { readonly kind: "envelope" }>["envelope"]["data"];

/**
 * One edition of the Page as the service states it.
 *
 * It carries the content locale the edition is authored and read in — its BCP-47 tag and its
 * `direction` — and its own `draftRevisionId`, `candidateId` and `releaseHeadId`, which are the
 * variant identity a lifecycle surface reports. There is no edition status alongside them, on purpose:
 * one edition's candidate or withdrawal is never presented as another edition's.
 */
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

/**
 * Whether a value is the locale payload this read renders.
 *
 * A narrowing of what the payload must carry to be usable — the Page, the resolution and the two
 * lists — not a second envelope implementation: no value state, coverage or action is derived here,
 * because the envelope's own members are handed on exactly as the service built them.
 */
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
  return (
    isPageLocalesData(data) && isRecord(scope) && isRecord(source) && typeof revision === "string" && typeof asOf === "string" && isRecord(coverage) && isRecord(valueStates) && Array.isArray(actions)
  );
}

/**
 * Narrows one answer to this read's own result.
 *
 * Both forms are recognised: the read result union, and the flattened answers `toResponse` puts on the
 * wire — the envelope under 200, the denial under 403, the outage under 503. Anything else answers
 * `undefined`, so the caller states the outage the service would have stated.
 */
function readResultOf(body: unknown, status: number): PageLocalesReadResult | undefined {
  if (isReadResult(body)) {
    switch (body.kind) {
      case "envelope":
        return isPageLocalesEnvelope(body.envelope) ? { kind: "envelope", envelope: body.envelope } : undefined;
      case "denied":
        return { kind: "denied", denied: body.denied };
      case "unavailable":
        return { kind: "unavailable", unavailable: body.unavailable };
      default:
        return assertNever(body, "Unhandled read result");
    }
  }
  if (isOutcome(body)) {
    // A read answers with exactly two of the eight outcomes; any other one is not this read's answer.
    if (body.outcome === "denied") {
      return { kind: "denied", denied: body };
    }
    if (body.outcome === "unavailable") {
      return { kind: "unavailable", unavailable: body };
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
  return {
    kind: "unavailable",
    unavailable: unavailable({
      operationId: READ_ATTEMPT_ID,
      source: { system: TRANSPORT_SOURCE_SYSTEM, reference: PAGES_READ_ENDPOINT },
      guidance,
    }),
  };
}

/** Why a body that reached the application still could not be read as this read's answer. */
function unrecognisedAnswerGuidance(status: number): string {
  return `The language-edition read at ${PAGES_READ_ENDPOINT} answered ${String(status)} with a body that is not one of this read's answers, so the editions are unavailable rather than empty. Reading it again changes nothing, so retrying is safe.`;
}

async function requestPageLocales(documentId: string): Promise<PageLocalesReadResult> {
  let answer: Response;
  try {
    answer = await fetch(`${PAGES_READ_ENDPOINT}?view=${LOCALES_VIEW}&documentId=${encodeURIComponent(documentId)}`, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
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

/**
 * Reads the admitted locale editions of one Page, each with its own draft/candidate/release and direction; returns an envelope or a `denied`/`unavailable` outcome.
 *
 * The key sits beneath `pageKey`, so an accepted change to the Page re-reads the editions with no
 * extra plumbing, and every rejected or unavailable answer reaches the surface as the outcome the
 * service stated rather than as a thrown fault. Pass `undefined` while no Page is chosen: the query is
 * idle, sends nothing and holds no edition list to mistake for an answer.
 */
export function usePageLocales(scope: Scope, documentId: string | undefined): UseQueryResult<PageLocalesReadResult, never> {
  return useQuery<PageLocalesReadResult, never>({
    queryKey: pageLocalesKey(scope, documentId ?? UNNAMED_DOCUMENT),
    queryFn: () => requestPageLocales(documentId ?? UNNAMED_DOCUMENT),
    enabled: Boolean(documentId),
    retry: false,
  });
}
