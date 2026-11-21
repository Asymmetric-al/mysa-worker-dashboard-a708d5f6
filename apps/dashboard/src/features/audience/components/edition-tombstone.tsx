/**
 * The address of a withdrawn edition: one fixed sentence in a neutral frame, and nothing besides it.
 */
import type { ReactElement } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { TOMBSTONE_COPY } from "@/features/audience/copy/receiving";
import { cn } from "@/lib/cn";
/** How the tombstone fits into the layout of the surface that renders it. */
export interface EditionTombstoneProps {
  readonly className?: string;
}
/** What a withdrawn edition's address answers with: the one fixed sentence, no identifier and no way onward. */
export function EditionTombstone({ className }: EditionTombstoneProps): ReactElement {
  return (
    <Card data-slot="edition-tombstone" className={cn("min-w-0", className)}>
      <CardContent>
        <p>{TOMBSTONE_COPY}</p>
      </CardContent>
    </Card>
  );
}
export default EditionTombstone;
