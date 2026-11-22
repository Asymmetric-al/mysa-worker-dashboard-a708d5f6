"use client";
/**
 * The record body's two change surfaces, mounted by the route that reads the record. A Server Component cannot
 * hand a function across the client boundary, so each wrapper supplies the one reaction its surface asks for —
 * the record read back from the source once a change settles — and nothing else. Every prop is the serialisable
 * fact the route already read, and neither wrapper holds state of its own.
 */
import { useRouter } from "next/navigation";
import { useCallback, type ReactElement } from "react";
import type { PartnerKind, ReadAction, Scope } from "@/modules/data-service/envelope";
import PreparationArchiveActions from "./preparation-archive-actions";
import TagAndFavouriteActions, { type TagAndFavouriteTarget } from "./tag-and-favourite-actions";

/** Props of {@link PartnerFilingSurface}: the record the route read, and the tags its ministry already uses. */
export interface PartnerFilingSurfaceProps {
  /** The authority the filing is made in, taken from the read that supplied the record. */
  readonly scope: Scope;
  /** The record this surface files, with the filing facts and the revision its read published. */
  readonly target: TagAndFavouriteTarget;
  /** The labels already used in this ministry, offered as suggestions rather than as a closed list. */
  readonly tagSuggestions?: readonly string[];
}

/** Props of {@link PartnerPreparationSurface}: the preparation facts the route's two reads published. */
export interface PartnerPreparationSurfaceProps {
  /** The opaque identifier of the private preparation record. */
  readonly partnerId: string;
  /** What kind of record this is; any kind but private preparation renders no control at all. */
  readonly kind: PartnerKind;
  /** Whether the preparation is archived now, which decides the one direction the control offers. */
  readonly archived: boolean;
  /** The revision the route read, which every change presents as its expected revision. */
  readonly expectedRevision: string;
  /** The scope the route read in; the service re-derives it and re-checks it on submit. */
  readonly scope: Scope;
  /** The record read's advisory actions, which decide whether the change is admitted at all. */
  readonly availableActions: readonly ReadAction[];
}

/**
 * The one reaction both surfaces share: a settled change is read back from the source rather than placed in the
 * page by the control that made it, so the body states the tags, favourite mark or archived state the record
 * holds after the change instead of the one it held when the route rendered.
 */
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
