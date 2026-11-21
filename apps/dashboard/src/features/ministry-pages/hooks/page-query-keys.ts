/** The Worker and Project Pages family's cache keys — the only place this feature composes one. */
import { scopeKey } from "@/components/context-switch-guard";
import type { Scope } from "@/modules/data-service";
export interface PagePreviewKeyParams {
  readonly documentId: string;
  readonly variantId: string;
  readonly revisionId?: string;
  readonly locale?: string;
}
/** Keys every page read in one scope, so invalidating it re-reads the whole family there. */
export function pagesPrefix(scope: Scope): readonly unknown[] {
  return [...scopeKey(scope), "pages"];
}
/** The covering prefix for one Page: invalidating it re-reads the page body, its locale editions, its giving binding and every preview of it. */
export function pageKey(scope: Scope, documentId: string): readonly unknown[] {
  return [...pagesPrefix(scope), "page", documentId];
}
/** Keys the admitted Worker and Project Page catalogue reads in one scope. */
export function pageCataloguesKey(scope: Scope): readonly unknown[] {
  return [...pagesPrefix(scope), "catalogues"];
}
/** Keys the locale editions of one Page — one entry per draft, candidate and release it carries. */
export function pageLocalesKey(scope: Scope, documentId: string): readonly unknown[] {
  return [...pageKey(scope, documentId), "locales"];
}
/** Keys the approved giving Designation binding of one Page, including its unavailable state. */
export function givingBindingKey(scope: Scope, documentId: string): readonly unknown[] {
  return [...pageKey(scope, documentId), "giving"];
}
/** Keys one inert preview of a Page edition, exactly as that preview was requested. */
export function pagePreviewKey(scope: Scope, params: PagePreviewKeyParams): readonly unknown[] {
  return [...pageKey(scope, params.documentId), "preview", previewParams(params)];
}
function previewParams(params: PagePreviewKeyParams): PagePreviewKeyParams {
  return { documentId: params.documentId, variantId: params.variantId, ...(params.revisionId === undefined ? {} : { revisionId: params.revisionId }), ...(params.locale === undefined ? {} : { locale: params.locale }) };
}
