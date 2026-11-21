"use client"

import { Radio as RadioPrimitive } from "@base-ui/react/radio"
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group"
import { cn } from "@/lib/cn"

/**
 * The one single-choice group: the short choices that stay visible while the whole set is read — the
 * reach of a page, publish versus publish and notify, the target period of a goal — where a closed
 * select would hide the alternatives the choice is about.
 *
 * `orientation` is the group's layout axis, `"vertical"` (the default) or `"horizontal"`. It is the
 * component's own prop, destructured out of the props forwarded to the primitive, because the Base UI
 * root documents none: its composite moves the selection with every arrow key in either layout, so the
 * value decides the layout only and can be overridden at any call site without touching behaviour. A
 * horizontal row wraps rather than overflowing, so the choices still fit a 320 CSS px viewport and the
 * page never scrolls sideways. Spacing comes from the token scale alone; no colour, radius or shadow is
 * stated here.
 *
 * The group's `items` are the `RadioGroupItem`s passed as children. Each one keeps the label,
 * description and error association that the composing form owns through `components/field` and
 * `components/form-field`, so an `items` array rendered here would repeat that composition instead of
 * reusing it.
 */
function RadioGroup({
  className,
  orientation = "vertical",
  ...props
}: RadioGroupPrimitive.Props & { orientation?: "vertical" | "horizontal" }) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      data-orientation={orientation}
      aria-orientation={orientation}
      className={cn(
        "group/radio-group w-full",
        orientation === "horizontal"
          ? "flex flex-wrap items-center gap-x-6 gap-y-3"
          : "grid gap-3",
        className
      )}
      {...props}
    />
  )
}

function RadioGroupItem({ className, ...props }: RadioPrimitive.Root.Props) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-group-item"
      className={cn(
"group/radio-group-item peer relative flex aspect-square size-4 shrink-0 rounded-full border border-input outline-none group-has-[:focus-visible]/field-label:ring-0 group-has-[:focus-visible]/field-label:not-data-checked:border-input after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring data-disabled:cursor-not-allowed data-disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground group-has-[:focus-visible]/field-label:data-checked:border-primary dark:data-checked:bg-primary",
        className
      )}
      {...props}
    >
      <RadioPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="flex size-4 items-center justify-center"
      >
        <span className="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-foreground" />
      </RadioPrimitive.Indicator>
    </RadioPrimitive.Root>
  )
}

export { RadioGroup, RadioGroupItem }
