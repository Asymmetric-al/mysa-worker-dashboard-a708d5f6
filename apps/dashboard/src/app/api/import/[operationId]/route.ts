import { z } from "zod";
import { isNonEmptyString } from "@/lib/guards";
import { isReadResult, outcomeFromError, reads, refusedRead, toResponse } from "@/modules/data-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UNIDENTIFIED_OPERATION = "unidentified-operation";
type ImportOperationParams = { readonly operationId: string };
const PAGING_PARAMETERS = ["page", "pageSize"] as const;
type PagingParameter = (typeof PAGING_PARAMETERS)[number];
const pagingValueSchema = z.coerce.number().int().min(1);
const PAGING_MESSAGES: Readonly<Record<PagingParameter, string>> = { page: "page must be a positive whole number: the page to read, counting from 1.", pageSize: "pageSize must be a positive whole number: how many rows of the page to read." };
type PagingWindow = { readonly page?: number; readonly pageSize?: number };
type PagingAdmission = { readonly ok: true; readonly window: PagingWindow } | { readonly ok: false; readonly issues: readonly z.ZodIssue[] };
const isPagingParameter = (name: string): name is PagingParameter => PAGING_PARAMETERS.some((parameter) => parameter === name);
function admitPaging(search: URLSearchParams): PagingAdmission {
  const issues: z.ZodIssue[] = [];
  const stated: { page?: number; pageSize?: number } = {};
  const judged = new Set<string>();
  for (const name of search.keys()) {
    if (judged.has(name)) continue;
    judged.add(name);
    if (!isPagingParameter(name)) {
      issues.push({ code: "custom", path: [name], message: `This read states the page and the page size of the rows it returns, and nothing else, so it does not read "${name}".` });
      continue;
    }
    const value = pagingValueSchema.safeParse(search.get(name));
    if (value.success) {
      stated[name] = value.data;
    } else {
      issues.push({ code: "custom", path: [name], message: PAGING_MESSAGES[name] });
    }
  }
  return issues.length === 0 ? { ok: true, window: stated } : { ok: false, issues };
}
/** Answers the proposal or the receipt this operation identity names, in the one read envelope, or the read's own `denied`, `unavailable` or `refused` — the refusal stating the identity or the window this read does not accept. */
export async function GET(request: Request, context: { params: Promise<ImportOperationParams> }): Promise<Response> {
  let operationId: string = UNIDENTIFIED_OPERATION;
  try {
    const named: unknown = (await context.params).operationId;
    if (!isNonEmptyString(named)) return toResponse(refusedRead(UNIDENTIFIED_OPERATION, { operationId: ["operationId names no import operation: the path carries no usable identity to read a proposal or a receipt by."] }));
    operationId = named;
    const paging = admitPaging(new URL(request.url).searchParams);
    if (!paging.ok) return toResponse(refusedRead(operationId, new z.ZodError([...paging.issues])));
    const receipt = await reads.import.readImportReceipt(operationId, paging.window);
    if (isReadResult(receipt) && receipt.kind === "envelope") return toResponse(receipt);
    const proposal = await reads.import.readImportProposal({ importOperationId: operationId, ...paging.window });
    if (isReadResult(proposal) && proposal.kind === "envelope") return toResponse(proposal);
    return toResponse(receipt);
  } catch (error) {
    return toResponse(outcomeFromError(operationId, error));
  }
}
