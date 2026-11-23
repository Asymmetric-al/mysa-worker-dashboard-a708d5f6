import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader } from "@/components/ui/card";
import { copy, type ManagedFieldKey } from "../copy";
export type ManagedSectionLockProps = { readonly sectionTypeLabel: string; readonly reasonKey: ManagedFieldKey; readonly className?: string; readonly children?: ReactNode };
export function ManagedSectionLock({ sectionTypeLabel, reasonKey, className, children }: ManagedSectionLockProps) {
  return (
    <Card aria-disabled="true" data-managed-section="locked" className={className}>
      <CardHeader>
        <h3 className="type-subsection-title wrap-anywhere">
          <bdi>{sectionTypeLabel}</bdi>
        </h3>
        <CardAction>
          <Badge variant="secondary">
            <Lock aria-hidden="true" data-icon="inline-start" />
            {copy.lockReasons.lockedReadOnlyLabel}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Alert variant="default" role={undefined}>
          <AlertDescription>
            <p dir="auto" className="type-supporting">
              {copy.lockReasons.reasons[reasonKey]}
            </p>
            <p dir="auto" className="type-supporting">
              {copy.lockReasons.genericLockedReason}
            </p>
          </AlertDescription>
        </Alert>
        {children === undefined || children === null ? null : <div className="type-body wrap-anywhere">{children}</div>}
      </CardContent>
    </Card>
  );
}
export default ManagedSectionLock;
