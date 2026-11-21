"use client";
/** Filing one record, or an explicitly selected set of records, under the worker's own tag or favourite mark: the review step, one attempt per selected record, and the receipt that stays on the page. */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import ActionReview, { mayReplay, type MutationSubmit, type ReviewHeadingLevel } from "@/components/action-review";
import { fieldErrorsFromInvalid, FormField, refusalSummary, type FieldErrorLookup } from "@/components/form-field";
import { OperationResult, PerItemResults, type PerItemColumn } from "@/components/operation-result";
import StateNotice from "@/components/state-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import { assertNever } from "@/lib/result";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import { accepted, unchanged, type MutationOutcome, type PerItemResult } from "@/modules/data-service/outcome";
import { AUDIENCE_LABEL_COPY } from "../copy/privacy";
import { useSetFavourite, useSetTag } from "../hooks/use-partner-mutations";
import type { SetFavouritePayload, SetTagPayload } from "../schemas/tag";

/**
 * One record this component can file: the record the caller read, the revision it read, and the
 * filing facts that read published.
 */
export interface PartnerFilingRef {
  /** The record's own opaque identifier, forwarded unchanged to the route that files it. */
  readonly partnerId: string;
  /** The revision the caller read, presented by the change so a record that moved settles as a conflict rather than as an overwrite. */
  readonly expectedRevision: string;
  /** Names the record beside its identifier in a review, so the worker recognises it. Never used to match, join or identify anything. */
  readonly displayName?: string;
  /** The tags the read published for this record. Absent when the read withheld them, and then the chips offer no removal. */
  readonly tags?: readonly string[];
  /** The favourite mark the read published for this record. Absent when the read withheld it, and then the mark cannot be changed here. */
  readonly favourite?: boolean;
}

/** What this surface files: one record, or the records the caller explicitly selected — never "everything the current filter matches". */
export type TagAndFavouriteTarget = { readonly partnerRef: PartnerFilingRef } | { readonly partnerRefs: readonly PartnerFilingRef[] };

export interface TagAndFavouriteActionsProps {
  /** The context each change is submitted in. The service re-resolves it and re-checks the record, so this is the caller's claim and not an authority it grants. */
  readonly scope: Scope;
  /** One record, or the explicitly selected records. A selection is rendered from these identifiers alone. */
  readonly target: TagAndFavouriteTarget;
  /** The tags already used in this ministry, taken from the roster envelope: offered as suggestions, never as a closed list that could refuse a new label. */
  readonly tagSuggestions?: readonly string[];
  /** Called with every outcome this surface settles, so the caller can re-read whatever it derived from the record. */
  readonly onSettled?: (outcome: MutationOutcome) => void;
  /** Reads the result of a change whose acknowledgement was lost. Recovery is by operation identity, so this re-reads rather than re-sending. */
  readonly onCheckResult?: () => void;
  /** The heading level of this surface, so it nests under whatever heading the page around it reaches. */
  readonly headingLevel?: ReviewHeadingLevel;
  readonly className?: string;
}

/** A tag the worker is applying to, or removing from, the records in view. */
type TagInstruction = { readonly kind: "tag"; readonly tag: string; readonly present: boolean };
/** The favourite mark the worker is setting on the records in view. */
type FavouriteInstruction = { readonly kind: "favourite"; readonly favourite: boolean };
type BatchInstruction = TagInstruction | FavouriteInstruction;
/** One record's own revision, as the reviewed instruction carries it so a stale one is refused rather than overwritten. */
type BatchRecordInput = { readonly partnerId: string; readonly expectedRevision: string };
type BatchTagPayload = { readonly records: readonly BatchRecordInput[]; readonly tag: string; readonly present: boolean };
type BatchFavouritePayload = { readonly records: readonly BatchRecordInput[]; readonly favourite: boolean };
/** One selected record's attempt: its identity, and the outcome it answered, or `null` where the change could not be prepared here. */
type BatchEntry = { readonly partnerId: string; readonly outcome: MutationOutcome | null };
type TagSubmit = (input: Omit<MutationInput<SetTagPayload>, "operationId">) => Promise<MutationOutcome>;
type FavouriteSubmit = (input: Omit<MutationInput<SetFavouritePayload>, "operationId">) => Promise<MutationOutcome>;
/** What one record's own hook offers the review step that files the whole selection. */
type RecordSubmits = { readonly setTag: TagSubmit; readonly setFavourite: FavouriteSubmit };

const ROOT_CLASS = "flex min-w-0 flex-col gap-4";
const PANEL_CLASS = "flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3";
const SENTENCE_CLASS = "text-sm text-pretty text-muted-foreground";
const IDENTIFIER_CLASS = "mono-identifier min-w-0 wrap-anywhere";
const COUNT_CLASS = "tabular-figures font-medium text-foreground";
const CONTROL_ROW_CLASS = "flex min-w-0 flex-wrap items-center gap-2";
const CHIP_LIST_CLASS = "flex min-w-0 flex-wrap items-center gap-2";
const RECORD_LIST_CLASS = "flex min-w-0 flex-col gap-1 text-sm";
const TARGET_MIN_CLASS = "h-auto max-h-none min-h-6 max-w-full whitespace-normal";
const ROW_COLUMNS: readonly PerItemColumn[] = [{ key: "revision", label: "Revision" }];
const EMPTY_SELECTION_TITLE = "No record is selected";
const EMPTY_SELECTION_DESCRIPTION = "This surface files only the records it is handed. Select at least one row in the list, then apply the tag or the favourite mark to the selection.";

/** One record's noun, so a count of one never reads as a selection of several. */
const recordsNoun = (count: number): string => (count === 1 ? "record" : "records");
/** The sentence a row shows when a record's change was already applied under the same request. */
const ROW_ALREADY_APPLIED = "This record's change was already applied under the same request, so nothing was applied twice and its revision did not advance.";
const ROW_CONFLICT = "This record moved after you read it, so nothing was written to it. Re-apply the change to write it against the revision it holds now.";
const ROW_DENIED = "This change was not permitted in the current session and context, so nothing was written to this record.";
const ROW_UNKNOWN = "This record's result is not confirmed. Checking it returns the original result, and repeating the same request replays it rather than opening a second change.";
const ROW_EXCLUDED = "This record's change could not be prepared in this view, so nothing about it changed.";
const ROW_UNAVAILABLE = (system: string, reference: string): string => `The source behind this change could not be read (${system}, reference ${reference}), so nothing was written to this record.`;

// The tag sentences below are worded in this file because the family's copy module owns no tag entry, and
// the privacy distinction they assert is quoted from that module rather than restated a second time.
const FILING_COPY = {
  heading: "Tags and favourite",
  distinction: "A tag is your own filing label on this record. It is not an audience, a consent, a stage or a segment, and filing the record changes nothing else about it: no notice is sent, no gift is recorded and no task is created.",
  notPrivateText: `A tag sits on the record rather than in your private preparation, so it is not private text: ${AUDIENCE_LABEL_COPY.shared.description}`,
  tagLabel: "Tag",
  tagDescription: "Type any label you file records under. A label you have not used before is accepted exactly as you type it, because this vocabulary is yours and not a fixed list.",
  addLabel: "Add tag",
  removeLabel: "Remove tag",
  suggestionsLabel: "Your tags",
  suggestionsTitle: "Tags you already use",
  suggestionsEmpty: "No tag has been used in this ministry yet, so there is nothing to reuse. The first label you type is the first one recorded.",
  tagsOnRecord: "Tags on this record",
  noTagsOnRecord: "No tag is on this record yet.",
  removeTagFromRecord: (tag: string): string => `Remove the tag “${tag}” from this record`,
  favouriteLabel: "Favourite",
  favouriteDescription: "The favourite mark is your own: it sorts records for you and changes nothing about who may see the record or how it is supported.",
  favouriteMarked: "This record is marked as a favourite.",
  favouriteClear: "This record is not marked as a favourite.",
  favouriteUnpublished: "The read published no favourite mark for this record, so the mark cannot be changed here.",
  favouriteOnLabel: "Mark as favourite",
  favouriteOffLabel: "Clear the favourite",
  addReviewTitle: "Add this tag to the selected records",
  removeReviewTitle: "Remove this tag from the selected records",
  favouriteOnTitle: "Mark the selected records as favourites",
  favouriteOffTitle: "Clear the favourite mark from the selected records",
  selectionIntro: (count: number): string => `Each of the ${String(count)} selected ${recordsNoun(count)} is filed on its own, with its own revision checked and its own result reported below.`,
  selectionSummary: (count: number): string => `${String(count)} ${recordsNoun(count)} selected. Choose the tag or the favourite mark below, then review the change before it is applied; choosing one changes nothing on its own.`,
  selectionScope: "Only the records listed here are affected. This selection is not an audience, a consent or a campaign, and the change never reaches a record you did not select.",
  tagToAdd: "Tag to add:",
  tagToRemove: "Tag to remove:",
  favouriteValue: (favourite: boolean): string => (favourite ? "The favourite mark is set on each selected record." : "The favourite mark is cleared on each selected record."),
  recordsHeading: "Selected records",
  rowsHeading: "Result for each selected record",
} as const;

/** One record's own outcome, worded for the per-item list that sits under the review step. */
function rowOf(outcome: MutationOutcome, partnerId: string): PerItemResult {
  switch (outcome.outcome) {
    case "accepted":
      return { targetId: partnerId, state: "accepted", revision: outcome.revision };
    case "alreadyAccepted":
      return { targetId: partnerId, state: "accepted", revision: outcome.revision, reason: ROW_ALREADY_APPLIED };
    case "unchanged":
      return { targetId: partnerId, state: "unchanged", revision: outcome.revision };
    case "conflict":
      return { targetId: partnerId, state: "failed", revision: outcome.currentRevision, reasonCode: outcome.reason, reason: ROW_CONFLICT };
    case "denied":
      // The service's own reason code is all this row says: a denial reveals no count, no name and no
      // existence beyond the record the caller already named.
      return { targetId: partnerId, state: "failed", reasonCode: outcome.reasonCode, reason: ROW_DENIED };
    case "invalid":
      return { targetId: partnerId, state: "failed", reasonCode: "invalid", reason: refusalSummary(outcome) };
    case "unavailable":
      return { targetId: partnerId, state: "failed", reasonCode: outcome.source.system, reason: ROW_UNAVAILABLE(outcome.source.system, outcome.source.reference) };
    case "unknown":
      return { targetId: partnerId, state: "failed", reasonCode: "unknown", reason: `${ROW_UNKNOWN} Operation ${outcome.operationId}.` };
    default:
      return assertNever(outcome, "Unhandled partner filing outcome");
  }
}

/** The row a record gets when this view could not prepare its change at all: nothing was submitted for it. */
function excludedRow(partnerId: string): PerItemResult {
  return { targetId: partnerId, state: "excluded", reasonCode: "not-prepared", reason: ROW_EXCLUDED };
}

/** Whether an outcome reports an effect, which is what leaves the reads beside the record out of date. */
function standsAsChanged(outcome: MutationOutcome): boolean {
  return outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted";
}

/** The newest revision any settled attempt reported, or an empty string where none reported one. */
function lastRevisionOf(outcomes: readonly MutationOutcome[]): string {
  for (let index = outcomes.length - 1; index >= 0; index -= 1) {
    const outcome = outcomes[index];
    if (outcome === undefined) {
      continue;
    }
    switch (outcome.outcome) {
      case "accepted":
      case "alreadyAccepted":
      case "unchanged":
        return outcome.revision;
      default:
        break;
    }
  }
  return "";
}

/**
 * The one outcome the review step shows for a whole selection, built from what each selected record's own
 * attempt answered. A record that did not stand answers for the review with its own outcome — the one that
 * carries a current value, a refusal code or an operation to check — while the per-item rows report every
 * record on its own terms, so no row is ever collapsed into an aggregate "done".
 */
function batchOutcomeOf(operationId: string, entries: readonly BatchEntry[], rows: readonly PerItemResult[]): MutationOutcome {
  const trouble = entries.find((entry) => entry.outcome !== null && !standsAsChanged(entry.outcome));
  if (trouble !== undefined && trouble.outcome !== null) {
    return trouble.outcome;
  }
  const answered = entries.flatMap((entry) => (entry.outcome === null ? [] : [entry.outcome]));
  const first = answered[0];
  if (first !== undefined && answered.every((outcome) => outcome.outcome === "alreadyAccepted")) {
    return first;
  }
  if (first !== undefined && answered.every((outcome) => outcome.outcome === "unchanged")) {
    return first;
  }
  const changed = entries.flatMap((entry) => (entry.outcome !== null && entry.outcome.outcome === "accepted" ? [entry.partnerId] : []));
  const revision = lastRevisionOf(answered);
  if (changed.length === 0) {
    return unchanged({ operationId, revision });
  }
  return accepted({ operationId, revision, changed, items: rows });
}

/** The records this surface files, in the caller's order, with a record the caller listed twice filed once. */
function filingRecordsOf(target: TagAndFavouriteTarget): readonly PartnerFilingRef[] {
  if ("partnerRef" in target) {
    return [target.partnerRef];
  }
  const seen = new Set<string>();
  const records: PartnerFilingRef[] = [];
  for (const record of target.partnerRefs) {
    if (seen.has(record.partnerId)) {
      continue;
    }
    seen.add(record.partnerId);
    records.push(record);
  }
  return records;
}

/** The revision each selected record presented when the review step was opened, carried inside the reviewed intent. */
function batchInputsOf(records: readonly PartnerFilingRef[]): readonly BatchRecordInput[] {
  return records.map((record) => ({ partnerId: record.partnerId, expectedRevision: record.expectedRevision }));
}

/**
 * Owns the two per-record change hooks for one selected record. The family's change is per record —
 * `/api/partners/[partnerId]/tags` files exactly one record — so the review step needs one hook per record
 * and cannot drive a whole selection through a single one. This component renders nothing: it registers
 * the record's submits with the review step and unregisters them when it leaves.
 */
function RecordSubmitters({ record, register }: { readonly record: PartnerFilingRef; readonly register: (record: PartnerFilingRef, submits: RecordSubmits) => () => void }): null {
  const tag = useSetTag(record.partnerId);
  const favourite = useSetFavourite(record.partnerId);
  const submitTag = tag.submit;
  const submitFavourite = favourite.submit;
  useEffect(() => register(record, { setTag: submitTag, setFavourite: submitFavourite }), [register, record, submitTag, submitFavourite]);
  return null;
}

/** The worker's own tags, offered as suggestions. Choosing one fills the field; it files nothing on its own. */
function TagSuggestions({ suggestions, disabled, onChoose }: { readonly suggestions: readonly string[]; readonly disabled: boolean; readonly onChoose: (tag: string) => void }): ReactElement {
  if (suggestions.length === 0) {
    return <p className={SENTENCE_CLASS}>{FILING_COPY.suggestionsEmpty}</p>;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" />} disabled={disabled}>
        {FILING_COPY.suggestionsLabel}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        <DropdownMenuLabel>{FILING_COPY.suggestionsTitle}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {suggestions.map((tag) => (
          <DropdownMenuItem key={tag} onClick={() => onChoose(tag)}>
            <bdi className="min-w-0 wrap-anywhere">{tag}</bdi>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The records a selection holds, named and identified, so a review lists exactly what it will file. */
function SelectedRecordList({ records }: { readonly records: readonly PartnerFilingRef[] }): ReactElement {
  const headingId = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p id={headingId} className="text-sm font-medium">
        {FILING_COPY.recordsHeading}: <bdi className={COUNT_CLASS}>{String(records.length)}</bdi> {recordsNoun(records.length)}
      </p>
      <ul aria-labelledby={headingId} className={RECORD_LIST_CLASS}>
        {records.map((record) => {
          const name = record.displayName?.trim() ?? "";
          return (
            <li key={record.partnerId} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              {name === "" ? null : <bdi className="min-w-0 font-medium wrap-anywhere">{name}</bdi>}
              <bdi className={IDENTIFIER_CLASS}>{record.partnerId}</bdi>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface SingleRecordFilingProps {
  readonly scope: Scope;
  readonly record: PartnerFilingRef;
  readonly tagSuggestions: readonly string[];
  readonly onSettled?: (outcome: MutationOutcome) => void;
  readonly onCheckResult?: () => void;
}

/**
 * One record's filing: the tags it holds as chips, one tag field for adding or removing a label, and the
 * favourite mark. Each change is one named mutation against this record's revision, and its outcome stays
 * on the page as the receipt for it.
 */
function SingleRecordFiling({ scope, record, tagSuggestions, onSettled, onCheckResult }: SingleRecordFilingProps): ReactElement {
  const tagChange = useSetTag(record.partnerId);
  const favouriteChange = useSetFavourite(record.partnerId);
  const submitTagRequest = tagChange.submit;
  const submitFavouriteRequest = favouriteChange.submit;
  const tagsHeadingId = useId();
  const favouriteHintId = useId();
  const favouriteLabelId = useId();
  const [tagText, setTagText] = useState("");
  const [tagErrors, setTagErrors] = useState<FieldErrorLookup | null>(null);
  const lastTagInput = useRef<Omit<MutationInput<SetTagPayload>, "operationId"> | null>(null);
  const lastFavouriteInput = useRef<Omit<MutationInput<SetFavouritePayload>, "operationId"> | null>(null);
  const tagOutcome = tagChange.outcome;
  const favouriteOutcome = favouriteChange.outcome;

  const submitTag = useCallback(
    async (input: Omit<MutationInput<SetTagPayload>, "operationId">): Promise<MutationOutcome> => {
      lastTagInput.current = input;
      const outcome = await submitTagRequest(input);
      setTagErrors(outcome.outcome === "invalid" ? fieldErrorsFromInvalid(outcome) : null);
      // A tag the service accepted is no longer the field's text: it lives on the record now, and the
      // re-read beside this change is what shows it. A refused or uncertain attempt keeps the text.
      if (outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted") {
        setTagText("");
      }
      onSettled?.(outcome);
      return outcome;
    },
    [submitTagRequest, onSettled],
  );

  const submitFavourite = useCallback(
    async (input: Omit<MutationInput<SetFavouritePayload>, "operationId">): Promise<MutationOutcome> => {
      lastFavouriteInput.current = input;
      const outcome = await submitFavouriteRequest(input);
      onSettled?.(outcome);
      return outcome;
    },
    [submitFavouriteRequest, onSettled],
  );

  const typedTag = tagText.trim();
  const currentTags = record.tags ?? [];
  const favouriteState = record.favourite;

  const fileTag = (value: string, present: boolean): void => {
    const tag = value.trim();
    if (tag === "") {
      return;
    }
    void submitTag({ scope, expectedRevision: record.expectedRevision, payload: { partnerId: record.partnerId, tag, present } });
  };

  const retryTag = (): void => {
    const last = lastTagInput.current;
    if (last !== null) {
      void submitTag(last);
    }
  };

  const reapplyTag = (): void => {
    const last = lastTagInput.current;
    if (last === null || tagOutcome === null || tagOutcome.outcome !== "conflict") {
      return;
    }
    void submitTag({ scope: last.scope, expectedRevision: tagOutcome.currentRevision, payload: last.payload });
  };

  const setFavourite = (favourite: boolean): void => {
    void submitFavourite({ scope, expectedRevision: record.expectedRevision, payload: { partnerId: record.partnerId, favourite } });
  };

  const retryFavourite = (): void => {
    const last = lastFavouriteInput.current;
    if (last !== null) {
      void submitFavourite(last);
    }
  };

  const reapplyFavourite = (): void => {
    const last = lastFavouriteInput.current;
    if (last === null || favouriteOutcome === null || favouriteOutcome.outcome !== "conflict") {
      return;
    }
    void submitFavourite({ scope: last.scope, expectedRevision: favouriteOutcome.currentRevision, payload: last.payload });
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section aria-labelledby={tagsHeadingId} data-slot="record-tags" className={PANEL_CLASS}>
        <p id={tagsHeadingId} className="text-sm font-medium">
          {FILING_COPY.tagsOnRecord}
        </p>
        {currentTags.length === 0 ? (
          <p className={SENTENCE_CLASS}>{FILING_COPY.noTagsOnRecord}</p>
        ) : (
          <ul className={CHIP_LIST_CLASS}>
            {currentTags.map((held) => (
              <li key={held} data-slot="tag-chip" className="flex min-w-0 items-center gap-1">
                <Badge variant="secondary">
                  <bdi className="min-w-0 wrap-anywhere">{held}</bdi>
                </Badge>
                <Button type="button" variant="ghost" size="xs" className={TARGET_MIN_CLASS} disabled={tagChange.isPending} aria-label={FILING_COPY.removeTagFromRecord(held)} onClick={() => fileTag(held, false)}>
                  {FILING_COPY.removeLabel}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <FormField name="tag" label={FILING_COPY.tagLabel} description={FILING_COPY.tagDescription} error={tagErrors?.byField.tag}>
          {(field) => (
            <div className={CONTROL_ROW_CLASS}>
              <Input id={field.id} value={tagText} autoComplete="off" aria-describedby={field.describedBy} aria-invalid={field.invalid ? true : undefined} onChange={(event) => setTagText(event.target.value)} className="min-w-0 flex-1 basis-40" />
              <Button type="button" className={TARGET_MIN_CLASS} disabled={tagChange.isPending || typedTag === ""} onClick={() => fileTag(typedTag, true)}>
                {FILING_COPY.addLabel}
              </Button>
              <Button type="button" variant="outline" className={TARGET_MIN_CLASS} disabled={tagChange.isPending || typedTag === ""} onClick={() => fileTag(typedTag, false)}>
                {FILING_COPY.removeLabel}
              </Button>
            </div>
          )}
        </FormField>
        <TagSuggestions suggestions={tagSuggestions} disabled={tagChange.isPending} onChoose={setTagText} />
      </section>
      {tagOutcome === null ? null : <OperationResult outcome={tagOutcome} onCheckResult={onCheckResult} onRetrySameWork={mayReplay(tagOutcome) ? retryTag : undefined} onReapply={tagOutcome.outcome === "conflict" ? reapplyTag : undefined} fieldLabels={TAG_FIELD_LABELS} />}
      <Separator />
      <section data-slot="record-favourite" className={PANEL_CLASS}>
        <Label className="flex min-w-0 flex-wrap items-center gap-2">
          <Switch checked={favouriteState === true} onCheckedChange={setFavourite} disabled={favouriteState === undefined || favouriteChange.isPending} aria-labelledby={favouriteLabelId} aria-describedby={favouriteHintId} />
          <span id={favouriteLabelId} className="text-sm font-medium">
            {FILING_COPY.favouriteLabel}
          </span>
        </Label>
        <p id={favouriteHintId} className={SENTENCE_CLASS}>
          {favouriteSentence(favouriteState)}
        </p>
        <p className={SENTENCE_CLASS}>{FILING_COPY.favouriteDescription}</p>
      </section>
      {favouriteOutcome === null ? null : <OperationResult outcome={favouriteOutcome} onCheckResult={onCheckResult} onRetrySameWork={mayReplay(favouriteOutcome) ? retryFavourite : undefined} onReapply={favouriteOutcome.outcome === "conflict" ? reapplyFavourite : undefined} fieldLabels={FAVOURITE_FIELD_LABELS} />}
    </div>
  );
}

interface SelectionFilingProps {
  readonly scope: Scope;
  readonly records: readonly PartnerFilingRef[];
  readonly tagSuggestions: readonly string[];
  readonly onSettled?: (outcome: MutationOutcome) => void;
  readonly onCheckResult?: () => void;
  readonly headingLevel: ReviewHeadingLevel;
}

/**
 * An explicitly selected set: one instruction, one review step that lists exactly the records it will file,
 * and one attempt per record — each with its own identity, its own revision and its own row in the result —
 * because the family's change files a single record per request.
 */
function SelectionFiling({ scope, records, tagSuggestions, onSettled, onCheckResult, headingLevel }: SelectionFilingProps): ReactElement {
  const [tagText, setTagText] = useState("");
  const [tagErrors, setTagErrors] = useState<FieldErrorLookup | null>(null);
  const [instruction, setInstruction] = useState<BatchInstruction | null>(null);
  const [rows, setRows] = useState<readonly PerItemResult[]>([]);
  const [pending, setPending] = useState(false);
  // The instruction that was actually submitted, and what it settled as. The re-read beside a standing
  // change advances every selected record's revision, so holding the submitted intent is what keeps the
  // receipt on the page instead of turning the settled step back into an unreviewed one.
  const [submittedTag, setSubmittedTag] = useState<Omit<MutationInput<BatchTagPayload>, "operationId"> | null>(null);
  const [submittedFavourite, setSubmittedFavourite] = useState<Omit<MutationInput<BatchFavouritePayload>, "operationId"> | null>(null);
  const [settledOutcome, setSettledOutcome] = useState<MutationOutcome | null>(null);
  const tagSubmits = useRef(new Map<string, TagSubmit>());
  const favouriteSubmits = useRef(new Map<string, FavouriteSubmit>());
  // The record whose last attempt conflicted, so a re-application presents the revision the review step
  // now holds for that record instead of the stale one it was read at.
  const conflictedRef = useRef<string | null>(null);

  const register = useCallback((record: PartnerFilingRef, submits: RecordSubmits): (() => void) => {
    tagSubmits.current.set(record.partnerId, submits.setTag);
    favouriteSubmits.current.set(record.partnerId, submits.setFavourite);
    return () => {
      if (tagSubmits.current.get(record.partnerId) === submits.setTag) {
        tagSubmits.current.delete(record.partnerId);
      }
      if (favouriteSubmits.current.get(record.partnerId) === submits.setFavourite) {
        favouriteSubmits.current.delete(record.partnerId);
      }
    };
  }, []);

  const recordsById = useMemo(() => new Map(records.map((record) => [record.partnerId, record])), [records]);
  const batchInputs = useMemo(() => batchInputsOf(records), [records]);
  // The review step's identity for the whole selection. Each record's own revision also travels inside the
  // reviewed payload, because the service checks that one; this value only makes the reviewed intent differ
  // whenever the selection or one of the revisions in it changes.
  const selectionRevision = records.map((record) => `${record.partnerId}@${record.expectedRevision}`).join(" | ");

  const settle = useCallback((operationId: string, entries: readonly BatchEntry[]): MutationOutcome => {
    const nextRows = entries.map((entry) => (entry.outcome === null ? excludedRow(entry.partnerId) : rowOf(entry.outcome, entry.partnerId)));
    setRows(nextRows);
    return batchOutcomeOf(operationId, entries, nextRows);
  }, []);

  const submitTagBatch = useCallback<MutationSubmit<BatchTagPayload>>(
    async (attempt) => {
      setPending(true);
      setSubmittedTag({ scope: attempt.scope, expectedRevision: attempt.expectedRevision, payload: attempt.payload });
      try {
        const entries = await Promise.all(
          attempt.payload.records.map(async (record): Promise<BatchEntry> => {
            const submit = tagSubmits.current.get(record.partnerId);
            if (submit === undefined) {
              return { partnerId: record.partnerId, outcome: null };
            }
            const expectedRevision = conflictedRef.current === record.partnerId ? attempt.expectedRevision : record.expectedRevision;
            const outcome = await submit({ scope: attempt.scope, expectedRevision, payload: { partnerId: record.partnerId, tag: attempt.payload.tag, present: attempt.payload.present } });
            if (outcome.outcome === "conflict") {
              conflictedRef.current = record.partnerId;
            }
            return { partnerId: record.partnerId, outcome };
          }),
        );
        setTagErrors(invalidFieldsOf(entries));
        return settle(attempt.operationId, entries);
      } finally {
        setPending(false);
      }
    },
    [settle],
  );

  const submitFavouriteBatch = useCallback<MutationSubmit<BatchFavouritePayload>>(
    async (attempt) => {
      setPending(true);
      setSubmittedFavourite({ scope: attempt.scope, expectedRevision: attempt.expectedRevision, payload: attempt.payload });
      try {
        const entries = await Promise.all(
          attempt.payload.records.map(async (record): Promise<BatchEntry> => {
            const submit = favouriteSubmits.current.get(record.partnerId);
            if (submit === undefined) {
              return { partnerId: record.partnerId, outcome: null };
            }
            const expectedRevision = conflictedRef.current === record.partnerId ? attempt.expectedRevision : record.expectedRevision;
            const outcome = await submit({ scope: attempt.scope, expectedRevision, payload: { partnerId: record.partnerId, favourite: attempt.payload.favourite } });
            if (outcome.outcome === "conflict") {
              conflictedRef.current = record.partnerId;
            }
            return { partnerId: record.partnerId, outcome };
          }),
        );
        return settle(attempt.operationId, entries);
      } finally {
        setPending(false);
      }
    },
    [settle],
  );

  const author = (next: BatchInstruction): void => {
    conflictedRef.current = null;
    setRows([]);
    setTagErrors(null);
    setSubmittedTag(null);
    setSubmittedFavourite(null);
    setSettledOutcome(null);
    setInstruction(next);
  };

  const clearInstruction = (): void => {
    setInstruction(null);
  };

  const handleSettled = useCallback(
    (outcome: MutationOutcome): void => {
      setSettledOutcome(outcome);
      onSettled?.(outcome);
    },
    [onSettled],
  );

  // A change that stood keeps the intent that produced it: the re-read beside it advances every selected
  // record's revision, and a live intent would read as an unreviewed one and hide the receipt.
  const holdsReceipt = settledOutcome !== null && (settledOutcome.outcome === "accepted" || settledOutcome.outcome === "alreadyAccepted" || settledOutcome.outcome === "unchanged");

  const typedTag = tagText.trim();
  const tagInstruction = instruction !== null && instruction.kind === "tag" ? instruction : null;
  const favouriteInstruction = instruction !== null && instruction.kind === "favourite" ? instruction : null;
  const tagInput: Omit<MutationInput<BatchTagPayload>, "operationId"> | null = tagInstruction === null ? null : { scope, expectedRevision: selectionRevision, payload: { records: batchInputs, tag: tagInstruction.tag, present: tagInstruction.present } };
  const favouriteInput: Omit<MutationInput<BatchFavouritePayload>, "operationId"> | null = favouriteInstruction === null ? null : { scope, expectedRevision: selectionRevision, payload: { records: batchInputs, favourite: favouriteInstruction.favourite } };
  const heldTagInput = holdsReceipt && submittedTag !== null ? submittedTag : tagInput;
  const heldFavouriteInput = holdsReceipt && submittedFavourite !== null ? submittedFavourite : favouriteInput;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className={SENTENCE_CLASS}>{FILING_COPY.selectionSummary(records.length)}</p>
      <section data-slot="selection-tags" className={PANEL_CLASS}>
        <FormField name="tag" label={FILING_COPY.tagLabel} description={FILING_COPY.tagDescription} error={tagErrors?.byField.tag}>
          {(field) => (
            <div className={CONTROL_ROW_CLASS}>
              <Input id={field.id} value={tagText} autoComplete="off" aria-describedby={field.describedBy} aria-invalid={field.invalid ? true : undefined} onChange={(event) => setTagText(event.target.value)} className="min-w-0 flex-1 basis-40" />
              <Button type="button" className={TARGET_MIN_CLASS} disabled={pending || typedTag === ""} onClick={() => author({ kind: "tag", tag: typedTag, present: true })}>
                {FILING_COPY.addLabel}
              </Button>
              <Button type="button" variant="outline" className={TARGET_MIN_CLASS} disabled={pending || typedTag === ""} onClick={() => author({ kind: "tag", tag: typedTag, present: false })}>
                {FILING_COPY.removeLabel}
              </Button>
            </div>
          )}
        </FormField>
        <TagSuggestions suggestions={tagSuggestions} disabled={pending} onChoose={setTagText} />
      </section>
      <Separator />
      <section data-slot="selection-favourite" className={PANEL_CLASS}>
        <p className="text-sm font-medium">{FILING_COPY.favouriteLabel}</p>
        <div className={CONTROL_ROW_CLASS}>
          <Button type="button" variant="outline" className={TARGET_MIN_CLASS} disabled={pending} onClick={() => author({ kind: "favourite", favourite: true })}>
            {FILING_COPY.favouriteOnLabel}
          </Button>
          <Button type="button" variant="outline" className={TARGET_MIN_CLASS} disabled={pending} onClick={() => author({ kind: "favourite", favourite: false })}>
            {FILING_COPY.favouriteOffLabel}
          </Button>
        </div>
        <p className={SENTENCE_CLASS}>{FILING_COPY.favouriteDescription}</p>
      </section>
      {instruction === null ? null : records.map((record) => <RecordSubmitters key={record.partnerId} record={record} register={register} />)}
      {tagInput === null || tagInstruction === null ? null : (
        <ActionReview<BatchTagPayload>
          title={tagInstruction.present ? FILING_COPY.addReviewTitle : FILING_COPY.removeReviewTitle}
          description={reviewDescription(<TagValue label={tagInstruction.present ? FILING_COPY.tagToAdd : FILING_COPY.tagToRemove} tag={tagInstruction.tag} />, records)}
          confirmLabel={tagInstruction.present ? FILING_COPY.addLabel : FILING_COPY.removeLabel}
          onCancel={clearInstruction}
          selection={{ count: records.length, noun: recordsNoun(records.length) }}
          input={heldTagInput ?? tagInput}
          submit={submitTagBatch}
          onSettled={handleSettled}
          checkResult={onCheckResult}
          fieldLabels={TAG_FIELD_LABELS}
          headingLevel={headingLevel}
        />
      )}
      {favouriteInput === null || favouriteInstruction === null ? null : (
        <ActionReview<BatchFavouritePayload>
          title={favouriteInstruction.favourite ? FILING_COPY.favouriteOnTitle : FILING_COPY.favouriteOffTitle}
          description={reviewDescription(FILING_COPY.favouriteValue(favouriteInstruction.favourite), records)}
          confirmLabel={favouriteInstruction.favourite ? FILING_COPY.favouriteOnLabel : FILING_COPY.favouriteOffLabel}
          onCancel={clearInstruction}
          selection={{ count: records.length, noun: recordsNoun(records.length) }}
          input={heldFavouriteInput ?? favouriteInput}
          submit={submitFavouriteBatch}
          onSettled={handleSettled}
          checkResult={onCheckResult}
          fieldLabels={FAVOURITE_FIELD_LABELS}
          headingLevel={headingLevel}
        />
      )}
      {rows.length === 0 ? null : (
        <PerItemResults
          heading={FILING_COPY.rowsHeading}
          items={rows}
          columns={ROW_COLUMNS}
          renderItemAction={(item: PerItemResult) => {
            const name = recordsById.get(item.targetId)?.displayName?.trim() ?? "";
            return name === "" ? null : <bdi className="min-w-0 wrap-anywhere">{name}</bdi>;
          }}
        />
      )}
    </div>
  );
}

const HEADING_TAG = { 2: "h2", 3: "h3", 4: "h4" } as const;
const NESTED_HEADING: Readonly<Record<ReviewHeadingLevel, 3 | 4>> = { 2: 3, 3: 4, 4: 4 };
const TAG_FIELD_LABELS: Readonly<Record<string, string>> = { tag: FILING_COPY.tagLabel, partnerId: "Record", present: "Change", records: "Records" };
const FAVOURITE_FIELD_LABELS: Readonly<Record<string, string>> = { favourite: FILING_COPY.favouriteLabel, partnerId: "Record", records: "Records" };

/** The sentence that states one record's favourite mark, or why it cannot be changed here. */
function favouriteSentence(favourite: boolean | undefined): string {
  if (favourite === undefined) {
    return FILING_COPY.favouriteUnpublished;
  }
  return favourite ? FILING_COPY.favouriteMarked : FILING_COPY.favouriteClear;
}

/** The per-field messages the first refused record in a selection produced, so the field they name shows them. */
function invalidFieldsOf(entries: readonly BatchEntry[]): FieldErrorLookup | null {
  for (const entry of entries) {
    if (entry.outcome !== null && entry.outcome.outcome === "invalid") {
      return fieldErrorsFromInvalid(entry.outcome);
    }
  }
  return null;
}

/** The tag a reviewed instruction applies, isolated so a label in any script renders in its own direction. */
function TagValue({ label, tag }: { readonly label: string; readonly tag: string }): ReactElement {
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-1">
      <span>{label}</span>
      <bdi className="min-w-0 font-medium wrap-anywhere">{tag}</bdi>
    </span>
  );
}

/** The review description: what will be applied, and exactly which records it applies to. */
function reviewDescription(value: ReactNode, records: readonly PartnerFilingRef[]): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p>{FILING_COPY.selectionIntro(records.length)}</p>
      <p>{value}</p>
      <p>{FILING_COPY.selectionScope}</p>
      <SelectedRecordList records={records} />
    </div>
  );
}

/**
 * Files one record, or exactly the records the caller selected, under the worker's own tag or favourite
 * mark. Every change is one named mutation with its own operation identity and revision, and every outcome
 * stays on the page as the receipt for it.
 */
export function TagAndFavouriteActions({ scope, target, tagSuggestions = [], onSettled, onCheckResult, headingLevel = 2, className }: TagAndFavouriteActionsProps): ReactElement {
  const headingId = useId();
  const records = useMemo(() => filingRecordsOf(target), [target]);
  const Heading = HEADING_TAG[headingLevel];
  const onlyRecord = "partnerRef" in target ? target.partnerRef : undefined;
  // Only an empty selection is stated here as a notice. Every refusal, outage or unconfirmed result that a
  // submitted change answers with is rendered by the shared receipt and the per-item rows, so no state is
  // ever stated twice on this surface.
  return (
    <section aria-labelledby={headingId} data-slot="tag-and-favourite-actions" data-mode={onlyRecord === undefined ? "selection" : "record"} className={cn(ROOT_CLASS, className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <Heading id={headingId} className="text-sm font-medium">
          {FILING_COPY.heading}
        </Heading>
        <p className={SENTENCE_CLASS}>{FILING_COPY.distinction}</p>
        <p className={SENTENCE_CLASS}>{FILING_COPY.notPrivateText}</p>
      </div>
      {onlyRecord === undefined ? (
        records.length === 0 ? (
          <StateNotice kind="empty" title={EMPTY_SELECTION_TITLE} description={EMPTY_SELECTION_DESCRIPTION} headingLevel={NESTED_HEADING[headingLevel]} />
        ) : (
          <SelectionFiling scope={scope} records={records} tagSuggestions={tagSuggestions} onSettled={onSettled} onCheckResult={onCheckResult} headingLevel={headingLevel} />
        )
      ) : (
        <SingleRecordFiling scope={scope} record={onlyRecord} tagSuggestions={tagSuggestions} onSettled={onSettled} onCheckResult={onCheckResult} />
      )}
    </section>
  );
}

export default TagAndFavouriteActions;
