"use client";
import * as React from "react";
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import type { VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
import { Button, buttonVariants } from "@/components/ui/button";
import { useDirection } from "@/components/ui/direction";
const AlertDialog = ({ ...props }: AlertDialogPrimitive.Root.Props) => <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
const AlertDialogTrigger = ({ ...props }: AlertDialogPrimitive.Trigger.Props) => <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />;
const AlertDialogPortal = ({ ...props }: AlertDialogPrimitive.Portal.Props) => <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />;
const AlertDialogOverlay = ({ className, ...props }: AlertDialogPrimitive.Backdrop.Props) => (
  <AlertDialogPrimitive.Backdrop data-slot="alert-dialog-overlay" className={cn("fixed inset-0 isolate z-50 bg-overlay/80 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0", className)} {...props} />
);
const ALERT_DIALOG_CONTENT_CLASS =
  "group/alert-dialog-content fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-full -translate-x-1/2 -translate-y-1/2 gap-6 overflow-y-auto overscroll-contain rounded-4xl bg-popover p-6 text-popover-foreground ring-1 ring-foreground/5 duration-100 outline-none data-[size=default]:max-w-xs data-[size=sm]:max-w-xs data-[size=default]:sm:max-w-md data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95";
function AlertDialogContent({ className, size = "default", ...props }: AlertDialogPrimitive.Popup.Props & { size?: "default" | "sm" }) {
  const direction = useDirection();
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Popup dir={direction} data-slot="alert-dialog-content" data-size={size} aria-modal="true" className={cn(ALERT_DIALOG_CONTENT_CLASS, className)} {...props} />
    </AlertDialogPortal>
  );
}
const ALERT_DIALOG_HEADER_CLASS =
  "grid grid-rows-[auto_1fr] place-items-center gap-1.5 text-center has-data-[slot=alert-dialog-media]:grid-rows-[auto_auto_1fr] has-data-[slot=alert-dialog-media]:gap-x-6 sm:group-data-[size=default]/alert-dialog-content:place-items-start sm:group-data-[size=default]/alert-dialog-content:text-start sm:group-data-[size=default]/alert-dialog-content:has-data-[slot=alert-dialog-media]:grid-rows-[auto_1fr]";
const AlertDialogHeader = ({ className, ...props }: React.ComponentProps<"div">) => <div data-slot="alert-dialog-header" className={cn(ALERT_DIALOG_HEADER_CLASS, className)} {...props} />;
const AlertDialogFooter = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div data-slot="alert-dialog-footer" className={cn("flex flex-col-reverse gap-2 group-data-[size=sm]/alert-dialog-content:grid group-data-[size=sm]/alert-dialog-content:grid-cols-2 max-sm:*:h-auto max-sm:*:min-w-0 max-sm:*:whitespace-normal sm:flex-row sm:justify-end", className)} {...props} />
);
const AlertDialogMedia = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div data-slot="alert-dialog-media" className={cn("mb-2 inline-flex size-16 items-center justify-center rounded-full bg-muted sm:group-data-[size=default]/alert-dialog-content:row-span-2 *:[svg:not([class*='size-'])]:size-8", className)} {...props} />
);
const AlertDialogTitle = ({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Title>) => (
  <AlertDialogPrimitive.Title data-slot="alert-dialog-title" className={cn("font-heading text-lg font-medium sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2", className)} {...props} />
);
const AlertDialogDescription = ({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Description>) => (
  <AlertDialogPrimitive.Description data-slot="alert-dialog-description" className={cn("text-sm text-balance text-muted-foreground md:text-pretty *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground", className)} {...props} />
);
type AlertDialogConfirmVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
const AlertDialogAction = ({ className, confirmVariant = "default", ...props }: Omit<React.ComponentProps<typeof Button>, "variant"> & { confirmVariant?: AlertDialogConfirmVariant }) => <Button data-slot="alert-dialog-action" className={cn(className)} variant={confirmVariant} {...props} />;
const AlertDialogCancel = ({ className, variant = "outline", size = "default", ...props }: AlertDialogPrimitive.Close.Props & Pick<React.ComponentProps<typeof Button>, "variant" | "size">) => (
  <AlertDialogPrimitive.Close data-slot="alert-dialog-cancel" className={cn(className)} render={<Button variant={variant} size={size} />} {...props} />
);
export { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogOverlay, AlertDialogPortal, AlertDialogTitle, AlertDialogTrigger };
