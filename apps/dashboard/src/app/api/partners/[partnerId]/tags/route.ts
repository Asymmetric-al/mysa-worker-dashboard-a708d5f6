/** `POST /api/partners/[partnerId]/tags` — the one way a browser files a partner record: one personal tag applied or removed, or the favourite mark set or cleared. */
import { z, ZodError, type ZodIssue } from "zod";
import { jsonBodyOf, operationIdentityOf } from "../../../handler";
import { assertNever } from "@/lib/result";
import { mutationInputSchema, mutations, outcomeFromError, toResponse, type MutationInput, type MutationOutcome } from "@/modules/data-service";
// The store behind the service writes through `node:fs`, so this handler never runs on the edge runtime.
export const runtime = "nodejs";
// Every request re-derives scope from the development session and reads the scenario clock, so no answer may be reused across a persona switch, a scenario change or a reset.
export const dynamic = "force-dynamic";
/** The two named mutations this path serves, as the discriminant's closed set. */
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
/** The payload `setTag` accepts, taken from the mutation itself so a change there breaks this compile. */
type SetTagPayload = Parameters<typeof mutations.partners.setTag>[0]["payload"];
/** The payload `setFavourite` accepts, taken the same way. */
type SetFavouritePayload = Parameters<typeof mutations.partners.setFavourite>[0]["payload"];
/** A `setTag` body's payload: the mutation's own members, the name of the change, and an optional restatement of the address. */
type SetTagBody = Omit<SetTagPayload, "partnerId"> & { readonly operation: "setTag"; readonly partnerId?: string };
/** A `setFavourite` body's payload, on the same terms. */
type SetFavouriteBody = Omit<SetFavouritePayload, "partnerId"> & { readonly operation: "setFavourite"; readonly partnerId?: string };
// Shape, not value rules: this boundary decides which members a named mutation accepts and what type each holds, so an unforeseen member stops the request under its own name. The value rules a tag, an
// identifier or a state must satisfy stay with the mutation that owns them and are judged there, so a bound tightened or relaxed behind the service can never be admitted here or refused twice.
const partnerIdField = z.string({ error: MESSAGES.partnerIdNotText }).optional();
const setTagPayloadSchema = z.strictObject({ operation: z.literal("setTag"), partnerId: partnerIdField, tag: z.string({ error: MESSAGES.tagNotText }), present: z.boolean({ error: MESSAGES.presentNotBoolean }) });
const setFavouritePayloadSchema = z.strictObject({ operation: z.literal("setFavourite"), partnerId: partnerIdField, favourite: z.boolean({ error: MESSAGES.favouriteNotBoolean }) });
const setTagBodySchema = mutationInputSchema(setTagPayloadSchema);
const setFavouriteBodySchema = mutationInputSchema(setFavouritePayloadSchema);
// The discriminant is read before either body is judged, so a request that names no change, or a change this path does not make, is told which member to state rather than which one failed first. It reads `payload.operation` alone and validates nothing else: the closed body schemas above are
// what judge the payload, and this object only locates the name it is dispatched by.
const discriminantSchema = z.object({ payload: z.object({ operation: z.enum(OPERATIONS, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.bodyNotJson });
/** Answers `invalid` for one refusal this handler itself decided, keyed by the path a caller corrects. */
function refusalOf(operationId: string, path: readonly string[], message: string): Response {
  const issues: ZodIssue[] = [{ code: "custom", path: [...path], message }];
  return toResponse(outcomeFromError(operationId, new ZodError(issues)));
}
/** The address names the record. */
function partnerIdFor(stated: string | undefined, fromPath: string): { readonly agreed: true; readonly partnerId: string } | { readonly agreed: false } {
  return stated === undefined || stated === fromPath ? { agreed: true, partnerId: fromPath } : { agreed: false };
}
async function dispatch<Parsed extends { readonly partnerId?: string }, Payload>(
  schema: z.ZodType<MutationInput<Parsed>>,
  raw: unknown,
  operationId: string,
  partnerIdFromPath: string,
  payloadOf: (payload: Parsed, partnerId: string) => Payload,
  run: (input: MutationInput<Payload>) => Promise<MutationOutcome>,
): Promise<Response> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return toResponse(outcomeFromError(operationId, parsed.error));
  }
  const identity = partnerIdFor(parsed.data.payload.partnerId, partnerIdFromPath);
  if (!identity.agreed) {
    return refusalOf(operationId, ["payload", "partnerId"], MESSAGES.partnerIdMismatch);
  }
  // The attempt identity, the claimed scope and the revision the caller saw are forwarded exactly as received: re-minting the identity would turn every retry into a fresh effect, and a revision checked here could no longer be the one the write compares against.
  const input: MutationInput<Payload> = { operationId: parsed.data.operationId, scope: parsed.data.scope, expectedRevision: parsed.data.expectedRevision, payload: payloadOf(parsed.data.payload, identity.partnerId) };
  try {
    return toResponse(await run(input));
  } catch (error) {
    // A throw here is a defect rather than a presentation: the service answers its refusals as outcomes, so a throw means a store or medium fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(input.operationId, error));
  }
}
interface TagsParams {
  readonly partnerId: string;
}
/** Files one partner record under a personal label or the favourite mark: the body's `payload.operation` names `setTag` or `setFavourite`, exactly one of them runs, and the answer is exactly one … */
export async function POST(request: Request, context: { params: Promise<TagsParams> }): Promise<Response> {
  // Next 16 hands the dynamic segment over as a promise, so the record the address names is awaited before anything is judged. The identifier is opaque: it is forwarded unchanged and never parsed.
  const { partnerId } = await context.params;
  const raw = await jsonBodyOf(request);
  const operationId = operationIdentityOf(raw);
  const claimed = discriminantSchema.safeParse(raw);
  if (!claimed.success) {
    return toResponse(outcomeFromError(operationId, claimed.error));
  }
  const operation: Operation = claimed.data.payload.operation;
  switch (operation) {
    case "setTag":
      return dispatch<SetTagBody, SetTagPayload>(
        setTagBodySchema,
        raw,
        operationId,
        partnerId,
        (payload, agreedPartnerId) => ({ partnerId: agreedPartnerId, tag: payload.tag, present: payload.present }),
        (input) => mutations.partners.setTag(input),
      );
    case "setFavourite":
      return dispatch<SetFavouriteBody, SetFavouritePayload>(
        setFavouriteBodySchema,
        raw,
        operationId,
        partnerId,
        (payload, agreedPartnerId) => ({ partnerId: agreedPartnerId, favourite: payload.favourite }),
        (input) => mutations.partners.setFavourite(input),
      );
    default:
      // Unreachable: `OPERATIONS` is the closed set the discriminant admits, so a third name fails to compile at this call instead of arriving here.
      return assertNever(operation, "Unhandled partner filing mutation");
  }
}
