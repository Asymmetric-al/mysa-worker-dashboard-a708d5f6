import type { NextRequest } from "next/server";
import { z } from "zod";
import { routeMethods } from "@/app/api/methods";
import { mutationInputSchema, mutations, reads } from "@/modules/data-service";
import { pagingParamsOf, pagingQuerySchema } from "../../paging";
import { claimedWriteRoute, claimedWrites } from "../../handler";
import { READ_ATTEMPT, readGrammar, readRoute } from "../../read";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MESSAGES = {
  operationRequired: "State which change this request makes as payload.operation: saveTarget, editTarget, pauseTarget or endTarget.",
  bodyNotJson: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
  pageInvalid: "Read the page as a whole number of one or more, so the targets arrive on the page you asked for rather than one this read chose.",
  pageSizeInvalid: "Read the page size as a whole number of one or more, so the targets arrive in pages of the size you asked for; the service applies its own cap.",
} as const;
type WirePayload<Payload, Operation extends string> = Payload & { readonly operation: Operation };
const saveTargetBodySchema = mutationInputSchema(z.custom<WirePayload<Parameters<typeof mutations.coaching.saveTarget>[0]["payload"], "saveTarget">>());
const editTargetBodySchema = mutationInputSchema(z.custom<WirePayload<Parameters<typeof mutations.coaching.editTarget>[0]["payload"], "editTarget">>());
const pauseTargetBodySchema = mutationInputSchema(z.custom<WirePayload<Parameters<typeof mutations.coaching.pauseTarget>[0]["payload"], "pauseTarget">>());
const endTargetBodySchema = mutationInputSchema(z.custom<WirePayload<Parameters<typeof mutations.coaching.endTarget>[0]["payload"], "endTarget">>());
const TARGET_OPERATIONS = ["saveTarget", "editTarget", "pauseTarget", "endTarget"] as const;
const targetListQuerySchema = pagingQuerySchema({ page: MESSAGES.pageInvalid, pageSize: MESSAGES.pageSizeInvalid });
const discriminantSchema = z.object({ payload: z.object({ operation: z.enum(TARGET_OPERATIONS, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.bodyNotJson });
const readTargets = readRoute(readGrammar(targetListQuerySchema, pagingParamsOf), (query) => reads.coaching.readTargets(query), READ_ATTEMPT);
const TARGET_WRITES = claimedWrites<(typeof TARGET_OPERATIONS)[number]>("operation", {
  saveTarget: [saveTargetBodySchema, mutations.coaching.saveTarget],
  editTarget: [editTargetBodySchema, mutations.coaching.editTarget],
  pauseTarget: [pauseTargetBodySchema, mutations.coaching.pauseTarget],
  endTarget: [endTargetBodySchema, mutations.coaching.endTarget],
});
const changeTarget = (request: NextRequest): Promise<Response> => claimedWriteRoute(request, discriminantSchema, (claim) => claim.payload.operation, TARGET_WRITES);
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ GET: readTargets, POST: changeTarget });
