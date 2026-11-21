"use client";

/**
 * The coaching invitation surface: the five facts one invitation carries — the named coach, the organization, the
 * ministry, the five modules recorded unselected and the duration sharing runs for — collected through TanStack Form,
 * reviewed, and submitted as the named `inviteCoach` mutation through the family's own hook.
 *
 * The facts are closed choices over the candidates the route read from the envelope. Nothing here is typed free-hand:
 * a typed name or address would establish an identity this application cannot verify, which is why the recipient,
 * the organization and the ministry are selected from admitted references and never from text. (A native select is
 * the right closed-choice control for a list this size, and it is the control this folder's approved primitives
 * carry: there is no combobox or command surface here.)
 *
 * Recording an invitation is the first of four separate outcomes only. Identity verification, the person's
 * deliberate acceptance and live access are not reached by this form, and the copy below never claims otherwise.
 */
import { useForm } from "@tanstack/react-form";
import { useCallback, useId, useState, type ReactElement } from "react";
import ActionReview from "@/components/action-review";
import FormField, { fieldErrorsFromInvalid } from "@/components/form-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import { serialiseCivilDate, type CivilDate } from "@/modules/time/civil";
import { COACHING_COPY, MODULE_COPY, SHARING_OUTCOME_COPY } from "../copy";
import { useInviteCoach } from "../hooks/use-coaching-mutations";
import { invitationPayloadSchema, type InvitationPayload } from "../schemas/invitation";
import DurationControl, { DURATION_WORDING, type DurationValue } from "./duration-control";

type InvitationCandidates = {
  readonly recipients: ReadonlyArray<{ readonly principalId: string; readonly displayName: string }>;
  readonly organizations: ReadonlyArray<{ readonly organizationId: string; readonly displayName: string }>;
  readonly ministries: ReadonlyArray<{ readonly ministryId: string; readonly displayName: string }>;
};

export interface InvitationFormProps {
  /** The admitted choices for the three closed selections, supplied by the route from the read envelope. */
  readonly candidates: InvitationCandidates;
  /** The context this invitation is recorded in, forwarded into the mutation input unchanged and never constructed here. */
  readonly scope: Scope;
  /** The revision the caller read, forwarded into the mutation input unchanged. */
  readonly expectedRevision: string;
  /** Used for calendar-date presentation only; the form reads no clock. */
  readonly locale: string;
  /** Called with every settled attempt, so the composing route can refresh its summary. The form still renders the outcome itself. */
  readonly onInvited?: (outcome: MutationOutcome) => void;
  readonly className?: string;
}

// ---------------------------------------------------------------------------------------------
// Wording. The field, review and explanation copy is this surface's own; the module names and the
// four separate outcomes come from the family's copy module, so neither is restated here.
// ---------------------------------------------------------------------------------------------

const SECTION_HEADING = "Invite a coach";
const SECTION_LEAD = COACHING_COPY.sharing.purpose;
const STAGES_HEADING = "What an invitation does, and what it never does";
const STAGES_LEAD = "These four things are separate outcomes, and recording an invitation reaches only the first: it sends no message, verifies nobody and makes nothing readable.";
const MODULES_HEADING = "Five modules, each starting unselected";
const MODULES_LEAD = "Every module is recorded as switched off when the invitation is created. You choose which ones to switch on once the person has accepted, so nothing here pre-selects a module and no module can be read before then.";
const MODULE_STATE_WORD = "Starts unselected";
const RECIPIENT_FIELD = "coachPrincipalId";
const ORGANIZATION_FIELD = "organizationId";
const MINISTRY_FIELD = "ministryId";
const DURATION_FIELD = "duration";
const RECIPIENT_LABEL = "Coach";
const RECIPIENT_DESCRIPTION = "The named person this invitation is for, chosen from the people admitted to this ministry context. A typed name or address would establish nothing: an address that looks the same verifies nobody.";
const RECIPIENT_PLACEHOLDER = "Choose the person to invite";
const ORGANIZATION_LABEL = "Organization";
const ORGANIZATION_DESCRIPTION = "The organization this invitation is recorded under, chosen from those admitted to this context.";
const ORGANIZATION_PLACEHOLDER = "Choose the organization";
const MINISTRY_LABEL = "Ministry";
const MINISTRY_DESCRIPTION = "The one ministry this invitation covers. A coach reads nothing outside the ministry chosen here.";
const MINISTRY_PLACEHOLDER = "Choose the ministry";
const NOT_CHOSEN = "Not chosen";
const REVIEW_TITLE = "Record this invitation";
const CONFIRM_LABEL = "Record invitation";
const REVIEW_CONSEQUENCE = "Recording an invitation adds the invitation record and nothing else: no message leaves this application, the person's identity is not verified, and no module becomes readable.";
const SETTLED_POINTER = "Recording an invitation reached the first of the four outcomes above and no further: identity verification, deliberate acceptance and live access have not happened.";
const OUTSTANDING_LEAD = "Still needed before this invitation can be recorded:";
const GAP_TITLE = "No admitted choice is available for this invitation";
const NO_RECIPIENTS = "No person is admitted as a coach in this context.";
const NO_ORGANIZATIONS = "No organization is admitted in this context.";
const NO_MINISTRIES = "No ministry is admitted in this context.";
const GAP_CONSEQUENCE = "An invitation needs one admitted person, organization and ministry, so nothing can be submitted from this surface until the source admits them.";
const GAP_ACTION_REASON = "Nothing can be submitted until the missing choice above is available.";

const FIELD_LABELS: Readonly<Record<string, string | undefined>> = {
  [RECIPIENT_FIELD]: RECIPIENT_LABEL,
  [ORGANIZATION_FIELD]: ORGANIZATION_LABEL,
  [MINISTRY_FIELD]: MINISTRY_LABEL,
  [DURATION_FIELD]: DURATION_WORDING.legend,
  [`${DURATION_FIELD}.shareThroughDate`]: DURATION_WORDING.dateLabel,
  [`${DURATION_FIELD}.throughDate`]: DURATION_WORDING.dateLabel,
};

// ---------------------------------------------------------------------------------------------
// The values, the one payload type, and what the schema still requires of it
// ---------------------------------------------------------------------------------------------

type InvitationFormValues = { coachPrincipalId: string; organizationId: string; ministryId: string; duration: DurationValue | null };

/** Nothing is chosen yet and no module is switched on, so the form opens in the state an invitation must start in. */
const INITIAL_VALUES: InvitationFormValues = { coachPrincipalId: "", organizationId: "", ministryId: "", duration: null };

/** The five modules as an invitation records them: all switched off, typed by the payload schema's own module shape. */
const UNSELECTED_MODULES = { "support-goal": false, "support-results": false, targets: false, "check-ins": false, "task-summaries": false } satisfies InvitationPayload["modules"];

function isoDateOf(date: CivilDate | null): string {
  return date === null ? "" : serialiseCivilDate(date);
}

/**
 * The duration as the payload states it. A duration nobody has chosen is sent as an unreadable date rather than as a
 * default, because a default would turn a missing duration into permission to share; the schema then refuses it and
 * answers with the message that names the duration, so "no duration" can never be submitted as "ongoing".
 */
function durationOf(value: DurationValue | null): InvitationPayload["duration"] {
  if (value === null) {
    return { kind: "through-date", shareThroughDate: "" };
  }
  if (value.kind === "ongoing") {
    return { kind: "ongoing" };
  }
  return { kind: "through-date", shareThroughDate: isoDateOf(value.throughDate) };
}

function payloadOf(values: InvitationFormValues): InvitationPayload {
  return { coachPrincipalId: values.coachPrincipalId.trim(), organizationId: values.organizationId.trim(), ministryId: values.ministryId.trim(), modules: UNSELECTED_MODULES, duration: durationOf(values.duration) };
}

/** The label a required fact is named by, from the schema's own path for it. */
function labelForPath(path: string, values: InvitationFormValues): string {
  if (path === DURATION_FIELD || path === `${DURATION_FIELD}.shareThroughDate`) {
    return values.duration === null ? DURATION_WORDING.legend : DURATION_WORDING.dateLabel;
  }
  return FIELD_LABELS[path] ?? "";
}

/**
 * The facts this payload still lacks, named as the fields that carry them. The payload schema decides what is
 * missing, so this statement can never drift from the message a refused submission answers with; it only names it.
 */
function outstandingLabels(payload: InvitationPayload, values: InvitationFormValues): readonly string[] {
  const parsed = invitationPayloadSchema.safeParse(payload);
  if (parsed.success) {
    return [];
  }
  const labels: string[] = [];
  for (const issue of parsed.error.issues) {
    const label = labelForPath(issue.path.join("."), values);
    if (label !== "" && !labels.includes(label)) {
      labels.push(label);
    }
  }
  return labels;
}

function listOf(items: readonly string[]): string {
  if (items.length <= 1) {
    return items[0] ?? "";
  }
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] ?? ""}`;
}

function describedByOf(...ids: ReadonlyArray<string | undefined>): string | undefined {
  const stated = ids.filter((id): id is string => id !== undefined && id.trim() !== "");
  return stated.length === 0 ? undefined : stated.join(" ");
}

// ---------------------------------------------------------------------------------------------
// The three closed choices
// ---------------------------------------------------------------------------------------------

type ChoiceOption = { readonly value: string; readonly label: string };

function recipientOptionsOf(candidates: InvitationCandidates): readonly ChoiceOption[] {
  return candidates.recipients.map((recipient) => ({ value: recipient.principalId, label: recipient.displayName }));
}

function organizationOptionsOf(candidates: InvitationCandidates): readonly ChoiceOption[] {
  return candidates.organizations.map((organization) => ({ value: organization.organizationId, label: organization.displayName }));
}

function ministryOptionsOf(candidates: InvitationCandidates): readonly ChoiceOption[] {
  return candidates.ministries.map((ministry) => ({ value: ministry.ministryId, label: ministry.displayName }));
}

/** The admitted choices this context is missing, stated so an unavailable selection is explained rather than silently disabled. */
function candidatesGap(candidates: InvitationCandidates): string | null {
  const missing: string[] = [];
  if (candidates.recipients.length === 0) missing.push(NO_RECIPIENTS);
  if (candidates.organizations.length === 0) missing.push(NO_ORGANIZATIONS);
  if (candidates.ministries.length === 0) missing.push(NO_MINISTRIES);
  return missing.length === 0 ? null : missing.join(" ");
}

function chosenName(options: readonly ChoiceOption[], value: string): string {
  const chosen = options.find((option) => option.value === value);
  return chosen === undefined ? NOT_CHOSEN : chosen.label;
}

/**
 * A selected reference, or the empty string when the admitted candidates no longer contain it. A choice that has
 * dropped out of the admitted list since it was selected is sent as unchosen rather than as an identity this surface
 * no longer offers, so the selection stays closed over what the context admits.
 */
function admittedReference(value: string, options: readonly ChoiceOption[]): string {
  const trimmed = value.trim();
  return options.some((option) => option.value === trimmed) ? trimmed : "";
}

type ChoiceSelectProps = {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly placeholder: string;
  readonly value: string;
  readonly options: readonly ChoiceOption[];
  readonly error: readonly string[] | undefined;
  readonly gapReason: string | null;
  readonly reasonId: string | undefined;
  readonly onSelect: (next: string) => void;
};

/** One labelled closed choice over admitted candidates: a native select, because the selection is a list of references and never a typed identity. */
function ChoiceSelect({ name, label, description, placeholder, value, options, error, gapReason, reasonId, onSelect }: ChoiceSelectProps): ReactElement {
  const unavailable = gapReason !== null;
  return (
    <FormField name={name} label={label} description={description} error={error} required>
      {(control) => (
        <NativeSelect
          id={control.id}
          className="w-full sm:max-w-96"
          value={value}
          disabled={unavailable}
          aria-describedby={describedByOf(control.describedBy, unavailable ? reasonId : undefined)}
          aria-invalid={control.invalid ? true : undefined}
          aria-required={control.required ? true : undefined}
          onChange={(event) => {
            const next = event.currentTarget.value;
            // The choice is closed over the admitted candidates: a value naming none of them is never stored, so no
            // identity can enter this invitation except by being admitted to the context the envelope was read in.
            if (next !== "" && !options.some((option) => option.value === next)) {
              return;
            }
            onSelect(next);
          }}
        >
          <NativeSelectOption value="">{placeholder}</NativeSelectOption>
          {options.map((option) => (
            <NativeSelectOption key={option.value} value={option.value}>
              {option.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )}
    </FormField>
  );
}

// ---------------------------------------------------------------------------------------------
// The reviewed summary: exactly what a confirmation would record
// ---------------------------------------------------------------------------------------------

function ReviewedFact({ term, value }: { readonly term: string; readonly value: string }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="font-medium text-foreground">{term}</dt>
      <dd className="min-w-0">
        {/* A chosen name may arrive in any script, so it is isolated rather than left to reorder against its neighbours. */}
        <bdi>{value}</bdi>
      </dd>
    </div>
  );
}

function ReviewedDuration({ value }: { readonly value: DurationValue | null }): ReactElement {
  const term = <dt className="font-medium text-foreground">{DURATION_WORDING.legend}</dt>;
  if (value === null) {
    return (
      <div className="flex min-w-0 flex-col gap-1">
        {term}
        <dd className="min-w-0 text-pretty">{DURATION_WORDING.missingIsNotPermission}</dd>
      </div>
    );
  }
  const wording = DURATION_WORDING.kinds[value.kind];
  const date = value.kind === "through-date" ? isoDateOf(value.throughDate) : "";
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {term}
      <dd className="flex min-w-0 flex-col gap-1">
        <span className="font-medium">{wording.label}</span>
        {value.kind !== "through-date" ? null : date === "" ? <span>{DURATION_WORDING.dateRequired}</span> : <bdi className="mono-identifier">{date}</bdi>}
        <span className="text-pretty text-muted-foreground">{wording.description}</span>
      </dd>
    </div>
  );
}

type ReviewedInvitationProps = { readonly values: InvitationFormValues; readonly recipientOptions: readonly ChoiceOption[]; readonly organizationOptions: readonly ChoiceOption[]; readonly ministryOptions: readonly ChoiceOption[] };

function ReviewedInvitation({ values, recipientOptions, organizationOptions, ministryOptions }: ReviewedInvitationProps): ReactElement {
  return (
    <dl className="flex min-w-0 flex-col gap-3">
      <ReviewedFact term={RECIPIENT_LABEL} value={chosenName(recipientOptions, values.coachPrincipalId)} />
      <ReviewedFact term={ORGANIZATION_LABEL} value={chosenName(organizationOptions, values.organizationId)} />
      <ReviewedFact term={MINISTRY_LABEL} value={chosenName(ministryOptions, values.ministryId)} />
      <div className="flex min-w-0 flex-col gap-1">
        <dt className="font-medium text-foreground">{MODULES_HEADING}</dt>
        <dd className="min-w-0">
          <ul className="flex min-w-0 list-disc flex-col gap-1 ps-4">
            {Object.entries(MODULE_COPY).map(([key, wording]) => (
              <li key={key} className="min-w-0">
                <span className="font-medium">{wording.name}</span>
                <span className="text-muted-foreground">{` — ${MODULE_STATE_WORD}`}</span>
              </li>
            ))}
          </ul>
        </dd>
      </div>
      <ReviewedDuration value={values.duration} />
    </dl>
  );
}

// ---------------------------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------------------------

/**
 * Collects, reviews and submits one coaching invitation with `invitationPayloadSchema`; renders whichever of the eight
 * mutation outcomes came back — `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`,
 * `unavailable` or `unknown` — through the one receipt, and keeps the entered facts after every failure.
 */
export default function InvitationForm({ candidates, scope, expectedRevision, locale, onInvited, className }: InvitationFormProps): ReactElement {
  const headingId = useId();
  const stagesId = useId();
  const modulesId = useId();
  const gapId = useId();
  const form = useForm({ defaultValues: INITIAL_VALUES });
  const [settledOutcome, setSettledOutcome] = useState<MutationOutcome | null>(null);
  const { mutateAsync } = useInviteCoach();
  // The review step mints the attempt's identity and supplies it here, so this handler forwards it verbatim rather
  // than minting another: one intent keeps one identity, and a repeated submission recovers the first result.
  const submit = useCallback((input: MutationInput<InvitationPayload>): Promise<MutationOutcome> => mutateAsync({ operationId: input.operationId, scope: input.scope, expectedRevision: input.expectedRevision, payload: input.payload }), [mutateAsync]);
  const handleSettled = useCallback(
    (outcome: MutationOutcome): void => {
      setSettledOutcome(outcome);
      onInvited?.(outcome);
    },
    [onInvited],
  );
  // A refusal's messages are read from the settled outcome, keyed by the schema's own field paths. Correcting a field
  // begins a new intent, so the previous refusal stops being shown against values it was not raised for.
  const fieldErrors = settledOutcome !== null && settledOutcome.outcome === "invalid" ? fieldErrorsFromInvalid(settledOutcome) : null;
  const clearRefusal = useCallback((): void => {
    setSettledOutcome((current) => (current === null ? current : null));
  }, []);
  const gap = candidatesGap(candidates);
  const recipientOptions = recipientOptionsOf(candidates);
  const organizationOptions = organizationOptionsOf(candidates);
  const ministryOptions = ministryOptionsOf(candidates);
  const durationMessages = fieldErrors === null ? undefined : (fieldErrors.byField[DURATION_FIELD] ?? fieldErrors.byField[`${DURATION_FIELD}.shareThroughDate`] ?? fieldErrors.byField[`${DURATION_FIELD}.throughDate`]);
  const durationError = durationMessages === undefined ? null : durationMessages.join(" ");
  const recorded = settledOutcome !== null && (settledOutcome.outcome === "accepted" || settledOutcome.outcome === "alreadyAccepted");
  return (
    <section data-slot="invitation-form" aria-labelledby={headingId} className={cn("flex min-w-0 flex-col gap-6", className)}>
      <div className="flex min-w-0 flex-col gap-2">
        <h2 id={headingId} className="font-heading text-lg font-medium">
          {SECTION_HEADING}
        </h2>
        <p className="text-sm text-pretty text-muted-foreground">{SECTION_LEAD}</p>
      </div>
      <section aria-labelledby={stagesId} className="flex min-w-0 flex-col gap-2">
        <h3 id={stagesId} className="font-heading text-base font-medium">
          {STAGES_HEADING}
        </h3>
        <p className="text-sm text-pretty text-muted-foreground">{STAGES_LEAD}</p>
        <ol className="flex min-w-0 list-decimal flex-col gap-2 ps-5 text-sm">
          {SHARING_OUTCOME_COPY.map((stage) => (
            <li key={stage.id} className="min-w-0 text-pretty">
              <span className="font-medium text-foreground">{stage.label}</span>
              <span className="text-muted-foreground">{` — ${stage.description}`}</span>
            </li>
          ))}
        </ol>
      </section>
      {gap === null ? null : (
        // A static explanation of a state already on the screen, not an announcement on every render: the surface's
        // receipt is the one live region that reports the result of a submission.
        <Alert id={gapId} role={undefined}>
          <AlertTitle>{GAP_TITLE}</AlertTitle>
          <AlertDescription>
            <p>{gap}</p>
            <p>{GAP_CONSEQUENCE}</p>
          </AlertDescription>
        </Alert>
      )}
      <form.Subscribe selector={(state) => state.values}>
        {(values) => {
          // A selection that the admitted candidates no longer contain is sent as unchosen, so nothing this form
          // submits is an identity the context has stopped admitting.
          const payload = payloadOf({ ...values, coachPrincipalId: admittedReference(values.coachPrincipalId, recipientOptions), organizationId: admittedReference(values.organizationId, organizationOptions), ministryId: admittedReference(values.ministryId, ministryOptions) });
          const outstanding = outstandingLabels(payload, values);
          return (
            <div className="flex min-w-0 flex-col gap-6">
              <ChoiceSelect
                name={RECIPIENT_FIELD}
                label={RECIPIENT_LABEL}
                description={RECIPIENT_DESCRIPTION}
                placeholder={RECIPIENT_PLACEHOLDER}
                value={values.coachPrincipalId}
                options={recipientOptions}
                error={fieldErrors?.byField[RECIPIENT_FIELD]}
                gapReason={gap}
                reasonId={gapId}
                onSelect={(next) => {
                  form.setFieldValue(RECIPIENT_FIELD, next);
                  clearRefusal();
                }}
              />
              <ChoiceSelect
                name={ORGANIZATION_FIELD}
                label={ORGANIZATION_LABEL}
                description={ORGANIZATION_DESCRIPTION}
                placeholder={ORGANIZATION_PLACEHOLDER}
                value={values.organizationId}
                options={organizationOptions}
                error={fieldErrors?.byField[ORGANIZATION_FIELD]}
                gapReason={gap}
                reasonId={gapId}
                onSelect={(next) => {
                  form.setFieldValue(ORGANIZATION_FIELD, next);
                  clearRefusal();
                }}
              />
              <ChoiceSelect
                name={MINISTRY_FIELD}
                label={MINISTRY_LABEL}
                description={MINISTRY_DESCRIPTION}
                placeholder={MINISTRY_PLACEHOLDER}
                value={values.ministryId}
                options={ministryOptions}
                error={fieldErrors?.byField[MINISTRY_FIELD]}
                gapReason={gap}
                reasonId={gapId}
                onSelect={(next) => {
                  form.setFieldValue(MINISTRY_FIELD, next);
                  clearRefusal();
                }}
              />
              <Separator />
              <section aria-labelledby={modulesId} className="flex min-w-0 flex-col gap-2">
                <h3 id={modulesId} className="font-heading text-base font-medium">
                  {MODULES_HEADING}
                </h3>
                <p className="text-sm text-pretty text-muted-foreground">{MODULES_LEAD}</p>
                <ul className="flex min-w-0 flex-col gap-3">
                  {Object.entries(MODULE_COPY).map(([key, wording]) => (
                    <li key={key} className="flex min-w-0 flex-col gap-0.5">
                      <p className="text-sm">
                        <span className="font-medium text-foreground">{wording.name}</span>
                        <span className="text-muted-foreground">{` — ${MODULE_STATE_WORD}`}</span>
                      </p>
                      <p className="text-sm text-pretty text-muted-foreground">{wording.description}</p>
                    </li>
                  ))}
                </ul>
              </section>
              <Separator />
              <DurationControl
                value={values.duration}
                onChange={(next) => {
                  form.setFieldValue(DURATION_FIELD, next);
                  clearRefusal();
                }}
                error={durationError}
                locale={locale}
              />
              {outstanding.length === 0 ? null : <p className="text-sm text-pretty text-muted-foreground">{`${OUTSTANDING_LEAD} ${listOf(outstanding)}.`}</p>}
              {gap === null ? (
                <ActionReview<InvitationPayload>
                  title={REVIEW_TITLE}
                  description={<ReviewedInvitation values={values} recipientOptions={recipientOptions} organizationOptions={organizationOptions} ministryOptions={ministryOptions} />}
                  consequence={REVIEW_CONSEQUENCE}
                  confirmLabel={CONFIRM_LABEL}
                  input={{ scope, expectedRevision, payload }}
                  submit={submit}
                  onSettled={handleSettled}
                  fieldLabels={FIELD_LABELS}
                  headingLevel={3}
                />
              ) : (
                <div className="flex min-w-0 flex-col gap-2">
                  <Button type="button" disabled aria-describedby={gapId}>
                    {CONFIRM_LABEL}
                  </Button>
                  <p className="text-sm text-pretty text-muted-foreground">{GAP_ACTION_REASON}</p>
                </div>
              )}
              {recorded ? <p className="text-sm text-pretty text-muted-foreground">{SETTLED_POINTER}</p> : null}
            </div>
          );
        }}
      </form.Subscribe>
    </section>
  );
}
