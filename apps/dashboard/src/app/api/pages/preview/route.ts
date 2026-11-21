/** `GET /api/pages/preview` — the exact, currently authorised, inert preview of one acknowledged Page edition revision. */
import { z } from "zod";
import { reads, refusedRead, toResponse } from "@/modules/data-service";
import { outcomeFromError, type FieldMessages } from "@/modules/data-service/outcome";
// The store writes through node:fs and a preview resolves rendition ids from it, so this is never the edge runtime.
export const runtime = "nodejs";
// The read resolves the development session, the scenario clock and the edition's current pointers per request; a cached answer would outlive the revision it rendered.
export const dynamic = "force-dynamic";
// A read carries no caller-supplied operation id, so a refused or thrown request is reported under the one attempt every read transport names.
const READ_ATTEMPT_ID = "read";
// The read's own parameter shape, taken from its signature rather than restated: a member the service adds, renames or withdraws reaches this file as a compile error instead of a silently dropped parameter.
type PreviewQuery = Parameters<typeof reads.pages.readPreview>[0];
// The whole vocabulary of a preview URL: an edition, the revision its surface acknowledges, an optional frozen candidate and the requested language. Authority is never carried here.
const PREVIEW_PARAMETERS = ["variantId", "revisionId", "candidateId", "requestedLocale"] as const;
type PreviewParameter = (typeof PREVIEW_PARAMETERS)[number];
const PREVIEW_PARAMETER_SET: ReadonlySet<string> = new Set<string>(PREVIEW_PARAMETERS);
// A language tag's shape, and only its shape. Which edition answers a request, whether it falls back and to which language are the content module's decision and arrive in the result; re-deciding them from the URL would be a second locale resolver.
const LANGUAGE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u;
const MESSAGES = {
  variantId: "State the edition to preview as variantId: a preview renders one edition's acknowledged revision, so the edition has to be named.",
  revisionId: "State the revision shown on screen as revisionId: a preview renders that exact revision and never falls back to newer content.",
  requestedLocale: "State the language the preview is read in as requestedLocale, for example en, fr-FR or ar.",
  localeShape: "State requestedLocale as a language tag: two or three letters, then hyphen-separated letters or digits, for example en, fr-FR or ar.",
  unsupported: (parameter: string) => `Drop the ${parameter} parameter: a preview URL carries variantId, revisionId, candidateId and requestedLocale only. A parameter this transport does not take would otherwise read as the token, the audience or the revision choice it was shaped to look like.`,
} as const;
const previewQuerySchema = z.object({ variantId: z.string({ error: MESSAGES.variantId }), revisionId: z.string({ error: MESSAGES.revisionId }), candidateId: z.string().optional(), requestedLocale: z.string({ error: MESSAGES.requestedLocale }).regex(LANGUAGE_TAG, MESSAGES.localeShape) });
/** The parameters that carry a value. */
function statedParametersOf(search: URLSearchParams): Partial<Record<PreviewParameter, string>> {
  const stated: Partial<Record<PreviewParameter, string>> = {};
  for (const parameter of PREVIEW_PARAMETERS) {
    const value = search.get(parameter)?.trim() ?? "";
    if (value.length > 0) {
      stated[parameter] = value;
    }
  }
  return stated;
}
/** The query the read accepts, or the validation error the transport answers the request with. */
function previewQueryOf(search: URLSearchParams): PreviewQuery | z.ZodError {
  const parsed = previewQuerySchema.safeParse(statedParametersOf(search));
  return parsed.success ? parsed.data : parsed.error;
}
/** The parameters a preview URL does not take, each refused by name where it was sent. */
function unsupportedFieldsOf(search: URLSearchParams): FieldMessages {
  const fields: Record<string, readonly string[]> = {};
  for (const parameter of search.keys()) {
    if (!PREVIEW_PARAMETER_SET.has(parameter)) {
      fields[parameter] = [MESSAGES.unsupported(parameter)];
    }
  }
  return fields;
}
/** The preview this session is authorised to see, or the refusal it is entitled to: one read envelope carrying the exact acknowledged revision, or the `denied`, `unavailable` or `invalid` outcome … */
export async function GET(request: Request): Promise<Response> {
  const search = new URL(request.url).searchParams;
  const unsupported = unsupportedFieldsOf(search);
  if (Object.keys(unsupported).length > 0) {
    return toResponse(refusedRead(READ_ATTEMPT_ID, unsupported));
  }
  const query = previewQueryOf(search);
  if (query instanceof z.ZodError) {
    // Field messages name the parameter and what is wrong with it. They say nothing about whether any edition exists, because a malformed request must not become a way to ask.
    return toResponse(refusedRead(READ_ATTEMPT_ID, query));
  }
  try {
    // One read, passed through untouched: the envelope already carries the exact revision, `inert: true`, `givingAction: "none"`, the reading direction and the admitted rendition ids as the content module decided them. Restating any of them here would be a second promise about inertness.
    return toResponse(await reads.pages.readPreview(query));
  } catch (error) {
    // One mapper knows the difference between a store outage, a session that cannot be established and a lost acknowledgement, so a thrown fault is answered rather than escaping the boundary.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}
