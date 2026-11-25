"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useId, useMemo, useState, type ChangeEvent, type FormEvent, type ReactElement } from "react";
import ActionReview from "@/components/action-review";
import { CONTENT_LIFECYCLE_STATES, DraftStatus, LIFECYCLE_STATUS } from "@/components/draft-status";
import { fieldErrorsFromInvalid, FormErrorSummary, FormField, FormFieldGroup, refusalSummary, type FieldErrorLookup } from "@/components/form-field";
import RecordList, { useRecordListWindow, type RecordListColumnDef, type RecordListQueryState } from "@/components/record-list";
import StateNotice, { type NoticeHeadingLevel } from "@/components/state-notice";
import StatusBadge, { REACH_STATUS } from "@/components/status-badge";
import { Button, BUTTON_WRAP_CLASS } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SegmentedTabs, type SegmentedOption } from "@/components/ui/segmented-tabs";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import { cn } from "@/lib/cn";
import type { MutationInput, ValueState } from "@/modules/data-service/envelope";
import { lifecycleFor, rosterOf, type EditionAudience, type RosterDocument, type RosterEdition, type UpdatesRoster } from "../roster";
import { AUDIENCE_LABELS, DRAFT_VS_RELEASED, LOCALE_DISPLAY_NAMES, UPDATE_KIND_LABELS } from "../copy/updates-copy";
import { useCreateVariant } from "../hooks/use-update-mutations";
import { useUpdatesRoster, useVariantOverview, type UpdatesRosterReadResult, type VariantOverviewData } from "../hooks/use-update-queries";
import { createVariantSchema, type CreateVariantPayload } from "../schemas";
type CreateOutcome = NonNullable<ReturnType<typeof useCreateVariant>["outcome"]>;
const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_CAP = 200;
const PAGE_SIZE_OPTIONS: readonly number[] = [PAGE_SIZE_DEFAULT, PAGE_SIZE_CAP];
const FIRST_PAGE = 1;
const UPDATES_ROUTE = "/communication";
const REVIEW_ROUTE = "/communication/review";
const DEFAULT_LOCALE = "en";
/** The audience a new edition starts from, which the variant rule admits for an Update in every locale. */ const DEFAULT_AUDIENCE: EditionAudience = "public";
const NO_ORDER: RecordListQueryState["sort"] = [];
const NO_COLUMNS_HIDDEN: RecordListQueryState["columnVisibility"] = {};
const ROW_LINK_CLASS = "inline-link rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const CELL_TEXT_CLASS = "min-w-0 text-xs text-pretty text-muted-foreground wrap-anywhere";
const CELL_STACK_CLASS = "flex min-w-0 flex-col gap-1";
const IDENTIFIER_CLASS = "mono-identifier text-xs break-all";
const MUTED_PARAGRAPH_CLASS = "type-supporting text-pretty";
const SURFACE_COPY = {
  heading: "Updates",
  purpose: "Every Update this ministry's content holds, with each edition's own draft, its one review step and its own release.",
  intro: DRAFT_VS_RELEASED.draftIsNotWhatReadersSee,
  orderNote: "Editions are listed in the order the read answered with: by Update, then in each Update's own edition order. Nothing on this page re-orders, narrows or adds them together, and the count beside the rows is the whole collection the read measured rather than the page on show.",
  audienceNote: "A public edition is the one readers of this Update's public page are served. An approved-supporter edition is served only to supporters this publisher has approved. The same language can hold one of each, and the two are separate editions with separate releases.",
  outcomeNote:
    "This list states what has been written, frozen for review and released. It states nothing about who was notified, whose provider accepted a notice, what was delivered or what was read: publication, notification submission, provider acceptance, delivery and reading are separate outcomes, and none of the last four is shown here.",
  statesLead: "What the states on this page mean",
  tableLabel: "Updates and their editions",
  columnLabels: { update: "Update", audience: "Audience", language: "Language", status: "Status", review: "Review", release: "Release" },
  noTitle: "No title yet",
  rightToLeft: "Read right to left.",
  noCandidate: "No candidate in review.",
  candidateFrozen: "Candidate frozen",
  candidateRevision: "Frozen revision",
  candidateAwaitingRelease: "Awaiting release",
  awaitingRelease: "This candidate is not yet the released revision.",
  notReleased: "Not released.",
  lastRelease: "Last release",
  published: "Published",
  releasedRevision: "Released revision",
  withdrawn: "Withdrawn",
  audiencePrefix: "Audience",
  reviewPrefix: "Review",
  reachPrefix: "Reach",
  statusPrefix: "Status",
  translationUnresolved: "Its source edition cannot be read, so this translation's state is unknown rather than current.",
  translationStateUnknown: "Translation state unknown",
  addEdition: "Add an edition",
  addEditionNote: "An edition is one audience in one content language. Adding one starts it with no draft, no review and no release: nothing is published and no notice is submitted by this step.",
  unavailableTitle: "The Updates could not be read",
  unavailableBody: "The source behind this list could not be read, so no count, no title and no empty result stands in its place. Reload the page to read it again.",
  retry: "Read this list again",
  loadingTitle: "The Updates are being read",
  loadingBody: "No count, no title and no edition is stated until this page's read answers, so an answer that has not arrived is never shown as a ministry that has written nothing.",
  deniedTitle: "The Updates are not available in this session",
  deniedBody: "This session may not read the content this context's ministry holds, so no Update, edition, count or title is stated here: a refusal is not an empty list.",
  refusedTitle: "This page of Updates was refused",
  emptyTitle: "No Update yet",
  emptyBody: "An Update is one canonical piece of writing. Each of its editions serves one audience in one content language, and keeps its own draft, its one review step and its own release. This ministry's content holds none yet, so there is no Update here to add an edition to.",
  emptyAction: "How Updates are written and released",
  coverageTitle: "This list covers only part of what the content holds",
  readAt: "Read at",
  reviewCandidate: "Review this candidate",
} as const;
const CREATE_COPY = {
  title: "Add an edition",
  description: "An edition is one audience the Update's family admits, in one content locale. It starts with no draft, no review and no release.",
  updateLabel: "Update",
  updateDescription: "The Update this edition belongs to. Its identity is the document's own; the title beside it is the headline its current edition states.",
  updateWithOneOnly: "This ministry holds one Update, so this edition is added to it.",
  chooseUpdate: "Choose the Update you are adding an edition to.",
  audienceLegend: "Audience",
  audienceDescription: "A public edition and an approved-supporter edition in the same language are two editions, each with its own draft, review and release.",
  localeLabel: "Content language",
  localeDescription: "Use a content-locale tag such as en, fr or ar-EG. The direction follows the language, and it is never taken from this interface.",
  existingLegend: "Editions this Update holds now",
  existingEmpty: "This Update holds no edition yet, so this would be its first.",
  cancel: "Cancel",
  review: "Review this edition",
  reviewWaitingForRevision: "The Update's current revision has not been read yet, so this step cannot be reviewed against it.",
  reviewTitle: "Add this edition",
  confirm: "Add the edition",
  back: "Back to the details",
  readingTitle: "The Update has not been read yet",
  readingBody: "This Update's current editions and its revision are being read, so no audience can be offered and no edition can be reviewed yet.",
  deniedTitle: "This Update is not available in this session",
  unavailableTitle: "This Update could not be read",
  refusedTitle: "This request was refused",
  retry: "Try again",
  noCreateAction: "This read does not admit adding an edition to this Update.",
  noAudience: "This family admits no audience, so no edition can be added here.",
  fieldLabels: { documentId: "Update", audience: "Audience", locale: "Content language" } as Readonly<Record<string, string>>,
} as const;
type RosterRow = { readonly key: string; readonly document: RosterDocument; readonly edition: RosterEdition };
const pageSizeOf = (stated: number): number => (stated === PAGE_SIZE_CAP ? PAGE_SIZE_CAP : PAGE_SIZE_DEFAULT);
const endonymOf = (tag: string): string => LOCALE_DISPLAY_NAMES[tag] ?? tag;
function lookupOfIssues(issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[]): FieldErrorLookup {
  const byField: Record<string, string[]> = {};
  const form: string[] = [];
  for (const issue of issues) {
    const path = issue.path.map((segment) => String(segment)).join(".");
    const messages = path === "" ? form : (byField[path] ??= []);
    if (!messages.includes(issue.message)) messages.push(issue.message);
  }
  return { byField, form, count: Object.keys(byField).length + form.length };
}
const UpdateCell = ({ row }: { readonly row: RosterRow }): ReactElement => (
  <div className={CELL_STACK_CLASS}>
    <Link href={`${UPDATES_ROUTE}/${encodeURIComponent(row.document.documentId)}`} className={cn(ROW_LINK_CLASS, "flex min-w-0 flex-col gap-0.5")}>
      <span className="text-pretty break-words">{row.document.title ?? SURFACE_COPY.noTitle}</span>
      <bdi className={IDENTIFIER_CLASS}>{row.document.documentId}</bdi>
    </Link>
    <span className={CELL_TEXT_CLASS}>{UPDATE_KIND_LABELS[row.document.kind]}</span>
  </div>
);
const AudienceCell = ({ edition }: { readonly edition: RosterEdition }): ReactElement => (
  <div className={CELL_STACK_CLASS}>
    <StatusBadge label={AUDIENCE_LABELS[edition.audience].label} tone={AUDIENCE_LABELS[edition.audience].tone} srPrefix={SURFACE_COPY.audiencePrefix} />
    <span className="sr-only">{AUDIENCE_LABELS[edition.audience].whoReceives}</span>
  </div>
);
const LanguageCell = ({ edition }: { readonly edition: RosterEdition }): ReactElement => (
  <div className={CELL_STACK_CLASS}>
    {edition.localeTag === endonymOf(edition.localeTag) ? null : <bdi {...{ dir: edition.direction, className: "font-medium" }}>{endonymOf(edition.localeTag)}</bdi>}
    <bdi className={IDENTIFIER_CLASS}>{edition.localeTag}</bdi>
    {edition.direction === "rtl" ? <span className={CELL_TEXT_CLASS}>{SURFACE_COPY.rightToLeft}</span> : null}
  </div>
);
const StatusCell = ({ edition }: { readonly edition: RosterEdition }): ReactElement => (
  <div className={CELL_STACK_CLASS}>
    <DraftStatus state={edition.lifecycle} explanation={false} {...(edition.staleSince === null ? {} : { staleSince: edition.staleSince })} />
    {edition.translationStatus === "unresolved" ? <StatusBadge label={SURFACE_COPY.translationStateUnknown} tone="caution" srPrefix={SURFACE_COPY.statusPrefix} /> : null}
  </div>
);
function ReviewCell({ edition, reviewAvailable }: { readonly edition: RosterEdition; readonly reviewAvailable: boolean }): ReactElement {
  const candidateId = edition.candidateId;
  if (candidateId === null) return <span className={CELL_TEXT_CLASS}>{SURFACE_COPY.noCandidate}</span>;
  const reviewHref = reviewAvailable ? `${REVIEW_ROUTE}/${encodeURIComponent(candidateId)}` : null;
  return (
    <div className={CELL_STACK_CLASS}>
      <StatusBadge label={SURFACE_COPY.candidateFrozen} tone="info" srPrefix={SURFACE_COPY.reviewPrefix} />
      <span className={CELL_TEXT_CLASS}>
        {`${SURFACE_COPY.candidateRevision}: `}
        {reviewHref === null ? (
          <bdi className={IDENTIFIER_CLASS}>{candidateId}</bdi>
        ) : (
          <Link href={reviewHref} className={cn(ROW_LINK_CLASS, IDENTIFIER_CLASS)}>
            {candidateId}
            <span className="sr-only">{`: ${SURFACE_COPY.reviewCandidate}`}</span>
          </Link>
        )}
      </span>
      {edition.awaitingRelease ? <StatusBadge label={SURFACE_COPY.candidateAwaitingRelease} tone="info" srPrefix={SURFACE_COPY.reviewPrefix} /> : null}
    </div>
  );
}
/** The divider between two facts stated on one line: a sighted reader's dot is not a word, so assistive technology skips it and hears each fact's own label instead. */ const FACT_SEPARATOR = <span aria-hidden="true">{" · "}</span>;
/** One fact on the release line: a sighted reader reads the value, and assistive technology still hears the label it belongs to. */ const LabelledFact = ({ label, value }: { readonly label: string; readonly value: string }): ReactElement => (
  <>
    <span className="sr-only">{`${label}: `}</span>
    <bdi className={IDENTIFIER_CLASS}>{value}</bdi>
  </>
);
function ReleaseCell({ edition }: { readonly edition: RosterEdition }): ReactElement {
  const release = edition.release;
  if (release === null) {
    return (
      <div className={CELL_STACK_CLASS}>
        <span className={CELL_TEXT_CLASS}>
          {SURFACE_COPY.notReleased}
          {edition.lastReleaseAt === null ? null : (
            <>
              {" "}
              <LabelledFact label={SURFACE_COPY.lastRelease} value={edition.lastReleaseAt} />
            </>
          )}
        </span>
      </div>
    );
  }
  return (
    <div className={CELL_STACK_CLASS}>
      <StatusBadge {...REACH_STATUS[release.reach]} srPrefix={SURFACE_COPY.reachPrefix} />
      <span className={CELL_TEXT_CLASS}>
        <LabelledFact label={SURFACE_COPY.published} value={release.publishedAt} />
        {FACT_SEPARATOR}
        <LabelledFact label={SURFACE_COPY.releasedRevision} value={release.revisionId} />
        {release.withdrawnAt === null ? null : (
          <>
            {FACT_SEPARATOR}
            <LabelledFact label={SURFACE_COPY.withdrawn} value={release.withdrawnAt} />
          </>
        )}
      </span>
    </div>
  );
}
type StateNote = { readonly term: string; readonly detail: string };
/** The prose a dense row leaves out, gathered: every lifecycle state the listed editions actually hold, in the vocabulary's own order, plus the two compact badges' own sentences. */ function stateNotesOf(rows: readonly RosterRow[]): readonly StateNote[] {
  const held = new Set(rows.map((row) => row.edition.lifecycle));
  const notes: StateNote[] = CONTENT_LIFECYCLE_STATES.filter((state) => held.has(state)).map((state) => ({ term: LIFECYCLE_STATUS[state].label, detail: LIFECYCLE_STATUS[state].explanation }));
  if (rows.some((row) => row.edition.translationStatus === "unresolved")) notes.push({ term: SURFACE_COPY.translationStateUnknown, detail: SURFACE_COPY.translationUnresolved });
  if (rows.some((row) => row.edition.awaitingRelease)) notes.push({ term: SURFACE_COPY.candidateAwaitingRelease, detail: SURFACE_COPY.awaitingRelease });
  return notes;
}
/** The sentences the cells no longer carry, stated once under the table: the state word or badge label, then what it permits. */ const StateNotes = ({ notes }: { readonly notes: readonly StateNote[] }): ReactElement => (
  <div className="flex min-w-0 flex-col gap-2 rounded-2xl border border-border/80 bg-surface-subtle p-4">
    <p className="text-sm font-medium">{SURFACE_COPY.statesLead}</p>
    <dl className="flex min-w-0 flex-col gap-1.5 text-xs text-muted-foreground">
      {notes.map((note) => (
        <div key={note.term} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <dt className="font-medium text-foreground">{note.term}</dt>
          <dd className="min-w-0 text-pretty wrap-anywhere">{note.detail}</dd>
        </div>
      ))}
    </dl>
  </div>
);
const LiveEditionStatus = ({ documentId, edition }: { readonly documentId: string; readonly edition: VariantOverviewData["editions"][number] }): ReactElement => (
  <StatusBadge label={LIFECYCLE_STATUS[lifecycleFor(documentId, edition)].label} tone={LIFECYCLE_STATUS[lifecycleFor(documentId, edition)].tone} srPrefix={SURFACE_COPY.statusPrefix} />
);
const AUDIENCE_ORDER: readonly EditionAudience[] = ["public", "approved-supporter"];
function EditionReviewSummary({ document, payload }: { readonly document: RosterDocument | undefined; readonly payload: CreateVariantPayload }): ReactElement {
  const audience = AUDIENCE_LABELS[payload.audience];
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="text-muted-foreground">{`${CREATE_COPY.updateLabel}: `}</span>
        <bdi className="font-medium">{document === undefined ? payload.documentId : (document.title ?? document.documentId)}</bdi>
        {document === undefined ? null : <bdi className={IDENTIFIER_CLASS}>{document.documentId}</bdi>}
      </p>
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="text-muted-foreground">{`${CREATE_COPY.audienceLegend}: `}</span>
        <bdi>{audience.label}</bdi>
      </p>
      <p className="text-pretty text-muted-foreground">{audience.whoReceives}</p>
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="text-muted-foreground">{`${CREATE_COPY.localeLabel}: `}</span>
        <bdi>{endonymOf(payload.locale)}</bdi>
        <bdi className={IDENTIFIER_CLASS}>{payload.locale}</bdi>
      </p>
      <p className="text-pretty">It starts with no draft, no review and no release. Publishing it is a separate step, and no notice is submitted by this one.</p>
      <p className="text-pretty text-muted-foreground">{DRAFT_VS_RELEASED.draftIsNotWhatReadersSee}</p>
    </div>
  );
}
export type CreateEditionDialogProps = { /** The roster the edition is added inside: its scope is the authority every attempt states. */ readonly roster: UpdatesRoster; readonly open: boolean; readonly onOpenChange: (open: boolean) => void };
export function CreateEditionDialog({ roster, open, onOpenChange }: CreateEditionDialogProps): ReactElement {
  const router = useRouter();
  const idPrefix = useId();
  const existingLegendId = useId();
  const createReasonId = useId();
  const onlyDocumentId = roster.documents.length === 1 ? (roster.documents[0]?.documentId ?? "") : "";
  const [documentId, setDocumentId] = useState(onlyDocumentId);
  const [audience, setAudience] = useState<EditionAudience>(DEFAULT_AUDIENCE);
  const [locale, setLocale] = useState(DEFAULT_LOCALE);
  const [step, setStep] = useState<"form" | "review">("form");
  const [errors, setErrors] = useState<FieldErrorLookup | null>(null);
  const [frozen, setFrozen] = useState<Omit<MutationInput<CreateVariantPayload>, "operationId"> | null>(null);
  const overview = useVariantOverview({ scope: roster.scope, documentId });
  const create = useCreateVariant();
  const submitCreate = create.submit;
  const answered = overview.result;
  const liveEnvelope = answered !== undefined && answered.kind === "envelope" && !overview.isStale(answered) ? answered.envelope : undefined;
  const admitted = AUDIENCE_ORDER.filter((option) => liveEnvelope === undefined || liveEnvelope.data.audiences.includes(option));
  const effectiveAudience = admitted.includes(audience) ? audience : (admitted[0] ?? DEFAULT_AUDIENCE);
  const createAction = liveEnvelope === undefined ? undefined : liveEnvelope.actions.find((action) => action.name === "create-variant");
  const chosenDocument = roster.documents.find((candidate) => candidate.documentId === documentId);
  const chooseAudience = (next: string): void => {
    const chosen = admitted.find((option) => option === next);
    if (chosen === undefined) return;
    setAudience(chosen);
    setErrors(null);
  };
  const reset = useCallback((): void => {
    setDocumentId(onlyDocumentId);
    setAudience(DEFAULT_AUDIENCE);
    setLocale(DEFAULT_LOCALE);
    setStep("form");
    setErrors(null);
    setFrozen(null);
  }, [onlyDocumentId]);
  const handleOpenChange = useCallback(
    (next: boolean): void => {
      if (!next) reset();
      onOpenChange(next);
    },
    [onOpenChange, reset],
  );
  const submit = useCallback((input: MutationInput<CreateVariantPayload>): Promise<CreateOutcome> => submitCreate({ scope: input.scope, expectedRevision: input.expectedRevision, payload: input.payload }), [submitCreate]);
  const handleSettled = useCallback(
    (outcome: CreateOutcome): void => {
      if (outcome.outcome === "invalid") {
        setErrors(fieldErrorsFromInvalid(outcome));
        setStep("form");
        return;
      }
      setErrors(null);
      if (outcome.outcome !== "accepted" && outcome.outcome !== "alreadyAccepted") return;
      handleOpenChange(false);
      if (frozen !== null && frozen.payload.documentId !== "") router.push(`${UPDATES_ROUTE}/${encodeURIComponent(frozen.payload.documentId)}`);
    },
    [frozen, handleOpenChange, router],
  );
  const reviewTheEdition = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (liveEnvelope === undefined) {
      setErrors({ byField: {}, form: [CREATE_COPY.reviewWaitingForRevision], count: 1 });
      return;
    }
    const checked = createVariantSchema.safeParse({ documentId, audience: effectiveAudience, locale: locale.trim() });
    if (!checked.success) {
      setErrors(lookupOfIssues(checked.error.issues));
      return;
    }
    setErrors(null);
    setFrozen({ scope: liveEnvelope.scope, expectedRevision: liveEnvelope.revision, payload: checked.data });
    setStep("review");
  };
  const documentChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    setDocumentId(event.currentTarget.value);
    setErrors(null);
  };
  const documentField =
    roster.documents.length > 1 ? (
      <FormField name="documentId" label={CREATE_COPY.updateLabel} description={CREATE_COPY.updateDescription} error={errors?.byField["documentId"]} required>
        {(control) => (
          <NativeSelect {...{ id: control.id, name: "documentId", className: "w-full", value: documentId, required: control.required, "aria-invalid": control.invalid || undefined, "aria-describedby": control.describedBy, onChange: documentChange }}>
            <NativeSelectOption value="">{CREATE_COPY.chooseUpdate}</NativeSelectOption>
            {roster.documents.map((document) => (
              <NativeSelectOption key={document.documentId} value={document.documentId}>
                {document.title ?? document.documentId}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
    ) : (
      <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-muted/40 p-3">
        <p className="text-sm font-medium text-pretty break-words">{chosenDocument === undefined ? "" : (chosenDocument.title ?? SURFACE_COPY.noTitle)}</p>
        <bdi className={IDENTIFIER_CLASS}>{chosenDocument === undefined ? "" : chosenDocument.documentId}</bdi>
        <p className={CELL_TEXT_CLASS}>{CREATE_COPY.updateWithOneOnly}</p>
      </div>
    );
  let readSection: ReactElement;
  if (documentId === "") {
    readSection = <p className={MUTED_PARAGRAPH_CLASS}>{CREATE_COPY.chooseUpdate}</p>;
  } else if (answered !== undefined && answered.kind === "denied") {
    readSection = <StateNotice kind="denied" headingLevel={3} title={CREATE_COPY.deniedTitle} reasonCode={answered.denied.reasonCode} />;
  } else if (answered !== undefined && answered.kind === "unavailable") {
    readSection = <StateNotice kind="unavailable" headingLevel={3} title={CREATE_COPY.unavailableTitle} description={answered.unavailable.guidance} source={answered.unavailable.source} retry={{ label: CREATE_COPY.retry, onClick: () => overview.refetch() }} />;
  } else if (answered !== undefined && answered.kind === "refused") {
    readSection = <StateNotice kind="refused" headingLevel={3} title={CREATE_COPY.refusedTitle} description={refusalSummary(answered.refused)} />;
  } else if (liveEnvelope === undefined) {
    readSection = <StateNotice kind="loading" headingLevel={3} title={CREATE_COPY.readingTitle} description={CREATE_COPY.readingBody} loadingLines={3} />;
  } else {
    readSection = (
      <>
        {admitted.length === 0 ? (
          <p className={MUTED_PARAGRAPH_CLASS}>{CREATE_COPY.noAudience}</p>
        ) : (
          <FormFieldGroup legend={CREATE_COPY.audienceLegend} name="audience" description={CREATE_COPY.audienceDescription} error={errors?.byField["audience"]} required>
            {({ describedBy, legendId }) => (
              <RadioGroup value={effectiveAudience} onValueChange={chooseAudience} aria-labelledby={legendId} aria-describedby={describedBy}>
                {admitted.map((option) => {
                  const optionId = `${idPrefix}-audience-${option}`;
                  const descriptionId = `${optionId}-description`;
                  const wording = AUDIENCE_LABELS[option];
                  return (
                    <Label key={option} htmlFor={optionId} className="min-h-target items-start gap-3 py-1">
                      <RadioGroupItem id={optionId} value={option} aria-label={wording.label} aria-describedby={descriptionId} className="mt-0.5" />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-sm font-medium">{wording.label}</span>
                        <span {...{ id: descriptionId, className: "text-sm font-normal text-pretty text-muted-foreground" }}>{wording.whoReceives}</span>
                      </span>
                    </Label>
                  );
                })}
              </RadioGroup>
            )}
          </FormFieldGroup>
        )}
        <FormField name="locale" label={CREATE_COPY.localeLabel} description={CREATE_COPY.localeDescription} error={errors?.byField["locale"]} required>
          {(control) => <Input id={control.id} name="locale" type="text" dir="ltr" autoComplete="off" spellCheck={false} value={locale} required={control.required} aria-invalid={control.invalid || undefined} aria-describedby={control.describedBy} onChange={(event) => setLocale(event.currentTarget.value)} />}
        </FormField>
        <section aria-labelledby={existingLegendId} className="flex min-w-0 flex-col gap-2">
          <p {...{ id: existingLegendId, className: "text-sm font-medium" }}>{CREATE_COPY.existingLegend}</p>
          {liveEnvelope.data.editions.length === 0 ? (
            <p className={MUTED_PARAGRAPH_CLASS}>{CREATE_COPY.existingEmpty}</p>
          ) : (
            <ul className="flex min-w-0 flex-col gap-2">
              {liveEnvelope.data.editions.map((edition) => (
                <li key={edition.variantId} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <bdi {...{ dir: edition.locale.direction, className: "text-sm font-medium" }}>{endonymOf(edition.locale.tag)}</bdi>
                  <bdi className={IDENTIFIER_CLASS}>{edition.locale.tag}</bdi>
                  <LiveEditionStatus documentId={documentId} edition={edition} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </>
    );
  }
  const createReason = createAction !== undefined && createAction.available ? null : (createAction?.reason?.trim() ?? CREATE_COPY.noCreateAction);
  let body: ReactElement;
  if (step === "review" && frozen !== null) {
    body = (
      <ActionReview<CreateVariantPayload>
        title={CREATE_COPY.reviewTitle}
        description={<EditionReviewSummary document={chosenDocument} payload={frozen.payload} />}
        confirmLabel={CREATE_COPY.confirm}
        cancelLabel={CREATE_COPY.back}
        onCancel={() => setStep("form")}
        input={frozen}
        submit={submit}
        onSettled={handleSettled}
        fieldLabels={CREATE_COPY.fieldLabels}
        headingLevel={3}
      />
    );
  } else {
    body = (
      <form noValidate className="flex min-w-0 flex-col gap-4" onSubmit={reviewTheEdition}>
        <FormErrorSummary errors={errors} labels={CREATE_COPY.fieldLabels} order={["documentId", "audience", "locale"]} headingLevel={3} />
        {documentField}
        {readSection}
        {createReason === null ? null : <p {...{ id: createReasonId, className: MUTED_PARAGRAPH_CLASS }}>{createReason}</p>}
        <DialogFooter>
          <Button {...{ type: "button", variant: "outline", onClick: () => handleOpenChange(false) }}>{CREATE_COPY.cancel}</Button>
          <Button {...{ type: "submit", disabled: liveEnvelope === undefined || createReason !== null, "aria-describedby": createReason === null ? undefined : createReasonId }}>{CREATE_COPY.review}</Button>
        </DialogFooter>
      </form>
    );
  }
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{CREATE_COPY.title}</DialogTitle>
          <DialogDescription>{CREATE_COPY.description}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
export type UpdatesListProps = {
  /** The listing read, made plain by {@link rosterOf} on the server that read it. */ readonly roster: UpdatesRoster;
  /** The listing read's own answer, so the first page paints from the envelope the request already read instead of asking the same question again. */ readonly initialResult?: UpdatesRosterReadResult;
  /** The level this surface's own heading occupies, so a page that already states an `h1` keeps one. */ readonly headingLevel?: 1 | 2;
  readonly className?: string;
};
type UpdatesViewMode = "table" | "cards";
const UPDATES_VIEW_OPTIONS: readonly SegmentedOption<UpdatesViewMode>[] = [
  { value: "table", label: "Table view" },
  { value: "cards", label: "Cards view" },
];
/** The one type scale's heading utility for each level this surface may take, so its own heading measures the same as every other heading at that level. */ const HEADING_SCALE: Readonly<Record<1 | 2, string>> = { 1: "type-page-title", 2: "type-section-title" };
export default function UpdatesList({ roster, initialResult, headingLevel = 2, className }: UpdatesListProps): ReactElement {
  const headingId = useId();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [viewMode, setViewMode] = useState<UpdatesViewMode>("table");
  // The window the route's read answered with is the window this surface opens on, so the first paint states the rows that answer holds and asks the read for nothing it has not already been asked. The address owns the window from then on, so a reader who opens an Update, reloads or returns reopens the page they left.
  const seededWindow = initialResult !== undefined && initialResult.kind === "envelope" ? initialResult.envelope.data.page : undefined;
  const listWindow = useRecordListWindow({ page: seededWindow?.page ?? FIRST_PAGE, pageSize: pageSizeOf(seededWindow?.pageSize ?? PAGE_SIZE_DEFAULT) });
  const page = listWindow.page;
  const pageSize = pageSizeOf(listWindow.pageSize);
  const setWindow = listWindow.setWindow;
  const [columnVisibility, setColumnVisibility] = useState<RecordListQueryState["columnVisibility"]>(NO_COLUMNS_HIDDEN); // The columns a worker shows are presentation and stay in this component: hiding a column changes what is shown of a row and never which records the read answered with.
  const handleQueryStateChange = useCallback(
    (next: RecordListQueryState): void => {
      setColumnVisibility(next.columnVisibility);
      setWindow({ page: Math.max(FIRST_PAGE, Math.trunc(next.page)), pageSize: pageSizeOf(next.pageSize) });
    },
    [setWindow],
  );
  // The envelope seeds only the window it was read for: seeding it under another page's key, with `refetchOnMount` off, would answer the page the reader asked for with the first page and issue no request at all.
  const seeded = useMemo<UpdatesRosterReadResult | undefined>(() => (initialResult === undefined || initialResult.kind !== "envelope" ? undefined : initialResult.envelope.data.page.page === page && initialResult.envelope.data.page.pageSize === pageSize ? initialResult : undefined), [initialResult, page, pageSize]);
  const read = useUpdatesRoster({ scope: roster.scope, page, pageSize }, seeded === undefined ? {} : { initialData: seeded });
  const result = read.result;
  const answer = result === undefined || read.isStale(result) ? undefined : result; // A result read under a context this session no longer shows is never presented as the current one, so it is dropped here rather than rendered with the previous context's authority behind it.
  const answeredRoster = useMemo(() => (answer !== undefined && answer.kind === "envelope" ? rosterOf(answer.envelope) : undefined), [answer]); // The answer on show, mapped once per answer: the read's own page, its own totals and its own words, never a second derivation rebuilt on every render.
  const current = answeredRoster ?? roster;
  const rows = useMemo(() => ((roster: UpdatesRoster): readonly RosterRow[] => roster.documents.flatMap((document) => document.editions.map((edition) => ({ key: `${document.documentId}:${edition.variantId}`, document, edition }))))(current), [current]);
  const reviewAvailable = current.actions.some((action) => action.name === "review-candidate" && action.available);
  const stateNotes = stateNotesOf(rows); // The states the rows on show actually hold, so the notes under the table explain what a reader can see and nothing they cannot.
  const columns = useMemo<ReadonlyArray<RecordListColumnDef<RosterRow>>>(
    () => [
      { id: "update", header: SURFACE_COPY.columnLabels.update, enableSorting: false, enableHiding: false, cell: (context) => <UpdateCell row={context.row.original} /> },
      { id: "audience", header: SURFACE_COPY.columnLabels.audience, enableSorting: false, cell: (context) => <AudienceCell edition={context.row.original.edition} /> },
      { id: "language", header: SURFACE_COPY.columnLabels.language, enableSorting: false, cell: (context) => <LanguageCell edition={context.row.original.edition} /> },
      { id: "status", header: SURFACE_COPY.columnLabels.status, enableSorting: false, cell: (context) => <StatusCell edition={context.row.original.edition} /> },
      { id: "review", header: SURFACE_COPY.columnLabels.review, enableSorting: false, cell: (context) => <ReviewCell edition={context.row.original.edition} reviewAvailable={reviewAvailable} /> },
      { id: "release", header: SURFACE_COPY.columnLabels.release, enableSorting: false, cell: (context) => <ReleaseCell edition={context.row.original.edition} /> },
    ],
    [reviewAvailable],
  );
  const documentsState: ValueState = current.valueStates["documents"] ?? "value";
  const noticeLevel: NoticeHeadingLevel = headingLevel === 1 ? 2 : 3;
  const offersCreate = answeredRoster !== undefined && answeredRoster.documents.length > 0;
  const HeadingTag = ({ 1: "h1", 2: "h2" } as const)[headingLevel];
  let content: ReactElement;
  if (answer === undefined) {
    // No answer describes the context this surface now shows — one is in flight, or the held one belonged to a context the session has left — so nothing is counted and no empty result is implied.
    content = <StateNotice kind="loading" headingLevel={noticeLevel} title={SURFACE_COPY.loadingTitle} description={SURFACE_COPY.loadingBody} loadingLines={6} />;
  } else if (answer.kind === "denied") {
    content = <StateNotice kind="denied" headingLevel={noticeLevel} title={SURFACE_COPY.deniedTitle} description={SURFACE_COPY.deniedBody} reasonCode={answer.denied.reasonCode} />; // A denial states no count, no title and no existence, so the answer is the same whether or not this ministry holds an Update.
  } else if (answer.kind === "unavailable") {
    // An outage is never an empty list: the roster would otherwise claim that nothing has been written.
    content = <StateNotice kind="unavailable" headingLevel={noticeLevel} title={SURFACE_COPY.unavailableTitle} description={answer.unavailable.guidance} source={answer.unavailable.source} retry={{ label: SURFACE_COPY.retry, onClick: read.refetch }} />;
  } else if (answer.kind === "refused") {
    content = <StateNotice kind="refused" headingLevel={noticeLevel} title={SURFACE_COPY.refusedTitle} description={refusalSummary(answer.refused)} />; // This page asked the read for a request it does not admit, so the field to correct is stated rather than the answer being reported as an outage or a denial.
  } else if (documentsState === "unavailable" || documentsState === "unknown" || documentsState === "withheld") {
    // A value state that is not a number replaces every figure: an unreadable or withheld collection is never an empty list and never a zero.
    content = <StateNotice kind="unavailable" headingLevel={noticeLevel} title={SURFACE_COPY.unavailableTitle} description={SURFACE_COPY.unavailableBody} source={current.source} />;
  } else if (documentsState === "zero") {
    // An empty collection offers a real destination rather than a control that could only fail. A page of a collection that holds documents is never this state, so a window is never reported as an empty ministry.
    content = <StateNotice kind="empty" headingLevel={noticeLevel} title={SURFACE_COPY.emptyTitle} description={SURFACE_COPY.emptyBody} action={{ label: SURFACE_COPY.emptyAction, href: "/help" }} />;
  } else {
    const queryState: RecordListQueryState = { sort: NO_ORDER, page: current.page.page, pageSize: current.page.pageSize, columnVisibility };
    content = (
      <>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SegmentedTabs label="Updates display layout" value={viewMode} onValueChange={setViewMode} options={UPDATES_VIEW_OPTIONS} />
        </div>
        {viewMode === "cards" && rows.length > 0 ? (
          <ul data-slot="updates-cards-grid" aria-label={SURFACE_COPY.tableLabel} className="grid min-w-0 gap-3.5 sm:grid-cols-2">
            {rows.map((row) => (
              <li key={row.key} className="min-w-0">
                <SpotlightCard className="h-full rounded-2xl">
                  <div className="flex h-full min-w-0 flex-col justify-between gap-3 rounded-2xl border border-border/80 bg-card p-4 shadow-xs">
                    <div className="flex min-w-0 flex-col gap-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <AudienceCell edition={row.edition} />
                        <LanguageCell edition={row.edition} />
                      </div>
                      <UpdateCell row={row} />
                      <StatusCell edition={row.edition} />
                    </div>
                    <div className="flex flex-col gap-2 border-t border-border/70 pt-2.5">
                      <ReviewCell edition={row.edition} reviewAvailable={reviewAvailable} />
                      <ReleaseCell edition={row.edition} />
                    </div>
                  </div>
                </SpotlightCard>
              </li>
            ))}
          </ul>
        ) : (
          <RecordList<RosterRow>
            label={SURFACE_COPY.tableLabel}
            columns={columns}
            rows={rows}
            rowCount={current.page.total}
            queryState={queryState}
            onQueryStateChange={handleQueryStateChange}
            getRowId={(row) => row.key}
            rowLabel={(row) => `${row.document.title ?? row.document.documentId} (${row.edition.localeTag})`}
            initialPinnedColumns={{ start: ["update"] }}
            renderExpandedRow={(row) => (
              <div className="grid gap-3 text-xs sm:grid-cols-3">
                <div className="flex flex-col gap-1">
                  <span className="font-medium text-muted-foreground">Document &amp; variant</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <bdi className={IDENTIFIER_CLASS}>{row.document.documentId}</bdi>
                    <CopyButton value={row.document.documentId} label={`Copy document ID ${row.document.documentId}`} className="h-6 min-h-6 px-2 text-xs" />
                  </div>
                  <span className="text-muted-foreground">
                    Variant <bdi className={IDENTIFIER_CLASS}>{row.edition.variantId}</bdi>
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="font-medium text-muted-foreground">Audience scope</span>
                  <span className="text-pretty text-foreground">{AUDIENCE_LABELS[row.edition.audience].whoReceives}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="font-medium text-muted-foreground">Language &amp; direction</span>
                  <span className="text-foreground">
                    <bdi dir={row.edition.direction}>{endonymOf(row.edition.localeTag)}</bdi> ({row.edition.localeTag}, {row.edition.direction.toUpperCase()})
                  </span>
                </div>
              </div>
            )}
            itemNoun="editions"
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            isLoading={read.isFetching}
          />
        )}
        {stateNotes.length === 0 ? null : <StateNotes notes={stateNotes} />}
      </>
    );
  }
  return (
    <section data-slot="updates-list" aria-labelledby={headingId} className={cn("flex min-w-0 flex-col gap-6 text-start", className)}>
      <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border/80 bg-surface-subtle p-4 shadow-xs sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <HeadingTag {...{ id: headingId, className: cn(HEADING_SCALE[headingLevel], "text-pretty break-words") }}>{SURFACE_COPY.heading}</HeadingTag>
          <p className={MUTED_PARAGRAPH_CLASS}>{SURFACE_COPY.purpose}</p>
          <p className={MUTED_PARAGRAPH_CLASS}>{SURFACE_COPY.intro}</p>
        </div>
        <div className="flex min-w-0 flex-col items-start gap-1">
          {offersCreate ? <Button {...{ type: "button", className: BUTTON_WRAP_CLASS, onClick: () => setDialogOpen(true) }}>{SURFACE_COPY.addEdition}</Button> : null}
          {offersCreate ? <p className="max-w-prose text-xs text-pretty text-muted-foreground">{SURFACE_COPY.addEditionNote}</p> : null}
        </div>
      </div>
      <p className={MUTED_PARAGRAPH_CLASS}>{SURFACE_COPY.orderNote}</p>
      {content}
      {/* Coverage and the read instant travel with the envelope, so a list read before a change says so instead of presenting itself as current. */}
      {answeredRoster === undefined || answeredRoster.coverage.state === "complete" ? null : <StateNotice kind="partial-coverage" headingLevel={noticeLevel} title={SURFACE_COPY.coverageTitle} coverage={answeredRoster.coverage} />}
      {answeredRoster === undefined ? null : (
        <p className={CELL_TEXT_CLASS}>
          {`${SURFACE_COPY.readAt}: `}
          <bdi className={IDENTIFIER_CLASS}>{answeredRoster.asOf}</bdi>
        </p>
      )}
      <p className={MUTED_PARAGRAPH_CLASS}>{SURFACE_COPY.audienceNote}</p>
      <p className={MUTED_PARAGRAPH_CLASS}>{SURFACE_COPY.outcomeNote}</p>
      {offersCreate ? <CreateEditionDialog roster={current} open={dialogOpen} onOpenChange={setDialogOpen} /> : null}
    </section>
  );
}
