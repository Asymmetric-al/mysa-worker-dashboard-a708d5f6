"use client";

/**
 * The coaching invitation surface: the facts one invitation carries — the named coach, the organization, the
 * ministry, the five modules recorded unselected, the duration sharing runs for and, when the worker wants to share
 * figures, the separately reviewed fixed financial range — collected through TanStack Form, reviewed, and submitted as
 * the named `inviteCoach` mutation through the family's own hook.
 *
 * The range is the one optional fact here: two dates chosen from the calendar and, where the source holds more than one,
 * the currency they were reviewed in. Left empty it records no range and shares no support figure at all, which is a
 * different statement from a range of zero.
 *
 * The facts are closed choices over the candidates the route read from the envelope. Nothing here is typed free-hand:
 * a typed name or address would establish an identity this application cannot verify, which is why the recipient,
 * the organization, the ministry and the currency are selected from admitted references and never from text. (A native
 * select is the right closed-choice control for a list this size, and it is the control this folder's approved primitives
 * carry: there is no combobox or command surface here.)
 *
 * Recording an invitation is the first of four separate outcomes only. Identity verification, the person's
 * deliberate acceptance and live access are not reached by this form, and the copy below never claims otherwise.
 */
import { useForm } from "@tanstack/react-form";
import { useCallback, useId, useState, type ReactElement } from "react";
import ActionReview from "@/components/action-review";
import FormField, { fieldErrorsFromInvalid, FormFieldGroup } from "@/components/form-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  /**
   * The currencies this session's support source holds, exactly as the coaching read states them. A reviewed range
   * names one of these and nothing else — the mutation refuses a currency the source does not hold — and no range at
   * all is offered from an empty list, because a source nothing could be read from is never a zero figure.
   */
  readonly rangeCurrencies: readonly string[];
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
const RECIPIENT_DESCRIPTION = "The named person this invitation is for, chosen from the coaches your own coaching records already name. A typed name or address would establish nothing: an address that looks the same verifies nobody.";
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
const NO_RECIPIENTS = "No coach is named in your own coaching records yet, so there is no one this surface can invite.";
const NO_ORGANIZATIONS = "No organization is admitted in this context.";
const NO_MINISTRIES = "No ministry is admitted in this context.";
const GAP_CONSEQUENCE = "An invitation needs one admitted person, organization and ministry, so nothing can be submitted from this surface until the source admits them.";
const GAP_ACTION_REASON = "Nothing can be submitted until the missing choice above is available.";

// The reviewed financial range: the one fact an invitation may carry and may equally leave out. It is a separate
// decision from the modules, so this wording never presents it as part of them and never presents silence as a zero.
const RANGE_FIELD = "financialRange";
const RANGE_FROM_FIELD = "financialRange.fromDate";
const RANGE_TO_FIELD = "financialRange.toDate";
const RANGE_CURRENCY_FIELD = "financialRange.currency";
const RANGE_HEADING = "A reviewed financial range";
const RANGE_LEAD = "Financial sharing is a separate decision from the modules above, and it is optional. Set the two dates only " + "if you want your coach to read support figures for that fixed period: a range never widens to all " + "history, and an invitation with no dates shares no figure at all.";
const RANGE_FROM_LABEL = "Range from";
const RANGE_TO_LABEL = "Range to";
const RANGE_CURRENCY_LABEL = "Currency";
const RANGE_FROM_DESCRIPTION = "The first calendar date this range covers. It is a date as you would say it, with no time of day recorded.";
const RANGE_TO_DESCRIPTION = "The last calendar date this range covers, and the range includes this day. Nothing after it is ever reported.";
const RANGE_CURRENCY_PLACEHOLDER = "Choose the currency";
const RANGE_CURRENCY_REQUIRED = "This account holds support in more than one currency, so the range names the one currency it was " + "reviewed in: a range that names none is refused rather than totalled across them.";
const RANGE_CURRENCY_DESCRIPTION = "The currency these figures were reviewed in. Figures are reported on the same basis as every other " + "amount in this application, and only this period's are reported.";
const RANGE_OPTIONAL_NOTE = "Leave both dates empty to share no financial figure with this coach at all.";
const RANGE_TOO_EARLY = "Range to is before Range from, so these two dates describe no period.";
const RANGE_REVERSED = "This range ends before it starts, so no figure could be reported for it once the person accepts. " + "Nothing is sent while the two dates describe no period: move Range to to the same day as Range from " + "or a later one.";
const RANGE_UNREADABLE = "A reviewed range cannot be chosen right now: the support source behind it cannot be read, so no period is " + "offered rather than a zero or a guessed figure. The invitation itself can still be recorded without one.";
const RANGE_REVIEW_TERM = "Reviewed financial range";
const RANGE_REVIEW_NONE = "No financial range: this invitation shares no support figure of any kind.";
const RANGE_REVIEW_NOT_READABLE = "Nothing from your support view is readable to this person until they accept the invitation, and only " + "the figures for the period above are ever reported.";

const FIELD_LABELS: Readonly<Record<string, string | undefined>> = {
  [RECIPIENT_FIELD]: RECIPIENT_LABEL,
  [ORGANIZATION_FIELD]: ORGANIZATION_LABEL,
  [MINISTRY_FIELD]: MINISTRY_LABEL,
  [DURATION_FIELD]: DURATION_WORDING.legend,
  [`${DURATION_FIELD}.shareThroughDate`]: DURATION_WORDING.dateLabel,
  [`${DURATION_FIELD}.throughDate`]: DURATION_WORDING.dateLabel,
  [RANGE_FIELD]: RANGE_HEADING,
  [RANGE_FROM_FIELD]: RANGE_FROM_LABEL,
  [RANGE_TO_FIELD]: RANGE_TO_LABEL,
  [RANGE_CURRENCY_FIELD]: RANGE_CURRENCY_LABEL,
};

// ---------------------------------------------------------------------------------------------
// The values, the one payload type, and what the schema still requires of it
// ---------------------------------------------------------------------------------------------

/** The reviewed range as the form holds it: two calendar dates as their fields state them, and the one currency chosen. */
type RangeValue = { readonly fromDate: string; readonly toDate: string; readonly currency: string };

type InvitationFormValues = { coachPrincipalId: string; organizationId: string; ministryId: string; duration: DurationValue | null; financialRange: RangeValue | null };

/** Nothing is chosen yet, no module is switched on and no range is stated, so the form opens in the state an invitation must start in. */
const INITIAL_VALUES: InvitationFormValues = { coachPrincipalId: "", organizationId: "", ministryId: "", duration: null, financialRange: null };

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

/** Whether the worker is stating a range at all: a currency on its own shares nothing, so only the dates decide it. */
function statesRange(value: RangeValue | null): boolean {
  return value !== null && (value.fromDate.trim() !== "" || value.toDate.trim() !== "");
}

/** The one currency a range is reviewed in: the chosen one, or the only currency the source holds when it holds one. */
function currencyOf(value: RangeValue | null, rangeCurrencies: readonly string[]): string {
  const chosen = value?.currency.trim() ?? "";
  if (chosen !== "") return chosen;
  return rangeCurrencies.length === 1 ? (rangeCurrencies[0] ?? "") : "";
}

/**
 * The range as the payload states it, or nothing at all when the worker states no range. A stated range keeps its dates
 * exactly as the fields hold them — including one the worker has not chosen yet — so the schema names what is missing
 * rather than this form inviting a coach over a shorter period than the one being reviewed.
 */
function rangeOf(value: RangeValue | null, rangeCurrencies: readonly string[]): InvitationPayload["financialRange"] {
  if (value === null || !statesRange(value)) return undefined;
  const currency = currencyOf(value, rangeCurrencies);
  return { fromDate: value.fromDate.trim(), toDate: value.toDate.trim(), ...(currency === "" ? {} : { currency }) };
}

/** Whether two stated dates describe no period at all: such a pair is never sent, because no figure could be read for it. */
function rangeReversedOf(value: RangeValue | null): boolean {
  if (value === null) return false;
  const from = value.fromDate.trim();
  const to = value.toDate.trim();
  return from !== "" && to !== "" && to < from;
}

/**
 * The currency fact this payload still lacks that the schema cannot express: a range states the currency it was reviewed
 * in whenever the source holds more than one, and the schema knows nothing of how many the source holds. The mutation
 * refuses such a range in its own words, so this only names the fact before a submission reaches it.
 */
function rangeCurrencyOutstanding(value: RangeValue | null, rangeCurrencies: readonly string[]): boolean {
  return statesRange(value) && rangeCurrencies.length > 1 && currencyOf(value, rangeCurrencies) === "";
}

function payloadOf(values: InvitationFormValues, rangeCurrencies: readonly string[]): InvitationPayload {
  const financialRange = rangeOf(values.financialRange, rangeCurrencies);
  return { coachPrincipalId: values.coachPrincipalId.trim(), organizationId: values.organizationId.trim(), ministryId: values.ministryId.trim(), modules: UNSELECTED_MODULES, duration: durationOf(values.duration), ...(financialRange === undefined ? {} : { financialRange }) };
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

type RangeDateFieldProps = { readonly name: string; readonly label: string; readonly description: string; readonly value: string; readonly min?: string; readonly max?: string; readonly error: readonly string[] | undefined; readonly locale: string; readonly onChange: (next: string) => void };

/**
 * One calendar day of the reviewed range: a native date field, which is the control this application enters a civil date
 * through, so the value is a civil day rather than a fabricated midnight. The paired day bounds it where the range is
 * being stated, so the calendar a worker opens cannot offer a pair that describes no period.
 */
function RangeDateField({ name, label, description, value, min, max, error, locale, onChange }: RangeDateFieldProps): ReactElement {
  return (
    <FormField name={name} label={label} description={description} error={error}>
      {(control) => (
        <Input
          id={control.id}
          type="date"
          lang={locale}
          value={value}
          min={min === "" ? undefined : min}
          max={max === "" ? undefined : max}
          aria-describedby={control.describedBy}
          aria-invalid={control.invalid ? true : undefined}
          onChange={(event) => {
            onChange(event.currentTarget.value);
          }}
          className="w-full sm:max-w-60"
        />
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

/**
 * The reviewed range as the confirmation states it: the two exact calendar days and the one currency that would be
 * recorded, or the plain statement that this invitation shares no figure. The period and the currency are shown as the
 * payload carries them rather than as the fields happen to display them, so the review can never promise a wider share
 * than the mutation records.
 */
function ReviewedRange({ value, rangeCurrencies }: { readonly value: RangeValue | null; readonly rangeCurrencies: readonly string[] }): ReactElement {
  const term = <dt className="font-medium text-foreground">{RANGE_REVIEW_TERM}</dt>;
  if (value === null || !statesRange(value)) {
    return (
      <div className="flex min-w-0 flex-col gap-1">
        {term}
        <dd className="min-w-0 text-pretty">{RANGE_REVIEW_NONE}</dd>
      </div>
    );
  }
  const currency = currencyOf(value, rangeCurrencies);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {term}
      <dd className="flex min-w-0 flex-col gap-1">
        <span className="flex flex-wrap items-baseline gap-x-1.5">
          <bdi className="mono-identifier">{value.fromDate.trim() === "" ? RANGE_FROM_LABEL : value.fromDate.trim()}</bdi>
          <span>to</span>
          <bdi className="mono-identifier">{value.toDate.trim() === "" ? RANGE_TO_LABEL : value.toDate.trim()}</bdi>
          {currency === "" ? null : (
            <>
              <span>in</span>
              <bdi className="mono-identifier">{currency}</bdi>
            </>
          )}
        </span>
        <span className="text-pretty text-muted-foreground">{RANGE_REVIEW_NOT_READABLE}</span>
      </dd>
    </div>
  );
}

type ReviewedInvitationProps = { readonly values: InvitationFormValues; readonly recipientOptions: readonly ChoiceOption[]; readonly organizationOptions: readonly ChoiceOption[]; readonly ministryOptions: readonly ChoiceOption[]; readonly rangeCurrencies: readonly string[] };

function ReviewedInvitation({ values, recipientOptions, organizationOptions, ministryOptions, rangeCurrencies }: ReviewedInvitationProps): ReactElement {
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
      <ReviewedRange value={values.financialRange} rangeCurrencies={rangeCurrencies} />
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
export default function InvitationForm({ candidates, rangeCurrencies, scope, expectedRevision, locale, onInvited, className }: InvitationFormProps): ReactElement {
  const headingId = useId();
  const stagesId = useId();
  const modulesId = useId();
  const rangeId = useId();
  const gapId = useId();
  const rangeBlockedId = useId();
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
  // A range the service refused states its messages against the range itself, so they are shown on the group whose
  // facts they describe rather than against a field that does not carry the rule.
  const rangeMessages = fieldErrors === null ? undefined : fieldErrors.byField[RANGE_FIELD];
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
          const payload = payloadOf({ ...values, coachPrincipalId: admittedReference(values.coachPrincipalId, recipientOptions), organizationId: admittedReference(values.organizationId, organizationOptions), ministryId: admittedReference(values.ministryId, ministryOptions) }, rangeCurrencies);
          // The two dates are read as one fact: a pair that ends before it starts is refused here rather than sent to a
          // service that would refuse it, and a range in a source holding several currencies names the one it was
          // reviewed in before the mutation is asked, because only the surface knows how many the source holds.
          const rangeReversed = rangeReversedOf(values.financialRange);
          const outstanding = [...outstandingLabels(payload, values), ...(rangeCurrencyOutstanding(values.financialRange, rangeCurrencies) ? [RANGE_CURRENCY_LABEL] : [])];
          const rangeCurrencyChoices: readonly ChoiceOption[] = rangeCurrencies.map((currency) => ({ value: currency, label: currency }));
          const chosenCurrency = currencyOf(values.financialRange, rangeCurrencies);
          const setRange = (next: RangeValue): void => {
            form.setFieldValue(RANGE_FIELD, next);
            clearRefusal();
          };
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
              <Separator />
              {rangeCurrencies.length === 0 ? (
                // A source nothing could be read from is stated as that, never as a range of zero or as a period of its own.
                <section aria-labelledby={rangeId} className="flex min-w-0 flex-col gap-2">
                  <h3 id={rangeId} className="font-heading text-base font-medium">
                    {RANGE_HEADING}
                  </h3>
                  <p className="text-sm text-pretty text-muted-foreground">{RANGE_UNREADABLE}</p>
                </section>
              ) : (
                <FormFieldGroup legend={RANGE_HEADING} name={RANGE_FIELD} description={RANGE_LEAD} error={rangeMessages} optionalHint>
                  {() => (
                    <div className="flex min-w-0 flex-col gap-3">
                      <RangeDateField
                        name={RANGE_FROM_FIELD}
                        label={RANGE_FROM_LABEL}
                        description={RANGE_FROM_DESCRIPTION}
                        value={values.financialRange?.fromDate ?? ""}
                        max={values.financialRange?.toDate ?? ""}
                        error={fieldErrors?.byField[RANGE_FROM_FIELD]}
                        locale={locale}
                        onChange={(next) => {
                          setRange({ fromDate: next, toDate: values.financialRange?.toDate ?? "", currency: values.financialRange?.currency ?? "" });
                        }}
                      />
                      <RangeDateField
                        name={RANGE_TO_FIELD}
                        label={RANGE_TO_LABEL}
                        description={RANGE_TO_DESCRIPTION}
                        value={values.financialRange?.toDate ?? ""}
                        min={values.financialRange?.fromDate ?? ""}
                        error={rangeReversed ? [RANGE_TOO_EARLY] : fieldErrors?.byField[RANGE_TO_FIELD]}
                        locale={locale}
                        onChange={(next) => {
                          setRange({ fromDate: values.financialRange?.fromDate ?? "", toDate: next, currency: values.financialRange?.currency ?? "" });
                        }}
                      />
                      {rangeCurrencyChoices.length > 1 ? (
                        <ChoiceSelect
                          name={RANGE_CURRENCY_FIELD}
                          label={RANGE_CURRENCY_LABEL}
                          description={RANGE_CURRENCY_DESCRIPTION}
                          placeholder={RANGE_CURRENCY_PLACEHOLDER}
                          value={chosenCurrency}
                          options={rangeCurrencyChoices}
                          error={fieldErrors?.byField[RANGE_CURRENCY_FIELD]}
                          gapReason={null}
                          reasonId={undefined}
                          onSelect={(next) => {
                            setRange({ fromDate: values.financialRange?.fromDate ?? "", toDate: values.financialRange?.toDate ?? "", currency: next });
                          }}
                        />
                      ) : (
                        <p className="text-sm text-pretty text-muted-foreground">
                          {RANGE_CURRENCY_DESCRIPTION} <span>{`Every currency this source holds is ${chosenCurrency}, so a range is reviewed in it.`}</span>
                        </p>
                      )}
                      {rangeCurrencyChoices.length > 1 ? <p className="text-sm text-pretty text-muted-foreground">{RANGE_CURRENCY_REQUIRED}</p> : null}
                      <p className="text-sm text-pretty text-muted-foreground">{RANGE_OPTIONAL_NOTE}</p>
                    </div>
                  )}
                </FormFieldGroup>
              )}
              {outstanding.length === 0 ? null : <p className="text-sm text-pretty text-muted-foreground">{`${OUTSTANDING_LEAD} ${listOf(outstanding)}.`}</p>}
              {gap === null && !rangeReversed ? (
                <ActionReview<InvitationPayload>
                  title={REVIEW_TITLE}
                  description={<ReviewedInvitation values={values} recipientOptions={recipientOptions} organizationOptions={organizationOptions} ministryOptions={ministryOptions} rangeCurrencies={rangeCurrencies} />}
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
                  <Button type="button" disabled aria-describedby={gap === null ? rangeBlockedId : gapId}>
                    {CONFIRM_LABEL}
                  </Button>
                  <p id={gap === null ? rangeBlockedId : undefined} className="text-sm text-pretty text-muted-foreground">
                    {gap === null ? RANGE_REVERSED : GAP_ACTION_REASON}
                  </p>
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
