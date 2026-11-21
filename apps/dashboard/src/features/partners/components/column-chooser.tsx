"use client";
/**
 * The Partners family's column catalogue and the one control that changes which columns the roster shows.
 *
 * There is no column resizing here, and no column sizing anywhere in this application: the one table preset
 * (`@/components/record-list`) offers column visibility without drag resizing, so a resize handle, a width
 * slider or a drag affordance added here would be both a second sizing pattern beside that preset (one
 * implementation per concern) and a control a worker has to drag (WCAG 2.5.7). "Column sizing has a keyboard
 * and single-pointer alternative" is met by there being no sizing control to drag at all.
 *
 * Visibility has exactly one owner: the roster's query state, which the URL carries and a saved view stores.
 * This component is controlled — `value` in, `onValueChange` out — and never writes a cookie, a storage key or
 * a local copy of the roster, so a reload, a deep link and a saved view all restore the same column set.
 *
 * A column is offered only when the read states the facts it shows (`admittedBy`). A giving column is absent in
 * a context whose envelope withholds support history — impossible to switch on, not merely unticked — and a
 * stored or bookmarked selection naming such a column is dropped rather than kept as a hidden entry.
 */
import { Columns3Icon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from "react";
import { StateNotice } from "@/components/state-notice";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import { useDismissableLayer } from "@/lib/ui-sdk";
import type { ReadEnvelope } from "@/modules/data-service/envelope";
import { FACET_LABELS } from "../copy/facets";

// The catalogue
/** Every column the partner roster can show, in the order it shows them. */
export const PARTNER_COLUMN_KEYS = ["displayName", "kind", "contactMethodAvailability", "tags", "favourite", "relationshipContext", "recentActivity", "openTasks", "lastGiftOn", "givingTotalInPeriod", "recurringStatus"] as const;
/** One column the roster can show. */
export type PartnerColumnKey = (typeof PARTNER_COLUMN_KEYS)[number];
/** Column key to visibility, in the one shape the roster's query state, the URL and a saved view all carry: a column absent from the record is shown. */
export type PartnerColumnVisibility = Readonly<Record<string, boolean>>;
/**
 * The envelope facts a column's admission is decided from: the value states the read recorded. Nothing else is
 * consulted — not the caller's role, not a filter, not a second read — so an absent column always means the read
 * itself did not state the facts that column would show.
 */
export type PartnerColumnEnvelope = Pick<ReadEnvelope<unknown>, "valueStates">;
/** One entry of the catalogue: what the column is called, what it shows, how it starts and when it may be offered at all. */
export interface PartnerColumn {
  readonly key: PartnerColumnKey;
  readonly displayName: string;
  /** One line saying what the column shows, rendered beside its checkbox so the choice is made on the meaning. */
  readonly hint: string;
  /** Whether the column starts shown, before the worker or a saved view states otherwise. */
  readonly defaultVisible: boolean;
  /** Whether this read states the facts the column shows. `null` is a roster that has not answered yet, which admits only the columns every row carries. */
  readonly admittedBy: (envelope: PartnerColumnEnvelope | null) => boolean;
}

// What a column's admission is read from
// The roster read records one value state per row member (`rows.<index>.<member>`) and one per facet value
// (`facets.<facetId>.<value>.count`). Those two path families are the only evidence an optional column is
// offered on: a row path means the member is present on the rows, and a facet path means the read admitted the
// facet that describes it — which is what keeps a giving column available on a roster with no rows yet.
const ROW_PATH = /^rows\.\d+\./;
function envelopeStatesRowMember(envelope: PartnerColumnEnvelope | null, member: string): boolean {
  if (envelope === null) {
    return false;
  }
  const suffix = `.${member}`;
  for (const path of Object.keys(envelope.valueStates)) {
    if (ROW_PATH.test(path) && path.endsWith(suffix)) {
      return true;
    }
  }
  return false;
}
function envelopeStatesFacet(envelope: PartnerColumnEnvelope | null, facetId: string): boolean {
  if (envelope === null) {
    return false;
  }
  const prefix = `facets.${facetId}.`;
  for (const path of Object.keys(envelope.valueStates)) {
    if (path.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}
const admitsEveryContext = (): boolean => true;

// The entries
// The seven labels that name a filter as well as a column are taken from the facet copy, so a heading and the
// filter beside it can never drift into two wordings for one fact.
const PARTNER_COLUMN_DEFINITIONS: Readonly<Record<PartnerColumnKey, PartnerColumn>> = {
  displayName: { key: "displayName", displayName: "Name", hint: "The name this record is known by in this context.", defaultVisible: true, admittedBy: admitsEveryContext },
  kind: { key: "kind", displayName: FACET_LABELS["contact-type"], hint: "A person, a household, a church, another organization, or the worker's own preparation.", defaultVisible: true, admittedBy: admitsEveryContext },
  contactMethodAvailability: { key: "contactMethodAvailability", displayName: FACET_LABELS["contact-method-availability"], hint: "The kinds of contact method this record permits. A method another record holds grants nothing here.", defaultVisible: true, admittedBy: admitsEveryContext },
  tags: { key: "tags", displayName: FACET_LABELS.tag, hint: "The worker's own labels for this record.", defaultVisible: true, admittedBy: admitsEveryContext },
  favourite: { key: "favourite", displayName: FACET_LABELS.favourite, hint: "Whether this record is one the worker keeps close.", defaultVisible: true, admittedBy: admitsEveryContext },
  relationshipContext: { key: "relationshipContext", displayName: FACET_LABELS["relationship-label"], hint: "The relationship label, the initiatives this record is on and its referral status.", defaultVisible: true, admittedBy: admitsEveryContext },
  recentActivity: { key: "recentActivity", displayName: FACET_LABELS["recent-activity"], hint: "The most recent interaction actually recorded. A gift and a scheduled task are neither.", defaultVisible: true, admittedBy: admitsEveryContext },
  openTasks: { key: "openTasks", displayName: FACET_LABELS["task-state"], hint: "Open tasks, with the overdue and the undated ones counted separately.", defaultVisible: true, admittedBy: admitsEveryContext },
  // The three giving columns share one permission: the read publishes a partner's giving facts only where the
  // caller may see support history, and states them as `unavailable` or `unknown` rather than omitting them.
  lastGiftOn: {
    key: "lastGiftOn",
    displayName: FACET_LABELS["last-received-gift-date"],
    hint: "The original date of the most recent received support. The amount is read on the support surface.",
    defaultVisible: false,
    admittedBy: (envelope) => envelopeStatesRowMember(envelope, "lastReceivedOn") || envelopeStatesFacet(envelope, "last-received-gift-date"),
  },
  givingTotalInPeriod: {
    key: "givingTotalInPeriod",
    displayName: FACET_LABELS["giving-total"],
    hint: "The currencies this partner gave in during the period the list is filtered to. An amount is read on the support surface.",
    defaultVisible: false,
    admittedBy: (envelope) => envelopeStatesRowMember(envelope, "givingCurrencies") || envelopeStatesFacet(envelope, "giving-total"),
  },
  // Commitment status is not attributable to a partner in this source, which states exactly that on its own
  // commitment facet. The column is therefore absent until a read states the member on the rows; it is never
  // offered on the strength of a filter that could not answer for a partner.
  recurringStatus: { key: "recurringStatus", displayName: FACET_LABELS["commitment-status"], hint: "A partner's commitment status, shown only where the source attributes it to one.", defaultVisible: false, admittedBy: (envelope) => envelopeStatesRowMember(envelope, "commitmentStatus") },
};
/** The ordered column catalogue: every column the roster can show, whether each starts shown, and what admits it. */
export const partnerColumnCatalogue: readonly PartnerColumn[] = PARTNER_COLUMN_KEYS.map((key) => PARTNER_COLUMN_DEFINITIONS[key]);

// The selection
/** Whether a column is shown: a column the record does not mention is shown, so an empty set is the whole catalogue. */
export function partnerColumnIsVisible(visibility: PartnerColumnVisibility, key: PartnerColumnKey): boolean {
  return visibility[key] !== false;
}
/** The columns this read admits, in catalogue order. A roster that has not answered admits the columns every row carries. */
export function admittedPartnerColumns(envelope: PartnerColumnEnvelope | null = null): readonly PartnerColumn[] {
  return partnerColumnCatalogue.filter((column) => column.admittedBy(envelope));
}
/** The admitted column keys, for the roster's own query state so a stale URL or saved view cannot carry a column this context withholds. */
export function admittedPartnerColumnKeys(envelope: PartnerColumnEnvelope | null = null): readonly string[] {
  return admittedPartnerColumns(envelope).map((column) => column.key);
}
function defaultVisibility(admitted: readonly PartnerColumn[]): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  for (const column of admitted) {
    next[column.key] = column.defaultVisible;
  }
  return next;
}
/**
 * The selection narrowed to what this read admits: a column naming a fact the envelope does not state is dropped,
 * and a selection that would hide every admitted column falls back to the catalogue's own defaults. Returns `null`
 * when the selection already stands as it is, so the caller is never asked to store an identical set again.
 */
function visibilityWithinAdmitted(value: PartnerColumnVisibility, admitted: readonly PartnerColumn[]): Record<string, boolean> | null {
  const allowed = new Set<string>(admitted.map((column) => column.key));
  const next: Record<string, boolean> = {};
  let dropped = false;
  for (const [key, visible] of Object.entries(value)) {
    if (allowed.has(key)) {
      next[key] = visible;
    } else {
      dropped = true;
    }
  }
  // The catalogue's defaults always show at least one column, because every structural column starts shown and is
  // admitted in every context, so this restores a visible list rather than looping on a permanently empty one.
  if (admitted.length > 0 && !admitted.some((column) => partnerColumnIsVisible(next, column.key))) {
    return defaultVisibility(admitted);
  }
  return dropped ? next : null;
}

// Wording
const COLUMN_CHOOSER_COPY = {
  trigger: "Columns",
  // The accessible name is the visible wording itself, so the label a person sees and the name a screen reader
  // announces can never disagree (WCAG 2.5.3).
  triggerName: (count: string): string => `Columns ${count}`,
  count: (shown: string, total: string): string => `${shown} of ${total} shown`,
  title: "Columns",
  description: "At least one column stays visible. Hiding one changes what this list shows, never what a record states.",
  optionName: (column: string): string => `${column} column`,
  locked: "This is the last visible column, so it stays shown. Show another column to hide this one.",
  showAll: "Show all",
  reset: "Reset",
  noOptionalTitle: "No optional column is offered here",
  noOptionalBody: "A giving column appears only when this context states a partner's giving facts for the period, and a commitment column only when the source attributes commitment status to a partner. The list shows the columns it can fill.",
} as const;

// The control
/** Props of {@link ColumnChooser}. */
export interface ColumnChooserProps {
  /** The visible columns the owner holds: the roster's query state, never a second copy of it. */
  readonly value: PartnerColumnVisibility;
  /** Called with the whole next set once a column is toggled, every column is shown or the defaults are restored. */
  readonly onValueChange: (next: Record<string, boolean>) => void;
  /** The roster envelope the admission is read from; `null` until the read answers, which admits only the structural columns. */
  readonly envelope?: PartnerColumnEnvelope | null;
  /** Applied to the trigger, the only element this control occupies in a toolbar. */
  readonly className?: string;
}
/**
 * The Partners roster's configurable columns: a real button opening a labelled checkbox list of the columns this
 * read admits, with Show all and Reset, reached by keyboard and by a single pointer at 320 CSS px.
 */
export default function ColumnChooser({ value, onValueChange, envelope = null, className }: ColumnChooserProps): ReactElement {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const optionIdBase = useId();
  // Read once per envelope, because the selection is checked against it on every render and the admission is a
  // property of the read rather than of this render.
  const admitted = useMemo(() => admittedPartnerColumns(envelope), [envelope]);
  // One dismissal behaviour for Escape, an outside press and the return of focus to the trigger — the same one the
  // toolbar's filters use — while the popover positions and portals the layer.
  useDismissableLayer({
    open,
    layerRef,
    triggerRef,
    onDismiss: () => {
      setOpen(false);
    },
  });
  // A stored or bookmarked selection can name a column this read no longer admits, so the set the surface holds is
  // narrowed to the admitted columns instead of leaving a giving column in place that this context may not see.
  useEffect(() => {
    const next = visibilityWithinAdmitted(value, admitted);
    if (next !== null) {
      onValueChange(next);
    }
  }, [value, admitted, onValueChange]);
  const shown = admitted.filter((column) => partnerColumnIsVisible(value, column.key));
  const optional = admitted.filter((column) => !column.admittedBy(null));
  const countLabel = COLUMN_CHOOSER_COPY.count(String(shown.length), String(admitted.length));
  const allShown = shown.length === admitted.length;
  const atDefaults = admitted.every((column) => partnerColumnIsVisible(value, column.key) === column.defaultVisible);
  function setColumn(key: PartnerColumnKey, visible: boolean): void {
    // The last visible column stays shown, so the list always has something to read.
    if (!visible && shown.length <= 1) {
      return;
    }
    // Built from the selection as it stands, so a column the worker never touched keeps the default the record
    // expresses by leaving it out rather than being written down as an explicit choice.
    const next: Record<string, boolean> = {};
    for (const [entry, entryVisible] of Object.entries(value)) {
      if (admitted.some((column) => column.key === entry)) {
        next[entry] = entryVisible;
      }
    }
    next[key] = visible;
    onValueChange(next);
  }
  function showAllColumns(): void {
    // An empty record is the whole catalogue shown, which is the form the roster's query state and a saved view
    // already read as "every column": writing every key as `true` would say the same thing in more words.
    onValueChange({});
  }
  function restoreDefaults(): void {
    onValueChange(defaultVisibility(admitted));
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button type="button" variant="outline" size="sm" className={cn("max-w-full", className)} aria-label={COLUMN_CHOOSER_COPY.triggerName(countLabel)} ref={triggerRef} />}>
        <Columns3Icon aria-hidden="true" />
        <span>{COLUMN_CHOOSER_COPY.trigger}</span> <span className="tabular-figures text-xs text-muted-foreground">{countLabel}</span>
      </PopoverTrigger>
      <PopoverContent ref={layerRef} align="end" className="max-h-[min(28rem,calc(100dvh-2rem))] w-80 max-w-[calc(100vw-2rem)] gap-3">
        <PopoverHeader>
          <PopoverTitle className="text-sm">{COLUMN_CHOOSER_COPY.title}</PopoverTitle>
          <PopoverDescription className="text-xs">{COLUMN_CHOOSER_COPY.description}</PopoverDescription>
        </PopoverHeader>
        {/* The one scroll region of this layer: the popover's height is capped to the viewport, so its actions and its
            note stay on screen and the list scrolls inside them instead of pushing them past the fold. */}
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain">
          {admitted.map((column, index) => {
            const optionId = `${optionIdBase}-${index}`;
            const hintId = `${optionId}-hint`;
            const visible = partnerColumnIsVisible(value, column.key);
            const locked = visible && shown.length === 1;
            return (
              // `shrink-0` keeps each row at its content height: a flex item with an explicit minimum height may otherwise
              // shrink below its own content inside the scrolling list, which paints one row's hint over the next row.
              <div key={column.key} className="flex min-h-6 shrink-0 items-start gap-2.5 rounded-xl px-2 py-1.5">
                <Checkbox
                  id={optionId}
                  className="mt-0.5"
                  checked={visible}
                  disabled={locked}
                  aria-label={COLUMN_CHOOSER_COPY.optionName(column.displayName)}
                  aria-describedby={hintId}
                  onCheckedChange={(checked: boolean) => {
                    setColumn(column.key, checked);
                  }}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <Label htmlFor={optionId} className="cursor-pointer items-start font-normal leading-snug">
                    <span className="min-w-0 break-words">
                      <bdi>{column.displayName}</bdi>
                    </span>
                  </Label>
                  {/* A phone width has no room for ten explanations beside their labels, so the hint stays in the
                      accessibility tree and is shown where there is space — except the lock explanation, which is
                      feedback about the choice just attempted and is always visible. */}
                  <p id={hintId} className={cn("text-xs leading-snug text-pretty text-muted-foreground", locked ? undefined : "sr-only sm:not-sr-only")}>
                    {locked ? COLUMN_CHOOSER_COPY.locked : column.hint}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
        {/* The absence is stated where the columns would be, so a context that withholds giving facts says so rather
            than leaving the worker to wonder whether a column is unticked or missing. */}
        {optional.length === 0 ? <StateNotice kind="empty" headingLevel={4} title={COLUMN_CHOOSER_COPY.noOptionalTitle} description={COLUMN_CHOOSER_COPY.noOptionalBody} className="shrink-0 p-0 sm:p-0" /> : null}
        <Separator className="shrink-0" />
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={allShown} onClick={showAllColumns}>
            {COLUMN_CHOOSER_COPY.showAll}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={atDefaults} onClick={restoreDefaults}>
            {COLUMN_CHOOSER_COPY.reset}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
