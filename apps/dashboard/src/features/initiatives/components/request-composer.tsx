"use client";
/** The surface that drafts a Request: one independently answerable invitation inside an initiative, naming who is asked, the organization that person represents, why, and the terms version the ask … */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { useForm } from "@tanstack/react-form";
import type { ZodError } from "zod";
import ActionReview from "@/components/action-review";
import FormField, { fieldErrorsFromInvalid, FormErrorSummary, FormFieldGroup, type FieldErrorLookup } from "@/components/form-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { assertNever } from "@/lib/result";
import type { MutationInput, MutationOutcome, Scope, ValueState, reads } from "@/modules/data-service";
import { minorUnitsOf } from "@/modules/money/amount";
import { formatMinor, type MinorFormatting } from "@/modules/money/format";
import { cadenceValueFallback, INITIATIVE_COPY, REQUEST_LIFECYCLE_COPY, REQUEST_LIFECYCLE_STATES, REQUESTED_TERMS_COPY, RESPONSE_AGREEMENT_COPY, termValueFallback } from "../copy";
import { useDraftRequest } from "../hooks/use-request-mutations";
import { draftRequestPayloadSchema, type DraftRequestPayload } from "../schemas/request";
/** The contract: the initiative detail read's own envelope, so this section states the scope, the revision, the actions and the working list it was handed rather than restating the detail's shape. */
type InitiativeDetailEnvelope = Extract<Awaited<ReturnType<typeof reads.outreach.readInitiative>>, { readonly kind: "envelope" }>["envelope"];
/** One row of the reviewed working list, as the envelope supplies it. */
type WorkingListMember = InitiativeDetailEnvelope["data"]["workingList"]["items"][number];
/** The terms a request may carry: an amount in one currency, or an ask with no amount at all. */
const TERMS_SHAPES = ["financial", "non-financial"] as const;

type TermsShape = (typeof TERMS_SHAPES)[number];
/** The heading levels this section renders at, so a caller nests it under its own outline. */
const HEADING_TAG = { 3: "h3", 4: "h4" } as const;
/** The level the sub-headings inside this section render at: a step or a summary is never a peer of the section it belongs to. */
const CHILD_HEADING_LEVEL = 4;
/** Props of {@link RequestComposer}. */
export interface RequestComposerProps {
  /** The initiative this Request belongs to, carried into the payload as its own opaque reference. */
  readonly initiativeId: string;
  /** The initiative detail envelope: the scope the write runs under, the revision it must present, the actions it admits and the working list that names eligible recipients. */
  readonly envelope: InitiativeDetailEnvelope;
  /** Called once the draft stands, so the caller can refresh what it shows of this initiative's Requests. */
  readonly onDrafted?: (outcome: MutationOutcome) => void;
  /** Re-reads this initiative for an unconfirmed attempt: the receipt for an `unknown` outcome offers this and never a second draft. */
  readonly onCheckResult?: () => void;
  /** The interface locale amounts are grouped and pointed in, as the composing page states it. */
  readonly locale?: string;
  /** The level of this section's heading, so the composing page keeps one outline. */
  readonly headingLevel?: 3 | 4;
  readonly className?: string;
}
// Field paths, stated once: they are the payload's own issue paths, so a message the service raised and
// one this form's own payload check raised land on the same control and read the same label.
const RECIPIENT_FIELD = "recipientPartnerId";
const REPRESENTED_FIELD = "representedOrganizationId";
const PURPOSE_FIELD = "purpose";
const VERSION_FIELD = "terms.version";
const TERMS_FIELD = "terms";
/** The path the schema refuses the terms shape on, when neither an amount nor a non-financial ask was stated. */
const TERMS_GAP_FIELD = "terms.nonFinancial";
const CURRENCY_FIELD = "terms.currency";
const AMOUNT_FIELD = "terms.minorUnits";
const CADENCE_FIELD = "terms.cadence";
const TERM_FIELD = "terms.term";
const NON_FINANCIAL_FIELD = "terms.nonFinancial.description";
const FIELD_ORDER = [RECIPIENT_FIELD, REPRESENTED_FIELD, PURPOSE_FIELD, VERSION_FIELD, CURRENCY_FIELD, AMOUNT_FIELD, CADENCE_FIELD, TERM_FIELD, NON_FINANCIAL_FIELD] as const;
/** The one named mutation this surface drives, as the read's actions list it. */
const DRAFT_REQUEST = "draftRequest";
/** The locale an amount is formatted in when the composing page states none, matching the interface locale this release's pages pass explicitly, so no amount is grouped or pointed by the runtime's own default. */
const FALLBACK_LOCALE = "en-GB";
/**
 * The state a reviewed amount carries. It is the figure the worker stated for this attempt, and no
 * envelope describes an attempt the service has not recorded yet: `value` is what the attempt asserts.
 * A currency whose minor-unit exponent is unknown is expressed by the formatter itself, whose rendering
 * states that no exponent, total or comparison exists — never by a state this surface picks for it.
 */
const STATED_AMOUNT_STATE: ValueState = "value";
/** The wording this surface owns. */
const SURFACE_COPY = {
  heading: "Draft a request",
  intro: "One request is one invitation its recipient can answer on its own: who is asked, the organization that person represents, why, and the terms version the ask carries.",
  lifecycle: `${REQUEST_LIFECYCLE_STATES.map((state) => REQUEST_LIFECYCLE_COPY[state].label).join(" → ")} are the four states a request passes through. This form records a draft only: it records no presentation and no answer, and claims neither.`,
  draftCreatesNothing: "Saving a draft creates no pledge, gift, commitment, subscription, notification, task or send, and presents nothing to the recipient. There is no send, deliver or notify control here.",
  recipientLabel: "Recipient",
  representedLabel: "Represented organization",
  recipientHelp: "Only a partner on this initiative's reviewed working list is offered. Being on the working list is not an ask, not consent to contact and not an Update audience.",
  recipientPlaceholder: "Choose a person or organization",
  noRecipientTitle: "No partner can be requested yet",
  noRecipientBody: "This initiative's working list names no eligible partner, so nothing can be requested until a partner is on the working list. Adding someone is the working list's own action.",
  representedHelp: "Its own opaque reference, for a partner who represents an organization. It is never derived from, compared with or defaulted to the recipient, and it is left empty when the person represents nobody.",
  representedPlaceholder: "Empty when the person represents nobody",
  purposeHelp: "What you are asking for and why, in your own words — up to 2,000 characters.",
  versionHelp: "The terms version this ask carries, as a whole number greater than zero. Nothing is invented here: a response later binds to the version it answers.",
  termsHelp: "An amount in one currency, or a non-financial ask — never both.",
  shapeCopy: {
    financial: { label: "An amount", hint: "One currency, a whole number of minor units, and an optional cadence and term." },
    "non-financial": { label: REQUESTED_TERMS_COPY.nonFinancialLabel, hint: "Describe what is being asked for instead of an amount. No currency, amount, cadence or term travels with it." },
  },
  currencyHelp: "The currency code the requested amount is in. A code the service does not recognise stays exactly as entered: no other currency is assumed.",
  amountHelp: "The requested amount as a whole number of minor units — digits only, with no sign, decimal mark or exponent. Nothing here rounds, scales or defaults it.",
  amountEchoIntro: "This reads as",
  cadenceHelp: "Optional: how often the requested amount would recur, in your own words.",
  termHelp: "Optional: how long the requested amount would run, in your own words.",
  nonFinancialHelp: "What is being asked for, in your own words — up to 2,000 characters.",
  reviewLabel: "Review and draft",
  reviewTitle: "Review this request draft",
  confirmLabel: "Save draft request",
  backLabel: "Back to the details",
  anotherLabel: "Draft another request",
  unavailableTitle: "A request cannot be drafted here",
  unavailableBody: "This read does not admit the draft action, so no form is offered.",
  minorUnitsNote: "entered as a whole number of minor units",
  nobodyRepresented: "None: the person represents nobody.",
} as const;
/** The labels a refused field shows in the aggregate summary, keyed exactly as the `invalid` outcome keys them. */
const FIELD_LABELS: Readonly<Record<string, string | undefined>> = {
  [RECIPIENT_FIELD]: SURFACE_COPY.recipientLabel,
  [REPRESENTED_FIELD]: SURFACE_COPY.representedLabel,
  [PURPOSE_FIELD]: INITIATIVE_COPY.purposeLabel,
  [VERSION_FIELD]: REQUESTED_TERMS_COPY.versionLabel,
  [TERMS_GAP_FIELD]: REQUESTED_TERMS_COPY.heading,
  [CURRENCY_FIELD]: REQUESTED_TERMS_COPY.currencyLabel,
  [AMOUNT_FIELD]: REQUESTED_TERMS_COPY.amountLabel,
  [CADENCE_FIELD]: REQUESTED_TERMS_COPY.cadenceLabel,
  [TERM_FIELD]: REQUESTED_TERMS_COPY.termLabel,
  [NON_FINANCIAL_FIELD]: REQUESTED_TERMS_COPY.nonFinancialLabel,
};
/** What this form holds: the worker's own values, never a shape the payload admits — the family's schema decides that. */
interface RequestFormValues {
  recipientPartnerId: string;
  representedOrganizationId: string;
  purpose: string;
  /** The terms version as typed. An empty field states no version, and nothing supplies one. */
  version: string;
  termsShape: TermsShape;
  currency: string;
  /** The amount as typed, in minor units. An empty field states no amount, and nothing supplies one. */
  minorUnits: string;
  cadence: string;
  term: string;
  nonFinancialDescription: string;
}
/** What a fresh visit starts from: every value empty, with the recipient unanswered rather than guessed. */
const INITIAL_VALUES: RequestFormValues = { recipientPartnerId: "", representedOrganizationId: "", purpose: "", version: "", termsShape: "financial", currency: "", minorUnits: "", cadence: "", term: "", nonFinancialDescription: "" };
/** The reviewed change, frozen when the worker asks to review it so a later read cannot move the attempt's revision under it. */
interface ReviewedRequest {
  readonly scope: Scope;
  readonly expectedRevision: string;
  readonly payload: DraftRequestPayload;
}
/** One attempt's answer, resolved from the hook's settled state by the identity it was submitted under. */
interface AwaitingOutcome {
  readonly operationId: string;
  readonly resolve: (outcome: MutationOutcome) => void;
}
/** Reports whether a radio value is one of the two terms shapes this form states. */
function isTermsShape(value: unknown): value is TermsShape {
  return typeof value === "string" && (TERMS_SHAPES as readonly string[]).includes(value);
}
/** The number the worker typed, or `undefined` when the field is empty. */
function numberOrUndefined(text: string): number | undefined {
  const trimmed = text.trim();
  return trimmed === "" ? undefined : Number(trimmed);
}
/** The only shape an entered amount may take: digits in minor units, with no sign, decimal mark, exponent or grouping separator. */
const WHOLE_MINOR_UNITS = /^\d+$/;
/**
 * The amount the worker typed as an integer count of minor units. An empty field states no amount; any
 * other text — "1.5", "-5", "1e3", "1,000" — travels as a value that is not a safe integer, so the schema
 * refuses it on the amount field with its own whole-number message rather than this form reading a number
 * the worker never wrote.
 */
function minorUnitsTextOf(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  return WHOLE_MINOR_UNITS.test(trimmed) ? Number(trimmed) : Number.NaN;
}
/** The one place an amount becomes text, over the exact minor-unit type the money module mints, so no surface builds an amount from a number of its own. */
function statedAmountOf(currency: string, minorUnits: number | undefined, locale: string): MinorFormatting | null {
  const code = currency.trim();
  if (code === "" || minorUnits === undefined || !Number.isSafeInteger(minorUnits)) return null;
  return formatMinor({ currency: code, minorUnits: minorUnitsOf(minorUnits) }, STATED_AMOUNT_STATE, locale);
}
/** The terms the payload carries, in exactly one of the two shapes. */
function termsOf(values: RequestFormValues): DraftRequestPayload["terms"] {
  // An unstated version travels as a number that is not a number, so the schema refuses it on the
  // version field with its own message rather than this form choosing a version for the worker.
  const version = numberOrUndefined(values.version) ?? Number.NaN;
  if (values.termsShape === "non-financial") {
    return { version, nonFinancial: { description: values.nonFinancialDescription } };
  }
  const currency = values.currency.trim();
  const minorUnits = minorUnitsTextOf(values.minorUnits);
  const cadence = values.cadence.trim();
  const term = values.term.trim();
  return { version, ...(currency === "" ? {} : { currency }), ...(minorUnits === undefined ? {} : { minorUnits }), ...(cadence === "" ? {} : { cadence }), ...(term === "" ? {} : { term }) };
}
/** The payload this form asks the service to draft. */
function payloadOf(initiativeId: string, values: RequestFormValues): DraftRequestPayload {
  const represented = values.representedOrganizationId.trim();
  return { initiativeId, recipientPartnerId: values.recipientPartnerId, ...(represented === "" ? {} : { representedOrganizationId: represented }), purpose: values.purpose, terms: termsOf(values) };
}
/** The messages a schema refusal carries, keyed by field path exactly as the service's `invalid` outcome is keyed. */
function refusalMessagesOf(error: ZodError): FieldErrorLookup {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.map((segment) => String(segment)).join(".");
    const messages = fields[path];
    if (messages === undefined) {
      fields[path] = [issue.message];
    } else if (!messages.includes(issue.message)) {
      messages.push(issue.message);
    }
  }
  return fieldErrorsFromInvalid({ fields });
}
/** One labelled fact of the review, so the step names exactly what it will draft. */
function ReviewFact({ label, children }: { readonly label: string; readonly children: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
/** What will be drafted, in the worker's own values, before anything is sent. */
function ReviewedRequestFacts({ payload, recipient, locale }: { readonly payload: DraftRequestPayload; readonly recipient: WorkingListMember | undefined; readonly locale: string }): ReactElement {
  const terms = payload.terms;
  const nonFinancial = terms.nonFinancial;
  const amount = statedAmountOf(terms.currency ?? "", terms.minorUnits, locale);
  return (
    <dl className="flex min-w-0 flex-col gap-3 text-sm">
      <ReviewFact label={SURFACE_COPY.recipientLabel}>
        <span className="flex min-w-0 flex-col gap-1">
          {recipient === undefined ? null : <span className="text-pretty">{recipient.partnerDisplayName}</span>}
          <bdi className="mono-identifier wrap-anywhere">{payload.recipientPartnerId}</bdi>
        </span>
      </ReviewFact>
      <ReviewFact label={SURFACE_COPY.representedLabel}>{payload.representedOrganizationId === undefined ? <span>{SURFACE_COPY.nobodyRepresented}</span> : <bdi className="mono-identifier wrap-anywhere">{payload.representedOrganizationId}</bdi>}</ReviewFact>
      <ReviewFact label={INITIATIVE_COPY.purposeLabel}>
        <span className="block whitespace-pre-wrap wrap-anywhere text-pretty">{payload.purpose}</span>
      </ReviewFact>
      <ReviewFact label={REQUESTED_TERMS_COPY.versionLabel}>
        <bdi className="tabular-figures">{String(terms.version)}</bdi>
      </ReviewFact>
      {nonFinancial === undefined ? (
        <>
          <ReviewFact label={REQUESTED_TERMS_COPY.currencyLabel}>
            <bdi className="mono-identifier">{terms.currency ?? REQUESTED_TERMS_COPY.notStated}</bdi>
          </ReviewFact>
          <ReviewFact label={REQUESTED_TERMS_COPY.amountLabel}>
            {amount === null ? (
              <span>{REQUESTED_TERMS_COPY.notStated}</span>
            ) : (
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2" title={amount.accessibleLabel}>
                <bdi className="tabular-figures">{amount.text}</bdi>
                <span className="text-muted-foreground">{SURFACE_COPY.minorUnitsNote}</span>
                {amount.accessibleLabel === amount.text ? null : <span className="sr-only">{amount.accessibleLabel}</span>}
              </span>
            )}
          </ReviewFact>
          <ReviewFact label={REQUESTED_TERMS_COPY.cadenceLabel}>
            <span className="text-pretty">{cadenceValueFallback(terms.cadence ?? "")}</span>
          </ReviewFact>
          <ReviewFact label={REQUESTED_TERMS_COPY.termLabel}>
            <span className="text-pretty">{termValueFallback(terms.term ?? "")}</span>
          </ReviewFact>
        </>
      ) : (
        <ReviewFact label={REQUESTED_TERMS_COPY.nonFinancialLabel}>
          <span className="block whitespace-pre-wrap wrap-anywhere text-pretty">{nonFinancial.description}</span>
        </ReviewFact>
      )}
    </dl>
  );
}

/** The request composer: the form, the review that names what it will draft, and the receipt for one attempt. */
export default function RequestComposer({ initiativeId, envelope, onDrafted, onCheckResult, locale = FALLBACK_LOCALE, headingLevel = 3, className }: RequestComposerProps): ReactElement {
  const scope = envelope.scope;
  const expectedRevision = envelope.revision;
  const headingId = useId();
  const optionIdPrefix = useId();
  const noRecipientNoteId = useId();
  const draftAction = envelope.actions.find((action) => action.name === DRAFT_REQUEST);
  // A read that says the action is unavailable is answered with the reason it states, rather than with a
  // form that could only fail. An absent entry is not a refusal, so it leaves the form available.
  const unavailableReason = draftAction === undefined || draftAction.available ? null : (draftAction.reason?.trim() ?? SURFACE_COPY.unavailableBody);
  const workingList = envelope.data.workingList.items;
  const eligible = useMemo(() => workingList.filter((member) => member.state === "included"), [workingList]);
  const form = useForm({ defaultValues: INITIAL_VALUES });
  const draft = useDraftRequest(scope);
  const [step, setStep] = useState<"form" | "review">("form");
  const [errors, setErrors] = useState<FieldErrorLookup | null>(null);
  const [reviewed, setReviewed] = useState<ReviewedRequest | null>(null);
  const [settled, setSettled] = useState<MutationOutcome | null>(null);
  const awaiting = useRef<AwaitingOutcome | null>(null);
  const settledFromHook = draft.state.status === "settled" ? draft.state.outcome : null;
  // The attempt's identity belongs to the review step, which mints one `operationId` per intent, so the
  // answer it asks about arrives here: the promise the review is waiting on resolves only for the same
  // `operationId`, and a late answer to an earlier attempt therefore cannot resolve a later one.
  useEffect(() => {
    const waiting = awaiting.current;
    if (settledFromHook === null || waiting === null || waiting.operationId !== settledFromHook.operationId) {
      return;
    }
    awaiting.current = null;
    waiting.resolve(settledFromHook);
  }, [settledFromHook]);
  const submitDraft = draft.submit;
  const submit = useCallback(
    (input: MutationInput<DraftRequestPayload>): Promise<MutationOutcome> =>
      new Promise<MutationOutcome>((resolve) => {
        // The review fences a second press while one request is in flight, so this holds at most the
        // attempt whose answer is outstanding.
        awaiting.current = { operationId: input.operationId, resolve };
        submitDraft({ operationId: input.operationId, expectedRevision: input.expectedRevision, payload: input.payload });
      }),
    [submitDraft],
  );
  // Every outcome is answered here, one arm each: a refusal returns to the fields it names with every value
  // kept, an outcome that leaves the draft standing is reported to the caller, and the rest keep the receipt
  // as the record of this attempt. `assertNever` makes a ninth outcome a compile error, not a silent gap.
  const handleSettled = useCallback(
    (outcome: MutationOutcome): void => {
      setSettled(outcome);
      switch (outcome.outcome) {
        case "invalid":
          // The messages belong on the fields they name, so the step returns to the form with every value
          // exactly as it was entered and nothing re-derived.
          setErrors(fieldErrorsFromInvalid(outcome));
          setStep("form");
          return;
        case "accepted":
        case "alreadyAccepted":
          setErrors(null);
          onDrafted?.(outcome);
          return;
        case "unchanged":
        case "conflict":
        case "denied":
        case "unavailable":
        case "unknown":
          // The receipt carries what happened. A conflict keeps the entered terms in the form's own values
          // beside the current revision the outcome states, and an unconfirmed outcome offers the caller's
          // own re-read: neither is ever answered with a second draft.
          setErrors(null);
          return;
        default:
          assertNever(outcome, "Unhandled mutation outcome");
      }
    },
    [onDrafted],
  );
  const reviewTheDetails = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const checked = draftRequestPayloadSchema.safeParse(payloadOf(initiativeId, form.state.values));
    if (!checked.success) {
      // An obviously invalid form never reaches the route and mints no attempt for itself.
      setErrors(refusalMessagesOf(checked.error));
      return;
    }
    setErrors(null);
    // The revision and the scope are frozen with the payload: a re-read of the initiative after another
    // change must not move the revision under an attempt the worker is still reviewing.
    setReviewed({ scope, expectedRevision, payload: checked.data });
    setSettled(null);
    setStep("review");
  };
  const returnToForm = useCallback((): void => {
    // Nothing has been applied while the review is on screen, so returning keeps every value and mints no
    // second identity: the review step's attempt begins only when it is confirmed.
    setReviewed(null);
    setSettled(null);
    setStep("form");
  }, []);
  const startAnother = useCallback((): void => {
    // A new request is a new intent, so the form starts empty rather than carrying the drafted one's
    // values into an attempt that would otherwise look like the same work repeated.
    form.reset(INITIAL_VALUES);
    setReviewed(null);
    setSettled(null);
    setErrors(null);
    setStep("form");
  }, [form]);
  const recipientOf = (partnerId: string): WorkingListMember | undefined => eligible.find((member) => member.partnerId === partnerId);
  const Heading = HEADING_TAG[headingLevel];
  const markedStatement = (statement: string): ReactElement => <li key={statement}>{statement}</li>;
  return (
    <section aria-labelledby={headingId} data-slot="request-composer" className={cn("flex min-w-0 flex-col gap-4", className)}>
      <div className="flex min-w-0 flex-col gap-2">
        <Heading id={headingId} className="font-heading text-lg font-medium text-pretty">
          {SURFACE_COPY.heading}
        </Heading>
        <p className="text-sm text-pretty text-muted-foreground">{SURFACE_COPY.intro}</p>
      </div>
      {/* The boundaries are stated where the worker acts, not only in Help: an amount asked for is not
          support received, a draft is not a presentation, and an answer would create nothing. */}
      <ul className="flex min-w-0 flex-col gap-1 text-xs text-pretty text-muted-foreground">{[REQUESTED_TERMS_COPY.notReceivedSupport, RESPONSE_AGREEMENT_COPY.agreementCreatesNothing, SURFACE_COPY.draftCreatesNothing, SURFACE_COPY.lifecycle].map(markedStatement)}</ul>
      {unavailableReason !== null ? (
        <Alert>
          <AlertTitle>{SURFACE_COPY.unavailableTitle}</AlertTitle>
          <AlertDescription>{unavailableReason}</AlertDescription>
        </Alert>
      ) : step === "review" && reviewed !== null ? (
        <div className="flex min-w-0 flex-col gap-3">
          <ActionReview<DraftRequestPayload>
            title={SURFACE_COPY.reviewTitle}
            description={<ReviewedRequestFacts payload={reviewed.payload} recipient={recipientOf(reviewed.payload.recipientPartnerId)} locale={locale} />}
            confirmLabel={SURFACE_COPY.confirmLabel}
            cancelLabel={SURFACE_COPY.backLabel}
            onCancel={returnToForm}
            input={reviewed}
            submit={submit}
            onSettled={handleSettled}
            checkResult={onCheckResult}
            fieldLabels={FIELD_LABELS}
            headingLevel={headingLevel}
          />
          {settled === null || settled.outcome === "invalid" ? null : (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={startAnother}>
                {SURFACE_COPY.anotherLabel}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <form noValidate className="flex min-w-0 flex-col gap-4" onSubmit={reviewTheDetails}>
          {errors === null || errors.count === 0 ? null : <FormErrorSummary errors={errors} labels={FIELD_LABELS} order={FIELD_ORDER} headingLevel={CHILD_HEADING_LEVEL} />}
          {eligible.length === 0 ? (
            <Alert>
              <AlertTitle>{SURFACE_COPY.noRecipientTitle}</AlertTitle>
              <AlertDescription id={noRecipientNoteId}>{SURFACE_COPY.noRecipientBody}</AlertDescription>
            </Alert>
          ) : (
            <form.Field name="recipientPartnerId">
              {(field) => (
                <FormField name={RECIPIENT_FIELD} label={SURFACE_COPY.recipientLabel} description={SURFACE_COPY.recipientHelp} error={errors?.byField[RECIPIENT_FIELD]} required>
                  {(control) => (
                    <NativeSelect
                      id={control.id}
                      name={RECIPIENT_FIELD}
                      className="w-full"
                      required={control.required}
                      value={field.state.value}
                      aria-describedby={control.describedBy}
                      aria-invalid={control.invalid ? true : undefined}
                      onChange={(event) => {
                        field.handleChange(event.target.value);
                      }}
                      onBlur={field.handleBlur}
                    >
                      <NativeSelectOption value="">{SURFACE_COPY.recipientPlaceholder}</NativeSelectOption>
                      {eligible.map((member) => (
                        <NativeSelectOption key={member.memberId} value={member.partnerId}>
                          {member.partnerDisplayName}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  )}
                </FormField>
              )}
            </form.Field>
          )}
          <form.Field name="representedOrganizationId">
            {(field) => (
              <FormField name={REPRESENTED_FIELD} label={SURFACE_COPY.representedLabel} description={SURFACE_COPY.representedHelp} error={errors?.byField[REPRESENTED_FIELD]} optionalHint>
                {(control) => (
                  <Input
                    id={control.id}
                    name={REPRESENTED_FIELD}
                    type="text"
                    autoComplete="off"
                    placeholder={SURFACE_COPY.representedPlaceholder}
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
          <form.Field name="purpose">
            {(field) => (
              <FormField name={PURPOSE_FIELD} label={INITIATIVE_COPY.purposeLabel} description={SURFACE_COPY.purposeHelp} error={errors?.byField[PURPOSE_FIELD]} required>
                {(control) => (
                  <Textarea
                    id={control.id}
                    name={PURPOSE_FIELD}
                    rows={4}
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
          <form.Field name="version">
            {(field) => (
              <FormField name={VERSION_FIELD} label={REQUESTED_TERMS_COPY.versionLabel} description={SURFACE_COPY.versionHelp} error={errors?.byField[VERSION_FIELD]} required>
                {(control) => (
                  <Input
                    id={control.id}
                    name={VERSION_FIELD}
                    type="number"
                    min={1}
                    step={1}
                    className="w-full sm:max-w-40"
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
          <FormFieldGroup legend={REQUESTED_TERMS_COPY.heading} name={TERMS_FIELD} description={SURFACE_COPY.termsHelp} error={errors?.byField[TERMS_GAP_FIELD]} required>
            {(group) => (
              <div className="flex min-w-0 flex-col gap-4">
                <form.Field name="termsShape">
                  {(field) => (
                    <RadioGroup
                      value={field.state.value}
                      onValueChange={(next) => {
                        if (!isTermsShape(next)) {
                          return;
                        }
                        field.handleChange(next);
                      }}
                      aria-labelledby={group.legendId}
                      aria-describedby={group.describedBy}
                      aria-invalid={group.invalid ? true : undefined}
                      aria-required={group.required ? true : undefined}
                    >
                      {TERMS_SHAPES.map((shape) => {
                        const wording = SURFACE_COPY.shapeCopy[shape];
                        const optionId = `${optionIdPrefix}-terms-${shape}`;
                        const hintId = `${optionId}-hint`;
                        return (
                          <label key={shape} htmlFor={optionId} className="flex min-h-target items-start gap-3 py-1">
                            <RadioGroupItem id={optionId} value={shape} aria-label={wording.label} aria-describedby={hintId} className="mt-0.5" />
                            <span className="flex min-w-0 flex-col gap-0.5">
                              <span className="text-sm font-medium text-pretty">{wording.label}</span>
                              <span id={hintId} className="text-sm text-pretty text-muted-foreground">
                                {wording.hint}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </RadioGroup>
                  )}
                </form.Field>
                <form.Subscribe selector={(state) => state.values.termsShape}>
                  {(shape) =>
                    shape === "non-financial" ? (
                      <form.Field name="nonFinancialDescription">
                        {(field) => (
                          <FormField name={NON_FINANCIAL_FIELD} label={REQUESTED_TERMS_COPY.nonFinancialLabel} description={SURFACE_COPY.nonFinancialHelp} error={errors?.byField[NON_FINANCIAL_FIELD]} required>
                            {(control) => (
                              <Textarea
                                id={control.id}
                                name={NON_FINANCIAL_FIELD}
                                rows={4}
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
                    ) : (
                      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                        <form.Field name="currency">
                          {(field) => (
                            <FormField name={CURRENCY_FIELD} label={REQUESTED_TERMS_COPY.currencyLabel} description={SURFACE_COPY.currencyHelp} error={errors?.byField[CURRENCY_FIELD]} required>
                              {(control) => (
                                <Input
                                  id={control.id}
                                  name={CURRENCY_FIELD}
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
                        <form.Field name="minorUnits">
                          {(field) => (
                            // The amount is echoed through the one money formatter as it is typed, so the currency's
                            // exponent is visible before review. It states what the entered digits already are, which is
                            // what the field's description is for, and it is isolated so mixed-direction text cannot
                            // reorder the digits or the currency code.
                            <form.Subscribe selector={(state) => state.values.currency}>
                              {(currency) => {
                                const echo = statedAmountOf(currency, minorUnitsTextOf(field.state.value), locale);
                                return (
                                  <FormField name={AMOUNT_FIELD} label={REQUESTED_TERMS_COPY.amountLabel} description={SURFACE_COPY.amountHelp} error={errors?.byField[AMOUNT_FIELD]} required>
                                    {(control) => {
                                      const echoId = `${control.id}-echo`;
                                      const describedBy = echo === null ? control.describedBy : control.describedBy === undefined ? echoId : `${control.describedBy} ${echoId}`;
                                      return (
                                        <div className="flex min-w-0 flex-col gap-1.5">
                                          <Input
                                            id={control.id}
                                            name={AMOUNT_FIELD}
                                            type="text"
                                            inputMode="numeric"
                                            pattern="[0-9]*"
                                            autoComplete="off"
                                            required={control.required}
                                            value={field.state.value}
                                            aria-describedby={describedBy}
                                            aria-invalid={control.invalid ? true : undefined}
                                            onChange={(event) => {
                                              field.handleChange(event.target.value);
                                            }}
                                            onBlur={field.handleBlur}
                                          />
                                          {echo === null ? null : (
                                            <p id={echoId} className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-sm text-muted-foreground">
                                              {SURFACE_COPY.amountEchoIntro} <bdi className="tabular-figures">{echo.text}</bdi>
                                            </p>
                                          )}
                                        </div>
                                      );
                                    }}
                                  </FormField>
                                );
                              }}
                            </form.Subscribe>
                          )}
                        </form.Field>
                        <form.Field name="cadence">
                          {(field) => (
                            <FormField name={CADENCE_FIELD} label={REQUESTED_TERMS_COPY.cadenceLabel} description={SURFACE_COPY.cadenceHelp} error={errors?.byField[CADENCE_FIELD]} optionalHint>
                              {(control) => (
                                <Input
                                  id={control.id}
                                  name={CADENCE_FIELD}
                                  type="text"
                                  autoComplete="off"
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
                        <form.Field name="term">
                          {(field) => (
                            <FormField name={TERM_FIELD} label={REQUESTED_TERMS_COPY.termLabel} description={SURFACE_COPY.termHelp} error={errors?.byField[TERM_FIELD]} optionalHint>
                              {(control) => (
                                <Input
                                  id={control.id}
                                  name={TERM_FIELD}
                                  type="text"
                                  autoComplete="off"
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
                      </div>
                    )
                  }
                </form.Subscribe>
              </div>
            )}
          </FormFieldGroup>
          <div className="flex flex-wrap items-center gap-2">
            {/* With no eligible recipient the review could only be refused, so the control a worker would
                reach for states the reason it is unavailable rather than failing one step later. */}
            <Button type="submit" disabled={eligible.length === 0} aria-describedby={eligible.length === 0 ? noRecipientNoteId : undefined}>
              {SURFACE_COPY.reviewLabel}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
