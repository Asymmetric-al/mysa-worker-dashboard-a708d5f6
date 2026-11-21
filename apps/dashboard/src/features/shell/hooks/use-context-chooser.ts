"use client";
/**
 * The context chooser, as one TanStack Query read.
 *
 * **The job.** Read the memberships this session may act in — the service's own `readContextChooser`
 * (AAP 0.6.1) — in the browser, so a caller that needs the chooser re-reads it without a Server
 * Component round trip, and answer in the shell family's one result vocabulary: `ready`, `denied`,
 * `unavailable`, `unknown` or `loading`, beside `retry()` and `discarded`.
 *
 * **The transport.** `GET /api/session?job=context-chooser`. AAP 0.6.3 declares `GET /api/session` for
 * the session family, so the chooser job rides that one path with the job named in the query string
 * rather than a second endpoint; the path is written once, in {@link CHOOSER_ENDPOINT}.
 *
 * **What it never does.** It derives no context from a display name, an email address or a postal
 * address (AAP 0.7.1: equal-looking identifiers establish neither identity nor authority), mints no
 * operation identity, holds no copy of the membership list beyond the cached envelope, filters, sorts,
 * hides or de-duplicates nothing (the envelope is passed through untouched, and a component renders the
 * labels the service supplied), and clears no cache: the one clear in this application belongs to the
 * fence in `components/context-switch-guard`.
 */
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";

import { SCOPE_KEY_ROOT, isStale, scopeKey } from "@/components/context-switch-guard";
import { isRecord } from "@/lib/guards";
import type { SourceReference } from "@/lib/ids";
import type { ReadEnvelope, Scope } from "@/modules/data-service/envelope";
import { isOutcome, type DenialReason } from "@/modules/data-service/outcome";
import type { ContextChooserData } from "@/modules/data-service/reads/shell";

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** The job this read names on the session handler, and the segment it occupies in the query key. */
const CHOOSER_JOB = "context-chooser";

/** The one path this file fetches: the declared session handler, with the chooser job named. */
const CHOOSER_ENDPOINT = `/api/session?job=${CHOOSER_JOB}`;

// ---------------------------------------------------------------------------------------------
// What the handler answers
// ---------------------------------------------------------------------------------------------

/**
 * One settled chooser request, in the shape the application's read contract already declares: the
 * scoped envelope, the denial, the outage, or a body this file does not recognise.
 *
 * A returned union rather than a thrown error, because none of the four is a fault: a denial is an
 * answer about authority, an outage names the source that could not answer, and an unrecognised body is
 * a fact about the response. Only a cancelled request rejects, and that rejection describes a context
 * being left, so it is passed on and dropped with the query.
 */
type ChooserAnswer =
  | { readonly kind: "envelope"; readonly envelope: ReadEnvelope<ContextChooserData> }
  | { readonly kind: "denied"; readonly reason: DenialReason }
  | { readonly kind: "unavailable"; readonly source: SourceReference | null }
  | { readonly kind: "unknown" };

/** The mutable holder of the last source this surface was told about, so a transport failure names it. */
interface LastSource {
  current: SourceReference | null;
}

function isScope(value: unknown): value is Scope {
  return isRecord(value) && typeof value.organizationId === "string" && typeof value.ministryId === "string" && typeof value.supportSubjectId === "string" && typeof value.principalId === "string";
}

function isSourceReference(value: unknown): value is SourceReference {
  return isRecord(value) && typeof value.system === "string" && typeof value.reference === "string";
}

function isChooserGroup(value: unknown): boolean {
  if (!isRecord(value) || typeof value.organizationId !== "string" || typeof value.organizationLabel !== "string" || !Array.isArray(value.ministries)) {
    return false;
  }
  return value.ministries.every(
    (ministry: unknown) =>
      isRecord(ministry) &&
      typeof ministry.ministryId === "string" &&
      typeof ministry.ministryLabel === "string" &&
      typeof ministry.supportSubjectId === "string" &&
      typeof ministry.selected === "boolean",
  );
}

function isChooserData(value: unknown): value is ContextChooserData {
  return isRecord(value) && typeof value.directEntry === "boolean" && Array.isArray(value.groups) && value.groups.every(isChooserGroup);
}

/**
 * Whether a 200 body is the chooser's read envelope.
 *
 * The envelope is checked structurally, member by member, because the handler answers with the envelope
 * itself (`toResponse` writes the envelope as the 200 body) and this file must not hand a component a
 * value that only looks like one: every member a surface reads is required here, including the ones this
 * hook does not read, so an envelope missing its coverage or its actions is reported as unrecognised
 * rather than rendered as complete.
 */
function isChooserEnvelope(value: unknown): value is ReadEnvelope<ContextChooserData> {
  return (
    isRecord(value) &&
    isChooserData(value.data) &&
    isScope(value.scope) &&
    isSourceReference(value.source) &&
    typeof value.revision === "string" &&
    typeof value.asOf === "string" &&
    isRecord(value.coverage) &&
    isRecord(value.valueStates) &&
    Array.isArray(value.actions)
  );
}

// ---------------------------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------------------------

/**
 * Reads the chooser from the one path, and answers with one of the four settled shapes.
 *
 * A request that never reached the handler, and a body that is not JSON, answer `unavailable` with the
 * last source this surface was told about — never with an empty membership list, because "no choices"
 * and "could not read the choices" are different facts about a session. A body that is none of the three
 * recognised shapes answers `unknown`: it states no effect to check, so it names no operation.
 */
async function requestChooser(signal: AbortSignal | undefined, lastSource: LastSource): Promise<ChooserAnswer> {
  let response: Response;
  try {
    response = await fetch(CHOOSER_ENDPOINT, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal,
    });
  } catch (error) {
    // A cancelled request is not an answer: the fence cancels and clears before a context switch, so a
    // rejection here describes the context being left rather than a failure worth reporting.
    if (signal?.aborted === true) {
      throw error;
    }
    return { kind: "unavailable", source: lastSource.current };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (signal?.aborted === true) {
      throw error;
    }
    return { kind: "unavailable", source: lastSource.current };
  }

  if (isChooserEnvelope(body)) {
    lastSource.current = body.source;
    return { kind: "envelope", envelope: body };
  }
  if (isOutcome(body) && body.outcome === "denied") {
    // The closed code and nothing else: a denial never carries a count, a title or an existence hint,
    // so there is nothing further this file could pass on even if a body carried it.
    return { kind: "denied", reason: body.reasonCode };
  }
  if (isOutcome(body) && body.outcome === "unavailable") {
    lastSource.current = body.source;
    return { kind: "unavailable", source: body.source };
  }
  return { kind: "unknown" };
}

// ---------------------------------------------------------------------------------------------
// The result
// ---------------------------------------------------------------------------------------------

/** What a caller renders the chooser from: the envelope, or the reason there is no list of choices. */
export type ContextChooserResult =
  | { readonly state: "ready"; readonly envelope: ReadEnvelope<ContextChooserData> }
  | { readonly state: "denied"; readonly reason: DenialReason }
  | { readonly state: "unavailable"; readonly source: SourceReference | null }
  | { readonly state: "unknown"; readonly operationId?: string }
  | { readonly state: "loading" };

/** The result, plus the two facts a caller needs that are not part of the closed state set. */
export type ContextChooser = ContextChooserResult & {
  /** Asks the same read again. It clears nothing, invalidates nothing and mints no operation identity. */
  retry(): void;
  /** Whether a settled answer was dropped because it described a context this surface has left. */
  readonly discarded: boolean;
};

interface MappedResult {
  readonly result: ContextChooserResult;
  readonly discarded: boolean;
}

/**
 * Reads the memberships this session may act in, answering `ready | denied | unavailable | unknown |
 * loading` together with `retry()` and `discarded`.
 *
 * `enabled` comes from the caller, computed from the admission envelope it already holds
 * (`admittedMemberships.length > 1`), so a session admitted to a single ministry issues no request at
 * all and never renders a chooser (AAP 0.10.1: "one ministry opens directly"). The hook does not
 * re-derive that test: the gate above it owns the question, and a second copy of the rule could answer
 * differently. `initial` is the Server Component gate's own envelope, so the first paint reads the
 * chooser the server already built instead of waiting on a client round trip.
 */
export function useContextChooser(enabled: boolean, initial?: ReadEnvelope<ContextChooserData>): ContextChooser {
  // The context this surface is read under, as its own server answer states it. It is the only reference
  // a late envelope can be compared against, and it is absent when no envelope was supplied — in which
  // case nothing here can tell whether an answer is stale, and the query key carries no context at all.
  const currentScope = initial?.scope;
  const lastSource = useRef<SourceReference | null>(initial?.source ?? null);

  const key = useMemo<readonly unknown[]>(
    () =>
      // A key is scope-led so one prefix invalidation, and the fence's clear, cover every job in a
      // context. Before any envelope exists there is no context to name, and a key completed with a
      // guessed identifier would be a cache entry claiming authority this surface never had.
      currentScope === undefined ? [SCOPE_KEY_ROOT, CHOOSER_JOB, null] : [...scopeKey(currentScope), CHOOSER_JOB, null],
    [currentScope],
  );

  const query = useQuery<ChooserAnswer, Error>({
    queryKey: key,
    queryFn: ({ signal }) => requestChooser(signal, lastSource),
    enabled,
    initialData: initial === undefined ? undefined : { kind: "envelope", envelope: initial },
    initialDataUpdatedAt: 0,
    staleTime: 0,
    // Nothing retries this read on the reader's behalf: an automatic second request would delay the
    // honest sourced failure and hide whether the first one was refused. `retry()` is the recovery the
    // caller offers, and the person chooses it.
    retry: false,
  });

  const { data, refetch } = query;

  const mapped = useMemo<MappedResult>(() => {
    if (!enabled) {
      // The caller deliberately did not issue this job, so there is nothing to say about it. A busy
      // indicator, an empty chooser or an outage notice would each describe a request nobody made; the
      // caller renders nothing at all for a job it did not issue.
      return { result: { state: "loading" }, discarded: false };
    }
    if (data === undefined) {
      return { result: { state: "loading" }, discarded: false };
    }
    switch (data.kind) {
      case "envelope": {
        if (currentScope !== undefined && isStale(data.envelope.scope, currentScope)) {
          // A settled answer about the context this surface has left is never returned: applying its
          // memberships to the context now in force would attribute one ministry's choices to another.
          return { result: { state: "loading" }, discarded: true };
        }
        return { result: { state: "ready", envelope: data.envelope }, discarded: false };
      }
      case "denied":
        return { result: { state: "denied", reason: data.reason }, discarded: false };
      case "unavailable":
        return { result: { state: "unavailable", source: data.source }, discarded: false };
      case "unknown":
        // A read has no effect to check, so the arm carries no operation identity.
        return { result: { state: "unknown" }, discarded: false };
    }
  }, [currentScope, data, enabled]);

  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  const result = mapped.result;
  switch (result.state) {
    case "ready":
      return { state: "ready", envelope: result.envelope, retry, discarded: mapped.discarded };
    case "denied":
      return { state: "denied", reason: result.reason, retry, discarded: mapped.discarded };
    case "unavailable":
      return { state: "unavailable", source: result.source, retry, discarded: mapped.discarded };
    case "unknown":
      return { state: "unknown", retry, discarded: mapped.discarded };
    case "loading":
      return { state: "loading", retry, discarded: mapped.discarded };
  }
}
