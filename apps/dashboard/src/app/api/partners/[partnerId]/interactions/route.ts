import { z } from "zod";
import { mutationInputSchema, mutations, outcomeFromError, toResponse, type InteractionRecord } from "@/modules/data-service";
import { jsonBodyOf, mutate, refusalIdentityGiven } from "../../../handler";
import { routeMethods } from "@/app/api/methods";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MESSAGES = {
  bodyNotJson: "Send the interaction as a JSON object carrying operationId, scope, expectedRevision and payload.",
  partnerIdInvalid: "A record reference is text, so open the contact again and retry from its own page.",
  partnerIdMismatch: "The payload names one contact while the address names another, so nothing is recorded rather than filed against the wrong person: open the contact whose page you are writing on.",
  typeInvalid: "Choose the kind of contact that took place.",
  precisionInvalid: "Say how precisely you know the day: the day itself, roughly, or not at all.",
  unknownPrecisionCarriesNoDate: "An unknown day carries no date, because a date entered there would be invented rather than known.",
  dateRequired: "State the day this interaction happened on, or record that you do not know when.",
  dateInvalid: "State the day as a calendar date in YYYY-MM-DD form.",
  outcomeRequired: "Say in a sentence what came of the contact.",
  participantsInvalid: "The people who took part are a list, so name them as a list of records.",
  participantsRequired: "Name at least one person who took part, because an interaction is always recorded against the contact it is about.",
  participantReferenceInvalid: "A participant reference is text, so choose the person from the records this contact can see.",
  participantRoleRequired: "Say how this person took part.",
  noteRequired: "A note needs at least one visible character, or leave the note out.",
  provenanceInvalid: "A source reference names the system that recorded the event and that system's own reference for it.",
} as const;
const INTERACTION_KINDS = ["conversation", "visit", "call", "meeting", "written-exchange", "other"] as const satisfies readonly InteractionRecord["type"][];
const INTERACTION_PRECISIONS = ["date", "approximate", "unknown"] as const satisfies readonly InteractionRecord["precision"][];
const requiredText = (message: string): z.ZodString => z.string({ error: message }).refine((value) => value.trim().length > 0, { error: message });
const occurredOnSchema = z.strictObject({ precision: z.enum(INTERACTION_PRECISIONS, { error: MESSAGES.precisionInvalid }), date: z.iso.date({ error: MESSAGES.dateInvalid }).optional() }).superRefine((value, context) => {
  if (value.precision === "unknown") {
    if (value.date !== undefined) context.addIssue({ code: "custom", message: MESSAGES.unknownPrecisionCarriesNoDate });
    return;
  }
  if (value.date === undefined) context.addIssue({ code: "custom", message: MESSAGES.dateRequired });
});
const participantSchema = z.strictObject({ partnerId: z.string({ error: MESSAGES.participantReferenceInvalid }).min(1, MESSAGES.participantReferenceInvalid), role: requiredText(MESSAGES.participantRoleRequired) });
const provenanceSchema = z.strictObject({ system: z.string({ error: MESSAGES.provenanceInvalid }).min(1, MESSAGES.provenanceInvalid), reference: z.string({ error: MESSAGES.provenanceInvalid }).min(1, MESSAGES.provenanceInvalid) }, { error: MESSAGES.provenanceInvalid });
function interactionRequestSchema(pathPartnerId: string) {
  const payload = z
    .strictObject({
      partnerId: z.string({ error: MESSAGES.partnerIdInvalid }).min(1, MESSAGES.partnerIdInvalid).optional(),
      type: z.enum(INTERACTION_KINDS, { error: MESSAGES.typeInvalid }),
      occurredOn: occurredOnSchema,
      outcome: requiredText(MESSAGES.outcomeRequired),
      participants: z.array(participantSchema, { error: MESSAGES.participantsInvalid }).min(1, MESSAGES.participantsRequired),
      note: requiredText(MESSAGES.noteRequired).optional(),
      provenance: provenanceSchema.optional(),
    })
    .superRefine((value, context) => {
      if (value.partnerId !== undefined && value.partnerId !== pathPartnerId) context.addIssue({ code: "custom", path: ["partnerId"], message: MESSAGES.partnerIdMismatch });
    });
  return mutationInputSchema(payload);
}
const jsonObjectSchema = z.custom<Record<string, unknown>>((value) => typeof value === "object" && value !== null && !Array.isArray(value), { error: MESSAGES.bodyNotJson });
const refusalIdentityOf = refusalIdentityGiven("no-operation-attempted");
/** Records something that actually happened with the contact the address names, as one named mutation. */ async function logInteraction(request: Request, context: { params: Promise<{ readonly partnerId: string }> }): Promise<Response> {
  const { partnerId } = await context.params;
  const body = await jsonBodyOf(request);
  const operationId = refusalIdentityOf(body);
  const claim = jsonObjectSchema.safeParse(body);
  if (!claim.success) return toResponse(outcomeFromError(operationId, claim.error));
  const parsed = interactionRequestSchema(partnerId).safeParse(claim.data);
  if (!parsed.success) return toResponse(outcomeFromError(operationId, parsed.error));
  return mutate(parsed.data.operationId, () => mutations.interactions.logInteraction({ ...parsed.data, payload: { ...parsed.data.payload, partnerId } }));
}
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ POST: logInteraction });
