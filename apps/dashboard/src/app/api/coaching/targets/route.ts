import type { NextRequest } from "next/server";
import { z } from "zod";
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
type TargetOperation = (typeof TARGET_OPERATIONS)[number];
const targetListQuerySchema = pagingQuerySchema({ page: MESSAGES.pageInvalid, pageSize: MESSAGES.pageSizeInvalid });
const discriminantSchema = z.object({ payload: z.object({ operation: z.enum(TARGET_OPERATIONS, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.bodyNotJson });
/** One page of the worker's targets, each with its versions and its measured periods. */
export const GET = readRoute(readGrammar(targetListQuerySchema, pagingParamsOf), (query) => reads.coaching.readTargets(query), READ_ATTEMPT);
const TARGET_WRITES = claimedWrites<TargetOperation>("operation", {
  saveTarget: [saveTargetBodySchema, mutations.coaching.saveTarget],
  editTarget: [editTargetBodySchema, mutations.coaching.editTarget],
  pauseTarget: [pauseTargetBodySchema, mutations.coaching.pauseTarget],
  endTarget: [endTargetBodySchema, mutations.coaching.endTarget],
});
/** One named target mutation, selected by `payload.operation`. */
export const POST = (request: NextRequest): Promise<Response> => claimedWriteRoute(request, discriminantSchema, (claim) => claim.payload.operation, TARGET_WRITES);
