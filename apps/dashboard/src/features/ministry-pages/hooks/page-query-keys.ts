import { scopeKey } from "@/components/context-switch-guard";
import type { Scope } from "@/modules/data-service";
export type PagePreviewKeyParams = { readonly documentId: string; readonly variantId: string; readonly revisionId?: string; readonly locale?: string };
/** Keys every page read in one scope, so invalidating it re-reads the whole family there. */
export const pagesPrefix = (scope: Scope): readonly unknown[] => [...scopeKey(scope), "pages"];
/** The covering prefix for one Page: invalidating it re-reads the page body, its locale editions, its giving binding and every preview of it. */
export const pageKey = (scope: Scope, documentId: string): readonly unknown[] => [...pagesPrefix(scope), "page", documentId];
/** Keys the admitted Worker and Project Page catalogue reads in one scope. */
export const pageCataloguesKey = (scope: Scope): readonly unknown[] => [...pagesPrefix(scope), "catalogues"];
/** Keys the locale editions of one Page — one entry per draft, candidate and release it carries. */
export const pageLocalesKey = (scope: Scope, documentId: string): readonly unknown[] => [...pageKey(scope, documentId), "locales"];
/** Keys the approved giving Designation binding of one Page, including its unavailable state. */
export const givingBindingKey = (scope: Scope, documentId: string): readonly unknown[] => [...pageKey(scope, documentId), "giving"];
/** Keys one inert preview of a Page edition, exactly as that preview was requested. */
export const pagePreviewKey = (scope: Scope, params: PagePreviewKeyParams): readonly unknown[] => [...pageKey(scope, params.documentId), "preview", previewParams(params)];
const previewParams = (params: PagePreviewKeyParams): PagePreviewKeyParams => ({ documentId: params.documentId, variantId: params.variantId, ...(params.revisionId === undefined ? {} : { revisionId: params.revisionId }), ...(params.locale === undefined ? {} : { locale: params.locale }) });
