"use client";
import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import { isRecord } from "@/lib/guards";
import { fetchRead } from "@/lib/read-transport";
import type { reads } from "@/modules/data-service";
import type { ReportQuery } from "@/modules/support/report";
export type ExportAnswer = Awaited<ReturnType<typeof reads.export.readExport>>;
export type ExportEnvelope = Extract<ExportAnswer, { readonly kind: "envelope" }>["envelope"];
export type ExportRequest = { readonly query: ReportQuery; readonly snapshotId: string };
const isExportData = (value: unknown): boolean => isRecord(value) && typeof value.csv === "string" && typeof value.filename === "string" && typeof value.rowCount === "number";
const requestExport = async (request: ExportRequest): Promise<ExportAnswer> => fetchRead<ExportEnvelope["data"], ExportEnvelope["coverage"]>({ url: "/api/export", body: { query: request.query, snapshotId: request.snapshotId }, admits: isExportData });
/** Runs one export and answers with `readExport`'s own union: `envelope` carrying the whole-query CSV text with its snapshot facts, `denied` carrying the closed reason code, or `unavailable`. */
export const useExport = (): UseMutationResult<ExportAnswer, Error, ExportRequest> => useMutation<ExportAnswer, Error, ExportRequest>({ mutationFn: requestExport });
