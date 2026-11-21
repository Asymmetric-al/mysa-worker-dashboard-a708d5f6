"use client";
/**
 * The Worker and Project Pages family's one Page read: the client half of `reads.pages.readPage`, whose
 * outcome set is `envelope | denied | unavailable`.
 *
 * **What it carries.** One Page as its builder works on it: the document identity and family, the fields a
 * source locks with the reason for each, the giving-binding reference untouched, the ordered sections of the
 * edition being composed (element, plain-text fields, admitted presentation choice, direction and media
 * placements), every locale edition with its own draft, candidate and release pointers, the reach values, and
 * the envelope's advisory `actions`. Draft, candidate and release stay three separate members: no lifecycle
 * word is computed here, because that mapping belongs to `components/draft-status`.
 *
 * **Why the payload type is derived.** `PageDetailData` is taken from the service read itself rather than
 * restated, so a member added to, renamed in or removed from the read's own payload fails typecheck at every
 * use instead of drifting into a second contract — one read, one shape, no wrapper module.
 *
 * **Why the key is the family's covering prefix.** `pageKey` sits under the Page's own prefix, so any accepted
 * answer about this page — a section move, a draft save, a review, a release, a reach change, a withdrawal —
 * invalidates this read through the one key factory the family owns and the builder re-reads. Nothing here
 * mirrors the page in local state: there is no second owner to disagree with the store, and a mutation result
 * is never merged into an envelope this hook did not produce.
 *
 * **Why the body is guarded.** `toResponse` answers a read as the envelope itself (200), the denial (403) or
 * the outage (503), so the body rather than the status is what this module reads. A body that is not this
 * Page's envelope — a denial, an outage, an envelope of another family, a section whose presentation choice
 * lies outside the admitted set — becomes `unavailable` with the handler named as its opaque source. Never an
 * empty builder, never a synthetic draft, never a lifecycle inferred from a missing member.
 *
 * **What it never reads.** No clock (`asOf` is the envelope's), no money and no percentage (the giving binding
 * is another read and its reference passes through untouched), no permission of its own: the envelope's
 * `actions` are advisory, and the service re-checks authority on submit, so an action listed once is not
 * authority this hook may cache, widen or hide behind.
 *
 * **Layering.** `features/ministry-pages → modules/data-service (contract types and the outcome module) →
 * modules/content/document → lib`. It imports no store, no other feature, no component and no framework
 * module, so it is safe in the browser bundle.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { isRecord } from "@/lib/guards";
import { PRESENTATION_CHOICES, type PresentationChoice } from "@/modules/content/document";
import type { ReadEnvelope, Scope, reads } from "@/modules/data-service";
// The outcome module rather than the service barrel: this is a browser module, and a value import of the
// barrel would pull every read, every mutation and the store into the client bundle. The two guards and the
// `unavailable` constructor are owned there and imported rather than restated, so a changed outcome shape
// reaches this file as a compile error instead of drifting.
import { isOutcome, isReadResult, unavailable, type ReadResult } from "@/modules/data-service/outcome";
import { pageKey } from "./page-query-keys";

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** The family's handler (AAP 0.6.3): the four Page reads and its edition-level writes. */
const PAGES_ENDPOINT = "/api/pages";

/** The one view this hook asks that handler for; the catalogues, the editions list and the giving binding belong to their own hooks. */
const PAGE_VIEW = "page";

/**
 * The source system an outage this module builds names.
 *
 * It is the handler, not the local store, because the request can fail before the service runs and naming the
 * store would claim knowledge of where the failure happened. An opaque reference only: it is displayed as
 * text and never parsed.
 */
const HANDLER_SOURCE_SYSTEM = "data-service";

/**
 * The marker a failed read carries where a mutation carries its operation id.
 *
 * A `GET` performs no effect, so it has no operation to name and mints no identifier: `"read"` is the same
 * non-unique attempt marker every read refusal in the service already carries, which keeps a failed read from
 * being mistaken for a change someone could replay.
 */
const READ_ATTEMPT = "read";

/**
 * What a read nobody asked for is keyed by.
 *
 * A builder with no document identifier stays idle (`enabled` is false), so this value is never requested and
 * never cached as a page: an empty string is a key with nothing under it, not a draft.
 */
const NO_DOCUMENT = "";

/** Why a request that produced no usable answer could not be read, stated for the reader's next step. */
const TRANSPORT_GUIDANCE =
  "The Page read did not complete, so this builder has no document, no edition and no lock to show. Retry the same read: the builder shows the draft and the editions it was given, and an outage is never presented as an empty page.";

// ---------------------------------------------------------------------------------------------
// The payload and its result
// ---------------------------------------------------------------------------------------------

/** What `reads.pages.readPage` answers, taken from the read rather than restated. */
type PageReadAnswer = Awaited<ReturnType<typeof reads.pages.readPage>>;

/** The Page one builder works on, exactly as the read's envelope carries it: document, locked fields, sections, editions and reach values. */
export type PageDetailData = Extract<PageReadAnswer, { readonly kind: "envelope" }>["envelope"]["data"];

/** The scoped envelope a builder renders once it has narrowed the result to `envelope`. */
export type PageEnvelope = ReadEnvelope<PageDetailData>;

/** What this read answers for one Page: an envelope, the denial it was given, or an unavailable source. */
export type PageReadResult = ReadResult<PageEnvelope>;

// ---------------------------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------------------------

/**
 * Reads one Page: its document, per-edition draft/candidate/release, sections with fields and placements,
 * managed lock reasons, and the advisory actions; returns an envelope or a `denied`/`unavailable` outcome.
 */
export function usePage(scope: Scope, documentId: string | undefined): UseQueryResult<PageReadResult, never> {
  const requestedId = documentId ?? NO_DOCUMENT;
  return useQuery<PageReadResult, never>({
    // The family's covering prefix: any accepted answer about this page invalidates it, so the builder re-reads
    // rather than patching its own copy of the page.
    queryKey: pageKey(scope, requestedId),
    queryFn: () => readPageAnswer(requestedId),
    // A builder given no document identifier invents nothing: the query stays idle, so no request is sent and no
    // draft or empty page can stand in for one nobody named.
    enabled: Boolean(documentId),
    // An outage is an answer this read states, not a moment to ask again: a retry loop would turn one
    // unavailable source into a stream of requests and still leave the builder with nothing to show.
    retry: false,
  });
}

// ---------------------------------------------------------------------------------------------
// The transport
// ---------------------------------------------------------------------------------------------

/** The one request path this hook issues, with the Page's identifier encoded rather than interpolated raw. */
function pageRequestPath(documentId: string): string {
  return `${PAGES_ENDPOINT}?view=${PAGE_VIEW}&documentId=${encodeURIComponent(documentId)}`;
}

/** The parsed JSON body, or `undefined` when the body is absent or is not JSON. */
async function readJsonBody(answer: Response): Promise<unknown> {
  try {
    return await answer.json();
  } catch {
    return undefined;
  }
}

/** The outage this module states for a request that produced no usable answer: no count, no empty collection and no draft. */
function transportOutage(): PageReadResult {
  return {
    kind: "unavailable",
    unavailable: unavailable({
      operationId: READ_ATTEMPT,
      source: { system: HANDLER_SOURCE_SYSTEM, reference: PAGES_ENDPOINT },
      guidance: TRANSPORT_GUIDANCE,
    }),
  };
}

/**
 * Reads the handler and narrows its answer to the three this read states.
 *
 * The answer arrives either as the service's own `ReadResult` (in process, and through a handler that passes
 * it on unchanged) or in the flattened form `toResponse` writes onto the wire; both are read here, so the
 * hook's contract does not depend on which of the two a handler chose.
 */
async function readPageAnswer(documentId: string): Promise<PageReadResult> {
  let answer: Response;
  try {
    answer = await fetch(pageRequestPath(documentId), {
      method: "GET",
      // The answer is derived from this session's development cookie on every request, so a stored copy would
      // serve one session's page — or one context's authority — to another.
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
  } catch {
    return transportOutage();
  }
  const body = await readJsonBody(answer);
  const wrapped = wrappedReadResult(body);
  if (wrapped !== undefined) {
    return wrapped;
  }
  if (isPageEnvelope(body)) {
    return { kind: "envelope", envelope: body };
  }
  if (isOutcome(body) && body.outcome === "denied") {
    return { kind: "denied", denied: body };
  }
  if (isOutcome(body) && body.outcome === "unavailable") {
    return { kind: "unavailable", unavailable: body };
  }
  return transportOutage();
}

/** The answer when the body is already a `ReadResult`, narrowed the same way; `undefined` when the body is not one. */
function wrappedReadResult(body: unknown): PageReadResult | undefined {
  if (!isReadResult(body)) {
    return undefined;
  }
  switch (body.kind) {
    case "envelope":
      return isPageEnvelope(body.envelope) ? { kind: "envelope", envelope: body.envelope } : transportOutage();
    case "denied":
      return { kind: "denied", denied: body.denied };
    case "unavailable":
      return { kind: "unavailable", unavailable: body.unavailable };
  }
}

// ---------------------------------------------------------------------------------------------
// Shape guards
//
// The service owns every value in the envelope, so only shape is checked — but the members the builder acts
// on are checked, because a missing revision would break the `expectedRevision` a save must present, a missing
// `asOf` would leave the surface unable to say when it read, and a presentation choice outside the admitted
// set is a composition the content profile never allowed.
// ---------------------------------------------------------------------------------------------

/** The four closed sets, named once by the content profile as {@link PRESENTATION_CHOICES}. */
const ADMITTED_PRESENTATION: Readonly<Record<keyof PresentationChoice, readonly string[]>> = PRESENTATION_CHOICES;

/** Whether a candidate is one of the strings an admitted set names. */
function admits(admitted: readonly string[], candidate: unknown): boolean {
  return typeof candidate === "string" && admitted.includes(candidate);
}

/** Whether a value carries one of the four bounded presentation choices, each drawn from its own admitted set. */
function isAdmittedPresentation(value: unknown): value is PresentationChoice {
  if (!isRecord(value)) {
    return false;
  }
  return (
    admits(ADMITTED_PRESENTATION.treatment, value.treatment) &&
    admits(ADMITTED_PRESENTATION.layout, value.layout) &&
    admits(ADMITTED_PRESENTATION.alignment, value.alignment) &&
    admits(ADMITTED_PRESENTATION.imageFit, value.imageFit)
  );
}

/** Whether a value is a string. */
function isText(value: unknown): boolean {
  return typeof value === "string";
}

/** Whether an edition's pointer is absent (`null`) or names a record: a draft, a candidate and a release are each one of these, and none stands in for another. */
function isPointer(value: unknown): boolean {
  return value === null || typeof value === "string";
}

/** Whether one field a source owns is stated as locked with the reason it carries, rather than hidden. */
function isManagedField(value: unknown): boolean {
  return isRecord(value) && typeof value.key === "string" && value.locked === true && typeof value.lockReasonKey === "string";
}

/** Whether one composed section carries its element, plain-text fields, admitted presentation, placements and — when managed — the lock reason that explains it. */
function isSection(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const statesLock = value.managed !== true || typeof value.lockReasonKey === "string";
  return (
    typeof value.position === "number" &&
    typeof value.element === "string" &&
    typeof value.inCatalogue === "boolean" &&
    isRecord(value.fields) &&
    isAdmittedPresentation(value.presentation) &&
    Array.isArray(value.placements) &&
    (value.direction === null || typeof value.direction === "string") &&
    statesLock
  );
}

/** Whether one locale edition states its own three pointers, its exact locale and its record revision. */
function isEdition(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.variantId === "string" &&
    typeof value.audience === "string" &&
    isRecord(value.locale) &&
    typeof value.locale.tag === "string" &&
    isPointer(value.draftRevisionId) &&
    isPointer(value.candidateId) &&
    isPointer(value.releaseHeadId) &&
    typeof value.recordRevision === "string"
  );
}

/** Whether one advisory action is named and flagged; its reason, when it is unavailable, is stated by the service. */
function isReadAction(value: unknown): boolean {
  return isRecord(value) && typeof value.name === "string" && typeof value.available === "boolean";
}

/** Whether a value is the `data` member of this Page's envelope: the whole of what the builder renders. */
function isPageData(value: unknown): value is PageDetailData {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isRecord(value.document) &&
    typeof value.document.documentId === "string" &&
    typeof value.family === "string" &&
    typeof value.kind === "string" &&
    Array.isArray(value.managedFields) &&
    value.managedFields.every(isManagedField) &&
    (value.givingBinding === null || isRecord(value.givingBinding)) &&
    (value.draft === null || isRecord(value.draft)) &&
    Array.isArray(value.sections) &&
    value.sections.every(isSection) &&
    Array.isArray(value.editions) &&
    value.editions.every(isEdition) &&
    Array.isArray(value.reachOptions) &&
    value.reachOptions.every(isText) &&
    Array.isArray(value.presets)
  );
}

/** Whether a body is this Page's read envelope: the payload plus the authority, revision, as-of instant and advisory actions a builder presents. */
function isPageEnvelope(value: unknown): value is PageEnvelope {
  return (
    isRecord(value) &&
    isPageData(value.data) &&
    isRecord(value.scope) &&
    isRecord(value.source) &&
    typeof value.revision === "string" &&
    typeof value.asOf === "string" &&
    isRecord(value.coverage) &&
    isRecord(value.valueStates) &&
    Array.isArray(value.actions) &&
    value.actions.every(isReadAction)
  );
}
