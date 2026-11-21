/** `GET /api/coaching/targets` — the worker's own targets and their measured periods — and `POST /api/coaching/targets`, the four named changes a target admits. */
import { z } from "zod";
import { assertNever } from "@/lib/result";
import { mutationInputSchema, mutations, outcomeFromError, reads, toResponse } from "@/modules/data-service";
import { pagingParamsOf, pagingQuerySchema } from "../../paging";
import { dispatch, jsonBodyOf, operationIdentityOf } from "../../handler";
/** The store reads and writes through `node:fs`, so this handler never runs on the edge runtime. */
export const runtime = "nodejs";
/** Both verbs resolve the development session and evaluate the scenario clock once per request. */
export const dynamic = "force-dynamic";
const READ_ATTEMPT_ID = "read";
const MESSAGES = {
  operationRequired: "State which change this request makes as payload.operation: saveTarget, editTarget, pauseTarget or endTarget.",
  bodyNotJson: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
  pageInvalid: "Read the page as a whole number of one or more, so the targets arrive on the page you asked for rather than one this read chose.",
  pageSizeInvalid: "Read the page size as a whole number of one or more, so the targets arrive in pages of the size you asked for; the service applies its own cap.",
} as const;
type SaveTargetPayload = Parameters<typeof mutations.coaching.saveTarget>[0]["payload"];
type EditTargetPayload = Parameters<typeof mutations.coaching.editTarget>[0]["payload"];
type PauseTargetPayload = Parameters<typeof mutations.coaching.pauseTarget>[0]["payload"];
type EndTargetPayload = Parameters<typeof mutations.coaching.endTarget>[0]["payload"];
type WirePayload<Payload, Operation extends string> = Payload & { readonly operation: Operation };
const saveTargetBodySchema = mutationInputSchema(z.custom<WirePayload<SaveTargetPayload, "saveTarget">>());
const editTargetBodySchema = mutationInputSchema(z.custom<WirePayload<EditTargetPayload, "editTarget">>());
const pauseTargetBodySchema = mutationInputSchema(z.custom<WirePayload<PauseTargetPayload, "pauseTarget">>());
const endTargetBodySchema = mutationInputSchema(z.custom<WirePayload<EndTargetPayload, "endTarget">>());
const TARGET_OPERATIONS = ["saveTarget", "editTarget", "pauseTarget", "endTarget"] as const;
type TargetListQuery = Parameters<typeof reads.coaching.readTargets>[0];
const targetListQuerySchema = pagingQuerySchema({ page: MESSAGES.pageInvalid, pageSize: MESSAGES.pageSizeInvalid });
const discriminantSchema = z.object({ payload: z.object({ operation: z.enum(TARGET_OPERATIONS, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.bodyNotJson });
/** One page of the worker's targets, each with its versions and its measured periods. */
export async function GET(request: Request): Promise<Response> {
  try {
    const grammar = targetListQuerySchema.safeParse(pagingParamsOf(new URL(request.url).searchParams));
    if (!grammar.success) {
      // A paging value this read does not admit is a request-level refusal answered with the same per-field `invalid` outcome the four mutations on this path answer, because no source behind the read failed and the caller has to be told which parameter to correct.
      return toResponse(outcomeFromError(READ_ATTEMPT_ID, grammar.error));
    }
    return toResponse(await reads.coaching.readTargets(grammar.data satisfies TargetListQuery));
  } catch (error) {
    // One mapper knows the difference between a store outage, a session that cannot be established and a lost acknowledgement, so a thrown fault is answered rather than escaping the boundary.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}
/** One named target mutation, selected by `payload.operation`. */
export async function POST(request: Request): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const operationId = operationIdentityOf(raw);
  const claimed = discriminantSchema.safeParse(raw);
  if (!claimed.success) return toResponse(outcomeFromError(operationId, claimed.error));
  switch (claimed.data.payload.operation) {
    case "saveTarget":
      return dispatch(saveTargetBodySchema, raw, operationId, "operation", mutations.coaching.saveTarget);
    case "editTarget":
      return dispatch(editTargetBodySchema, raw, operationId, "operation", mutations.coaching.editTarget);
    case "pauseTarget":
      return dispatch(pauseTargetBodySchema, raw, operationId, "operation", mutations.coaching.pauseTarget);
    case "endTarget":
      return dispatch(endTargetBodySchema, raw, operationId, "operation", mutations.coaching.endTarget);
    default:
      // Unreachable: the four names above are the closed set the discriminant schema admits, so a fifth mutation fails to compile at this call instead of reaching the runtime.
      return assertNever(claimed.data.payload.operation, "Unhandled coaching target mutation");
  }
}
