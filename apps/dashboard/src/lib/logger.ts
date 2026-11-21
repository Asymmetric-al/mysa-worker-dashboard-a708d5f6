/**
 * Development-boundary diagnostics: the repository's only diagnostics surface.
 */
import { isDevelopment } from "@/lib/guards";
/** The diagnostic subset of the read envelope's scope. */
export type LogScope = {
  readonly organizationId: string;
  readonly ministryId: string;
  readonly supportSubjectId: string;
  readonly principalId: string;
};
/** One mutation attempt as a diagnostic line: the operation id that names the attempt, the scope it ran in, the outcome's discriminant name and the elapsed milliseconds the caller measured. */
export type MutationLogEntry = {
  readonly operationId: string;
  readonly scope: LogScope;
  readonly outcome: string;
  readonly elapsedMs: number;
};
/** One read whose source could not answer: the job that was attempted and the opaque identity of the source, which is all a reader needs to find the owner. */
export type SourceUnavailableLogEntry = {
  readonly job: string;
  readonly source: { readonly system: string; readonly reference: string };
};
const MAX_OPERATION_ID_LENGTH = 64;

const MAX_SCOPE_ID_LENGTH = 128;

const MAX_OUTCOME_LENGTH = 40;

const MAX_JOB_LENGTH = 64;

const MAX_SYSTEM_LENGTH = 32;

const MAX_REFERENCE_LENGTH = 128;

function isBoundedIdentifier(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}
function isBoundedDuration(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function isScope(value: LogScope): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    isBoundedIdentifier(value.organizationId, MAX_SCOPE_ID_LENGTH) &&
    isBoundedIdentifier(value.ministryId, MAX_SCOPE_ID_LENGTH) &&
    isBoundedIdentifier(value.supportSubjectId, MAX_SCOPE_ID_LENGTH) &&
    isBoundedIdentifier(value.principalId, MAX_SCOPE_ID_LENGTH)
  );
}
function isMutationEntry(entry: MutationLogEntry): boolean {
  return (
    typeof entry === "object" &&
    entry !== null &&
    isBoundedIdentifier(entry.operationId, MAX_OPERATION_ID_LENGTH) &&
    isScope(entry.scope) &&
    isBoundedIdentifier(entry.outcome, MAX_OUTCOME_LENGTH) &&
    isBoundedDuration(entry.elapsedMs)
  );
}
function isSourceUnavailableEntry(entry: SourceUnavailableLogEntry): boolean {
  return (
    typeof entry === "object" &&
    entry !== null &&
    isBoundedIdentifier(entry.job, MAX_JOB_LENGTH) &&
    typeof entry.source === "object" &&
    entry.source !== null &&
    isBoundedIdentifier(entry.source.system, MAX_SYSTEM_LENGTH) &&
    isBoundedIdentifier(entry.source.reference, MAX_REFERENCE_LENGTH)
  );
}
function writeDiagnosticLine(record: Record<string, unknown>): void {
  if (!isDevelopment()) {
    return;
  }
  if (typeof process === "undefined" || typeof process.stdout?.write !== "function") {
    return;
  }
  process.stdout.write(`${JSON.stringify(record)}\n`);
}
/** The two-event diagnostics writer. */
export const logger = {
  mutation: (entry: MutationLogEntry): void => {
    try {
      if (!isMutationEntry(entry)) {
        return;
      }
      // Each field is copied out of the entry in a fixed order, so a caller that
      // passes extra properties cannot widen the line and its key order is stable.
      writeDiagnosticLine({
        kind: "mutation",
        operationId: entry.operationId,
        scope: {
          organizationId: entry.scope.organizationId,
          ministryId: entry.scope.ministryId,
          supportSubjectId: entry.scope.supportSubjectId,
          principalId: entry.scope.principalId,
        },
        outcome: entry.outcome,
        elapsedMs: entry.elapsedMs,
      });
    } catch {
      // Diagnostics must not break the operation they describe.
    }
  },
  sourceUnavailable: (entry: SourceUnavailableLogEntry): void => {
    try {
      if (!isSourceUnavailableEntry(entry)) {
        return;
      }
      writeDiagnosticLine({
        kind: "source-unavailable",
        job: entry.job,
        source: {
          system: entry.source.system,
          reference: entry.source.reference,
        },
      });
    } catch {
      // Diagnostics must not break the read they describe.
    }
  },
};
