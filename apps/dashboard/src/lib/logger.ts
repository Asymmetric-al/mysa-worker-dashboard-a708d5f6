/** Development-boundary diagnostics: the repository's only diagnostics surface. */ import { isDevelopment } from "@/lib/guards";
export type LogScope = { readonly organizationId: string; readonly ministryId: string; readonly supportSubjectId: string; readonly principalId: string };
/** One mutation attempt as a diagnostic line: the operation id that names the attempt, the scope it ran in, the outcome's discriminant name and the elapsed milliseconds the caller measured. */
export type MutationLogEntry = { readonly operationId: string; readonly scope: LogScope; readonly outcome: string; readonly elapsedMs: number };
/** One read whose source could not answer: the job that was attempted and the opaque identity of the source, which is all a reader needs to find the owner. */ export type SourceUnavailableLogEntry = { readonly job: string; readonly source: { readonly system: string; readonly reference: string } };
const MAX_OPERATION_ID_LENGTH = 64;
const MAX_SCOPE_ID_LENGTH = 128;
const MAX_OUTCOME_LENGTH = 40;
const MAX_JOB_LENGTH = 64;
const MAX_SYSTEM_LENGTH = 32;
const MAX_REFERENCE_LENGTH = 128;
/** The marker a field carries when the value it held is outside the bound this line states for it: the attempt stays attributable rather than the whole line disappearing. */ const REDACTED = "redacted";
const isBoundedIdentifier = (value: unknown, maxLength: number): value is string => typeof value === "string" && value.length > 0 && value.length <= maxLength;
const isBoundedDuration = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const boundedIdentifier = (value: unknown, maxLength: number): string => (isBoundedIdentifier(value, maxLength) ? value : REDACTED);
const boundedDuration = (value: unknown): number => (isBoundedDuration(value) ? value : 0);
/** The scope a diagnostic states when the attempt established no authority: all four members say so, because a caller that could not name the context must never leave it to be read as one it held. */
export const UNSTATED_SCOPE: LogScope = Object.freeze({ organizationId: "unstated", ministryId: "unstated", supportSubjectId: "unstated", principalId: "unstated" });
const isSourceUnavailableEntry = (entry: SourceUnavailableLogEntry): boolean =>
  typeof entry === "object" && entry !== null && isBoundedIdentifier(entry.job, MAX_JOB_LENGTH) && typeof entry.source === "object" && entry.source !== null && isBoundedIdentifier(entry.source.system, MAX_SYSTEM_LENGTH) && isBoundedIdentifier(entry.source.reference, MAX_REFERENCE_LENGTH);
function writeDiagnosticLine(record: Record<string, unknown>): void {
  if (!isDevelopment()) return;
  if (typeof process === "undefined" || typeof process.stdout?.write !== "function") return;
  process.stdout.write(`${JSON.stringify(record)}\n`);
}
/** The two-event diagnostics writer. */ export const logger = {
  mutation: (entry: MutationLogEntry): void => {
    try {
      // Each field is copied out of the entry in a fixed order, so a caller that passes extra properties cannot widen the line and its key order is stable. A field outside its bound states a fixed marker instead of the line being dropped: a diagnostic never disappears because of what it was asked to describe.
      writeDiagnosticLine({
        kind: "mutation",
        operationId: boundedIdentifier(entry.operationId, MAX_OPERATION_ID_LENGTH),
        scope: {
          organizationId: boundedIdentifier(entry.scope.organizationId, MAX_SCOPE_ID_LENGTH),
          ministryId: boundedIdentifier(entry.scope.ministryId, MAX_SCOPE_ID_LENGTH),
          supportSubjectId: boundedIdentifier(entry.scope.supportSubjectId, MAX_SCOPE_ID_LENGTH),
          principalId: boundedIdentifier(entry.scope.principalId, MAX_SCOPE_ID_LENGTH),
        },
        outcome: boundedIdentifier(entry.outcome, MAX_OUTCOME_LENGTH),
        elapsedMs: boundedDuration(entry.elapsedMs),
      });
    } catch {
      // Diagnostics must not break the operation they describe.
    }
  },
  sourceUnavailable: (entry: SourceUnavailableLogEntry): void => {
    try {
      if (!isSourceUnavailableEntry(entry)) return;
      writeDiagnosticLine({ kind: "source-unavailable", job: entry.job, source: { system: entry.source.system, reference: entry.source.reference } });
    } catch {
      // Diagnostics must not break the read they describe.
    }
  },
};
