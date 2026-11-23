import { z, ZodError } from "zod";
import { assertNever } from "@/lib/result";
import { mutationInputSchema, mutations, outcomeFromError, toResponse, type MutationInput, type MutationOutcome } from "@/modules/data-service";
import { jsonBodyOf, mutate, operationIdentityOf } from "../../../handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const OPERATIONS = ["setTag", "setFavourite"] as const;
type Operation = (typeof OPERATIONS)[number];
const MESSAGES = {
  bodyNotJson: "Send this change as a JSON object carrying operationId, scope, expectedRevision and payload.",
  operationRequired: "State which change this request makes as payload.operation: setTag files a personal label, and setFavourite files the favourite mark.",
  partnerIdNotText: "Send the partner record this change applies to as payload.partnerId, as text naming that one record.",
  tagNotText: "Send the personal tag as text, so the label you typed is the label stored.",
  presentNotBoolean: "Send whether the tag is now present as payload.present, true or false: a tag is applied or removed, never described, because a description of a label is not a change to one.",
  favouriteNotBoolean: "Send the favourite state as payload.favourite, true or false.",
  partnerIdMismatch: "The record this change names is not the record in the address. Open the record the address names and file the change there; nothing was changed, and neither record was read.",
} as const;
type SetTagPayload = Parameters<typeof mutations.partners.setTag>[0]["payload"];
type SetFavouritePayload = Parameters<typeof mutations.partners.setFavourite>[0]["payload"];
type SetTagBody = Omit<SetTagPayload, "partnerId"> & { readonly operation: "setTag"; readonly partnerId?: string };
type SetFavouriteBody = Omit<SetFavouritePayload, "partnerId"> & { readonly operation: "setFavourite"; readonly partnerId?: string };
const partnerIdField = z.string({ error: MESSAGES.partnerIdNotText }).optional();
const setTagPayloadSchema = z.strictObject({ operation: z.literal("setTag"), partnerId: partnerIdField, tag: z.string({ error: MESSAGES.tagNotText }), present: z.boolean({ error: MESSAGES.presentNotBoolean }) });
const setFavouritePayloadSchema = z.strictObject({ operation: z.literal("setFavourite"), partnerId: partnerIdField, favourite: z.boolean({ error: MESSAGES.favouriteNotBoolean }) });
const setTagBodySchema = mutationInputSchema(setTagPayloadSchema);
const setFavouriteBodySchema = mutationInputSchema(setFavouritePayloadSchema);
const discriminantSchema = z.object({ payload: z.object({ operation: z.enum(OPERATIONS, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.bodyNotJson });
async function fileInto<Parsed extends { readonly partnerId?: string }, Payload>(schema: z.ZodType<MutationInput<Parsed>>, raw: unknown, address: string, payloadOf: (payload: Parsed) => Payload, run: (input: MutationInput<Payload>) => Promise<MutationOutcome>): Promise<Response> {
  const operationId = operationIdentityOf(raw);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return toResponse(outcomeFromError(operationId, parsed.error));
  const stated = parsed.data.payload.partnerId;
  if (stated !== undefined && stated !== address) return toResponse(outcomeFromError(operationId, new ZodError([{ code: "custom", path: ["payload", "partnerId"], message: MESSAGES.partnerIdMismatch }])));
  const input: MutationInput<Payload> = { ...parsed.data, payload: payloadOf(parsed.data.payload) };
  return mutate(input.operationId, () => run(input));
}
type TagsParams = { readonly partnerId: string };
/** Files one partner record under a personal label or the favourite mark: the body's `payload.operation` names `setTag` or `setFavourite`, exactly one of them runs, and the answer is exactly one of the eight outcomes. */
export async function POST(request: Request, context: { params: Promise<TagsParams> }): Promise<Response> {
  const { partnerId } = await context.params;
  const raw = await jsonBodyOf(request);
  const claimed = discriminantSchema.safeParse(raw);
  if (!claimed.success) return toResponse(outcomeFromError(operationIdentityOf(raw), claimed.error));
  const operation: Operation = claimed.data.payload.operation;
  switch (operation) {
    case "setTag":
      return fileInto(setTagBodySchema, raw, partnerId, (payload: SetTagBody) => ({ partnerId, tag: payload.tag, present: payload.present }), mutations.partners.setTag);
    case "setFavourite":
      return fileInto(setFavouriteBodySchema, raw, partnerId, (payload: SetFavouriteBody) => ({ partnerId, favourite: payload.favourite }), mutations.partners.setFavourite);
    default:
      return assertNever(operation, "Unhandled partner filing mutation");
  }
}
