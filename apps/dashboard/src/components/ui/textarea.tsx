"use client";
import * as React from "react";
import { cn } from "@/lib/cn";
const TEXTAREA_CLASS =
  "flex field-sizing-content min-h-16 w-full resize-none rounded-xl border border-input bg-control-surface px-3 py-3 text-base transition-colors duration-150 ease-out outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-invalid-border aria-invalid:ring-[3px] aria-invalid:ring-invalid-ring md:text-sm";
const Textarea = ({ className, onKeyDown, ...props }: React.ComponentProps<"textarea">) => (
  <textarea
    data-slot="textarea"
    className={cn(TEXTAREA_CLASS, className)}
    onKeyDown={(event) => {
      onKeyDown?.(event);
      if (event.defaultPrevented || event.nativeEvent.isComposing) return;
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && event.currentTarget.form !== null) {
        event.preventDefault();
        event.currentTarget.form.requestSubmit();
      }
    }}
    {...props}
  />
);
export { Textarea };
