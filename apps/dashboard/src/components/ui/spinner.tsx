import { cn } from "@/lib/cn";
import { Loader2Icon } from "lucide-react";

/* The icon is decorative on its own: it shows the busy state visually and stays out of the
 * accessibility tree, so the pattern that renders it announces the state once — through a
 * visible status line or `aria-busy` on the region — in the reader's own language instead of
 * a second, fixed "Loading" name beside the owner's text.
 */
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      data-slot="spinner"
      aria-hidden="true"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
