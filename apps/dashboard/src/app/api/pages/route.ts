/**
 * The Worker and Project Pages family's own reads and its two edition-level writes: `GET /api/pages`
 * and `POST /api/pages`.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertNever } from "@/lib/result";
import { mutationInputSchema, mutations, outcomeFromError, reads, toResponse, type MutationInput, type MutationOutcome } from "@/modules/data-service";
import { sessionIdOf } from "../session-cookie";
// The store writes through node:fs, so this handler never runs on the edge runtime.
export const runtime = "nodejs";
// Every method resolves the development session and the scenario clock per request, so a catalogue,
// reach or giving answer is never cached across a restriction, a withdrawal or a persona switch.
export const dynamic = "force-dynamic";

const READ_ATTEMPT_ID = "read";

const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

const MESSAGES = {
  viewRequired: "Say what this request reads as view: catalogues, documents, page, locales or giving-binding.",
  documentRequired: "Name the Page this request reads as documentId.",
  requestedLocaleInvalid: "A requested language is a language tag such as en or ar; leave it out to read the editions as they stand.",
  releaseInvalid: "A release is named by its opaque identifier; open the edition from its locale list instead of typing one.",
  operationRequired: "State which change this request makes as payload.operation: createVariant or saveDraft.",
  bodyNotJson: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
} as const;

// Reads — the five named Page reads, chosen by the one required query parameter
const READ_VIEWS = ["catalogues", "documents", "page", "locales", "giving-binding"] as const;

// The two Page families this path lists. A Page is one of these two families and never an Update, so
// the family set is the handler's decision and never a query parameter's.
const PAGE_FAMILIES = ["worker-page", "project-page"] as const;

const viewTargetSchema = z.object({
  view: z.enum(READ_VIEWS, { error: MESSAGES.viewRequired }),
});

// A Page is one document, and the family, its cache keys and the giving binding all name it
// `documentId`; the two Page reads below declare the same identifier as `pageId`, so the request
// carries the family's one word and it is translated once at the call.
const documentTargetSchema = z.object({
  documentId: z.string({ error: MESSAGES.documentRequired }).trim().min(1, MESSAGES.documentRequired),
});

const localeTargetSchema = documentTargetSchema.extend({
  requestedLocale: z.string({ error: MESSAGES.requestedLocaleInvalid }).trim().min(1, MESSAGES.requestedLocaleInvalid).optional(),
});

const givingBindingTargetSchema = documentTargetSchema.extend({
  releaseId: z.string({ error: MESSAGES.releaseInvalid }).trim().min(1, MESSAGES.releaseInvalid).optional(),
});

function parameterOf(params: URLSearchParams, name: string): string | undefined {
  const value = params.get(name);
  return value === null ? undefined : value;
}

/**
 * Answers the selected read with the service's own result: a denial stays a denial with no count,
 * title, existence flag or size, and a source that is down stays `unavailable` rather than becoming
 * an empty list or a zero.
 */
async function routeRead(params: URLSearchParams): Promise<Response> {
  const view = viewTargetSchema.safeParse({ view: parameterOf(params, "view") });
  if (!view.success) {
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, view.error));
  }
  const documentId = parameterOf(params, "documentId");
  switch (view.data.view) {
    case "catalogues":
      // The two guided families and, per family, the admitted section types and their bounded
      // presentation choices: whatever the read answers is the whole admissible set.
      return toResponse(await reads.pages.readPageCatalogues());
    case "documents":
      // The admitted Pages themselves, each with its title, every edition's own draft, candidate and
      // release state and the editions waiting for a release: the list the Pages surface opens on,
      // and never an Update, whose family this handler does not name.
      return toResponse(await reads.pages.findContentDocuments({ families: PAGE_FAMILIES }));
    case "page": {
      const target = documentTargetSchema.safeParse({ documentId });
      if (!target.success) {
        return toResponse(outcomeFromError(READ_ATTEMPT_ID, target.error));
      }
      return toResponse(await reads.pages.readPage({ pageId: target.data.documentId }));
    }
    case "locales": {
      const target = localeTargetSchema.safeParse({ documentId, requestedLocale: parameterOf(params, "requestedLocale") });
      if (!target.success) {
        return toResponse(outcomeFromError(READ_ATTEMPT_ID, target.error));
      }
      const { requestedLocale } = target.data;
      return toResponse(
        await reads.pages.readPageLocales({
          pageId: target.data.documentId,
          ...(requestedLocale === undefined ? {} : { requestedLocale }),
        }),
      );
    }
    case "giving-binding": {
      const target = givingBindingTargetSchema.safeParse({ documentId, releaseId: parameterOf(params, "releaseId") });
      if (!target.success) {
        return toResponse(outcomeFromError(READ_ATTEMPT_ID, target.error));
      }
      const { releaseId } = target.data;
      // One approved Designation, or *Giving unavailable* with its cause: the read's own value
      // states are the answer, and no fallback fund, default designation or zero is substituted here.
      return toResponse(
        await reads.pages.readGivingBinding({
          documentId: target.data.documentId,
          ...(releaseId === undefined ? {} : { releaseId }),
        }),
      );
    }
    default:
      // Unreachable: the five names above are the closed set the view schema admits, so a sixth read
      // fails to compile at this call instead of reaching the runtime.
      return assertNever(view.data.view, "Unhandled Page read");
  }
}

/** One of the five named Page reads — `catalogues`, `documents`, `page`, `locales` or `giving-binding` — answered as its own read envelope, or as the denial or outage the read itself reports. */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    return await routeRead(new URL(request.url).searchParams);
  } catch (error) {
    // One mapper knows the difference between a store outage and a session that cannot be
    // established, so a thrown fault is answered rather than escaping the boundary.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}

// Writes — the two named edition mutations, chosen by one discriminant
type CreateVariantPayload = Parameters<typeof mutations.pages.createVariant>[1]["payload"];

type SaveDraftPayload = Parameters<typeof mutations.pages.saveDraft>[1]["payload"];

type Routed<P> = P & { readonly operation: string };

/**
 * The transport adds exactly one member to a payload — `operation`, which names the named mutation —
 * and strips it before the request reaches the service. Every other member is the mutation's own: the
 * strict schema that judges a document body, a locale tag or a family's admitted audience is the
 * service's, so each of those rules exists once and a refusal arrives already keyed by field.
 */
const createVariantBodySchema = mutationInputSchema(z.custom<Routed<CreateVariantPayload>>());

const saveDraftBodySchema = mutationInputSchema(z.custom<Routed<SaveDraftPayload>>());

// The Pages row of the API table names `saveDraft` beside `createVariant`, so this family's transport
// serves the edition write its own editor makes; the Updates row is served the same named mutation on
// `api/drafts`, so one mutation has one implementation and both rows the plan names stay reachable.
const PAGE_OPERATIONS = ["createVariant", "saveDraft"] as const;

const attemptIdentitySchema = z.object({ operationId: z.string() });

// The mutation envelope is a strict object with exactly four members, so the discriminant travels
// inside `payload`, where the one schema every named mutation shares cannot mistake it for a field.
const discriminantSchema = z.object(
  {
    payload: z.object({ operation: z.enum(PAGE_OPERATIONS, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.operationRequired }),
  },
  { error: MESSAGES.bodyNotJson },
);

async function jsonBodyOf(request: Request): Promise<unknown> {
  try {
    const body: unknown = await request.json();
    return body;
  } catch {
    return undefined;
  }
}

function operationIdentityOf(raw: unknown): string {
  const identity = attemptIdentitySchema.safeParse(raw);
  return identity.success && identity.data.operationId.length > 0 ? identity.data.operationId : UNIDENTIFIED_ATTEMPT;
}

function payloadOf<T extends { readonly operation: string }>(payload: T): Omit<T, "operation"> {
  const { operation: _discriminant, ...forwarded } = payload;
  return forwarded;
}

async function dispatch<P extends { readonly operation: string }>(
  schema: z.ZodType<MutationInput<P>>,
  raw: unknown,
  operationId: string,
  run: (input: MutationInput<Omit<P, "operation">>) => Promise<MutationOutcome>,
): Promise<Response> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return toResponse(outcomeFromError(operationId, parsed.error));
  }
  try {
    return toResponse(await run({ ...parsed.data, payload: payloadOf(parsed.data.payload) }));
  } catch (error) {
    // An exception here is a defect rather than a presentation: the service answers refusals as
    // outcomes, so a throw means a store fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(operationId, error));
  }
}

/** One named edition mutation — `createVariant` or `saveDraft` — selected by `payload.operation`, answered as exactly one of the eight outcomes under the caller's own operation id. */
export async function POST(request: NextRequest): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const operationId = operationIdentityOf(raw);
  const sessionId = sessionIdOf(request);
  const claimed = discriminantSchema.safeParse(raw);
  if (!claimed.success) {
    return toResponse(outcomeFromError(operationId, claimed.error));
  }
  switch (claimed.data.payload.operation) {
    case "createVariant":
      return dispatch(createVariantBodySchema, raw, operationId, (input) => mutations.pages.createVariant(sessionId, input));
    case "saveDraft":
      return dispatch(saveDraftBodySchema, raw, operationId, (input) => mutations.pages.saveDraft(sessionId, input));
    default:
      // Unreachable: the two names above are the closed set the discriminant schema admits, so a third
      // mutation fails to compile at this call instead of reaching the runtime.
      return assertNever(claimed.data.payload.operation, "Unhandled page edition mutation");
  }
}
