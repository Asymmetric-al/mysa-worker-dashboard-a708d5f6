/**
 * `POST /api/partners/[partnerId]/interactions` — the browser transport that records one thing that
 * actually happened with a contact.
 *
 * The route holds no rule of its own: it checks the shape of the request, hands one named mutation to
 * the data service and answers with exactly one of the eight outcomes — accepted, alreadyAccepted,
 * unchanged, conflict, denied, invalid, unavailable or unknown.
 */
import { z } from "zod";
import { mutationInputSchema, mutations, outcomeFromError, toResponse, type InteractionRecord } from "@/modules/data-service";
// The store writes through node:fs, so this handler never runs on the edge runtime.
export const runtime = "nodejs";
// The mutation resolves the development session and evaluates the scenario clock once per request.
export const dynamic = "force-dynamic";

/** The identity reported when the request carried no operationId this handler could read. */
const UNATTEMPTED_REQUEST_ID = "no-operation-attempted";

const MESSAGES = {
  bodyNotJson: "Send the interaction as a JSON object carrying operationId, scope, expectedRevision and payload.",
  partnerIdInvalid: "A record reference is text, so open the contact again and retry from its own page.",
  partnerIdMismatch:
    "The payload names one contact while the address names another, so nothing is recorded rather than filed against the wrong person: open the contact whose page you are writing on.",
  typeInvalid: "Choose the kind of contact that took place.",
  precisionInvalid: "Say how precisely you know the day: the day itself, roughly, or not at all.",
  unknownPrecisionCarriesNoDate: "An unknown day carries no date, because a date entered there would be invented rather than known.",
  dateRequired: "State the day this interaction happened on, or record that you do not know when.",
  dateInvalid: "State the day as a calendar date in YYYY-MM-DD form.",
  outcomeRequired: "Say in a sentence what came of the contact.",
  participantsInvalid: "The people who took part are a list, so name them as a list of records.",
  participantReferenceInvalid: "A participant reference is text, so choose the person from the records this contact can see.",
  participantRoleRequired: "Say how this person took part.",
  noteRequired: "A note needs at least one visible character, or leave the note out.",
  provenanceInvalid: "A source reference names the system that recorded the event and that system's own reference for it.",
} as const;

/** Refuses a member the interaction record does not hold, naming it so the caller knows what to remove. */
function unrecognizedMemberMessage(member: string): string {
  return `A recorded interaction holds no "${member}", so it is refused rather than dropped: a follow-up task is a second operation with its own operationId, and a gift, an appointment, an opened message or a completed task is not an interaction at all.`;
}

// The closed sets the Interaction record owns, mirrored so the transport refuses a value the record
// could never hold. `satisfies` ties the mirror to the record's own type: a member the record stops
// admitting fails to compile here, and a member it gains has to be added here — until it is, this door
// refuses a caller the service would accept rather than recording a kind the record cannot name.
const INTERACTION_KINDS = ["conversation", "visit", "call", "meeting", "written-exchange", "other"] as const satisfies readonly InteractionRecord["type"][];

const INTERACTION_PRECISIONS = ["date", "approximate", "unknown"] as const satisfies readonly InteractionRecord["precision"][];

/** A member that must carry visible text once surrounding whitespace is disregarded. */
function requiredText(message: string): z.ZodString {
  return z.string({ error: message }).refine((value) => value.trim().length > 0, { error: message });
}
const occurredOnSchema = z
  .strictObject({
    precision: z.enum(INTERACTION_PRECISIONS, { error: MESSAGES.precisionInvalid }),
    date: z.iso.date({ error: MESSAGES.dateInvalid }).optional(),
  })
  .superRefine((value, context) => {
    // The day and its precision are one statement, so they are judged together and the fault is
    // reported against the member that carries both. An honest "unknown" states no day at all, and a
    // day is never defaulted to today: a date nobody gave would claim knowledge the worker lacks.
    if (value.precision === "unknown") {
      if (value.date !== undefined) {
        context.addIssue({ code: "custom", message: MESSAGES.unknownPrecisionCarriesNoDate });
      }
      return;
    }
    if (value.date === undefined) {
      context.addIssue({ code: "custom", message: MESSAGES.dateRequired });
    }
  });
const participantSchema = z.strictObject({
  partnerId: z.string({ error: MESSAGES.participantReferenceInvalid }).min(1, MESSAGES.participantReferenceInvalid),
  role: requiredText(MESSAGES.participantRoleRequired),
});
// A source reference is opaque: its two strings are carried exactly as given and never parsed as a URL,
// a prefix or a checksum, because recognising that a source already recorded this event depends on the
// reference surviving the round trip unharmed.
const provenanceSchema = z.strictObject(
  {
    system: z.string({ error: MESSAGES.provenanceInvalid }).min(1, MESSAGES.provenanceInvalid),
    reference: z.string({ error: MESSAGES.provenanceInvalid }).min(1, MESSAGES.provenanceInvalid),
  },
  { error: MESSAGES.provenanceInvalid },
);
/**
 * The request this path accepts: the four-member mutation envelope, whose payload is the Interaction
 * record's own vocabulary — a participant names the record a person is already known by, a source
 * reference travels untouched, and a note is text whose audience the service alone fixes, so this
 * transport can neither widen a private note nor invent a shared one.
 *
 * The schema is built around the address because the address is the record's identity, so a payload
 * that also names a contact must agree with it member for member.
 */
function interactionRequestSchema(pathPartnerId: string) {
  const payload = z
    .strictObject({
      partnerId: z.string({ error: MESSAGES.partnerIdInvalid }).min(1, MESSAGES.partnerIdInvalid).optional(),
      type: z.enum(INTERACTION_KINDS, { error: MESSAGES.typeInvalid }),
      occurredOn: occurredOnSchema,
      outcome: requiredText(MESSAGES.outcomeRequired),
      participants: z.array(participantSchema, { error: MESSAGES.participantsInvalid }),
      note: requiredText(MESSAGES.noteRequired).optional(),
      provenance: provenanceSchema.optional(),
    })
    .superRefine((value, context) => {
      // Reading the address while ignoring a contradicting member would file the record against a
      // contact the caller never navigated to, so the disagreement is refused rather than resolved.
      if (value.partnerId !== undefined && value.partnerId !== pathPartnerId) {
        context.addIssue({ code: "custom", path: ["partnerId"], message: MESSAGES.partnerIdMismatch });
      }
    });
  return mutationInputSchema(payload);
}
const jsonObjectSchema = z.custom<Record<string, unknown>>((value) => typeof value === "object" && value !== null && !Array.isArray(value), {
  error: MESSAGES.bodyNotJson,
});
async function jsonBodyOf(request: Request): Promise<unknown> {
  try {
    const body: unknown = await request.json();
    return body;
  } catch {
    // A body that is not JSON attempted nothing, so its fate is not uncertain: the caller is told the
    // request it sent, rather than being handed an outcome that suggests the record might exist.
    return undefined;
  }
}
function attemptIdOf(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    return UNATTEMPTED_REQUEST_ID;
  }
  const claimed: unknown = Reflect.get(body, "operationId");
  return typeof claimed === "string" && claimed.length > 0 ? claimed : UNATTEMPTED_REQUEST_ID;
}
/**
 * Re-states each refused member on its own path. Zod reports an unrecognised key against the object
 * that holds it, while every other refusal here is keyed by the member at fault — so the keys are
 * restated on their own paths and the answer names what to remove instead of the object that held it.
 */
function withMembersNamed(error: z.ZodError): z.ZodError {
  const named: z.core.$ZodIssue[] = [];
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const member of issue.keys) {
        named.push({ code: "unrecognized_keys", keys: [member], path: [...issue.path, member], message: unrecognizedMemberMessage(member) });
      }
    } else {
      named.push(issue);
    }
  }
  return new z.ZodError(named);
}
interface InteractionRouteParams {
  readonly partnerId: string;
}
/** Records something that actually happened with the contact the address names, as one named mutation. */
export async function POST(request: Request, context: { params: Promise<InteractionRouteParams> }): Promise<Response> {
  // Next 16 hands the dynamic segment as a promise. It is opaque: forwarded exactly as written and
  // never parsed, normalised or decoded, because its form carries no meaning this route may rely on.
  const { partnerId } = await context.params;
  const body = await jsonBodyOf(request);
  const operationId = attemptIdOf(body);
  const claim = jsonObjectSchema.safeParse(body);
  if (!claim.success) {
    return toResponse(outcomeFromError(operationId, claim.error));
  }
  const parsed = interactionRequestSchema(partnerId).safeParse(claim.data);
  if (!parsed.success) {
    return toResponse(outcomeFromError(operationId, withMembersNamed(parsed.error)));
  }
  try {
    // Exactly one mutation, once. The optional follow-up task is not part of this record and is not
    // sent here: it is a second operation under its own operationId, so a task that fails cannot
    // repost the interaction that was already saved.
    return toResponse(await mutations.interactions.logInteraction({ ...parsed.data, payload: { ...parsed.data.payload, partnerId } }));
  } catch (error) {
    // A throw here is a defect rather than a presentation: the service answers refusals as outcomes,
    // so this is a store or medium fault, or a failure whose fate is not known. The latter keeps the
    // caller's own operationId, because recovery is a replay of that identity — never a fresh send.
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
