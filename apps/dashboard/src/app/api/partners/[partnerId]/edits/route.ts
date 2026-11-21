/**
 * `POST /api/partners/[partnerId]/edits` — the one browser write that changes a partner record's
 * permitted fields, and the only path that reaches `saveContactEdits`.
 *
 * The handler transports and decides nothing else: it validates the four fields every mutation
 * presents, hands them to the mutation with the record this path names, and answers through the one
 * response ladder. Scope admission, the revision comparison, replay detection and the
 * outcome-to-status mapping belong to the service and are not repeated here.
 */
import { z } from "zod";
import { isRecord } from "@/lib/guards";
import { mutationInputSchema, mutations, outcomeFromError, toResponse, type PartnerRecord } from "@/modules/data-service";
// The store behind the service writes through node:fs, so this handler never runs on the edge runtime.
export const runtime = "nodejs";
// Every request resolves the development session, the selected context and the scenario instant afresh.
export const dynamic = "force-dynamic";

/** Names the attempt of a body that could not be read, so even that refusal says which attempt it answers. */
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";
/** The contact-method vocabulary, held to the record's own union so a kind the record drops fails to compile here. */
const CONTACT_METHOD_KINDS = ["email", "phone", "postal"] as const satisfies readonly PartnerRecord["contactMethods"][number]["kind"][];
// Every bound and message below mirrors the mutation's own payload schema, so a value refused here is
// refused there in the same words: this path adds a guard in front of the write, never a second rule.
const OPAQUE_ID_MAX_LENGTH = 160;

const DISPLAY_NAME_MAX_LENGTH = 200;

const ADDITIONAL_NAME_MAX_LENGTH = 120;

const ADDITIONAL_NAMES_MAX_COUNT = 8;

const CONTACT_VALUE_MAX_LENGTH = 320;

const CONTACT_METHODS_MAX_COUNT = 30;

const STAGE_MAX_LENGTH = 80;

const RESTRICTION_KIND_MAX_LENGTH = 80;

const RESTRICTION_DETAIL_MAX_LENGTH = 1_000;

const RESTRICTIONS_MAX_COUNT = 20;

/** What `saveContactEdits` accepts, taken from the mutation itself so this path cannot drift from it. */
type SaveContactEditsPayload = Parameters<typeof mutations.partnerPreparation.saveContactEdits>[0]["payload"];

const contactMethodEditSchema = z.strictObject({
  kind: z.enum(CONTACT_METHOD_KINDS, "Choose a contact method kind: email, phone or postal."),
  value: z.string().trim().min(1, "A contact method needs a value.").max(CONTACT_VALUE_MAX_LENGTH, "This contact method value is longer than a stored record holds."),
  permitted: z.boolean(),
});

const namePartsEditSchema = z.strictObject({
  given: z.string().trim().min(1, "A recorded given name cannot be blank.").nullable(),
  family: z.string().trim().min(1, "A recorded family name cannot be blank.").nullable(),
  additional: z
    .array(z.string().trim().min(1, "A recorded additional name cannot be blank.").max(ADDITIONAL_NAME_MAX_LENGTH, "This additional name part is longer than a stored record holds."))
    .max(ADDITIONAL_NAMES_MAX_COUNT, "A name stores at most eight additional parts."),
});

const restrictionEditSchema = z.strictObject({
  kind: z.string().trim().min(1, "A restriction needs a short label.").max(RESTRICTION_KIND_MAX_LENGTH, "This restriction label is longer than a stored record holds."),
  detail: z.string().trim().min(1, "A restriction states what must not happen.").max(RESTRICTION_DETAIL_MAX_LENGTH, "This restriction detail is longer than a stored record holds."),
});

/**
 * The permitted fields one edit may set, and nothing else: a strict object, so a server-managed fact
 * (`source`, `revision`, `audience`, `kind`), a proof of possession (`verified`), a consent or
 * membership fact, or any other key is refused with its path named rather than quietly dropped.
 */
const contactEditPayloadSchema = z.strictObject({
  // The browser's own payload mirror carries the record the edit is about, so a body that states one
  // is accepted; the request schema below requires it to name the record this path names, and the
  // handler injects the path's segment after the spread, so the selector never comes from the body.
  partnerId: z
    .string()
    .min(1, "Name the record this change applies to: an empty identifier names nothing.")
    .max(OPAQUE_ID_MAX_LENGTH, `An identifier is at most ${String(OPAQUE_ID_MAX_LENGTH)} characters, and the value supplied is longer.`)
    .optional(),
  displayName: z.string().trim().min(1, "A display name cannot be blank.").max(DISPLAY_NAME_MAX_LENGTH, "This display name is longer than a stored record holds.").optional(),
  nameParts: namePartsEditSchema.optional(),
  // Sent whole, exactly as the record was last read: a restriction is never filtered, merged or
  // "cleaned" on its way through, so a restriction the worker recorded survives an unrelated edit.
  restrictions: z.array(restrictionEditSchema).max(RESTRICTIONS_MAX_COUNT, "A record stores at most twenty restrictions.").optional(),
  contactMethods: z.array(contactMethodEditSchema).max(CONTACT_METHODS_MAX_COUNT, "A record stores at most thirty contact methods.").optional(),
  // The record's one relationship-context label: the source-supplied word the record renders, or
  // `null` to clear it, because a blank string states no label and clearing one is its own intent.
  stage: z
    .string()
    .trim()
    .min(1, "A relationship label cannot be blank; send null to clear it.")
    .max(STAGE_MAX_LENGTH, "This relationship label is longer than a stored record holds.")
    .nullable()
    .optional(),
});

/**
 * The request one edit presents for the record this path names: the shared four-field input composed
 * with this path's payload schema, refusing a payload that selects a different record so a caller is
 * never answered about one record after naming two.
 */
function contactEditRequestSchema(target: string) {
  return mutationInputSchema(contactEditPayloadSchema).superRefine((input, context) => {
    const claimed = input.payload.partnerId;
    if (claimed !== undefined && claimed !== target) {
      context.addIssue({
        code: "custom",
        path: ["payload", "partnerId"],
        message: "Name one record. The path names the record this change applies to, and a payload naming a different one would leave the answer describing a record the caller did not address.",
      });
    }
  });
}

function attemptIdOf(body: unknown): string {
  if (!isRecord(body)) {
    return UNIDENTIFIED_ATTEMPT;
  }
  // The caller's own identifier, echoed so its recovery path can re-query the attempt it made. It is
  // read here only to name the attempt in a refusal; it never stands in for a validated operationId.
  const claimed = body.operationId;
  return typeof claimed === "string" && claimed.length > 0 ? claimed : UNIDENTIFIED_ATTEMPT;
}

/** Saves the caller's permitted-field edits to the partner record this path names, against the revision they read. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function POST(request: Request, { params }: { params: Promise<{ partnerId: string }> }): Promise<Response> {
  // Next 16 hands a dynamic segment as a promise, so it is awaited before the body is judged against it.
  const { partnerId } = await params;
  const body: unknown = await request.json().catch(() => undefined);
  const parsed = contactEditRequestSchema(partnerId).safeParse(body);
  if (!parsed.success) {
    // A validation failure is answered as `invalid` with one message per field path, through the same
    // mapping a thrown fault takes: no state is read, no state is written, and nothing is `unknown`.
    return toResponse(outcomeFromError(attemptIdOf(body), parsed.error));
  }
  const { operationId, scope, expectedRevision, payload } = parsed.data;
  // Typed against the mutation's own payload: a field it stops accepting fails to compile here rather
  // than reaching the service and being refused there at runtime.
  const edited: SaveContactEditsPayload = { ...payload, partnerId };
  try {
    return toResponse(await mutations.partnerPreparation.saveContactEdits({ operationId, scope, expectedRevision, payload: edited }));
  } catch (error) {
    // A throw here is a defect rather than a presentation: the mutation answers refusals as outcomes,
    // so a throw means a store or medium fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(operationId, error));
  }
}
