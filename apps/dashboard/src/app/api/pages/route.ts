import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertNever } from "@/lib/result";
import { mutationInputSchema, mutations, outcomeFromError, reads, refusedRead, toResponse } from "@/modules/data-service";
import { claimedWriteRoute, dispatch, type ClaimedWrite } from "../handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const READ_ATTEMPT_ID = "read";
const MESSAGES = {
  viewRequired: "Say what this request reads as view: catalogues, documents, page, locales or giving-binding.",
  documentRequired: "Name the Page this request reads as documentId.",
  requestedLocaleInvalid: "A requested language is a language tag such as en or ar; leave it out to read the editions as they stand.",
  releaseInvalid: "A release is named by its opaque identifier; open the edition from its locale list instead of typing one.",
  operationRequired: "State which change this request makes as payload.operation: createVariant or saveDraft.",
  bodyNotJson: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
} as const;
const READ_VIEWS = ["catalogues", "documents", "page", "locales", "giving-binding"] as const;
const PAGE_FAMILIES = ["worker-page", "project-page"] as const;
const viewTargetSchema = z.object({ view: z.enum(READ_VIEWS, { error: MESSAGES.viewRequired }) });
const documentTargetSchema = z.object({ documentId: z.string({ error: MESSAGES.documentRequired }).trim().min(1, MESSAGES.documentRequired) });
const localeTargetSchema = documentTargetSchema.extend({ requestedLocale: z.string({ error: MESSAGES.requestedLocaleInvalid }).trim().min(1, MESSAGES.requestedLocaleInvalid).optional() });
const givingBindingTargetSchema = documentTargetSchema.extend({ releaseId: z.string({ error: MESSAGES.releaseInvalid }).trim().min(1, MESSAGES.releaseInvalid).optional() });
function parameterOf(params: URLSearchParams, name: string): string | undefined {
  const value = params.get(name);
  return value === null ? undefined : value;
}
async function routeRead(params: URLSearchParams): Promise<Response> {
  const view = viewTargetSchema.safeParse({ view: parameterOf(params, "view") });
  if (!view.success) return toResponse(refusedRead(READ_ATTEMPT_ID, view.error));
  const documentId = parameterOf(params, "documentId");
  switch (view.data.view) {
    case "catalogues":
      return toResponse(await reads.pages.readPageCatalogues());
    case "documents":
      return toResponse(await reads.pages.findContentDocuments({ families: PAGE_FAMILIES }));
    case "page": {
      const target = documentTargetSchema.safeParse({ documentId });
      if (!target.success) return toResponse(refusedRead(READ_ATTEMPT_ID, target.error));
      return toResponse(await reads.pages.readPage({ pageId: target.data.documentId }));
    }
    case "locales": {
      const target = localeTargetSchema.safeParse({ documentId, requestedLocale: parameterOf(params, "requestedLocale") });
      if (!target.success) return toResponse(refusedRead(READ_ATTEMPT_ID, target.error));
      const { requestedLocale } = target.data;
      return toResponse(await reads.pages.readPageLocales({ pageId: target.data.documentId, ...(requestedLocale === undefined ? {} : { requestedLocale }) }));
    }
    case "giving-binding": {
      const target = givingBindingTargetSchema.safeParse({ documentId, releaseId: parameterOf(params, "releaseId") });
      if (!target.success) return toResponse(refusedRead(READ_ATTEMPT_ID, target.error));
      const { releaseId } = target.data;
      return toResponse(await reads.pages.readGivingBinding({ documentId: target.data.documentId, ...(releaseId === undefined ? {} : { releaseId }) }));
    }
    default:
      return assertNever(view.data.view, "Unhandled Page read");
  }
}
/** One of the five named Page reads — `catalogues`, `documents`, `page`, `locales` or `giving-binding` — answered as its own read envelope, or as the denial or outage the read itself reports. */
export const GET = (request: NextRequest): Promise<Response> => routeRead(new URL(request.url).searchParams).catch((error: unknown) => toResponse(outcomeFromError(READ_ATTEMPT_ID, error)));
type CreateVariantPayload = Parameters<typeof mutations.pages.createVariant>[1]["payload"];
type SaveDraftPayload = Parameters<typeof mutations.pages.saveDraft>[1]["payload"];
type Routed<P> = P & { readonly operation: string };
const createVariantBodySchema = mutationInputSchema(z.custom<Routed<CreateVariantPayload>>());
const saveDraftBodySchema = mutationInputSchema(z.custom<Routed<SaveDraftPayload>>());
const PAGE_OPERATIONS = ["createVariant", "saveDraft"] as const;
type PageOperation = (typeof PAGE_OPERATIONS)[number];
const discriminantSchema = z.object({ payload: z.object({ operation: z.enum(PAGE_OPERATIONS, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.bodyNotJson });
const WRITES = {
  createVariant: (raw, { operationId, sessionId }) => dispatch(createVariantBodySchema, raw, operationId, "operation", (input) => mutations.pages.createVariant(sessionId, input)),
  saveDraft: (raw, { operationId, sessionId }) => dispatch(saveDraftBodySchema, raw, operationId, "operation", (input) => mutations.pages.saveDraft(sessionId, input)),
} satisfies Readonly<Record<PageOperation, ClaimedWrite>>;
/** One named edition mutation — `createVariant` or `saveDraft` — selected by `payload.operation`, answered as exactly one of the eight outcomes under the caller's own operation id. */
export const POST = (request: NextRequest): Promise<Response> => claimedWriteRoute(request, discriminantSchema, (claim) => claim.payload.operation, WRITES);
