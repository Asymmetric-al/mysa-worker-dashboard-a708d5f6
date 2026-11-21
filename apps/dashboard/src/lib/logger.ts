/**
 * Development-boundary diagnostics: the repository's only diagnostics surface.
 *
 * Exactly two events are recorded. One `mutation` line is written for each mutation
 * attempt the runner answers, carrying the operation id, the scope identifiers, the
 * outcome name the caller received and the elapsed time measured where the work
 * happened. A multi-pass module's `probe` pass is marked as one, so the `unchanged`
 * that only sends its module on to the change writes no line, while every other
 * outcome a probe answers is the caller's answer and does. One line per `unavailable`
 * read carries the job name and the identity of the source that could not answer.
 *
 * Three classes of request write no attempt line. One is a request a transport's own
 * body schema refuses before dispatch — a `POST /api/partners` whose payload its
 * schema rejects, for example — because the service never evaluated it and no attempt
 * was answered. Another is an answer a mutation module decides itself before or
 * beside the passes, such as a development control that finds the requested state
 * already in force: the module answered and the runner answered nothing, so a line
 * for it would report an attempt that produced no answer of its own. The third is an
 * attempt whose request states no readable scope, because both entry shapes are closed
 * and a line missing one of the four identifiers would describe the attempt in the
 * wrong context.
 *
 * What is never written is the point of the module. Note bodies, check-in text,
 * message bodies, email addresses, gift amounts, exported rows and the
 * development session credential — the value of the httpOnly `dashboard_session`
 * cookie — have no field to travel in: both entry shapes are closed and hold only
 * primitive identifiers, a bounded outcome name and a duration. A source is named
 * by its opaque reference, never by the credential that opened it. Redaction
 * therefore holds by construction rather than by inspection, and it is what keeps
 * identities, the selected context, private information and financial facts
 * distinct in diagnostics. `redaction.ts` remains the separate mechanism for
 * error surfaces.
 *
 * A line records an outcome name and nothing more. No consent, publication or
 * communication outcome is ever inferred from a log line, a simulated external
 * effect is never presented as a real one, and a completion is never treated as
 * proof of contact or payment.
 *
 * There is no remote transport, no telemetry pipeline, no log level, no
 * sampling and no sink: one line to `process.stdout` in a development build, and
 * a documented no-op everywhere else, so a production build carries no
 * diagnostics transport at all.
 *
 * This module is server-only by construction: it writes to `process.stdout`, and
 * the guard below makes it a harmless no-op wherever `process` or its stream is
 * absent, so a browser bundle that ever pulls it in cannot fault. It does not
 * declare the `server-only` module because that package is not in the dependency
 * inventory; its callers are the server-side data service and its route
 * handlers.
 */
import { isDevelopment } from "@/lib/guards";

/**
 * The diagnostic subset of the read envelope's scope.
 *
 * These four identifiers are what a diagnostic line names, and nothing more. Their meaning is the
 * distinction the product's identity rule turns on: `principalId` is the authenticated principal
 * whenever the attempt reached the session — the persona that acted, so a refusal is attributable to
 * it — while `organizationId`, `ministryId` and `supportSubjectId` are the context the attempt claimed
 * and was evaluated against. A claim is not authority, so the two are never collapsed into one
 * identifier. The envelope's scope contract — its meaning, its derivation and the fact that an
 * equal-looking identifier never establishes identity or authority — is owned by
 * `modules/data-service/envelope.ts`; this type is a projection for diagnostics and must never grow
 * into a second declaration of that contract.
 */
export type LogScope = {
  readonly organizationId: string;
  readonly ministryId: string;
  readonly supportSubjectId: string;
  readonly principalId: string;
};

/**
 * One mutation attempt as a diagnostic line: the operation id that names the
 * attempt, the scope it ran in, the outcome's discriminant name and the elapsed
 * milliseconds the caller measured. No request payload, result value or record
 * field has a place here.
 */
export type MutationLogEntry = {
  readonly operationId: string;
  readonly scope: LogScope;
  /** The outcome's discriminant name, passed by the caller. */
  readonly outcome: string;
  readonly elapsedMs: number;
};

/**
 * One read whose source could not answer: the job that was attempted and the
 * opaque identity of the source, which is all a reader needs to find the owner.
 * Amounts, rows and query values have no place here.
 */
export type SourceUnavailableLogEntry = {
  readonly job: string;
  readonly source: { readonly system: string; readonly reference: string };
};

/**
 * Longest accepted operation id. A canonical UUID is 36 characters, so the bound
 * leaves headroom for another id format while leaving no room for prose.
 */
const MAX_OPERATION_ID_LENGTH = 64;

/** Longest accepted scope identifier; long enough for an opaque source id. */
const MAX_SCOPE_ID_LENGTH = 128;

/** Longest accepted outcome name, comfortably above the eight outcome names. */
const MAX_OUTCOME_LENGTH = 40;

/** Longest accepted job name; a service read's name is far inside this. */
const MAX_JOB_LENGTH = 64;

/** Longest accepted source system name. */
const MAX_SYSTEM_LENGTH = 32;

/** Longest accepted opaque source reference. */
const MAX_REFERENCE_LENGTH = 128;

/**
 * Reports whether a value is a bounded, non-empty string.
 *
 * An empty string is not an identifier, so it is refused rather than written: a
 * caller that supplies one has a defect the line would otherwise hide. The bound
 * is what stops a payload from masquerading as an identifier, and it counts code
 * units, which is at least as strict as counting code points.
 */
function isBoundedIdentifier(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

/**
 * Reports whether a value is a usable elapsed duration.
 *
 * The caller measures elapsed time where the work happens, so this module reads
 * no clock. Non-finite values are refused because they would serialise as `null`
 * and turn a duration into a state the reader cannot tell from "unknown".
 */
function isBoundedDuration(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Reports whether all four scope identifiers are present and bounded. */
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

/**
 * Reports whether an entry conforms to the mutation shape completely enough to
 * be written. Checked field by field because the entry may arrive from
 * JavaScript without the compiler's help.
 */
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

/** Reports whether an entry conforms to the unavailable-source shape. */
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

/**
 * Writes one diagnostic line in a development build and nothing at all in a
 * production build or where `process.stdout` cannot be written.
 *
 * This is the module's single write path, so a line's format cannot drift: one
 * line of JSON, no prefix, no level, no second stream and no buffering.
 */
function writeDiagnosticLine(record: Record<string, unknown>): void {
  if (!isDevelopment()) {
    return;
  }
  if (typeof process === "undefined" || typeof process.stdout?.write !== "function") {
    return;
  }
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

/**
 * The two-event diagnostics writer.
 *
 * These are the module's only two methods: there is no level to configure, no
 * sink to replace, no sampling to tune and no transport to initialise. Neither
 * method throws, so a diagnostics fault can never turn an accepted mutation into
 * an error, and an entry that fails a bound is dropped rather than truncated —
 * a truncated identifier could still emit a fragment of private text.
 */
export const logger = {
  /**
   * Records one mutation attempt: its operation id, its scope, the outcome's
   * discriminant name and the caller-measured elapsed milliseconds.
   */
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

  /**
   * Records one read whose source was unavailable: the job and the source's
   * opaque identity, so a reader can find the owner without any of the values
   * the read was unable to return.
   */
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
