"use client"

import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog"
import type { VariantProps } from "class-variance-authority"
import { cn } from "@/lib/cn"

import { Button, buttonVariants } from "@/components/ui/button"
import { useDirection } from "@/components/ui/direction"

function AlertDialog({ ...props }: AlertDialogPrimitive.Root.Props) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogTrigger({ ...props }: AlertDialogPrimitive.Trigger.Props) {
  return (
    <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
  )
}

function AlertDialogPortal({ ...props }: AlertDialogPrimitive.Portal.Props) {
  return (
    <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
  )
}

function AlertDialogOverlay({
  className,
  ...props
}: AlertDialogPrimitive.Backdrop.Props) {
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot="alert-dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-overlay/80 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogContent({
  className,
  size = "default",
  ...props
}: AlertDialogPrimitive.Popup.Props & {
  size?: "default" | "sm"
}) {
  // The direction provider is React context only, so portalled content would otherwise follow
  // the page rather than the application. Stating it here keeps the alert dialog in that direction.
  const direction = useDirection()
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      {/* BLITZY [LAYOUT]: the registry panel is centred with no height bound, so a long
          explanation of a consequential action — a withdrawal, a stopped series, a revoked
          grant — ran off both edges of a short viewport with no way to reach the confirm and
          cancel actions. Capping the panel to the viewport and scrolling the panel body keeps
          the page itself unscrollable while the dialog is open and keeps keyboard focus inside
          the visible area, which is what WCAG 2.2 reflow and Focus Not Obscured assume. The
          registry's own max-width rules are left untouched. */}
      <AlertDialogPrimitive.Popup
        dir={direction}
        data-slot="alert-dialog-content"
        data-size={size}
        className={cn(
          "group/alert-dialog-content fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-full -translate-x-1/2 -translate-y-1/2 gap-6 overflow-y-auto overscroll-contain rounded-4xl bg-popover p-6 text-popover-foreground ring-1 ring-foreground/5 duration-100 outline-none data-[size=default]:max-w-xs data-[size=sm]:max-w-xs data-[size=default]:sm:max-w-md data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      />
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn(
        "grid grid-rows-[auto_1fr] place-items-center gap-1.5 text-center has-data-[slot=alert-dialog-media]:grid-rows-[auto_auto_1fr] has-data-[slot=alert-dialog-media]:gap-x-6 sm:group-data-[size=default]/alert-dialog-content:place-items-start sm:group-data-[size=default]/alert-dialog-content:text-start sm:group-data-[size=default]/alert-dialog-content:has-data-[slot=alert-dialog-media]:grid-rows-[auto_1fr]",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        /* BLITZY [LAYOUT]: the registry's stacked footer keeps the shared button label
         * on one unbreakable line at the shared button's fixed height, so below a phone
         * width each action was wider than the panel and the confirm and cancel labels were
         * clipped at the panel edge with no scroll position showing them in full. Letting the
         * stacked actions shrink, wrap and grow past the shared fixed height keeps both labels
         * readable and inside their own control, with the 24px target floor still held by
         * min-h-9. The side-by-side layout at sm and above is untouched.
         */
        "flex flex-col-reverse gap-2 group-data-[size=sm]/alert-dialog-content:grid group-data-[size=sm]/alert-dialog-content:grid-cols-2 max-sm:*:h-auto max-sm:*:min-w-0 max-sm:*:whitespace-normal max-sm:*:min-h-9 max-sm:*:py-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogMedia({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-media"
      className={cn(
        "mb-2 inline-flex size-16 items-center justify-center rounded-full bg-muted sm:group-data-[size=default]/alert-dialog-content:row-span-2 *:[svg:not([class*='size-'])]:size-8",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn(
        "font-heading text-lg font-medium sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn(
        "text-sm text-balance text-muted-foreground md:text-pretty *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

/* The confirmation control of a consequential action takes its styling from the one name this
 * surface documents: `confirmVariant`. `destructive` is what a withdrawal, a stopped series, a
 * revoked grant or a discarded draft takes, and every other value comes from the shared Button's
 * own scale, so the confirm action states no colour of its own. The Button's `variant` prop is
 * omitted from the accepted props on purpose: `confirmVariant` is the single documented route, so
 * a caller cannot style this action two ways.
 */
type AlertDialogConfirmVariant = NonNullable<
  VariantProps<typeof buttonVariants>["variant"]
>

function AlertDialogAction({
  className,
  confirmVariant = "default",
  ...props
}: Omit<React.ComponentProps<typeof Button>, "variant"> & {
  confirmVariant?: AlertDialogConfirmVariant
}) {
  return (
    <Button
      data-slot="alert-dialog-action"
      className={cn(className)}
      variant={confirmVariant}
      {...props}
    />
  )
}

function AlertDialogCancel({
  className,
  variant = "outline",
  size = "default",
  ...props
}: AlertDialogPrimitive.Close.Props &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-cancel"
      className={cn(className)}
      render={<Button variant={variant} size={size} />}
      {...props}
    />
  )
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
}
