"use client";
import * as React from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { cn } from "@/lib/cn";
import { useDirection } from "@/components/ui/direction";
const Popover = ({ ...props }: PopoverPrimitive.Root.Props) => <PopoverPrimitive.Root data-slot="popover" {...props} />;
const PopoverTrigger = ({ ...props }: PopoverPrimitive.Trigger.Props) => <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
const POPOVER_CONTENT_CLASS =
  "z-(--z-popover) flex max-h-[min(var(--available-height),calc(100dvh-1rem))] w-72 max-w-[min(var(--available-width),calc(100vw-1rem))] origin-(--transform-origin) flex-col gap-4 overflow-y-auto overscroll-contain rounded-2xl bg-popover p-4 text-sm text-popover-foreground shadow-overlay outline-hidden duration-150 ease-out data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95";
function PopoverContent({ className, align = "center", alignOffset = 0, side = "bottom", sideOffset = 4, ...props }: PopoverPrimitive.Popup.Props & Pick<PopoverPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
  const direction = useDirection();
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner align={align} alignOffset={alignOffset} side={side} sideOffset={sideOffset} collisionPadding={8} className="isolate z-(--z-popover)">
        <PopoverPrimitive.Popup dir={direction} data-slot="popover-content" className={cn(POPOVER_CONTENT_CLASS, className)} {...props} />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}
const PopoverHeader = ({ className, ...props }: React.ComponentProps<"div">) => <div data-slot="popover-header" className={cn("flex flex-col gap-1 text-sm", className)} {...props} />;
const PopoverTitle = ({ className, ...props }: PopoverPrimitive.Title.Props) => <PopoverPrimitive.Title data-slot="popover-title" className={cn("text-base font-medium", className)} {...props} />;
const PopoverDescription = ({ className, ...props }: PopoverPrimitive.Description.Props) => <PopoverPrimitive.Description data-slot="popover-description" className={cn("text-muted-foreground", className)} {...props} />;
export { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger };
