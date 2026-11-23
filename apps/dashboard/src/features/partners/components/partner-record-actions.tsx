"use client";
/** The record body's two change surfaces, mounted by the route that reads the record: a Server Component cannot hand a function across the client boundary, so each wrapper supplies the one reaction its surface asks for — the record read back from the source once a change settles — and nothing else. Every prop is a serialisable fact the route already read, and neither wrapper holds state of its own. */
import { useRouter } from "next/navigation";
import { useCallback, type ReactElement } from "react";
import type { PartnerKind, ReadAction, Scope } from "@/modules/data-service/envelope";
import PreparationArchiveActions from "./preparation-archive-actions";
import TagAndFavouriteActions, { type TagAndFavouriteTarget } from "./tag-and-favourite-actions";
/** Props of {@link PartnerFilingSurface}: the record the route read, and the tags its ministry already uses. */
export type PartnerFilingSurfaceProps = { readonly scope: Scope; readonly target: TagAndFavouriteTarget; readonly tagSuggestions?: readonly string[] };
/** Props of {@link PartnerPreparationSurface}: the preparation facts the route's two reads published. */
export type PartnerPreparationSurfaceProps = { readonly partnerId: string; readonly kind: PartnerKind; readonly archived: boolean; readonly expectedRevision: string; readonly scope: Scope; readonly availableActions: readonly ReadAction[] };
/** The one reaction both surfaces share: a settled change is read back from the source rather than placed in the page by the control that made it, so the body states what the record holds after the change instead of what it held when the route rendered. */
function useRecordReread(): () => void {
  const router = useRouter();
  return useCallback((): void => {
    router.refresh();
  }, [router]);
}
/** Files the record under the worker's own tags and favourite mark, inside the record body. */
export function PartnerFilingSurface({ scope, target, tagSuggestions }: PartnerFilingSurfaceProps): ReactElement {
  const reread = useRecordReread();
  return <TagAndFavouriteActions scope={scope} target={target} tagSuggestions={tagSuggestions} onSettled={reread} onCheckResult={reread} />;
}
/** Archives or restores the worker's own preparation, inside the record body. */
export function PartnerPreparationSurface({ partnerId, kind, archived, expectedRevision, scope, availableActions }: PartnerPreparationSurfaceProps): ReactElement | null {
  const reread = useRecordReread();
  return <PreparationArchiveActions partnerId={partnerId} kind={kind} archived={archived} expectedRevision={expectedRevision} scope={scope} availableActions={availableActions} onSettled={reread} onCheckResult={reread} />;
}
export default PartnerFilingSurface;
