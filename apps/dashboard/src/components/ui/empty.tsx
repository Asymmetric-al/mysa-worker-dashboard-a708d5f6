import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
const Empty = ({ className, ...props }: React.ComponentProps<"div">) => <div data-slot="empty" className={cn("flex w-full min-w-0 flex-1 flex-col items-center justify-center gap-4 rounded-lg border-dashed p-12 text-center text-balance", className)} {...props} />;
const EmptyHeader = ({ className, ...props }: React.ComponentProps<"div">) => <div data-slot="empty-header" className={cn("flex max-w-sm flex-col items-center gap-2", className)} {...props} />;
const emptyMediaVariants = cva("mb-2 flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0", {
  variants: { variant: { default: "bg-transparent", icon: "flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground [&_svg:not([class*='size-'])]:size-6" } },
  defaultVariants: { variant: "default" },
});
const EmptyMedia = ({ className, variant = "default", ...props }: React.ComponentProps<"div"> & VariantProps<typeof emptyMediaVariants>) => <div data-slot="empty-icon" data-variant={variant} className={cn(emptyMediaVariants({ variant, className }))} {...props} />;
export type EmptyTitleHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
const EMPTY_TITLE_HEADING_TAG: Readonly<Record<EmptyTitleHeadingLevel, "h1" | "h2" | "h3" | "h4" | "h5" | "h6">> = { 1: "h1", 2: "h2", 3: "h3", 4: "h4", 5: "h5", 6: "h6" };
function EmptyTitle({ className, headingLevel, ...props }: React.ComponentProps<"div"> & { headingLevel?: EmptyTitleHeadingLevel }) {
  const HeadingTag = headingLevel === undefined ? "div" : EMPTY_TITLE_HEADING_TAG[headingLevel];
  return <HeadingTag data-slot="empty-title" className={cn("font-heading text-lg font-medium tracking-tight", className)} {...props} />;
}
const EmptyDescription = ({ className, ...props }: React.ComponentProps<"div">) => <div data-slot="empty-description" className={cn("text-sm/relaxed text-muted-foreground [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary", className)} {...props} />;
const EmptyContent = ({ className, ...props }: React.ComponentProps<"div">) => <div data-slot="empty-content" className={cn("flex w-full max-w-sm min-w-0 flex-col items-center gap-4 text-sm text-balance", className)} {...props} />;
export { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia };
