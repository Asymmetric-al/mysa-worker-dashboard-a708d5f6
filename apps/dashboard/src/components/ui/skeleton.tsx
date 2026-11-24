import { cn } from "@/lib/cn";
const Skeleton = ({ className, ...props }: React.ComponentProps<"div">) => <div data-slot="skeleton" className={cn("animate-pulse rounded-xl bg-muted", className)} {...props} />;
export { Skeleton };
