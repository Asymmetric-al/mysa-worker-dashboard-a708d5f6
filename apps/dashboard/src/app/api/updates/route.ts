/**
 * The Ministry Updates family's browser transport: `GET /api/updates` answers one Update's variant
 * matrix, and `POST /api/updates` creates one working variant of one Update.
 *
 * The path carries exactly the two contracts the job "Write and release an Update" gives it —
 * `reads.readVariantOverview` and `mutations.createVariant`; the draft, review, release, notice and
 * withdrawal writes belong to their own handlers, so nothing else lives here. The handler states
 * what the service answered and renames nothing: the read's envelope already tells a draft, a
 * candidate, a current release and a withdrawal apart per edition — including a sibling's prior-good
 * head after a failed release — and a flag added here would be the client-side inference the release
 * forbids.
 *
 * Rule 1 clause 1 (preserve the agreed scope): two exports, no sub-route, no kinds endpoint, no
 * status-shaped endpoint, no provider client and no second transport. Rule 1 clause 2 (reuse the
 * specified patterns): the read envelope, the closed outcome union with its one response mapper, the
 * four-field mutation input and a strict payload schema for this one mutation. Rule 1 clause 3
 * (preserve the meaning of included workflows): creating a variant is not publishing, not review,
 * not notification and not audience enrolment, so the body is strict at both levels and the family
 * is pinned here — a request cannot carry a release, a candidate, a notification intent or a
 * membership through this endpoint.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { mutationInputSchema, mutations, outcomeFromError, reads, toResponse } from "@/modules/data-service";
import { sessionIdOf } from "../session-cookie";
// The store writes through node:fs, so this handler never runs on the edge runtime.
export const runtime = "nodejs";
// The read resolves the development session and evaluates the scenario clock once per request, and a
// variant's release state must never be served from a cache to a caller a restriction or a persona
// switch has since made unauthorised.
export const dynamic = "force-dynamic";

/** The identity a mutation attempt is reported under when its body carries none, so a malformed request still answers in the one outcome shape. */
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";
/** The identity a read's refusal is reported under, so an envelope and a refusal answer alike. */
const READ_ATTEMPT_ID = "read";
/**
 * The content family this path creates editions of. `createVariant` is the mutation the Worker and
 * Project Page family uses too, so the family is this handler's decision and never the caller's: a
 * body that names one is refused, and pinning it here is what stops a Page edition being created
 * through the Update path.
 */
const UPDATE_FAMILY = "update" as const;
/** The audiences an Update admits: the closed set the variant record carries. */
const UPDATE_AUDIENCES = ["public", "approved-supporter"] as const;

const MESSAGES = {
  documentRequired: "This action applies to one Update, so open the Update again and retry rather than pasting an address.",
  audienceInvalid: "Choose the audience this edition serves: public or approved supporters.",
  localeRequired: "State the content locale this edition is written in, such as en, fr or ar-EG.",
  localeInvalid: "Use a content-locale tag such as en, fr or ar-EG: a language subtag, then any hyphen-separated subtags.",
} as const;
/** A content-locale tag: a language subtag, then any hyphen-separated alphanumeric subtags. */
const LOCALE_TAG_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u;
const documentIdSchema = z.string({ error: MESSAGES.documentRequired }).trim().min(1, MESSAGES.documentRequired).max(160, MESSAGES.documentRequired);
const localeTagSchema = z.string({ error: MESSAGES.localeRequired }).trim().min(2, MESSAGES.localeInvalid).max(35, MESSAGES.localeInvalid).regex(LOCALE_TAG_PATTERN, MESSAGES.localeInvalid);
// Shape only: which audience a family admits, and whether an audience-and-locale edition already
// exists, are the variant model's decisions behind the service, and they answer `invalid` with the
// field they refuse. Direction is derived from the tag there too, so it is not a caller input here.
const createVariantPayloadSchema = z.strictObject({
  documentId: documentIdSchema,
  audience: z.enum(UPDATE_AUDIENCES, { error: MESSAGES.audienceInvalid }),
  locale: localeTagSchema,
});
const createVariantBodySchema = mutationInputSchema(createVariantPayloadSchema);

const attemptIdentitySchema = z.object({ operationId: z.string() });
async function jsonBodyOf(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    // A body that is not JSON is a request defect answered as `invalid` by the schema below, rather
    // than a thrown 500: `undefined` fails the same body schema every other defect fails.
    return undefined;
  }
}
function operationIdentityOf(raw: unknown): string {
  const identity = attemptIdentitySchema.safeParse(raw);
  return identity.success && identity.data.operationId.length > 0 ? identity.data.operationId : UNIDENTIFIED_ATTEMPT;
}
/** Answers one Update's variant matrix — every edition with its own draft, candidate and release pointers — in the one read envelope, or the read's own `denied` or `unavailable` refusal. */
export async function GET(request: NextRequest): Promise<Response> {
  // The only parameter this read takes. An absent identity is the read's decision to refuse, and
  // nothing else may select a principal, persona, organization, ministry, audience or locale: the
  // scope comes from the session resolution inside the service.
  const documentId = new URL(request.url).searchParams.get("documentId") ?? "";
  try {
    return toResponse(await reads.updates.readVariantOverview({ documentId }));
  } catch (error) {
    // One mapper knows the difference between a store outage and a session that cannot be
    // established, so a thrown fault is answered rather than escaping the boundary.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}
/** Creates one working variant of one Update — one family-permitted audience in one exact content locale, with no draft, candidate or release yet. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function POST(request: NextRequest): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const operationId = operationIdentityOf(raw);
  const parsed = createVariantBodySchema.safeParse(raw);
  if (!parsed.success) {
    return toResponse(outcomeFromError(operationId, parsed.error));
  }
  try {
    return toResponse(
      await mutations.updates.createVariant(sessionIdOf(request), {
        ...parsed.data,
        payload: { ...parsed.data.payload, family: UPDATE_FAMILY },
      }),
    );
  } catch (error) {
    // A throw here is a defect rather than a presentation: the service answers refusals as outcomes,
    // so this is a store fault, or a failure whose fate is not known. The caller keeps its
    // operationId and re-queries it rather than sending the work again under a fresh one.
    return toResponse(outcomeFromError(operationId, error));
  }
}
