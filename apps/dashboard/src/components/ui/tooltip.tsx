"use client";
import * as React from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { cn } from "@/lib/cn";
import { useDirection } from "@/components/ui/direction";
/** The content id and the open state a tooltip publishes to its trigger and its popup, which is what lets the trigger name a description that exists. */ type TooltipRelationship = { readonly contentId: string; readonly open: boolean };
const TooltipRelationshipContext = React.createContext<TooltipRelationship | null>(null);
/** The trigger's own references followed by the tooltip's content id, without stating an id twice and without leaving a stray space. */ function describedByOf(callerDescription: string | undefined, contentId: string): string {
  const references = (callerDescription ?? "").split(/\s+/).filter((reference) => reference.length > 0);
  if (!references.includes(contentId)) references.push(contentId);
  return references.join(" ");
}
const TooltipProvider = ({ delay = 200, timeout = 400, ...props }: TooltipPrimitive.Provider.Props) => <TooltipPrimitive.Provider data-slot="tooltip-provider" delay={delay} timeout={timeout} {...props} />;
function Tooltip({ open: controlledOpen, onOpenChange, ...props }: TooltipPrimitive.Root.Props) {
  const contentId = React.useId();
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(props.defaultOpen ?? false);
  // The popup is portalled and unmounted while the tooltip is closed, so a trigger that named it unconditionally would describe itself with an id that is not in the document. The id and the open state are therefore published together, and a caller's own `open` still decides the state while `defaultOpen` seeds it.
  const relationship = React.useMemo<TooltipRelationship>(() => ({ contentId, open: controlledOpen ?? uncontrolledOpen }), [contentId, controlledOpen, uncontrolledOpen]);
  const handleOpenChange = React.useCallback<NonNullable<TooltipPrimitive.Root.Props["onOpenChange"]>>(
    (nextOpen, eventDetails) => {
      setUncontrolledOpen(nextOpen);
      onOpenChange?.(nextOpen, eventDetails);
    },
    [onOpenChange],
  );
  return (
    <TooltipRelationshipContext.Provider value={relationship}>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} open={controlledOpen} onOpenChange={handleOpenChange} />
    </TooltipRelationshipContext.Provider>
  );
}
function TooltipTrigger({ "aria-describedby": callerDescription, ...props }: TooltipPrimitive.Trigger.Props) {
  const relationship = React.useContext(TooltipRelationshipContext);
  // The tooltip is the description only while its popup is mounted; the trigger's own description is kept as it stands.
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" aria-describedby={relationship !== null && relationship.open ? describedByOf(callerDescription, relationship.contentId) : callerDescription} {...props} />;
}
const TOOLTIP_CONTENT_CLASS =
  "z-(--z-tooltip) inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1.5 rounded-2xl bg-foreground px-3 py-1.5 text-xs text-background duration-150 ease-out has-data-[slot=kbd]:pe-1.5 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-1 **:data-[slot=kbd]:rounded-4xl data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95";
function TooltipContent({ className, side = "top", sideOffset = 4, align = "center", alignOffset = 0, children, ...props }: TooltipPrimitive.Popup.Props & Pick<TooltipPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
  const direction = useDirection();
  const contentId = React.useContext(TooltipRelationshipContext)?.contentId; // The id the trigger describes while this popup is open, so the popup is that description rather than an unrelated floating box: a caller that states its own `id` or `role` still wins, because its props are spread last.
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner align={align} alignOffset={alignOffset} side={side} sideOffset={sideOffset} collisionPadding={8} className="isolate z-(--z-tooltip)">
        <TooltipPrimitive.Popup dir={direction} role="tooltip" id={contentId} data-slot="tooltip-content" className={cn(TOOLTIP_CONTENT_CLASS, className)} {...props}>
          {children}
          <TooltipPrimitive.Arrow className="z-(--z-tooltip) size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground data-[side=bottom]:top-1 data-[side=inline-end]:top-1/2! data-[side=inline-end]:-left-1 data-[side=inline-end]:translate-x-[1.5px] data-[side=inline-end]:-translate-y-1/2 data-[side=inline-start]:top-1/2! data-[side=inline-start]:-right-1 data-[side=inline-start]:translate-x-[-1.5px] data-[side=inline-start]:-translate-y-1/2 data-[side=left]:top-1/2! data-[side=left]:-right-1 data-[side=left]:translate-x-[-1.5px] data-[side=left]:-translate-y-1/2 data-[side=right]:top-1/2! data-[side=right]:-left-1 data-[side=right]:translate-x-[1.5px] data-[side=right]:-translate-y-1/2 data-[side=top]:-bottom-2.5" />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}
export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
