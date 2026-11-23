"use client";
import * as React from "react";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { useDirection } from "@base-ui/react/direction-provider";
import { cn } from "@/lib/cn";
import { ChevronRightIcon, CheckIcon } from "lucide-react";
const DropdownMenu = ({ ...props }: MenuPrimitive.Root.Props) => <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
const DropdownMenuPortal = ({ ...props }: MenuPrimitive.Portal.Props) => <MenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />;
const DropdownMenuTrigger = ({ ...props }: MenuPrimitive.Trigger.Props) => <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
const DROPDOWN_MENU_CONTENT_CLASS =
  "z-50 max-h-(--available-height) w-(--anchor-width) min-w-48 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-2xl bg-popover p-1 text-popover-foreground shadow-2xl ring-1 ring-foreground/5 duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 dark:ring-foreground/10 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95";
function DropdownMenuContent({ align = "start", alignOffset = 0, side = "bottom", sideOffset = 4, className, ...props }: MenuPrimitive.Popup.Props & Pick<MenuPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
  const direction = useDirection();
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner className="isolate z-50 outline-none" align={align} alignOffset={alignOffset} side={side} sideOffset={sideOffset}>
        <MenuPrimitive.Popup dir={direction} data-slot="dropdown-menu-content" className={cn(DROPDOWN_MENU_CONTENT_CLASS, className)} {...props} />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}
const DropdownMenuGroup = ({ ...props }: MenuPrimitive.Group.Props) => <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />;
const DropdownMenuLabel = ({ className, inset, ...props }: MenuPrimitive.GroupLabel.Props & { inset?: boolean }) => (
  <MenuPrimitive.Group>
    <MenuPrimitive.GroupLabel data-slot="dropdown-menu-label" data-inset={inset} className={cn("px-3 py-2.5 text-xs text-muted-foreground data-inset:ps-9.5", className)} {...props} />
  </MenuPrimitive.Group>
);
const DROPDOWN_MENU_ITEM_CLASS =
  "group/dropdown-menu-item relative flex cursor-default items-center gap-2.5 rounded-xl px-3 py-2 text-sm outline-hidden select-none focus:bg-highlight focus:text-highlight-foreground not-data-[variant=destructive]:focus:**:text-highlight-foreground data-inset:ps-9.5 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-[variant=destructive]:*:[svg]:text-destructive";
const DropdownMenuItem = ({ className, inset, variant = "default", ...props }: MenuPrimitive.Item.Props & { inset?: boolean; variant?: "default" | "destructive" }) => (
  <MenuPrimitive.Item data-slot="dropdown-menu-item" data-inset={inset} data-variant={variant} className={cn(DROPDOWN_MENU_ITEM_CLASS, className)} {...props} />
);
const DropdownMenuSub = ({ ...props }: MenuPrimitive.SubmenuRoot.Props) => <MenuPrimitive.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />;
const DROPDOWN_MENU_SUB_TRIGGER_CLASS =
  "flex cursor-default items-center gap-2 rounded-xl px-3 py-2 text-sm outline-hidden select-none focus:bg-highlight focus:text-highlight-foreground not-data-[variant=destructive]:focus:**:text-highlight-foreground data-inset:ps-9.5 data-popup-open:bg-highlight data-popup-open:text-highlight-foreground data-open:bg-highlight data-open:text-highlight-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";
const DropdownMenuSubTrigger = ({ className, inset, children, ...props }: MenuPrimitive.SubmenuTrigger.Props & { inset?: boolean }) => (
  <MenuPrimitive.SubmenuTrigger data-slot="dropdown-menu-sub-trigger" data-inset={inset} className={cn(DROPDOWN_MENU_SUB_TRIGGER_CLASS, className)} {...props}>
    {children}
    <ChevronRightIcon className="ms-auto rtl:-scale-x-100" />
  </MenuPrimitive.SubmenuTrigger>
);
const DROPDOWN_MENU_SUB_CONTENT_CLASS =
  "w-auto min-w-36 rounded-2xl bg-popover p-1 text-popover-foreground shadow-2xl ring-1 ring-foreground/5 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95";
const DropdownMenuSubContent = ({ align = "start", alignOffset = -3, side = "right", sideOffset = 0, className, ...props }: React.ComponentProps<typeof DropdownMenuContent>) => (
  <DropdownMenuContent data-slot="dropdown-menu-sub-content" className={cn(DROPDOWN_MENU_SUB_CONTENT_CLASS, className)} align={align} alignOffset={alignOffset} side={side} sideOffset={sideOffset} {...props} />
);
const DROPDOWN_CHECK_ITEM_CLASS =
  "relative flex cursor-default items-center gap-2.5 rounded-xl py-2 pe-8 ps-3 text-sm outline-hidden select-none focus:bg-highlight focus:text-highlight-foreground focus:**:text-highlight-foreground data-inset:ps-9.5 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";
const DropdownMenuCheckboxItem = ({ className, children, checked, inset, ...props }: MenuPrimitive.CheckboxItem.Props & { inset?: boolean }) => (
  <MenuPrimitive.CheckboxItem data-slot="dropdown-menu-checkbox-item" data-inset={inset} className={cn(DROPDOWN_CHECK_ITEM_CLASS, className)} checked={checked} {...props}>
    <span className="pointer-events-none absolute end-2 flex items-center justify-center" data-slot="dropdown-menu-checkbox-item-indicator">
      <MenuPrimitive.CheckboxItemIndicator>
        <CheckIcon />
      </MenuPrimitive.CheckboxItemIndicator>
    </span>
    {children}
  </MenuPrimitive.CheckboxItem>
);
const DropdownMenuRadioGroup = ({ ...props }: MenuPrimitive.RadioGroup.Props) => <MenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
const DropdownMenuRadioItem = ({ className, children, inset, ...props }: MenuPrimitive.RadioItem.Props & { inset?: boolean }) => (
  <MenuPrimitive.RadioItem data-slot="dropdown-menu-radio-item" data-inset={inset} className={cn(DROPDOWN_CHECK_ITEM_CLASS, className)} {...props}>
    <span className="pointer-events-none absolute end-2 flex items-center justify-center" data-slot="dropdown-menu-radio-item-indicator">
      <MenuPrimitive.RadioItemIndicator>
        <CheckIcon />
      </MenuPrimitive.RadioItemIndicator>
    </span>
    {children}
  </MenuPrimitive.RadioItem>
);
const DropdownMenuSeparator = ({ className, ...props }: MenuPrimitive.Separator.Props) => <MenuPrimitive.Separator data-slot="dropdown-menu-separator" className={cn("-mx-1 my-1 h-px bg-border/50", className)} {...props} />;
const DropdownMenuShortcut = ({ className, ...props }: React.ComponentProps<"span">) => <span data-slot="dropdown-menu-shortcut" className={cn("ms-auto text-xs tracking-widest text-muted-foreground group-focus/dropdown-menu-item:text-accent-foreground", className)} {...props} />;
export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
};
