"use client";
import * as React from "react";
import { Combobox as ComboboxPrimitive } from "@base-ui/react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { useDirection } from "@/components/ui/direction";
import { ChevronDownIcon, XIcon, CheckIcon } from "lucide-react";
const Combobox = ComboboxPrimitive.Root;
const ComboboxValue = ({ ...props }: ComboboxPrimitive.Value.Props) => <ComboboxPrimitive.Value data-slot="combobox-value" {...props} />;
const ComboboxTrigger = ({ className, children, "aria-label": ariaLabel, ...props }: ComboboxPrimitive.Trigger.Props) => (
  <ComboboxPrimitive.Trigger data-slot="combobox-trigger" aria-label={ariaLabel ?? (children == null ? "Show options" : undefined)} className={cn("[&_svg:not([class*='size-'])]:size-4", className)} {...props}>
    {children}
    <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
  </ComboboxPrimitive.Trigger>
);
const ComboboxClear = ({ className, ...props }: ComboboxPrimitive.Clear.Props) => (
  <ComboboxPrimitive.Clear data-slot="combobox-clear" aria-label="Clear selection" render={<InputGroupButton variant="ghost" size="icon-xs" />} className={cn(className)} {...props}>
    <XIcon className="pointer-events-none" />
  </ComboboxPrimitive.Clear>
);
const ComboboxInput = ({ className, children, disabled = false, showTrigger = true, showClear = false, ...props }: ComboboxPrimitive.Input.Props & { showTrigger?: boolean; showClear?: boolean }) => (
  <InputGroup className={cn("w-auto", className)}>
    <ComboboxPrimitive.Input render={<InputGroupInput disabled={disabled} />} {...props} />
    <InputGroupAddon align="inline-end">
      {showTrigger && <InputGroupButton size="icon-xs" variant="ghost" render={<ComboboxTrigger />} data-slot="input-group-button" className="group-has-data-[slot=combobox-clear]/input-group:hidden data-pressed:bg-transparent" disabled={disabled} />}
      {showClear && <ComboboxClear disabled={disabled} />}
    </InputGroupAddon>
    {children}
  </InputGroup>
);
const COMBOBOX_CONTENT_CLASS =
  "group/combobox-content relative max-h-(--available-height) w-(--anchor-width) max-w-(--available-width) min-w-[calc(var(--anchor-width)+--spacing(7))] origin-(--transform-origin) overflow-hidden rounded-2xl bg-popover text-popover-foreground shadow-overlay duration-150 ease-out data-[chips=true]:min-w-(--anchor-width) data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 *:data-[slot=input-group]:m-1 *:data-[slot=input-group]:mb-0 *:data-[slot=input-group]:h-9 *:data-[slot=input-group]:border-none *:data-[slot=input-group]:bg-control-surface *:data-[slot=input-group]:shadow-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95";
function ComboboxContent({ className, side = "bottom", sideOffset = 6, align = "start", alignOffset = 0, anchor, ...props }: ComboboxPrimitive.Popup.Props & Pick<ComboboxPrimitive.Positioner.Props, "side" | "align" | "sideOffset" | "alignOffset" | "anchor">) {
  const direction = useDirection();
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner side={side} sideOffset={sideOffset} align={align} alignOffset={alignOffset} anchor={anchor} collisionPadding={8} className="isolate z-(--z-popover)">
        <ComboboxPrimitive.Popup dir={direction} data-slot="combobox-content" data-chips={!!anchor} className={cn(COMBOBOX_CONTENT_CLASS, className)} {...props} />
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  );
}
const ComboboxList = ({ className, ...props }: ComboboxPrimitive.List.Props) => (
  <ComboboxPrimitive.List data-slot="combobox-list" className={cn("no-scrollbar max-h-[min(calc(--spacing(72)---spacing(9)),calc(var(--available-height)---spacing(9)))] scroll-py-1 overflow-y-auto overscroll-contain p-1 data-empty:p-0", className)} {...props} />
);
const COMBOBOX_ITEM_CLASS =
  "relative flex w-full cursor-default items-center gap-2.5 rounded-xl py-2 pe-8 ps-3 text-sm outline-hidden select-none data-highlighted:bg-highlight data-highlighted:text-highlight-foreground not-data-[variant=destructive]:data-highlighted:**:text-highlight-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";
const ComboboxItem = ({ className, children, ...props }: ComboboxPrimitive.Item.Props) => (
  <ComboboxPrimitive.Item data-slot="combobox-item" className={cn(COMBOBOX_ITEM_CLASS, className)} {...props}>
    {children}
    <ComboboxPrimitive.ItemIndicator render={<span className="pointer-events-none absolute end-2 flex size-4 items-center justify-center" />}>
      <CheckIcon className="pointer-events-none" />
    </ComboboxPrimitive.ItemIndicator>
  </ComboboxPrimitive.Item>
);
const ComboboxGroup = ({ className, ...props }: ComboboxPrimitive.Group.Props) => <ComboboxPrimitive.Group data-slot="combobox-group" className={cn(className)} {...props} />;
const ComboboxLabel = ({ className, ...props }: ComboboxPrimitive.GroupLabel.Props) => <ComboboxPrimitive.GroupLabel data-slot="combobox-label" className={cn("px-3.5 py-2.5 text-xs text-muted-foreground", className)} {...props} />;
const ComboboxCollection = ({ ...props }: ComboboxPrimitive.Collection.Props) => <ComboboxPrimitive.Collection data-slot="combobox-collection" {...props} />;
const ComboboxEmpty = ({ className, ...props }: ComboboxPrimitive.Empty.Props) => <ComboboxPrimitive.Empty data-slot="combobox-empty" className={cn("hidden w-full justify-center py-2 text-center text-sm text-muted-foreground group-data-empty/combobox-content:flex", className)} {...props} />;
const ComboboxSeparator = ({ className, ...props }: ComboboxPrimitive.Separator.Props) => <ComboboxPrimitive.Separator data-slot="combobox-separator" className={cn("-mx-1 my-1 h-px bg-border/50", className)} {...props} />;
const COMBOBOX_CHIPS_CLASS =
  "flex min-h-9 flex-wrap items-center gap-1.5 rounded-4xl border border-input bg-control-surface bg-clip-padding px-2.5 py-1.5 text-base transition-colors duration-150 ease-out focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring has-aria-invalid:border-invalid-border has-aria-invalid:ring-[3px] has-aria-invalid:ring-invalid-ring has-data-[slot=combobox-chip]:px-1.5 md:text-sm";
const ComboboxChips = ({ className, ...props }: React.ComponentPropsWithRef<typeof ComboboxPrimitive.Chips> & ComboboxPrimitive.Chips.Props) => <ComboboxPrimitive.Chips data-slot="combobox-chips" className={cn(COMBOBOX_CHIPS_CLASS, className)} {...props} />;
const COMBOBOX_CHIP_CLASS =
  "flex h-[calc(--spacing(5.5))] w-fit items-center justify-center gap-1 rounded-4xl bg-muted-foreground/10 px-2 text-xs font-medium whitespace-nowrap text-foreground has-disabled:pointer-events-none has-disabled:cursor-not-allowed has-disabled:opacity-50 has-data-[slot=combobox-chip-remove]:pe-0";
const ComboboxChip = ({ className, children, showRemove = true, ...props }: ComboboxPrimitive.Chip.Props & { showRemove?: boolean }) => (
  <ComboboxPrimitive.Chip data-slot="combobox-chip" className={cn(COMBOBOX_CHIP_CLASS, className)} {...props}>
    {children}
    {showRemove && (
      <ComboboxPrimitive.ChipRemove render={<Button variant="ghost" size="icon-xs" />} aria-label={typeof children === "string" ? `Remove ${children}` : "Remove selection"} className="-ms-1 opacity-50 hover:opacity-100" data-slot="combobox-chip-remove">
        <XIcon className="pointer-events-none" />
      </ComboboxPrimitive.ChipRemove>
    )}
  </ComboboxPrimitive.Chip>
);
const ComboboxChipsInput = ({ className, ...props }: ComboboxPrimitive.Input.Props) => <ComboboxPrimitive.Input data-slot="combobox-chip-input" className={cn("min-h-6 min-w-16 flex-1 text-base outline-none md:text-sm", className)} {...props} />;
const useComboboxAnchor = () => React.useRef<HTMLDivElement | null>(null);
export { Combobox, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem, ComboboxGroup, ComboboxLabel, ComboboxCollection, ComboboxEmpty, ComboboxSeparator, ComboboxChips, ComboboxChip, ComboboxChipsInput, ComboboxTrigger, ComboboxValue, useComboboxAnchor };
