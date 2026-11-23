"use client";
import { useCallback, useId, useState, type FormEvent, type ReactElement } from "react";
import { useForm } from "@tanstack/react-form";
import ActionReview from "@/components/action-review";
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
import type { MutationOutcome, ReadAction, Scope, reads } from "@/modules/data-service";
import { ASSERTING_RESPONSE_KINDS, REQUEST_LIFECYCLE_COPY, RESPONSE_AGREEMENT_COPY, RESPONSE_KINDS, RESPONSE_KIND_COPY, type ResponseKind } from "../copy";
import { useAttemptSubmit } from "../hooks/use-initiative-mutations";
import { valuePropsOf } from "./form-controls";
import { useRecordRequestResponse } from "../hooks/use-request-mutations";
import { recordRequestResponsePayloadSchemaFor, type RecordRequestResponsePayload } from "../schemas/response";
import { errorsOf, FactList, ReviewFact, TermFact, type FactEntry } from "./figures";
type RequestRow = Extract<Awaited<ReturnType<typeof reads.outreach.readInitiative>>, { readonly kind: "envelope" }>["envelope"]["data"]["requests"]["items"][number];
type PresentationRow = NonNullable<RequestRow["presentation"]>;
type ResponseRow = NonNullable<RequestRow["response"]>;
const responseKindOf = (recorded: ResponseRow["kind"]): ResponseKind => (recorded === "needs-clarification" ? "needs clarification" : recorded);
const HEADING_TAG = { 3: "h3", 4: "h4" } as const;
type RequestResponseHeadingLevel = keyof typeof HEADING_TAG;
const HEADING_SCALE: Readonly<Record<RequestResponseHeadingLevel, string>> = { 3: "type-subsection-title", 4: "type-group-title" };
const NESTED_HEADING_LEVEL = 4;
const ASSERTING_KINDS: ReadonlySet<string> = new Set(ASSERTING_RESPONSE_KINDS);
const NO_KIND_VALUE = "";
const KIND_FIELD = "kind";
const RESPONDENT_FIELD = "respondentId";
const EVIDENCE_FIELD = "standingEvidence";
const VERSION_FIELD = "termsVersionRef";
const FIELD_ORDER = [KIND_FIELD, RESPONDENT_FIELD, EVIDENCE_FIELD, VERSION_FIELD] as const;
const RESPONSE_FIELD_LABELS: Readonly<Record<string, string>> = { initiativeId: "Initiative", requestId: "Request", [KIND_FIELD]: "How this Request was answered", [RESPONDENT_FIELD]: "Named respondent", [EVIDENCE_FIELD]: "What stands behind this answer", [VERSION_FIELD]: "Terms version answered" };
const FIELD_LABELS: Readonly<Record<string, string>> = { ...RESPONSE_FIELD_LABELS, ...Object.fromEntries(Object.entries(RESPONSE_FIELD_LABELS).map(([name, label]) => [`response.${name}`, label])) };
const messagesFor = (errors: FieldErrorLookup | null, field: string): readonly string[] | undefined => errors?.byField[field] ?? errors?.byField[`response.${field}`];
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
const AGREEMENT_STATEMENTS: readonly string[] = [
  RESPONSE_AGREEMENT_COPY.namedRespondentOneRequest,
  RESPONSE_AGREEMENT_COPY.bindsToTermsVersion,
  RESPONSE_AGREEMENT_COPY.unansweredIsNotDecline,
  RESPONSE_AGREEMENT_COPY.unansweredIsRecordedState,
  RESPONSE_AGREEMENT_COPY.withdrawalIsNotRefusal,
  "A recorded presentation is how the ask reached the person, not a send or a delivery, and recording an answer sends nothing.",
];
type ResponseStep = "form" | "review";
type ResponseFormValues = { kind: string; respondentId: string; standingEvidence: string };
type ResponseFormPayload = { readonly initiativeId: string; readonly requestId: string; readonly kind: string; readonly respondentId: string; readonly standingEvidence: string | null; readonly termsVersionRef: string };
/** Props of {@link RequestResponseForm}. */
export interface RequestResponseFormProps {
  readonly initiativeId: string;
  readonly request: RequestRow;
  readonly scope: Scope;
  readonly expectedRevision?: string;
  readonly responseAction?: ReadAction;
  readonly onRecorded?: (outcome: MutationOutcome) => void;
  readonly headingLevel?: RequestResponseHeadingLevel;
  readonly className?: string;
}
const defaultValuesFor = (): ResponseFormValues => ({ kind: NO_KIND_VALUE, respondentId: "", standingEvidence: "" });
const copyForKind = (kind: ResponseKind): { readonly label: string; readonly description: string } => RESPONSE_KIND_COPY[kind];
const isResponseKind = (value: string): value is ResponseKind => RESPONSE_KINDS.some((kind) => kind === value);
function payloadOf(initiativeId: string, requestId: string, presentedVersionRef: string, values: ResponseFormValues): ResponseFormPayload {
  const evidence = values.standingEvidence.trim();
  return { initiativeId, requestId, kind: values.kind, respondentId: values.respondentId, standingEvidence: evidence === "" ? null : values.standingEvidence, termsVersionRef: presentedVersionRef };
}
function RequestContext({ request, presentedVersionRef, citesCurrentVersion }: { readonly request: RequestRow; readonly presentedVersionRef: string; readonly citesCurrentVersion: boolean }): ReactElement {
  const recipientName = request.recipientDisplayName?.trim() ?? "";
  const facts: readonly FactEntry[] = [
    {
      term: RESPONSE_SURFACE_COPY.recipientLabel,
      value: (
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
          {recipientName === "" ? null : <bdi className="wrap-anywhere font-medium">{recipientName}</bdi>}
          <bdi className="mono-identifier wrap-anywhere">{request.recipientPartnerId}</bdi>
        </span>
      ),
    },
    ...(request.representedOrganizationId === null ? [] : [{ term: RESPONSE_SURFACE_COPY.representedLabel, value: <bdi className="mono-identifier wrap-anywhere">{request.representedOrganizationId}</bdi> }]),
    {
      term: RESPONSE_SURFACE_COPY.termsVersionAnsweredLabel,
      value: (
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
          <bdi className="mono-identifier wrap-anywhere">{presentedVersionRef}</bdi>
          <StatusBadge label={citesCurrentVersion ? RESPONSE_SURFACE_COPY.currentVersionLabel : RESPONSE_SURFACE_COPY.earlierVersionLabel} tone={citesCurrentVersion ? "info" : "muted"} srPrefix={RESPONSE_SURFACE_COPY.termsVersionAnsweredLabel} />
        </span>
      ),
    },
  ];
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-muted/40 p-3 text-sm">
      <FactList className="flex min-w-0 flex-col gap-1" rows={facts} row={(fact) => <TermFact key={fact.term} term={fact.term} value={fact.value} />} />
      <p className="text-xs text-pretty text-muted-foreground">{RESPONSE_SURFACE_COPY.recipientFactNote}</p>
      <p className="text-xs text-pretty text-muted-foreground">{RESPONSE_SURFACE_COPY.versionFactNote}</p>
    </div>
  );
}
function ReviewSummary({ payload, request, scope }: { readonly payload: RecordRequestResponsePayload; readonly request: RequestRow; readonly scope: Scope }): ReactElement {
  const kindCopy = copyForKind(payload.kind);
  const facts: readonly FactEntry[] = [
    {
      term: RESPONSE_SURFACE_COPY.kindLabel,
      value: (
        <span className="flex min-w-0 flex-col gap-1">
          <span className="font-medium">{kindCopy.label}</span> <span className="text-pretty text-muted-foreground">{kindCopy.description}</span>
        </span>
      ),
    },
    { term: RESPONSE_SURFACE_COPY.termsVersionAnsweredLabel, value: <bdi className="mono-identifier wrap-anywhere">{payload.termsVersionRef}</bdi> },
    { term: RESPONSE_SURFACE_COPY.respondentLabel, value: <bdi className="mono-identifier wrap-anywhere">{payload.respondentId}</bdi> },
    { term: RESPONSE_SURFACE_COPY.evidenceLabel, value: payload.standingEvidence === null ? <span className="text-muted-foreground">{RESPONSE_SURFACE_COPY.nothingWrittenDown}</span> : <span className="block whitespace-pre-wrap wrap-anywhere text-pretty">{payload.standingEvidence}</span> },
    { term: RESPONSE_SURFACE_COPY.requestLabel, value: <bdi className="mono-identifier wrap-anywhere">{request.requestId}</bdi> },
    { term: RESPONSE_SURFACE_COPY.ministryLabel, value: <bdi className="mono-identifier wrap-anywhere">{scope.ministryId}</bdi> },
  ];
  return <FactList className="flex min-w-0 flex-col gap-3 text-sm" rows={facts} row={(fact) => <ReviewFact key={fact.term} label={fact.term} value={fact.value} />} />;
}
function RecordedResponse({ response, request }: { readonly response: ResponseRow; readonly request: RequestRow }): ReactElement {
  const kindCopy = copyForKind(responseKindOf(response.kind));
  const facts: readonly FactEntry[] = [
    {
      term: RESPONSE_SURFACE_COPY.recordedAnswerLabel,
      value: (
        <span className="flex min-w-0 flex-wrap items-baseline gap-1.5">
          <StatusBadge label={kindCopy.label} tone="info" srPrefix={RESPONSE_SURFACE_COPY.recordedAnswerLabel} />
          <span className="min-w-0 text-xs text-pretty text-muted-foreground">{kindCopy.description}</span>
        </span>
      ),
    },
    {
      term: RESPONSE_SURFACE_COPY.termsVersionAnsweredLabel,
      value: (
        <span className="flex min-w-0 flex-wrap items-baseline gap-1.5">
          <bdi className="mono-identifier wrap-anywhere">{response.termsVersionRef}</bdi>
          <StatusBadge label={response.answersCurrentVersion ? RESPONSE_SURFACE_COPY.currentVersionLabel : RESPONSE_SURFACE_COPY.earlierVersionLabel} tone={response.answersCurrentVersion ? "info" : "muted"} />
        </span>
      ),
    },
    { term: RESPONSE_SURFACE_COPY.respondentFactLabel, value: <bdi className="mono-identifier wrap-anywhere">{response.respondentId}</bdi> },
    {
      term: RESPONSE_SURFACE_COPY.recordedAtLabel,
      value: (
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
          <bdi className="mono-identifier wrap-anywhere">{response.recordedAt}</bdi>
          <span className="text-xs text-muted-foreground">{`(${RESPONSE_SURFACE_COPY.recordedAtNote})`}</span>
        </span>
      ),
    },
    { term: RESPONSE_SURFACE_COPY.evidenceFactLabel, value: response.standingEvidence === null || response.standingEvidence.trim() === "" ? <span className="text-muted-foreground">{RESPONSE_SURFACE_COPY.nothingWrittenDown}</span> : <span className="wrap-anywhere text-pretty">{response.standingEvidence}</span> },
  ];
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <FactList className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2" rows={facts} row={(fact) => <TermFact key={fact.term} term={fact.term} value={fact.value} />} />
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
const AnsweredState = ({ request, response }: { readonly request: RequestRow; readonly response: ResponseRow }): ReactElement => (
  <div className="flex min-w-0 flex-col gap-3">
    <div className="flex min-w-0 flex-wrap items-baseline gap-2">
      <StatusBadge label={REQUEST_LIFECYCLE_COPY.answered.label} tone="neutral" srPrefix={RESPONSE_SURFACE_COPY.lifecyclePrefix} />
      <span className="min-w-0 text-sm text-pretty text-muted-foreground">{REQUEST_LIFECYCLE_COPY.answered.description}</span>
    </div>
    <RecordedResponse request={request} response={response} />
    <p className="text-sm text-pretty text-muted-foreground">{RESPONSE_SURFACE_COPY.answeredNoSecondAnswer}</p>
  </div>
);
type ResponseEditorProps = {
  readonly initiativeId: string;
  readonly request: RequestRow;
  readonly scope: Scope;
  readonly expectedRevision: string;
  readonly responseAction: ReadAction | undefined;
  readonly onRecorded: ((outcome: MutationOutcome) => void) | undefined;
  readonly presentedVersionRef: string;
  readonly citesCurrentVersion: boolean;
};
function ResponseEditor({ initiativeId, request, scope, expectedRevision, responseAction, onRecorded, presentedVersionRef, citesCurrentVersion }: ResponseEditorProps): ReactElement {
  const refusal = responseAction !== undefined && !responseAction.available ? (responseAction.reason?.trim() ?? RESPONSE_SURFACE_COPY.unstatedRefusal) : null;
  const form = useForm({ defaultValues: defaultValuesFor() });
  const record = useRecordRequestResponse(scope, presentedVersionRef);
  const submit = useAttemptSubmit(record);
  const [step, setStep] = useState<ResponseStep>("form");
  const [errors, setErrors] = useState<FieldErrorLookup | null>(null);
  const [reviewed, setReviewed] = useState<RecordRequestResponsePayload | null>(null);
  const optionIdPrefix = useId();
  const handleSettled = useCallback(
    (outcome: MutationOutcome): void => {
      if (outcome.outcome === "invalid") {
        setErrors(fieldErrorsFromInvalid(outcome));
        setStep("form");
        return;
      }
      setErrors(null);
      onRecorded?.(outcome);
    },
    [onRecorded],
  );
  const reviewTheDetails = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const checked = recordRequestResponsePayloadSchemaFor(presentedVersionRef).safeParse(payloadOf(initiativeId, request.requestId, presentedVersionRef, form.state.values));
    if (!checked.success) {
      setErrors(errorsOf(checked.error));
      return;
    }
    setErrors(null);
    setReviewed(checked.data);
    setStep("review");
  };
  if (refusal !== null) {
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
          onCancel={() => setStep("form")}
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
  const needsEvidence = chosenKind !== null && ASSERTING_KINDS.has(chosenKind);
  const kindDescription = chosenKindCopy === null ? RESPONSE_SURFACE_COPY.kindDescription : `${RESPONSE_SURFACE_COPY.kindDescription} ${chosenKindCopy.description}`;
  const suppliedReferences: readonly { readonly reference: string; readonly action: string }[] = [
    { reference: request.recipientPartnerId, action: RESPONSE_SURFACE_COPY.suppliedRecipientAction },
    ...(request.representedOrganizationId === null ? [] : [{ reference: request.representedOrganizationId, action: RESPONSE_SURFACE_COPY.suppliedOrganizationAction }]),
  ];
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
              <RadioGroup
                value={field.state.value}
                onValueChange={(next) => {
                  if (!isResponseKind(next)) return;
                  field.handleChange(next);
                }}
                aria-labelledby={group.legendId}
                aria-describedby={group.describedBy}
                aria-invalid={group.invalid ? true : undefined}
                aria-required={group.required ? true : undefined}
              >
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
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                />
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="text-xs text-pretty text-muted-foreground">{RESPONSE_SURFACE_COPY.suppliedReferencesLabel}</span>
                  {suppliedReferences.map((supplied) => (
                    <Button key={supplied.reference} type="button" variant="outline" size="sm" className="max-w-full" onClick={() => field.handleChange(supplied.reference)}>
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
            {(control) => <Textarea {...valuePropsOf(field, control)} name={EVIDENCE_FIELD} rows={3} required={control.required} />}
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
        <Heading id={headingId} className={cn(HEADING_SCALE[headingLevel], "text-pretty")}>
          {RESPONSE_SURFACE_COPY.heading}
        </Heading>
        <p className="text-sm text-pretty text-muted-foreground">{RESPONSE_SURFACE_COPY.intro}</p>
      </div>
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
