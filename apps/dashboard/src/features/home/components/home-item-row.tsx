import type { ReactElement } from "react";
import Link from "next/link";
import DraftStatus from "@/components/draft-status";
import { SimulationLabel } from "@/components/simulation-label";
import StatusBadge from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { INCOMPLETE_ITEM_COPY, REASON_LABELS, UNKNOWN_REASON_LABEL } from "../copy";
import { homeReasonCodeSchema, parseHomeItem, type HomeItemParseResult, type HomeSectionKey } from "../home-schema";
function parseItemSafely(item: unknown): HomeItemParseResult {
  try {
    return parseHomeItem(item);
  } catch {
    return { ok: false };
  }
}
const ItemText = ({ className, value }: { readonly className: string; readonly value: string }): ReactElement => <bdi className={className}>{value}</bdi>;
function reasonLabelOf(reasonCode: string): string {
  const code = homeReasonCodeSchema.safeParse(reasonCode);
  return code.success ? REASON_LABELS[code.data] : UNKNOWN_REASON_LABEL;
}
const rowClassName = (variant: HomeSectionKey): string => cn("flex min-w-0 flex-col text-start", variant === "information" ? "gap-1" : "gap-2");
export default function HomeItemRow(props: { item: unknown; variant: HomeSectionKey }) {
  const { item, variant } = props;
  const parsed = parseItemSafely(item);
  if (!parsed.ok) {
    return (
      <li data-slot="home-item-row" data-home-variant={variant} data-item-state="incomplete" className={rowClassName(variant)}>
        <output className="flex min-w-0 flex-col gap-1">
          <span className="text-sm font-medium">{INCOMPLETE_ITEM_COPY.title}</span>
          <span className="text-sm text-muted-foreground text-pretty wrap-anywhere">{INCOMPLETE_ITEM_COPY.body}</span>
        </output>
        {parsed.title === undefined ? null : <ItemText className="text-sm font-medium text-pretty wrap-anywhere" value={parsed.title} />}
        {parsed.reason === undefined ? null : <ItemText className="text-sm text-muted-foreground text-pretty wrap-anywhere" value={parsed.reason} />}
      </li>
    );
  }
  const view = parsed.item;
  const leadsWithReason = variant === "attention";
  const lifecycle = variant === "unfinished-work" ? view.lifecycle : undefined;
  const destination = (
    <Link href={view.destination.href} className={cn("inline-flex min-h-6 min-w-6 w-fit max-w-full flex-wrap items-center gap-x-1.5 text-start inline-link", variant === "information" ? "text-sm font-normal" : "text-sm font-medium")}>
      <bdi className="text-pretty wrap-anywhere">{view.title}</bdi>
      <span className="text-xs font-normal text-muted-foreground">{view.destination.label}</span>
    </Link>
  );
  const reason = (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <Badge variant="secondary">{reasonLabelOf(view.reasonCode)}</Badge>
      <bdi className="min-w-0 text-sm text-pretty wrap-anywhere">{view.reason}</bdi>
    </div>
  );
  return (
    <li data-slot="home-item-row" data-home-variant={variant} data-item-state="readable" className={rowClassName(variant)}>
      {leadsWithReason ? reason : null}
      {destination}
      {leadsWithReason ? null : reason}
      {view.statusWord !== undefined || lifecycle !== undefined ? (
        <div className="flex min-w-0 flex-col items-start gap-1">
          {view.statusWord === undefined ? null : <StatusBadge label={view.statusWord} />}
          {lifecycle === undefined ? null : <DraftStatus state={lifecycle} />}
        </div>
      ) : null}
      {view.simulatedEffect === undefined ? null : <SimulationLabel effect={view.simulatedEffect} />}
      {view.detail === undefined || view.detail.trim().length === 0 ? null : <ItemText className="text-xs text-muted-foreground text-pretty wrap-anywhere" value={view.detail} />}
    </li>
  );
}
