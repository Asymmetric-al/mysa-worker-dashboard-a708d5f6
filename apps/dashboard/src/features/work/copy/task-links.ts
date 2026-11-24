const LINK_SEPARATOR = ":";
const PARTNER_KIND = "partner";
const INITIATIVE_KIND = "initiative";
const taskLinkValue = (kind: string, reference: string): string => `${kind}${LINK_SEPARATOR}${reference}`;
/** The link selection that names one partner record. */ export const partnerLinkValue = (partnerId: string): string => taskLinkValue(PARTNER_KIND, partnerId);
/** The link selection that names one initiative. */ export const initiativeLinkValue = (initiativeId: string): string => taskLinkValue(INITIATIVE_KIND, initiativeId); /** The members a link selection names: one of the two links, or neither. */
export function linkMembers(value: string): { readonly partnerId?: string; readonly initiativeId?: string } {
  const separator = value.indexOf(LINK_SEPARATOR);
  if (separator <= 0) return {};
  const reference = value.slice(separator + 1);
  if (reference === "") return {};
  const kind = value.slice(0, separator);
  return kind === PARTNER_KIND ? { partnerId: reference } : kind === INITIATIVE_KIND ? { initiativeId: reference } : {};
}
