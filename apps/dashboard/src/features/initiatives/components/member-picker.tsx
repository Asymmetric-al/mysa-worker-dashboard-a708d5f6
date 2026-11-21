"use client";
/** The initiative working-list member picker: the one place a worker adds partners to a working list, and the only caller of the family's `addMembers` mutation. */
import { CheckIcon, ChevronDownIcon, UsersIcon, XIcon } from "lucide-react";
import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement } from "react";
import ActionReview, { type MutationSubmit } from "@/components/action-review";
import { PerItemResults, PER_ITEM_RESULT_STATES, PER_ITEM_RESULT_STATUS, type PerItemResultState } from "@/components/operation-result";
import { StateNotice } from "@/components/state-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import { assertNever } from "@/lib/result";
import { useDismissableLayer, useRovingFocus, useTypeahead } from "@/lib/ui-sdk";
import type { MutationOutcome, PerItemResult, ReadEnvelope, Scope } from "@/modules/data-service";
import { MEMBERSHIP_RULES_COPY, MEMBERSHIP_STATE_COPY, STATE_NOTICE_COPY, type MembershipState } from "../copy";
import { useAddMembers, type AddMembersVariables } from "../hooks/use-initiative-mutations";
import { addMembersPayloadSchema, type AddMembersPayload } from "../schemas/member";
/** The source identity a read states when it could not answer, taken from the envelope that carries it. */
type SourceReference = ReadEnvelope<unknown>["source"];
/** One partner the enclosing read offers for selection, as this control renders it. */
export interface MemberCandidate {
  readonly partnerId: string;
  readonly displayName: string;
  readonly membership?: { readonly memberId: string; readonly state: MembershipState } | null;
}
/** The candidate read the envelope supplied: the eligible set, or the source's refusal to answer for it. */
export type MemberCandidates = { readonly state: "available"; readonly partners: readonly MemberCandidate[] } | { readonly state: "unavailable"; readonly source: SourceReference };
/** Props of {@link MemberPicker}. */
export interface MemberPickerProps {
  readonly initiativeId: string;
  /** The eligible candidates, or the same read's `unavailable` refusal. Never a set this component computes. */
  readonly candidates: readonly MemberCandidate[] | MemberCandidates;
  readonly scope: Scope;
  /** The initiative revision the caller read; the change is refused as a conflict once it has moved. */
  readonly expectedRevision: string;
  /** Called with the outcome once a change stands, so the caller can close the picker or move on. */
  readonly onAdded?: (outcome: MutationOutcome) => void;
  readonly headingLevel?: MemberPickerHeadingLevel;
  readonly className?: string;
}
/** The picker's own wording. */
const PICKER_COPY = {
  heading: "Add partners to the working list",
  trigger: "Add partners",
  triggerName: "Add partners to the working list",
  searchLabel: "Search eligible partners",
  searchPlaceholder: "Type a name",
  searchClear: "Clear this search",
  listLabel: "Eligible partners",
  noMatch: "No eligible partner matches that search.",
  selectedHeading: "Selected for this addition",
  selectedEmpty: "No partner is selected, so nothing will be added.",
  removeLabel: (name: string): string => `Remove ${name} from this selection`,
  reviewTitle: "Review this addition",
  reviewDescription: "These partners join this initiative's reviewed working list. Nothing is asked of them, no consent is recorded and no notice is sent.",
  reviewSelectionNoun: "partners",
  confirmLabel: "Add to the working list",
  cancelLabel: "Keep selecting",
  perItemHeading: "What each partner's result was",
  backToWorkingList: "Back to the working list",
  emptyTitle: "No partner is eligible to add",
  emptyBody: "Every partner this read could offer is already on the working list, was removed from it, or is not eligible for this initiative. A removed partner is returned from the working list itself.",
  unavailableTitle: STATE_NOTICE_COPY.unavailable.title,
  unavailableBody: "The source behind the eligible partners could not answer, so this picker offers none rather than an empty list or a count of zero.",
  refusalTitle: "That selection cannot be added",
} as const;
const HEADING_TAG = { 2: "h2", 3: "h3", 4: "h4" } as const;
/** The heading level this section renders at when the caller states none. */
type MemberPickerHeadingLevel = keyof typeof HEADING_TAG;
/** The badge variants a per-partner result word may take; the word itself always carries the meaning. */
type ResultWordVariant = "default" | "secondary" | "outline" | "destructive";
/** One per-partner result word and the tone it renders in. */
interface ResultWord {
  readonly label: string;
  readonly variant: ResultWordVariant;
}
/** One partner the worker has selected and not yet added, with the name it was offered under. */
interface SelectedPartner {
  readonly partnerId: string;
  readonly displayName: string;
}
/** The three outcomes that mean the change stands, so the caller hears about it. */
const STANDING_OUTCOMES: ReadonlySet<MutationOutcome["outcome"]> = new Set<MutationOutcome["outcome"]>(["accepted", "alreadyAccepted", "unchanged"]);
/** The member mutation as its handle actually dispatches it. */
type MutationDispatch<Variables> = (variables: Variables, options: { readonly onSettled: (outcome: MutationOutcome | undefined) => void }) => void;
/** Reads the candidate prop as the read it is, whether the caller passed the eligible rows alone or the read's own state. */
function isCandidateRead(value: readonly MemberCandidate[] | MemberCandidates): value is MemberCandidates {
  return !Array.isArray(value);
}
function candidateReadOf(value: readonly MemberCandidate[] | MemberCandidates): MemberCandidates {
  return isCandidateRead(value) ? value : { state: "available", partners: value };
}
/** Whether this candidate may be offered: it carries no working-list membership and states an identity the mutation accepts. */
function isOfferable(candidate: MemberCandidate): boolean {
  const membership = candidate.membership;
  return (membership === undefined || membership === null) && candidate.partnerId.trim() !== "" && candidate.displayName.trim() !== "";
}
function matchesSearch(candidate: MemberCandidate, query: string): boolean {
  if (query === "") {
    return true;
  }
  return candidate.displayName.toLowerCase().includes(query);
}
/** The route of the working list this picker adds to; the candidate read is composed there. */
function workingListHref(initiativeId: string): string {
  return `/partners/initiatives/${encodeURIComponent(initiativeId)}`;
}
/** The refusal a selection would meet, in the words the payload schema uses. */
function refusalFor(initiativeId: string, partnerIds: readonly string[]): string | null {
  if (partnerIds.length === 0 || initiativeId.trim() === "") {
    return null;
  }
  const checked = addMembersPayloadSchema.safeParse({ initiativeId, partnerIds });
  if (checked.success) {
    return null;
  }
  const [first] = checked.error.issues;
  return first === undefined ? null : first.message;
}
function isPerItemResultState(value: string): value is PerItemResultState {
  return (PER_ITEM_RESULT_STATES as readonly string[]).includes(value);
}
/** The word one selected partner's own result carries, from the membership vocabulary where the closed four name a membership state and from the per-item vocabulary where they do not. */
function resultWordOf(state: PerItemResultState): ResultWord {
  switch (state) {
    case "accepted":
      return { label: MEMBERSHIP_STATE_COPY.included.label, variant: "default" };
    case "unchanged":
      return { label: PER_ITEM_RESULT_STATUS.unchanged.label, variant: "secondary" };
    case "excluded":
      return { label: MEMBERSHIP_STATE_COPY.excluded.label, variant: "outline" };
    case "failed":
      return { label: PER_ITEM_RESULT_STATUS.failed.label, variant: "destructive" };
    default:
      return assertNever(state, "Unhandled working-list result state");
  }
}

function PartnerNameTag({ name }: { readonly name: string }): ReactElement {
  return (
    <Badge variant="outline" className="h-auto max-w-full py-1 whitespace-normal">
      <bdi className="min-w-0 break-words">{name}</bdi>
    </Badge>
  );
}
interface PartnerSelectionProps {
  readonly selection: readonly SelectedPartner[];
  readonly results: ReadonlyMap<string, PerItemResult>;
  readonly onRemove: (partnerId: string) => void;
}
/** The selection as chips: each partner's name, the result that partner's own row came back with once a change has settled, and one remove control. */
function PartnerSelection({ selection, results, onRemove }: PartnerSelectionProps): ReactElement {
  const headingId = useId();
  if (selection.length === 0) {
    return <p className="text-sm text-pretty text-muted-foreground">{PICKER_COPY.selectedEmpty}</p>;
  }
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p id={headingId} className="text-xs font-medium text-muted-foreground">
        {PICKER_COPY.selectedHeading}
      </p>
      <ul aria-labelledby={headingId} className="flex min-w-0 flex-wrap items-center gap-2">
        {selection.map((entry) => {
          const item = results.get(entry.partnerId);
          // A per-partner state the closed four do not name keeps the receipt's own word rather than
          // being forced into a membership label this surface would be inventing.
          const word = item === undefined || !isPerItemResultState(item.state) ? null : resultWordOf(item.state);
          return (
            <li key={entry.partnerId} className="flex min-w-0 max-w-full items-center gap-1">
              <PartnerNameTag name={entry.displayName} />
              {word === null ? null : (
                <Badge variant={word.variant} className="h-auto py-1 whitespace-normal">
                  {word.label}
                </Badge>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={PICKER_COPY.removeLabel(entry.displayName)}
                onClick={() => {
                  onRemove(entry.partnerId);
                }}
              >
                <XIcon aria-hidden="true" />
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
// `jsx-a11y/prefer-tag-over-role` is suppressed for the option list and only for it: a native `select`
// carries no search field and no single tab stop, and a `datalist` states no selection, so the tags the
// rule prefers would leave a worker with no way to say which partners are chosen.
/* oxlint-disable jsx-a11y/prefer-tag-over-role */
/** The one member picker: the eligible candidates, the selection under review, and each partner's own result. */
export default function MemberPicker({ initiativeId, candidates, scope, expectedRevision, onAdded, headingLevel = 3, className }: MemberPickerProps): ReactElement {
  const read = candidateReadOf(candidates);
  const headingId = useId();
  const listId = useId();
  const searchId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<readonly SelectedPartner[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [settled, setSettled] = useState<MutationOutcome | null>(null);
  const addMembers = useAddMembers(scope);
  // Only the eligible set the envelope supplied is offered, and a partner who already holds a
  // working-list membership is removed from it rather than shown as a row that cannot be chosen.
  const eligible = useMemo<readonly MemberCandidate[]>(() => {
    const stated = candidateReadOf(candidates);
    return stated.state === "available" ? stated.partners.filter(isOfferable) : [];
  }, [candidates]);
  const visible = useMemo<readonly MemberCandidate[]>(() => {
    const trimmed = query.trim().toLowerCase();
    return eligible.filter((candidate) => matchesSearch(candidate, trimmed));
  }, [eligible, query]);
  const partnerIds = useMemo<readonly string[]>(() => selection.map((entry) => entry.partnerId), [selection]);
  const namesByPartner = useMemo<ReadonlyMap<string, string>>(() => new Map(selection.map((entry) => [entry.partnerId, entry.displayName] as const)), [selection]);
  const nameOf = useCallback((partnerId: string): string => namesByPartner.get(partnerId) ?? partnerId, [namesByPartner]);
  const results = useMemo<ReadonlyMap<string, PerItemResult>>(() => {
    const items = settled !== null && "items" in settled ? settled.items : undefined;
    return new Map((items ?? []).map((item) => [item.targetId, item] as const));
  }, [settled]);
  const perItemRows = useMemo<readonly PerItemResult[]>(() => [...results.values()], [results]);
  const roving = useRovingFocus({ orientation: "vertical", loop: true, preferred: (key) => partnerIds.includes(key) });
  const optionNames = useMemo<readonly string[]>(() => visible.map((candidate) => candidate.displayName), [visible]);
  // The SDK reads its options on each key press rather than while rendering, so an unstable closure per
  // render is the intended shape and never a re-registration of the group.
  const currentIndex = (): number => {
    const active = roving.activeKey;
    return active === null ? -1 : visible.findIndex((candidate) => candidate.partnerId === active);
  };
  const typeahead = useTypeahead({
    labels: () => optionNames,
    currentIndex,
    onMatch: (index) => {
      const match = visible[index];
      if (match !== undefined) {
        roving.focusItem(match.partnerId);
      }
    },
    enabled: visible.length > 0,
  });
  // One dismissal behaviour for Escape, an outside press and the return of focus to the trigger — the
  // same one the toolbar's filters use — while the popover positions and portals the layer.
  useDismissableLayer({
    open,
    layerRef,
    triggerRef,
    onDismiss: () => {
      setOpen(false);
    },
  });
  const dispatch = addMembers.submit as MutationDispatch<AddMembersVariables>;
  const submit = useCallback<MutationSubmit<AddMembersPayload>>(
    (input) =>
      new Promise<MutationOutcome>((resolve) => {
        dispatch(
          { operationId: input.operationId, expectedRevision: input.expectedRevision, payload: input.payload },
          {
            onSettled: (outcome) => {
              // A request whose acknowledgement was lost has no outcome to report, and `unknown` is the
              // one honest word for it: the receipt offers a check or the same operation again, never a
              // second attempt under a fresh identity.
              resolve(outcome ?? { outcome: "unknown", operationId: input.operationId });
            },
          },
        );
      }),
    [dispatch],
  );
  const handleSettled = useCallback(
    (outcome: MutationOutcome): void => {
      setSettled(outcome);
      if (STANDING_OUTCOMES.has(outcome.outcome)) {
        onAdded?.(outcome);
      }
    },
    [onAdded],
  );
  const payload = useMemo<AddMembersPayload>(() => ({ initiativeId, partnerIds: [...partnerIds] }), [initiativeId, partnerIds]);
  const reviewInput = useMemo(() => ({ scope, expectedRevision, payload }), [scope, expectedRevision, payload]);
  function addCandidate(candidate: MemberCandidate): void {
    const next = [...selection, { partnerId: candidate.partnerId, displayName: candidate.displayName }];
    // The cap and the duplicate rule are the payload schema's, so an oversized selection is refused in
    // the schema's own words and the selection the worker built is left exactly as it was.
    const blocked = refusalFor(
      initiativeId,
      next.map((entry) => entry.partnerId),
    );
    if (blocked !== null) {
      setRefusal(blocked);
      return;
    }
    setSelection(next);
    setRefusal(null);
    setSettled(null);
  }
  function removeCandidate(partnerId: string): void {
    setSelection(selection.filter((entry) => entry.partnerId !== partnerId));
    setRefusal(null);
    setSettled(null);
  }
  function toggleCandidate(candidate: MemberCandidate): void {
    if (partnerIds.includes(candidate.partnerId)) {
      removeCandidate(candidate.partnerId);
      return;
    }
    addCandidate(candidate);
  }
  if (read.state === "unavailable") {
    return <StateNotice kind="unavailable" title={PICKER_COPY.unavailableTitle} description={PICKER_COPY.unavailableBody} source={read.source} headingLevel={headingLevel} className={className} />;
  }
  if (eligible.length === 0) {
    return <StateNotice kind="empty" title={PICKER_COPY.emptyTitle} description={PICKER_COPY.emptyBody} action={{ label: PICKER_COPY.backToWorkingList, href: workingListHref(initiativeId) }} headingLevel={headingLevel} className={className} />;
  }
  const Heading = HEADING_TAG[headingLevel];
  const reviewHeadingLevel = headingLevel === 2 ? 3 : 4;
  return (
    <section aria-labelledby={headingId} data-slot="member-picker" className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <Heading id={headingId} className="font-heading text-base font-medium text-pretty">
          {PICKER_COPY.heading}
        </Heading>
        <p className="text-sm text-pretty text-muted-foreground">{MEMBERSHIP_RULES_COPY.explicitSelectionOnly}</p>
      </div>
      {/* The boundary is stated where the worker acts, not only in Help: a working-list partner is not
          someone who was asked, has not consented and receives no notice. */}
      <ul className="flex min-w-0 flex-col gap-1 text-xs text-pretty text-muted-foreground">
        {[MEMBERSHIP_RULES_COPY.notAsked, MEMBERSHIP_RULES_COPY.notConsent, MEMBERSHIP_RULES_COPY.notAudienceMembership].map((statement) => (
          <li key={statement}>{statement}</li>
        ))}
      </ul>
      {refusal === null ? null : (
        <Alert className="px-3 py-2">
          <AlertTitle>{PICKER_COPY.refusalTitle}</AlertTitle>
          <AlertDescription>{refusal}</AlertDescription>
        </Alert>
      )}
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger render={<Button type="button" variant="outline" size="sm" className="max-w-full" aria-label={PICKER_COPY.triggerName} aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} ref={triggerRef} />}>
              <UsersIcon aria-hidden="true" />
              <span className="truncate">{PICKER_COPY.trigger}</span>
              <ChevronDownIcon aria-hidden="true" className="size-3" />
            </PopoverTrigger>
            <PopoverContent ref={layerRef} align="start" className="w-80 max-w-[calc(100vw-2rem)] gap-3">
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor={searchId} className="text-xs text-muted-foreground">
                  {PICKER_COPY.searchLabel}
                </Label>
                <InputGroup className="w-full">
                  <InputGroupInput
                    id={searchId}
                    type="search"
                    value={query}
                    placeholder={PICKER_COPY.searchPlaceholder}
                    autoComplete="off"
                    aria-controls={listId}
                    onChange={(event) => {
                      setQuery(event.target.value);
                    }}
                    onKeyDown={(event) => {
                      // Down from the field enters the list, which is the next stop this pattern expects.
                      if (event.key !== "ArrowDown") {
                        return;
                      }
                      const first = visible[0];
                      if (first === undefined) {
                        return;
                      }
                      event.preventDefault();
                      roving.focusItem(first.partnerId);
                    }}
                  />
                  {query === "" ? null : (
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        size="icon-xs"
                        aria-label={PICKER_COPY.searchClear}
                        onClick={() => {
                          setQuery("");
                        }}
                      >
                        <XIcon aria-hidden="true" />
                      </InputGroupButton>
                    </InputGroupAddon>
                  )}
                </InputGroup>
              </div>
              {visible.length === 0 ? (
                <output className="px-1 py-2 text-sm text-pretty text-muted-foreground">{PICKER_COPY.noMatch}</output>
              ) : (
                // The options scroll inside this region, never the page, and the list is one tab stop
                // that Arrow, Home and End walk.
                <div id={listId} role="listbox" aria-multiselectable="true" aria-label={PICKER_COPY.listLabel} className="flex max-h-64 min-w-0 flex-col gap-0.5 overflow-y-auto overscroll-contain rounded-xl border border-border p-1">
                  {visible.map((candidate) => {
                    const isSelected = partnerIds.includes(candidate.partnerId);
                    return (
                      <div
                        key={candidate.partnerId}
                        role="option"
                        aria-selected={isSelected}
                        {...roving.getItemProps(candidate.partnerId, {
                          // The focus indicator is the token-scale outline the rest of the application
                          // uses. `outline-hidden` shares this class list, so the indicator restores the
                          // outline style `outline-hidden` neutralises on `:focus-visible`; without that,
                          // the width, offset and colour would resolve and paint nothing.
                          className: cn("flex w-full min-w-0 cursor-default items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm outline-hidden select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid", isSelected ? "bg-muted" : ""),
                          onClick: () => {
                            toggleCandidate(candidate);
                          },
                          onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
                            typeahead.onKeyDown(event);
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              toggleCandidate(candidate);
                            }
                          },
                        })}
                      >
                        <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center">
                          {isSelected ? <CheckIcon className="size-4" /> : null}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          <bdi>{candidate.displayName}</bdi>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </PopoverContent>
          </Popover>
        </div>
        <PartnerSelection selection={selection} results={results} onRemove={removeCandidate} />
      </div>
      {selection.length === 0 ? null : (
        <ActionReview<AddMembersPayload>
          title={PICKER_COPY.reviewTitle}
          description={
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-pretty">{PICKER_COPY.reviewDescription}</p>
              <ul className="flex min-w-0 flex-wrap items-center gap-1.5">
                {selection.map((entry) => (
                  <li key={entry.partnerId}>
                    <PartnerNameTag name={entry.displayName} />
                  </li>
                ))}
              </ul>
            </div>
          }
          confirmLabel={PICKER_COPY.confirmLabel}
          cancelLabel={PICKER_COPY.cancelLabel}
          onCancel={() => {
            setOpen(true);
          }}
          selection={{ count: selection.length, noun: PICKER_COPY.reviewSelectionNoun }}
          input={reviewInput}
          submit={submit}
          onSettled={handleSettled}
          headingLevel={reviewHeadingLevel}
        />
      )}
      {/* The receipt above reports each row by its opaque partner reference, which a worker cannot read
          as a person; this names the partner beside the same per-partner words. */}
      {perItemRows.length === 0 ? null : (
        <PerItemResults
          heading={PICKER_COPY.perItemHeading}
          items={perItemRows}
          renderItemAction={(item) => (
            <span className="text-sm">
              <bdi className="min-w-0 break-words">{nameOf(item.targetId)}</bdi>
            </span>
          )}
        />
      )}
    </section>
  );
}
