import type { ReactNode } from "react";

import { Lock } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader } from "@/components/ui/card";

import { copy, type ManagedFieldKey } from "../copy";

/**
 * The one rendering of a managed Page section: shown, named, and locked with its reason.
 *
 * A managed section's fields belong to a source record — the page's subject, the Legal Entity, the
 * approved giving designation, the received-support source, or whatever supplies the section — so
 * the builder shows it read-only instead of offering an edit path this release does not have. This
 * is the fourth state a section can be in, and it is deliberately not one of the three that
 * `@/components/state-notice` renders: a managed lock is not a refusal (`denied`), not a source that
 * could not be read (`unavailable`) and not an empty collection (`empty`). A worker who meets it has
 * not lost permission and the source is not down, so it gets its own quiet card rather than an
 * error-shaped notice, and it is never a disabled input — a greyed-out editor would read as "you may
 * not", which is the wrong fact.
 *
 * Both sentences are the family's own copy: the reason for this field comes from
 * `copy.lockReasons.reasons`, keyed by the managed-field vocabulary so a field without a sentence
 * is a compile error, and the ownership statement is `copy.lockReasons.genericLockedReason`. No lock
 * wording is written here, and the lock offers no way out of itself: a "manage at source" link would
 * point at an integration this release does not have.
 *
 * The lock states itself three ways that do not depend on colour — the "Read-only" label, the reason
 * sentence, and `aria-disabled` on the region — and the single lock icon is decorative, so the label
 * carries the meaning on its own. Holds no state, reads no clock, performs no I/O, and renders no
 * form control, so it renders identically on the server and in the browser and needs no client
 * boundary.
 */

/** Props of {@link ManagedSectionLock}. */
export interface ManagedSectionLockProps {
  /** The section's catalogue label, isolated in `<bdi>` so any script keeps its own direction. */
  readonly sectionTypeLabel: string;
  /**
   * Which managed field this section shows. The key comes from the family copy's own vocabulary, so
   * a reason the copy does not word cannot be rendered and a new reason cannot be invented here.
   */
  readonly reasonKey: ManagedFieldKey;
  /** Layout classes for the surrounding surface. Never a colour, radius or shadow. */
  readonly className?: string;
  /**
   * What the caller already holds for this section — rendered content or a plain description — shown
   * as the read-only body. It must stay inert: this slot is not a place to pass an editor, an input
   * or a button, because an editable control inside the lock would defeat the lock and say the
   * opposite of what the reason sentence states.
   */
  readonly children?: ReactNode;
}

/**
 * Renders a managed section read-only with the reason it cannot be edited here.
 *
 * The heading is `<h3>` because the builder's own heading is `<h2>`: the lock joins the document
 * outline under the section it describes rather than competing with the page's title.
 */
export function ManagedSectionLock({
  sectionTypeLabel,
  reasonKey,
  className,
  children,
}: ManagedSectionLockProps) {
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
        {children === undefined || children === null ? null : (
          <div className="text-sm wrap-anywhere">{children}</div>
        )}
      </CardContent>
    </Card>
  );
}

export default ManagedSectionLock;
