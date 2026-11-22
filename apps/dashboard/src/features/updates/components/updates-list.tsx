"use client";
/**
 * The Ministry Updates roster: every Update this ministry's content holds, with each edition's own
 * draft, its one review step and its own release, and the one real first action — adding an edition
 * to an Update that already exists.
 *
 * What this file owns: the plain view of the listing read, so a Temporal-bearing envelope never crosses
 * into a client component; the columns and their state words; and the reviewed create step. What it does
 * not own: the read and the write transports (`../hooks`), the words of a lifecycle state
 * (`@/components/draft-status`), the audience and reach vocabularies (`../copy`, `@/components/status-badge`),
 * the attempt's identity and its receipt (`@/components/action-review`), or any count, order or page
 * position the service decided. The read returns the whole authorised collection in one answer and takes
 * no search, order or page, so this surface windows it locally and never narrows or re-orders it.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useId, useMemo, useState, type FormEvent, type ReactElement } from "react";
import ActionReview from "@/components/action-review";
import { DraftStatus, LIFECYCLE_STATUS } from "@/components/draft-status";
import { fieldErrorsFromInvalid, FormErrorSummary, FormField, FormFieldGroup, refusalSummary, type FieldErrorLookup } from "@/components/form-field";
import RecordList, { type RecordListColumnDef, type RecordListQueryState } from "@/components/record-list";
import StateNotice, { type NoticeHeadingLevel } from "@/components/state-notice";
import StatusBadge, { REACH_STATUS } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/cn";
import type { MutationInput, ValueState } from "@/modules/data-service/envelope";
import { lifecycleFor, type EditionAudience, type RosterDocument, type RosterEdition, type UpdatesRoster } from "../roster";
import { AUDIENCE_LABELS, DRAFT_VS_RELEASED, LOCALE_DISPLAY_NAMES, UPDATE_KIND_LABELS } from "../copy/updates-copy";
import { useCreateVariant } from "../hooks/use-update-mutations";
import { useVariantOverview, type VariantOverviewData } from "../hooks/use-update-queries";
import { createVariantSchema, type CreateVariantPayload } from "../schemas/draft";

// ---------------------------------------------------------------------------------------------
// The roster this surface renders
// ---------------------------------------------------------------------------------------------
//
// The view and its mapping live in `../roster`, which is not a client module: the Server Component that
// reads the listing converts it there, because the service states release instants as `Temporal.Instant`
// and a class instance cannot cross into a client component. This file renders that view and nothing else.

// ---------------------------------------------------------------------------------------------
// The create step's own shapes, taken from the hook and the schema that own them
// ---------------------------------------------------------------------------------------------

/** What one answered create attempt produced, derived from the hook that owns the eight outcomes. */
type CreateOutcome = NonNullable<ReturnType<typeof useCreateVariant>["outcome"]>;

/** The reviewed input of one create attempt: everything a mutation states except the identity the review step mints. */
type CreateInput = Omit<MutationInput<CreateVariantPayload>, "operationId">;

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** The list sizes this surface offers: the application's 50-row default and its 200-row cap. */
const PAGE_SIZE_DEFAULT = 50;

const PAGE_SIZE_CAP = 200;

const PAGE_SIZE_OPTIONS: readonly number[] = [PAGE_SIZE_DEFAULT, PAGE_SIZE_CAP];

const FIRST_PAGE = 1;

/** The noun every count on this surface is stated in. */
const ITEM_NOUN = "editions";

/** Where one Update's own record lives, and where a created edition's Update is opened. */
const UPDATES_ROUTE = "/communication";

/** Where one frozen candidate's single review step lives. */
const REVIEW_ROUTE = "/communication/review";

/** The one action a variant matrix publishes for adding an edition, named as the read names it. */
const CREATE_VARIANT_ACTION = "create-variant";

/** The action a listing read publishes when a frozen candidate may be reviewed, named as the read names it. */
const REVIEW_CANDIDATE_ACTION = "review-candidate";

/** Where the Help destination that explains this workflow lives. */
const HELP_HREF = "/help";

/** The content-locale tag a new edition starts from: the language the seeded and admitted editions are written in. */
const DEFAULT_LOCALE = "en";

/** The audience a new edition starts from, which the variant rule admits for an Update in every locale. */
const DEFAULT_AUDIENCE: EditionAudience = "public";

/** The value state the listing read records for its own collection, and the state that means it holds none. */
const DOCUMENTS_MEMBER = "documents";

const NO_ORDER: RecordListQueryState["sort"] = [];

const NO_COLUMNS_HIDDEN: RecordListQueryState["columnVisibility"] = {};

const ROW_LINK_CLASS = "rounded-sm font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

const CELL_TEXT_CLASS = "min-w-0 text-xs text-pretty text-muted-foreground wrap-anywhere";

const CELL_STACK_CLASS = "flex min-w-0 flex-col gap-1";

const IDENTIFIER_CLASS = "mono-identifier text-xs break-all";

const MUTED_PARAGRAPH_CLASS = "text-sm text-pretty text-muted-foreground";

// ---------------------------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------------------------

const SURFACE_COPY = {
  heading: "Updates",
  purpose: "Every Update this ministry's content holds, with each edition's own draft, its one review step and its own release.",
  intro: DRAFT_VS_RELEASED.draftIsNotWhatReadersSee,
  orderNote: "Editions are listed in the order the read answered with: by Update, then in each Update's own edition order. Nothing on this page re-orders, narrows or adds them together, and the count beside the rows is the whole collection this read returned rather than the page on show.",
  audienceNote: "A public edition is the one readers of this Update's public page are served. An approved-supporter edition is served only to supporters this publisher has approved. The same language can hold one of each, and the two are separate editions with separate releases.",
  outcomeNote: "This list states what has been written, frozen for review and released. It states nothing about who was notified, whose provider accepted a notice, what was delivered or what was read: publication, notification submission, provider acceptance, delivery and reading are separate outcomes, and none of the last four is shown here.",
  tableLabel: "Updates and their editions",
  columnLabels: { update: "Update", audience: "Audience", language: "Language", status: "Status", review: "Review", release: "Release" },
  noTitle: "No title yet",
  rightToLeft: "Read right to left.",
  noCandidate: "No candidate in review.",
  candidateFrozen: "Candidate frozen",
  candidateRevision: "Frozen revision",
  awaitingRelease: "No release head yet.",
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
  addEdition: "Add an edition",
  addEditionNote: "An edition is one audience in one content language. Adding one starts it with no draft, no review and no release: nothing is published and no notice is submitted by this step.",
  unavailableTitle: "The Updates could not be read",
  unavailableBody: "The source behind this list could not be read, so no count, no title and no empty result stands in its place. Reload the page to read it again.",
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

// ---------------------------------------------------------------------------------------------
// One row: an edition with the Update it belongs to
// ---------------------------------------------------------------------------------------------

/** One edition of one Update, as the table presents it. The grain is the edition, because each edition owns its draft, its candidate and its release. */
type RosterRow = { readonly key: string; readonly document: RosterDocument; readonly edition: RosterEdition };

function rowsOf(roster: UpdatesRoster): readonly RosterRow[] {
  const rows: RosterRow[] = [];
  for (const document of roster.documents) {
    for (const edition of document.editions) {
      rows.push({ key: `${document.documentId}:${edition.variantId}`, document, edition });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------------------------

/**
 * A page window over the records a read already authorised and ordered.
 *
 * The listing read answers with the whole collection and takes no page of its own, so this widens or
 * narrows what is shown without changing the total the pager states: that total is the number of rows the
 * read returned, never a number this surface invented.
 */
function windowOf<T>(items: readonly T[], page: number, pageSize: number): { readonly items: readonly T[]; readonly page: number } {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Number.isFinite(page) ? Math.min(Math.max(FIRST_PAGE, Math.trunc(page)), pageCount) : FIRST_PAGE;
  const firstIndex = (current - FIRST_PAGE) * pageSize;
  return { items: items.slice(firstIndex, firstIndex + pageSize), page: current };
}

/** The two row sizes this surface offers: a stated size outside them is read as the default rather than sent to a pager that would clamp it silently. */
function pageSizeOf(stated: number): number {
  return stated === PAGE_SIZE_CAP ? PAGE_SIZE_CAP : PAGE_SIZE_DEFAULT;
}

/** The endonym of a content locale, or the tag itself when this build states no display name for it. */
function endonymOf(tag: string): string {
  const name = LOCALE_DISPLAY_NAMES[tag];
  return name === undefined ? tag : name;
}

/** The per-field messages a schema refusal produced, keyed as a field's `error` prop expects them, so the form states them without a round trip. */
function lookupOfIssues(issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[]): FieldErrorLookup {
  const byField: Record<string, string[]> = {};
  const form: string[] = [];
  for (const issue of issues) {
    const path = issue.path.map((segment) => String(segment)).join(".");
    if (path === "") {
      if (!form.includes(issue.message)) form.push(issue.message);
      continue;
    }
    const messages = byField[path];
    if (messages === undefined) {
      byField[path] = [issue.message];
      continue;
    }
    if (!messages.includes(issue.message)) messages.push(issue.message);
  }
  return { byField, form, count: Object.keys(byField).length + form.length };
}

// ---------------------------------------------------------------------------------------------
// The cells, one per column
// ---------------------------------------------------------------------------------------------

/** The Update a row belongs to: its headline, its canonical identity and its kind, linked to the Update's own record. */
function UpdateCell({ row }: { readonly row: RosterRow }): ReactElement {
  const { document } = row;
  return (
    <div className={CELL_STACK_CLASS}>
      <Link href={`${UPDATES_ROUTE}/${encodeURIComponent(document.documentId)}`} className={cn(ROW_LINK_CLASS, "flex min-w-0 flex-col gap-0.5")}>
        <span className="text-pretty break-words">{document.title ?? SURFACE_COPY.noTitle}</span>
        <bdi className={IDENTIFIER_CLASS}>{document.documentId}</bdi>
      </Link>
      <span className={CELL_TEXT_CLASS}>{UPDATE_KIND_LABELS[document.kind]}</span>
    </div>
  );
}

/** Which audience this edition serves, said in words as well as in a word-and-tone label, so the state is never carried by colour alone. */
function AudienceCell({ edition }: { readonly edition: RosterEdition }): ReactElement {
  const wording = AUDIENCE_LABELS[edition.audience];
  return (
    <div className={CELL_STACK_CLASS}>
      <StatusBadge label={wording.label} tone={edition.audience === "public" ? "info" : "neutral"} srPrefix={SURFACE_COPY.audiencePrefix} />
      <span className="sr-only">{wording.whoReceives}</span>
    </div>
  );
}

/** The exact content locale this edition is written in: its endonym in its own direction, and the tag the read states. */
function LanguageCell({ edition }: { readonly edition: RosterEdition }): ReactElement {
  return (
    <div className={CELL_STACK_CLASS}>
      {edition.localeTag === endonymOf(edition.localeTag) ? null : (
        <bdi dir={edition.direction} className="font-medium">
          {endonymOf(edition.localeTag)}
        </bdi>
      )}
      <bdi className={IDENTIFIER_CLASS}>{edition.localeTag}</bdi>
      {edition.direction === "rtl" ? <span className={CELL_TEXT_CLASS}>{SURFACE_COPY.rightToLeft}</span> : null}
    </div>
  );
}

/** The one lifecycle indicator, with the sentence that says what the state permits. */
function StatusCell({ edition }: { readonly edition: RosterEdition }): ReactElement {
  return (
    <div className={CELL_STACK_CLASS}>
      <DraftStatus state={edition.lifecycle} {...(edition.staleSince === null ? {} : { staleSince: edition.staleSince })} />
      {edition.translationStatus === "unresolved" ? <span className={CELL_TEXT_CLASS}>{SURFACE_COPY.translationUnresolved}</span> : null}
    </div>
  );
}

/** The frozen candidate awaiting its one review step, with the exact revision identity it froze, linked to that review when the read admits reviewing. */
function ReviewCell({ edition, reviewHref }: { readonly edition: RosterEdition; readonly reviewHref: string | null }): ReactElement {
  if (edition.candidateId === null) {
    return <span className={CELL_TEXT_CLASS}>{SURFACE_COPY.noCandidate}</span>;
  }
  return (
    <div className={CELL_STACK_CLASS}>
      <StatusBadge label={SURFACE_COPY.candidateFrozen} tone="info" srPrefix={SURFACE_COPY.reviewPrefix} />
      <span className={CELL_TEXT_CLASS}>
        {`${SURFACE_COPY.candidateRevision}: `}
        {reviewHref === null ? (
          <bdi className={IDENTIFIER_CLASS}>{edition.candidateId}</bdi>
        ) : (
          <Link href={reviewHref} className={cn(ROW_LINK_CLASS, IDENTIFIER_CLASS)}>
            {edition.candidateId}
            <span className="sr-only">{`: ${SURFACE_COPY.reviewCandidate}`}</span>
          </Link>
        )}
      </span>
      {edition.awaitingRelease ? <span className={CELL_TEXT_CLASS}>{SURFACE_COPY.awaitingRelease}</span> : null}
    </div>
  );
}

/** The release standing at this edition's head, or the plain fact that there is none — which is not the same as a withdrawn release. */
function ReleaseCell({ edition }: { readonly edition: RosterEdition }): ReactElement {
  const release = edition.release;
  if (release === null) {
    return (
      <div className={CELL_STACK_CLASS}>
        <span className={CELL_TEXT_CLASS}>{SURFACE_COPY.notReleased}</span>
        {edition.lastReleaseAt === null ? null : (
          <span className={CELL_TEXT_CLASS}>
            {`${SURFACE_COPY.lastRelease}: `}
            <bdi className={IDENTIFIER_CLASS}>{edition.lastReleaseAt}</bdi>
          </span>
        )}
      </div>
    );
  }
  return (
    <div className={CELL_STACK_CLASS}>
      <StatusBadge {...REACH_STATUS[release.reach]} srPrefix={SURFACE_COPY.reachPrefix} />
      <span className={CELL_TEXT_CLASS}>
        {`${SURFACE_COPY.published}: `}
        <bdi className={IDENTIFIER_CLASS}>{release.publishedAt}</bdi>
      </span>
      <span className={CELL_TEXT_CLASS}>
        {`${SURFACE_COPY.releasedRevision}: `}
        <bdi className={IDENTIFIER_CLASS}>{release.revisionId}</bdi>
      </span>
      {release.withdrawnAt === null ? null : (
        <span className={CELL_TEXT_CLASS}>
          {`${SURFACE_COPY.withdrawn}: `}
          <bdi className={IDENTIFIER_CLASS}>{release.withdrawnAt}</bdi>
        </span>
      )}
    </div>
  );
}

/** The lifecycle word one edition of a live variant matrix holds, derived by the same evaluator the roster uses. */
function LiveEditionStatus({ documentId, edition }: { readonly documentId: string; readonly edition: VariantOverviewData["editions"][number] }): ReactElement {
  const spec = LIFECYCLE_STATUS[lifecycleFor(documentId, edition)];
  return <StatusBadge label={spec.label} tone={spec.tone} srPrefix={SURFACE_COPY.statusPrefix} />;
}


// ---------------------------------------------------------------------------------------------
// The reviewed create step: one edition added to one Update
// ---------------------------------------------------------------------------------------------

/** The audiences a create may offer, in the order this surface lists them, filtered by what the Update's family admits. */
const AUDIENCE_ORDER: readonly EditionAudience[] = ["public", "approved-supporter"];

/** What the review step states about the edition it is about to add. */
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

/** Props of {@link CreateEditionDialog}. */
export interface CreateEditionDialogProps {
  /** The roster the edition is added inside: its scope is the authority every attempt states. */
  readonly roster: UpdatesRoster;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * The create step: which Update, which audience, which content language, then the reviewed attempt and its receipt.
 *
 * The form's three facts are held here because they are three controls and no more. Everything that decides
 * what may be added is read from the service: the family-permitted audiences and the revision the write must
 * present come from `useVariantOverview`, the payload is judged by `createVariantSchema` before anything is
 * sent, and the attempt's identity and its durable receipt belong to `ActionReview`.
 */
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
  const [frozen, setFrozen] = useState<CreateInput | null>(null);
  const overview = useVariantOverview({ scope: roster.scope, documentId });
  const create = useCreateVariant();
  const submitCreate = create.submit;
  const answered = overview.result;
  // A result read under a context this surface no longer shows is dropped rather than presented as the current one's authority.
  const liveEnvelope = answered !== undefined && answered.kind === "envelope" && !overview.isStale(answered) ? answered.envelope : undefined;
  const admitted = AUDIENCE_ORDER.filter((option) => liveEnvelope === undefined || liveEnvelope.data.audiences.includes(option));
  const effectiveAudience = admitted.includes(audience) ? audience : (admitted[0] ?? DEFAULT_AUDIENCE);
  const createAction = liveEnvelope === undefined ? undefined : liveEnvelope.actions.find((action) => action.name === CREATE_VARIANT_ACTION);
  const chosenDocument = roster.documents.find((candidate) => candidate.documentId === documentId);
  // A choice is narrowed from the string a radio group reports to the one value the Update's family admits, and it clears the last refusal so the form never states a stale message.
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
  const submit = useCallback(
    (input: MutationInput<CreateVariantPayload>): Promise<CreateOutcome> => submitCreate({ scope: input.scope, expectedRevision: input.expectedRevision, payload: input.payload }),
    [submitCreate],
  );
  // One accepted attempt opens the Update the edition now belongs to, so the next job — writing the draft — starts where the edition lives.
  const handleSettled = useCallback(
    (outcome: CreateOutcome): void => {
      if (outcome.outcome === "invalid") {
        // The service's own per-field messages return to the form beside what the worker typed: nothing is discarded and nothing is re-asked for.
        setErrors(fieldErrorsFromInvalid(outcome));
        setStep("form");
        return;
      }
      setErrors(null);
      if (outcome.outcome !== "accepted" && outcome.outcome !== "alreadyAccepted") return;
      const createdDocumentId = frozen === null ? "" : frozen.payload.documentId;
      handleOpenChange(false);
      if (createdDocumentId === "") return;
      router.push(`${UPDATES_ROUTE}/${encodeURIComponent(createdDocumentId)}`);
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
      // A value the service would refuse is refused here, keyed by the same field paths, and no attempt is minted for it.
      setErrors(lookupOfIssues(checked.error.issues));
      return;
    }
    setErrors(null);
    setFrozen({ scope: liveEnvelope.scope, expectedRevision: liveEnvelope.revision, payload: checked.data });
    setStep("review");
  };
  // The Update the edition is added to is chosen first, so the choice stands even while that Update's own read is arriving or has refused it.
  const documentField =
    roster.documents.length > 1 ? (
      <FormField name="documentId" label={CREATE_COPY.updateLabel} description={CREATE_COPY.updateDescription} error={errors?.byField["documentId"]} required>
        {(control) => (
          <NativeSelect
            id={control.id}
            name="documentId"
            className="w-full"
            value={documentId}
            required={control.required}
            aria-invalid={control.invalid || undefined}
            aria-describedby={control.describedBy}
            onChange={(event) => {
              setDocumentId(event.currentTarget.value);
              setErrors(null);
            }}
          >
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
  // What the chosen Update's own read states, or the honest state that replaces the fields it would fill. Nothing here is guessed while it is missing.
  let readSection: ReactElement;
  if (documentId === "") {
    readSection = <p className={MUTED_PARAGRAPH_CLASS}>{CREATE_COPY.chooseUpdate}</p>;
  } else if (answered !== undefined && answered.kind === "denied") {
    // A denial states no count, title or existence hint, and the same answer holds whether or not anything exists in this scope.
    readSection = <StateNotice kind="denied" headingLevel={3} title={CREATE_COPY.deniedTitle} reasonCode={answered.denied.reasonCode} />;
  } else if (answered !== undefined && answered.kind === "unavailable") {
    readSection = (
      <StateNotice
        kind="unavailable"
        headingLevel={3}
        title={CREATE_COPY.unavailableTitle}
        description={answered.unavailable.guidance}
        source={answered.unavailable.source}
        retry={{
          label: CREATE_COPY.retry,
          onClick: () => {
            overview.refetch();
          },
        }}
      />
    );
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
                        <span id={descriptionId} className="text-sm font-normal text-pretty text-muted-foreground">
                          {wording.whoReceives}
                        </span>
                      </span>
                    </Label>
                  );
                })}
              </RadioGroup>
            )}
          </FormFieldGroup>
        )}
        <FormField name="locale" label={CREATE_COPY.localeLabel} description={CREATE_COPY.localeDescription} error={errors?.byField["locale"]} required>
          {(control) => (
            <Input
              id={control.id}
              name="locale"
              type="text"
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              value={locale}
              required={control.required}
              aria-invalid={control.invalid || undefined}
              aria-describedby={control.describedBy}
              onChange={(event) => {
                setLocale(event.currentTarget.value);
              }}
            />
          )}
        </FormField>
        <section aria-labelledby={existingLegendId} className="flex min-w-0 flex-col gap-2">
          <p id={existingLegendId} className="text-sm font-medium">
            {CREATE_COPY.existingLegend}
          </p>
          {liveEnvelope.data.editions.length === 0 ? (
            <p className={MUTED_PARAGRAPH_CLASS}>{CREATE_COPY.existingEmpty}</p>
          ) : (
            <ul className="flex min-w-0 flex-col gap-2">
              {liveEnvelope.data.editions.map((edition) => (
                <li key={edition.variantId} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <bdi dir={edition.locale.direction} className="text-sm font-medium">
                    {endonymOf(edition.locale.tag)}
                  </bdi>
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
  // The one reason this Update cannot take an edition, stated beside the control that would otherwise offer it.
  const createReason = createAction !== undefined && createAction.available ? null : (createAction?.reason?.trim() ?? CREATE_COPY.noCreateAction);
  let body: ReactElement;
  if (step === "review" && frozen !== null) {
    body = (
      <ActionReview<CreateVariantPayload>
        title={CREATE_COPY.reviewTitle}
        description={<EditionReviewSummary document={chosenDocument} payload={frozen.payload} />}
        confirmLabel={CREATE_COPY.confirm}
        cancelLabel={CREATE_COPY.back}
        onCancel={() => {
          setStep("form");
        }}
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
        {createReason === null ? null : (
          <p id={createReasonId} className={MUTED_PARAGRAPH_CLASS}>
            {createReason}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            {CREATE_COPY.cancel}
          </Button>
          <Button type="submit" disabled={liveEnvelope === undefined || createReason !== null} aria-describedby={createReason === null ? undefined : createReasonId}>
            {CREATE_COPY.review}
          </Button>
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

// ---------------------------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------------------------

/** Props of {@link UpdatesList}. */
export interface UpdatesListProps {
  /** The listing read, made plain by {@link rosterOf} on the server that read it. */
  readonly roster: UpdatesRoster;
  /** The level this surface's own heading occupies, so a page that already states an `h1` keeps one. */
  readonly headingLevel?: 1 | 2;
  readonly className?: string;
}

const HEADING_TAG = { 1: "h1", 2: "h2" } as const;

/** The Ministry Updates roster: every Update and every edition the admitted scope holds, with the one reviewed way to add an edition. */
export default function UpdatesList({ roster, headingLevel = 2, className }: UpdatesListProps): ReactElement {
  const headingId = useId();
  const [queryState, setQueryState] = useState<RecordListQueryState>(() => ({ sort: NO_ORDER, page: FIRST_PAGE, pageSize: PAGE_SIZE_DEFAULT, columnVisibility: NO_COLUMNS_HIDDEN }));
  const [dialogOpen, setDialogOpen] = useState(false);
  const handleQueryStateChange = useCallback((next: RecordListQueryState): void => {
    // The page, the row size and the visible columns are kept; an ordering is never kept, because this read applies its own order and takes no ordering parameter.
    setQueryState({ sort: NO_ORDER, page: Math.max(FIRST_PAGE, Math.trunc(next.page)), pageSize: pageSizeOf(next.pageSize), columnVisibility: next.columnVisibility });
  }, []);
  const rows = useMemo(() => rowsOf(roster), [roster]);
  // The read's own statement that reviewing is one of the things it admits here, so a candidate is linked to its review only where that step is really available.
  const reviewAvailable = roster.actions.some((action) => action.name === REVIEW_CANDIDATE_ACTION && action.available);
  const columns = useMemo<ReadonlyArray<RecordListColumnDef<RosterRow>>>(
    () => [
      { id: "update", header: SURFACE_COPY.columnLabels.update, enableSorting: false, enableHiding: false, cell: (context) => <UpdateCell row={context.row.original} /> },
      { id: "audience", header: SURFACE_COPY.columnLabels.audience, enableSorting: false, cell: (context) => <AudienceCell edition={context.row.original.edition} /> },
      { id: "language", header: SURFACE_COPY.columnLabels.language, enableSorting: false, cell: (context) => <LanguageCell edition={context.row.original.edition} /> },
      { id: "status", header: SURFACE_COPY.columnLabels.status, enableSorting: false, cell: (context) => <StatusCell edition={context.row.original.edition} /> },
      {
        id: "review",
        header: SURFACE_COPY.columnLabels.review,
        enableSorting: false,
        cell: (context) => {
          const { edition } = context.row.original;
          const href = reviewAvailable && edition.candidateId !== null ? `${REVIEW_ROUTE}/${encodeURIComponent(edition.candidateId)}` : null;
          return <ReviewCell edition={edition} reviewHref={href} />;
        },
      },
      { id: "release", header: SURFACE_COPY.columnLabels.release, enableSorting: false, cell: (context) => <ReleaseCell edition={context.row.original.edition} /> },
    ],
    [reviewAvailable],
  );
  // The one value state this surface reads: the envelope's own statement about its collection, never a count recomputed from the rows.
  const documentsState: ValueState = roster.valueStates[DOCUMENTS_MEMBER] ?? "value";
  const noticeLevel: NoticeHeadingLevel = headingLevel === 1 ? 2 : 3;
  const offersCreate = roster.documents.length > 0;
  const HeadingTag = HEADING_TAG[headingLevel];
  let content: ReactElement;
  if (documentsState === "unavailable" || documentsState === "unknown" || documentsState === "withheld") {
    // A value state that is not a number replaces every figure: an unreadable or withheld collection is never an empty list and never a zero.
    content = <StateNotice kind="unavailable" headingLevel={noticeLevel} title={SURFACE_COPY.unavailableTitle} description={SURFACE_COPY.unavailableBody} source={roster.source} />;
  } else if (documentsState === "zero" || roster.documents.length === 0) {
    // An empty collection offers a real destination rather than a control that could only fail: this build creates an Update's canonical identity elsewhere.
    content = <StateNotice kind="empty" headingLevel={noticeLevel} title={SURFACE_COPY.emptyTitle} description={SURFACE_COPY.emptyBody} action={{ label: SURFACE_COPY.emptyAction, href: HELP_HREF }} />;
  } else {
    const shown = windowOf(rows, queryState.page, queryState.pageSize);
    content = (
      <RecordList
        label={SURFACE_COPY.tableLabel}
        columns={columns}
        rows={shown.items}
        // The whole collection the read returned, never the size of the window on show.
        rowCount={rows.length}
        queryState={{ sort: NO_ORDER, page: shown.page, pageSize: queryState.pageSize, columnVisibility: queryState.columnVisibility }}
        onQueryStateChange={handleQueryStateChange}
        getRowId={(row) => row.key}
        itemNoun={ITEM_NOUN}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
      />
    );
  }
  return (
    <section data-slot="updates-list" aria-labelledby={headingId} className={cn("flex min-w-0 flex-col gap-4 text-start", className)}>
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <HeadingTag id={headingId} className="font-heading text-2xl font-semibold text-pretty break-words">
            {SURFACE_COPY.heading}
          </HeadingTag>
          <p className={MUTED_PARAGRAPH_CLASS}>{SURFACE_COPY.purpose}</p>
          <p className={MUTED_PARAGRAPH_CLASS}>{SURFACE_COPY.intro}</p>
        </div>
        <div className="flex min-w-0 flex-col items-start gap-1">
          {offersCreate ? (
            <Button type="button" className="h-auto max-w-full whitespace-normal" onClick={() => setDialogOpen(true)}>
              {SURFACE_COPY.addEdition}
            </Button>
          ) : null}
          {offersCreate ? <p className="max-w-prose text-xs text-pretty text-muted-foreground">{SURFACE_COPY.addEditionNote}</p> : null}
        </div>
      </div>
      <p className={MUTED_PARAGRAPH_CLASS}>{SURFACE_COPY.orderNote}</p>
      {content}
      {/* Coverage and the read instant travel with the envelope, so a list read before a change says so instead of presenting itself as current. */}
      {roster.coverage.state === "complete" ? null : <StateNotice kind="partial-coverage" headingLevel={noticeLevel} title={SURFACE_COPY.coverageTitle} coverage={roster.coverage} />}
      <p className={CELL_TEXT_CLASS}>
        {`${SURFACE_COPY.readAt}: `}
        <bdi className={IDENTIFIER_CLASS}>{roster.asOf}</bdi>
      </p>
      <p className={MUTED_PARAGRAPH_CLASS}>{SURFACE_COPY.audienceNote}</p>
      <p className={MUTED_PARAGRAPH_CLASS}>{SURFACE_COPY.outcomeNote}</p>
      {offersCreate ? <CreateEditionDialog roster={roster} open={dialogOpen} onOpenChange={setDialogOpen} /> : null}
    </section>
  );
}

