"use client";
/**
 * The draft edition's section outline: one ordered list of the sections a reader meets, and the structural changes a
 * section can be given from it — move up, move down, move to a position, and the duplicate and remove controls each row
 * composes.
 *
 * Order changes only through controls. Every position is reachable by keyboard and by a single pointer, and this file
 * offers no handle, no drop target and no library that would need one, so a reorder never depends on a gesture.
 *
 * The three reorder controls share the one dispatch below, which sends `moveSection` over the family transport with the
 * revision the outline was read at. A settled attempt is kept twice on purpose: the polite live region names the section
 * and the position it now stands at — or the outcome when it did not move — and the same outcome stays as the durable
 * receipt `OperationResult` renders, so a changed order is never evidenced only by the rows having shifted.
 *
 * Where the acting scope comes from: a section change must present the scope the edition was read in, and this component
 * is handed the edition's identity rather than that scope. It therefore takes the scope and the Page identity from the
 * Page read the builder already holds — the same resolution the sibling field form performs when its caller states
 * neither — so a reorder can never act in a context the outline was not read in. An outline whose authority cannot be
 * resolved says so instead of guessing one, and hides the duplicate and remove controls that cannot name their edition.
 */
import { useCallback, useId, useRef, useState, useSyncExternalStore, type ReactElement } from "react";

import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";

import OperationResult from "@/components/operation-result";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
// The outcome module rather than the service barrel: this is a browser module, and a value import of the barrel would pull
// every read, every mutation and the store into the client bundle. The `unknown` constructor is the one answer this file
// builds itself, for an attempt whose acknowledgement was lost.
import { unknown as unknownOutcome, type MutationOutcome } from "@/modules/data-service/outcome";

import { copy, type ManagedFieldKey } from "../copy";
import { useMovePageSection } from "../hooks/use-section-mutations";
import MoveToPosition from "./move-to-position";
import SectionActions from "./section-actions";

// ---------------------------------------------------------------------------------------------
// The section one row shows
// ---------------------------------------------------------------------------------------------

/** One catalogue section type, taken from the copy module's own catalogue so a type added there reaches this file. */
export type PageSectionType = keyof typeof copy.catalogue.sections;

/**
 * One section of the draft edition, as the outline needs it: the identity a change addresses, the catalogue type and
 * whether a source owns it. The label and the position are the caller's when it has them — a builder that maps the read's
 * sections may state either — and otherwise fall back to the family catalogue's own label for the type and to the order
 * this list was given, because the outline orders rows by the list it receives and invents no vocabulary of its own.
 */
export type PageBuilderSection = { readonly sectionId: string; readonly sectionType: PageSectionType; readonly sectionTypeLabel?: string | null; readonly managed: boolean; readonly managedReasonKey?: ManagedFieldKey | null; readonly index?: number };

/** The label a row states for its section: the caller's when it read one, otherwise the catalogue's word for the type. */
function labelOf(section: PageBuilderSection): string {
  const stated = section.sectionTypeLabel?.trim() ?? "";
  return stated === "" ? copy.catalogue.sections[section.sectionType].label : stated;
}

/**
 * The section's zero-based position in the edition. A stated index is used only when it names a place this list holds;
 * otherwise the row's own place in the list stands, so a control can never address a position that does not exist.
 */
function positionOf(section: PageBuilderSection, listIndex: number, count: number): number {
  const stated = section.index;
  if (stated !== undefined && Number.isInteger(stated) && stated >= 0 && stated < count) {
    return stated;
  }
  return listIndex;
}

/** The reason a managed section states for its own control: the read's key when it carries one, otherwise the closest. */
function managedReasonKeyOf(section: PageBuilderSection): ManagedFieldKey {
  if (section.managedReasonKey !== undefined && section.managedReasonKey !== null) {
    return section.managedReasonKey;
  }
  switch (section.sectionType) {
    case "giving":
      return "giving-binding";
    case "progress":
      return "support-progress";
    default:
      return "source-supplied-section";
  }
}

// ---------------------------------------------------------------------------------------------
// The acting context
// ---------------------------------------------------------------------------------------------

/** The variables one reorder presents, taken from the family transport rather than restated here. */
type MoveVariables = Parameters<ReturnType<typeof useMovePageSection>["mutateAsync"]>[0];

/** The scope a reorder acts under, taken from that same variable type so a service change reaches this file. */
type MutationScope = MoveVariables["scope"];

/** The scope and Page identity a reorder acts under: the ones the Page read of this edition carried. */
type PageEditionAuthority = { readonly scope: MutationScope; readonly documentId: string };

function recordAt(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : undefined;
}

/** Whether one cached Page read holds the edition this outline lists the sections of. */
function statesEdition(data: Readonly<Record<string, unknown>>, variantId: string): boolean {
  const draft = recordAt(data["draft"]);
  if (draft !== undefined && draft["variantId"] === variantId) {
    return true;
  }
  const editions = data["editions"];
  return Array.isArray(editions) && editions.some((edition) => recordAt(edition)?.["variantId"] === variantId);
}

/** The Page identity a read envelope states, when it states one. */
function documentIdOf(data: Readonly<Record<string, unknown>>): string | undefined {
  const documentId = recordAt(data["document"])?.["documentId"];
  return typeof documentId === "string" && documentId.length > 0 ? documentId : undefined;
}

/**
 * The scope one read envelope states. The four identifiers arrive already minted by the service, so this narrows a stored
 * value to that type rather than deriving one: an envelope that does not carry all four is no authority and is skipped.
 */
function scopeAt(value: unknown): MutationScope | undefined {
  const record = recordAt(value);
  if (record === undefined) {
    return undefined;
  }
  const { organizationId, ministryId, supportSubjectId, principalId } = record;
  const stated = [organizationId, ministryId, supportSubjectId, principalId].every((identifier) => typeof identifier === "string" && identifier !== "");
  if (!stated) {
    return undefined;
  }
  return { organizationId, ministryId, supportSubjectId, principalId } as MutationScope;
}

/** The scope and Page identity of the read that carried this edition, taken from the cache the builder filled. */
function editionAuthorityInCache(queryClient: QueryClient, variantId: string): PageEditionAuthority | undefined {
  const reads = queryClient.getQueryCache().findAll({ predicate: (query) => query.queryKey.includes("pages") && query.queryKey.includes("page") });
  for (const read of reads) {
    const result = recordAt(read.state.data);
    if (result === undefined || result["kind"] !== "envelope") {
      continue;
    }
    const envelope = recordAt(result["envelope"]);
    const data = recordAt(envelope?.["data"]);
    if (envelope === undefined || data === undefined || !statesEdition(data, variantId)) {
      continue;
    }
    const documentId = documentIdOf(data);
    const scope = scopeAt(envelope["scope"]);
    if (documentId !== undefined && scope !== undefined) {
      return { scope, documentId };
    }
  }
  return undefined;
}

/** Whether two authorities are the same, so a re-read that found none or an equal one keeps the held snapshot. */
function sameAuthority(current: PageEditionAuthority | undefined, next: PageEditionAuthority | undefined): boolean {
  if (current === undefined || next === undefined) {
    return current === next;
  }
  return current.documentId === next.documentId && current.scope.organizationId === next.scope.organizationId && current.scope.ministryId === next.scope.ministryId && current.scope.supportSubjectId === next.scope.supportSubjectId && current.scope.principalId === next.scope.principalId;
}

/**
 * The authority this edition's reorder acts under, followed as the Page read lands and re-reads rather than read once, so
 * it appears as soon as the read that carried the edition arrives. The snapshot is held by identity, so a render that
 * found the same authority returns the same object instead of a new one.
 */
function usePageEditionAuthority(variantId: string): PageEditionAuthority | undefined {
  const queryClient = useQueryClient();
  const held = useRef<PageEditionAuthority | undefined>(undefined);
  const getSnapshot = useCallback((): PageEditionAuthority | undefined => {
    const next = editionAuthorityInCache(queryClient, variantId);
    if (sameAuthority(held.current, next)) {
      return held.current;
    }
    held.current = next;
    return next;
  }, [queryClient, variantId]);
  const subscribe = useCallback((onChange: () => void) => queryClient.getQueryCache().subscribe(onChange), [queryClient]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ---------------------------------------------------------------------------------------------
// One attempt's identity
// ---------------------------------------------------------------------------------------------

/** One attempt's intent, as a comparable string: the same change keeps its operation id, a changed one takes a new id. */
function intentDigestOf(variantId: string, sectionId: string, targetIndex: number): string {
  return JSON.stringify([variantId, sectionId, targetIndex]);
}

/** One attempt's identity: minted for a new intent, and reused when the same intent is sent again so a replay answers it. */
function attemptIdOf(previous: { readonly operationId: string; readonly digest: string } | null, digest: string): string {
  if (previous !== null && previous.digest === digest) {
    return previous.operationId;
  }
  return globalThis.crypto.randomUUID();
}

// ---------------------------------------------------------------------------------------------
// What a settled reorder says
// ---------------------------------------------------------------------------------------------

/** Fails the build if a mutation outcome is added without a place on this surface. */
function assertUnreachable(value: never): never {
  throw new Error(`Unhandled mutation outcome: ${JSON.stringify(value)}`);
}

/** The sentence a settled outcome gives the live region and the receipt, stated from that outcome alone. */
function outcomeSentence(outcome: MutationOutcome, targetIndex: number): string {
  switch (outcome.outcome) {
    case "accepted":
      return ` now stands at ${copy.builder.positionOption(targetIndex + 1)}. ${copy.sectionActions.results.moved}`;
    case "alreadyAccepted":
      return ` was already moved to ${copy.builder.positionOption(targetIndex + 1)} by this same change, so nothing was applied again.`;
    case "unchanged":
      return " did not move: it already stands at that position.";
    case "conflict":
      return " did not move. This edition changed since it was read, so the order shown is the one that now stands.";
    case "denied":
      return " was not moved: this change is not permitted in the context the outline was read in.";
    case "invalid":
      return " was not moved: the position asked for was not accepted.";
    case "unavailable":
      return " was not moved: the source behind this edition could not be reached, so nothing is reported as applied.";
    case "unknown":
      return " may or may not have moved: the result was not confirmed, so check the order before trying again.";
    default:
      return assertUnreachable(outcome);
  }
}

/** The sentence a control gives when it is asked to act where it cannot: the reason it states, after the section it names. */
function blockedSentence(reason: string): string {
  return ` did not move. ${reason}`;
}

// ---------------------------------------------------------------------------------------------
// Wording this surface states for a control that cannot explain itself with the family's copy
// ---------------------------------------------------------------------------------------------

const NO_AUTHORITY_REASON = "Open this edition again and change its order from there: the context this Page was read in is the only one a section change may act in.";

const FIRST_SECTION_REASON = "This section already stands first in this edition.";

const LAST_SECTION_REASON = "This section already stands last in this edition.";

const OUTLINE_RESULT_HEADING_LEVEL = 4;

// ---------------------------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------------------------

const ROOT_CLASS = "flex min-w-0 flex-col gap-3";

const NOTE_CLASS = "text-sm text-pretty text-muted-foreground";

const LIST_CLASS = "flex min-w-0 flex-col gap-2";

const ROW_CLASS = "flex min-w-0 flex-col gap-2 rounded-lg border border-border p-2";

const ROW_HEADER_CLASS = "flex min-w-0 flex-wrap items-center gap-2";

const ROW_CONTROLS_CLASS = "flex min-w-0 flex-wrap items-center gap-2";

const POSITION_CLASS = "tabular-figures text-sm text-muted-foreground";

const LABEL_CLASS = "min-w-0 font-medium wrap-anywhere";

const ANNOUNCEMENT_CLASS = "text-sm text-pretty";

/** The selection control's own sizing: a whole label on one line where it fits, wrapped where it does not. */
const SELECTION_CLASS = "h-auto min-h-8 max-w-full py-1.5 whitespace-normal";

// ---------------------------------------------------------------------------------------------
// One move control
// ---------------------------------------------------------------------------------------------

interface MoveControlProps {
  readonly direction: "up" | "down";
  readonly sectionLabel: string;
  readonly position: number;
  /** The row reason this control is described by, when the row states one. */
  readonly describedBy: string | undefined;
  /** The caller's own refusal or an in-flight change: withdrawn from the tab order, because it carries no sentence. */
  readonly nativeDisabled: boolean;
  /** A stated reason keeps the control focusable, so the reason can be reached and the control says why it is unavailable. */
  readonly ariaDisabled: boolean;
  readonly onActivate: () => void;
}

/**
 * Move up or move down one position. It stays a real button in both states: natively disabled when the outline itself is
 * refusing, and `aria-disabled` when the row states why it cannot act — a control that can explain itself keeps its place
 * in the tab order rather than going silently inert.
 */
function MoveControl({ direction, sectionLabel, position, describedBy, nativeDisabled, ariaDisabled, onActivate }: MoveControlProps): ReactElement {
  return (
    <Button type="button" variant="outline" size="sm" disabled={nativeDisabled} aria-disabled={ariaDisabled ? true : undefined} aria-describedby={describedBy} onClick={onActivate}>
      {direction === "up" ? copy.builder.moveUp : copy.builder.moveDown}
      <span className="sr-only">
        {" for "}
        <bdi>{sectionLabel}</bdi>
        {`, ${copy.builder.positionOption(position + 1)}`}
      </span>
    </Button>
  );
}

// ---------------------------------------------------------------------------------------------
// The outline
// ---------------------------------------------------------------------------------------------

export interface SectionOutlineProps {
  /** The edition's sections, in the order a reader meets them. */
  readonly sections: readonly PageBuilderSection[];
  /** The section whose fields the builder is showing, if any. */
  readonly selectedSectionId: string | null;
  /** Chooses a section. Selection alone changes nothing and announces nothing. */
  readonly onSelect: (sectionId: string) => void;
  /** The language edition whose draft these sections belong to. */
  readonly variantId: string;
  /** The revision the outline was read at, presented by every change so a change built on a replaced one is a conflict. */
  readonly expectedRevision: string;
  /** Whether the caller withholds every structural change, for a reason of its own. */
  readonly disabled?: boolean;
  readonly className?: string;
}

/** One row's settled announcement: the section it names, isolated, and the sentence that follows it. */
type Announcement = { readonly label: string; readonly sentence: string };

/** The ordered outline of one draft edition, with the four structural changes a section can be given. */
export function SectionOutline({ sections, selectedSectionId, onSelect, variantId, expectedRevision, disabled = false, className }: SectionOutlineProps): ReactElement {
  const move = useMovePageSection();
  const queryClient = useQueryClient();
  const authority = usePageEditionAuthority(variantId);
  const orderNoteId = useId();
  const reasonIdBase = useId();
  const [settled, setSettled] = useState<MutationOutcome | null>(null);
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [lastMove, setLastMove] = useState<{ readonly section: PageBuilderSection; readonly targetIndex: number } | null>(null);
  const attempt = useRef<{ readonly operationId: string; readonly digest: string } | null>(null);
  const count = sections.length;
  const lastIndex = count - 1;
  const transientlyBlocked = disabled || move.isPending;

  function announce(label: string, sentence: string): void {
    setAnnouncement({ label, sentence });
  }

  // The one dispatch every reorder control uses. Move up, move down and move to a position differ only in the index they
  // name, so no control carries a second path to the service and no index arithmetic is repeated anywhere else.
  async function moveSection(section: PageBuilderSection, targetIndex: number): Promise<void> {
    const label = labelOf(section);
    if (authority === undefined) {
      announce(label, blockedSentence(NO_AUTHORITY_REASON));
      return;
    }
    const digest = intentDigestOf(variantId, section.sectionId, targetIndex);
    const operationId = attemptIdOf(attempt.current, digest);
    attempt.current = { operationId, digest };
    setSettled(null);
    setLastMove({ section, targetIndex });
    let outcome: MutationOutcome;
    try {
      outcome = await move.mutateAsync({ operationId, scope: authority.scope, expectedRevision, documentId: authority.documentId, payload: { variantId, sectionId: section.sectionId, targetIndex } });
    } catch {
      // A throw is a fault this surface cannot attribute: the effect may or may not have been applied, so the attempt is
      // reported as unknown with its operation id rather than as a failure, and the same operation can be sent again.
      outcome = unknownOutcome({ operationId });
    }
    setSettled(outcome);
    announce(label, outcomeSentence(outcome, targetIndex));
  }

  /** Sends one destination the row chose, clamped to the edition and never sent for the position it already holds. */
  function requestMove(section: PageBuilderSection, fromPosition: number, targetPosition: number): void {
    if (transientlyBlocked) {
      return;
    }
    const targetIndex = Math.min(Math.max(targetPosition, 0), lastIndex);
    if (targetIndex === fromPosition) {
      announce(labelOf(section), " did not move: it already stands at that position.");
      return;
    }
    void moveSection(section, targetIndex);
  }

  /** Re-reads the Page so the outline shows the order that now stands, which is what a conflict and an uncertainty need. */
  function rereadPage(): void {
    if (authority === undefined) {
      return;
    }
    const { documentId } = authority;
    void queryClient.invalidateQueries({ predicate: (query) => query.queryKey.includes("pages") && query.queryKey.includes(documentId) });
  }

  function retryLastMove(): void {
    if (lastMove === null) {
      return;
    }
    void moveSection(lastMove.section, lastMove.targetIndex);
  }

  return (
    <section data-slot="section-outline" className={cn(ROOT_CLASS, className)}>
      <p id={orderNoteId} className={NOTE_CLASS}>
        {copy.catalogue.orderNote} {copy.builder.selectSection}
      </p>
      {count === 0 ? (
        <p className={NOTE_CLASS}>{copy.catalogue.noSectionsYet}</p>
      ) : (
        <ol aria-label={copy.builder.outline} aria-describedby={orderNoteId} className={LIST_CLASS}>
          {sections.map((section, listIndex) => {
            const position = positionOf(section, listIndex, count);
            const label = labelOf(section);
            const managed = section.managed === true;
            const selected = section.sectionId === selectedSectionId;
            // The position travels with the label a control is named by, so two sections of the same type are told apart
            // by name alone. It is carried in the name rather than in the visible wording, which states the label once.
            const namedSection = `${label}, ${copy.builder.positionOption(position + 1)}`;
            const upReasonId = `${reasonIdBase}-${String(listIndex)}-up`;
            const downReasonId = `${reasonIdBase}-${String(listIndex)}-down`;
            const rowReason = managed ? copy.lockReasons.reasons[managedReasonKeyOf(section)] : authority === undefined ? NO_AUTHORITY_REASON : null;
            const upReason = rowReason ?? (position === 0 ? FIRST_SECTION_REASON : null);
            const downReason = rowReason ?? (position === lastIndex ? LAST_SECTION_REASON : null);
            const activate = (reason: string | null, targetPosition: number) => (): void => {
              if (reason !== null) {
                announce(label, blockedSentence(reason));
                return;
              }
              requestMove(section, position, targetPosition);
            };
            return (
              <li key={section.sectionId} data-slot="section-outline-row" data-section-id={section.sectionId} data-section-position={String(position)} data-managed={managed ? "true" : "false"} data-selected={selected ? "true" : "false"} className={ROW_CLASS}>
                <div className={ROW_HEADER_CLASS}>
                  <span className={POSITION_CLASS}>
                    <bdi>{String(position + 1)}</bdi>
                  </span>
                  <Button type="button" variant={selected ? "secondary" : "ghost"} size="sm" className={SELECTION_CLASS} aria-current={selected ? "true" : undefined} onClick={() => onSelect(section.sectionId)}>
                    <bdi className={LABEL_CLASS}>{label}</bdi>
                    <span className="sr-only">{`, ${copy.builder.positionOption(position + 1)}`}</span>
                  </Button>
                  {managed ? (
                    <Badge variant="secondary">
                      <Lock aria-hidden="true" data-icon="inline-start" />
                      {copy.lockReasons.lockedReadOnlyLabel}
                    </Badge>
                  ) : null}
                  {selected ? <Badge variant="outline">{copy.builder.ariaSelected}</Badge> : null}
                </div>
                <div className={ROW_CONTROLS_CLASS}>
                  <MoveControl direction="up" sectionLabel={label} position={position} describedBy={upReason === null ? undefined : upReasonId} nativeDisabled={transientlyBlocked} ariaDisabled={!transientlyBlocked && upReason !== null} onActivate={activate(upReason, position - 1)} />
                  <MoveControl direction="down" sectionLabel={label} position={position} describedBy={downReason === null ? undefined : downReasonId} nativeDisabled={transientlyBlocked} ariaDisabled={!transientlyBlocked && downReason !== null} onActivate={activate(downReason, position + 1)} />
                  <MoveToPosition sectionId={section.sectionId} sectionLabel={namedSection} index={position} count={count} disabled={transientlyBlocked || rowReason !== null} disabledReason={rowReason ?? undefined} onMove={(targetPosition) => requestMove(section, position, targetPosition)} />
                  {/* The duplicate and remove controls name the edition they change, so they are offered only once the read
                      that carried it has stated its scope; the reorder controls above state that gap in words instead. */}
                  {authority === undefined ? null : <SectionActions scope={authority.scope} documentId={authority.documentId} sectionId={section.sectionId} sectionLabel={label} index={position} count={count} variantId={variantId} expectedRevision={expectedRevision} managed={managed} disabled={disabled} />}
                </div>
                {/* A withdrawn move states why it cannot act in its own description, so a keyboard reader meets the reason
                    at the control rather than having to find it. The sentence itself is stated visibly beside the position
                    control, and these two descriptions carry it to the move controls alone. */}
                {upReason === null ? null : (
                  <p id={upReasonId} className="sr-only">
                    {upReason}
                  </p>
                )}
                {downReason === null ? null : (
                  <p id={downReasonId} className="sr-only">
                    {downReason}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {/* One persistent region for the whole outline: a region created inside a row would remount with that row and a
          screen reader would miss the announcement it was meant to make. Selection is silent here; only order is spoken. */}
      <div aria-live="polite" aria-atomic="true" data-slot="section-outline-announcement" className={ANNOUNCEMENT_CLASS}>
        {announcement === null ? null : (
          <p className="wrap-anywhere">
            <bdi className="font-medium">{announcement.label}</bdi>
            {announcement.sentence}
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
