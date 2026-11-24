export type PartnerLabelRow = { readonly partner: { readonly partnerId: string; readonly displayName: string } };
/** The partner labels a roster read admitted, keyed by the reference a task row carries. */ export function partnerLabelsOf(rows: readonly PartnerLabelRow[]): Readonly<Record<string, string>> {
  const labels: Record<string, string> = {};
  for (const row of rows) labels[row.partner.partnerId] = row.partner.displayName;
  return labels;
}
