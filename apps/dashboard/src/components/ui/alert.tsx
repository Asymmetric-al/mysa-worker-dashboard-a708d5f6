import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/**
 * Registry source for `base-maia/alert`, kept as emitted except for three departures the
 * intended surfaces in this application require: direction utilities are logical
 * (`text-start`, `pe-18`, `end-3`) so the alert mirrors its alignment, action inset and
 * reserved padding in right-to-left authoring and reading; `wrap-anywhere` stops a long
 * opaque source reference or operation id from widening the page at 320 CSS px; and
 * `alertVariants` is exported so a caller composing the same surface elsewhere reuses the
 * one variant definition instead of restating the classes. Colour, radius and spacing come
 * from the semantic tokens alone, so the variant never encodes a meaning.
 */
const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-lg border px-4 py-3 text-start text-sm wrap-anywhere has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pe-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2.5 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        destructive:
          "bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90 *:[svg]:text-current",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

/**
 * Inline explanation or warning: an unavailable source, partial coverage, a simulated
 * effect, a validation summary or a limitation note. The urgency it carries is its text,
 * never its colour, so `default` and `destructive` differ in emphasis rather than in
 * meaning. It defaults to `role="alert"`; a caller rendering a static explanation passes
 * `role={undefined}` so the one announcing region stays the caller's own.
 */
function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-sm text-balance text-muted-foreground md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
        className,
      )}
      {...props}
    />
  );
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="alert-action" className={cn("absolute top-2.5 end-3", className)} {...props} />
  );
}

export { Alert, AlertTitle, AlertDescription, AlertAction, alertVariants };
