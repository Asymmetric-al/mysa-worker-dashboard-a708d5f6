"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import type { ZodError } from "zod";
import ActionReview, { type ActionReviewProps, type MutationSubmit, type ReviewHeadingLevel } from "@/components/action-review";
import { DraftStatus, LIFECYCLE_STATUS, type ContentLifecycleState } from "@/components/draft-status";
import FormField, { fieldErrorsFromInvalid, FormFieldGroup, type FieldErrorLookup } from "@/components/form-field";
import StatusBadge, { type StatusBadgeSpec } from "@/components/status-badge";
import { Button, BUTTON_WRAP_CLASS } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { copy } from "../copy";
import { usePublishPageVariants, useRequestPageChanges, useSubmitPageForReview, useWithdrawPage, useWithdrawPageLocale, type WithdrawPageVariables } from "../hooks/page-mutations";
import { requestChangesPayloadSchema } from "../schemas/release";
type PageScope = WithdrawPageVariables["scope"];
type SubmitPayload = Parameters<ReturnType<typeof useSubmitPageForReview>["mutateAsync"]>[0]["payload"];
type ChangesPayload = Parameters<ReturnType<typeof useRequestPageChanges>["mutateAsync"]>[0]["payload"];
type PublishPayload = Parameters<ReturnType<typeof usePublishPageVariants>["mutateAsync"]>[0]["payload"];
type WithdrawPagePayload = WithdrawPageVariables["payload"];
type SettledOutcome = Parameters<NonNullable<ActionReviewProps["onSettled"]>>[0];
type ReviewInput<P> = ActionReviewProps<P>["input"];
type PerVariantItem = NonNullable<Extract<SettledOutcome, { readonly outcome: "accepted" }>["items"]>[number];
export type ReleaseVariantView = { readonly variantId: string; readonly locale: string; readonly lifecycle: ContentLifecycleState; readonly candidateId?: string; readonly revisionId?: string; readonly releaseHeadId?: string };
type ReleaseCandidate = { readonly variantId: string; readonly locale: string; readonly candidateId: string };
/** The scope every write states, so the service checks that authority instead of inferring it. */
export type ReleaseControlsProps = {
  readonly scope: PageScope;
  readonly documentId: string;
  readonly expectedRevision: string;
  /* The Page record's own revision: the two withdrawal steps validate that record, while the review steps validate the edition `expectedRevision` states. */ readonly documentRevision: string;
  readonly variants: readonly ReleaseVariantView[];
  readonly selectedVariantIds: readonly string[];
  readonly onSelectionChange: (variantIds: string[]) => void;
  readonly className?: string;
};
type EditionPanelKind = "submit" | "changes" | "withdraw";
type EditionPanel = { readonly kind: EditionPanelKind; readonly variantId: string };
const PANEL_HEADING_LEVEL: ReviewHeadingLevel = 3;
const RELEASE_STATE_BADGE: Readonly<Record<string, StatusBadgeSpec>> = { released: LIFECYCLE_STATUS.released, "failed-prior-good-head": { label: copy.release.stillNeedsAttention, tone: "caution" }, "needs-attention": { label: copy.release.stillNeedsAttention, tone: "danger" }, withdrawn: LIFECYCLE_STATUS.withdrawn };
const RELEASE_STATE_MEANING: Readonly<Record<string, string>> = { released: LIFECYCLE_STATUS.released.explanation, "failed-prior-good-head": copy.release.failedUnderPriorGoodHead, "needs-attention": copy.release.stillNeedsAttention, withdrawn: LIFECYCLE_STATUS.withdrawn.explanation };
const releaseStateBadge = (state: string): StatusBadgeSpec => RELEASE_STATE_BADGE[state] ?? { label: state, tone: "muted" };
const releaseStateMeaning = (state: string): string | null => RELEASE_STATE_MEANING[state] ?? null;
const isStated = (value: string | undefined): boolean => (value ?? "").trim() !== "";
function fieldMessagesOf(error: ZodError): Readonly<Record<string, readonly string[]>> {
  const messages: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.length === 0 ? "reason" : issue.path.map((step) => String(step)).join(".");
    const existing = messages[path] ?? [];
    if (!existing.includes(issue.message)) existing.push(issue.message);
    messages[path] = existing;
  }
  return messages;
}
const CHANGES_FIELD_LABELS: Readonly<Record<string, string>> = { reason: copy.release.requestChanges, "payload.reason": copy.release.requestChanges };
const PUBLISH_FIELD_LABELS: Readonly<Record<string, string>> = { candidateIds: copy.editions.heading, "payload.candidateIds": copy.editions.heading, documentId: copy.release.publish, "payload.documentId": copy.release.publish };
const REASON_PATHS = ["reason", "payload.reason"] as const;
function reasonRefusalOf(outcome: SettledOutcome): FieldErrorLookup | null {
  if (outcome.outcome !== "invalid") return null;
  const lookup = fieldErrorsFromInvalid(outcome);
  for (const path of REASON_PATHS) {
    const messages = lookup.byField[path];
    if (messages !== undefined && messages.length > 0) return { byField: { reason: messages }, form: lookup.form, count: messages.length };
  }
  return null;
}
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
function ReviewedAction<P>({ liveInput, submit, onSettled, ...review }: ReviewedActionProps<P>): ReactElement {
  const [submitted, setSubmitted] = useState<ReviewInput<P> | null>(null);
  const [settled, setSettled] = useState<SettledOutcome | null>(null);
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
  return <ActionReview<P> {...review} input={settled !== null && (settled.outcome === "accepted" || settled.outcome === "alreadyAccepted" || settled.outcome === "unchanged") && submitted !== null ? submitted : liveInput} submit={submitAttempt} />;
}
const EditionName = ({ locale }: { readonly locale: string }): ReactElement => <bdi>{locale}</bdi>;
type EditionStepCopy = { readonly title: string; readonly confirmLabel: string; readonly consequential?: boolean; readonly description: (locale: string) => ReactNode; readonly consequence?: () => ReactNode };
const SUBMIT_STEP: EditionStepCopy = {
  title: copy.release.submitForReview,
  confirmLabel: copy.release.submitForReview,
  description: (locale) => (
    <p className="type-supporting text-pretty">
      <EditionName locale={locale} /> — {copy.release.submitForReviewNote}
    </p>
  ),
};
const WITHDRAW_STEP: EditionStepCopy = {
  title: copy.release.withdrawLocale,
  confirmLabel: copy.release.withdrawLocale,
  consequential: true,
  description: (locale) => (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="type-supporting text-pretty">
        <EditionName locale={locale} /> — {LIFECYCLE_STATUS.withdrawn.explanation}
      </p>
      <p className="type-supporting text-pretty">{copy.editions.editionIndependenceNote}</p>
    </div>
  ),
  consequence: () => (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="type-supporting">{LIFECYCLE_STATUS.withdrawn.explanation}</p>
      <p className="type-supporting">{copy.editions.editionIndependenceNote}</p>
    </div>
  ),
};
type EditionStepCardProps<P> = { readonly scope: PageScope; readonly expectedRevision: string; readonly edition: ReleaseVariantView; readonly words: EditionStepCopy; readonly input: Omit<ReviewInput<P>, "scope" | "expectedRevision">; readonly submit: MutationSubmit<P>; readonly onClose: () => void };
function EditionStepCard<P>({ scope, expectedRevision, edition, words, input, submit, onClose }: EditionStepCardProps<P>): ReactElement {
  const liveInput = useMemo<ReviewInput<P>>(() => ({ ...input, scope, expectedRevision }), [input, scope, expectedRevision]);
  return <ReviewedAction<P> title={words.title} description={words.description(edition.locale)} consequence={words.consequence?.()} consequential={words.consequential} confirmLabel={words.confirmLabel} liveInput={liveInput} submit={submit} onCancel={onClose} headingLevel={PANEL_HEADING_LEVEL} />;
}
const EDITION_STEPS: readonly { readonly kind: EditionPanelKind; readonly label: string; readonly variant: "outline" | "ghost"; readonly offered: (edition: ReleaseVariantView) => boolean }[] = [
  { kind: "submit", label: copy.release.submitForReview, variant: "outline", offered: (edition) => edition.lifecycle === "draft" && isStated(edition.revisionId) },
  { kind: "changes", label: copy.release.requestChanges, variant: "outline", offered: (edition) => edition.lifecycle === "candidate" && isStated(edition.candidateId) },
  { kind: "withdraw", label: copy.release.withdrawLocale, variant: "ghost", offered: (edition) => isStated(edition.releaseHeadId) && edition.lifecycle !== "withdrawn" },
];
function EditionRow({ edition, selected, onSelectedChange, onOpenPanel }: { readonly edition: ReleaseVariantView; readonly selected: boolean; readonly onSelectedChange: (selected: boolean) => void; readonly onOpenPanel: (panel: EditionPanel) => void }): ReactElement {
  const checkboxId = useId();
  const offered = EDITION_STEPS.filter((step) => step.offered(edition));
  return (
    <li data-slot="release-edition" data-lifecycle-state={edition.lifecycle} className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex min-w-0 items-start gap-3">
        <Checkbox id={checkboxId} className="mt-0.5" checked={selected} aria-label={`${copy.editions.localeLabel} ${edition.locale}`} onCheckedChange={(checked: boolean) => onSelectedChange(checked)} />
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor={checkboxId} className="min-h-6 flex-wrap">
            <span className="font-normal text-muted-foreground">{copy.editions.localeLabel}</span>
            <bdi>{edition.locale}</bdi>
          </Label>
          <DraftStatus state={edition.lifecycle} />
        </div>
      </div>
      {offered.length === 0 ? null : (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {offered.map((step) => (
            <Button key={step.kind} type="button" variant={step.variant} size="sm" className={BUTTON_WRAP_CLASS} onClick={() => onOpenPanel({ kind: step.kind, variantId: edition.variantId })}>
              {step.label}
            </Button>
          ))}
        </div>
      )}
    </li>
  );
}
function RequestChangesCard({ scope, expectedRevision, edition, submit, onClose }: { readonly scope: PageScope; readonly expectedRevision: string; readonly edition: ReleaseVariantView; readonly submit: MutationSubmit<ChangesPayload>; readonly onClose: () => void }): ReactElement {
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
  const settle = useCallback((outcome: SettledOutcome): void => setRefused(reasonRefusalOf(outcome)), []);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <FormField name="reason" label={copy.release.requestChanges} description={copy.review.reviewDoesNotRelease} error={(refused ?? (touched ? clientErrors : null))?.byField.reason} required>
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
            onBlur={() => setTouched(true)}
          />
        )}
      </FormField>
      <ReviewedAction<ChangesPayload>
        title={copy.release.requestChanges}
        description={
          <p className="type-supporting text-pretty">
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
type PublishCardProps = { readonly scope: PageScope; readonly expectedRevision: string; readonly documentId: string; readonly publishable: readonly ReleaseCandidate[]; readonly excludedCount: number; readonly submit: MutationSubmit<PublishPayload>; readonly onSettled: (outcome: SettledOutcome) => void };
function PublishCard({ scope, expectedRevision, documentId, publishable, excludedCount, submit, onSettled }: PublishCardProps): ReactElement {
  const liveInput = useMemo<ReviewInput<PublishPayload>>(() => ({ scope, expectedRevision, payload: { documentId, candidateIds: publishable.map((selection) => selection.candidateId) } }), [scope, expectedRevision, documentId, publishable]);
  const fieldLabels = useMemo(() => {
    const labels: Record<string, string> = { ...PUBLISH_FIELD_LABELS };
    publishable.forEach((selection, index) => (labels[`variants.${String(index)}`] = selection.locale));
    return labels;
  }, [publishable]);
  return (
    <ReviewedAction<PublishPayload>
      title={copy.release.publish}
      description={
        <div className="flex min-w-0 flex-col gap-2">
          <p className="type-supporting">{copy.release.publishNote}</p>
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
function WithdrawPageCard({ scope, expectedRevision, documentId, editionCount, submit }: { readonly scope: PageScope; readonly expectedRevision: string; readonly documentId: string; readonly editionCount: number; readonly submit: MutationSubmit<WithdrawPagePayload> }): ReactElement {
  const liveInput = useMemo<ReviewInput<WithdrawPagePayload>>(() => ({ scope, expectedRevision, payload: { documentId } }), [scope, expectedRevision, documentId]);
  return (
    <ReviewedAction<WithdrawPagePayload>
      title={copy.release.withdrawPage}
      description={
        <div className="flex min-w-0 flex-col gap-2">
          <p className="type-supporting text-pretty">{copy.release.withdrawConfirm(editionCount)}</p> <p className="type-supporting text-pretty">{LIFECYCLE_STATUS.withdrawn.explanation}</p>
        </div>
      }
      confirmLabel={copy.release.withdrawPage}
      consequence={
        <div className="flex min-w-0 flex-col gap-2">
          <p className="type-supporting">{copy.release.withdrawConfirm(editionCount)}</p> <p className="type-supporting">{LIFECYCLE_STATUS.withdrawn.explanation}</p>
        </div>
      }
      consequential
      liveInput={liveInput}
      submit={submit}
      headingLevel={PANEL_HEADING_LEVEL}
    />
  );
}
function ReleaseResults({ items, variants }: { readonly items: readonly PerVariantItem[]; readonly variants: readonly ReleaseVariantView[] }): ReactElement | null {
  const headingId = useId();
  if (items.length === 0) return null;
  return (
    <section aria-labelledby={headingId} data-slot="release-variant-results" className="flex min-w-0 flex-col gap-2">
      <h3 {...{ id: headingId, className: "type-subsection-title" as const }}>{copy.release.perVariantResultHeading}</h3>
      <p className="type-supporting text-pretty">{copy.release.perVariantResultNote}</p>
      <ul className="flex min-w-0 flex-col gap-2">
        {items.map((item, index) => {
          const reason = (item.reason ?? "").trim();
          return (
            <li key={`${item.targetId}-${String(index)}`} data-edition-state={item.state} className="flex min-w-0 flex-col gap-1 rounded-lg border border-border p-3">
              <p className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="sr-only">{`${copy.editions.localeLabel}: `}</span>
                <bdi className="text-sm font-medium">{variants.find((variant) => variant.variantId === item.targetId)?.locale ?? item.targetId}</bdi>
                <StatusBadge {...releaseStateBadge(item.state)} srPrefix={copy.release.perVariantResultHeading} />
              </p>
              {releaseStateMeaning(item.state) === null ? null : <p className="type-supporting text-pretty wrap-anywhere">{releaseStateMeaning(item.state)}</p>}
              {item.state === "failed-prior-good-head" ? <p className="type-supporting text-pretty wrap-anywhere">{copy.release.priorGoodHeadPreserved}</p> : null}
              {reason === "" ? null : <p className="type-supporting text-pretty wrap-anywhere">{reason}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
/** The Page's release and withdrawal controls: the editions it holds, the steps each one is offered, and the two Page-wide steps. */
export function ReleaseControls({ scope, documentId, expectedRevision, documentRevision, variants, selectedVariantIds, onSelectionChange, className }: ReleaseControlsProps): ReactElement {
  const submitForReview = useSubmitPageForReview();
  const requestChanges = useRequestPageChanges();
  const withdrawLocale = useWithdrawPageLocale();
  const withdrawPage = useWithdrawPage();
  const publishVariants = usePublishPageVariants();
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
      if (candidateId === "") {
        excluded += 1;
        continue;
      }
      rows.push({ variantId: variant.variantId, locale: variant.locale, candidateId });
    }
    return { rows, excluded };
  }, [variants, selectedSet]);
  const liveEditionCount = useMemo(() => variants.filter((variant) => isStated(variant.releaseHeadId) && variant.lifecycle !== "withdrawn").length, [variants]);
  const openEdition = openPanel === null ? undefined : variants.find((variant) => variant.variantId === openPanel.variantId);
  const openRevisionId = (openEdition?.revisionId ?? "").trim();
  useEffect(() => {
    if (openPanel !== null) panelRef.current?.focus();
  }, [openPanel]);
  const closePanel = useCallback((): void => setOpenPanel(null), []);
  const selectEdition = (variantId: string, on: boolean): void => {
    const next = new Set(selectedVariantIds);
    if (on) next.add(variantId);
    else next.delete(variantId);
    setReport([]);
    onSelectionChange(variants.filter((variant) => next.has(variant.variantId)).map((variant) => variant.variantId));
  };
  const settlePublish = (outcome: SettledOutcome): void => setReport(outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" ? (outcome.items ?? []) : []);
  return (
    <div data-slot="release-controls" data-selected-editions={String(selectedVariantIds.length)} className={cn("flex min-w-0 flex-col gap-6", className)}>
      <FormFieldGroup legend={copy.editions.heading} name="release-editions" description={copy.editions.editionIndependenceNote}>
        {() =>
          variants.length === 0 ? (
            <p className="type-supporting text-pretty">{copy.states.emptyEditions}</p>
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
            <EditionStepCard<SubmitPayload> scope={scope} expectedRevision={expectedRevision} edition={openEdition} words={SUBMIT_STEP} input={{ payload: { variantId: openEdition.variantId, revisionId: openRevisionId } }} submit={(input) => submitForReview.mutateAsync(input)} onClose={closePanel} />
          ) : null}
          {openPanel.kind === "withdraw" ? (
            <EditionStepCard<Parameters<ReturnType<typeof useWithdrawPageLocale>["mutateAsync"]>[0]["payload"]>
              scope={scope}
              expectedRevision={documentRevision}
              edition={openEdition}
              words={WITHDRAW_STEP}
              input={{ payload: { variantId: openEdition.variantId } }}
              submit={(input) => withdrawLocale.mutateAsync({ ...input, documentId, variantId: input.payload.variantId })}
              onClose={closePanel}
            />
          ) : null}
          {openPanel.kind === "changes" ? <RequestChangesCard scope={scope} expectedRevision={expectedRevision} edition={openEdition} submit={(input) => requestChanges.mutateAsync({ ...input, documentId })} onClose={closePanel} /> : null}
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
          <WithdrawPageCard scope={scope} expectedRevision={documentRevision} documentId={documentId} editionCount={liveEditionCount} submit={(input) => withdrawPage.mutateAsync({ ...input, documentId })} />
        </>
      )}
    </div>
  );
}
export default ReleaseControls;
