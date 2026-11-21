"use client";
/** One Request's actual presentation: the terms version the person was shown, the civil date it happened and how it was given — the record AAP 0.8.3 requires beside the Request's own terms. **One arm … */
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { useForm } from "@tanstack/react-form";
import type { ZodError } from "zod";
import ActionReview, { type MutationSubmit } from "@/components/action-review";
import FormField, { fieldErrorsFromInvalid, FormErrorSummary, type FieldErrorLookup } from "@/components/form-field";
import StatusBadge from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import type { MutationInput, MutationOutcome, ReadAction, Scope, reads } from "@/modules/data-service";
import { PRESENTATION_COPY, REQUESTED_TERMS_COPY, REQUEST_LIFECYCLE_COPY } from "../copy";
import { usePresentRequest } from "../hooks/use-request-mutations";
import { presentRequestPayloadSchema, type PresentRequestPayload } from "../schemas/request";
// The contract: the detail read's own Request row, so this surface states the fields the read
// supplied rather than restating the Request's shape.
type RequestRow = Extract<Awaited<ReturnType<typeof reads.outreach.readInitiative>>, { readonly kind: "envelope" }>["envelope"]["data"]["requests"]["items"][number];
type PresentationRow = NonNullable<RequestRow["presentation"]>;
const HEADING_TAG = { 3: "h3", 4: "h4" } as const;
/** The heading level this section renders at when the caller states none. */
type RequestPresentationHeadingLevel = keyof typeof HEADING_TAG;
/** The level every child of this section renders at: one below its own heading, and never deeper than `h4`, which is the deepest heading the shared form, summary and review patterns carry (a section … */
const NESTED_HEADING_LEVEL = 4;
const PRESENTED_ON_FIELD = "presentedOn";
const MANNER_FIELD = "manner";
const VERSION_REF_FIELD = "versionRef";
const FIELD_ORDER = [PRESENTED_ON_FIELD, MANNER_FIELD, VERSION_REF_FIELD] as const;
/** The field paths this change's payload carries, as the one field-error presentation reads them. */
const FIELD_LABELS: Readonly<Record<string, string>> = { initiativeId: "Initiative", requestId: "Request", [PRESENTED_ON_FIELD]: PRESENTATION_COPY.presentedOnLabel, [MANNER_FIELD]: PRESENTATION_COPY.mannerLabel, [VERSION_REF_FIELD]: PRESENTATION_COPY.versionRefLabel };
/** Wording this surface alone states. */
const PRESENTATION_SURFACE_COPY = {
  heading: "Presentation",
  intro: "How this ask reached the person: the terms version they were shown, the day it happened and the manner it was given in. It is never a claim that anything was sent, delivered, opened or read.",
  currentVersionLabel: "Current terms version",
  earlierVersionLabel: "Earlier terms version",
  currentVersionStatement: "The version presented is the terms version this Request carries now, so an answer to it answers the current terms.",
  earlierVersionStatementTail: " — later than the version presented above. An answer binds to the version that was presented, and that earlier version stays preserved for the record.",
  civilDateNote: "A civil date, stated exactly as recorded: no time of day and no time zone is behind it.",
  neverOverwritten: "A recorded presentation is never overwritten. Recording a second, different presentation is refused on the terms version, because an answer binds to the version it was shown — so no recording control is offered once a presentation exists.",
  formBoundary: "This records how an ask reached the person. It is not a send, a delivery, a receipt or a claim that anything was read, and it creates no pledge, gift, commitment, subscription, notification or task.",
  presentedOnDescription: "The civil date the ask was presented, as YYYY-MM-DD.",
  mannerDescription: "How the ask reached the person, in your own words — up to 200 characters.",
  versionRefDescription: "Prefilled with the terms version this Request carries now. It is recorded exactly as you type it, so a presentation of an earlier version is stated by changing this value rather than assumed.",
  reviewLabel: "Review this presentation",
  reviewTitle: "Review this presentation",
  confirmLabel: "Record this presentation",
  backLabel: "Back to the details",
  unavailableTitle: "A presentation cannot be recorded here",
  unstatedRefusal: "This read does not state why the presentation action is unavailable, so no form is offered.",
  requestLabel: "Request",
  ministryLabel: "Ministry",
} as const;
/** The two steps the recording half of this surface can be in. */
type PresentationStep = "form" | "review";
/** The values the recording form holds; the family's schema decides what may leave it. */
interface PresentationFormValues {
  presentedOn: string;
  manner: string;
  versionRef: string;
}
/** Props of {@link RequestPresentation}. */
export interface RequestPresentationProps {
  readonly initiativeId: string;
  /** The Request as the detail read supplied it: the recorded presentation, the terms it carries and its own revision. */
  readonly request: RequestRow;
  readonly scope: Scope;
  /** The revision this presentation change targets: the Request's own `request.revision`, presented as `expectedRevision`. */
  readonly expectedRevision: string;
  /** The read's advisory action for `presentRequest`; when it is unavailable its reason stands in place of the form. */
  readonly presentAction?: ReadAction;
  readonly headingLevel?: RequestPresentationHeadingLevel;
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
/** The values a fresh recording starts from. */
function defaultValuesFor(request: RequestRow): PresentationFormValues {
  return { presentedOn: "", manner: "", versionRef: request.terms.version };
}
/** The payload the form asks the service to record, with no field this surface did not collect. */
function payloadOf(initiativeId: string, requestId: string, values: PresentationFormValues): PresentRequestPayload {
  return { initiativeId, requestId, presentedOn: values.presentedOn, manner: values.manner, versionRef: values.versionRef };
}
/** What will be recorded, in the worker's own values, before anything is sent. */
function ReviewSummary({ payload, request, scope }: { readonly payload: PresentRequestPayload; readonly request: RequestRow; readonly scope: Scope }): ReactElement {
  return (
    <dl className="flex min-w-0 flex-col gap-3 text-sm">
      <ReviewFact label={PRESENTATION_COPY.versionRefLabel}>
        <bdi className="mono-identifier wrap-anywhere">{payload.versionRef}</bdi>
      </ReviewFact>
      <ReviewFact label={PRESENTATION_COPY.presentedOnLabel}>
        <span className="flex min-w-0 flex-wrap items-baseline gap-1">
          <CivilDate value={payload.presentedOn} />
          <span className="text-muted-foreground">{`(${PRESENTATION_SURFACE_COPY.civilDateNote})`}</span>
        </span>
      </ReviewFact>
      <ReviewFact label={PRESENTATION_COPY.mannerLabel}>
        <span className="block whitespace-pre-wrap wrap-anywhere text-pretty">{payload.manner}</span>
      </ReviewFact>
      <ReviewFact label={PRESENTATION_SURFACE_COPY.requestLabel}>
        <bdi className="mono-identifier wrap-anywhere">{request.requestId}</bdi>
      </ReviewFact>
      <ReviewFact label={PRESENTATION_SURFACE_COPY.ministryLabel}>
        <bdi className="mono-identifier wrap-anywhere">{scope.ministryId}</bdi>
      </ReviewFact>
    </dl>
  );
}
/** The recorded presentation as this surface states it: what was shown, when, how, and which version it cites. */
function RecordedPresentation({ presentation, request }: { readonly presentation: PresentationRow; readonly request: RequestRow }): ReactElement {
  // The lifecycle word is derived, never chosen: a presentation with no recorded answer is the
  // family's `presented` state, and one with an answer is `answered`.
  const lifecycle = request.response === null ? "presented" : "answered";
  const lifecycleCopy = REQUEST_LIFECYCLE_COPY[lifecycle];
  const citesEarlierVersion = !presentation.citesCurrentVersion;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="flex min-w-0 flex-wrap items-baseline gap-2">
        <StatusBadge label={lifecycleCopy.label} tone="info" srPrefix="Request state" />
        <span className="min-w-0 text-xs text-pretty text-muted-foreground">{lifecycleCopy.description}</span>
      </p>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Fact term={PRESENTATION_COPY.versionRefLabel}>
          <span className="flex min-w-0 flex-wrap items-baseline gap-1.5">
            <bdi className="mono-identifier wrap-anywhere">{presentation.versionRef}</bdi>
            <StatusBadge label={presentation.citesCurrentVersion ? PRESENTATION_SURFACE_COPY.currentVersionLabel : PRESENTATION_SURFACE_COPY.earlierVersionLabel} tone={presentation.citesCurrentVersion ? "info" : "muted"} />
          </span>
        </Fact>
        <Fact term={PRESENTATION_COPY.presentedOnLabel}>
          <CivilDate value={presentation.presentedOn} />
        </Fact>
        <Fact term={PRESENTATION_COPY.mannerLabel}>
          <span className="wrap-anywhere">{presentation.manner}</span>
        </Fact>
        <Fact term={REQUESTED_TERMS_COPY.versionLabel}>
          <bdi className="mono-identifier wrap-anywhere">{request.terms.version}</bdi>
        </Fact>
      </dl>
      <p className="text-xs text-pretty text-muted-foreground">{PRESENTATION_SURFACE_COPY.civilDateNote}</p>
      {citesEarlierVersion ? (
        <p className="text-sm text-pretty">
          {"This Request now carries terms version "}
          <bdi className="mono-identifier wrap-anywhere">{request.terms.version}</bdi>
          {PRESENTATION_SURFACE_COPY.earlierVersionStatementTail}
        </p>
      ) : (
        <p className="text-sm text-pretty">{PRESENTATION_SURFACE_COPY.currentVersionStatement}</p>
      )}
      <p className="text-sm text-pretty text-muted-foreground">{PRESENTATION_COPY.earlierVersionsNote}</p>
      <p className="text-xs text-pretty text-muted-foreground">{PRESENTATION_SURFACE_COPY.neverOverwritten}</p>
    </div>
  );
}

/** One Request's recorded presentation, or the reviewed recording of one. */
export default function RequestPresentation({ initiativeId, request, scope, expectedRevision, presentAction, headingLevel = 3, className }: RequestPresentationProps): ReactElement {
  const headingId = useId();
  const Heading = HEADING_TAG[headingLevel];
  const presentation = request.presentation;
  // A read that says the action is unavailable is answered with the reason it states, rather than
  // with a form the service would refuse anyway. An absent entry is not a refusal, so it leaves the
  // form available.
  const refusal = presentAction !== undefined && !presentAction.available ? (presentAction.reason?.trim() ?? PRESENTATION_SURFACE_COPY.unstatedRefusal) : null;
  const form = useForm({ defaultValues: defaultValuesFor(request) });
  const present = usePresentRequest(scope);
  const dispatchPresent = present.submit;
  const [step, setStep] = useState<PresentationStep>("form");
  const [errors, setErrors] = useState<FieldErrorLookup | null>(null);
  const [reviewed, setReviewed] = useState<PresentRequestPayload | null>(null);
  const awaiting = useRef<{ readonly operationId: string; readonly resolve: (outcome: MutationOutcome) => void } | null>(null);
  const settledFromHook = present.state.status === "settled" ? present.state.outcome : null;
  // The family's hook reports its one settled outcome through its state rather than by returning a
  // promise, so this effect hands that outcome to the review step awaiting it. The attempt's identity
  // belongs to the review step, which mints one `operationId` per intent, and only the same identity
  // resolves this promise, so a late answer to an earlier attempt cannot resolve a later one.
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
        // The review fences a second press while one request is in flight, so this holds at most the
        // attempt whose answer is outstanding.
        awaiting.current = { operationId: input.operationId, resolve };
        dispatchPresent({ operationId: input.operationId, expectedRevision: input.expectedRevision, payload: input.payload });
      }),
    [dispatchPresent],
  );
  const handleSettled = useCallback((outcome: MutationOutcome): void => {
    if (outcome.outcome !== "invalid") {
      setErrors(null);
      return;
    }
    // The messages belong on the fields they name, so the step returns to the form with every value
    // exactly as it was entered and nothing re-derived.
    setErrors(fieldErrorsFromInvalid(outcome));
    setStep("form");
  }, []);
  const reviewTheDetails = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const checked = presentRequestPayloadSchema.safeParse(payloadOf(initiativeId, request.requestId, form.state.values));
    if (!checked.success) {
      // A form the schema refuses never reaches the route and mints no attempt for itself.
      setErrors(errorsOf(checked.error));
      return;
    }
    setErrors(null);
    setReviewed(checked.data);
    setStep("review");
  };
  return (
    <section aria-labelledby={headingId} data-slot="request-presentation" data-state={presentation === null ? "unrecorded" : "recorded"} className={cn("flex min-w-0 flex-col gap-4", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <Heading id={headingId} className="font-heading text-base font-medium text-pretty">
          {PRESENTATION_SURFACE_COPY.heading}
        </Heading>
        <p className="text-sm text-pretty text-muted-foreground">{PRESENTATION_SURFACE_COPY.intro}</p>
      </div>
      {presentation !== null ? (
        <RecordedPresentation presentation={presentation} request={request} />
      ) : refusal !== null ? (
        // A static explanation of why recording is not on offer, so `role="alert"` is left off and
        // the region announces nothing when it merely renders.
        <Alert role={undefined} className="px-3 py-2">
          <AlertTitle>{PRESENTATION_SURFACE_COPY.unavailableTitle}</AlertTitle>
          <AlertDescription>{refusal}</AlertDescription>
        </Alert>
      ) : step === "review" && reviewed !== null ? (
        <div className="flex min-w-0 flex-col gap-3">
          <Separator />
          <ActionReview<PresentRequestPayload>
            title={PRESENTATION_SURFACE_COPY.reviewTitle}
            description={<ReviewSummary payload={reviewed} request={request} scope={scope} />}
            confirmLabel={PRESENTATION_SURFACE_COPY.confirmLabel}
            cancelLabel={PRESENTATION_SURFACE_COPY.backLabel}
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
      ) : (
        <form noValidate className="flex min-w-0 flex-col gap-4" onSubmit={reviewTheDetails}>
          <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <p className="text-pretty">{PRESENTATION_SURFACE_COPY.formBoundary}</p>
          </div>
          {errors === null || errors.count === 0 ? null : <FormErrorSummary errors={errors} labels={FIELD_LABELS} order={FIELD_ORDER} headingLevel={NESTED_HEADING_LEVEL} />}
          <form.Field name={PRESENTED_ON_FIELD}>
            {(field) => (
              <FormField name={PRESENTED_ON_FIELD} label={PRESENTATION_COPY.presentedOnLabel} description={PRESENTATION_SURFACE_COPY.presentedOnDescription} error={errors?.byField[PRESENTED_ON_FIELD]} required>
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
              <FormField name={MANNER_FIELD} label={PRESENTATION_COPY.mannerLabel} description={PRESENTATION_SURFACE_COPY.mannerDescription} error={errors?.byField[MANNER_FIELD]} required>
                {(control) => (
                  <Textarea
                    id={control.id}
                    name={MANNER_FIELD}
                    rows={2}
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
          <form.Field name={VERSION_REF_FIELD}>
            {(field) => (
              <FormField name={VERSION_REF_FIELD} label={PRESENTATION_COPY.versionRefLabel} description={PRESENTATION_SURFACE_COPY.versionRefDescription} error={errors?.byField[VERSION_REF_FIELD]} required>
                {(control) => (
                  <Input
                    id={control.id}
                    name={VERSION_REF_FIELD}
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
                )}
              </FormField>
            )}
          </form.Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit">{PRESENTATION_SURFACE_COPY.reviewLabel}</Button>
          </div>
        </form>
      )}
    </section>
  );
}
