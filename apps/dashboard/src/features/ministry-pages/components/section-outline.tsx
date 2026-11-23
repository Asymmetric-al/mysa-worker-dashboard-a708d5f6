"use client";
import { useId, useRef, useState, type ReactElement } from "react";
import { Lock } from "lucide-react";
import { attemptForIntent, type ReviewedAttempt } from "@/components/attempt";
import OperationResult from "@/components/operation-result";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { unknown as unknownOutcome, type MutationOutcome } from "@/modules/data-service/outcome";
import { copy, type ManagedFieldKey } from "../copy";
import { useEditionAuthority, usePageReread } from "../hooks/page-reads";
import { useMovePageSection } from "../hooks/page-mutations";
import MoveToPosition from "./move-to-position";
import SectionActions from "./section-actions";
/** One catalogue section type, taken from the copy module's own catalogue so a type added there reaches this file. */
export type PageSectionType = keyof typeof copy.catalogue.sections;
/** One section of the draft edition as the outline needs it: the identity a change addresses, the type, whether a source owns it, and the caller's label and position where it states them. */
export type PageBuilderSection = { readonly sectionId: string; readonly sectionType: PageSectionType; readonly sectionTypeLabel?: string | null; readonly managed: boolean; readonly managedReasonKey?: ManagedFieldKey | null; readonly index?: number };
const labelOf = (section: PageBuilderSection): string => section.sectionTypeLabel?.trim() || copy.catalogue.sections[section.sectionType].label;
const positionOf = (section: PageBuilderSection, listIndex: number, count: number): number => (section.index !== undefined && Number.isInteger(section.index) && section.index >= 0 && section.index < count ? section.index : listIndex);
const MANAGED_REASON_BY_TYPE: Partial<Readonly<Record<PageSectionType, ManagedFieldKey>>> = { giving: "giving-binding", progress: "support-progress" };
const managedReasonKeyOf = (section: PageBuilderSection): ManagedFieldKey => section.managedReasonKey ?? MANAGED_REASON_BY_TYPE[section.sectionType] ?? "source-supplied-section";
type OutcomeName = MutationOutcome["outcome"];
const intentDigestOf = (variantId: string, sectionId: string, targetIndex: number): string => JSON.stringify([variantId, sectionId, targetIndex]);
const MOVE_RESULT: Readonly<Record<OutcomeName, (position: number) => string>> = {
  accepted: (position) => ` now stands at ${copy.builder.positionOption(position)}. ${copy.sectionActions.results.moved}`,
  alreadyAccepted: (position) => ` was already moved to ${copy.builder.positionOption(position)} by this same change, so nothing was applied again.`,
  unchanged: () => " did not move: it already stands at that position.",
  conflict: () => " did not move. This edition changed since it was read, so the order shown is the one that now stands.",
  denied: () => " was not moved: this change is not permitted in the context the outline was read in.",
  invalid: () => " was not moved: the position asked for was not accepted.",
  unavailable: () => " was not moved: the source behind this edition could not be reached, so nothing is reported as applied.",
  unknown: () => " may or may not have moved: the result was not confirmed, so check the order before trying again.",
};
const outcomeSentence = (outcome: MutationOutcome, targetIndex: number): string => MOVE_RESULT[outcome.outcome](targetIndex + 1);
const blockedSentence = (reason: string): string => ` did not move. ${reason}`;
const NO_AUTHORITY_REASON = "Open this edition again and change its order from there: the context this Page was read in is the only one a section change may act in.";
const OUTLINE_RESULT_HEADING_LEVEL = 4;
const NOTE_CLASS = "text-sm text-pretty text-muted-foreground";
const ROW_CLASS = "flex min-w-0 flex-col gap-2 rounded-lg border border-border p-2";
type MoveControlProps = { readonly direction: "up" | "down"; readonly sectionLabel: string; readonly position: number; readonly describedBy: string | undefined; readonly nativeDisabled: boolean; readonly ariaDisabled: boolean; readonly onActivate: () => void };
const MoveControl = ({ direction, sectionLabel, position, describedBy, nativeDisabled, ariaDisabled, onActivate }: MoveControlProps): ReactElement => (
  <Button type="button" variant="outline" size="sm" disabled={nativeDisabled} aria-disabled={ariaDisabled ? true : undefined} aria-describedby={describedBy} onClick={onActivate}>
    {direction === "up" ? copy.builder.moveUp : copy.builder.moveDown}
    <span className="sr-only">
      {" for "}
      <bdi>{sectionLabel}</bdi>
      {`, ${copy.builder.positionOption(position + 1)}`}
    </span>
  </Button>
);
/** Whether the caller withholds every structural change, for a reason of its own. */
export type SectionOutlineProps = { readonly sections: readonly PageBuilderSection[]; readonly selectedSectionId: string | null; readonly onSelect: (sectionId: string) => void; readonly variantId: string; readonly expectedRevision: string; readonly disabled?: boolean; readonly className?: string };
type Announcement = { readonly label: string; readonly sentence: string };
/** The ordered outline of one draft edition, with the four structural changes a section can be given. */
export function SectionOutline({ sections, selectedSectionId, onSelect, variantId, expectedRevision, disabled = false, className }: SectionOutlineProps): ReactElement {
  const move = useMovePageSection();
  const authority = useEditionAuthority(variantId);
  const rereadPage = usePageReread(authority?.documentId);
  const orderNoteId = useId();
  const reasonIdBase = useId();
  const [settled, setSettled] = useState<MutationOutcome | null>(null);
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [lastMove, setLastMove] = useState<{ readonly section: PageBuilderSection; readonly targetIndex: number } | null>(null);
  const attempt = useRef<ReviewedAttempt | null>(null);
  const count = sections.length;
  const lastIndex = count - 1;
  const transientlyBlocked = disabled || move.isPending;
  const announce = (label: string, sentence: string): void => setAnnouncement({ label, sentence });
  async function moveSection(section: PageBuilderSection, targetIndex: number): Promise<void> {
    const label = labelOf(section);
    if (authority === undefined) {
      announce(label, blockedSentence(NO_AUTHORITY_REASON));
      return;
    }
    const identity = attemptForIntent(attempt.current, intentDigestOf(variantId, section.sectionId, targetIndex));
    attempt.current = identity;
    setSettled(null);
    setLastMove({ section, targetIndex });
    let outcome: MutationOutcome;
    try {
      outcome = await move.mutateAsync({ operationId: identity.operationId, scope: authority.scope, expectedRevision, documentId: authority.documentId, payload: { variantId, sectionId: section.sectionId, targetIndex } });
    } catch {
      outcome = unknownOutcome({ operationId: identity.operationId });
    }
    setSettled(outcome);
    announce(label, outcomeSentence(outcome, targetIndex));
  }
  function requestMove(section: PageBuilderSection, fromPosition: number, targetPosition: number): void {
    if (transientlyBlocked) return;
    const targetIndex = Math.min(Math.max(targetPosition, 0), lastIndex);
    if (targetIndex === fromPosition) {
      announce(labelOf(section), " did not move: it already stands at that position.");
      return;
    }
    void moveSection(section, targetIndex);
  }
  const retryLastMove = (): void => {
    if (lastMove !== null) void moveSection(lastMove.section, lastMove.targetIndex);
  };
  return (
    <section data-slot="section-outline" className={cn("flex min-w-0 flex-col gap-3", className)}>
      <p id={orderNoteId} className={NOTE_CLASS}>
        {copy.catalogue.orderNote} {copy.builder.selectSection}
      </p>
      {count === 0 ? (
        <p className={NOTE_CLASS}>{copy.catalogue.noSectionsYet}</p>
      ) : (
        <ol aria-label={copy.builder.outline} aria-describedby={orderNoteId} className={"flex min-w-0 flex-col gap-2"}>
          {sections.map((section, listIndex) => {
            const position = positionOf(section, listIndex, count);
            const label = labelOf(section);
            const managed = section.managed === true;
            const selected = section.sectionId === selectedSectionId;
            const namedSection = `${label}, ${copy.builder.positionOption(position + 1)}`;
            const upReasonId = `${reasonIdBase}-${String(listIndex)}-up`;
            const downReasonId = `${reasonIdBase}-${String(listIndex)}-down`;
            const rowReason = managed ? copy.lockReasons.reasons[managedReasonKeyOf(section)] : authority === undefined ? NO_AUTHORITY_REASON : null;
            const upReason = rowReason ?? (position === 0 ? "This section already stands first in this edition." : null);
            const downReason = rowReason ?? (position === lastIndex ? "This section already stands last in this edition." : null);
            const activate = (reason: string | null, targetPosition: number) => (): void => {
              if (reason !== null) {
                announce(label, blockedSentence(reason));
                return;
              }
              requestMove(section, position, targetPosition);
            };
            return (
              <li key={section.sectionId} data-slot="section-outline-row" data-section-id={section.sectionId} data-section-position={String(position)} data-managed={managed ? "true" : "false"} data-selected={selected ? "true" : "false"} className={ROW_CLASS}>
                <div className={"flex min-w-0 flex-wrap items-center gap-2"}>
                  <bdi className={"tabular-figures text-sm text-muted-foreground"}>{String(position + 1)}</bdi>
                  <Button type="button" variant={selected ? "secondary" : "ghost"} size="sm" className={"h-auto min-h-8 max-w-full py-1.5 whitespace-normal"} aria-current={selected ? "true" : undefined} onClick={() => onSelect(section.sectionId)}>
                    <bdi className={"min-w-0 font-medium wrap-anywhere"}>{label}</bdi>
                    <span className="sr-only">{`, ${copy.builder.positionOption(position + 1)}`}</span>
                  </Button>
                  {managed ? (
                    <Badge variant="secondary">
                      <Lock aria-hidden="true" data-icon="inline-start" /> {copy.lockReasons.lockedReadOnlyLabel}
                    </Badge>
                  ) : null}
                  {selected ? <Badge variant="outline">{copy.builder.ariaSelected}</Badge> : null}
                </div>
                <div className={"flex min-w-0 flex-wrap items-center gap-2"}>
                  <MoveControl direction="up" sectionLabel={label} position={position} describedBy={upReason === null ? undefined : upReasonId} nativeDisabled={transientlyBlocked} ariaDisabled={!transientlyBlocked && upReason !== null} onActivate={activate(upReason, position - 1)} />
                  <MoveControl direction="down" sectionLabel={label} position={position} describedBy={downReason === null ? undefined : downReasonId} nativeDisabled={transientlyBlocked} ariaDisabled={!transientlyBlocked && downReason !== null} onActivate={activate(downReason, position + 1)} />
                  <MoveToPosition sectionId={section.sectionId} sectionLabel={namedSection} index={position} count={count} disabled={transientlyBlocked || rowReason !== null} disabledReason={rowReason ?? undefined} onMove={(targetPosition) => requestMove(section, position, targetPosition)} />
                  {authority === undefined ? null : <SectionActions scope={authority.scope} documentId={authority.documentId} sectionId={section.sectionId} sectionLabel={label} index={position} count={count} variantId={variantId} expectedRevision={expectedRevision} managed={managed} disabled={disabled} />}
                </div>
                {[
                  { id: upReasonId, reason: upReason },
                  { id: downReasonId, reason: downReason },
                ].map((entry) =>
                  entry.reason === null ? null : (
                    <p key={entry.id} id={entry.id} className="sr-only">
                      {entry.reason}
                    </p>
                  ),
                )}
              </li>
            );
          })}
        </ol>
      )}
      <div aria-live="polite" aria-atomic="true" data-slot="section-outline-announcement" className={"text-sm text-pretty"}>
        {announcement === null ? null : (
          <p className="wrap-anywhere">
            <bdi className="font-medium">{announcement.label}</bdi> {announcement.sentence}
          </p>
        )}
      </div>
      {settled === null ? null : (
        <OperationResult
          outcome={settled}
          headingLevel={OUTLINE_RESULT_HEADING_LEVEL}
          onCheckResult={settled.outcome === "conflict" || settled.outcome === "unknown" ? rereadPage : undefined}
          onRetrySameWork={lastMove !== null && (settled.outcome === "unknown" || settled.outcome === "unavailable") ? retryLastMove : undefined}
        />
      )}
    </section>
  );
}
export default SectionOutline;
