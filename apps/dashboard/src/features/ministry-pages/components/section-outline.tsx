"use client";
import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import { Lock } from "lucide-react";
import { attemptForIntent, intentKeyOf, type ReviewedAttempt } from "@/components/attempt";
import OperationResult from "@/components/operation-result";
import { Badge } from "@/components/ui/badge";
import { Button, BUTTON_WRAP_CLASS } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { unknown as unknownOutcome, type MutationOutcome } from "@/modules/data-service/outcome";
import { copy, type ManagedFieldKey } from "../copy";
import { useEditionAuthority, usePageReread } from "../hooks/page-reads";
import { useMovePageSection } from "../hooks/page-mutations";
import MoveToPosition from "./move-to-position";
import SectionActions from "./section-actions";
export type PageSectionType = keyof typeof copy.catalogue.sections;
export type PageBuilderSection = { readonly sectionId: string; readonly sectionType: PageSectionType; readonly sectionTypeLabel?: string | null; readonly managed: boolean; readonly managedReasonKey?: ManagedFieldKey | null; readonly index?: number };
const labelOf = (section: PageBuilderSection): string => section.sectionTypeLabel?.trim() || copy.catalogue.sections[section.sectionType].label;
const positionOf = (section: PageBuilderSection, listIndex: number, count: number): number => (section.index !== undefined && Number.isInteger(section.index) && section.index >= 0 && section.index < count ? section.index : listIndex);
const MANAGED_REASON_BY_TYPE: Partial<Readonly<Record<PageSectionType, ManagedFieldKey>>> = { giving: "giving-binding", progress: "support-progress" };
const managedReasonKeyOf = (section: PageBuilderSection): ManagedFieldKey => section.managedReasonKey ?? MANAGED_REASON_BY_TYPE[section.sectionType] ?? "source-supplied-section";
/** The controls a move can start from, so a settled move returns focus to the one the person used. */ type MoveControlKind = "up" | "down" | "to-position";
/** One submitted move, held with the identity it was minted under: a retry replays this exactly, and a move with a changed intent mints its own. */
type HeldMove = { readonly identity: ReviewedAttempt; readonly variables: Parameters<ReturnType<typeof useMovePageSection>["mutateAsync"]>[0]; readonly label: string; readonly kind: MoveControlKind };
const controlIdOf = (base: string, kind: MoveControlKind, position: number): string => `${base}-${kind}-${String(position)}`;
const MOVE_RESULT: Readonly<Record<MutationOutcome["outcome"], (position: number) => string>> = {
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
const NOTE_CLASS = "text-sm text-pretty text-muted-foreground";
type MoveControlProps = { readonly direction: "up" | "down"; readonly sectionLabel: string; readonly position: number; readonly controlId: string; readonly describedBy: string | undefined; readonly ariaDisabled: boolean; readonly onActivate: () => void };
// A blocked move control states why with `aria-disabled` and stays focusable: the native `disabled` attribute would take the
// person's focus off the control they pressed the moment a request in flight blocks it, so a keyboard user would restart their traversal of the outline for every move. The press itself is answered by the row's own guard below.
const MoveControl = ({ direction, sectionLabel, position, controlId, describedBy, ariaDisabled, onActivate }: MoveControlProps): ReactElement => (
  <Button type="button" variant="outline" size="sm" id={controlId} aria-disabled={ariaDisabled ? true : undefined} aria-describedby={describedBy} onClick={onActivate}>
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
/** The ordered outline of one draft edition, with the four structural changes a section can be given. */ export function SectionOutline({ sections, selectedSectionId, onSelect, variantId, expectedRevision, disabled = false, className }: SectionOutlineProps): ReactElement {
  const move = useMovePageSection();
  const authority = useEditionAuthority(variantId);
  const rereadPage = usePageReread(authority?.documentId);
  const orderNoteId = useId();
  const reasonIdBase = useId();
  const controlIdBase = useId();
  const [settled, setSettled] = useState<MutationOutcome | null>(null);
  const [announcement, setAnnouncement] = useState<{ readonly label: string; readonly sentence: string } | null>(null);
  const [lastMove, setLastMove] = useState<HeldMove | null>(null);
  // The move already submitted, read synchronously so two activations in one tick cannot both mint against the same held identity.
  const held = useRef<HeldMove | null>(null);
  const focusTarget = useRef<{ readonly kind: MoveControlKind; readonly position: number } | null>(null);
  const count = sections.length;
  const lastIndex = count - 1;
  const pending = move.isPending;
  const transientlyBlocked = disabled || pending;
  const announce = (label: string, sentence: string): void => setAnnouncement({ label, sentence });
  // A settled move returns focus to the control the person used, found by the position the section now occupies: the rows are keyed and addressed by position, so that control is the one the re-read lands the moved section in, and it stays mounted.
  useEffect(() => {
    const target = focusTarget.current;
    if (target === null) return;
    focusTarget.current = null;
    document.getElementById(controlIdOf(controlIdBase, target.kind, target.position))?.focus();
  }, [settled, controlIdBase]);
  // One held move submitted exactly as it was held, so a retry replays the identity and the variables the first attempt presented.
  async function submitHeldMove(target: HeldMove): Promise<void> {
    const targetIndex = target.variables.payload.targetIndex;
    setSettled(null);
    let outcome: MutationOutcome;
    try {
      outcome = await move.mutateAsync(target.variables);
    } catch {
      outcome = unknownOutcome({ operationId: target.identity.operationId });
    }
    // Only a move that changed the order has a row to return to: `unchanged` left the section where it was, so focus stays on the control that was pressed rather than being sent to another section's row.
    focusTarget.current = outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" ? { kind: target.kind, position: targetIndex } : null;
    setSettled(outcome);
    announce(target.label, outcomeSentence(outcome, targetIndex));
  }
  // A changed intent — another section, another position, or a revision read since the held attempt — mints its own identity, so a second move is an operation of its own rather than a replay of the first.
  function startMove(kind: MoveControlKind, section: PageBuilderSection, targetIndex: number): void {
    const label = labelOf(section);
    if (authority === undefined) {
      announce(label, blockedSentence(NO_AUTHORITY_REASON));
      return;
    }
    const payload = { variantId, sectionId: section.sectionId, targetIndex };
    const identity = attemptForIntent(held.current?.identity ?? null, intentKeyOf({ scope: authority.scope, expectedRevision, payload }));
    const next: HeldMove = { identity, variables: { operationId: identity.operationId, scope: authority.scope, expectedRevision, documentId: authority.documentId, payload }, label, kind };
    held.current = next;
    setLastMove(next);
    void submitHeldMove(next);
  }
  function requestMove(kind: MoveControlKind, section: PageBuilderSection, fromPosition: number, targetPosition: number): void {
    if (transientlyBlocked) return;
    const targetIndex = Math.min(Math.max(targetPosition, 0), lastIndex);
    if (targetIndex === fromPosition) {
      announce(labelOf(section), " did not move: it already stands at that position.");
      return;
    }
    startMove(kind, section, targetIndex);
  }
  const retryLastMove = (): void => {
    const target = held.current;
    if (target !== null && !pending) void submitHeldMove(target);
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
            const upReasonId = `${reasonIdBase}-${String(listIndex)}-up`;
            const downReasonId = `${reasonIdBase}-${String(listIndex)}-down`;
            const rowReason = managed ? copy.lockReasons.reasons[managedReasonKeyOf(section)] : authority === undefined ? NO_AUTHORITY_REASON : null;
            const upReason = rowReason ?? (position === 0 ? "This section already stands first in this edition." : null);
            const downReason = rowReason ?? (position === lastIndex ? "This section already stands last in this edition." : null);
            const activate = (kind: MoveControlKind, reason: string | null, targetPosition: number) => (): void => {
              if (reason !== null) {
                announce(label, blockedSentence(reason));
                return;
              }
              requestMove(kind, section, position, targetPosition);
            };
            return (
              <li key={section.sectionId} data-slot="section-outline-row" data-section-id={section.sectionId} data-section-position={String(position)} data-managed={managed ? "true" : "false"} data-selected={selected ? "true" : "false"} className={"flex min-w-0 flex-col gap-2 rounded-lg border border-border p-2"}>
                <div className={"flex min-w-0 flex-wrap items-center gap-2"}>
                  <bdi className={"tabular-figures text-sm text-muted-foreground"}>{String(position + 1)}</bdi>
                  <Button type="button" variant={selected ? "secondary" : "ghost"} size="sm" className={BUTTON_WRAP_CLASS} aria-current={selected ? "true" : undefined} onClick={() => onSelect(section.sectionId)}>
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
                  <MoveControl direction="up" sectionLabel={label} position={position} controlId={controlIdOf(controlIdBase, "up", position)} describedBy={upReason === null ? undefined : upReasonId} ariaDisabled={transientlyBlocked || upReason !== null} onActivate={activate("up", upReason, position - 1)} />
                  <MoveControl
                    direction="down"
                    sectionLabel={label}
                    position={position}
                    controlId={controlIdOf(controlIdBase, "down", position)}
                    describedBy={downReason === null ? undefined : downReasonId}
                    ariaDisabled={transientlyBlocked || downReason !== null}
                    onActivate={activate("down", downReason, position + 1)}
                  />
                  <MoveToPosition
                    controlId={controlIdOf(controlIdBase, "to-position", position)}
                    sectionId={section.sectionId}
                    sectionLabel={`${label}, ${copy.builder.positionOption(position + 1)}`}
                    index={position}
                    count={count}
                    disabled={disabled || rowReason !== null}
                    disabledReason={rowReason ?? undefined}
                    busy={pending}
                    onMove={(targetPosition) => requestMove("to-position", section, position, targetPosition)}
                  />
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
        <OperationResult outcome={settled} headingLevel={4} onCheckResult={settled.outcome === "conflict" || settled.outcome === "unknown" ? rereadPage : undefined} onRetrySameWork={lastMove !== null && (settled.outcome === "unknown" || settled.outcome === "unavailable") ? retryLastMove : undefined} />
      )}
    </section>
  );
}
export default SectionOutline;
