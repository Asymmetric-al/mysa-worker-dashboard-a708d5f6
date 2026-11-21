/**
 * One Home item: the destination it opens, the reason it is on Home, and the state it carries.
 *
 * **What this row owns.** It is the only place a Home item is interpreted. The three sections hand
 * it an `unknown` member of their group, it validates that member with `parseHomeItem`, and it then
 * renders what the envelope reported. It invents no status, no reason, no destination and no
 * urgency of its own, and the reason sentence is shown exactly as it arrived — which is what lets an
 * outcome such as "Published, notification needs attention" stand as a complete result without the
 * row reinterpreting it.
 *
 * **What the three sections change.** `variant` tunes emphasis and reading order only. Attention
 * leads with the reason and shows no lifecycle; Information stays a compact reading list with no
 * primary-action emphasis; Unfinished work surfaces the content lifecycle beside the status, which
 * is what keeps a resumable draft distinct from a release. No variant validates, derives or
 * re-orders a fact differently from another: all three render this one row.
 *
 * **What it composes instead of restating.** Every state word, lifecycle label and effect disclosure
 * comes from the shared implementation that owns it — `StatusBadge` for a status word, `DraftStatus`
 * for a lifecycle state, `SimulationLabel` for the external effect an item reports — so no label map,
 * no lifecycle vocabulary and no hand-written disclaimer is duplicated here.
 *
 * **An item that cannot be read stays listed.** The row still returns an `<li>`, carrying the notice
 * from `INCOMPLETE_ITEM_COPY` and whatever subject and reason text can still be recovered, shown as
 * plain text with no link. An item that quietly vanished would hide work from the worker, so the
 * list stays as long as the envelope's and the row states why it has no destination.
 */
import Link from "next/link";
import DraftStatus from "@/components/draft-status";
import { SimulationLabel } from "@/components/simulation-label";
import StatusBadge from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { INCOMPLETE_ITEM_COPY, REASON_LABELS, UNKNOWN_REASON_LABEL } from "../copy";
import { homeReasonCodeSchema, parseHomeItem, type HomeItemParseResult, type HomeSectionKey } from "../home-schema";
/** Reads one item without letting a failed read take the item off the page. */
function parseItemSafely(item: unknown): HomeItemParseResult {
  try {
    return parseHomeItem(item);
  } catch {
    // `parseHomeItem` is written not to throw, and this guard is the second line of defence: an item
    // whose fields cannot be read is still listed below rather than disappearing from Home.
    return { ok: false };
  }
}
/** The short label for an item's reason, narrowed through the schema's own enum so an unlabelled code reads as the fallback rather than a guess. */
function reasonLabelOf(reasonCode: string): string {
  const code = homeReasonCodeSchema.safeParse(reasonCode);
  return code.success ? REASON_LABELS[code.data] : UNKNOWN_REASON_LABEL;
}
/** The list item's own layout: Information reads denser, the other two give the reason and the state room. */
function rowClassName(variant: HomeSectionKey): string {
  return cn("flex min-w-0 flex-col text-start", variant === "information" ? "gap-1" : "gap-2");
}
/**
 * One Home item row, used by the Attention, Information and Unfinished work sections.
 *
 * `variant` changes emphasis and reading order only. Validation is always `parseHomeItem`, and the
 * destination, status word, lifecycle state and the effect an item reports are always rendered
 * through the shared component that owns their wording.
 */
export default function HomeItemRow(props: { item: unknown; variant: HomeSectionKey }) {
  const { item, variant } = props;
  const parsed = parseItemSafely(item);
  if (!parsed.ok) {
    return (
      <li data-slot="home-item-row" data-home-variant={variant} data-item-state="incomplete" className={rowClassName(variant)}>
        {/*
          The notice is a labelled status region rather than `StateNotice`: none of that component's
          seven kinds describes an item whose own fields did not arrive, and its empty and loading
          branches would add a heading and a full empty-state block inside a list item. `<output>`
          carries the implicit `status` role itself, so the sentence is announced once and politely,
          and it stays ordinary text for a reader who sees it.
        */}
        <output className="flex min-w-0 flex-col gap-1">
          <span className="text-sm font-medium">{INCOMPLETE_ITEM_COPY.title}</span>
          <span className="text-sm text-muted-foreground text-pretty wrap-anywhere">{INCOMPLETE_ITEM_COPY.body}</span>
        </output>
        {parsed.title === undefined ? null : (
          <p className="text-sm font-medium text-pretty wrap-anywhere">
            <bdi>{parsed.title}</bdi>
          </p>
        )}
        {parsed.reason === undefined ? null : (
          <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">
            <bdi>{parsed.reason}</bdi>
          </p>
        )}
      </li>
    );
  }
  const view = parsed.item;
  const leadsWithReason = variant === "attention";
  // A lifecycle state is surfaced where it separates a resumable draft from a release — Unfinished
  // work — and is left out of Attention, which leads with the reason instead.
  const lifecycle = variant === "unfinished-work" ? view.lifecycle : undefined;
  const showsState = view.statusWord !== undefined || lifecycle !== undefined;
  const detail = view.detail === undefined || view.detail.trim().length === 0 ? undefined : view.detail;
  const destination = (
    <Link
      href={view.destination.href}
      className={cn(
        "inline-flex min-h-6 min-w-6 w-fit max-w-full flex-wrap items-center gap-x-1.5 text-start underline-offset-4 hover:underline",
        variant === "information" ? "text-sm font-normal" : "text-sm font-medium",
      )}
    >
      <bdi className="text-pretty wrap-anywhere">{view.title}</bdi>
      <span className="text-xs font-normal text-muted-foreground">{view.destination.label}</span>
    </Link>
  );
  const reason = (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <Badge variant="secondary">{reasonLabelOf(view.reasonCode)}</Badge>
      <p className="min-w-0 text-sm text-pretty wrap-anywhere">
        <bdi>{view.reason}</bdi>
      </p>
    </div>
  );
  return (
    <li data-slot="home-item-row" data-home-variant={variant} data-item-state="readable" className={rowClassName(variant)}>
      {leadsWithReason ? reason : null}
      {destination}
      {leadsWithReason ? null : reason}
      {showsState ? (
        <div className="flex min-w-0 flex-col items-start gap-1">
          {view.statusWord === undefined ? null : <StatusBadge label={view.statusWord} />}
          {lifecycle === undefined ? null : <DraftStatus state={lifecycle} />}
        </div>
      ) : null}
      {view.simulatedEffect === undefined ? null : <SimulationLabel effect={view.simulatedEffect} />}
      {detail === undefined ? null : (
        <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">
          <bdi>{detail}</bdi>
        </p>
      )}
    </li>
  );
}
