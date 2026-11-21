/**
 * The Worker and Project Pages family's cache keys — the only place this feature composes one.
 *
 * Scope: AAP 0.10.1 families 11 (Worker and Project Pages) and 14 (video, media and localization),
 * proven by criteria 12, 17 and 18.
 *
 * Hierarchy. One shape serves every read in the family, and each rung covers everything beneath it:
 *
 *   pagesPrefix ⊃ pageKey(documentId) ⊃ { locales, giving, preview }
 *   catalogues sits directly under pagesPrefix
 *   pageKey is a prefix, never a leaf key
 *
 * Why the shape is this one. `scopeKey` is the leading segment because the context fence in
 * `components/context-switch-guard` empties the whole query cache before it dispatches a switch: a
 * key that started anywhere else could not be cleared with the rest, so an envelope authorised in
 * the previous context could be rendered under the new one. `pageKey` is a covering prefix rather
 * than a leaf for the same reason one rung down — releasing, revising or withdrawing a Page changes
 * its body, its locale editions, its giving binding and any preview of it together, and invalidating
 * that one prefix refreshes all of them. `catalogues` stays beside `pageKey` rather than beneath it
 * because the admitted section catalogues belong to the family, not to one document.
 *
 * Composition, not repetition. The scope segments are produced in exactly one place — `pagesPrefix`
 * — and every other key is built from the rung above it, so the covering-prefix property is a fact
 * of the code rather than a coincidence six literals have to keep in step. Only `pagesPrefix`
 * therefore calls `scopeKey`, and it is the only path by which a scope enters a key in this family.
 *
 * What this module does not own. A key names a read envelope and nothing else: no record, no total,
 * no deadline, no permission and no label text — the family's words live in `../copy.ts`. Every
 * factory returns a fresh array, and no key carries a clock instant, a random value or a persona, so
 * the same scope and the same identifiers always compose the same key.
 */

import { scopeKey } from "@/components/context-switch-guard";
import type { Scope } from "@/modules/data-service";

/**
 * The variables one inert preview is keyed by: every member its query function reads, so previews
 * of different revisions or locales are separate cache entries and neither answers the other.
 */
export interface PagePreviewKeyParams {
  /** The Page whose preview is being read. */
  readonly documentId: string;
  /** The variant — audience and locale edition — whose exact revision is previewed. */
  readonly variantId: string;
  /** The frozen revision, when a submitted candidate is previewed instead of a working draft. */
  readonly revisionId?: string;
  /** The locale edition being previewed, when the caller has already chosen one. */
  readonly locale?: string;
}

/**
 * Keys every page read in one scope, so invalidating it re-reads the whole family there.
 */
export function pagesPrefix(scope: Scope): readonly unknown[] {
  return [...scopeKey(scope), "pages"];
}

/**
 * The covering prefix for one Page: invalidating it re-reads the page body, its locale editions, its
 * giving binding and every preview of it.
 */
export function pageKey(scope: Scope, documentId: string): readonly unknown[] {
  return [...pagesPrefix(scope), "page", documentId];
}

/**
 * Keys the admitted Worker and Project Page catalogue reads in one scope.
 */
export function pageCataloguesKey(scope: Scope): readonly unknown[] {
  return [...pagesPrefix(scope), "catalogues"];
}

/**
 * Keys the locale editions of one Page — one entry per draft, candidate and release it carries.
 */
export function pageLocalesKey(scope: Scope, documentId: string): readonly unknown[] {
  return [...pageKey(scope, documentId), "locales"];
}

/**
 * Keys the approved giving Designation binding of one Page, including its unavailable state.
 */
export function givingBindingKey(scope: Scope, documentId: string): readonly unknown[] {
  return [...pageKey(scope, documentId), "giving"];
}

/**
 * Keys one inert preview of a Page edition, exactly as that preview was requested.
 */
export function pagePreviewKey(scope: Scope, params: PagePreviewKeyParams): readonly unknown[] {
  return [...pageKey(scope, params.documentId), "preview", previewParams(params)];
}

/**
 * The preview's parameters with an absent optional member left out rather than set to `undefined`,
 * so a preview with a locale and one without can never compose the same key.
 */
function previewParams(params: PagePreviewKeyParams): PagePreviewKeyParams {
  return {
    documentId: params.documentId,
    variantId: params.variantId,
    ...(params.revisionId === undefined ? {} : { revisionId: params.revisionId }),
    ...(params.locale === undefined ? {} : { locale: params.locale }),
  };
}
