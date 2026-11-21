"use client";
/** The one browser transport that takes a support query out of the application as a CSV file. */
import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import type { reads } from "@/modules/data-service";
import { isOutcome, isReadResult, type ReadResult } from "@/modules/data-service/outcome";
import type { ReportQuery } from "@/modules/support/report";
const EXPORT_PATH = "/api/export";
export type ExportAnswer = Awaited<ReturnType<typeof reads.export.readExport>>;
export type ExportEnvelope = Extract<ExportAnswer, { readonly kind: "envelope" }>["envelope"];
export interface ExportRequest {
  readonly query: ReportQuery;
  readonly snapshotId: string;
}
function isJsonObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isExportEnvelope(value: unknown): value is ExportEnvelope {
  if (!isJsonObject(value)) {
    return false;
  }
  const data: unknown = value["data"];
  if (!isJsonObject(data)) {
    return false;
  }
  return typeof data["csv"] === "string" && typeof data["filename"] === "string" && typeof data["rowCount"] === "number";
}
function noAnswer(status: number, detail: string): Error {
  return new Error(`The export request to ${EXPORT_PATH} was answered with status ${String(status)} and ${detail}, so no file was produced and the export's result is not known.`);
}
async function readJson(response: Response): Promise<unknown> {
  try {
    const body: unknown = await response.json();
    return body;
  } catch {
    throw noAnswer(response.status, "a body that is not JSON");
  }
}
async function readAnswer(response: Response): Promise<ReadResult<ExportEnvelope>> {
  const body: unknown = await readJson(response);
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
  // A session that expired or could not be established answers 401 with the same denial a refused authority
  // gets at 403, so both statuses are read as the denial they carry.
  if ((response.status === 401 || response.status === 403) && isOutcome(body) && body.outcome === "denied") {
    return { kind: "denied", denied: body };
  }
  if (response.status === 503 && isOutcome(body) && body.outcome === "unavailable") {
    return { kind: "unavailable", unavailable: body };
  }
  // The query the export was asked for is not one this read admits: the field-keyed refusal is the
  // caller's to correct, and no file was produced because none was asked for.
  if (response.status === 422 && isOutcome(body) && body.outcome === "invalid") {
    return { kind: "refused", refused: body };
  }
  throw noAnswer(response.status, "a body that is not one of this read's answers");
}
async function requestExport(request: ExportRequest): Promise<ExportAnswer> {
  let response: Response;
  try {
    response = await fetch(EXPORT_PATH, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, credentials: "same-origin", body: JSON.stringify({ query: request.query, snapshotId: request.snapshotId }) });
  } catch (cause) {
    throw new Error(`The export request to ${EXPORT_PATH} did not reach the application, so no file was produced.`, { cause });
  }
  return readAnswer(response);
}
/** Runs one export and answers with `readExport`'s own union: `envelope` carrying the whole-query CSV text with its snapshot facts, `denied` carrying the closed reason code, or `unavailable`. */
export function useExport(): UseMutationResult<ExportAnswer, Error, ExportRequest> {
  return useMutation<ExportAnswer, Error, ExportRequest>({ mutationFn: requestExport });
}
