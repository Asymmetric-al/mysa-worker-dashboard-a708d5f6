/**
 * The labels a task row names its linked partner with.
 *
 * A task carries an opaque partner reference and never a name, so a row names the partner only from the roster
 * read that admitted that record. This module is shared by the two routes that render rows — the lists and the
 * dated agenda — so both name a partner the same way, and it holds no client code: a route composes the map on
 * the server and hands it down.
 */

/** The one field of a roster row this needs: the opaque reference a task carries and the label that names it. */
export type PartnerLabelRow = { readonly partner: { readonly partnerId: string; readonly displayName: string } };

/**
 * The partner labels a roster read admitted, keyed by the reference a task row carries.
 *
 * A row that carries a reference this map does not hold states the reference itself rather than a name derived
 * from it: a partner the roster did not admit is one this page cannot name.
 */
export function partnerLabelsOf(rows: readonly PartnerLabelRow[]): Readonly<Record<string, string>> {
  const labels: Record<string, string> = {};
  for (const row of rows) labels[row.partner.partnerId] = row.partner.displayName;
  return labels;
}
