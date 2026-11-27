"use client";
/** The record body's action surfaces: the row of links into the record's own jobs, and the two change surfaces the body mounts beside its sections. A Server Component cannot hand a function across the client boundary, so each change surface supplies the one reaction it asks for — the record read back from the source once a change settles — and nothing else. Every prop is a serialisable fact the caller already read, and no surface holds state of its own. The record's own route and the record presented beside the list render these surfaces, so the same jobs are offered against the same revision in each presentation. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, type ReactElement } from "react";
import type { ReviewHeadingLevel } from "@/components/action-review";
import { buttonVariants } from "@/components/ui/button";
import type { PartnerKind, ReadAction, Scope } from "@/modules/data-service/envelope";
import { PARTNER_ACTION_LABELS } from "../copy/states";
import PreparationArchiveActions from "./preparation-archive-actions";
import TagAndFavouriteActions, { type TagAndFavouriteTarget } from "./tag-and-favourite-actions";
/** The addresses a record offers: the roster it belongs to, the two jobs that leave the body for their own page, and the work list narrowed to it. */ export const PARTNER_RECORD_PATHS = {
  roster: "/partners",
  edit: (partnerId: string): string => `/partners/${encodeURIComponent(partnerId)}/edit`,
  newInteraction: (partnerId: string): string => `/partners/${encodeURIComponent(partnerId)}/interactions/new`,
  work: (partnerId: string): string => `/work?partnerId=${encodeURIComponent(partnerId)}`,
} as const;
/** Props of {@link PartnerRecordActionBar}: the record the row acts on, and the three admissions its read published. */ export type PartnerRecordActionBarProps = { readonly partnerId: string; readonly contactEditsAdmitted: boolean; readonly logInteractionAdmitted: boolean; readonly createTaskAdmitted: boolean };
/** The record's own action row: each link appears only where the record read admits that job, and a record that admits none of them renders no row at all. */
export function PartnerRecordActionBar({ partnerId, contactEditsAdmitted, logInteractionAdmitted, createTaskAdmitted }: PartnerRecordActionBarProps): ReactElement | null {
  const actionClass = buttonVariants({ variant: "outline" });
  if (!contactEditsAdmitted && !logInteractionAdmitted && !createTaskAdmitted) return null;
  return (
    <>
      {contactEditsAdmitted ? <Link {...{ "data-slot": "button", className: actionClass, href: PARTNER_RECORD_PATHS.edit(partnerId) }}>{"Edit contact"}</Link> : null}
      {logInteractionAdmitted ? <Link {...{ "data-slot": "button", className: actionClass, href: PARTNER_RECORD_PATHS.newInteraction(partnerId) }}>{PARTNER_ACTION_LABELS.logInteraction}</Link> : null}
      {createTaskAdmitted ? <Link {...{ "data-slot": "button", className: actionClass, href: PARTNER_RECORD_PATHS.work(partnerId) }}>{PARTNER_ACTION_LABELS.createFollowUpTask}</Link> : null}
    </>
  );
}
/** Props of {@link PartnerFilingSurface}: the record a caller read, the tags its ministry already uses, and the heading level the presentation it lands in states. */
export type PartnerFilingSurfaceProps = { readonly scope: Scope; readonly target: TagAndFavouriteTarget; readonly tagSuggestions?: readonly string[]; readonly headingLevel?: ReviewHeadingLevel };
/** Props of {@link PartnerPreparationSurface}: the preparation facts the caller's reads published, and the heading level the presentation it lands in states. */
export type PartnerPreparationSurfaceProps = { readonly partnerId: string; readonly kind: PartnerKind; readonly archived: boolean; readonly expectedRevision: string; readonly scope: Scope; readonly availableActions: readonly ReadAction[]; readonly headingLevel?: 3 | 4 };
/** The one reaction both surfaces share: a settled change is read back from the source rather than placed in the page by the control that made it, so the body states what the record holds after the change instead of what it held when the route rendered. */ function useRecordReread(): () => void {
  const router = useRouter();
  return useCallback((): void => {
    router.refresh();
  }, [router]);
}
/** Files the record under the worker's own tags and favourite mark, inside the record body. */ export function PartnerFilingSurface({ scope, target, tagSuggestions, headingLevel }: PartnerFilingSurfaceProps): ReactElement {
  const reread = useRecordReread();
  return <TagAndFavouriteActions scope={scope} target={target} tagSuggestions={tagSuggestions} onSettled={reread} onCheckResult={reread} {...(headingLevel === undefined ? {} : { headingLevel })} />;
}
/** Archives or restores the worker's own preparation, inside the record body. */ export function PartnerPreparationSurface({ partnerId, kind, archived, expectedRevision, scope, availableActions, headingLevel }: PartnerPreparationSurfaceProps): ReactElement | null {
  const reread = useRecordReread();
  return <PreparationArchiveActions partnerId={partnerId} kind={kind} archived={archived} expectedRevision={expectedRevision} scope={scope} availableActions={availableActions} onSettled={reread} onCheckResult={reread} {...(headingLevel === undefined ? {} : { headingLevel })} />;
}
export default PartnerFilingSurface;
