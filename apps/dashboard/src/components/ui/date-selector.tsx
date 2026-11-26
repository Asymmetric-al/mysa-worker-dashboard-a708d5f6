"use client";
import * as React from "react";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { buildCivilMonthGrid, formatCivilMonthTitle, isDateInRange, monthFromIsoDate, shiftCivilMonth, validateCivilDateRange, weekdayLabels, type CivilDateRange, type CivilMonth } from "@/lib/civil-calendar";
import { cn } from "@/lib/cn";

export type DateSelectorPreset = {
  readonly id: string;
  readonly label: string;
};

export type DateSelectorValue =
  | { readonly kind: "preset"; readonly preset: string }
  | { readonly kind: "custom"; readonly from: string; readonly to: string };

export type DateSelectorProps = {
  readonly value: DateSelectorValue;
  readonly presets: readonly DateSelectorPreset[];
  readonly onChange: (next: DateSelectorValue) => void;
  /** Reference civil date (`YYYY-MM-DD`) to open the calendar near when a preset is active. */
  readonly anchorDate?: string;
  readonly locale?: string;
  readonly triggerLabel?: string;
  readonly className?: string;
};

const FALLBACK_MONTH: CivilMonth = { year: 2026, month: 1 };

function summaryLabelOf(value: DateSelectorValue, presets: readonly DateSelectorPreset[]): string {
  if (value.kind === "custom") return `${value.from} – ${value.to}`;
  return presets.find((preset) => preset.id === value.preset)?.label ?? value.preset;
}

/**
 * ReUI-inspired Date Selector (`@reui/date-selector`) combining period presets,
 * an interactive civil-date month calendar, and explicit YYYY-MM-DD inputs.
 * Built strictly on Base UI `Popover` + `Temporal.PlainDate` (zero TZ shift, RTL-safe).
 */
export function DateSelector({ value, presets, onChange, anchorDate, locale, triggerLabel = "Date range", className }: DateSelectorProps) {
  const [open, setOpen] = React.useState(false);
  const fromInputId = React.useId();
  const toInputId = React.useId();
  const errorId = React.useId();

  const initialFrom = value.kind === "custom" ? value.from : (anchorDate ?? "");
  const initialTo = value.kind === "custom" ? value.to : (anchorDate ?? "");
  const [draftFrom, setDraftFrom] = React.useState(initialFrom);
  const [draftTo, setDraftTo] = React.useState(initialTo);
  const [pickingEnd, setPickingEnd] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [visibleMonth, setVisibleMonth] = React.useState<CivilMonth>(() => monthFromIsoDate(value.kind === "custom" ? value.from : anchorDate, FALLBACK_MONTH));

  const syncDrafts = React.useCallback(() => {
    const nextFrom = value.kind === "custom" ? value.from : (anchorDate ?? "");
    const nextTo = value.kind === "custom" ? value.to : (anchorDate ?? "");
    setDraftFrom(nextFrom);
    setDraftTo(nextTo);
    setPickingEnd(false);
    setError(null);
    setVisibleMonth(monthFromIsoDate(nextFrom || anchorDate, FALLBACK_MONTH));
  }, [anchorDate, value]);

  const handleOpenChange = (nextOpen: boolean): void => {
    if (nextOpen) syncDrafts();
    setOpen(nextOpen);
  };

  const days = React.useMemo(() => buildCivilMonthGrid(visibleMonth, "sunday"), [visibleMonth]);
  const weekdays = React.useMemo(() => weekdayLabels(locale, "sunday"), [locale]);
  const monthTitle = React.useMemo(() => formatCivilMonthTitle(visibleMonth, locale), [visibleMonth, locale]);

  const handleDaySelect = (iso: string): void => {
    setError(null);
    if (!pickingEnd || draftFrom === "") {
      setDraftFrom(iso);
      setDraftTo(iso);
      setPickingEnd(true);
      return;
    }
    if (iso < draftFrom) {
      setDraftTo(draftFrom);
      setDraftFrom(iso);
    } else {
      setDraftTo(iso);
    }
    setPickingEnd(false);
  };

  const applyCustomRange = (range?: CivilDateRange): void => {
    const checked = range === undefined ? validateCivilDateRange(draftFrom, draftTo) : { ok: true as const, range };
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    setError(null);
    onChange({ kind: "custom", from: checked.range.from, to: checked.range.to });
    setOpen(false);
  };

  const applyPreset = (presetId: string): void => {
    setError(null);
    onChange({ kind: "preset", preset: presetId });
    setOpen(false);
  };

  const activeSummary = summaryLabelOf(value, presets);
  const isCustom = value.kind === "custom";

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-slot="date-selector-trigger"
            aria-label={`${triggerLabel}: ${activeSummary}`}
            className={cn("h-8 min-h-8 max-w-full gap-1.5 text-xs", isCustom && "border-foreground/30 bg-card text-foreground", className)}
          />
        }
      >
        <CalendarIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">
          <bdi>{activeSummary}</bdi>
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(23rem,calc(100vw-2rem))] gap-3 p-3.5">
        <PopoverHeader>
          <PopoverTitle className="text-sm">{triggerLabel}</PopoverTitle>
          <PopoverDescription className="text-xs">Choose a preset period or pick exact calendar start and end dates.</PopoverDescription>
        </PopoverHeader>

        <fieldset className="m-0 flex flex-wrap gap-1.5 border-0 p-0" aria-label="Preset periods">
          {presets.map((preset) => {
            const active = value.kind === "preset" && value.preset === preset.id;
            return (
              <Button
                key={preset.id}
                type="button"
                variant={active ? "default" : "outline"}
                size="sm"
                aria-pressed={active}
                onClick={() => applyPreset(preset.id)}
                className="h-7 min-h-7 px-2.5 text-xs"
              >
                {preset.label}
              </Button>
            );
          })}
        </fieldset>

        <Separator />

        <div data-slot="date-selector-calendar" className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Previous month"
              onClick={() => setVisibleMonth((current) => shiftCivilMonth(current, -1))}
            >
              <ChevronLeftIcon aria-hidden="true" className="size-4 rtl:rotate-180" />
            </Button>
            <span className="text-xs font-medium text-foreground">
              <bdi>{monthTitle}</bdi>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Next month"
              onClick={() => setVisibleMonth((current) => shiftCivilMonth(current, 1))}
            >
              <ChevronRightIcon aria-hidden="true" className="size-4 rtl:rotate-180" />
            </Button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 text-center" aria-hidden="true">
            {weekdays.map((dayName) => (
              <span key={dayName} className="py-1 text-xs font-medium text-muted-foreground">
                {dayName}
              </span>
            ))}
          </div>

          <fieldset className="m-0 grid grid-cols-7 gap-0.5 border-0 p-0" aria-label={`Calendar days for ${monthTitle}`}>
            {days.map((cell) => {
              const isStart = draftFrom !== "" && cell.iso === draftFrom;
              const isEnd = draftTo !== "" && cell.iso === draftTo;
              const inRange = isDateInRange(cell.iso, draftFrom || null, draftTo || null);
              return (
                <button
                  key={cell.iso}
                  type="button"
                  aria-label={cell.iso}
                  aria-pressed={isStart || isEnd}
                  onClick={() => handleDaySelect(cell.iso)}
                  className={cn(
                    "inline-flex min-h-7 min-w-7 cursor-pointer items-center justify-center rounded-lg text-xs font-medium tabular-figures transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--ring)]",
                    isStart || isEnd
                      ? "bg-primary text-primary-foreground"
                      : inRange
                        ? "bg-secondary text-secondary-foreground"
                        : cell.inMonth
                          ? "text-foreground hover:bg-muted"
                          : "text-muted-foreground/60 hover:bg-muted/60",
                  )}
                >
                  {cell.day}
                </button>
              );
            })}
          </fieldset>
          <p className="text-xs text-pretty text-muted-foreground" aria-live="polite">
            {pickingEnd ? "Select an end date on the calendar, or click Apply range for this single day." : "Click a start date on the calendar or enter dates below."}
          </p>
        </div>

        <Separator />

        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            applyCustomRange();
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={fromInputId} className="text-xs">
                Start date
              </Label>
              <Input
                id={fromInputId}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                placeholder="YYYY-MM-DD"
                value={draftFrom}
                aria-invalid={error !== null ? true : undefined}
                aria-describedby={error !== null ? errorId : undefined}
                onChange={(event) => {
                  setDraftFrom(event.target.value);
                  setError(null);
                }}
                className="h-8 text-base md:text-xs mono-identifier"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={toInputId} className="text-xs">
                End date
              </Label>
              <Input
                id={toInputId}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                placeholder="YYYY-MM-DD"
                value={draftTo}
                aria-invalid={error !== null ? true : undefined}
                aria-describedby={error !== null ? errorId : undefined}
                onChange={(event) => {
                  setDraftTo(event.target.value);
                  setError(null);
                }}
                className="h-8 text-base md:text-xs mono-identifier"
              />
            </div>
          </div>

          {error === null ? null : (
            <p id={errorId} role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm">
              Apply range
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

export default DateSelector;
