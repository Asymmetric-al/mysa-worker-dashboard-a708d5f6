/**
 * The grammar a task's link selection is written in.
 *
 * A task names at most one partner and one initiative by their opaque references, and the composer's select
 * carries that choice as one string. The grammar lives here rather than in the composer because two owners
 * write it: the composer, and a route that opens the composer already linked to the record the worker came
 * from (`/work?partnerId=…`). One writer and one parser, so a value a route writes is always a value the
 * composer reads.
 */
const LINK_SEPARATOR = ":";

const PARTNER_KIND = "partner";

const INITIATIVE_KIND = "initiative";

/** One link selection: its kind and the opaque reference it names. */
function taskLinkValue(kind: string, reference: string): string {
  return `${kind}${LINK_SEPARATOR}${reference}`;
}

/** The link selection that names one partner record. */
export function partnerLinkValue(partnerId: string): string {
  return taskLinkValue(PARTNER_KIND, partnerId);
}

/** The link selection that names one initiative. */
export function initiativeLinkValue(initiativeId: string): string {
  return taskLinkValue(INITIATIVE_KIND, initiativeId);
}

/**
 * The members a link selection names: one of the two links, or neither.
 *
 * The selection names only the chosen member, because a task can hold a partner and an initiative at once and
 * this grammar cannot state an absent one; a link the worker did not touch is left out of the payload
 * entirely, so it stands as it is.
 */
export function linkMembers(value: string): { readonly partnerId?: string; readonly initiativeId?: string } {
  const separator = value.indexOf(LINK_SEPARATOR);
  if (separator <= 0) return {};
  const reference = value.slice(separator + 1);
  if (reference === "") return {};
  const kind = value.slice(0, separator);
  if (kind === PARTNER_KIND) return { partnerId: reference };
  if (kind === INITIATIVE_KIND) return { initiativeId: reference };
  return {};
}
