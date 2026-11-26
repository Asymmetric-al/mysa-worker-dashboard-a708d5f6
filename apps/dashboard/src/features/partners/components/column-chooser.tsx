"use client";
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
export const PARTNER_COLUMN_KEYS = ["displayName", "kind", "contactMethodAvailability", "tags", "favourite", "relationshipContext", "recentActivity", "openTasks", "lastGiftOn", "givingTotalInPeriod", "recurringStatus"] as const;
export type PartnerColumnKey = (typeof PARTNER_COLUMN_KEYS)[number];
export type PartnerColumnVisibility = Readonly<Record<string, boolean>>;
export type PartnerColumnEnvelope = Pick<ReadEnvelope<unknown>, "valueStates">;
export type PartnerColumn = { readonly key: PartnerColumnKey; readonly displayName: string; readonly hint: string; readonly defaultVisible: boolean; readonly admittedBy: (envelope: PartnerColumnEnvelope | null) => boolean };
const ROW_PATH = /^rows\.\d+\./;
const envelopeStatesRowMember = (envelope: PartnerColumnEnvelope | null, member: string): boolean => envelope !== null && Object.keys(envelope.valueStates).some((path) => ROW_PATH.test(path) && path.endsWith(`.${member}`));
const envelopeStatesFacet = (envelope: PartnerColumnEnvelope | null, facetId: string): boolean => envelope !== null && Object.keys(envelope.valueStates).some((path) => path.startsWith(`facets.${facetId}.`));
const admitsEveryContext = (): boolean => true;
const admitsLastGiftOn = (envelope: PartnerColumnEnvelope | null): boolean => envelopeStatesRowMember(envelope, "lastReceivedOn") || envelopeStatesFacet(envelope, "last-received-gift-date");
const admitsGivingTotal = (envelope: PartnerColumnEnvelope | null): boolean => envelopeStatesRowMember(envelope, "givingCurrencies") || envelopeStatesFacet(envelope, "giving-total");
const admitsRecurringStatus = (envelope: PartnerColumnEnvelope | null): boolean => envelopeStatesRowMember(envelope, "commitmentStatus");
const PARTNER_COLUMN_DEFINITIONS: Readonly<Record<PartnerColumnKey, PartnerColumn>> = {
  displayName: { key: "displayName", displayName: "Name", hint: "Partner or private contact name.", defaultVisible: true, admittedBy: admitsEveryContext },
  kind: { key: "kind", displayName: FACET_LABELS["contact-type"], hint: "Person, household, church, organization, or private contact.", defaultVisible: true, admittedBy: admitsEveryContext },
  contactMethodAvailability: { key: "contactMethodAvailability", displayName: FACET_LABELS["contact-method-availability"], hint: "Contact methods you’re permitted to use.", defaultVisible: true, admittedBy: admitsEveryContext },
  tags: { key: "tags", displayName: FACET_LABELS.tag, hint: "Your labels on this partner.", defaultVisible: true, admittedBy: admitsEveryContext },
  favourite: { key: "favourite", displayName: FACET_LABELS.favourite, hint: "Partners you’ve starred for quick access.", defaultVisible: true, admittedBy: admitsEveryContext },
  relationshipContext: { key: "relationshipContext", displayName: FACET_LABELS["relationship-label"], hint: "Relationship label, active initiatives, and referral status.", defaultVisible: true, admittedBy: admitsEveryContext },
  recentActivity: { key: "recentActivity", displayName: FACET_LABELS["recent-activity"], hint: "Date of the most recent logged call, visit, or message.", defaultVisible: true, admittedBy: admitsEveryContext },
  openTasks: { key: "openTasks", displayName: FACET_LABELS["task-state"], hint: "Open, overdue, and undated tasks.", defaultVisible: true, admittedBy: admitsEveryContext },
  lastGiftOn: { key: "lastGiftOn", displayName: FACET_LABELS["last-received-gift-date"], hint: "Date of the most recent received gift (amounts are shown in Support).", defaultVisible: false, admittedBy: admitsLastGiftOn },
  givingTotalInPeriod: { key: "givingTotalInPeriod", displayName: FACET_LABELS["giving-total"], hint: "Currencies given during the selected period (amounts are shown in Support).", defaultVisible: false, admittedBy: admitsGivingTotal },
  recurringStatus: { key: "recurringStatus", displayName: FACET_LABELS["commitment-status"], hint: "Recurring commitment status when available.", defaultVisible: false, admittedBy: admitsRecurringStatus },
};
export const partnerColumnCatalogue: readonly PartnerColumn[] = PARTNER_COLUMN_KEYS.map((key) => PARTNER_COLUMN_DEFINITIONS[key]);
/** Whether a column is shown: a column the record does not mention is shown, so an empty set is the whole catalogue. */ export const partnerColumnIsVisible = (visibility: PartnerColumnVisibility, key: PartnerColumnKey): boolean => visibility[key] !== false;
/** The columns this read admits, in catalogue order. */ export const admittedPartnerColumns = (envelope: PartnerColumnEnvelope | null = null): readonly PartnerColumn[] => partnerColumnCatalogue.filter((column) => column.admittedBy(envelope));
const defaultVisibility = (admitted: readonly PartnerColumn[]): Record<string, boolean> => Object.fromEntries(admitted.map((column) => [column.key, column.defaultVisible]));
function visibilityWithinAdmitted(value: PartnerColumnVisibility, admitted: readonly PartnerColumn[]): Record<string, boolean> | null {
  const allowed = new Set<string>(admitted.map((column) => column.key));
  const kept = Object.entries(value).filter(([key]) => allowed.has(key));
  const next: Record<string, boolean> = Object.fromEntries(kept);
  if (admitted.length > 0 && !admitted.some((column) => partnerColumnIsVisible(next, column.key))) return defaultVisibility(admitted);
  return kept.length === Object.keys(value).length ? null : next;
}
const COLUMN_CHOOSER_COPY = {
  triggerName: (count: string): string => `Columns ${count}`,
  count: (shown: string, total: string): string => `${shown} of ${total} shown`,
  optionName: (column: string): string => `${column} column`,
  noOptionalBody: "Giving and commitment columns only appear when available in your current ministry and filter period.",
} as const;
export type ColumnChooserProps = { readonly value: PartnerColumnVisibility; readonly onValueChange: (next: Record<string, boolean>) => void; readonly envelope?: PartnerColumnEnvelope | null; readonly className?: string };
/** The Partners roster's configurable columns: a labelled checkbox list of the columns this read admits, with Show all and Reset. */ export default function ColumnChooser({ value, onValueChange, envelope = null, className }: ColumnChooserProps): ReactElement {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const optionIdBase = useId();
  const admitted = useMemo(() => admittedPartnerColumns(envelope), [envelope]);
  useDismissableLayer({ open, layerRef, triggerRef, onDismiss: () => setOpen(false) });
  useEffect(() => {
    const next = visibilityWithinAdmitted(value, admitted);
    if (next !== null) onValueChange(next);
  }, [value, admitted, onValueChange]);
  const shown = admitted.filter((column) => partnerColumnIsVisible(value, column.key));
  const optional = admitted.filter((column) => !column.admittedBy(null));
  const countLabel = COLUMN_CHOOSER_COPY.count(String(shown.length), String(admitted.length));
  const allShown = shown.length === admitted.length;
  const atDefaults = admitted.every((column) => partnerColumnIsVisible(value, column.key) === column.defaultVisible);
  function setColumn(key: PartnerColumnKey, visible: boolean): void {
    if (!visible && shown.length <= 1) return;
    const next: Record<string, boolean> = Object.fromEntries(Object.entries(value).filter(([entry]) => admitted.some((column) => column.key === entry)));
    onValueChange({ ...next, [key]: visible });
  }
  const showAllColumns = (): void => onValueChange({});
  const restoreDefaults = (): void => onValueChange(defaultVisibility(admitted));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button type="button" variant="outline" size="sm" className={cn("max-w-full", className)} aria-label={COLUMN_CHOOSER_COPY.triggerName(countLabel)} ref={triggerRef} />}>
        <Columns3Icon aria-hidden="true" />
        <span>Columns</span> <span className="tabular-figures text-xs text-muted-foreground">{countLabel}</span>
      </PopoverTrigger>
      <PopoverContent ref={layerRef} align="end" className="max-h-[min(28rem,var(--available-height),calc(100dvh-1rem))] w-80 max-w-[calc(100vw-1rem)] gap-3">
        <PopoverHeader>
          <PopoverTitle className="text-sm">Columns</PopoverTitle>
          <PopoverDescription className="text-xs">Choose which columns to show. At least one column must stay visible.</PopoverDescription>
        </PopoverHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain">
          {admitted.map((column, index) => {
            const optionId = `${optionIdBase}-${index}`;
            const hintId = `${optionId}-hint`;
            const visible = partnerColumnIsVisible(value, column.key);
            const locked = visible && shown.length === 1;
            return (
              <Label
                key={column.key}
                htmlFor={optionId}
                className={cn(
                  "flex min-h-6 shrink-0 items-start gap-2.5 rounded-xl px-2 py-1.5 font-normal leading-snug transition-colors duration-150 ease-out",
                  locked ? "cursor-not-allowed opacity-75" : "cursor-pointer hover:bg-muted/50",
                )}
              >
                <Checkbox id={optionId} className="mt-0.5" checked={visible} disabled={locked} aria-label={COLUMN_CHOOSER_COPY.optionName(column.displayName)} aria-describedby={hintId} onCheckedChange={(checked: boolean) => setColumn(column.key, checked)} />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm leading-snug text-foreground">
                    <bdi className="min-w-0 break-words">{column.displayName}</bdi>
                  </span>
                  <span {...{ id: hintId, className: cn("type-supporting text-pretty", locked ? undefined : "sr-only sm:not-sr-only") }}>{locked ? "At least one column must remain visible." : column.hint}</span>
                </div>
              </Label>
            );
          })}
        </div>
        {optional.length === 0 ? <StateNotice kind="empty" headingLevel={4} title="No extra columns in this view" description={COLUMN_CHOOSER_COPY.noOptionalBody} className="shrink-0 border-0 p-0 sm:p-0" /> : null}
        <Separator className="shrink-0" />
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button {...{ type: "button", variant: "outline", size: "sm", disabled: allShown, onClick: showAllColumns }}>Show all</Button>
          <Button {...{ type: "button", variant: "ghost", size: "sm", disabled: atDefaults, onClick: restoreDefaults }}>Reset</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
