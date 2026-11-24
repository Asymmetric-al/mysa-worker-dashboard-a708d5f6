"use client";
import { useCallback, useId, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { useForm } from "@tanstack/react-form";
import ActionReview from "@/components/action-review";
import FormField, { civilDateConvention, fieldErrorsFromInvalid, FormErrorSummary, type FieldErrorLookup } from "@/components/form-field";
import StatusBadge, { type StatusTone } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import type { MutationOutcome, ReadAction, Scope, ValueState, reads } from "@/modules/data-service";
import { minorUnitsOf } from "@/modules/money/amount";
import { formatMinor } from "@/modules/money/format";
import { PRESENTATION_COPY, REQUEST_LIFECYCLE_COPY, REQUESTED_TERMS_COPY, cadenceValueFallback, termValueFallback } from "../copy";
import { useAttemptSubmit } from "../hooks/use-initiative-mutations";
import { valuePropsOf } from "./form-controls";
import { usePresentRequest } from "../hooks/use-request-mutations";
import { presentRequestPayloadSchema, type PresentRequestPayload } from "../schemas/request";
import RequestResponseForm from "./request-response-form";
import { errorsOf, FactList, ReviewFact, StatedInstant, TermFact } from "./figures";
type InitiativeDetailEnvelope = Extract<Awaited<ReturnType<typeof reads.outreach.readInitiative>>, { readonly kind: "envelope" }>["envelope"];
type RequestRow = InitiativeDetailEnvelope["data"]["requests"]["items"][number];
const HEADING_TAG = { 3: "h3", 4: "h4" } as const;
type RequestPresentationHeadingLevel = keyof typeof HEADING_TAG;
const HEADING_SCALE: Readonly<Record<RequestPresentationHeadingLevel, string>> = { 3: "type-subsection-title", 4: "type-group-title" };
const NESTED_HEADING_LEVEL = 4;
const FALLBACK_LOCALE = "en-GB";
const NestedHeading = HEADING_TAG[NESTED_HEADING_LEVEL];
const PRESENTED_ON_FIELD = "presentedOn";
const MANNER_FIELD = "manner";
const FIELD_ORDER = [PRESENTED_ON_FIELD, MANNER_FIELD] as const;
const FIELD_LABELS: Readonly<Record<string, string>> = { initiativeId: "Initiative", requestId: "Request", [PRESENTED_ON_FIELD]: PRESENTATION_COPY.presentedOnLabel, [MANNER_FIELD]: PRESENTATION_COPY.mannerLabel };
const SURFACE_COPY = {
  heading: "Presentation",
  intro: "How this ask reached the person: the terms version they were shown, the day it happened and the manner it was given in. It is never a claim that anything was sent, delivered, opened or read.",
  invitationBoundary: "One Request is one independently answerable invitation, and the answer it carries binds to the version that was presented.",
  recipientLabel: "Recipient",
  recipientWithheld: "Not shown",
  recipientNote: "The person the ask was addressed to. A name, an address or a job title never establishes who this is.",
  representedLabel: "Represented organization",
  representedNote: "A separate reference, stated only when the ask was made on an organization's behalf: it is never inferred from the recipient, a household or a job title.",
  purposeLabel: "Purpose",
  unpresentedTitle: "No presentation recorded yet",
  unpresentedBody: "This Request is drafted and has not reached the respondent through this record. Presenting it records the day, the manner and the terms version shown.",
  civilDateNote: "A civil date, stated exactly as recorded: no time of day and no time zone is behind it.",
  currentVersionLabel: "Current terms version",
  currentVersionStatement: "The version presented is the terms version this Request carries now, so an answer to it answers the current terms.",
  earlierVersionLabel: "Earlier terms version",
  earlierVersionHeading: "Earlier version",
  earlierVersionStatement: "The version presented is earlier than the terms this Request carries now. An answer binds to the version that was presented, so that earlier version is kept rather than replaced.",
  earlierVersionPreserved: "An earlier presentation is an historical fact: it is stated with its own date and manner, and it is never overwritten.",
  neverOverwritten: "A recorded presentation is never overwritten, so no recording control is offered once one exists.",
  formBoundary: "This records how an ask reached the person. It is not a send, a delivery, a receipt or a claim that anything was read, and it creates no pledge, gift, commitment, subscription, notification or send.",
  presentLabel: "Record this presentation",
  presentHelp: "Records the day, the manner and the terms version this Request carries now.",
  presentedOnDescription: "The civil date the ask was presented, as YYYY-MM-DD.",
  mannerDescription: "How the ask reached the person, in your own words — up to 200 characters.",
  versionRefReadOnly: "The terms version this presentation records is the version this Request carries now, so an answer to it answers the current terms. It is stated here rather than entered, because a presentation of a different version is a different presentation.",
  reviewLabel: "Review this presentation",
  reviewTitle: "Review this presentation",
  confirmLabel: "Record this presentation",
  backLabel: "Back to the details",
  cancelLabel: "Cancel",
  unavailableTitle: "A presentation cannot be recorded here",
  unstatedRefusal: "This read does not state why the presentation action is unavailable, so no form is offered.",
  requestLabel: "Request",
  ministryLabel: "Ministry",
} as const;
type PresentStep = "details" | "review";
/** Props of {@link RequestPresentation}. */ export interface RequestPresentationProps {
  readonly initiativeId: string;
  readonly request: RequestRow;
  readonly envelope: InitiativeDetailEnvelope;
  readonly onRecorded?: (outcome: MutationOutcome) => void;
  readonly onCheckResult?: () => void;
  readonly locale?: string;
  readonly headingLevel?: RequestPresentationHeadingLevel;
  readonly className?: string;
}
const actionOf = (actions: readonly ReadAction[], name: string): ReadAction | undefined => actions.find((action) => action.name === name);
function RecipientFact({ request, valueStates }: { readonly request: RequestRow; readonly valueStates: Readonly<Record<string, ValueState>> }): ReactElement {
  const state: ValueState = valueStates[`${request.requestId}.recipientDisplayName`] ?? "unknown";
  return request.recipientDisplayName === null || state === "withheld" ? <StatusBadge label={SURFACE_COPY.recipientWithheld} valueState="withheld" srPrefix={SURFACE_COPY.recipientLabel} /> : <bdi className="wrap-anywhere">{request.recipientDisplayName}</bdi>;
}
const IdentityFacts = ({ request, valueStates }: { readonly request: RequestRow; readonly valueStates: Readonly<Record<string, ValueState>> }): ReactElement => {
  const facts: ReadonlyArray<{ readonly term: string; readonly value: ReactNode }> = [
    { term: SURFACE_COPY.recipientLabel, value: <RecipientFact request={request} valueStates={valueStates} /> },
    ...(request.representedOrganizationId === null ? [] : [{ term: SURFACE_COPY.representedLabel, value: <bdi className="mono-identifier wrap-anywhere">{request.representedOrganizationId}</bdi> }]),
    { term: SURFACE_COPY.purposeLabel, value: <span className="text-pretty wrap-anywhere">{request.purpose}</span> },
  ];
  return (
    <>
      {facts.map((fact) => (
        <TermFact key={fact.term} term={fact.term} value={fact.value} />
      ))}
    </>
  );
};
type VersionRelation = "current" | "earlier";
type VersionStanding = { readonly label: string; readonly tone: StatusTone; readonly heading: string | null; readonly statement: string };
const VERSION_STANDING: Readonly<Record<VersionRelation, VersionStanding>> = {
  current: { label: SURFACE_COPY.currentVersionLabel, tone: "info", heading: null, statement: SURFACE_COPY.currentVersionStatement },
  earlier: { label: SURFACE_COPY.earlierVersionLabel, tone: "caution", heading: SURFACE_COPY.earlierVersionHeading, statement: SURFACE_COPY.earlierVersionStatement },
};
function RecordedFacts({ request, presentation }: { readonly request: RequestRow; readonly presentation: NonNullable<RequestRow["presentation"]> }): ReactElement {
  const standing = VERSION_STANDING[presentation.citesCurrentVersion ? "current" : "earlier"];
  const lifecycleCopy = REQUEST_LIFECYCLE_COPY[request.response === null ? "presented" : "answered"];
  const facts: ReadonlyArray<{ readonly term: string; readonly value: ReactNode }> = [
    {
      term: PRESENTATION_COPY.versionRefLabel,
      value: (
        <span className="flex min-w-0 flex-wrap items-baseline gap-1.5">
          <bdi className="mono-identifier wrap-anywhere">{presentation.versionRef}</bdi>
          <StatusBadge label={standing.label} tone={standing.tone} srPrefix={PRESENTATION_COPY.versionRefLabel} />
        </span>
      ),
    },
    { term: PRESENTATION_COPY.presentedOnLabel, value: <StatedInstant value={presentation.presentedOn} /> },
    { term: PRESENTATION_COPY.mannerLabel, value: <span className="text-pretty wrap-anywhere">{presentation.manner}</span> },
  ];
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="flex min-w-0 flex-wrap items-baseline gap-2">
        <StatusBadge label={lifecycleCopy.label} tone={request.response === null ? "info" : "positive"} srPrefix="Request state" />
        <span className="min-w-0 text-xs text-pretty text-muted-foreground">{lifecycleCopy.description}</span>
      </p>
      <FactList className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2" rows={facts} row={(fact) => <TermFact key={fact.term} term={fact.term} value={fact.value} />} />
      <p className="text-xs text-pretty text-muted-foreground">{SURFACE_COPY.civilDateNote}</p>
      {standing.heading === null ? (
        <p className="text-sm text-pretty">{standing.statement}</p>
      ) : (
        <div className="flex min-w-0 flex-col gap-1 border-s-2 border-border ps-3">
          <NestedHeading className={cn(HEADING_SCALE[NESTED_HEADING_LEVEL], "text-pretty")}>{standing.heading}</NestedHeading>
          <p className="text-sm text-pretty">{standing.statement}</p>
          <p className="text-xs text-pretty text-muted-foreground">{SURFACE_COPY.earlierVersionPreserved}</p>
        </div>
      )}
      <p className="text-xs text-pretty text-muted-foreground">{PRESENTATION_COPY.earlierVersionsNote}</p>
      <p className="text-xs text-pretty text-muted-foreground">{SURFACE_COPY.neverOverwritten}</p>
    </div>
  );
}
function RequestedAmount({ money, valueState, locale }: { readonly money: NonNullable<RequestRow["terms"]["money"]>; readonly valueState: ValueState; readonly locale: string }): ReactElement {
  if (!Number.isSafeInteger(money.minorUnits)) return <StatusBadge label={REQUESTED_TERMS_COPY.amountLabel} valueState="unknown" srPrefix={REQUESTED_TERMS_COPY.heading} />;
  const { text, accessibleLabel } = formatMinor({ currency: money.currency, minorUnits: minorUnitsOf(money.minorUnits) }, valueState, locale);
  return (
    <span className="tabular-figures" title={accessibleLabel}>
      <bdi>{text}</bdi>
      {accessibleLabel === text ? null : <span className="sr-only">{accessibleLabel}</span>}
    </span>
  );
}
function RequestedTerms({ request, valueStates, locale }: { readonly request: RequestRow; readonly valueStates: Readonly<Record<string, ValueState>>; readonly locale: string }): ReactElement {
  const terms = request.terms;
  const money = terms.money;
  const facts: ReadonlyArray<{ readonly term: string; readonly value: ReactNode }> = [
    { term: REQUESTED_TERMS_COPY.versionLabel, value: <bdi className="mono-identifier wrap-anywhere">{terms.version}</bdi> },
    ...(money === null
      ? [terms.nonFinancial === null ? { term: REQUESTED_TERMS_COPY.amountLabel, value: <span className="text-muted-foreground">{REQUESTED_TERMS_COPY.notStated}</span> } : { term: REQUESTED_TERMS_COPY.nonFinancialLabel, value: <span className="text-pretty wrap-anywhere">{terms.nonFinancial}</span> }]
      : [
          { term: REQUESTED_TERMS_COPY.amountLabel, value: <RequestedAmount money={money} valueState={valueStates[`${request.requestId}.terms.money`] ?? "unknown"} locale={locale} /> },
          { term: REQUESTED_TERMS_COPY.currencyLabel, value: <bdi className="mono-identifier wrap-anywhere">{money.currency}</bdi> },
          ...(money.cadence === null ? [] : [{ term: REQUESTED_TERMS_COPY.cadenceLabel, value: <span className="text-pretty wrap-anywhere">{cadenceValueFallback(money.cadence)}</span> }]),
          ...(money.term === null ? [] : [{ term: REQUESTED_TERMS_COPY.termLabel, value: <span className="text-pretty wrap-anywhere">{termValueFallback(money.term)}</span> }]),
        ]),
  ];
  return (
    <Card size="sm" className="min-w-0">
      <CardHeader>
        <CardTitle>{REQUESTED_TERMS_COPY.heading}</CardTitle>
        <CardDescription>{REQUESTED_TERMS_COPY.notReceivedSupport}</CardDescription>
      </CardHeader>
      <CardContent>
        <FactList className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2" rows={facts} row={(fact) => <TermFact key={fact.term} term={fact.term} value={fact.value} />} />
      </CardContent>
    </Card>
  );
}
const EMPTY_PRESENT_VALUES: { presentedOn: string; manner: string } = { presentedOn: "", manner: "" };
const ReviewSummary = ({ payload, request, scope, valueStates }: { readonly payload: PresentRequestPayload; readonly request: RequestRow; readonly scope: Scope; readonly valueStates: Readonly<Record<string, ValueState>> }): ReactElement => (
  <dl className="flex min-w-0 flex-col gap-3 text-sm">
    <ReviewFact term={SURFACE_COPY.recipientLabel} value={<RecipientFact request={request} valueStates={valueStates} />} />
    <ReviewFact term={PRESENTATION_COPY.versionRefLabel} value={<bdi className="mono-identifier wrap-anywhere">{payload.versionRef}</bdi>} />
    <ReviewFact
      term={PRESENTATION_COPY.presentedOnLabel}
      value={
        <span className="flex min-w-0 flex-wrap items-baseline gap-1">
          {" "}
          <StatedInstant value={payload.presentedOn} /> <span className="text-muted-foreground">{`(${SURFACE_COPY.civilDateNote})`}</span>{" "}
        </span>
      }
    />
    <ReviewFact term={PRESENTATION_COPY.mannerLabel} value={<span className="block whitespace-pre-wrap wrap-anywhere text-pretty">{payload.manner}</span>} />
    <ReviewFact term={SURFACE_COPY.requestLabel} value={<bdi className="mono-identifier wrap-anywhere">{request.requestId}</bdi>} />
    <ReviewFact term={SURFACE_COPY.ministryLabel} value={<bdi className="mono-identifier wrap-anywhere">{scope.ministryId}</bdi>} />
  </dl>
);
type PresentActionProps = {
  readonly initiativeId: string;
  readonly request: RequestRow;
  readonly scope: Scope;
  readonly valueStates: Readonly<Record<string, ValueState>>;
  readonly presentAction: ReadAction | undefined;
  readonly onRecorded: ((outcome: MutationOutcome) => void) | undefined;
  readonly onCheckResult: (() => void) | undefined;
};
function PresentAction({ initiativeId, request, scope, valueStates, presentAction, onRecorded, onCheckResult }: PresentActionProps): ReactElement | null {
  const formId = useId();
  const form = useForm({ defaultValues: { ...EMPTY_PRESENT_VALUES } });
  const present = usePresentRequest(scope);
  const submit = useAttemptSubmit(present);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<PresentStep>("details");
  const [errors, setErrors] = useState<FieldErrorLookup | null>(null);
  // The reviewed intent is held exactly as it was reviewed. Recording advances the Request's revision, and a revision read live here would restate the attempt's own identity after the fact, discarding the result the attempt already earned.
  const [reviewed, setReviewed] = useState<{ readonly scope: Scope; readonly expectedRevision: string; readonly payload: PresentRequestPayload } | null>(null);
  const [recordedNow, setRecordedNow] = useState(false);
  const handleSettled = useCallback(
    (outcome: MutationOutcome): void => {
      if (outcome.outcome === "invalid") {
        setErrors(fieldErrorsFromInvalid(outcome));
        setStep("details");
        return;
      }
      setErrors(null);
      if (outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unchanged") setRecordedNow(true);
      onRecorded?.(outcome);
    },
    [onRecorded],
  );
  const reviewTheDetails = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const checked = presentRequestPayloadSchema.safeParse({ initiativeId, requestId: request.requestId, presentedOn: form.state.values.presentedOn, manner: form.state.values.manner, versionRef: request.terms.version });
    if (!checked.success) {
      setErrors(errorsOf(checked.error));
      return;
    }
    setErrors(null);
    setReviewed({ scope, expectedRevision: request.revision, payload: checked.data });
    setStep("review");
  };
  const closeReview = (): void => {
    setReviewed(null);
    setStep("details");
    setOpen(false);
  };
  const presented = request.presentation !== null || recordedNow;
  // A recorded presentation is never overwritten, so this step stays open only for the presentation it recorded itself. The read can state that presentation before this step's own answer arrives, so the step is judged by what it recorded rather than by the order the two answers arrive in; a Request that records a presentation this step did not record offers no recording control.
  const recordedHere = reviewed !== null && request.presentation !== null && request.presentation.presentedOn === reviewed.payload.presentedOn && request.presentation.manner === reviewed.payload.manner && request.presentation.versionRef === reviewed.payload.versionRef;
  if (step === "review" && reviewed !== null && (request.presentation === null || recordedHere)) {
    return (
      <div className="flex min-w-0 flex-col gap-3">
        <Separator />
        <ActionReview<PresentRequestPayload>
          title={SURFACE_COPY.reviewTitle}
          description={<ReviewSummary payload={reviewed.payload} request={request} scope={scope} valueStates={valueStates} />}
          confirmLabel={SURFACE_COPY.confirmLabel}
          cancelLabel={SURFACE_COPY.backLabel}
          onCancel={closeReview}
          input={reviewed}
          submit={submit}
          checkResult={onCheckResult}
          onSettled={handleSettled}
          fieldLabels={FIELD_LABELS}
          headingLevel={NESTED_HEADING_LEVEL}
        />
      </div>
    );
  }
  if (presented) return null;
  const refusal = presentAction !== undefined && !presentAction.available ? (presentAction.reason?.trim() ?? SURFACE_COPY.unstatedRefusal) : null;
  if (refusal !== null) {
    return (
      <Alert role={undefined} className="px-3 py-2">
        <AlertTitle>{SURFACE_COPY.unavailableTitle}</AlertTitle>
        <AlertDescription>{refusal}</AlertDescription>
      </Alert>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-sm text-pretty text-muted-foreground">{SURFACE_COPY.formBoundary}</p>
      <div className="flex min-w-0 flex-col gap-1">
        <div>
          <Button {...{ type: "button", "aria-expanded": open, "aria-controls": open ? formId : undefined, onClick: () => setOpen((current) => !current) }}>{SURFACE_COPY.presentLabel}</Button>
        </div>
        <p className="text-xs text-pretty text-muted-foreground">{SURFACE_COPY.presentHelp}</p>
      </div>
      {open ? (
        <form id={formId} noValidate className="flex min-w-0 flex-col gap-4" onSubmit={reviewTheDetails}>
          {errors === null || errors.count === 0 ? null : <FormErrorSummary errors={errors} labels={FIELD_LABELS} order={FIELD_ORDER} headingLevel={NESTED_HEADING_LEVEL} />}
          <form.Field name={PRESENTED_ON_FIELD}>
            {(field) => (
              <FormField name={PRESENTED_ON_FIELD} label={PRESENTATION_COPY.presentedOnLabel} description={`${SURFACE_COPY.presentedOnDescription} ${civilDateConvention(field.state.value)}`} error={errors?.byField[PRESENTED_ON_FIELD]} required>
                {(control) => <Input {...valuePropsOf(field, control)} name={PRESENTED_ON_FIELD} type="date" required={control.required} />}
              </FormField>
            )}
          </form.Field>
          <form.Field name={MANNER_FIELD}>
            {(field) => (
              <FormField name={MANNER_FIELD} label={PRESENTATION_COPY.mannerLabel} description={SURFACE_COPY.mannerDescription} error={errors?.byField[MANNER_FIELD]} required>
                {(control) => <Textarea {...valuePropsOf(field, control)} name={MANNER_FIELD} rows={2} maxLength={200} required={control.required} />}
              </FormField>
            )}
          </form.Field>
          <dl className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <TermFact term={PRESENTATION_COPY.versionRefLabel} value={<bdi className="mono-identifier wrap-anywhere">{request.terms.version}</bdi>} />
          </dl>
          <p className="text-xs text-pretty text-muted-foreground">{SURFACE_COPY.versionRefReadOnly}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit">{SURFACE_COPY.reviewLabel}</Button>
            <Button {...{ type: "button", variant: "outline", onClick: () => setOpen(false) }}>{SURFACE_COPY.cancelLabel}</Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
/** One Request's recorded presentation, the terms it asks for, the reviewed recording of one, and the answer bound to the version that was presented. */
export default function RequestPresentation({ initiativeId, request, envelope, onRecorded, onCheckResult, locale = FALLBACK_LOCALE, headingLevel = 3, className }: RequestPresentationProps): ReactElement {
  const headingId = useId();
  const Heading = HEADING_TAG[headingLevel];
  const presentation = request.presentation;
  return (
    <section aria-labelledby={headingId} data-slot="request-presentation" data-state={presentation === null ? "unpresented" : "presented"} className={cn("flex min-w-0 flex-col gap-4", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <Heading {...{ id: headingId, className: cn(HEADING_SCALE[headingLevel], "text-pretty") }}>{SURFACE_COPY.heading}</Heading>
        <p className="text-sm text-pretty text-muted-foreground">{SURFACE_COPY.intro}</p>
        <p className="text-xs text-pretty text-muted-foreground">{SURFACE_COPY.invitationBoundary}</p>
      </div>
      <dl className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <IdentityFacts request={request} valueStates={envelope.valueStates} />
      </dl>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-xs text-pretty text-muted-foreground">{SURFACE_COPY.recipientNote}</p>
        {request.representedOrganizationId === null ? null : <p className="text-xs text-pretty text-muted-foreground">{SURFACE_COPY.representedNote}</p>}
      </div>
      {presentation === null ? (
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-medium text-pretty">{SURFACE_COPY.unpresentedTitle}</p>
          <p className="text-sm text-pretty text-muted-foreground">{SURFACE_COPY.unpresentedBody}</p>
        </div>
      ) : (
        <RecordedFacts request={request} presentation={presentation} />
      )}
      <RequestedTerms request={request} valueStates={envelope.valueStates} locale={locale} />
      <PresentAction initiativeId={initiativeId} request={request} scope={envelope.scope} valueStates={envelope.valueStates} presentAction={actionOf(envelope.actions, "presentRequest")} onRecorded={onRecorded} onCheckResult={onCheckResult} />
      <RequestResponseForm initiativeId={initiativeId} request={request} scope={envelope.scope} expectedRevision={request.revision} responseAction={actionOf(envelope.actions, "recordRequestResponse")} onRecorded={onRecorded} headingLevel={NESTED_HEADING_LEVEL} />
    </section>
  );
}
