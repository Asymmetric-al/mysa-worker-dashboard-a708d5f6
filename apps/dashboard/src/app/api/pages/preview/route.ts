import { z } from "zod";
import { reads, refusedRead, toResponse } from "@/modules/data-service";
import type { FieldMessages } from "@/modules/data-service/outcome";
import { READ_ATTEMPT, readResponse } from "../../read";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type PreviewQuery = Parameters<typeof reads.pages.readPreview>[0];
const PREVIEW_PARAMETERS = ["variantId", "revisionId", "candidateId", "requestedLocale"] as const;
type PreviewParameter = (typeof PREVIEW_PARAMETERS)[number];
const PREVIEW_PARAMETER_SET: ReadonlySet<string> = new Set<string>(PREVIEW_PARAMETERS);
const LANGUAGE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u;
const MESSAGES = {
  variantId: "State the edition to preview as variantId: a preview renders one edition's acknowledged revision, so the edition has to be named.",
  revisionId: "State the revision shown on screen as revisionId: a preview renders that exact revision and never falls back to newer content.",
  requestedLocale: "State the language the preview is read in as requestedLocale, for example en, fr-FR or ar.",
  localeShape: "State requestedLocale as a language tag: two or three letters, then hyphen-separated letters or digits, for example en, fr-FR or ar.",
  unsupported: (parameter: string) => `Drop the ${parameter} parameter: a preview URL carries variantId, revisionId, candidateId and requestedLocale only. A parameter this transport does not take would otherwise read as the token, the audience or the revision choice it was shaped to look like.`,
} as const;
const previewQuerySchema = z.object({ variantId: z.string({ error: MESSAGES.variantId }), revisionId: z.string({ error: MESSAGES.revisionId }), candidateId: z.string().optional(), requestedLocale: z.string({ error: MESSAGES.requestedLocale }).regex(LANGUAGE_TAG, MESSAGES.localeShape) });
function statedParametersOf(search: URLSearchParams): Partial<Record<PreviewParameter, string>> {
  const stated: Partial<Record<PreviewParameter, string>> = {};
  for (const parameter of PREVIEW_PARAMETERS) {
    const value = search.get(parameter)?.trim() ?? "";
    if (value.length > 0) stated[parameter] = value;
  }
  return stated;
}
function unsupportedFieldsOf(search: URLSearchParams): FieldMessages {
  const fields: Record<string, readonly string[]> = {};
  for (const parameter of search.keys()) if (!PREVIEW_PARAMETER_SET.has(parameter)) fields[parameter] = [MESSAGES.unsupported(parameter)];
  return fields;
}
/** The preview this session is authorised to see, or the refusal it is entitled to: one read envelope carrying the exact acknowledged revision, or the `denied`, `unavailable` or `invalid` outcome that names why it is not shown. */
export async function GET(request: Request): Promise<Response> {
  const search = new URL(request.url).searchParams;
  const unsupported = unsupportedFieldsOf(search);
  if (Object.keys(unsupported).length > 0) return toResponse(refusedRead(READ_ATTEMPT, unsupported));
  const query = previewQuerySchema.safeParse(statedParametersOf(search));
  if (!query.success) return toResponse(refusedRead(READ_ATTEMPT, query.error));
  return readResponse(READ_ATTEMPT, () => reads.pages.readPreview(query.data as PreviewQuery));
}
