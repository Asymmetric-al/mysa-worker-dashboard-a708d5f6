"use client";
/**
 * One Request's actual presentation — who the ask is for, what terms were asked, the version of those terms
 * the person was shown, the civil date it happened and the manner it was given in — and, beneath it, the
 * answer bound to the version that was presented.
 *
 * One Request is one independently answerable invitation. Presenting states how an ask reached somebody: it
 * is never a send, a delivery, a receipt or a claim that anything was read, and it creates no pledge, gift,
 * commitment, subscription, notification or send. An earlier presented version is an historical fact that is
 * kept as recorded, and a recorded answer binds to the version it answers rather than to whatever the terms
 * say now.
 */
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { useForm } from "@tanstack/react-form";
import type { ZodError } from "zod";
import ActionReview, { type MutationSubmit } from "@/components/action-review";
import FormField, { fieldErrorsFromInvalid, FormErrorSummary, type FieldErrorLookup } from "@/components/form-field";
import StatusBadge, { type StatusTone } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { assertNever } from "@/lib/result";
import type { MutationInput, MutationOutcome, ReadAction, Scope, ValueState, reads } from "@/modules/data-service";
// The amount is minted through the money module's own constructor, because the single formatter takes the
// exact minor-unit type it declares; no amount is ever built from a bare number in this surface.
import { minorUnitsOf } from "@/modules/money/amount";
import { formatMinor } from "@/modules/money/format";
import { PRESENTATION_COPY, REQUEST_LIFECYCLE_COPY, REQUESTED_TERMS_COPY, cadenceValueFallback, termValueFallback, type RequestLifecycleState } from "../copy";
import { usePresentRequest } from "../hooks/use-request-mutations";
import { presentRequestPayloadSchema, type PresentRequestPayload } from "../schemas/request";
// The answer below the record is the family's own surface: this file holds no second response form and no
// second answered state, and hands it the Request, the scope and the action the read admitted.
import RequestResponseForm from "./request-response-form";
// The contract: the initiative detail read's own envelope and Request row, so this surface states the fields
// the read supplied rather than restating the Request's shape.
type InitiativeDetailEnvelope = Extract<Awaited<ReturnType<typeof reads.outreach.readInitiative>>, { readonly kind: "envelope" }>["envelope"];
type RequestRow = InitiativeDetailEnvelope["data"]["requests"]["items"][number];
type PresentationRow = NonNullable<RequestRow["presentation"]>;
type RequestedMoney = NonNullable<RequestRow["terms"]["money"]>;
/** The interface locale amounts are grouped and pointed in when the composing page states none. */
const FALLBACK_LOCALE = "en-GB";
const HEADING_TAG = { 3: "h3", 4: "h4" } as const;
/** The heading level this section renders at when the caller states none. */
type RequestPresentationHeadingLevel = keyof typeof HEADING_TAG;
/** The level this section's own sub-headings render at: a child is never a peer of the section it belongs to. */
const NESTED_HEADING_LEVEL = 4;
const NestedHeading = HEADING_TAG[NESTED_HEADING_LEVEL];
/** The two actions this surface reads from the envelope, named as the read names them. */
const PRESENT_ACTION = "presentRequest";
const RESPOND_ACTION = "recordRequestResponse";
const PRESENTED_ON_FIELD = "presentedOn";
const MANNER_FIELD = "manner";
/** The manner the schema admits, as the field states it before the schema refuses anything longer. */
const MANNER_LIMIT = 200;
const FIELD_ORDER = [PRESENTED_ON_FIELD, MANNER_FIELD] as const;
/** The field paths this change's payload carries, as the one field-error presentation reads them. */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  initiativeId: "Initiative",
  requestId: "Request",
  [PRESENTED_ON_FIELD]: PRESENTATION_COPY.presentedOnLabel,
  [MANNER_FIELD]: PRESENTATION_COPY.mannerLabel,
};
/** Wording this surface alone states; the closed vocabularies it displays come from the family's copy. */
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
/** The two steps the recording half of this surface can be in. */
type PresentStep = "details" | "review";
/** The values the recording form holds; the family's schema decides what may leave it. */
interface PresentFormValues {
  presentedOn: string;
  manner: string;
}
/** Props of {@link RequestPresentation}. */
export interface RequestPresentationProps {
  /** The initiative this Request belongs to, carried into the payload as its own opaque reference. */
  readonly initiativeId: string;
  /** The Request as the detail read supplied it: its recorded presentation, its requested terms and its own revision. */
  readonly request: RequestRow;
  /** The initiative detail envelope: the scope the write runs under, the value states the read declared and the actions it admits. */
  readonly envelope: InitiativeDetailEnvelope;
  /** Called with every settled present outcome that was not a field refusal, so the caller can refresh the initiative. */
  readonly onRecorded?: (outcome: MutationOutcome) => void;
  /** Re-reads this initiative for an unconfirmed attempt: the receipt for an `unknown` outcome offers this and never a second presentation. */
  readonly onCheckResult?: () => void;
  /** The interface locale amounts are grouped and pointed in, as the composing page states it. */
  readonly locale?: string;
  /** The level of this section's heading, so the composing page keeps one outline. */
  readonly headingLevel?: RequestPresentationHeadingLevel;
  readonly className?: string;
}
/** A labelled fact, so this surface names each value it states rather than leaving one unlabelled beside another. */
function Fact({ term, children }: { readonly term: string; readonly children: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
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
/** A civil date as the read stated it, in the element that carries the same value to a machine: no `Date`, no midnight and no locale-dependent reformatting, so the day cannot move by a zone offset. */
function CivilDate({ value }: { readonly value: string }): ReactElement {
  return (
    <bdi>
      <time className="tabular-figures" dateTime={value}>
        {value}
      </time>
    </bdi>
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
/** The advisory action the read stated for one name; an entry it does not state leaves the action unjudged rather than refused. */
function actionOf(actions: readonly ReadAction[], name: string): ReadAction | undefined {
  return actions.find((action) => action.name === name);
}
/** The recipient as the read stated them: a name, or the state that says the name is withheld from this context. */
function RecipientFact({ request, valueStates }: { readonly request: RequestRow; readonly valueStates: Readonly<Record<string, ValueState>> }): ReactElement {
  // The read marks this path for every Request, so an unstated path is never read as a recorded name.
  const state: ValueState = valueStates[`${request.requestId}.recipientDisplayName`] ?? "unknown";
  const withheld = request.recipientDisplayName === null || state === "withheld";
  if (withheld) {
    return <StatusBadge label={SURFACE_COPY.recipientWithheld} valueState="withheld" srPrefix={SURFACE_COPY.recipientLabel} />;
  }
  return <bdi className="wrap-anywhere">{request.recipientDisplayName}</bdi>;
}
/** Who the ask is for and why: the recipient, the separately recorded represented organization, and the purpose. */
function IdentityFacts({ request, valueStates }: { readonly request: RequestRow; readonly valueStates: Readonly<Record<string, ValueState>> }): ReactElement {
  return (
    <>
      <Fact term={SURFACE_COPY.recipientLabel}>
        <RecipientFact request={request} valueStates={valueStates} />
      </Fact>
      {request.representedOrganizationId === null ? null : (
        <Fact term={SURFACE_COPY.representedLabel}>
          <bdi className="mono-identifier wrap-anywhere">{request.representedOrganizationId}</bdi>
        </Fact>
      )}
      <Fact term={SURFACE_COPY.purposeLabel}>
        <span className="text-pretty wrap-anywhere">{request.purpose}</span>
      </Fact>
    </>
  );
}
/** How the version a Request presented stands against the terms it carries now. */
type VersionRelation = "current" | "earlier";
type VersionStanding = { readonly label: string; readonly tone: StatusTone; readonly heading: string | null; readonly statement: string };
/** The word, tone, heading and statement of one version relation; a relation outside the two is reported rather than styled. */
function standingOf(relation: VersionRelation): VersionStanding {
  switch (relation) {
    case "current":
      return { label: SURFACE_COPY.currentVersionLabel, tone: "info", heading: null, statement: SURFACE_COPY.currentVersionStatement };
    case "earlier":
      return { label: SURFACE_COPY.earlierVersionLabel, tone: "caution", heading: SURFACE_COPY.earlierVersionHeading, statement: SURFACE_COPY.earlierVersionStatement };
    default:
      return assertNever(relation, "Unstated presentation version relation");
  }
}

/** The recorded presentation of one Request: the version it cites, the day it happened and the manner it was given in. */
function RecordedFacts({ request, presentation }: { readonly request: RequestRow; readonly presentation: PresentationRow }): ReactElement {
  const relation: VersionRelation = presentation.citesCurrentVersion ? "current" : "earlier";
  const standing = standingOf(relation);
  const lifecycle: RequestLifecycleState = request.response === null ? "presented" : "answered";
  const lifecycleCopy = REQUEST_LIFECYCLE_COPY[lifecycle];
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="flex min-w-0 flex-wrap items-baseline gap-2">
        <StatusBadge label={lifecycleCopy.label} tone={request.response === null ? "info" : "positive"} srPrefix="Request state" />
        <span className="min-w-0 text-xs text-pretty text-muted-foreground">{lifecycleCopy.description}</span>
      </p>
      <dl className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <Fact term={PRESENTATION_COPY.versionRefLabel}>
          <span className="flex min-w-0 flex-wrap items-baseline gap-1.5">
            <bdi className="mono-identifier wrap-anywhere">{presentation.versionRef}</bdi>
            <StatusBadge label={standing.label} tone={standing.tone} srPrefix={PRESENTATION_COPY.versionRefLabel} />
          </span>
        </Fact>
        <Fact term={PRESENTATION_COPY.presentedOnLabel}>
          <CivilDate value={presentation.presentedOn} />
        </Fact>
        <Fact term={PRESENTATION_COPY.mannerLabel}>
          <span className="text-pretty wrap-anywhere">{presentation.manner}</span>
        </Fact>
      </dl>
      <p className="text-xs text-pretty text-muted-foreground">{SURFACE_COPY.civilDateNote}</p>
      {standing.heading === null ? (
        <p className="text-sm text-pretty">{standing.statement}</p>
      ) : (
        // The terms have moved on since this presentation, so the version shown sits under its own heading: it
        // is subordinate to the current terms without being collapsed into them, and it keeps its own date.
        <div className="flex min-w-0 flex-col gap-1 border-s-2 border-border ps-3">
          <NestedHeading className="font-heading text-sm font-medium text-pretty">{standing.heading}</NestedHeading>
          <p className="text-sm text-pretty">{standing.statement}</p>
          <p className="text-xs text-pretty text-muted-foreground">{SURFACE_COPY.earlierVersionPreserved}</p>
        </div>
      )}
      <p className="text-xs text-pretty text-muted-foreground">{PRESENTATION_COPY.earlierVersionsNote}</p>
      <p className="text-xs text-pretty text-muted-foreground">{SURFACE_COPY.neverOverwritten}</p>
    </div>
  );
}
/** One requested amount, rendered by the single formatter from the state the read declared and the locale the page states. */
function RequestedAmount({ money, valueState, locale }: { readonly money: RequestedMoney; readonly valueState: ValueState; readonly locale: string }): ReactElement {
  if (!Number.isSafeInteger(money.minorUnits)) {
    // The read states a whole number of minor units; a figure the money module would refuse is never shown as
    // an amount, so the state's own word stands where a number nobody established would otherwise go.
    return <StatusBadge label={REQUESTED_TERMS_COPY.amountLabel} valueState="unknown" srPrefix={REQUESTED_TERMS_COPY.heading} />;
  }
  const { text, accessibleLabel } = formatMinor({ currency: money.currency, minorUnits: minorUnitsOf(money.minorUnits) }, valueState, locale);
  return (
    <span className="tabular-figures" title={accessibleLabel}>
      <bdi>{text}</bdi>
      {accessibleLabel === text ? null : <span className="sr-only">{accessibleLabel}</span>}
    </span>
  );
}
/** What the worker asked for: requested terms only, never received support, and never an amount beside a non-financial ask. */
function RequestedTerms({ request, valueStates, locale }: { readonly request: RequestRow; readonly valueStates: Readonly<Record<string, ValueState>>; readonly locale: string }): ReactElement {
  const terms = request.terms;
  const money = terms.money;
  // The amount's state is the read's own: this surface never decides that a figure is recorded, unknown,
  // withheld or unavailable, and an unstated path is never read as a recorded one.
  const moneyState: ValueState = valueStates[`${request.requestId}.terms.money`] ?? "unknown";
  return (
    <Card size="sm" className="min-w-0">
      <CardHeader>
        <CardTitle>{REQUESTED_TERMS_COPY.heading}</CardTitle>
        <CardDescription>{REQUESTED_TERMS_COPY.notReceivedSupport}</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <Fact term={REQUESTED_TERMS_COPY.versionLabel}>
            <bdi className="mono-identifier wrap-anywhere">{terms.version}</bdi>
          </Fact>
          {money === null ? (
            terms.nonFinancial === null ? (
              <Fact term={REQUESTED_TERMS_COPY.amountLabel}>
                <span className="text-muted-foreground">{REQUESTED_TERMS_COPY.notStated}</span>
              </Fact>
            ) : (
              // A non-financial ask states its description and no amount at all: no zero, no empty currency and
              // no dash that would read as one.
              <Fact term={REQUESTED_TERMS_COPY.nonFinancialLabel}>
                <span className="text-pretty wrap-anywhere">{terms.nonFinancial}</span>
              </Fact>
            )
          ) : (
            <>
              <Fact term={REQUESTED_TERMS_COPY.amountLabel}>
                <RequestedAmount money={money} valueState={moneyState} locale={locale} />
              </Fact>
              <Fact term={REQUESTED_TERMS_COPY.currencyLabel}>
                <bdi className="mono-identifier wrap-anywhere">{money.currency}</bdi>
              </Fact>
              {money.cadence === null ? null : (
                <Fact term={REQUESTED_TERMS_COPY.cadenceLabel}>
                  <span className="text-pretty wrap-anywhere">{cadenceValueFallback(money.cadence)}</span>
                </Fact>
              )}
              {money.term === null ? null : (
                <Fact term={REQUESTED_TERMS_COPY.termLabel}>
                  <span className="text-pretty wrap-anywhere">{termValueFallback(money.term)}</span>
                </Fact>
              )}
            </>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}
/** The values a fresh recording starts from: nothing is prefilled, because the date and the manner are facts the worker states. */
const EMPTY_PRESENT_VALUES: PresentFormValues = { presentedOn: "", manner: "" };
/** What will be recorded, in the worker's own values, before anything is sent. */
function ReviewSummary({ payload, request, scope, valueStates }: { readonly payload: PresentRequestPayload; readonly request: RequestRow; readonly scope: Scope; readonly valueStates: Readonly<Record<string, ValueState>> }): ReactElement {
  return (
    <dl className="flex min-w-0 flex-col gap-3 text-sm">
      <ReviewFact label={SURFACE_COPY.recipientLabel}>
        <RecipientFact request={request} valueStates={valueStates} />
      </ReviewFact>
      <ReviewFact label={PRESENTATION_COPY.versionRefLabel}>
        <bdi className="mono-identifier wrap-anywhere">{payload.versionRef}</bdi>
      </ReviewFact>
      <ReviewFact label={PRESENTATION_COPY.presentedOnLabel}>
        <span className="flex min-w-0 flex-wrap items-baseline gap-1">
          <CivilDate value={payload.presentedOn} />
          <span className="text-muted-foreground">{`(${SURFACE_COPY.civilDateNote})`}</span>
        </span>
      </ReviewFact>
      <ReviewFact label={PRESENTATION_COPY.mannerLabel}>
        <span className="block whitespace-pre-wrap wrap-anywhere text-pretty">{payload.manner}</span>
      </ReviewFact>
      <ReviewFact label={SURFACE_COPY.requestLabel}>
        <bdi className="mono-identifier wrap-anywhere">{request.requestId}</bdi>
      </ReviewFact>
      <ReviewFact label={SURFACE_COPY.ministryLabel}>
        <bdi className="mono-identifier wrap-anywhere">{scope.ministryId}</bdi>
      </ReviewFact>
    </dl>
  );
}
/** The recording of a presentation: one explicit control, a reviewed form of the two civil facts, and the read's own reason in place of the form when it does not admit the action. */
function PresentAction({ initiativeId, request, scope, valueStates, presentAction, onRecorded, onCheckResult }: { readonly initiativeId: string; readonly request: RequestRow; readonly scope: Scope; readonly valueStates: Readonly<Record<string, ValueState>>; readonly presentAction: ReadAction | undefined; readonly onRecorded: ((outcome: MutationOutcome) => void) | undefined; readonly onCheckResult: (() => void) | undefined }): ReactElement | null {
  const formId = useId();
  const form = useForm({ defaultValues: { ...EMPTY_PRESENT_VALUES } });
  const present = usePresentRequest(scope);
  const dispatchPresent = present.submit;
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<PresentStep>("details");
  const [errors, setErrors] = useState<FieldErrorLookup | null>(null);
  const [reviewed, setReviewed] = useState<PresentRequestPayload | null>(null);
  const [recordedNow, setRecordedNow] = useState(false);
  const awaiting = useRef<{ readonly operationId: string; readonly resolve: (outcome: MutationOutcome) => void } | null>(null);
  const settledFromHook = present.state.status === "settled" ? present.state.outcome : null;
  // The family's hook reports its one settled outcome through its state rather than by returning a promise, so
  // this effect hands that outcome to the review step awaiting it. The attempt's identity belongs to the review
  // step, which mints one `operationId` per intent, and only the same identity resolves this promise, so a late
  // answer to an earlier attempt cannot resolve a later one.
  useEffect(() => {
    const waiting = awaiting.current;
    if (settledFromHook === null || waiting === null || waiting.operationId !== settledFromHook.operationId) {
      return;
    }
    awaiting.current = null;
    waiting.resolve(settledFromHook);
  }, [settledFromHook]);
  /** The one way this surface submits: the review step's attempt identity, sent through the family's named mutation. */
  const submit = useCallback<MutationSubmit<PresentRequestPayload>>(
    (input: MutationInput<PresentRequestPayload>) =>
      new Promise<MutationOutcome>((resolve) => {
        // The review fences a second press while one request is in flight, so this holds at most the attempt
        // whose answer is outstanding.
        awaiting.current = { operationId: input.operationId, resolve };
        dispatchPresent({ operationId: input.operationId, expectedRevision: input.expectedRevision, payload: input.payload });
      }),
    [dispatchPresent],
  );
  const handleSettled = useCallback(
    (outcome: MutationOutcome): void => {
      if (outcome.outcome === "invalid") {
        // The messages belong on the fields they name, so the step returns to the form with every value exactly
        // as it was entered and nothing re-derived.
        setErrors(fieldErrorsFromInvalid(outcome));
        setStep("details");
        return;
      }
      setErrors(null);
      // An accepted, already-accepted or unchanged presentation leaves this Request presented even before the
      // caller's refresh arrives, so the control that records one is never offered a second time.
      if (outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unchanged") {
        setRecordedNow(true);
      }
      onRecorded?.(outcome);
    },
    [onRecorded],
  );
  const reviewTheDetails = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const checked = presentRequestPayloadSchema.safeParse({ initiativeId, requestId: request.requestId, presentedOn: form.state.values.presentedOn, manner: form.state.values.manner, versionRef: request.terms.version });
    if (!checked.success) {
      // A form the schema refuses never reaches the route and mints no attempt for itself.
      setErrors(errorsOf(checked.error));
      return;
    }
    setErrors(null);
    setReviewed(checked.data);
    setStep("review");
  };
  const closeReview = (): void => {
    setReviewed(null);
    setStep("details");
    setOpen(false);
  };
  const presented = request.presentation !== null || recordedNow;
  // The review step outlives the refresh a recorded presentation causes, so its receipt stays readable until
  // the worker returns to the record: the attempt's identity and its one outcome are this step's own.
  if (step === "review" && reviewed !== null) {
    return (
      <div className="flex min-w-0 flex-col gap-3">
        <Separator />
        <ActionReview<PresentRequestPayload>
          title={SURFACE_COPY.reviewTitle}
          description={<ReviewSummary payload={reviewed} request={request} scope={scope} valueStates={valueStates} />}
          confirmLabel={SURFACE_COPY.confirmLabel}
          cancelLabel={SURFACE_COPY.backLabel}
          onCancel={closeReview}
          input={{ scope, expectedRevision: request.revision, payload: reviewed }}
          submit={submit}
          checkResult={onCheckResult}
          onSettled={handleSettled}
          fieldLabels={FIELD_LABELS}
          headingLevel={NESTED_HEADING_LEVEL}
        />
      </div>
    );
  }
  // A Request that already carries a presentation never offers the action again, whatever the read admits.
  if (presented) {
    return null;
  }
  const refusal = presentAction !== undefined && !presentAction.available ? (presentAction.reason?.trim() ?? SURFACE_COPY.unstatedRefusal) : null;
  if (refusal !== null) {
    // A static explanation of why recording is not on offer, so `role="alert"` is left off and the region
    // announces nothing when it merely renders.
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
          <Button
            type="button"
            aria-expanded={open}
            aria-controls={open ? formId : undefined}
            onClick={() => {
              setOpen((current) => !current);
            }}
          >
            {SURFACE_COPY.presentLabel}
          </Button>
        </div>
        <p className="text-xs text-pretty text-muted-foreground">{SURFACE_COPY.presentHelp}</p>
      </div>
      {open ? (
        <form
          id={formId}
          noValidate
          className="flex min-w-0 flex-col gap-4"
          onSubmit={reviewTheDetails}
        >
          {errors === null || errors.count === 0 ? null : <FormErrorSummary errors={errors} labels={FIELD_LABELS} order={FIELD_ORDER} headingLevel={NESTED_HEADING_LEVEL} />}
          <form.Field name={PRESENTED_ON_FIELD}>
            {(field) => (
              <FormField
                name={PRESENTED_ON_FIELD}
                label={PRESENTATION_COPY.presentedOnLabel}
                description={SURFACE_COPY.presentedOnDescription}
                error={errors?.byField[PRESENTED_ON_FIELD]}
                required
              >
                {(control) => (
                  <Input
                    id={control.id}
                    name={PRESENTED_ON_FIELD}
                    type="date"
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
          <form.Field name={MANNER_FIELD}>
            {(field) => (
              <FormField
                name={MANNER_FIELD}
                label={PRESENTATION_COPY.mannerLabel}
                description={SURFACE_COPY.mannerDescription}
                error={errors?.byField[MANNER_FIELD]}
                required
              >
                {(control) => (
                  <Textarea
                    id={control.id}
                    name={MANNER_FIELD}
                    rows={2}
                    maxLength={MANNER_LIMIT}
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
          {/* The version is stated rather than entered: presenting records the terms this Request carries now, and
              a presentation of a different version is a different presentation. */}
          <dl className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Fact term={PRESENTATION_COPY.versionRefLabel}>
              <bdi className="mono-identifier wrap-anywhere">{request.terms.version}</bdi>
            </Fact>
          </dl>
          <p className="text-xs text-pretty text-muted-foreground">{SURFACE_COPY.versionRefReadOnly}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit">{SURFACE_COPY.reviewLabel}</Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
              }}
            >
              {SURFACE_COPY.cancelLabel}
            </Button>
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
        <Heading id={headingId} className="font-heading text-base font-medium text-pretty">
          {SURFACE_COPY.heading}
        </Heading>
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
      <PresentAction initiativeId={initiativeId} request={request} scope={envelope.scope} valueStates={envelope.valueStates} presentAction={actionOf(envelope.actions, PRESENT_ACTION)} onRecorded={onRecorded} onCheckResult={onCheckResult} />
      <RequestResponseForm
        initiativeId={initiativeId}
        request={request}
        scope={envelope.scope}
        expectedRevision={request.revision}
        responseAction={actionOf(envelope.actions, RESPOND_ACTION)}
        onRecorded={onRecorded}
        headingLevel={NESTED_HEADING_LEVEL}
      />
    </section>
  );
}

