/**
 * `POST /api/partners/[partnerId]/tags` — the one way a browser files a partner record: one personal
 * tag applied or removed, or the favourite mark set or cleared.
 *
 * This path serves two named mutations rather than a command dispatcher: `payload.operation` names
 * `setTag` or `setFavourite`, each has its own closed schema here, and exactly one of them runs per
 * request (AAP 0.6.3, the `/api/partners` family row, and 0.7.1's "Find and open a partner" job).
 * Filing a record under a personal label is the worker's own view of their own list (AAP 0.10.1):
 * it writes no membership, consent, audience, campaign, stage or contact permission (AAP 0.8.2), so
 * a payload naming such a member is refused with that member named rather than accepted with the
 * member quietly dropped (AAP 0.6.2, 0.6.3).
 *
 * The mutation input is `{operationId, scope, expectedRevision, payload}` and the answer is exactly
 * one of the service's closed eight outcomes — accepted, alreadyAccepted, unchanged, conflict,
 * denied, invalid, unavailable, unknown — returned through the one response mapper (AAP 0.7.1).
 * Everything that decides an outcome lives behind the service: the acting scope is re-derived from
 * the development session, the expected revision is compared in the same transaction that writes,
 * the operation ledger decides a replay, and the tag's and identifier's own value rules belong to
 * the mutation that owns them.
 */
import { z, ZodError, type ZodIssue } from "zod";
import { assertNever } from "@/lib/result";
import { mutationInputSchema, mutations, outcomeFromError, toResponse, type MutationInput, type MutationOutcome } from "@/modules/data-service";
// The store behind the service writes through `node:fs`, so this handler never runs on the edge runtime.
export const runtime = "nodejs";
// Every request re-derives scope from the development session and reads the scenario clock, so no
// answer may be reused across a persona switch, a scenario change or a reset.
export const dynamic = "force-dynamic";

/** The attempt identity reported when the body carries none: nothing was attempted, so nothing is claimed. */
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

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

// Shape, not value rules: this boundary decides which members a named mutation accepts and what type
// each holds, so an unforeseen member stops the request under its own name. The value rules a tag, an
// identifier or a state must satisfy stay with the mutation that owns them and are judged there, so a
// bound tightened or relaxed behind the service can never be admitted here or refused twice.
const partnerIdField = z.string({ error: MESSAGES.partnerIdNotText }).optional();

const setTagPayloadSchema = z.strictObject({
  operation: z.literal("setTag"),
  partnerId: partnerIdField,
  tag: z.string({ error: MESSAGES.tagNotText }),
  present: z.boolean({ error: MESSAGES.presentNotBoolean }),
});

const setFavouritePayloadSchema = z.strictObject({
  operation: z.literal("setFavourite"),
  partnerId: partnerIdField,
  favourite: z.boolean({ error: MESSAGES.favouriteNotBoolean }),
});

const setTagBodySchema = mutationInputSchema(setTagPayloadSchema);

const setFavouriteBodySchema = mutationInputSchema(setFavouritePayloadSchema);

// The discriminant is read before either body is judged, so a request that names no change, or a
// change this path does not make, is told which member to state rather than which one failed first.
// It reads `payload.operation` alone and validates nothing else: the closed body schemas above are
// what judge the payload, and this object only locates the name it is dispatched by.
const discriminantSchema = z.object(
  {
    payload: z.object({ operation: z.enum(OPERATIONS, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.operationRequired }),
  },
  { error: MESSAGES.bodyNotJson },
);

const attemptIdentitySchema = z.object({ operationId: z.string() });

async function jsonBodyOf(request: Request): Promise<unknown> {
  try {
    const body: unknown = await request.json();
    return body;
  } catch {
    // A body that is not JSON is a refusal to report as an outcome, never an exception thrown past
    // the boundary and never a plain-text status of its own.
    return undefined;
  }
}
function operationIdentityOf(raw: unknown): string {
  const identity = attemptIdentitySchema.safeParse(raw);
  return identity.success && identity.data.operationId.length > 0 ? identity.data.operationId : UNIDENTIFIED_ATTEMPT;
}
/**
 * Reports each unaccepted member under its own path. A closed object reports an unforeseen member at
 * the object itself, naming it only inside the message; a surface renders field messages by path, so
 * the member is restated at `payload.<member>` here and the one response mapper re-bases it onto the
 * payload the caller posted.
 */
function namedPerMember(error: ZodError): ZodError {
  const named: ZodIssue[] = [];
  let restated = false;
  for (const issue of error.issues) {
    if (issue.code !== "unrecognized_keys") {
      named.push(issue);
      continue;
    }
    restated = true;
    for (const key of issue.keys) {
      named.push({
        code: "custom",
        path: [...issue.path, key],
        message: `This change carries "${key}", which no tag or favourite change accepts. A personal label and the favourite mark are the whole of what this request files; a consent, an audience, a membership, a campaign, a stage or a contact permission is a different change with its own job, so this one stops here rather than ignoring the member.`,
      });
    }
  }
  return restated ? new ZodError(named) : error;
}
/** Answers `invalid` for one refusal this handler itself decided, keyed by the path a caller corrects. */
function refusalOf(operationId: string, path: readonly string[], message: string): Response {
  const issues: ZodIssue[] = [{ code: "custom", path: [...path], message }];
  return toResponse(outcomeFromError(operationId, new ZodError(issues)));
}
/**
 * The address names the record. A body may restate it and is then the same request; a body naming a
 * different record is refused rather than filed against the one it mentions, because two records with
 * equal-looking identifiers are two records and the address is what the caller opened.
 */
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
    return toResponse(outcomeFromError(operationId, namedPerMember(parsed.error)));
  }
  const identity = partnerIdFor(parsed.data.payload.partnerId, partnerIdFromPath);
  if (!identity.agreed) {
    return refusalOf(operationId, ["payload", "partnerId"], MESSAGES.partnerIdMismatch);
  }
  // The attempt identity, the claimed scope and the revision the caller saw are forwarded exactly as
  // received: re-minting the identity would turn every retry into a fresh effect, and a revision
  // checked here could no longer be the one the write compares against.
  const input: MutationInput<Payload> = {
    operationId: parsed.data.operationId,
    scope: parsed.data.scope,
    expectedRevision: parsed.data.expectedRevision,
    payload: payloadOf(parsed.data.payload, identity.partnerId),
  };
  try {
    return toResponse(await run(input));
  } catch (error) {
    // A throw here is a defect rather than a presentation: the service answers its refusals as
    // outcomes, so a throw means a store or medium fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(input.operationId, error));
  }
}

interface TagsParams {
  readonly partnerId: string;
}

/**
 * Files one partner record under a personal label or the favourite mark: the body's
 * `payload.operation` names `setTag` or `setFavourite`, exactly one of them runs, and the answer is
 * exactly one outcome — accepted, alreadyAccepted, unchanged, conflict, denied, invalid, unavailable
 * or unknown.
 */
export async function POST(request: Request, context: { params: Promise<TagsParams> }): Promise<Response> {
  // Next 16 hands the dynamic segment over as a promise, so the record the address names is awaited
  // before anything is judged. The identifier is opaque: it is forwarded unchanged and never parsed.
  const { partnerId } = await context.params;
  const raw = await jsonBodyOf(request);
  const operationId = operationIdentityOf(raw);
  const claimed = discriminantSchema.safeParse(raw);
  if (!claimed.success) {
    return toResponse(outcomeFromError(operationId, namedPerMember(claimed.error)));
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
      // Unreachable: `OPERATIONS` is the closed set the discriminant admits, so a third name fails to
      // compile at this call instead of arriving here.
      return assertNever(operation, "Unhandled partner filing mutation");
  }
}
