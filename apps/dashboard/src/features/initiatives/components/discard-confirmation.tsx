"use client";
import { useEffect, useRef, type ReactElement } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
/** The one confirmation a form in this family shows before it throws away what the worker typed: what closing does to those entries, then the two decisions, with the safe one focused so a keyboard reader meets it first. */
export default function DiscardConfirmation({ title, body, keepEditingLabel, discardLabel, onKeepEditing, onDiscard }: { readonly title: string; readonly body: string; readonly keepEditingLabel: string; readonly discardLabel: string; readonly onKeepEditing: () => void; readonly onDiscard: () => void }): ReactElement {
  const keepEditingRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => keepEditingRef.current?.focus(), []);
  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{body}</p>
        <span className="mt-3 flex flex-wrap gap-2">
          <Button ref={keepEditingRef} type="button" variant="outline" size="sm" onClick={onKeepEditing}>
            {keepEditingLabel}
          </Button>
          <Button {...{ type: "button", variant: "destructive", size: "sm", onClick: onDiscard }}>{discardLabel}</Button>
        </span>
      </AlertDescription>
    </Alert>
  );
}
