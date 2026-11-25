"use client";
import * as React from "react";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
import { useIsMobile } from "@/components/ui/use-mobile";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PanelLeftIcon } from "lucide-react";
const SIDEBAR_COOKIE_NAME = "sidebar_state";
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const SIDEBAR_MOBILE_DIALOG_ID = "sidebar-mobile-dialog";
type SidebarContextProps = { state: "expanded" | "collapsed"; open: boolean; setOpen: (open: boolean) => void; openMobile: boolean; setOpenMobile: (open: boolean) => void; isMobile: boolean; toggleSidebar: () => void };
const SidebarContext = React.createContext<SidebarContextProps | null>(null);
function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) throw new Error("useSidebar must be used within a SidebarProvider.");
  return context;
}
function SidebarProvider({ defaultOpen = true, open: openProp, onOpenChange: setOpenProp, className, style, children, ...props }: React.ComponentProps<"div"> & { defaultOpen?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const isMobile = useIsMobile();
  const [openMobile, setOpenMobile] = React.useState(false);
  const [_open, _setOpen] = React.useState(defaultOpen);
  const open = openProp ?? _open;
  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === "function" ? value(open) : value;
      if (setOpenProp) {
        setOpenProp(openState);
      } else {
        _setOpen(openState);
      }
      const secure = window.location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `${SIDEBAR_COOKIE_NAME}=${openState}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
    },
    [setOpenProp, open],
  );
  const toggleSidebar = React.useCallback(() => {
    return isMobile ? setOpenMobile((open) => !open) : setOpen((open) => !open);
  }, [isMobile, setOpen, setOpenMobile]);
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.defaultPrevented || (target instanceof HTMLElement && target.isContentEditable) || event.key !== "b" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      toggleSidebar();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebar]);
  const state = open ? "expanded" : "collapsed";
  const contextValue = React.useMemo<SidebarContextProps>(() => ({ state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar }), [state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar]);
  return (
    <SidebarContext.Provider value={contextValue}>
      <div data-slot="sidebar-wrapper" style={{ "--sidebar-width": "16rem", "--sidebar-width-icon": "3rem", ...style } as React.CSSProperties} className={cn("group/sidebar-wrapper flex min-h-svh w-full has-data-[variant=inset]:bg-sidebar", className)} {...props}>
        {children}
      </div>
    </SidebarContext.Provider>
  );
}
function Sidebar({ side = "left", variant = "sidebar", collapsible = "offcanvas", className, children, dir, ...props }: React.ComponentProps<"div"> & { side?: "left" | "right"; variant?: "sidebar" | "floating" | "inset"; collapsible?: "offcanvas" | "icon" | "none" }) {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar();
  if (collapsible === "none") {
    return (
      <div data-slot="sidebar" className={cn("flex h-full w-(--sidebar-width) flex-col bg-sidebar text-sidebar-foreground", className)} {...props}>
        {children}
      </div>
    );
  }
  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile} {...props}>
        <SheetContent dir={dir} id={SIDEBAR_MOBILE_DIALOG_ID} aria-modal="true" data-sidebar="sidebar" data-slot="sidebar" data-mobile="true" className="w-(--sidebar-width) bg-sidebar p-0 text-sidebar-foreground [&>button]:hidden" style={{ "--sidebar-width": "18rem" } as React.CSSProperties} side={side}>
          <SheetHeader className="sr-only">
            <SheetTitle>Sidebar</SheetTitle>
            <SheetDescription>Displays the mobile sidebar.</SheetDescription>
          </SheetHeader>
          <div className="flex h-full w-full flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <div className="group peer hidden text-sidebar-foreground md:block" data-state={state} data-collapsible={state === "collapsed" ? collapsible : ""} data-variant={variant} data-side={side} data-slot="sidebar">
      <div
        data-slot="sidebar-gap"
        className={cn(
          "relative w-(--sidebar-width) bg-transparent transition-[width] duration-200 ease-linear",
          "group-data-[collapsible=offcanvas]:w-0",
          "group-data-[side=right]:rotate-180",
          variant === "floating" || variant === "inset" ? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4)))]" : "group-data-[collapsible=icon]:w-(--sidebar-width-icon)",
        )}
      />
      <div
        data-slot="sidebar-container"
        data-side={side}
        className={cn(
          "fixed inset-y-0 z-10 hidden h-svh w-(--sidebar-width) transition-[left,right,width] duration-200 ease-linear data-[side=left]:left-0 data-[side=left]:group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)] data-[side=right]:right-0 data-[side=right]:group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)] md:flex",
          variant === "floating" || variant === "inset" ? "p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)]" : "group-data-[collapsible=icon]:w-(--sidebar-width-icon) group-data-[side=left]:border-r group-data-[side=right]:border-l",
          className,
        )}
        {...props}
      >
        <div data-sidebar="sidebar" data-slot="sidebar-inner" className="flex size-full flex-col bg-sidebar group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:shadow-sm group-data-[variant=floating]:ring-1 group-data-[variant=floating]:ring-sidebar-border">
          {children}
        </div>
      </div>
    </div>
  );
}
function SidebarTrigger({ className, onClick, ...props }: React.ComponentProps<typeof Button>) {
  const { toggleSidebar, isMobile, openMobile } = useSidebar();
  return (
    <Button
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon-sm"
      className={cn(className)}
      aria-haspopup={isMobile ? "dialog" : undefined}
      aria-expanded={isMobile ? openMobile : undefined}
      aria-controls={isMobile && openMobile ? SIDEBAR_MOBILE_DIALOG_ID : undefined}
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      {...props}
    >
      <PanelLeftIcon className="rtl:-scale-x-100" />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  );
}
// The design-system separator widens itself to the whole content box, so the horizontal margins it carries here would land outside that box; the cap subtracts them from the drawn width, which is what keeps the rail's scroll content free of an overflow it hides behind `no-scrollbar`.
const SidebarHeader = ({ className, ...props }: React.ComponentProps<"div">) => <div data-slot="sidebar-header" data-sidebar="header" className={cn("flex flex-col gap-2 p-2.5", className)} {...props} />;
const SidebarFooter = ({ className, ...props }: React.ComponentProps<"div">) => <div data-slot="sidebar-footer" data-sidebar="footer" className={cn("flex flex-col gap-2 p-2.5", className)} {...props} />;
const SidebarInset = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div
    data-slot="sidebar-inset"
    className={cn(
      "relative flex min-w-0 flex-1 flex-col bg-background md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ms-0 md:peer-data-[variant=inset]:rounded-2xl md:peer-data-[variant=inset]:border md:peer-data-[variant=inset]:border-border/80 md:peer-data-[variant=inset]:shadow-xs md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ms-2 print:m-0 print:rounded-none print:border-0 print:shadow-none",
      className,
    )}
    {...props}
  />
);
const SidebarSeparator = ({ className, ...props }: React.ComponentProps<typeof Separator>) => <Separator data-slot="sidebar-separator" data-sidebar="separator" className={cn("mx-2 w-auto max-w-[calc(100%-1rem)] bg-sidebar-border", className)} {...props} />;
const SidebarContent = ({ className, ...props }: React.ComponentProps<"div">) => <div data-slot="sidebar-content" data-sidebar="content" className={cn("no-scrollbar flex min-h-0 flex-1 flex-col gap-1 overflow-auto group-data-[collapsible=icon]:overflow-hidden", className)} {...props} />;
const SidebarGroup = ({ className, ...props }: React.ComponentProps<"div">) => <div data-slot="sidebar-group" data-sidebar="group" className={cn("relative flex w-full min-w-0 flex-col p-2", className)} {...props} />;
const SidebarGroupLabel = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div
    data-slot="sidebar-group-label"
    data-sidebar="group-label"
    className={cn("flex h-7 shrink-0 items-center rounded-md px-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase transition-[margin,opacity] duration-200 ease-linear group-data-[collapsible=icon]:-mt-7 group-data-[collapsible=icon]:opacity-0", className)}
    {...props}
  />
);
const SidebarGroupContent = ({ className, ...props }: React.ComponentProps<"div">) => <div data-slot="sidebar-group-content" data-sidebar="group-content" className={cn("w-full text-sm", className)} {...props} />;
const SidebarMenu = ({ className, ...props }: React.ComponentProps<"ul">) => <ul data-slot="sidebar-menu" data-sidebar="menu" className={cn("flex w-full min-w-0 flex-col gap-0.5", className)} {...props} />;
const SidebarMenuItem = ({ className, ...props }: React.ComponentProps<"li">) => <li data-slot="sidebar-menu-item" data-sidebar="menu-item" className={cn("group/menu-item relative", className)} {...props} />;
const sidebarMenuButtonVariants = cva(
  "peer/menu-button group/menu-button flex w-full touch-manipulation items-center gap-2.5 overflow-hidden rounded-xl px-2.5 py-2 text-start text-sm text-sidebar-foreground/85 ring-sidebar-ring outline-hidden transition-[width,height,padding,background-color,color] group-has-data-[sidebar=menu-action]/menu-item:pe-8 group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-2! hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-open:hover:bg-sidebar-accent data-open:hover:text-sidebar-accent-foreground data-active:bg-card data-active:font-medium data-active:text-foreground data-active:shadow-xs data-active:ring-1 data-active:ring-border/80 [&_svg]:size-4 [&_svg]:shrink-0 [&>span:last-child]:truncate",
  {
    variants: {
      variant: { default: "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground", outline: "bg-background shadow-[0_0_0_1px_var(--sidebar-border)] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_var(--sidebar-accent)]" },
      size: { default: "h-9 text-sm", sm: "h-8 text-xs", lg: "h-14 px-3 text-sm group-data-[collapsible=icon]:p-0!" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);
function SidebarMenuButton({
  render,
  isActive = false,
  variant = "default",
  size = "default",
  tooltip,
  className,
  ...props
}: useRender.ComponentProps<"button"> & React.ComponentProps<"button"> & { isActive?: boolean; tooltip?: string | React.ComponentProps<typeof TooltipContent> } & VariantProps<typeof sidebarMenuButtonVariants>) {
  const { isMobile, state } = useSidebar();
  const showsTooltip = tooltip !== undefined && !isMobile && state === "collapsed";
  const comp = useRender({
    defaultTagName: "button",
    props: mergeProps<"button">({ className: cn(sidebarMenuButtonVariants({ variant, size }), className) }, props),
    render: showsTooltip ? <TooltipTrigger render={render} /> : render,
    state: { slot: "sidebar-menu-button", sidebar: "menu-button", size, active: isActive },
  });
  if (!showsTooltip || tooltip === undefined) return comp;
  if (typeof tooltip === "string") tooltip = { children: tooltip };
  return (
    <Tooltip>
      {comp}
      <TooltipContent side="right" align="center" {...tooltip} />
    </Tooltip>
  );
}
const SidebarMenuAction = ({ className, render, showOnHover = false, ...props }: useRender.ComponentProps<"button"> & React.ComponentProps<"button"> & { showOnHover?: boolean }) =>
  useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      {
        className: cn(
          "absolute top-1.5 end-1 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground ring-sidebar-ring outline-hidden transition-transform group-data-[collapsible=icon]:hidden peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[size=default]/menu-button:top-2 peer-data-[size=lg]/menu-button:top-2.5 peer-data-[size=sm]/menu-button:top-1 after:absolute after:-inset-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 md:after:hidden [&>svg]:size-4 [&>svg]:shrink-0",
          showOnHover && "group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 peer-data-active/menu-button:text-sidebar-accent-foreground aria-expanded:opacity-100 md:opacity-0",
          className,
        ),
      },
      props,
    ),
    render,
    state: { slot: "sidebar-menu-action", sidebar: "menu-action" },
  });
const SidebarMenuSub = ({ className, ...props }: React.ComponentProps<"ul">) => <ul data-slot="sidebar-menu-sub" data-sidebar="menu-sub" className={cn("mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-s border-sidebar-border px-2.5 py-0.5 group-data-[collapsible=icon]:hidden", className)} {...props} />;
const SidebarMenuSubItem = ({ className, ...props }: React.ComponentProps<"li">) => <li data-slot="sidebar-menu-sub-item" data-sidebar="menu-sub-item" className={cn("group/menu-sub-item relative", className)} {...props} />;
const SidebarMenuSubButton = ({ render, size = "md", isActive = false, className, ...props }: useRender.ComponentProps<"a"> & React.ComponentProps<"a"> & { size?: "sm" | "md"; isActive?: boolean }) =>
  useRender({
    defaultTagName: "a",
    props: mergeProps<"a">(
      {
        className: cn(
          "flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2 text-sidebar-foreground ring-sidebar-ring outline-hidden group-data-[collapsible=icon]:hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[size=md]:text-sm data-[size=sm]:text-xs data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-accent-foreground",
          className,
        ),
      },
      props,
    ),
    render,
    state: { slot: "sidebar-menu-sub-button", sidebar: "menu-sub-button", size, active: isActive },
  });
export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
};
