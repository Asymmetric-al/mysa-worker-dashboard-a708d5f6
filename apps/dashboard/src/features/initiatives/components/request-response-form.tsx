"use client";
/**
 * One Request's answer: the seven recorded response kinds, bound to the terms version that was presented, recorded as the named respondent's own answer through the shared review step.
 *
 * The version a Request presents is the version its answer binds to, so this surface never offers the latest one instead. An answer is one named person's own reply, it creates nothing outside the Request (no pledge, gift, commitment, subscription, notification or task), and a Request that already carries an answer shows that answer rather than a second way to answer it.
 */
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { useForm } from "@tanstack/react-form";
import type { ZodError } from "zod";
import ActionReview, { type MutationSubmit } from "@/components/action-review";
import FormField, { fieldErrorsFromInvalid, FormErrorSummary, FormFieldGroup, type FieldErrorLookup } from "@/components/form-field";
import { StateNotice } from "@/components/state-notice";
import StatusBadge from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { assertNever } from "@/lib/result";
import type { MutationInput, MutationOutcome, ReadAction, Scope, reads } from "@/modules/data-service";
import { ASSERTING_RESPONSE_KINDS, REQUEST_LIFECYCLE_COPY, RESPONSE_AGREEMENT_COPY, RESPONSE_KINDS, RESPONSE_KIND_COPY, type ResponseKind } from "../copy";
import { useRecordRequestResponse } from "../hooks/use-request-mutations";
import { recordRequestResponsePayloadSchemaFor, type RecordRequestResponsePayload } from "../schemas/response";
// The contract: the detail read's own Request row, so this surface states the fields the read
// supplied rather than restating the Request's shape.
type RequestRow = Extract<Awaited<ReturnType<typeof reads.outreach.readInitiative>>, { readonly kind: "envelope" }>["envelope"]["data"]["requests"]["items"][number];
type PresentationRow = NonNullable<RequestRow["presentation"]>;
type ResponseRow = NonNullable<RequestRow["response"]>;
/** The seven stored kinds keep their spelling in the read (`needs-clarification`) while this family names them for readers (`needs clarification`), so the stored word is joined to the family's own name for it before any wording is read. */
function responseKindOf(recorded: ResponseRow["kind"]): ResponseKind {
  return recorded === "needs-clarification" ? "needs clarification" : recorded;
}
const HEADING_TAG = { 3: "h3", 4: "h4" } as const;
/** The heading level this section renders at when the caller states none. */
type RequestResponseHeadingLevel = keyof typeof HEADING_TAG;
/** The level every child of this section renders at: one below its own heading, and never deeper than `h4`, which is the deepest heading the shared notice, form, summary and review patterns carry. */
const NESTED_HEADING_LEVEL = 4;
/** The three kinds that assert agreement, as the family declares them, read here as a membership test over the choice's own value. */
const ASSERTING_KINDS: ReadonlySet<string> = new Set(ASSERTING_RESPONSE_KINDS);
/** The option value that stands for "no answer chosen yet": the form holds strings, so the absence is stated once here and selects no option. */
const NO_KIND_VALUE = "";
const KIND_FIELD = "kind";
const RESPONDENT_FIELD = "respondentId";
const EVIDENCE_FIELD = "standingEvidence";
const VERSION_FIELD = "termsVersionRef";
const FIELD_ORDER = [KIND_FIELD, RESPONDENT_FIELD, EVIDENCE_FIELD, VERSION_FIELD] as const;
/** The field paths this change's payload carries, as the one field-error presentation reads them. */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  initiativeId: "Initiative",
  requestId: "Request",
  [KIND_FIELD]: "How this Request was answered",
  [RESPONDENT_FIELD]: "Named respondent",
  [EVIDENCE_FIELD]: "What stands behind this answer",
  [VERSION_FIELD]: "Terms version answered",
  // The service keys the same facts under `response`, so a refusal it returns lands on the field it
  // names as well as on the flat shape this form's own schema uses.
  "response.initiativeId": "Initiative",
  "response.requestId": "Request",
  "response.kind": "How this Request was answered",
  "response.respondentId": "Named respondent",
  "response.standingEvidence": "What stands behind this answer",
  "response.termsVersionRef": "Terms version answered",
};
/** The messages a refusal names for one field, whichever of the two shapes it keyed them under, so `invalid` lands on the field it names rather than on the summary alone. */
function messagesFor(errors: FieldErrorLookup | null, field: string): readonly string[] | undefined {
  return errors?.byField[field] ?? errors?.byField[`response.${field}`];
}
/** Wording this surface alone states. */
const RESPONSE_SURFACE_COPY = {
  heading: "Response",
  intro: "A recorded response is the named respondent's own answer to this Request. It binds to the terms version it answers, and earlier versions are kept.",
  lifecyclePrefix: "Request state",
  recipientLabel: "Recipient",
  recipientFactNote: "Who the ask was addressed to. The named respondent is a separate reference, never inferred from this person, an email address, a name or a job title.",
  representedLabel: "Represented organization",
  termsVersionAnsweredLabel: "Terms version answered",
  currentVersionLabel: "Current terms version",
  earlierVersionLabel: "Earlier terms version",
  versionFactNote: "This is the version that was presented, and the answer is bound to it. An answer written against any other version is refused before it leaves the browser, and the service re-checks the same rule against the presentation it stored.",
  kindLabel: "How this Request was answered",
  kindDescription: "Choose one of the seven recorded response kinds. None of them is a success: each states what the named respondent actually said.",
  respondentLabel: "Named respondent",
  respondentDescription: "The named respondent's own opaque reference. It is never inferred from, and never defaulted to, the person the ask was addressed to.",
  suppliedReferencesLabel: "Start from a reference this Request supplies:",
  suppliedRecipientAction: "Use the recipient's reference",
  suppliedOrganizationAction: "Use the represented organization's reference",
  evidenceLabel: "What stands behind this answer",
  evidenceRequiredDescription: "This kind asserts agreement, so describe what stands behind the answer. The family's schema decides which kinds require this, so nothing is restated here.",
  evidenceOptionalDescription: "Optional for this kind: an answer that asserts no agreement needs no evidence, and leaving it empty records that nothing was written down.",
  nothingWrittenDown: "Nothing was written down.",
  recordedAnswerLabel: "Recorded answer",
  recordedAtLabel: "Recorded at",
  recordedAtNote: "the instant the read supplied, stated exactly as recorded",
  respondentFactLabel: "Named respondent",
  evidenceFactLabel: "What stands behind this answer",
  answeredNoSecondAnswer: "This Request already carries the named respondent's answer, so no second answer is offered here. The recorded answer stands as that person's answer to this Request.",
  reviewLabel: "Review this answer",
  reviewTitle: "Review this recorded answer",
  confirmLabel: "Record this answer",
  backLabel: "Back to the details",
  refusalTitle: "An answer cannot be recorded here",
  unstatedRefusal: "This read does not state why the response action is unavailable, so no form is offered.",
  noPresentationTitle: "Nothing has been presented yet",
  noPresentationBody: "This Request has no recorded presentation, so there is no terms version to answer and no form is offered. Record how the ask reached the person first, and the answer can then be bound to that version.",
  requestLabel: "Request",
  ministryLabel: "Ministry",
} as const;
/** The boundaries stated where the answer is recorded, so none of them is only in Help. */
const AGREEMENT_STATEMENTS: readonly string[] = [RESPONSE_AGREEMENT_COPY.namedRespondentOneRequest, RESPONSE_AGREEMENT_COPY.bindsToTermsVersion, RESPONSE_AGREEMENT_COPY.unansweredIsNotDecline, RESPONSE_AGREEMENT_COPY.unansweredIsRecordedState, RESPONSE_AGREEMENT_COPY.withdrawalIsNotRefusal, "A recorded presentation is how the ask reached the person, not a send or a delivery, and recording an answer sends nothing."];
/** The two steps the recording half of this surface can be in. */
type ResponseStep = "form" | "review";
/** The values the form holds; the family's schema decides what may leave it. */
interface ResponseFormValues {
  kind: string;
  respondentId: string;
  standingEvidence: string;
}
/** The values this form collects, before the family's schema validates them. */
interface ResponseFormPayload {
  readonly initiativeId: string;
  readonly requestId: string;
  readonly kind: string;
  readonly respondentId: string;
  readonly standingEvidence: string | null;
  readonly termsVersionRef: string;
}
/** Props of {@link RequestResponseForm}. */
export interface RequestResponseFormProps {
  readonly initiativeId: string;
  /** The Request as the detail read supplied it: the presentation an answer binds to, the response already recorded, and its own revision. */
  readonly request: RequestRow;
  readonly scope: Scope;
  /** The revision the caller read. Omitted, the Request's own revision is what the caller means; a revision that has moved is refused as a conflict and the input kept. */
  readonly expectedRevision?: string;
  /** The read's advisory action for `recordRequestResponse`; when it is unavailable its reason stands in place of the form for a Request that has no answer yet. */
  readonly responseAction?: ReadAction;
  /** Called with the outcome once an attempt settles, except `invalid`, which returns to the form with the messages on its fields. */
  readonly onRecorded?: (outcome: MutationOutcome) => void;
  readonly headingLevel?: RequestResponseHeadingLevel;
  readonly className?: string;
}
/** A labelled fact, so this surface names each value it states rather than leaving one unlabelled beside another. */
function Fact({ term, children }: { readonly term: string; readonly children: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
/** One labelled row of the review, so the step names exactly what it will record. */
function ReviewFact({ label, children }: { readonly label: string; readonly children: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
/** The per-field messages a schema refusal carries, keyed exactly as the service's `invalid` outcome is keyed so the one shared mapping renders both without a second table of messages. */
function errorsOf(error: ZodError): FieldErrorLookup {
  const fields: Record<string, readonly string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.map((segment) => String(segment)).join(".");
    const messages = fields[path] ?? [];
    fields[path] = messages.includes(issue.message) ? messages : [...messages, issue.message];
  }
  return fieldErrorsFromInvalid({ fields });
}
/** The values a fresh answer starts from: no kind, no respondent and nothing written down. */
function defaultValuesFor(): ResponseFormValues {
  return { kind: NO_KIND_VALUE, respondentId: "", standingEvidence: "" };
}
/** Whether the chosen kind asserts agreement, and so needs the evidence the schema requires of it. */
function assertsAgreement(kind: string): boolean {
  return ASSERTING_KINDS.has(kind);
}
/** The family's wording for one recorded kind. All seven are named here, so a kind added to the tuple fails the build until this surface states its meaning, and none of them is worded as a success. */
function copyForKind(kind: ResponseKind): { readonly label: string; readonly description: string } {
  switch (kind) {
    case "agreed":
      return RESPONSE_KIND_COPY.agreed;
    case "conditional":
      return RESPONSE_KIND_COPY.conditional;
    case "partial":
      return RESPONSE_KIND_COPY.partial;
    case "deferred":
      return RESPONSE_KIND_COPY.deferred;
    case "declined":
      return RESPONSE_KIND_COPY.declined;
    case "unanswered":
      return RESPONSE_KIND_COPY.unanswered;
    case "needs clarification":
      return RESPONSE_KIND_COPY["needs clarification"];
    default:
      return assertNever(kind, "The response kinds name a kind this surface does not state.");
  }
}
/** Whether a chosen value is one of the seven recorded kinds, so a choice that is still unmade is never recorded as an answer. */
function isResponseKind(value: string): value is ResponseKind {
  return RESPONSE_KINDS.some((kind) => kind === value);
}
/** The payload the form asks the service to record, with the presented version and no field this surface did not collect. */
function payloadOf(initiativeId: string, requestId: string, presentedVersionRef: string, values: ResponseFormValues): ResponseFormPayload {
  const evidence = values.standingEvidence.trim();
  return { initiativeId, requestId, kind: values.kind, respondentId: values.respondentId, standingEvidence: evidence === "" ? null : values.standingEvidence, termsVersionRef: presentedVersionRef };
}
/** The Request's own facts beside the version an answer binds to: who the ask was addressed to, whether an organization was represented, and whether that version is still the current one. */
function RequestContext({ request, presentedVersionRef, citesCurrentVersion }: { readonly request: RequestRow; readonly presentedVersionRef: string; readonly citesCurrentVersion: boolean }): ReactElement {
  const recipientName = request.recipientDisplayName?.trim() ?? "";
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-muted/40 p-3 text-sm">
      <dl className="flex min-w-0 flex-col gap-1">
        <Fact term={RESPONSE_SURFACE_COPY.recipientLabel}>
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
            {recipientName === "" ? null : <bdi className="wrap-anywhere font-medium">{recipientName}</bdi>}
            <bdi className="mono-identifier wrap-anywhere">{request.recipientPartnerId}</bdi>
          </span>
        </Fact>
        {request.representedOrganizationId === null ? null : (
          <Fact term={RESPONSE_SURFACE_COPY.representedLabel}>
            <bdi className="mono-identifier wrap-anywhere">{request.representedOrganizationId}</bdi>
          </Fact>
        )}
        <Fact term={RESPONSE_SURFACE_COPY.termsVersionAnsweredLabel}>
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
            <bdi className="mono-identifier wrap-anywhere">{presentedVersionRef}</bdi>
            <StatusBadge label={citesCurrentVersion ? RESPONSE_SURFACE_COPY.currentVersionLabel : RESPONSE_SURFACE_COPY.earlierVersionLabel} tone={citesCurrentVersion ? "info" : "muted"} srPrefix={RESPONSE_SURFACE_COPY.termsVersionAnsweredLabel} />
          </span>
        </Fact>
      </dl>
      <p className="text-xs text-pretty text-muted-foreground">{RESPONSE_SURFACE_COPY.recipientFactNote}</p>
      <p className="text-xs text-pretty text-muted-foreground">{RESPONSE_SURFACE_COPY.versionFactNote}</p>
    </div>
  );
}
/** What will be recorded, in the worker's own values, before anything is sent. */
function ReviewSummary({ payload, request, scope }: { readonly payload: RecordRequestResponsePayload; readonly request: RequestRow; readonly scope: Scope }): ReactElement {
  const kindCopy = copyForKind(payload.kind);
  return (
    <dl className="flex min-w-0 flex-col gap-3 text-sm">
      <ReviewFact label={RESPONSE_SURFACE_COPY.kindLabel}>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="font-medium">{kindCopy.label}</span>
          <span className="text-pretty text-muted-foreground">{kindCopy.description}</span>
        </span>
      </ReviewFact>
      <ReviewFact label={RESPONSE_SURFACE_COPY.termsVersionAnsweredLabel}>
        <bdi className="mono-identifier wrap-anywhere">{payload.termsVersionRef}</bdi>
      </ReviewFact>
      <ReviewFact label={RESPONSE_SURFACE_COPY.respondentLabel}>
        <bdi className="mono-identifier wrap-anywhere">{payload.respondentId}</bdi>
      </ReviewFact>
      <ReviewFact label={RESPONSE_SURFACE_COPY.evidenceLabel}>{payload.standingEvidence === null ? <span className="text-muted-foreground">{RESPONSE_SURFACE_COPY.nothingWrittenDown}</span> : <span className="block whitespace-pre-wrap wrap-anywhere text-pretty">{payload.standingEvidence}</span>}</ReviewFact>
      <ReviewFact label={RESPONSE_SURFACE_COPY.requestLabel}>
        <bdi className="mono-identifier wrap-anywhere">{request.requestId}</bdi>
      </ReviewFact>
      <ReviewFact label={RESPONSE_SURFACE_COPY.ministryLabel}>
        <bdi className="mono-identifier wrap-anywhere">{scope.ministryId}</bdi>
      </ReviewFact>
    </dl>
  );
}
/** The answer this Request already carries, stated in full beside the version it binds to. */
function RecordedResponse({ response, request }: { readonly response: ResponseRow; readonly request: RequestRow }): ReactElement {
  const kindCopy = copyForKind(responseKindOf(response.kind));
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Fact term={RESPONSE_SURFACE_COPY.recordedAnswerLabel}>
          <span className="flex min-w-0 flex-wrap items-baseline gap-1.5">
            <StatusBadge label={kindCopy.label} tone="info" srPrefix={RESPONSE_SURFACE_COPY.recordedAnswerLabel} />
            <span className="min-w-0 text-xs text-pretty text-muted-foreground">{kindCopy.description}</span>
          </span>
        </Fact>
        <Fact term={RESPONSE_SURFACE_COPY.termsVersionAnsweredLabel}>
          <span className="flex min-w-0 flex-wrap items-baseline gap-1.5">
            <bdi className="mono-identifier wrap-anywhere">{response.termsVersionRef}</bdi>
            <StatusBadge label={response.answersCurrentVersion ? RESPONSE_SURFACE_COPY.currentVersionLabel : RESPONSE_SURFACE_COPY.earlierVersionLabel} tone={response.answersCurrentVersion ? "info" : "muted"} />
          </span>
        </Fact>
        <Fact term={RESPONSE_SURFACE_COPY.respondentFactLabel}>
          <bdi className="mono-identifier wrap-anywhere">{response.respondentId}</bdi>
        </Fact>
        <Fact term={RESPONSE_SURFACE_COPY.recordedAtLabel}>
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
            <bdi className="mono-identifier wrap-anywhere">{response.recordedAt}</bdi>
            <span className="text-xs text-muted-foreground">{`(${RESPONSE_SURFACE_COPY.recordedAtNote})`}</span>
          </span>
        </Fact>
        <Fact term={RESPONSE_SURFACE_COPY.evidenceFactLabel}>{response.standingEvidence === null || response.standingEvidence.trim() === "" ? <span className="text-muted-foreground">{RESPONSE_SURFACE_COPY.nothingWrittenDown}</span> : <span className="wrap-anywhere text-pretty">{response.standingEvidence}</span>}</Fact>
      </dl>
      {response.answersCurrentVersion ? null : (
        <p className="text-sm text-pretty">
          {"This answer responds to terms version "}
          <bdi className="mono-identifier wrap-anywhere">{response.termsVersionRef}</bdi>
          {" — earlier than the version this Request carries now, "}
          <bdi className="mono-identifier wrap-anywhere">{request.terms.version}</bdi>
          {". The answer stays bound to the version it answered, and that earlier version stays preserved."}
        </p>
      )}
    </div>
  );
}
/** The state an answered Request stands in: the one recorded answer, named as a recorded state rather than a result, and no second way to answer it. */
function AnsweredState({ request, response }: { readonly request: RequestRow; readonly response: ResponseRow }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-baseline gap-2">
        <StatusBadge label={REQUEST_LIFECYCLE_COPY.answered.label} tone="neutral" srPrefix={RESPONSE_SURFACE_COPY.lifecyclePrefix} />
        <span className="min-w-0 text-sm text-pretty text-muted-foreground">{REQUEST_LIFECYCLE_COPY.answered.description}</span>
      </div>
      <RecordedResponse request={request} response={response} />
      <p className="text-sm text-pretty text-muted-foreground">{RESPONSE_SURFACE_COPY.answeredNoSecondAnswer}</p>
    </div>
  );
}
/** The recording half: the answer's fields, the version it is bound to, the review step and its receipt. */
function ResponseEditor({ initiativeId, request, scope, expectedRevision, responseAction, onRecorded, presentedVersionRef, citesCurrentVersion }: { readonly initiativeId: string; readonly request: RequestRow; readonly scope: Scope; readonly expectedRevision: string; readonly responseAction: ReadAction | undefined; readonly onRecorded: ((outcome: MutationOutcome) => void) | undefined; readonly presentedVersionRef: string; readonly citesCurrentVersion: boolean }): ReactElement {
  // The read withholds this action while a presented Request waits for its first answer, so its reason
  // is stated in place of the form. A Request that already carries an answer never reaches this editor:
  // one Request is one independently answerable invitation, so no second answer is offered over one.
  const refusal = responseAction !== undefined && !responseAction.available ? (responseAction.reason?.trim() ?? RESPONSE_SURFACE_COPY.unstatedRefusal) : null;
  const form = useForm({ defaultValues: defaultValuesFor() });
  const record = useRecordRequestResponse(scope, presentedVersionRef);
  const dispatchRecord = record.submit;
  const [step, setStep] = useState<ResponseStep>("form");
  const [errors, setErrors] = useState<FieldErrorLookup | null>(null);
  const [reviewed, setReviewed] = useState<RecordRequestResponsePayload | null>(null);
  const optionIdPrefix = useId();
  const awaiting = useRef<{ readonly operationId: string; readonly resolve: (outcome: MutationOutcome) => void } | null>(null);
  const settledFromHook = record.state.status === "settled" ? record.state.outcome : null;
  // The family's hook reports its one settled outcome through its state rather than by returning a
  // promise, so this effect hands that outcome to the review step awaiting it. The attempt's identity
  // belongs to the review step, and only the same identity resolves this promise, so a late answer to
  // an earlier attempt cannot resolve a later one.
  useEffect(() => {
    const waiting = awaiting.current;
    if (settledFromHook === null || waiting === null || waiting.operationId !== settledFromHook.operationId) {
      return;
    }
    awaiting.current = null;
    waiting.resolve(settledFromHook);
  }, [settledFromHook]);
  /** The one way this surface submits: the review step's attempt identity, sent through the family's named mutation. */
  const submit = useCallback<MutationSubmit<RecordRequestResponsePayload>>(
    (input: MutationInput<RecordRequestResponsePayload>) =>
      new Promise<MutationOutcome>((resolve) => {
        // The review fences a second press while one request is in flight, so this holds at most the
        // attempt whose answer is outstanding.
        awaiting.current = { operationId: input.operationId, resolve };
        dispatchRecord({ operationId: input.operationId, expectedRevision: input.expectedRevision, payload: input.payload });
      }),
    [dispatchRecord],
  );
  const handleSettled = useCallback(
    (outcome: MutationOutcome): void => {
      if (outcome.outcome === "invalid") {
        // The messages belong on the fields they name, so the step returns to the form with every value
        // exactly as it was entered and nothing re-derived.
        setErrors(fieldErrorsFromInvalid(outcome));
        setStep("form");
        return;
      }
      setErrors(null);
      // A refusal the reviewer can still act on is not a recorded answer, so the caller is told about
      // every settled outcome and left to decide; the receipt below states what happened either way.
      onRecorded?.(outcome);
    },
    [onRecorded],
  );
  const reviewTheDetails = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const checked = recordRequestResponsePayloadSchemaFor(presentedVersionRef).safeParse(payloadOf(initiativeId, request.requestId, presentedVersionRef, form.state.values));
    if (!checked.success) {
      // A form the schema refuses never reaches the route and mints no attempt for itself.
      setErrors(errorsOf(checked.error));
      return;
    }
    setErrors(null);
    setReviewed(checked.data);
    setStep("review");
  };
  if (refusal !== null) {
    // A static explanation of why recording is not on offer, so `role="alert"` is left off and the
    // region announces nothing when it merely renders.
    return (
      <Alert role={undefined} className="px-3 py-2">
        <AlertTitle>{RESPONSE_SURFACE_COPY.refusalTitle}</AlertTitle>
        <AlertDescription>{refusal}</AlertDescription>
      </Alert>
    );
  }
  if (step === "review" && reviewed !== null) {
    return (
      <div className="flex min-w-0 flex-col gap-3">
        <Separator />
        <ActionReview<RecordRequestResponsePayload>
          title={RESPONSE_SURFACE_COPY.reviewTitle}
          description={<ReviewSummary payload={reviewed} request={request} scope={scope} />}
          confirmLabel={RESPONSE_SURFACE_COPY.confirmLabel}
          cancelLabel={RESPONSE_SURFACE_COPY.backLabel}
          onCancel={() => {
            setStep("form");
          }}
          input={{ scope, expectedRevision, payload: reviewed }}
          submit={submit}
          onSettled={handleSettled}
          fieldLabels={FIELD_LABELS}
          headingLevel={NESTED_HEADING_LEVEL}
        />
      </div>
    );
  }
  const chosenKind = isResponseKind(form.state.values.kind) ? form.state.values.kind : null;
  const chosenKindCopy = chosenKind === null ? null : copyForKind(chosenKind);
  const needsEvidence = chosenKind !== null && assertsAgreement(chosenKind);
  const kindDescription = chosenKindCopy === null ? RESPONSE_SURFACE_COPY.kindDescription : `${RESPONSE_SURFACE_COPY.kindDescription} ${chosenKindCopy.description}`;
  // The references this Request itself supplies. Choosing one writes it into the field the worker can
  // still correct, so the answer is never recorded against a reference nobody selected.
  const suppliedReferences: readonly { readonly reference: string; readonly action: string }[] = [{ reference: request.recipientPartnerId, action: RESPONSE_SURFACE_COPY.suppliedRecipientAction }, ...(request.representedOrganizationId === null ? [] : [{ reference: request.representedOrganizationId, action: RESPONSE_SURFACE_COPY.suppliedOrganizationAction }])];
  return (
    <form noValidate className="flex min-w-0 flex-col gap-4" onSubmit={reviewTheDetails}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-2">
        <StatusBadge label={REQUEST_LIFECYCLE_COPY.presented.label} tone="neutral" srPrefix={RESPONSE_SURFACE_COPY.lifecyclePrefix} />
        <span className="min-w-0 text-sm text-pretty text-muted-foreground">{REQUEST_LIFECYCLE_COPY.presented.description}</span>
      </div>
      <RequestContext request={request} presentedVersionRef={presentedVersionRef} citesCurrentVersion={citesCurrentVersion} />
      {errors === null || errors.count === 0 ? null : <FormErrorSummary errors={errors} labels={FIELD_LABELS} order={FIELD_ORDER} headingLevel={NESTED_HEADING_LEVEL} />}
      <FormFieldGroup legend={RESPONSE_SURFACE_COPY.kindLabel} name={KIND_FIELD} description={kindDescription} error={messagesFor(errors, KIND_FIELD)} required>
        {(group) => (
          <form.Field name={KIND_FIELD}>
            {(field) => (
              <RadioGroup value={field.state.value} onValueChange={(next) => {
                if (!isResponseKind(next)) {
                  return;
                }
                field.handleChange(next);
              }} aria-labelledby={group.legendId} aria-describedby={group.describedBy} aria-invalid={group.invalid ? true : undefined} aria-required={group.required ? true : undefined}>
                {RESPONSE_KINDS.map((kind, index) => {
                  const wording = copyForKind(kind);
                  const optionId = `${optionIdPrefix}-kind-${String(index)}`;
                  const meaningId = `${optionId}-meaning`;
                  return (
                    <label key={kind} htmlFor={optionId} className="flex min-h-target items-start gap-3 py-1">
                      <RadioGroupItem id={optionId} value={kind} aria-label={wording.label} aria-describedby={meaningId} className="mt-0.5" />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-sm font-medium text-pretty">{wording.label}</span>
                        <span id={meaningId} className="text-sm text-pretty text-muted-foreground">
                          {wording.description}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </RadioGroup>
            )}
          </form.Field>
        )}
      </FormFieldGroup>
      <form.Field name={RESPONDENT_FIELD}>
        {(field) => (
          <FormField name={RESPONDENT_FIELD} label={RESPONSE_SURFACE_COPY.respondentLabel} description={RESPONSE_SURFACE_COPY.respondentDescription} error={messagesFor(errors, RESPONDENT_FIELD)} required>
            {(control) => (
              <div className="flex min-w-0 flex-col gap-2">
                <Input
                  id={control.id}
                  name={RESPONDENT_FIELD}
                  type="text"
                  autoComplete="off"
                  required={control.required}
                  value={field.state.value}
                  aria-describedby={control.describedBy}
                  aria-invalid={control.invalid ? true : undefined}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                  onBlur={field.handleBlur}
                />
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="text-xs text-pretty text-muted-foreground">{RESPONSE_SURFACE_COPY.suppliedReferencesLabel}</span>
                  {suppliedReferences.map((supplied) => (
                    <Button
                      key={supplied.reference}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="max-w-full"
                      onClick={() => {
                        field.handleChange(supplied.reference);
                      }}
                    >
                      {supplied.action}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </FormField>
        )}
      </form.Field>
      <form.Field name={EVIDENCE_FIELD}>
        {(field) => (
          <FormField name={EVIDENCE_FIELD} label={RESPONSE_SURFACE_COPY.evidenceLabel} description={needsEvidence ? RESPONSE_SURFACE_COPY.evidenceRequiredDescription : RESPONSE_SURFACE_COPY.evidenceOptionalDescription} error={messagesFor(errors, EVIDENCE_FIELD)} required={needsEvidence} optionalHint={!needsEvidence}>
            {(control) => (
              <Textarea
                id={control.id}
                name={EVIDENCE_FIELD}
                rows={3}
                required={control.required}
                value={field.state.value}
                aria-describedby={control.describedBy}
                aria-invalid={control.invalid ? true : undefined}
                onChange={(event) => {
                  field.handleChange(event.target.value);
                }}
                onBlur={field.handleBlur}
              />
            )}
          </FormField>
        )}
      </form.Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit">{RESPONSE_SURFACE_COPY.reviewLabel}</Button>
      </div>
    </form>
  );
}

/** One Request's recorded answer in the state it stands in, or the reviewed recording of one bound to the version that was presented. */
export default function RequestResponseForm({ initiativeId, request, scope, expectedRevision, responseAction, onRecorded, headingLevel = 3, className }: RequestResponseFormProps): ReactElement {
  const headingId = useId();
  const Heading = HEADING_TAG[headingLevel];
  const presentation: PresentationRow | null = request.presentation;
  const response: ResponseRow | null = request.response;
  return (
    <section aria-labelledby={headingId} data-slot="request-response-form" data-state={response !== null ? "answered" : presentation === null ? "unpresented" : "awaiting"} className={cn("flex min-w-0 flex-col gap-4", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <Heading id={headingId} className="font-heading text-base font-medium text-pretty">
          {RESPONSE_SURFACE_COPY.heading}
        </Heading>
        <p className="text-sm text-pretty text-muted-foreground">{RESPONSE_SURFACE_COPY.intro}</p>
      </div>
      {/* The boundaries stay legible where the answer is recorded, not only in Help: agreement creates no
          pledge, gift, commitment, subscription, notification, send or task, and a staff withdrawal is not
          the supporter's refusal. This block states a fact rather than a change, so it announces nothing. */}
      <Alert role={undefined} className="px-3 py-2">
        <AlertTitle>{RESPONSE_AGREEMENT_COPY.agreementCreatesNothing}</AlertTitle>
        <AlertDescription>
          <ul className="flex min-w-0 list-disc flex-col gap-1 ps-4 text-pretty">
            {AGREEMENT_STATEMENTS.map((statement) => (
              <li key={statement}>{statement}</li>
            ))}
          </ul>
        </AlertDescription>
      </Alert>
      {response !== null ? (
        <AnsweredState request={request} response={response} />
      ) : presentation === null ? (
        <StateNotice kind="empty" title={RESPONSE_SURFACE_COPY.noPresentationTitle} description={RESPONSE_SURFACE_COPY.noPresentationBody} headingLevel={NESTED_HEADING_LEVEL} />
      ) : (
        <ResponseEditor initiativeId={initiativeId} request={request} scope={scope} expectedRevision={expectedRevision ?? request.revision} responseAction={responseAction} onRecorded={onRecorded} presentedVersionRef={presentation.versionRef} citesCurrentVersion={presentation.citesCurrentVersion} />
      )}
    </section>
  );
}
