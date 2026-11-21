"use client";
/** The Worker and Project Pages family's preview read: one exact, currently authorised, inert rendering of one acknowledged Page edition revision, transported exactly as the service built it. */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ReadEnvelope, Scope, reads } from "@/modules/data-service";
// The outcome module rather than the service barrel, because this is a browser module: the barrel is imported
// for its types only, so no read, mutation or store module enters the client bundle for a value import.
import { isOutcome, isReadResult, unavailable, type ReadResult } from "@/modules/data-service/outcome";
import { pagePreviewKey, pagesPrefix } from "./page-query-keys";
/** What a surface supplies to preview one acknowledged revision of one Page edition. */
export interface PagePreviewParams {
  /** The Page the edition belongs to. It places the preview beneath that page in the cache, so a change to the page re-reads its previews; the read resolves the edition itself, so the id is never sent as a request parameter. */
  readonly documentId: string;
  /** The locale edition being previewed — the edition, not the language: two editions of one Page are two previews. */
  readonly variantId: string;
  /** The revision the surface has on screen. A reviewer names the frozen candidate revision, and the author names the draft revision being edited; leaving it out states no acknowledgement, so no preview is requested rather than a newer revision being shown. */
  readonly revisionId?: string;
  /** The frozen candidate a reviewer previews, when the surface holds one. A reviewer's preview of a submitted candidate is admitted only when both the revision and the candidate that froze it are named. */
  readonly candidateId?: string;
  /** The language the preview is read in, sent as the read's `requestedLocale`. A tag the edition does not serve is answered as a denial rather than as another edition's content. */
  readonly locale?: string;
}
/** The service's own preview envelope type, taken from the read's signature rather than restated: a member the service adds, renames or withdraws reaches this module as a compile error instead of drifting. */
type ServicePreviewEnvelope = Extract<Awaited<ReturnType<typeof reads.pages.readPreview>>, { kind: "envelope" }>["envelope"];
/** The preview payload the service's authorised decision supplies: the rendered revision, the language and direction it is read in, the admitted rendition ids, and inertness stated as a literal — `givingAction` cannot hold any value but `"none"`, so no caller can offer a give action from a preview by mistake. */
export type PagePreviewData = ServicePreviewEnvelope["data"];
/** The scoped envelope a preview surface renders once it has narrowed the result to `envelope`. */
export type PagePreviewEnvelope = ReadEnvelope<PagePreviewData>;
/** What this read answers with: the envelope, the service's denial, the source that could not answer, or the request it does not admit. */
export type PagePreviewReadResult = ReadResult<PagePreviewEnvelope>;
// The transport
const PREVIEW_ENDPOINT = "/api/pages/preview";
// A read carries no caller-supplied operation id, so a refusal names the one attempt every read transport names.
const READ_ATTEMPT_ID = "read";
const HANDLER_SOURCE_SYSTEM = "data-service";
const PARAM = { variantId: "variantId", revisionId: "revisionId", candidateId: "candidateId", requestedLocale: "requestedLocale" } as const;
const ENVELOPE_STATUS = 200;
const DENIED_STATUS = 403;
/** A session that expired or could not be established answers 401 with the same denial, which is a session fault rather than a permission refusal. */
const SESSION_FAULT_STATUS = 401;
const UNAVAILABLE_STATUS = 503;

/** A parameter this read does not admit answers 422 with the field-keyed refusal, which is the request's own fault and not a source that did not answer. */
const REFUSED_STATUS = 422;
const NOT_REQUESTED = "not-requested";
const TRANSPORT_GUIDANCE = "The preview request did not complete, so this edition's preview is unavailable rather than empty. Open the preview again: each read re-authorises the exact revision it is asked for, so a retry never shows newer content.";
const UNREADABLE_GUIDANCE = "The preview request was answered with a body this read does not recognise, so the edition's preview is reported unavailable rather than rendered as an empty page.";
const INCOMPLETE_GUIDANCE = "No preview was requested: a preview renders one acknowledged revision in one named language, so the edition, the revision on screen and the language have to be stated together.";
/** A request the transport can carry: the acknowledgement and the language the read is asked for are both known. */
interface RequestablePreview extends PagePreviewParams {
  readonly revisionId: string;
  readonly locale: string;
}
function isRequestable(params: PagePreviewParams | undefined): params is RequestablePreview {
  return Boolean(params?.documentId && params?.variantId && params?.revisionId && params?.locale);
}
/** The outage a caller is shown when nothing could be read: the handler path is the source reference, and it names no record. */
function outage(guidance: string): PagePreviewReadResult {
  return { kind: "unavailable", unavailable: unavailable({ operationId: READ_ATTEMPT_ID, source: { system: HANDLER_SOURCE_SYSTEM, reference: PREVIEW_ENDPOINT }, guidance }) };
}
function previewUrl(params: RequestablePreview): string {
  // `URLSearchParams` percent-encodes every value, so a tag, an identifier or a name that carries a separator
  // reaches the read as itself; an absent optional parameter is omitted rather than sent as `undefined`.
  const query = new URLSearchParams();
  query.set(PARAM.variantId, params.variantId);
  query.set(PARAM.revisionId, params.revisionId);
  if (params.candidateId !== undefined) {
    query.set(PARAM.candidateId, params.candidateId);
  }
  query.set(PARAM.requestedLocale, params.locale);
  return `${PREVIEW_ENDPOINT}?${query.toString()}`;
}
/** The read result a response states, or `undefined` when its body is not one. The service's own guards make that decision, so the envelope's shape is never restated here. */
function resultOf(status: number, body: unknown): PagePreviewReadResult | undefined {
  switch (status) {
    case ENVELOPE_STATUS: {
      // The handler answers an envelope with the envelope itself, so the read result is assembled around it and
      // confirmed by the service's guard. The payload's inner shape is the service read's own type: a browser
      // that re-validated it field by field would be a second description of a contract it does not own.
      const result: PagePreviewReadResult = { kind: "envelope", envelope: body as PagePreviewEnvelope };
      return isReadResult(result) ? result : undefined;
    }
    case DENIED_STATUS:
    case SESSION_FAULT_STATUS:
      // A denial is a legitimate answer and is returned as the service sent it, never resolved into an empty
      // preview, a placeholder page or an invented draft.
      return isOutcome(body) && body.outcome === "denied" ? { kind: "denied", denied: body } : undefined;
    case UNAVAILABLE_STATUS:
      return isOutcome(body) && body.outcome === "unavailable" ? { kind: "unavailable", unavailable: body } : undefined;
    case REFUSED_STATUS:
      // The request named a parameter this read does not take, or named one in a form it does not admit:
      // the field-keyed refusal is the answer, and no source behind the preview failed.
      return isOutcome(body) && body.outcome === "invalid" ? { kind: "refused", refused: body } : undefined;
    default:
      return undefined;
  }
}
async function readJsonBody(answer: Response): Promise<unknown> {
  try {
    return await answer.json();
  } catch {
    return undefined;
  }
}
async function requestPreview(params: RequestablePreview): Promise<PagePreviewReadResult> {
  let answer: Response;
  try {
    answer = await fetch(previewUrl(params), { method: "GET", credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
  } catch {
    return outage(TRANSPORT_GUIDANCE);
  }
  const body = await readJsonBody(answer);
  return resultOf(answer.status, body) ?? outage(UNREADABLE_GUIDANCE);
}
function previewKey(scope: Scope, requestable: RequestablePreview): readonly unknown[] {
  const stated = pagePreviewKey(scope, requestable);
  // A query key names every variable its function reads, and the shared page-preview key names the page, the
  // edition, the revision and the language but not the candidate — so the candidate extends the key here rather
  // than being left out of it, and two candidates of one edition stay two cache entries.
  return requestable.candidateId === undefined ? stated : [...stated, requestable.candidateId];
}
/** Reads the exact, currently authorised, inert preview of one acknowledged Page revision; returns the server-produced HTML envelope or the service's `denied`/`unavailable` outcome. */
export function usePagePreview(scope: Scope, params: PagePreviewParams | undefined): UseQueryResult<PagePreviewReadResult, never> {
  // Nothing is requested until the acknowledgement is complete: an incomplete request would be answered as a
  // malformed one, and reporting that as a source outage would be a false statement about the source. A preview
  // that was not asked for is not a preview of anything, so the query stays disabled instead of resolving to an
  // empty page.
  const requestable = isRequestable(params) ? params : undefined;
  return useQuery<PagePreviewReadResult, never>({
    queryKey: requestable === undefined ? [...pagesPrefix(scope), "preview", NOT_REQUESTED] : previewKey(scope, requestable),
    queryFn: () => (requestable === undefined ? Promise.resolve(outage(INCOMPLETE_GUIDANCE)) : requestPreview(requestable)),
    enabled: requestable !== undefined,
    // A refusal is an answer, so nothing is retried: a retry of a denial, a withdrawal or a withheld revision
    // could only be a second attempt to obtain what the read has already refused.
    retry: false,
  });
}
