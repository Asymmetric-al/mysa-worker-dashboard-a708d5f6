"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import ActionReview, { type ReviewHeadingLevel } from "@/components/action-review";
import { outcomeRow, useAttemptedMutation, type MutationSubmit, type OutcomeRowCopy, type UseAttemptedMutationResult } from "@/components/attempt";
import { fieldErrorsFromInvalid, FormField, type FieldErrorLookup } from "@/components/form-field";
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
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import { accepted, unchanged, type MutationOutcome, type PerItemResult } from "@/modules/data-service/outcome";
import { AUDIENCE_LABEL_COPY } from "../copy/privacy";
import { useSetFavourite, useSetTag } from "../hooks/use-partner-mutations";
import type { SetFavouritePayload, SetTagPayload } from "../schemas/tag";
export type PartnerFilingRef = { readonly partnerId: string; readonly expectedRevision: string; readonly displayName?: string; readonly tags?: readonly string[]; readonly favourite?: boolean };
export type TagAndFavouriteTarget = { readonly partnerRef: PartnerFilingRef } | { readonly partnerRefs: readonly PartnerFilingRef[] };
export interface TagAndFavouriteActionsProps {
  readonly scope: Scope;
  readonly target: TagAndFavouriteTarget;
  readonly tagSuggestions?: readonly string[];
  readonly onSettled?: (outcome: MutationOutcome) => void;
  readonly onCheckResult?: () => void;
  readonly headingLevel?: ReviewHeadingLevel;
  readonly className?: string;
}
type BatchInstruction = { readonly kind: "tag"; readonly tag: string; readonly present: boolean } | { readonly kind: "favourite"; readonly favourite: boolean };
type BatchRecordInput = { readonly partnerId: string; readonly expectedRevision: string };
type BatchTagPayload = { readonly records: readonly BatchRecordInput[]; readonly tag: string; readonly present: boolean };
type BatchFavouritePayload = { readonly records: readonly BatchRecordInput[]; readonly favourite: boolean };
type BatchEntry = { readonly partnerId: string; readonly outcome: MutationOutcome | null };
type TagSubmit = (input: Omit<MutationInput<SetTagPayload>, "operationId">) => Promise<MutationOutcome>;
type FavouriteSubmit = (input: Omit<MutationInput<SetFavouritePayload>, "operationId">) => Promise<MutationOutcome>;
type RecordSubmits = { readonly setTag: TagSubmit; readonly setFavourite: FavouriteSubmit };
const PANEL_CLASS = "flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3";
const SENTENCE_CLASS = "text-sm text-pretty text-muted-foreground";
const CONTROL_ROW_CLASS = "flex min-w-0 flex-wrap items-center gap-2";
const TARGET_MIN_CLASS = "h-auto max-h-none min-h-6 max-w-full whitespace-normal";
const ROW_COLUMNS: readonly PerItemColumn[] = [{ key: "revision", label: "Revision" }];
const recordsNoun = (count: number): string => (count === 1 ? "record" : "records");
const ROW_ALREADY_APPLIED = "This record's change was already applied under the same request, so nothing was applied twice and its revision did not advance.";
const ROW_CONFLICT = "This record moved after you read it, so nothing was written to it. Re-apply the change to write it against the revision it holds now.";
const ROW_DENIED = "This change was not permitted in the current session and context, so nothing was written to this record.";
const ROW_UNKNOWN = "This record's result is not confirmed. Checking it returns the original result, and repeating the same request replays it rather than opening a second change.";
const ROW_UNAVAILABLE = (system: string, reference: string): string => `The source behind this change could not be read (${system}, reference ${reference}), so nothing was written to this record.`;
const FILING_COPY = {
  notPrivateText: `A tag sits on the record rather than in your private preparation, so it is not private text: ${AUDIENCE_LABEL_COPY.shared.description}`,
  tagLabel: "Tag",
  addLabel: "Add tag",
  removeLabel: "Remove tag",
  removeTagFromRecord: (tag: string): string => `Remove the tag “${tag}” from this record`,
  favouriteLabel: "Favourite",
  favouriteDescription: "The favourite mark is your own: it sorts records for you and changes nothing about who may see the record or how it is supported.",
  favouriteOnLabel: "Mark as favourite",
  favouriteOffLabel: "Clear the favourite",
  selectionIntro: (count: number): string => `Each of the ${String(count)} selected ${recordsNoun(count)} is filed on its own, with its own revision checked and its own result reported below.`,
  selectionSummary: (count: number): string => `${String(count)} ${recordsNoun(count)} selected. Choose the tag or the favourite mark below, then review the change before it is applied; choosing one changes nothing on its own.`,
  favouriteValue: (favourite: boolean): string => (favourite ? "The favourite mark is set on each selected record." : "The favourite mark is cleared on each selected record."),
} as const;
const ROW_COPY: OutcomeRowCopy = { alreadyApplied: ROW_ALREADY_APPLIED, conflict: ROW_CONFLICT, denied: ROW_DENIED, unavailable: (source) => ROW_UNAVAILABLE(source.system, source.reference), unknown: (operationId) => `${ROW_UNKNOWN} Operation ${operationId}.` };
const excludedRow = (partnerId: string): PerItemResult => ({ targetId: partnerId, state: "excluded", reasonCode: "not-prepared", reason: "This record's change could not be prepared in this view, so nothing about it changed." });
const standsAsChanged = (outcome: MutationOutcome): boolean => outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted";
type RevisionStatingOutcome = Extract<MutationOutcome, { readonly outcome: "accepted" | "alreadyAccepted" | "unchanged" }>;
const lastRevisionOf = (outcomes: readonly MutationOutcome[]): string => outcomes.findLast((outcome): outcome is RevisionStatingOutcome => outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unchanged")?.revision ?? "";
function batchOutcomeOf(operationId: string, entries: readonly BatchEntry[], rows: readonly PerItemResult[]): MutationOutcome {
  const trouble = entries.find((entry) => entry.outcome !== null && !standsAsChanged(entry.outcome));
  if (trouble !== undefined && trouble.outcome !== null) return trouble.outcome;
  const answered = entries.flatMap((entry) => (entry.outcome === null ? [] : [entry.outcome]));
  const first = answered[0];
  if (first !== undefined && answered.every((outcome) => outcome.outcome === "alreadyAccepted")) return first;
  if (first !== undefined && answered.every((outcome) => outcome.outcome === "unchanged")) return first;
  const changed = entries.flatMap((entry) => (entry.outcome !== null && entry.outcome.outcome === "accepted" ? [entry.partnerId] : []));
  const revision = lastRevisionOf(answered);
  return changed.length === 0 ? unchanged({ operationId, revision }) : accepted({ operationId, revision, changed, items: rows });
}
function filingRecordsOf(target: TagAndFavouriteTarget): readonly PartnerFilingRef[] {
  if ("partnerRef" in target) return [target.partnerRef];
  const seen = new Set<string>();
  return target.partnerRefs.filter((record) => {
    if (seen.has(record.partnerId)) return false;
    seen.add(record.partnerId);
    return true;
  });
}
const batchInputsOf = (records: readonly PartnerFilingRef[]): readonly BatchRecordInput[] => records.map((record) => ({ partnerId: record.partnerId, expectedRevision: record.expectedRevision }));
type AttemptSource = Pick<UseAttemptedMutationResult<unknown>, "outcome" | "canReplay" | "conflictRevision" | "retry" | "reapplyOnConflict">;
function AttemptOutcome({ attempt, fieldLabels, onCheckResult }: { readonly attempt: AttemptSource; readonly fieldLabels: Readonly<Record<string, string>>; readonly onCheckResult?: () => void }): ReactElement | null {
  if (attempt.outcome === null) return null;
  return <OperationResult outcome={attempt.outcome} onCheckResult={onCheckResult} onRetrySameWork={attempt.canReplay ? () => void attempt.retry() : undefined} onReapply={attempt.conflictRevision === null ? undefined : () => void attempt.reapplyOnConflict()} fieldLabels={fieldLabels} />;
}
function RecordSubmitters({ record, register }: { readonly record: PartnerFilingRef; readonly register: (record: PartnerFilingRef, submits: RecordSubmits) => () => void }): null {
  const tag = useSetTag(record.partnerId);
  const favourite = useSetFavourite(record.partnerId);
  useEffect(() => register(record, { setTag: tag.submit, setFavourite: favourite.submit }), [register, record, tag.submit, favourite.submit]);
  return null;
}
function TagSuggestions({ suggestions, disabled, onChoose }: { readonly suggestions: readonly string[]; readonly disabled: boolean; readonly onChoose: (tag: string) => void }): ReactElement {
  if (suggestions.length === 0) return <p className={SENTENCE_CLASS}>No tag has been used in this ministry yet, so there is nothing to reuse. The first label you type is the first one recorded.</p>;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" />} disabled={disabled}>
        Your tags
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        <DropdownMenuLabel>Tags you already use</DropdownMenuLabel>
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
type TagEntryProps = { readonly text: string; readonly onTextChange: (next: string) => void; readonly pending: boolean; readonly error: readonly string[] | undefined; readonly suggestions: readonly string[]; readonly onApply: (tag: string, present: boolean) => void };
function TagEntry({ text, onTextChange, pending, error, suggestions, onApply }: TagEntryProps): ReactElement {
  const typed = text.trim();
  return (
    <>
      <FormField name="tag" label={FILING_COPY.tagLabel} description="Type any label you file records under. A label you have not used before is accepted exactly as you type it, because this vocabulary is yours and not a fixed list." error={error}>
        {(field) => (
          <div className={CONTROL_ROW_CLASS}>
            <Input id={field.id} value={text} autoComplete="off" aria-describedby={field.describedBy} aria-invalid={field.invalid ? true : undefined} onChange={(event) => onTextChange(event.target.value)} className="min-w-0 flex-1 basis-40" />
            <Button type="button" className={TARGET_MIN_CLASS} disabled={pending || typed === ""} onClick={() => onApply(typed, true)}>
              {FILING_COPY.addLabel}
            </Button>
            <Button type="button" variant="outline" className={TARGET_MIN_CLASS} disabled={pending || typed === ""} onClick={() => onApply(typed, false)}>
              {FILING_COPY.removeLabel}
            </Button>
          </div>
        )}
      </FormField>
      <TagSuggestions suggestions={suggestions} disabled={pending} onChoose={onTextChange} />
    </>
  );
}
function SelectedRecordList({ records }: { readonly records: readonly PartnerFilingRef[] }): ReactElement {
  const headingId = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p id={headingId} className="text-sm font-medium">
        {"Selected records"}: <bdi className="tabular-figures font-medium text-foreground">{String(records.length)}</bdi> {recordsNoun(records.length)}
      </p>
      <ul aria-labelledby={headingId} className="flex min-w-0 flex-col gap-1 text-sm">
        {records.map((record) => {
          const name = record.displayName?.trim() ?? "";
          return (
            <li key={record.partnerId} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              {name === "" ? null : <bdi className="min-w-0 font-medium wrap-anywhere">{name}</bdi>}
              <bdi className="mono-identifier min-w-0 wrap-anywhere">{record.partnerId}</bdi>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
type SingleRecordFilingProps = { readonly scope: Scope; readonly record: PartnerFilingRef; readonly tagSuggestions: readonly string[]; readonly onSettled?: (outcome: MutationOutcome) => void; readonly onCheckResult?: () => void };
function SingleRecordFiling({ scope, record, tagSuggestions, onSettled, onCheckResult }: SingleRecordFilingProps): ReactElement {
  const tag = useSetTag(record.partnerId);
  const favourite = useSetFavourite(record.partnerId);
  const submitTagRequest = tag.submit;
  const submitFavouriteRequest = favourite.submit;
  const tagsHeadingId = useId();
  const favouriteHintId = useId();
  const favouriteLabelId = useId();
  const [tagText, setTagText] = useState("");
  const tagAttempt = useAttemptedMutation<SetTagPayload>(
    (input) => submitTagRequest(input),
    (outcome: MutationOutcome): void => {
      if (standsAsChanged(outcome)) setTagText("");
      onSettled?.(outcome);
    },
  );
  const favouriteAttempt = useAttemptedMutation<SetFavouritePayload>((input) => submitFavouriteRequest(input), onSettled);
  const currentTags = record.tags ?? [];
  const favouriteState = record.favourite;
  const fileTag = (value: string, present: boolean): void => {
    const trimmed = value.trim();
    if (trimmed === "") return;
    void tagAttempt.submit({ scope, expectedRevision: record.expectedRevision, payload: { partnerId: record.partnerId, tag: trimmed, present } });
  };
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section aria-labelledby={tagsHeadingId} data-slot="record-tags" className={PANEL_CLASS}>
        <p id={tagsHeadingId} className="text-sm font-medium">
          Tags on this record
        </p>
        {currentTags.length === 0 ? (
          <p className={SENTENCE_CLASS}>No tag is on this record yet.</p>
        ) : (
          <ul className="flex min-w-0 flex-wrap items-center gap-2">
            {currentTags.map((held) => (
              <li key={held} data-slot="tag-chip" className="flex min-w-0 items-center gap-1">
                <Badge variant="secondary">
                  <bdi className="min-w-0 wrap-anywhere">{held}</bdi>
                </Badge>
                <Button type="button" variant="ghost" size="xs" className={TARGET_MIN_CLASS} disabled={tagAttempt.pending} aria-label={FILING_COPY.removeTagFromRecord(held)} onClick={() => fileTag(held, false)}>
                  {FILING_COPY.removeLabel}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <TagEntry text={tagText} onTextChange={setTagText} pending={tagAttempt.pending} error={tagAttempt.fieldErrors?.byField.tag} suggestions={tagSuggestions} onApply={fileTag} />
      </section>
      <AttemptOutcome attempt={tagAttempt} fieldLabels={TAG_FIELD_LABELS} onCheckResult={onCheckResult} />
      <Separator />
      <section data-slot="record-favourite" className={PANEL_CLASS}>
        <Label className="flex min-w-0 flex-wrap items-center gap-2">
          <Switch
            checked={favouriteState === true}
            onCheckedChange={(next) => void favouriteAttempt.submit({ scope, expectedRevision: record.expectedRevision, payload: { partnerId: record.partnerId, favourite: next } })}
            disabled={favouriteState === undefined || favouriteAttempt.pending}
            aria-labelledby={favouriteLabelId}
            aria-describedby={favouriteHintId}
          />
          <span id={favouriteLabelId} className="text-sm font-medium">
            {FILING_COPY.favouriteLabel}
          </span>
        </Label>
        <p id={favouriteHintId} className={SENTENCE_CLASS}>
          {favouriteSentence(favouriteState)}
        </p>
        <p className={SENTENCE_CLASS}>{FILING_COPY.favouriteDescription}</p>
      </section>
      <AttemptOutcome attempt={favouriteAttempt} fieldLabels={FAVOURITE_FIELD_LABELS} onCheckResult={onCheckResult} />
    </div>
  );
}
type SelectionFilingProps = { readonly scope: Scope; readonly records: readonly PartnerFilingRef[]; readonly tagSuggestions: readonly string[]; readonly onSettled?: (outcome: MutationOutcome) => void; readonly onCheckResult?: () => void; readonly headingLevel: ReviewHeadingLevel };
function SelectionFiling({ scope, records, tagSuggestions, onSettled, onCheckResult, headingLevel }: SelectionFilingProps): ReactElement {
  const [tagText, setTagText] = useState("");
  const [tagErrors, setTagErrors] = useState<FieldErrorLookup | null>(null);
  const [instruction, setInstruction] = useState<BatchInstruction | null>(null);
  const [rows, setRows] = useState<readonly PerItemResult[]>([]);
  const [pending, setPending] = useState(false);
  const [submittedTag, setSubmittedTag] = useState<Omit<MutationInput<BatchTagPayload>, "operationId"> | null>(null);
  const [submittedFavourite, setSubmittedFavourite] = useState<Omit<MutationInput<BatchFavouritePayload>, "operationId"> | null>(null);
  const [settledOutcome, setSettledOutcome] = useState<MutationOutcome | null>(null);
  const tagSubmits = useRef(new Map<string, TagSubmit>());
  const favouriteSubmits = useRef(new Map<string, FavouriteSubmit>());
  const conflictedRef = useRef<string | null>(null);
  const register = useCallback((record: PartnerFilingRef, submits: RecordSubmits): (() => void) => {
    tagSubmits.current.set(record.partnerId, submits.setTag);
    favouriteSubmits.current.set(record.partnerId, submits.setFavourite);
    return () => {
      if (tagSubmits.current.get(record.partnerId) === submits.setTag) tagSubmits.current.delete(record.partnerId);
      if (favouriteSubmits.current.get(record.partnerId) === submits.setFavourite) favouriteSubmits.current.delete(record.partnerId);
    };
  }, []);
  const recordsById = useMemo(() => new Map(records.map((record) => [record.partnerId, record])), [records]);
  const batchInputs = useMemo(() => batchInputsOf(records), [records]);
  const selectionRevision = records.map((record) => `${record.partnerId}@${record.expectedRevision}`).join(" | ");
  const settle = useCallback((operationId: string, entries: readonly BatchEntry[]): MutationOutcome => {
    const nextRows = entries.map((entry) => (entry.outcome === null ? excludedRow(entry.partnerId) : outcomeRow(entry.partnerId, entry.outcome, ROW_COPY)));
    setRows(nextRows);
    return batchOutcomeOf(operationId, entries, nextRows);
  }, []);
  const attemptEachRecord = useCallback(
    async (expectedRevision: string, records: readonly BatchRecordInput[], attemptFor: (record: BatchRecordInput, revision: string) => Promise<MutationOutcome> | null): Promise<readonly BatchEntry[]> =>
      Promise.all(
        records.map(async (record): Promise<BatchEntry> => {
          const submitted = attemptFor(record, conflictedRef.current === record.partnerId ? expectedRevision : record.expectedRevision);
          if (submitted === null) return { partnerId: record.partnerId, outcome: null };
          const outcome = await submitted;
          if (outcome.outcome === "conflict") conflictedRef.current = record.partnerId;
          return { partnerId: record.partnerId, outcome };
        }),
      ),
    [],
  );
  const runBatch = useCallback(
    async (operationId: string, records: readonly BatchRecordInput[], expectedRevision: string, attemptFor: (record: BatchRecordInput, revision: string) => Promise<MutationOutcome> | null, onEntries?: (entries: readonly BatchEntry[]) => void): Promise<MutationOutcome> => {
      setPending(true);
      try {
        const entries = await attemptEachRecord(expectedRevision, records, attemptFor);
        onEntries?.(entries);
        return settle(operationId, entries);
      } finally {
        setPending(false);
      }
    },
    [settle, attemptEachRecord],
  );
  const submitTagBatch = useCallback<MutationSubmit<BatchTagPayload>>(
    (attempt) => {
      setSubmittedTag({ scope: attempt.scope, expectedRevision: attempt.expectedRevision, payload: attempt.payload });
      const attemptFor = (record: BatchRecordInput, expectedRevision: string): Promise<MutationOutcome> | null => tagSubmits.current.get(record.partnerId)?.({ scope: attempt.scope, expectedRevision, payload: { partnerId: record.partnerId, tag: attempt.payload.tag, present: attempt.payload.present } }) ?? null;
      return runBatch(attempt.operationId, attempt.payload.records, attempt.expectedRevision, attemptFor, (entries) => setTagErrors(invalidFieldsOf(entries)));
    },
    [runBatch],
  );
  const submitFavouriteBatch = useCallback<MutationSubmit<BatchFavouritePayload>>(
    (attempt) => {
      setSubmittedFavourite({ scope: attempt.scope, expectedRevision: attempt.expectedRevision, payload: attempt.payload });
      const attemptFor = (record: BatchRecordInput, expectedRevision: string): Promise<MutationOutcome> | null => favouriteSubmits.current.get(record.partnerId)?.({ scope: attempt.scope, expectedRevision, payload: { partnerId: record.partnerId, favourite: attempt.payload.favourite } }) ?? null;
      return runBatch(attempt.operationId, attempt.payload.records, attempt.expectedRevision, attemptFor);
    },
    [runBatch],
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
  const holdsReceipt = settledOutcome !== null && (settledOutcome.outcome === "accepted" || settledOutcome.outcome === "alreadyAccepted" || settledOutcome.outcome === "unchanged");
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
        <TagEntry text={tagText} onTextChange={setTagText} pending={pending} error={tagErrors?.byField.tag} suggestions={tagSuggestions} onApply={(tag, present) => author({ kind: "tag", tag, present })} />
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
          title={tagInstruction.present ? "Add this tag to the selected records" : "Remove this tag from the selected records"}
          description={reviewDescription(<TagValue label={tagInstruction.present ? "Tag to add:" : "Tag to remove:"} tag={tagInstruction.tag} />, records)}
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
          title={favouriteInstruction.favourite ? "Mark the selected records as favourites" : "Clear the favourite mark from the selected records"}
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
          heading="Result for each selected record"
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
function favouriteSentence(favourite: boolean | undefined): string {
  if (favourite === undefined) return "The read published no favourite mark for this record, so the mark cannot be changed here.";
  return favourite ? "This record is marked as a favourite." : "This record is not marked as a favourite.";
}
function invalidFieldsOf(entries: readonly BatchEntry[]): FieldErrorLookup | null {
  for (const entry of entries) if (entry.outcome !== null && entry.outcome.outcome === "invalid") return fieldErrorsFromInvalid(entry.outcome);
  return null;
}
function TagValue({ label, tag }: { readonly label: string; readonly tag: string }): ReactElement {
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-1">
      <span>{label}</span>
      <bdi className="min-w-0 font-medium wrap-anywhere">{tag}</bdi>
    </span>
  );
}
function reviewDescription(value: ReactNode, records: readonly PartnerFilingRef[]): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p>{FILING_COPY.selectionIntro(records.length)}</p>
      <p>{value}</p>
      <p>Only the records listed here are affected. This selection is not an audience, a consent or a campaign, and the change never reaches a record you did not select.</p>
      <SelectedRecordList records={records} />
    </div>
  );
}
/** Files one record, or exactly the records the caller selected, under the worker's own tag or favourite mark. */
export function TagAndFavouriteActions({ scope, target, tagSuggestions = [], onSettled, onCheckResult, headingLevel = 2, className }: TagAndFavouriteActionsProps): ReactElement {
  const headingId = useId();
  const records = useMemo(() => filingRecordsOf(target), [target]);
  const Heading = HEADING_TAG[headingLevel];
  const onlyRecord = "partnerRef" in target ? target.partnerRef : undefined;
  return (
    <section aria-labelledby={headingId} data-slot="tag-and-favourite-actions" data-mode={onlyRecord === undefined ? "selection" : "record"} className={cn("flex min-w-0 flex-col gap-4", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <Heading id={headingId} className="text-sm font-medium">
          Tags and favourite
        </Heading>
        <p className={SENTENCE_CLASS}>A tag is your own filing label on this record. It is not an audience, a consent, a stage or a segment, and filing the record changes nothing else about it: no notice is sent, no gift is recorded and no task is created.</p>
        <p className={SENTENCE_CLASS}>{FILING_COPY.notPrivateText}</p>
      </div>
      {onlyRecord === undefined ? (
        records.length === 0 ? (
          <StateNotice kind="empty" title="No record is selected" description="This surface files only the records it is handed. Select at least one row in the list, then apply the tag or the favourite mark to the selection." headingLevel={NESTED_HEADING[headingLevel]} />
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
