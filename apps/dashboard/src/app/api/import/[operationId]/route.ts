/**
 * `GET /api/import/[operationId]` — the recovery read of the contact-import journey: the reviewable proposal a worker is working through, or the recoverable receipt of an import that already ran, looked up by the opaque operation identity and never by uploading the file again. One identity, one envelope, one response; the receipt is tried first because a finished operation answers by its receipt and the proposal second because an operation still in flight answers by the proposal it started. Both reads are given the window the request stated — the page and the page size, each a positive whole number — so neither a default nor a ceiling is restated here. Neither read applies a row, mints an identity, appends a ledger entry or implies a consent, a subscription or a delivery.
 */
import { z } from "zod";
import { isNonEmptyString } from "@/lib/guards";
import { isReadResult, outcomeFromError, reads, refusedRead, toResponse } from "@/modules/data-service";
/** The store behind the service reads session documents through `node:fs`, so this handler never runs on the edge runtime. */
export const runtime = "nodejs";
/** Each request re-resolves the session and the scenario instant, so a receipt is never cached across a persona switch, a scenario switch or a reset. */
export const dynamic = "force-dynamic";
/** The attempt an answer names when the path carried no usable identity, so every answer states the attempt it answers for rather than fabricating one from the request. */
const UNIDENTIFIED_OPERATION = "unidentified-operation";
/** The one dynamic segment this route matches: the caller's own opaque operation identity. */
interface ImportOperationParams {
  readonly operationId: string;
}
/** The only two query parameters this route reads: the window of rows a caller is showing. */
const PAGING_PARAMETERS = ["page", "pageSize"] as const;

type PagingParameter = (typeof PAGING_PARAMETERS)[number];

/** One paging parameter as a caller may state it: a whole number counted from one, and nothing else. */
const pagingValueSchema = z.coerce.number().int().min(1);

const PAGING_MESSAGES: Readonly<Record<PagingParameter, string>> = { page: "page must be a positive whole number: the page to read, counting from 1.", pageSize: "pageSize must be a positive whole number: how many rows of the page to read." };
/**
 * The window a request stated. A member the request left out stays absent, so the read behind this route
 * applies its own default and its own ceiling rather than receiving one restated here.
 */
interface PagingWindow {
  readonly page?: number;
  readonly pageSize?: number;
}
type PagingAdmission = { readonly ok: true; readonly window: PagingWindow } | { readonly ok: false; readonly issues: readonly z.ZodIssue[] };

function isPagingParameter(name: string): name is PagingParameter {
  return PAGING_PARAMETERS.some((parameter) => parameter === name);
}
/**
 * Admits the query string: the page and the page size, each a positive whole number, and nothing else.
 *
 * Every parameter a request states is judged once and reported at its own path, so a caller correcting a bad
 * window sees which parameter was refused and what it must be, and an undeclared parameter is named rather
 * than ignored. A parameter stated twice is judged on the first value, which is the one a read would receive.
 */
function admitPaging(search: URLSearchParams): PagingAdmission {
  const issues: z.ZodIssue[] = [];
  const stated: { page?: number; pageSize?: number } = {};
  const judged = new Set<string>();
  for (const name of search.keys()) {
    if (judged.has(name)) {
      continue;
    }
    judged.add(name);
    if (!isPagingParameter(name)) {
      issues.push({ code: "custom", path: [name], message: `This read states the page and the page size of the rows it returns, and nothing else, so it does not read "${name}".` });
      continue;
    }
    const value = pagingValueSchema.safeParse(search.get(name));
    if (!value.success) {
      issues.push({ code: "custom", path: [name], message: PAGING_MESSAGES[name] });
      continue;
    }
    stated[name] = value.data;
  }
  return issues.length === 0 ? { ok: true, window: stated } : { ok: false, issues };
}
/** Answers the proposal or the receipt this operation identity names, in the one read envelope, or the read's own `denied`, `unavailable` or `refused` — the refusal stating the identity or the window this read does not accept. */
export async function GET(request: Request, context: { params: Promise<ImportOperationParams> }): Promise<Response> {
  let operationId: string = UNIDENTIFIED_OPERATION;
  try {
    // Next 16 hands the dynamic segments as a promise, so the identity is awaited before any read sees it.
    const params = await context.params;
    const named: unknown = params.operationId;
    if (!isNonEmptyString(named)) {
      // Presence is the only judgement this file makes about the identity. It is never trimmed into a different value, decoded, parsed, range-checked, pattern-matched, compared or echoed, because an equal-looking
      // identifier establishes neither identity nor authority, and the identity is the operation's own. Next's matching makes this branch unreachable from a URL; it exists so a hand-built request is answered rather than thrown.
      // The refusal is built through the index's one converter, so this file imports nothing below the service's entry point; the issue is keyed at `operationId`, the field this path reads.
      return toResponse(refusedRead(UNIDENTIFIED_OPERATION, { operationId: ["operationId names no import operation: the path carries no usable identity to read a proposal or a receipt by."] }));
    }
    operationId = named;
    // The window is admitted before either read runs, so a request that states a page badly is answered with the read's own refusal at the parameter it named, rather than as a proposal with different rows than it asked for.
    const paging = admitPaging(new URL(request.url).searchParams);
    if (!paging.ok) {
      return toResponse(refusedRead(operationId, new z.ZodError([...paging.issues])));
    }
    // Awaited in this order and never together: the order carries the meaning. The receipt answers an operation that finished; the proposal answers one still in flight.
    const receipt = await reads.import.readImportReceipt(operationId, paging.window);
    if (isReadResult(receipt) && receipt.kind === "envelope") {
      return toResponse(receipt);
    }
    const proposal = await reads.import.readImportProposal({ importOperationId: operationId, ...paging.window });
    if (isReadResult(proposal) && proposal.kind === "envelope") {
      return toResponse(proposal);
    }
    // Neither read produced an envelope, so the receipt's own refusal is the answer. An identity that was never recorded and one that belongs to another scope are refused identically, and no row count, file name, row
    // number or existence hint travels with the refusal, so this route cannot be probed for what another scope holds. A source that is genuinely down answers `unavailable` from the same read, never an empty proposal.
    return toResponse(receipt);
  } catch (error) {
    // A throw here is an outage or a defect rather than a presentation: the reads answer refusals as results, so the one mapper decides between `unavailable` and `unknown` and names the attempt to re-query.
    return toResponse(outcomeFromError(operationId, error));
  }
}
