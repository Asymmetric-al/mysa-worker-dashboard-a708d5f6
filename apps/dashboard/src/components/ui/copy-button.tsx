"use client";
import * as React from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export type CopyButtonProps = {
  /** Exact literal string written to the clipboard (e.g., an opaque source or record identifier). */
  readonly value: string;
  /** Accessible name describing what is copied (e.g., `"Copy gift identifier"`). */
  readonly label: string;
  readonly copiedLabel?: string;
  readonly showText?: boolean;
  readonly className?: string;
};

const RESET_DELAY_MS = 1800;

/** Shadcn UI Kit `list-block4` / ReUI copy-to-clipboard button with >= 24px target floor and screen-reader status announcement. */
export function CopyButton({ value, label, copiedLabel = "Copied", showText = false, className }: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = React.useCallback(async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard !== undefined) {
        await navigator.clipboard.writeText(value);
      }
      setCopied(true);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setCopied(false);
        timerRef.current = null;
      }, RESET_DELAY_MS);
    } catch {
      setCopied(false);
    }
  }, [value]);

  return (
    <span className="inline-flex items-center">
      <Button
        type="button"
        variant="ghost"
        size={showText ? "sm" : "icon-xs"}
        data-slot="copy-button"
        data-copied={copied ? "true" : "false"}
        aria-label={copied ? `${copiedLabel}: ${label}` : label}
        onClick={() => void handleCopy()}
        className={cn("min-h-6 min-w-6 text-muted-foreground hover:text-foreground", copied && "text-positive hover:text-positive", className)}
      >
        {copied ? <CheckIcon aria-hidden="true" className="size-3.5" /> : <CopyIcon aria-hidden="true" className="size-3.5" />}
        {showText ? <span className="text-xs">{copied ? copiedLabel : "Copy"}</span> : null}
      </Button>
      <output className="sr-only">{copied ? `${label}: ${copiedLabel}.` : ""}</output>
    </span>
  );
}

export default CopyButton;
