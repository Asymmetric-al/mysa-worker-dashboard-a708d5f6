"use client";

/**
 * The one browser transport that takes a support query out of the application as a CSV file.
 *
 * `useExport` runs the named read `readExport` — the "Take support out of the app" job of the service
 * inventory, reached over `POST /api/export` — and answers with that read's own union,
 * `envelope | denied | unavailable`. The envelope's `data.csv` is the file the server's writer produced
 * for the whole query, and `data` also carries the filename, the row count, the snapshot facts, the
 * print model and the snapshot itself, so the caller downloads text it did not assemble and states
 * metadata it did not derive (AAP 0.6.3, 0.7.1, 0.8.8, 0.10.1 family 8).
 *
 * Why nothing is assembled, filtered or re-encoded here. The server's writer owns the quoting, the tab
 * prefix that neutralises a formula-leading cell, the grain, basis, currency, period, coverage and
 * snapshot header rows, and the whole-query row set. A browser pass over that text — a re-quote, a
 * re-order, a `trim`, an added byte-order mark — would either double-prefix a cell or silently change
 * what the file means, and a file limited to the loaded page would answer a different question from the
 * screen it was taken from. So the text crosses this module untouched, and the download itself belongs
 * to the calling component, which creates the object URL and the anchor.
 *
 * Why an export has no attempt identity. An export performs no state change, so it is not a mutation in
 * the inventory's sense: it carries no attempt identity and no expected revision, it needs no operation
 * ledger and no replay recovery, and a repeated request is not a second effect but the same file from
 * the same snapshot. What keeps the output stable is the `snapshotId` the caller passes in — the
 * identity of the report result the worker is reading — so the file answers that result rather than
 * whatever the store happens to hold a moment later. No retry policy is configured, because a mutation
 * is not retried by default and a second request the worker did not ask for is a second effect on a
 * surface with nothing to undo it.
 *
 * Failure means no file. A denial and an outage are answers, and the caller renders them as such; a
 * transport fault, an unreadable body or a status outside the read union is no answer at all, so this
 * module rejects with a plain `Error` naming `/api/export` and never hands back a partial file, an empty
 * file, an invented envelope or a zero row count (Rule 1 clause 3).
 *
 * Layering: one TanStack Query mutation plus type-only imports of the service's `reads` inventory and
 * the report's query contract. This module stores no record, computes no amount, formats no currency and
 * imports no CSV writer. The report function is deliberately not imported: the report was computed once
 * on the server, and an export that recomputed it in the browser would be a second authority for the
 * same six artefacts.
 */

import { useMutation, type UseMutationResult } from "@tanstack/react-query";

import type { reads } from "@/modules/data-service";
import { isOutcome, isReadResult, type ReadResult } from "@/modules/data-service/outcome";
import type { ReportQuery } from "@/modules/support/report";

/**
 * The one path this module posts to: relative, so the request stays same-origin and the `httpOnly`,
 * `sameSite=lax` development-session cookie that carries scope and admission travels with it. The scope
 * is never restated in the body, because the service derives it from that session and a body-supplied
 * scope would be a second, forgeable statement of the same authority.
 */
const EXPORT_PATH = "/api/export";

/**
 * What `readExport` answers, derived from the read itself:
 * `ReadResult<ReadEnvelope<SupportExportData, FinancialCoverage>>`.
 *
 * Derived rather than restated, so a change to the read's data shape — a renamed member, a withdrawn
 * one, a different coverage — stops this file compiling instead of letting a second copy of the export
 * vocabulary drift from the one the service produced. The path is the inventory's own: a read is
 * reached through the job it serves, and "Take support out of the app" is `reads.export`.
 */
export type ExportAnswer = Awaited<ReturnType<typeof reads.export.readExport>>;

/**
 * The envelope arm of {@link ExportAnswer}: the CSV text with the facts that state what it is.
 */
export type ExportEnvelope = Extract<ExportAnswer, { readonly kind: "envelope" }>["envelope"];

/**
 * One export request: the query on screen and the identity of the result on screen.
 *
 * The query is the one the report read built and the caller already holds — never re-typed, never
 * re-derived and never widened here, because a query reconstructed in the browser is a second question
 * that could disagree with the page it was taken from. `snapshotId` names that page's snapshot, so the
 * service can refuse a file that would answer something else.
 */
export interface ExportRequest {
  /** The report query exactly as it stands on screen, including its filters, sort and period. */
  readonly query: ReportQuery;
  /** The identity the on-screen report result carries; the file must answer that result. */
  readonly snapshotId: string;
}

/** A decoded JSON object, as opposed to a scalar, an array or `null`. */
function isJsonObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a decoded body carries the export envelope: the CSV text the caller downloads, the filename
 * the application suggested for it, and the count of rows the file holds.
 *
 * Only the members this module promises its caller are checked. The remaining members travel with the
 * same body and are read by the consuming component, so validating them here would be a second copy of
 * the service's schema in a place that cannot keep it current.
 */
function isExportEnvelope(value: unknown): value is ExportEnvelope {
  if (!isJsonObject(value)) {
    return false;
  }
  const data: unknown = value["data"];
  if (!isJsonObject(data)) {
    return false;
  }
  return (
    typeof data["csv"] === "string" &&
    typeof data["filename"] === "string" &&
    typeof data["rowCount"] === "number"
  );
}

/**
 * The one fault this module raises: it names the path and states plainly that no file was produced, so
 * a caller rendering the failure cannot mistake an absent answer for an empty export.
 */
function noAnswer(status: number, detail: string): Error {
  return new Error(
    `The export request to ${EXPORT_PATH} was answered with status ${String(status)} and ${detail}, so no file was produced and the export's result is not known.`,
  );
}

/** Decodes a response body, turning an unreadable body into {@link noAnswer} rather than a crash. */
async function readJson(response: Response): Promise<unknown> {
  try {
    const body: unknown = await response.json();
    return body;
  } catch {
    throw noAnswer(response.status, "a body that is not JSON");
  }
}

/**
 * Reads one `/api/export` response as the read union, or throws when the body is no answer at all.
 *
 * Two wire shapes are the same answer and both are read here. The service's `toResponse` flattens a
 * read result onto the status, because the status already discriminates it — 200 carries the envelope,
 * 403 the denial, 503 the outage — so a client holding a response reads the status first. A handler
 * that answers with the in-process union unchanged carries the discriminant in the body instead.
 * Neither shape is re-implemented: `isReadResult` and `isOutcome` are the service's own predicates, and
 * a denial or an outage is passed through as the body the service built rather than rebuilt here.
 */
async function readAnswer(response: Response): Promise<ReadResult<ExportEnvelope>> {
  const body: unknown = await readJson(response);

  if (isReadResult(body)) {
    if (body.kind === "denied") {
      return { kind: "denied", denied: body.denied };
    }
    if (body.kind === "unavailable") {
      return { kind: "unavailable", unavailable: body.unavailable };
    }
    if (isExportEnvelope(body.envelope)) {
      return { kind: "envelope", envelope: body.envelope };
    }
    throw noAnswer(response.status, "a body that is not the export envelope");
  }

  if (response.status === 200) {
    if (isExportEnvelope(body)) {
      return { kind: "envelope", envelope: body };
    }
    throw noAnswer(response.status, "a body that is not the export envelope");
  }
  if (response.status === 403 && isOutcome(body) && body.outcome === "denied") {
    return { kind: "denied", denied: body };
  }
  if (response.status === 503 && isOutcome(body) && body.outcome === "unavailable") {
    return { kind: "unavailable", unavailable: body };
  }
  throw noAnswer(response.status, "a body that is not one of this read's answers");
}

/**
 * Sends one export request and answers with the read's union.
 *
 * The body carries exactly the two facts the caller owns, and the request states the JSON media type
 * both ways so a body is never guessed at. A request that never reached the application rejects with
 * its cause attached: that is a transport fault, not a result, and it must not be presented as one.
 */
async function requestExport(request: ExportRequest): Promise<ExportAnswer> {
  let response: Response;
  try {
    response = await fetch(EXPORT_PATH, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ query: request.query, snapshotId: request.snapshotId }),
    });
  } catch (cause) {
    throw new Error(
      `The export request to ${EXPORT_PATH} did not reach the application, so no file was produced.`,
      { cause },
    );
  }
  return readAnswer(response);
}

/**
 * Runs one export and answers with `readExport`'s own union: `envelope` carrying the whole-query CSV
 * text with its snapshot facts, `denied` carrying the closed reason code, or `unavailable` carrying the
 * source identity and its retry guidance.
 *
 * Dispatched from the export action and never from render, because the file is something a person asks
 * for: opening or re-rendering a report issues no `/api/export` request. Nothing is invalidated on
 * success, because an export changes nothing and no cached answer became stale; and nothing is retried,
 * because the caller decides whether to ask again.
 */
export function useExport(): UseMutationResult<ExportAnswer, Error, ExportRequest> {
  return useMutation<ExportAnswer, Error, ExportRequest>({ mutationFn: requestExport });
}
