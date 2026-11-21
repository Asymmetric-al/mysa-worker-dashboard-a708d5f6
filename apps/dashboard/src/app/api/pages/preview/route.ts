/**
 * `GET /api/pages/preview` — the exact, currently authorised, inert preview of one acknowledged page
 * edition revision.
 *
 * **Why this is a read and therefore a `GET`.** The query states identifiers and nothing else: the
 * edition (`variantId`), the exact revision the surface acknowledges (`revisionId`), the frozen
 * candidate it is being reviewed as (`candidateId`, optional) and the language it is read in
 * (`requestedLocale`, optional). Nothing in the request changes an edition, freezes a candidate or
 * releases anything, and the answer is the read envelope around rendered HTML — so a `POST` here would
 * be a second transport form for one read, and this file exports no write.
 *
 * **It is the same read the Update family uses, and this file is not a second implementation of it.**
 * `reads.pages.readPreview` is one definition reached from both families' jobs: the family is a property
 * of the document the identifier resolves, and every rule the preview obeys — which revision may be
 * rendered, whose authority admits it, which locale is served, which renditions travel with it — is the
 * content module's own decision. This handler supplies the four identifiers a browser can state and
 * restates no gate: no editorial check, no locale fallback, no giving retargeting.
 *
 * **The preview is re-authorised on every call.** The read resolves the development session again,
 * asserts the scope again, asks editorial authority again, and compares the acknowledged revision
 * against the variant's current draft, its frozen candidate and the publication at this address. A
 * stale tab, a copied address and a switched locale therefore obtain a refusal rather than somebody
 * else's revision, and no refusal falls through to a sibling edition. Nothing is cached: the handler is
 * dynamic per request and the envelope is answered `no-store`, because a stored preview would serve one
 * session's unpublished revision to the next.
 *
 * **The query is forwarded as stated.** Only these four names are read; an identifier that is missing or
 * empty is forwarded as empty text, so the read — not this file — is what refuses it, and an absent
 * optional parameter stays absent rather than becoming a value the caller did not state.
 *
 * **Nothing here decides an answer.** `toResponse` is the application's only status ladder: 200 carries
 * the envelope, 403 a refusal that names no record it could not admit, 503 an outage naming the source
 * and the safe retry. The preview data itself keeps the three states apart — authorised, invalid (the
 * document profile's own per-field issues) and denied (one reason code and nothing else) — so an
 * unrenderable draft is never shown as an empty one.
 *
 * **Layering.** `app/api → modules/data-service`. This file imports the service's barrel and nothing
 * else: never the store, never a read module, never a feature, a component or the media pipeline.
 */

import type { NextRequest } from "next/server";

import { outcomeFromError, reads, toResponse } from "@/modules/data-service";

// The store writes through node:fs and a preview resolves renditions from it, so this is never the edge
// runtime.
export const runtime = "nodejs";
// The read resolves the development session, the scenario clock and the edition's current pointers per
// request; a cached answer would outlive the revision it rendered.
export const dynamic = "force-dynamic";

/** A read has no attempt to replay, so its failure marker matches the one the reads modules state. */
const READ_ATTEMPT_ID = "read";

/** The query the preview read declares, taken from the read's own parameter list. */
type PreviewQuery = Parameters<typeof reads.pages.readPreview>[0];

/**
 * The preview query exactly as the request stated it.
 *
 * The two identifiers the read requires are forwarded as empty text when the URL omits them, because the
 * read's own refusal for a missing edition or revision is the answer a caller should see, and inventing
 * one here would be a second opinion about what the request meant. The two optional parameters are
 * forwarded only when the URL carries them.
 */
function previewQueryOf(params: URLSearchParams): PreviewQuery {
  return {
    variantId: params.get("variantId") ?? "",
    revisionId: params.get("revisionId") ?? "",
    candidateId: params.get("candidateId") ?? undefined,
    requestedLocale: params.get("requestedLocale") ?? undefined,
  };
}

/**
 * The preview this session is authorised to see, or the refusal it is entitled to.
 *
 * A denial carries one reason code and reveals nothing about a variant, a revision or a locale it could
 * not admit; an outage is neither an empty preview nor a blank document, so a surface can tell the three
 * apart without guessing.
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    return toResponse(
      await reads.pages.readPreview(previewQueryOf(new URL(request.url).searchParams)),
    );
  } catch (error) {
    // One mapper knows the difference between a store outage, a session that cannot be established and
    // a lost acknowledgement, so a thrown fault is answered rather than escaping the boundary.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}
