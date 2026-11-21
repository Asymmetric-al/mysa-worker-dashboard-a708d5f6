import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader } from "@/components/ui/card";
import { copy, type ManagedFieldKey } from "../copy";
/** Props of {@link ManagedSectionLock}. */
export interface ManagedSectionLockProps {
  readonly sectionTypeLabel: string;
  readonly reasonKey: ManagedFieldKey;
  readonly className?: string;
  readonly children?: ReactNode;
}
/** Renders a managed section read-only with the reason it cannot be edited here. */
export function ManagedSectionLock({ sectionTypeLabel, reasonKey, className, children }: ManagedSectionLockProps) {
  return (
    <Card aria-disabled="true" data-managed-section="locked" className={className}>
      <CardHeader>
        <h3 className="font-heading text-base font-medium wrap-anywhere">
          <bdi>{sectionTypeLabel}</bdi>
        </h3>
        {/* `CardAction` is the design system's place for the one element that sits at the header's
            end. The badge carries the lock's label as text, so the state never rests on the icon. */}
        <CardAction>
          <Badge variant="secondary">
            <Lock aria-hidden="true" data-icon="inline-start" />
            {copy.lockReasons.lockedReadOnlyLabel}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {/* A permanent explanation, not an event: it passes `role={undefined}` so the static lock
            does not announce itself as an alert on every render. Each sentence resolves its own
            direction, so an English sentence placed inside a right-to-left edition keeps its words
            and its full stop in the order they were written. */}
        <Alert variant="default" role={undefined}>
          <AlertDescription>
            <p dir="auto">{copy.lockReasons.reasons[reasonKey]}</p>
            <p dir="auto">{copy.lockReasons.genericLockedReason}</p>
          </AlertDescription>
        </Alert>
        {children === undefined || children === null ? null : <div className="text-sm wrap-anywhere">{children}</div>}
      </CardContent>
    </Card>
  );
}
export default ManagedSectionLock;
