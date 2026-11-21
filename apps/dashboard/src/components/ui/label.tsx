"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/* The consumer supplies `htmlFor`: form-field owns the id, aria-describedby and
 * aria-invalid wiring in one place, so this primitive forwards the prop rather than
 * deriving one from the control it happens to sit beside.
 */
function Label({ className, htmlFor, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      htmlFor={htmlFor}
      {...props}
    />
  );
}

export { Label };
