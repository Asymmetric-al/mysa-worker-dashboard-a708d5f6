/** The Ministry Updates family's browser transport: */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { VARIANT_AUDIENCES } from "@/modules/content/variant";
import { mutationInputSchema, mutations, outcomeFromError, reads, toResponse } from "@/modules/data-service";
import { sessionIdOf } from "../session-cookie";
import { jsonBodyOf, operationIdentityOf } from "../handler";
// The store writes through node:fs, so this handler never runs on the edge runtime.
export const runtime = "nodejs";
// The read resolves the development session and evaluates the scenario clock once per request, and a variant's release state must never be served from a cache to a caller a restriction or a persona switch has since made unauthorised.
export const dynamic = "force-dynamic";
/** The identity a read's refusal is reported under, so an envelope and a refusal answer alike. */
const READ_ATTEMPT_ID = "read";
const UPDATE_FAMILY = "update" as const;
const MESSAGES = {
  documentRequired: "This action applies to one Update, so open the Update again and retry rather than pasting an address.",
  audienceInvalid: "Choose the audience this edition serves: public or approved supporters.",
  localeRequired: "State the content locale this edition is written in, such as en, fr or ar-EG.",
  localeInvalid: "Use a content-locale tag such as en, fr or ar-EG: a language subtag, then any hyphen-separated subtags.",
} as const;
const LOCALE_TAG_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u;
const documentIdSchema = z.string({ error: MESSAGES.documentRequired }).trim().min(1, MESSAGES.documentRequired).max(160, MESSAGES.documentRequired);
const localeTagSchema = z.string({ error: MESSAGES.localeRequired }).trim().min(2, MESSAGES.localeInvalid).max(35, MESSAGES.localeInvalid).regex(LOCALE_TAG_PATTERN, MESSAGES.localeInvalid);
// Shape only: which audience a family admits, and whether an audience-and-locale edition already exists, are the variant model's decisions behind the service, and they answer `invalid` with the field they refuse. Direction is derived from the tag there too, so it is not a caller input here.
const createVariantPayloadSchema = z.strictObject({ documentId: documentIdSchema, audience: z.enum(VARIANT_AUDIENCES, { error: MESSAGES.audienceInvalid }), locale: localeTagSchema });
const createVariantBodySchema = mutationInputSchema(createVariantPayloadSchema);
// The read's one parameter, judged by the same identifier schema the create payload states: present, it names the Update whose matrix is answered, and a blank one is a request defect keyed by field rather than a refusal a caller cannot tell from a denial.
const updateTargetSchema = z.object({ documentId: documentIdSchema });
/** Answers the two reads this path carries: the ministry's own Updates — each with its title, its editions' own draft, candidate and release pointers and the editions waiting for a release — when the … */
export async function GET(request: NextRequest): Promise<Response> {
  // The only parameter this read takes. Without it the request is the list the Updates surface opens on rather than a malformed read, because a worker asking what their ministry has written holds no identity yet; nothing else may select a principal, persona, organization, ministry, audience or
  // locale: the scope comes from the session resolution inside the service.
  const documentId = new URL(request.url).searchParams.get("documentId");
  try {
    if (documentId === null) return toResponse(await reads.updates.findContentDocuments({ families: [UPDATE_FAMILY] }));
    const target = updateTargetSchema.safeParse({ documentId });
    if (!target.success) return toResponse(outcomeFromError(READ_ATTEMPT_ID, target.error));
    return toResponse(await reads.updates.readVariantOverview({ documentId: target.data.documentId }));
  } catch (error) {
    // One mapper knows the difference between a store outage and a session that cannot be established, so a thrown fault is answered rather than escaping the boundary.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}
/** Creates one working variant of one Update — one family-permitted audience in one exact content locale, with no draft, candidate or release yet. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function POST(request: NextRequest): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const operationId = operationIdentityOf(raw);
  const parsed = createVariantBodySchema.safeParse(raw);
  if (!parsed.success) return toResponse(outcomeFromError(operationId, parsed.error));
  try {
    return toResponse(await mutations.updates.createVariant(sessionIdOf(request), { ...parsed.data, payload: { ...parsed.data.payload, family: UPDATE_FAMILY } }));
  } catch (error) {
    // A throw here is a defect rather than a presentation: the service answers refusals as outcomes, so this is a store fault, or a failure whose fate is not known. The caller keeps its operationId and re-queries it rather than sending the work again under a fresh one.
    return toResponse(outcomeFromError(operationId, error));
  }
}
