"use client";
import { isNonEmptyString, isRecord } from "@/lib/guards";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseQueryResult, QueryClient } from "@tanstack/react-query";
import { fetchReadOrOutage } from "@/lib/read-transport";
import { PRESENTATION_CHOICES } from "@/modules/content/document";
import type { PresentationChoice } from "@/modules/content/document";
import type { ReadEnvelope, Scope, reads } from "@/modules/data-service";
import { sameScope } from "@/modules/data-service/envelope";
import { unavailable } from "@/modules/data-service/outcome";
import type { ReadResult } from "@/modules/data-service/outcome";
import { pageKey, pageLocalesKey, pageCataloguesKey, pagePreviewKey, pagesPrefix, givingBindingKey } from "./page-query-keys";
import { useCallback, useRef, useSyncExternalStore } from "react";
const PAGES_ENDPOINT = "/api/pages";
const PAGE_TRANSPORT_GUIDANCE = "The Page read did not complete, so this builder has no document, no edition and no lock to show. Retry the same read: the builder shows the draft and the editions it was given, and an outage is never presented as an empty page.";
/** The Page one builder works on, exactly as the read's envelope carries it: document, locked fields, sections, editions and reach values. */ export type PageDetailData = Extract<Awaited<ReturnType<typeof reads.pages.readPage>>, { readonly kind: "envelope" }>["envelope"]["data"];
export type PageEnvelope = ReadEnvelope<PageDetailData>;
export type PageReadResult = ReadResult<PageEnvelope>;
/** Reads one Page: its document, per-edition draft/candidate/release, sections with fields and placements, managed lock reasons, and the advisory actions; returns an envelope, a denial or an outage. */
export const usePage = (scope: Scope, documentId: string | undefined): UseQueryResult<PageReadResult, never> => useQuery<PageReadResult, never>({ queryKey: pageKey(scope, documentId ?? ""), queryFn: () => readPageAnswer(documentId ?? ""), enabled: Boolean(documentId), retry: false });
const pageRequestPath = (documentId: string): string => `${PAGES_ENDPOINT}?view=${"page"}&documentId=${encodeURIComponent(documentId)}`;
const readPageAnswer = async (documentId: string): Promise<PageReadResult> => fetchReadOrOutage<PageDetailData, PageEnvelope["coverage"]>({ url: pageRequestPath(documentId), admits: isPageData, source: { system: "data-service", reference: PAGES_ENDPOINT }, guidance: PAGE_TRANSPORT_GUIDANCE });
const ADMITTED_PRESENTATION: Readonly<Record<keyof PresentationChoice, readonly string[]>> = PRESENTATION_CHOICES;
const admits = (admitted: readonly string[], candidate: unknown): boolean => typeof candidate === "string" && admitted.includes(candidate);
const isAdmittedPresentation = (value: unknown): value is PresentationChoice =>
  isRecord(value) && admits(ADMITTED_PRESENTATION.treatment, value.treatment) && admits(ADMITTED_PRESENTATION.layout, value.layout) && admits(ADMITTED_PRESENTATION.alignment, value.alignment) && admits(ADMITTED_PRESENTATION.imageFit, value.imageFit);
const isPointer = (value: unknown): boolean => value === null || typeof value === "string";
const isManagedField = (value: unknown): boolean => isRecord(value) && typeof value.key === "string" && value.locked === true && typeof value.lockReasonKey === "string";
function isSection(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const statesLock = value.managed !== true || typeof value.lockReasonKey === "string";
  return typeof value.position === "number" && typeof value.element === "string" && typeof value.inCatalogue === "boolean" && isRecord(value.fields) && isAdmittedPresentation(value.presentation) && Array.isArray(value.placements) && (value.direction === null || typeof value.direction === "string") && statesLock;
}
function isEdition(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.variantId === "string" && typeof value.audience === "string" && isRecord(value.locale) && typeof value.locale.tag === "string" && isPointer(value.draftRevisionId) && isPointer(value.candidateId) && isPointer(value.releaseHeadId) && typeof value.recordRevision === "string";
}
function isPageData(value: unknown): value is PageDetailData {
  if (!isRecord(value)) return false;
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
    value.reachOptions.every((option: unknown) => typeof option === "string") &&
    Array.isArray(value.presets)
  );
}
const PAGES_READ_ENDPOINT = "/api/pages";
const TRANSPORT_SOURCE = { system: "browser-transport", reference: PAGES_READ_ENDPOINT } as const;
const LOCALES_TRANSPORT_GUIDANCE = "The request for this Page's language editions did not complete, so this list states nothing about which editions exist. Reading it changes nothing, so retrying the same read is safe.";
export type PageLocalesData = Extract<Awaited<ReturnType<typeof reads.pages.readPageLocales>>, { readonly kind: "envelope" }>["envelope"]["data"];
export type PageLocaleEdition = PageLocalesData["editions"][number];
export type PageLocalesEnvelope = ReadEnvelope<PageLocalesData>;
export type PageLocalesReadResult = ReadResult<PageLocalesEnvelope>;
function isPageLocalesData(value: unknown): value is PageLocalesData {
  if (!isRecord(value)) return false;
  const { document, requestedLocale, resolution, editions, admittedLocales } = value;
  return isRecord(document) && typeof requestedLocale === "string" && isRecord(resolution) && Array.isArray(editions) && Array.isArray(admittedLocales);
}
const requestPageLocales = async (documentId: string): Promise<PageLocalesReadResult> =>
  fetchReadOrOutage<PageLocalesData, PageLocalesEnvelope["coverage"]>({ url: `${PAGES_READ_ENDPOINT}?view=${"locales"}&documentId=${encodeURIComponent(documentId)}`, admits: isPageLocalesData, source: TRANSPORT_SOURCE, guidance: LOCALES_TRANSPORT_GUIDANCE });
/** Reads the admitted locale editions of one Page, each with its own draft/candidate/release and direction; returns an envelope or a `denied`/`unavailable` outcome. */
export const usePageLocales = (scope: Scope, documentId: string | undefined): UseQueryResult<PageLocalesReadResult, never> => useQuery<PageLocalesReadResult, never>({ queryKey: pageLocalesKey(scope, documentId ?? ""), queryFn: () => requestPageLocales(documentId ?? ""), enabled: Boolean(documentId), retry: false });
/** What `reads.pages.readPageCatalogues` answers, taken from the service so this hook cannot drift from it. */ export type PageCataloguesAnswer = Awaited<ReturnType<typeof reads.pages.readPageCatalogues>>;
export type PageCataloguesEnvelope = Extract<PageCataloguesAnswer, { readonly kind: "envelope" }>["envelope"];
/** The catalogue payload — two family catalogues, the admitted section types and their bounded presentation choices. Mirrors the service's payload, which remains authoritative for it. */ export type PageCataloguesData = PageCataloguesEnvelope["data"];
export type PageCataloguesRead = ReadResult<ReadEnvelope<PageCataloguesData>>;
const CATALOGUES_TRANSPORT_GUIDANCE = "Couldn’t load the page catalogues right now. Reload the page to try again.";
const isAdmittedValueSet = (value: unknown, admitted: readonly string[]): boolean => Array.isArray(value) && value.length > 0 && value.every((member: unknown) => typeof member === "string" && admitted.includes(member));
function isPresentationChoices(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isAdmittedValueSet(value["treatment"], PRESENTATION_CHOICES.treatment) && isAdmittedValueSet(value["layout"], PRESENTATION_CHOICES.layout) && isAdmittedValueSet(value["alignment"], PRESENTATION_CHOICES.alignment) && isAdmittedValueSet(value["imageFit"], PRESENTATION_CHOICES.imageFit);
}
function isCatalogueSection(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const lockReasonKey = value["lockReasonKey"];
  const fields = value["fields"];
  return (
    isNonEmptyString(value["key"]) && isNonEmptyString(value["labelKey"]) && typeof value["managed"] === "boolean" && (lockReasonKey === null || typeof lockReasonKey === "string") && Array.isArray(fields) && fields.every((field: unknown) => typeof field === "string") && isPresentationChoices(value["presentation"])
  );
}
function isCatalogue(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const sections = value["sections"];
  return isNonEmptyString(value["family"]) && isNonEmptyString(value["labelKey"]) && Array.isArray(sections) && sections.every(isCatalogueSection);
}
function isCatalogueData(value: unknown): value is PageCataloguesData {
  if (!isRecord(value)) return false;
  const catalogues = value["catalogues"];
  const structuralOperations = value["structuralOperations"];
  const presets = value["presets"];
  return Array.isArray(catalogues) && catalogues.length > 0 && catalogues.every(isCatalogue) && isPresentationChoices(value["presentation"]) && Array.isArray(structuralOperations) && structuralOperations.every((operation: unknown) => typeof operation === "string") && Array.isArray(presets);
}
const requestCatalogues = async (): Promise<PageCataloguesRead> => fetchReadOrOutage<PageCataloguesData>({ url: "/api/pages?view=catalogues", admits: isCatalogueData, source: { system: "data-service", reference: "/api/pages?view=catalogues" }, guidance: CATALOGUES_TRANSPORT_GUIDANCE });
/** Reads the two guided family catalogues in the given scope. */ export const usePageCatalogues = (scope: Scope): UseQueryResult<ReadResult<ReadEnvelope<PageCataloguesData>>, never> => useQuery<PageCataloguesRead, never>({ queryKey: pageCataloguesKey(scope), queryFn: requestCatalogues, retry: false });
/** The language the preview is read in, sent as the read's `requestedLocale`. A tag the edition does not serve is answered as a denial rather than as another edition's content. */
export type PagePreviewParams = { readonly documentId: string; readonly variantId: string; readonly revisionId?: string; readonly candidateId?: string; readonly locale?: string };
/** The preview payload the service's authorised decision supplies: the rendered revision, the language and direction it is read in, the admitted rendition ids, and inertness stated as a literal — `givingAction` cannot hold any value but `"none"`, so no caller can offer a give action from a preview by mistake. */
export type PagePreviewData = Extract<Awaited<ReturnType<typeof reads.pages.readPreview>>, { kind: "envelope" }>["envelope"]["data"];
export type PagePreviewEnvelope = ReadEnvelope<PagePreviewData>;
export type PagePreviewReadResult = ReadResult<PagePreviewEnvelope>;
const PREVIEW_ENDPOINT = "/api/pages/preview";
const HANDLER_SOURCE_SYSTEM = "data-service";
const PARAM = { variantId: "variantId", revisionId: "revisionId", candidateId: "candidateId", requestedLocale: "requestedLocale" } as const;
const PREVIEW_TRANSPORT_GUIDANCE = "The preview request did not complete, so this edition's preview is unavailable rather than empty. Open the preview again: each read re-authorises the exact revision it is asked for, so a retry never shows newer content.";
type RequestablePreview = PagePreviewParams & { readonly revisionId: string; readonly locale: string };
const isRequestable = (params: PagePreviewParams | undefined): params is RequestablePreview => Boolean(params?.documentId && params?.variantId && params?.revisionId && params?.locale);
const outage = (guidance: string): PagePreviewReadResult => ({ kind: "unavailable", unavailable: unavailable({ operationId: "read", source: { system: HANDLER_SOURCE_SYSTEM, reference: PREVIEW_ENDPOINT }, guidance }) });
function previewUrl(params: RequestablePreview): string {
  const query = new URLSearchParams();
  query.set(PARAM.variantId, params.variantId);
  query.set(PARAM.revisionId, params.revisionId);
  if (params.candidateId !== undefined) query.set(PARAM.candidateId, params.candidateId);
  query.set(PARAM.requestedLocale, params.locale);
  return `${PREVIEW_ENDPOINT}?${query.toString()}`;
}
const requestPreview = async (params: RequestablePreview): Promise<PagePreviewReadResult> => fetchReadOrOutage<PagePreviewData, PagePreviewEnvelope["coverage"]>({ url: previewUrl(params), admits: isRecord, source: { system: HANDLER_SOURCE_SYSTEM, reference: PREVIEW_ENDPOINT }, guidance: PREVIEW_TRANSPORT_GUIDANCE });
function previewKey(scope: Scope, requestable: RequestablePreview): readonly unknown[] {
  const stated = pagePreviewKey(scope, requestable);
  return requestable.candidateId === undefined ? stated : [...stated, requestable.candidateId];
}
/** Reads the exact, currently authorised, inert preview of one acknowledged Page revision; returns the server-produced HTML envelope or the service's `denied`/`unavailable` outcome. */ export function usePagePreview(scope: Scope, params: PagePreviewParams | undefined): UseQueryResult<PagePreviewReadResult, never> {
  const requestable = isRequestable(params) ? params : undefined;
  return useQuery<PagePreviewReadResult, never>({
    queryKey: requestable === undefined ? [...pagesPrefix(scope), "preview", "not-requested"] : previewKey(scope, requestable),
    queryFn: () => (requestable === undefined ? Promise.resolve(outage("No preview was requested: a preview renders one acknowledged revision in one named language, so the edition, the revision on screen and the language have to be stated together.")) : requestPreview(requestable)),
    enabled: requestable !== undefined,
    retry: false,
  });
}
const UNNAMED_DOCUMENT = "";
const GIVING_BINDING_TRANSPORT_GUIDANCE = "The giving-binding read did not complete, so this placement has no giving destination to show. Reload the placement to try again; no fallback designation and no amount is shown in the meantime.";
export type GivingBindingData = Extract<Awaited<ReturnType<typeof reads.pages.readGivingBinding>>, { readonly kind: "envelope" }>["envelope"]["data"];
export type GivingBindingEnvelope = ReadEnvelope<GivingBindingData>;
/** What the placement carries: the one approved Designation, or the *Giving unavailable* state with its cause. */ export type GivingBindingState = GivingBindingData["binding"];
/** The closed set of causes a placement can show no giving for, spelled as the service sends them. */ export type GivingUnavailableCause = Extract<GivingBindingState, { readonly state: "unavailable" }>["cause"];
export type GivingBindingReadResult = ReadResult<GivingBindingEnvelope>;
/** What the placement's query hands back: the result above, and no error, because every failure is one of its three answers. */ export type UseGivingBindingResult = UseQueryResult<GivingBindingReadResult, never>;
const GIVING_UNAVAILABLE_CAUSES = ["missing", "revoked", "incompatible"] as const satisfies readonly GivingUnavailableCause[];
const GIVING_UNAVAILABLE_CAUSE_SET: ReadonlySet<string> = new Set<string>(GIVING_UNAVAILABLE_CAUSES);
const isGivingUnavailableCause = (value: unknown): value is GivingUnavailableCause => typeof value === "string" && GIVING_UNAVAILABLE_CAUSE_SET.has(value);
function isGivingBindingState(value: unknown): value is GivingBindingState {
  if (!isRecord(value)) return false;
  switch (value.state) {
    case "approved": {
      const designationRef = value.designationRef;
      return isNonEmptyString(value.designationLabel) && isRecord(designationRef) && isNonEmptyString(designationRef.system) && isNonEmptyString(designationRef.reference);
    }
    case "unavailable":
      return isGivingUnavailableCause(value.cause);
    default:
      return false;
  }
}
const handlerUnavailable = (reference: string, guidance: string): GivingBindingReadResult => ({ kind: "unavailable", unavailable: unavailable({ operationId: "read", source: { system: HANDLER_SOURCE_SYSTEM, reference }, guidance }) });
const isGivingBindingData = (value: unknown): boolean => isRecord(value) && isGivingBindingState(value.binding);
async function fetchGivingBinding(documentId: string | undefined): Promise<GivingBindingReadResult> {
  if (documentId === undefined || documentId === UNNAMED_DOCUMENT) return handlerUnavailable(PAGES_ENDPOINT, "No Page was named, so there is no giving placement to read and no designation is assumed.");
  const path = `${PAGES_ENDPOINT}?view=${"giving-binding"}&documentId=${encodeURIComponent(documentId)}`;
  return fetchReadOrOutage<GivingBindingData, GivingBindingEnvelope["coverage"]>({ url: path, admits: isGivingBindingData, source: { system: HANDLER_SOURCE_SYSTEM, reference: path }, guidance: GIVING_BINDING_TRANSPORT_GUIDANCE });
}
/** Reads the Page's one approved giving Designation, or the *Giving unavailable* state with its cause and no fallback fund; returns an envelope or a `denied`/`unavailable` outcome. */
export const useGivingBinding = (scope: Scope, documentId: string | undefined): UseGivingBindingResult => useQuery<GivingBindingReadResult, never>({ queryKey: givingBindingKey(scope, documentId ?? UNNAMED_DOCUMENT), queryFn: () => fetchGivingBinding(documentId), enabled: Boolean(documentId), retry: false });
export type EditionAuthority = { readonly scope: Scope; readonly documentId: string };
function statesEdition(data: Readonly<Record<string, unknown>>, variantId: string): boolean {
  const draft = data["draft"];
  if (isRecord(draft) && draft["variantId"] === variantId) return true;
  const editions = data["editions"];
  return Array.isArray(editions) && editions.some((edition) => isRecord(edition) && edition["variantId"] === variantId);
}
function scopeAt(value: unknown): Scope | undefined {
  if (!isRecord(value)) return undefined;
  const { organizationId, ministryId, supportSubjectId, principalId } = value;
  return ![organizationId, ministryId, supportSubjectId, principalId].every(isNonEmptyString) ? undefined : ({ organizationId, ministryId, supportSubjectId, principalId } as Scope);
}
function authorityInCache(queryClient: QueryClient, variantId: string): EditionAuthority | undefined {
  for (const read of queryClient.getQueryCache().findAll({ predicate: (query) => query.queryKey.includes("pages") && query.queryKey.includes("page") })) {
    const result = read.state.data;
    if (!isRecord(result) || result["kind"] !== "envelope") continue;
    const envelope = result["envelope"];
    const data = isRecord(envelope) ? envelope["data"] : undefined;
    if (!isRecord(envelope) || !isRecord(data) || !statesEdition(data, variantId)) continue;
    const document = data["document"];
    const documentId = isRecord(document) ? document["documentId"] : undefined;
    const scope = scopeAt(envelope["scope"]);
    if (isNonEmptyString(documentId) && scope !== undefined) return { scope, documentId };
  }
  return undefined;
}
const sameAuthority = (current: EditionAuthority | undefined, next: EditionAuthority | undefined): boolean => (current === undefined || next === undefined ? current === next : current.documentId === next.documentId && sameScope(current.scope, next.scope));
/** The scope and Page identity a section change acts under: the caller's when it states both, otherwise the ones the Page read of this edition carried. */ export function useEditionAuthority(variantId: string, provided?: EditionAuthority): EditionAuthority | undefined {
  const queryClient = useQueryClient();
  const held = useRef<EditionAuthority | undefined>(undefined);
  const getSnapshot = useCallback((): EditionAuthority | undefined => {
    const next = provided ?? authorityInCache(queryClient, variantId);
    if (sameAuthority(held.current, next)) return held.current;
    held.current = next;
    return next;
  }, [queryClient, variantId, provided]);
  const subscribe = useCallback((onChange: () => void) => queryClient.getQueryCache().subscribe(onChange), [queryClient]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
/** Re-runs the Page read a change acted on, so the surface following it shows the record as it now stands. */ export function usePageReread(documentId: string | undefined): () => void {
  const queryClient = useQueryClient();
  return useCallback((): void => {
    if (documentId === undefined) return;
    void queryClient.invalidateQueries({ predicate: (query) => query.queryKey.includes("pages") && query.queryKey.includes(documentId) });
  }, [queryClient, documentId]);
}
