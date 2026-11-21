/**
 * `GET /api/import/[operationId]` — the recovery read of the contact-import journey: the reviewable proposal a
 * worker is working through, or the recoverable receipt of an import that already ran, always looked up by the
 * opaque operation identity and never by uploading the file again.
 *
 * In scope from four sources: the API table's `GET /api/import/[operationId]` row for proposal, decisions,
 * acceptance, cancellation and receipt lookup (AAP 0.6.3); the rule that every handler under `src/app/api` is a
 * thin adapter with no business logic and no self-fetch (AAP 0.9.1, 0.11.1); the "Bring in a contact list" job's
 * reads `readImportProposal` and `readImportReceipt` (AAP 0.7.1); and the release's promise of "a stable
 * operation identity and a recoverable receipt" (AAP 0.6.2, 0.10.1), which is what lets a lost acknowledgement
 * be resolved by re-reading the same identity instead of repeating the effect (AAP 0.12.5, criteria 4 and 11).
 *
 * One identity, one envelope, one response. The receipt is tried first, because a finished operation is answered
 * by its receipt; the proposal second, because an operation still in flight is answered by the proposal it
 * started. Neither read changes anything: this path applies no row, mints no operation identity, appends no
 * ledger entry, advances no revision, and implies no consent, subscription or delivery. A read of a result is
 * not the acceptance of a row.
 */
import { ZodError } from "zod";
import { isNonEmptyString } from "@/lib/guards";
import { isReadResult, outcomeFromError, reads, toResponse } from "@/modules/data-service";
/** The store behind the service reads session documents through `node:fs`, so this handler never runs on the edge runtime. */
export const runtime = "nodejs";
/** Each request re-resolves the session and the scenario instant, so a receipt is never cached across a persona switch, a scenario switch or a reset. */
export const dynamic = "force-dynamic";
/**
 * The attempt an answer names when the path carried no usable identity, so every answer states the attempt it
 * answers for rather than fabricating one from the request.
 */
const UNIDENTIFIED_OPERATION = "unidentified-operation";
/** The one dynamic segment this route matches: the caller's own opaque operation identity. */
interface ImportOperationParams {
  readonly operationId: string;
}
/**
 * Answers the proposal or the receipt this operation identity names, in the one read envelope, or the read's own
 * `denied` or `unavailable`; `invalid` when the path carried no identity at all.
 */
export async function GET(_request: Request, context: { params: Promise<ImportOperationParams> }): Promise<Response> {
  let operationId: string = UNIDENTIFIED_OPERATION;
  try {
    // Next 16 hands the dynamic segments as a promise, so the identity is awaited before any read sees it.
    const params = await context.params;
    const named: unknown = params.operationId;
    if (!isNonEmptyString(named)) {
      // Presence is the only judgement this file makes about the identity. It is never trimmed into a different
      // value, decoded, parsed, range-checked, pattern-matched, compared or echoed, because an equal-looking
      // identifier establishes neither identity nor authority, and the identity is the operation's own. Next's
      // matching makes this branch unreachable from a URL; it exists so a hand-built request is answered rather
      // than thrown.
      // The refusal is built through the index's one converter, so this file imports nothing below the
      // service's entry point; the issue is keyed at `operationId`, the field this path reads.
      return toResponse(
        outcomeFromError(
          UNIDENTIFIED_OPERATION,
          new ZodError([{ code: "custom", path: ["operationId"], message: "operationId names no import operation: the path carries no usable identity to read a proposal or a receipt by." }]),
        ),
      );
    }
    operationId = named;
    // Awaited in this order and never together: the order carries the meaning. The receipt answers an operation
    // that finished; the proposal answers one still in flight.
    const receipt = await reads.import.readImportReceipt(operationId);
    if (isReadResult(receipt) && receipt.kind === "envelope") {
      return toResponse(receipt);
    }
    const proposal = await reads.import.readImportProposal({ importOperationId: operationId });
    if (isReadResult(proposal) && proposal.kind === "envelope") {
      return toResponse(proposal);
    }
    // Neither read produced an envelope, so the receipt's own refusal is the answer. An identity that was never
    // recorded and one that belongs to another scope are refused identically, and no row count, file name, row
    // number or existence hint travels with the refusal, so this route cannot be probed for what another scope
    // holds. A source that is genuinely down answers `unavailable` from the same read, never an empty proposal.
    return toResponse(receipt);
  } catch (error) {
    // A throw here is an outage or a defect rather than a presentation: the reads answer refusals as results, so
    // the one mapper decides between `unavailable` and `unknown` and names the attempt to re-query.
    return toResponse(outcomeFromError(operationId, error));
  }
}
