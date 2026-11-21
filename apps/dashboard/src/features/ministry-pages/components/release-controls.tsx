"use client";
/**
 * Per-edition release and withdrawal for one Page: submit a draft for its one review step, ask for changes on
 * a frozen candidate, release the editions explicitly selected, withdraw one language edition, and withdraw the
 * Page itself.
 *
 * Every action is reviewed once through the shared review step and reports its result for the edition it covers.
 * A Page release sends no message at all, so no sending control and no mail simulation belongs on this surface:
 * the one simulated effect here is publication reach, labelled beside the release that produces it.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import type { ZodError } from "zod";
import ActionReview, { type ActionReviewProps, type MutationSubmit, type ReviewHeadingLevel } from "@/components/action-review";
import { DraftStatus, LIFECYCLE_STATUS, type ContentLifecycleState } from "@/components/draft-status";
import FormField, { fieldErrorsFromInvalid, FormFieldGroup, type FieldErrorLookup } from "@/components/form-field";
import StatusBadge, { type StatusBadgeSpec } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { copy } from "../copy";
import { usePublishPageVariants, useRequestPageChanges, useSubmitPageForReview } from "../hooks/use-release-mutations";
import { useWithdrawPage, useWithdrawPageLocale, type WithdrawPageVariables } from "../hooks/use-withdraw-mutations";
import { requestChangesPayloadSchema } from "../schemas/release";

// ---------------------------------------------------------------------------------------------
// Types, derived from the modules that own them rather than restated here
// ---------------------------------------------------------------------------------------------

/** The scope a Page write states, taken from the family's own transport so its shape stays the service's. */
type PageScope = WithdrawPageVariables["scope"];

type SubmitPayload = Parameters<ReturnType<typeof useSubmitPageForReview>["mutateAsync"]>[0]["payload"];

type ChangesPayload = Parameters<ReturnType<typeof useRequestPageChanges>["mutateAsync"]>[0]["payload"];

type PublishPayload = Parameters<ReturnType<typeof usePublishPageVariants>["mutateAsync"]>[0]["payload"];

type WithdrawLocalePayload = Parameters<ReturnType<typeof useWithdrawPageLocale>["mutateAsync"]>[0]["payload"];

type WithdrawPagePayload = WithdrawPageVariables["payload"];

/** What every mutation answers with, taken from the review step's own contract. */
type SettledOutcome = Parameters<NonNullable<ActionReviewProps["onSettled"]>>[0];

/** The input a review step is handed: the attempt identity is the review step's to mint. */
type ReviewInput<P> = ActionReviewProps<P>["input"];

/** One row of a release attempt as the service reports it. */
type PerVariantItem = NonNullable<Extract<SettledOutcome, { readonly outcome: "accepted" }>["items"]>[number];

/** One language edition as the Page read carries it: its own draft, candidate, release head and lifecycle. */
export type ReleaseVariantView = { readonly variantId: string; readonly locale: string; readonly lifecycle: ContentLifecycleState; readonly candidateId?: string; readonly revisionId?: string; readonly releaseHeadId?: string };

/** One edition chosen for release: a release publishes a frozen candidate, so the candidate's own identity is what travels. */
type ReleaseCandidate = { readonly variantId: string; readonly locale: string; readonly candidateId: string };

export interface ReleaseControlsProps {
  /**
   * The scope every write states. A Page mutation names the organization, ministry, support subject and
   * principal it acts in so the service checks that authority instead of inferring it, so the surface that
   * dispatches the writes has to carry that context.
   */
  readonly scope: PageScope;
  readonly documentId: string;
  readonly expectedRevision: string;
  readonly variants: readonly ReleaseVariantView[];
  readonly selectedVariantIds: readonly string[];
  readonly onSelectionChange: (variantIds: string[]) => void;
  readonly className?: string;
}

/** The per-edition steps that are opened from one edition's own row. */
type EditionPanelKind = "submit" | "changes" | "withdraw";

type EditionPanel = { readonly kind: EditionPanelKind; readonly variantId: string };

const PANEL_HEADING_LEVEL: ReviewHeadingLevel = 3;

// ---------------------------------------------------------------------------------------------
// Per-edition result vocabulary
// ---------------------------------------------------------------------------------------------

/** The word and tone of one release attempt's per-edition state, in this family's own words. */
const RELEASE_STATE_BADGE: Readonly<Record<string, StatusBadgeSpec>> = { released: LIFECYCLE_STATUS.released, "failed-prior-good-head": { label: copy.release.stillNeedsAttention, tone: "caution" }, "needs-attention": { label: copy.release.stillNeedsAttention, tone: "danger" }, withdrawn: LIFECYCLE_STATUS.withdrawn };

/** The label for a per-edition state, including a state this surface was not told about. */
function releaseStateBadge(state: string): StatusBadgeSpec {
  return RELEASE_STATE_BADGE[state] ?? { label: state, tone: "muted" };
}

/** What one per-edition state means for the attempt that produced it, or `null` when the state speaks for itself. */
function releaseStateMeaning(state: string): string | null {
  switch (state) {
    case "released":
      return LIFECYCLE_STATUS.released.explanation;
    case "failed-prior-good-head":
      return copy.release.failedUnderPriorGoodHead;
    case "needs-attention":
      return copy.release.stillNeedsAttention;
    case "withdrawn":
      return LIFECYCLE_STATUS.withdrawn.explanation;
    default:
      return null;
  }
}

/** Whether this state kept the edition's earlier publication instead of releasing a new revision. */
function keepsPriorGoodHead(state: string): boolean {
  return state === "failed-prior-good-head";
}

// ---------------------------------------------------------------------------------------------
// Validation messages
// ---------------------------------------------------------------------------------------------

/** The per-field messages a refused payload produced, keyed the way the one form field presentation reads them. */
function fieldMessagesOf(error: ZodError): Readonly<Record<string, readonly string[]>> {
  const messages: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.length === 0 ? "reason" : issue.path.map((step) => String(step)).join(".");
    const existing = messages[path];
    if (existing === undefined) {
      messages[path] = [issue.message];
    } else if (!existing.includes(issue.message)) {
      existing.push(issue.message);
    }
  }
  return messages;
}

/**
 * The field paths a refusal actually names — the schema judges the change inside the mutation's `payload`
 * member, so the same field arrives as `reason` from this surface and as `payload.reason` from the transport.
 */
const CHANGES_FIELD_LABELS: Readonly<Record<string, string>> = { reason: copy.release.requestChanges, "payload.reason": copy.release.requestChanges };

/** The field paths a refused release names, shown with the words this surface uses for them rather than the schema's own names. */
const PUBLISH_FIELD_LABELS: Readonly<Record<string, string>> = { candidateIds: copy.editions.heading, "payload.candidateIds": copy.editions.heading, documentId: copy.release.publish, "payload.documentId": copy.release.publish };

const REASON_PATHS = ["reason", "payload.reason"] as const;

/** The message a refused change request stated, keyed for the one field that request carries. */
function reasonRefusalOf(outcome: SettledOutcome): FieldErrorLookup | null {
  if (outcome.outcome !== "invalid") return null;
  const lookup = fieldErrorsFromInvalid(outcome);
  for (const path of REASON_PATHS) {
    const messages = lookup.byField[path];
    if (messages !== undefined && messages.length > 0) return { byField: { reason: messages }, form: lookup.form, count: messages.length };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// The review step, with the receipt held across the re-read a write causes
// ---------------------------------------------------------------------------------------------

type ReviewedActionProps<P> = {
  readonly title: string;
  readonly description?: ReactNode;
  readonly consequence?: ReactNode;
  readonly confirmLabel: string;
  readonly selection?: ActionReviewProps<P>["selection"];
  readonly consequential?: boolean;
  readonly simulationEffect?: ActionReviewProps<P>["simulationEffect"];
  readonly fieldLabels?: Readonly<Record<string, string | undefined>>;
  readonly liveInput: ReviewInput<P>;
  readonly submit: MutationSubmit<P>;
  readonly onCancel?: () => void;
  readonly onSettled?: (outcome: SettledOutcome) => void;
  readonly headingLevel: ReviewHeadingLevel;
};

/**
 * The shared review step, holding the intent that was submitted while its receipt stands. An accepted write
 * advances the record's revision and the Page beside it re-reads, and the review step shows a result only while
 * the input it is handed matches the intent it reviewed: the advanced revision would otherwise read as a
 * different intention and the receipt would vanish the moment it was produced.
 */
function ReviewedAction<P>({ liveInput, submit, onSettled, ...review }: ReviewedActionProps<P>): ReactElement {
  const [submitted, setSubmitted] = useState<ReviewInput<P> | null>(null);
  const [settled, setSettled] = useState<SettledOutcome | null>(null);
  const holdsReceipt = settled !== null && (settled.outcome === "accepted" || settled.outcome === "alreadyAccepted" || settled.outcome === "unchanged");
  const input = holdsReceipt && submitted !== null ? submitted : liveInput;
  const submitAttempt = useCallback<MutationSubmit<P>>(
    async (attempt) => {
      setSubmitted({ scope: attempt.scope, expectedRevision: attempt.expectedRevision, payload: attempt.payload });
      const outcome = await submit(attempt);
      setSettled(outcome);
      onSettled?.(outcome);
      return outcome;
    },
    [submit, onSettled],
  );
  return <ActionReview<P> {...review} input={input} submit={submitAttempt} />;
}

// ---------------------------------------------------------------------------------------------
// One language edition
// ---------------------------------------------------------------------------------------------

interface EditionRowProps {
  readonly edition: ReleaseVariantView;
  readonly selected: boolean;
  readonly onSelectedChange: (selected: boolean) => void;
  readonly onOpenPanel: (panel: EditionPanel) => void;
}

function EditionRow({ edition, selected, onSelectedChange, onOpenPanel }: EditionRowProps): ReactElement {
  const checkboxId = useId();
  const hasRevision = (edition.revisionId ?? "").trim() !== "";
  const hasCandidate = (edition.candidateId ?? "").trim() !== "";
  const hasRelease = (edition.releaseHeadId ?? "").trim() !== "" && edition.lifecycle !== "withdrawn";
  const canSubmit = edition.lifecycle === "draft" && hasRevision;
  const canRequestChanges = edition.lifecycle === "candidate" && hasCandidate;
  const canWithdraw = hasRelease;
  return (
    <li data-slot="release-edition" data-lifecycle-state={edition.lifecycle} className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex min-w-0 items-start gap-3">
        <Checkbox
          id={checkboxId}
          className="mt-0.5"
          checked={selected}
          // The primitive renders its role="checkbox" element separately from the labelled input, so the name is
          // stated on the control itself: every selection says which language edition it selects.
          aria-label={`${copy.editions.localeLabel} ${edition.locale}`}
          onCheckedChange={(checked: boolean) => onSelectedChange(checked)}
        />
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor={checkboxId} className="min-h-6 flex-wrap">
            <span className="font-normal text-muted-foreground">{copy.editions.localeLabel}</span>
            <bdi>{edition.locale}</bdi>
          </Label>
          <DraftStatus state={edition.lifecycle} />
        </div>
      </div>
      {canSubmit || canRequestChanges || canWithdraw ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {canSubmit ? (
            <Button type="button" variant="outline" size="sm" className="h-auto min-h-6 py-1.5 whitespace-normal" onClick={() => onOpenPanel({ kind: "submit", variantId: edition.variantId })}>
              {copy.release.submitForReview}
            </Button>
          ) : null}
          {canRequestChanges ? (
            <Button type="button" variant="outline" size="sm" className="h-auto min-h-6 py-1.5 whitespace-normal" onClick={() => onOpenPanel({ kind: "changes", variantId: edition.variantId })}>
              {copy.release.requestChanges}
            </Button>
          ) : null}
          {canWithdraw ? (
            <Button type="button" variant="ghost" size="sm" className="h-auto min-h-6 py-1.5 whitespace-normal" onClick={() => onOpenPanel({ kind: "withdraw", variantId: edition.variantId })}>
              {copy.release.withdrawLocale}
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------------------------
// The steps one edition is offered
// ---------------------------------------------------------------------------------------------

/** An edition's own name, isolated so a mixed-direction tag never reorders the sentence around it. */
function EditionName({ locale }: { readonly locale: string }): ReactElement {
  return <bdi>{locale}</bdi>;
}

interface EditionStepProps<P> {
  readonly scope: PageScope;
  readonly expectedRevision: string;
  readonly edition: ReleaseVariantView;
  readonly submit: MutationSubmit<P>;
  readonly onClose: () => void;
}

interface SubmitForReviewCardProps extends EditionStepProps<SubmitPayload> {
  readonly revisionId: string;
}

/** Freezes one draft's exact revision for its one review step. Approving is the review surface's job, not this one's. */
function SubmitForReviewCard({ scope, expectedRevision, edition, revisionId, submit, onClose }: SubmitForReviewCardProps): ReactElement {
  const liveInput = useMemo<ReviewInput<SubmitPayload>>(() => ({ scope, expectedRevision, payload: { variantId: edition.variantId, revisionId } }), [scope, expectedRevision, edition.variantId, revisionId]);
  return (
    <ReviewedAction<SubmitPayload>
      title={copy.release.submitForReview}
      description={
        <p className="text-sm text-pretty">
          <EditionName locale={edition.locale} /> — {copy.release.submitForReviewNote}
        </p>
      }
      confirmLabel={copy.release.submitForReview}
      liveInput={liveInput}
      submit={submit}
      onCancel={onClose}
      headingLevel={PANEL_HEADING_LEVEL}
    />
  );
}

/** Asks the author for a new revision of one frozen candidate: the message is required, and an empty one is refused before anything is sent. */
function RequestChangesCard({ scope, expectedRevision, edition, submit, onClose }: EditionStepProps<ChangesPayload>): ReactElement {
  const [message, setMessage] = useState("");
  const [touched, setTouched] = useState(false);
  const [refused, setRefused] = useState<FieldErrorLookup | null>(null);
  const candidateId = edition.candidateId ?? "";
  const payload = useMemo<ChangesPayload>(() => ({ candidateId, reason: message }), [candidateId, message]);
  const liveInput = useMemo<ReviewInput<ChangesPayload>>(() => ({ scope, expectedRevision, payload }), [scope, expectedRevision, payload]);
  const clientErrors = useMemo<FieldErrorLookup | null>(() => {
    const checked = requestChangesPayloadSchema.safeParse(payload);
    return checked.success ? null : fieldErrorsFromInvalid({ fields: fieldMessagesOf(checked.error) });
  }, [payload]);
  const errors = refused ?? (touched ? clientErrors : null);
  const settle = useCallback((outcome: SettledOutcome): void => {
    setRefused(reasonRefusalOf(outcome));
  }, []);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <FormField name="reason" label={copy.release.requestChanges} description={copy.review.reviewDoesNotRelease} error={errors?.byField.reason} required>
        {(field) => (
          <Textarea
            id={field.id}
            name="reason"
            rows={4}
            value={message}
            aria-describedby={field.describedBy}
            aria-invalid={field.invalid ? true : undefined}
            onChange={(event) => {
              setMessage(event.target.value);
              setRefused(null);
            }}
            onBlur={() => {
              setTouched(true);
            }}
          />
        )}
      </FormField>
      <ReviewedAction<ChangesPayload>
        title={copy.release.requestChanges}
        description={
          <p className="text-sm text-pretty">
            <EditionName locale={edition.locale} /> — {copy.review.reviewDoesNotRelease}
          </p>
        }
        confirmLabel={copy.release.requestChanges}
        fieldLabels={CHANGES_FIELD_LABELS}
        liveInput={liveInput}
        submit={submit}
        onCancel={onClose}
        onSettled={settle}
        headingLevel={PANEL_HEADING_LEVEL}
      />
    </div>
  );
}

/**
 * Withdraws exactly one language edition. It is offered on the edition's own row rather than from the shared
 * selection, because the write names one edition and because ticking an edition in order to release it must
 * never also propose withdrawing it.
 */
function WithdrawLocaleCard({ scope, expectedRevision, edition, submit, onClose }: EditionStepProps<WithdrawLocalePayload>): ReactElement {
  const liveInput = useMemo<ReviewInput<WithdrawLocalePayload>>(() => ({ scope, expectedRevision, payload: { variantId: edition.variantId } }), [scope, expectedRevision, edition.variantId]);
  return (
    <ReviewedAction<WithdrawLocalePayload>
      title={copy.release.withdrawLocale}
      description={
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-sm text-pretty">
            <EditionName locale={edition.locale} /> — {LIFECYCLE_STATUS.withdrawn.explanation}
          </p>
          <p className="text-sm text-pretty text-muted-foreground">{copy.editions.editionIndependenceNote}</p>
        </div>
      }
      confirmLabel={copy.release.withdrawLocale}
      // The confirmation dialog shows the consequence and not the card's description, so what a withdrawal never
      // does is stated inside the dialog the person actually confirms.
      consequence={
        <div className="flex min-w-0 flex-col gap-2">
          <p>{LIFECYCLE_STATUS.withdrawn.explanation}</p>
          <p className="text-muted-foreground">{copy.editions.editionIndependenceNote}</p>
        </div>
      }
      consequential
      liveInput={liveInput}
      submit={submit}
      onCancel={onClose}
      headingLevel={PANEL_HEADING_LEVEL}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// The Page-wide steps
// ---------------------------------------------------------------------------------------------

interface PublishCardProps {
  readonly scope: PageScope;
  readonly expectedRevision: string;
  readonly documentId: string;
  readonly publishable: readonly ReleaseCandidate[];
  readonly excludedCount: number;
  readonly submit: MutationSubmit<PublishPayload>;
  readonly onSettled: (outcome: SettledOutcome) => void;
}

/** Releases the editions explicitly selected, and only those: an empty selection disables the step and says why. */
function PublishCard({ scope, expectedRevision, documentId, publishable, excludedCount, submit, onSettled }: PublishCardProps): ReactElement {
  const liveInput = useMemo<ReviewInput<PublishPayload>>(() => ({ scope, expectedRevision, payload: { documentId, candidateIds: publishable.map((selection) => selection.candidateId) } }), [scope, expectedRevision, documentId, publishable]);
  // A refusal names either the whole list of candidates or one edition by its position in that list, so both
  // paths are shown with the words this surface uses for them.
  const fieldLabels = useMemo(() => {
    const labels: Record<string, string> = { ...PUBLISH_FIELD_LABELS };
    publishable.forEach((selection, index) => {
      labels[`variants.${String(index)}`] = selection.locale;
    });
    return labels;
  }, [publishable]);
  return (
    <ReviewedAction<PublishPayload>
      title={copy.release.publish}
      description={
        <div className="flex min-w-0 flex-col gap-2">
          <p>{copy.release.publishNote}</p>
          {publishable.length === 0 ? null : (
            <div className="flex min-w-0 flex-col gap-1">
              <p className="font-medium">{copy.editions.heading}</p>
              <ul className="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
                {publishable.map((selection) => (
                  <li key={selection.variantId}>
                    <bdi>{selection.locale}</bdi>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      }
      confirmLabel={copy.release.publish}
      selection={{ count: publishable.length, noun: copy.editions.heading, excluded: excludedCount }}
      simulationEffect="publication-reach"
      fieldLabels={fieldLabels}
      liveInput={liveInput}
      submit={submit}
      onSettled={onSettled}
      headingLevel={PANEL_HEADING_LEVEL}
    />
  );
}

interface WithdrawPageCardProps {
  readonly scope: PageScope;
  readonly expectedRevision: string;
  readonly documentId: string;
  readonly editionCount: number;
  readonly submit: MutationSubmit<WithdrawPagePayload>;
}

/** Withdraws every released edition of the Page in one step, stating what a withdrawal never does. */
function WithdrawPageCard({ scope, expectedRevision, documentId, editionCount, submit }: WithdrawPageCardProps): ReactElement {
  const liveInput = useMemo<ReviewInput<WithdrawPagePayload>>(() => ({ scope, expectedRevision, payload: { documentId } }), [scope, expectedRevision, documentId]);
  return (
    <ReviewedAction<WithdrawPagePayload>
      title={copy.release.withdrawPage}
      description={
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-sm text-pretty">{copy.release.withdrawConfirm(editionCount)}</p>
          <p className="text-sm text-pretty text-muted-foreground">{LIFECYCLE_STATUS.withdrawn.explanation}</p>
        </div>
      }
      confirmLabel={copy.release.withdrawPage}
      // The dialog is what the person confirms, so the count and the no-recall statement appear inside it too.
      consequence={
        <div className="flex min-w-0 flex-col gap-2">
          <p>{copy.release.withdrawConfirm(editionCount)}</p>
          <p className="text-muted-foreground">{LIFECYCLE_STATUS.withdrawn.explanation}</p>
        </div>
      }
      consequential
      liveInput={liveInput}
      submit={submit}
      headingLevel={PANEL_HEADING_LEVEL}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// What one release attempt did, edition by edition
// ---------------------------------------------------------------------------------------------

interface ReleaseResultsProps {
  readonly items: readonly PerVariantItem[];
  readonly variants: readonly ReleaseVariantView[];
}

/** One row per edition of the attempt, each carrying its own result: a mixed attempt is never reported as one outcome. */
function ReleaseResults({ items, variants }: ReleaseResultsProps): ReactElement | null {
  const headingId = useId();
  if (items.length === 0) return null;
  return (
    <section aria-labelledby={headingId} data-slot="release-variant-results" className="flex min-w-0 flex-col gap-2">
      <h3 id={headingId} className="text-sm font-medium">
        {copy.release.perVariantResultHeading}
      </h3>
      <p className="text-sm text-pretty text-muted-foreground">{copy.release.perVariantResultNote}</p>
      <ul className="flex min-w-0 flex-col gap-2">
        {items.map((item, index) => {
          const known = variants.find((variant) => variant.variantId === item.targetId);
          const meaning = releaseStateMeaning(item.state);
          const reason = (item.reason ?? "").trim();
          return (
            <li key={`${item.targetId}-${String(index)}`} data-edition-state={item.state} className="flex min-w-0 flex-col gap-1 rounded-lg border border-border p-3">
              <p className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="sr-only">{`${copy.editions.localeLabel}: `}</span>
                <bdi className="text-sm font-medium">{known?.locale ?? item.targetId}</bdi>
                <StatusBadge {...releaseStateBadge(item.state)} srPrefix={copy.release.perVariantResultHeading} />
              </p>
              {meaning === null ? null : <p className="text-sm text-pretty wrap-anywhere">{meaning}</p>}
              {keepsPriorGoodHead(item.state) ? <p className="text-sm text-pretty text-muted-foreground wrap-anywhere">{copy.release.priorGoodHeadPreserved}</p> : null}
              {reason === "" ? null : <p className="text-sm text-pretty text-muted-foreground wrap-anywhere">{reason}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------------------------

/** The Page's release and withdrawal controls: the editions it holds, the steps each one is offered, and the two Page-wide steps. */
export function ReleaseControls({ scope, documentId, expectedRevision, variants, selectedVariantIds, onSelectionChange, className }: ReleaseControlsProps): ReactElement {
  const submitForReview = useSubmitPageForReview();
  const requestChanges = useRequestPageChanges();
  const publishVariants = usePublishPageVariants();
  const withdrawLocale = useWithdrawPageLocale();
  const withdrawPage = useWithdrawPage();
  const [openPanel, setOpenPanel] = useState<EditionPanel | null>(null);
  const [report, setReport] = useState<readonly PerVariantItem[]>([]);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const selectedSet = useMemo(() => new Set(selectedVariantIds), [selectedVariantIds]);
  const publish = useMemo(() => {
    const rows: ReleaseCandidate[] = [];
    let excluded = 0;
    for (const variant of variants) {
      if (!selectedSet.has(variant.variantId)) continue;
      const candidateId = (variant.candidateId ?? "").trim();
      // An edition with no frozen candidate has nothing a release could publish, so it is excluded from the step
      // rather than sent as a request the service has to refuse.
      if (candidateId === "") {
        excluded += 1;
        continue;
      }
      rows.push({ variantId: variant.variantId, locale: variant.locale, candidateId });
    }
    return { rows, excluded };
  }, [variants, selectedSet]);
  const liveEditionCount = useMemo(() => variants.filter((variant) => (variant.releaseHeadId ?? "").trim() !== "" && variant.lifecycle !== "withdrawn").length, [variants]);
  const openEdition = openPanel === null ? undefined : variants.find((variant) => variant.variantId === openPanel.variantId);
  const openRevisionId = (openEdition?.revisionId ?? "").trim();
  // The step a row opens is revealed below the list, so the keyboard position follows the person to it.
  useEffect(() => {
    if (openPanel !== null) panelRef.current?.focus();
  }, [openPanel]);
  const selectEdition = (variantId: string, on: boolean): void => {
    const next = new Set(selectedVariantIds);
    if (on) next.add(variantId);
    else next.delete(variantId);
    // A different selection is a different release, so the report of the previous attempt stops standing beside it.
    setReport([]);
    onSelectionChange(variants.filter((variant) => next.has(variant.variantId)).map((variant) => variant.variantId));
  };
  const settlePublish = (outcome: SettledOutcome): void => {
    setReport(outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" ? (outcome.items ?? []) : []);
  };
  return (
    <div data-slot="release-controls" data-selected-editions={String(selectedVariantIds.length)} className={cn("flex min-w-0 flex-col gap-6", className)}>
      <FormFieldGroup legend={copy.editions.heading} name="release-editions" description={copy.editions.editionIndependenceNote}>
        {() =>
          variants.length === 0 ? (
            <p className="text-sm text-pretty text-muted-foreground">{copy.states.emptyEditions}</p>
          ) : (
            <ul className="flex min-w-0 flex-col gap-3">
              {variants.map((variant) => (
                <EditionRow key={variant.variantId} edition={variant} selected={selectedSet.has(variant.variantId)} onSelectedChange={(on) => selectEdition(variant.variantId, on)} onOpenPanel={setOpenPanel} />
              ))}
            </ul>
          )
        }
      </FormFieldGroup>
      {openPanel === null || openEdition === undefined ? null : (
        <div ref={panelRef} tabIndex={-1} data-slot="release-edition-step" data-step={openPanel.kind} className="flex min-w-0 flex-col gap-3">
          {openPanel.kind === "submit" && openRevisionId !== "" ? (
            <SubmitForReviewCard
              scope={scope}
              expectedRevision={expectedRevision}
              edition={openEdition}
              revisionId={openRevisionId}
              submit={(input) => submitForReview.mutateAsync(input)}
              onClose={() => {
                setOpenPanel(null);
              }}
            />
          ) : null}
          {openPanel.kind === "changes" ? (
            <RequestChangesCard
              scope={scope}
              expectedRevision={expectedRevision}
              edition={openEdition}
              submit={(input) => requestChanges.mutateAsync({ ...input, documentId })}
              onClose={() => {
                setOpenPanel(null);
              }}
            />
          ) : null}
          {openPanel.kind === "withdraw" ? (
            <WithdrawLocaleCard
              scope={scope}
              expectedRevision={expectedRevision}
              edition={openEdition}
              submit={(input) => withdrawLocale.mutateAsync({ ...input, documentId, variantId: input.payload.variantId })}
              onClose={() => {
                setOpenPanel(null);
              }}
            />
          ) : null}
        </div>
      )}
      {variants.length === 0 ? null : (
        <>
          <Separator />
          <PublishCard scope={scope} expectedRevision={expectedRevision} documentId={documentId} publishable={publish.rows} excludedCount={publish.excluded} submit={(input) => publishVariants.mutateAsync({ ...input, documentId })} onSettled={settlePublish} />
          <ReleaseResults items={report} variants={variants} />
        </>
      )}
      {liveEditionCount === 0 ? null : (
        <>
          <Separator />
          <WithdrawPageCard scope={scope} expectedRevision={expectedRevision} documentId={documentId} editionCount={liveEditionCount} submit={(input) => withdrawPage.mutateAsync({ ...input, documentId })} />
        </>
      )}
    </div>
  );
}

export default ReleaseControls;
