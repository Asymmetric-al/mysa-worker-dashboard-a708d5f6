import type { ReactElement } from "react";
/** Props of {@link FactRow}. */ export type FactRowProps = { readonly label: string; readonly value: string; readonly wrap?: boolean; readonly mono?: boolean };
/** One label-and-value fact of a definition list: the fact's own label, then its value exactly as the read stated it, set in the identifier face where the fact is one. */ export default function FactRow({ label, value, wrap = true, mono = false }: FactRowProps): ReactElement {
  return (
    <div className="flex min-w-0 flex-wrap gap-x-1">
      <dt className="text-muted-foreground">{label}:</dt>
      <dd className={wrap ? "min-w-0 wrap-anywhere" : "min-w-0"}>
        <bdi className={mono ? "font-mono" : undefined}>{value}</bdi>
      </dd>
    </div>
  );
}
