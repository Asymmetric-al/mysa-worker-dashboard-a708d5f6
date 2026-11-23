"use client";
import { useForm } from "@tanstack/react-form";
import { useCallback, useId, useState, type ReactElement } from "react";
import ActionReview from "@/components/action-review";
import { ChoiceGroup } from "@/components/choice-group";
import FormField, { civilDateConvention, FormFieldGroup, fieldErrorsFromInvalid } from "@/components/form-field";
import { Fact } from "@/components/fact";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import { parseCivilDate, serialiseCivilDate, type CivilDate } from "@/modules/time/civil";
import { COACHING_COPY, MODULE_COPY, SHARING_OUTCOME_COPY } from "../copy";
import { useInviteCoach } from "../hooks/use-coaching";
import { invitationPayloadSchema, type InvitationPayload } from "../schemas";
const DURATION_KINDS = ["ongoing", "through-date"] as const;
type DurationKind = (typeof DURATION_KINDS)[number];
type DurationValue = { readonly kind: "ongoing" } | { readonly kind: "through-date"; readonly throughDate: CivilDate | null };
type FrozenDurationCutoff = { readonly instant: string; readonly zone: string; readonly sourceLimitWins: boolean; readonly sourceLimit?: string | null };
type DurationControlProps = { readonly value: DurationValue | null; readonly onChange: (next: DurationValue | null) => void; readonly error?: string | null; readonly frozenCutoff?: FrozenDurationCutoff | null; readonly disabledReason?: string | null; readonly locale: string };
/** The wording the duration control states, in the two kinds a share can take; the object is its own type, so no second shape restates its keys. */
const DURATION_WORDING = {
  legend: "How long sharing runs",
  fieldLead: "A duration is required. Modules start switched off, and nothing is readable by a coach until the person accepts, so the choice below sets the most this invitation can ever cover.",
  missingIsNotPermission: "No duration is chosen yet, and a missing duration is not permission to share: the invitation cannot be submitted until one is chosen.",
  dateLabel: "Share through",
  dateDescription: "The last calendar date sharing should cover. It is a date as you would say it, with no time of day recorded, and the cutoff it produces is the start of the following day.",
  dateRequired: "Choose the Share-through date.",
  dateRefused: "This value could not be read as a calendar date in the form YYYY-MM-DD, so no date was recorded for it. The field is empty again: choose the date once more.",
  cutoffHeading: "When sharing ends",
  cutoffFixedBadge: "Cutoff fixed on acceptance",
  cutoffNotFixedBadge: "No cutoff yet",
  cutoffInstantLabel: "Share cutoff",
  cutoffZoneLabel: "Zone the cutoff was resolved in",
  cutoffExclusive: "The cutoff is the exclusive start of the civil day after the Share-through date: a read at that instant is refused, so the last day sharing covers is the day before it.",
  cutoffFrozenAtAcceptance: "This value was fixed when the invitation was accepted. Travelling, changing your display time zone or a later change to the source cannot move it.",
  chosenIsAMaximum: "The duration you chose is a maximum and not a guarantee: an earlier limit set by the source can end access sooner, and you can revoke access before the cutoff.",
  cutoffNotFixed: "The cutoff is fixed when the invitation is accepted. Until then this surface states the rule rather than a value.",
  cutoffNotProvisional: "No provisional cutoff is shown, because a provisional number would not be the one that governs access.",
  sourceLimitTitle: "An earlier limit from the source applies",
  sourceLimitWins: "A limit set by the source ends access before the date this invitation chose, and the earlier limit wins: the cutoff shown above is the source's, not the one chosen here.",
  sourceLimitUnknown: "A limit set by the source ends access before the date this invitation chose, and the earlier limit wins. Its own value cannot be read right now, so nothing is put in its place.",
  kinds: {
    ongoing: { label: "Ongoing, until you end it", hint: "Sharing has no end date. It stays open until you revoke it or the coaching relationship ends, whichever comes first." },
    "through-date": { label: "Through a date you choose", hint: "Sharing closes at the cutoff that date produces. Choose the last calendar date it should cover; the cutoff is stated once the invitation is accepted." },
  },
};
const isDurationKind = (value: unknown): value is DurationKind => value === "ongoing" || value === "through-date";
const statedReason = (reason: string | null | undefined): string | null => (reason === null || reason === undefined ? null : reason.trim() === "" ? null : reason);
function DurationControl({ value, onChange, error = null, frozenCutoff = null, disabledReason = null, locale }: DurationControlProps): ReactElement {
  const idPrefix = useId();
  const [refusedDateText, setRefusedDateText] = useState<string | null>(null);
  const reason = statedReason(disabledReason);
  const disabled = reason !== null;
  const kind = value?.kind ?? null;
  const throughDate = value?.kind === "through-date" ? value.throughDate : null;
  const civilDateText = throughDate === null ? "" : serialiseCivilDate(throughDate);
  const chooseKind = (next: unknown): void => {
    if (disabled || !isDurationKind(next) || next === kind) return;
    setRefusedDateText(null);
    onChange(next === "ongoing" ? { kind: "ongoing" } : { kind: "through-date", throughDate: null });
  };
  const changeDate = (nextText: string): void => {
    if (disabled) return;
    const parsed = nextText === "" ? null : parseCivilDate(nextText);
    const throughDate = parsed !== null && parsed.status === "parsed" ? parsed.date : null;
    setRefusedDateText(parsed !== null && throughDate === null ? DURATION_WORDING.dateRefused : null);
    onChange({ kind: "through-date", throughDate });
  };
  const dateDescription = reason ?? (throughDate === null ? `${DURATION_WORDING.dateDescription} ${DURATION_WORDING.dateRequired}` : DURATION_WORDING.dateDescription);
  return (
    <div data-slot="duration-control" className="flex min-w-0 flex-col gap-6">
      <FormFieldGroup legend={DURATION_WORDING.legend} name="duration" description={reason ?? (kind === null ? `${DURATION_WORDING.fieldLead} ${DURATION_WORDING.missingIsNotPermission}` : DURATION_WORDING.fieldLead)} error={error ?? undefined} required>
        {(group) => <ChoiceGroup frame={group} value={kind} choices={DURATION_KINDS} wording={DURATION_WORDING.kinds} idPrefix={`${idPrefix}-duration`} onChange={chooseKind} disabled={disabled} />}
      </FormFieldGroup>
      {kind === "through-date" ? (
        <FormField label={DURATION_WORDING.dateLabel} name="duration.throughDate" description={`${dateDescription} ${civilDateConvention(civilDateText)}`} error={refusedDateText ?? undefined} required>
          {(field) => <Input id={field.id} type="date" lang={locale} value={civilDateText} disabled={disabled} aria-describedby={field.describedBy} aria-invalid={field.invalid} aria-required={field.required} onChange={(event) => changeDate(event.currentTarget.value)} className="w-full sm:max-w-60" />}
        </FormField>
      ) : null}
      <DurationCutoffPanel frozenCutoff={frozenCutoff} />
    </div>
  );
}
/** The two facts a fixed cutoff states beside its own rule: the instant and the zone it was resolved in, written once and read by the one list below. */
const CUTOFF_FACTS: readonly { readonly label: string; readonly className: string; readonly value: (cutoff: FrozenDurationCutoff) => string }[] = [
  { label: DURATION_WORDING.cutoffInstantLabel, className: "tabular-figures text-sm wrap-anywhere", value: (cutoff) => cutoff.instant },
  { label: DURATION_WORDING.cutoffZoneLabel, className: "text-sm wrap-anywhere", value: (cutoff) => cutoff.zone },
];
function DurationCutoffPanel({ frozenCutoff }: { readonly frozenCutoff: FrozenDurationCutoff | null }): ReactElement {
  const sourceLimit = frozenCutoff === null ? null : statedReason(frozenCutoff.sourceLimit);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h3 className="type-subsection-title">{DURATION_WORDING.cutoffHeading}</h3>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3">
        <div>
          <Badge variant={frozenCutoff === null ? "outline" : "secondary"}>{frozenCutoff === null ? DURATION_WORDING.cutoffNotFixedBadge : DURATION_WORDING.cutoffFixedBadge}</Badge>
        </div>
        {frozenCutoff === null ? (
          <>
            <p className="type-supporting">{DURATION_WORDING.cutoffNotFixed}</p>
            <p className="type-supporting">{DURATION_WORDING.cutoffNotProvisional}</p>
          </>
        ) : (
          <>
            <dl className="flex min-w-0 flex-col gap-3">
              {CUTOFF_FACTS.map((fact) => (
                <div key={fact.label} className="flex min-w-0 flex-col gap-0.5">
                  <dt className="text-sm font-medium">{fact.label}</dt>
                  <dd className={fact.className}>
                    <bdi>{fact.value(frozenCutoff)}</bdi>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="type-supporting">{DURATION_WORDING.cutoffExclusive}</p>
            <p className="type-supporting">{DURATION_WORDING.cutoffFrozenAtAcceptance}</p>
            <p className="type-supporting">{DURATION_WORDING.chosenIsAMaximum}</p>
            {frozenCutoff.sourceLimitWins ? (
              <>
                <Separator />
                <Alert role={undefined}>
                  <AlertTitle>{DURATION_WORDING.sourceLimitTitle}</AlertTitle>
                  <AlertDescription>
                    <p>{sourceLimit === null ? DURATION_WORDING.sourceLimitUnknown : DURATION_WORDING.sourceLimitWins}</p>
                    {sourceLimit === null ? null : (
                      <p className="mt-1">
                        <bdi>{sourceLimit}</bdi>
                      </p>
                    )}
                  </AlertDescription>
                </Alert>
              </>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
type InvitationCandidates = {
  readonly recipients: ReadonlyArray<{ readonly principalId: string; readonly displayName: string }>;
  readonly organizations: ReadonlyArray<{ readonly organizationId: string; readonly displayName: string }>;
  readonly ministries: ReadonlyArray<{ readonly ministryId: string; readonly displayName: string }>;
};
/**
 * The props of {@link InvitationForm}: the admitted choices, the currencies this session's support source holds, and the
 * context and revision the mutation is submitted under. `rangeCurrencies` is the read's own answer: a reviewed range
 * names one of them and nothing else, and an empty list offers no range at all, because a source nothing can be read
 * from is never a zero figure.
 */
export type InvitationFormProps = { readonly candidates: InvitationCandidates; readonly rangeCurrencies: readonly string[]; readonly scope: Scope; readonly expectedRevision: string; readonly locale: string; readonly onInvited?: (outcome: MutationOutcome) => void; readonly className?: string };
const SECTION_LEAD = COACHING_COPY.sharing.purpose;
const MODULES_HEADING = "Five modules, each starting unselected";
const MODULE_STATE_WORD = "Starts unselected";
const RECIPIENT_FIELD = "coachPrincipalId";
const ORGANIZATION_FIELD = "organizationId";
const MINISTRY_FIELD = "ministryId";
const DURATION_FIELD = "duration";
const RECIPIENT_LABEL = "Coach";
const ORGANIZATION_LABEL = "Organization";
const MINISTRY_LABEL = "Ministry";
type ChoiceFieldName = typeof RECIPIENT_FIELD | typeof ORGANIZATION_FIELD | typeof MINISTRY_FIELD;
const CHOICE_FIELDS: readonly { readonly name: ChoiceFieldName; readonly label: string; readonly description: string; readonly placeholder: string }[] = [
  { name: RECIPIENT_FIELD, label: RECIPIENT_LABEL, description: "The named person this invitation is for, chosen from the coaches your own coaching records already name. A typed name or address would establish nothing: an address that looks the same verifies nobody.", placeholder: "Choose the person to invite" },
  { name: ORGANIZATION_FIELD, label: ORGANIZATION_LABEL, description: "The organization this invitation is recorded under, chosen from those admitted to this context.", placeholder: "Choose the organization" },
  { name: MINISTRY_FIELD, label: MINISTRY_LABEL, description: "The one ministry this invitation covers. A coach reads nothing outside the ministry chosen here.", placeholder: "Choose the ministry" },
];
const NOT_CHOSEN = "Not chosen";
const CONFIRM_LABEL = "Record invitation";
const NO_RECIPIENTS = "No coach is named in your own coaching records yet, so there is no one this surface can invite.";
const NO_ORGANIZATIONS = "No organization is admitted in this context.";
const NO_MINISTRIES = "No ministry is admitted in this context.";
const RANGE_FIELD = "financialRange"; // The reviewed financial range: the one fact an invitation may carry and may equally leave out. It is a separate decision from the modules, so the wording never presents it as part of them and never presents silence as a zero.
const RANGE_FROM_FIELD = "financialRange.fromDate";
const RANGE_TO_FIELD = "financialRange.toDate";
const RANGE_CURRENCY_FIELD = "financialRange.currency";
const RANGE_COPY = {
  heading: "A reviewed financial range",
  lead: "Financial sharing is a separate decision from the modules above, and it is optional. Set the two dates only if you want your coach to read support figures for that fixed period: a range never widens to all history, and an invitation with no dates shares no figure at all.",
  fromLabel: "Range from",
  toLabel: "Range to",
  currencyLabel: "Currency",
  fromDescription: "The first calendar date this range covers. It is a date as you would say it, with no time of day recorded.",
  toDescription: "The last calendar date this range covers, and the range includes this day. Nothing after it is ever reported.",
  currencyPlaceholder: "Choose the currency",
  currencyRequired: "This account holds support in more than one currency, so the range names the one currency it was reviewed in: a range that names none is refused rather than totalled across them.",
  currencyDescription: "The currency these figures were reviewed in. Figures are reported on the same basis as every other amount in this application, and only this period's are reported.",
  optionalNote: "Leave both dates empty to share no financial figure with this coach at all.",
  tooEarly: "Range to is before Range from, so these two dates describe no period.",
  reversed: "This range ends before it starts, so no figure could be reported for it once the person accepts. Nothing is sent while the two dates describe no period: move Range to to the same day as Range from or a later one.",
  unreadable: "A reviewed range cannot be chosen right now: the support source behind it cannot be read, so no period is offered rather than a zero or a guessed figure. The invitation itself can still be recorded without one.",
  reviewTerm: "Reviewed financial range",
  reviewNone: "No financial range: this invitation shares no support figure of any kind.",
  reviewNotReadable: "Nothing from your support view is readable to this person until they accept the invitation, and only the figures for the period above are ever reported.",
  singleCurrency: (currency: string): string => `Every currency this source holds is ${currency}, so a range is reviewed in it.`,
} as const;
const RANGE_DAYS: readonly { readonly key: "fromDate" | "toDate"; readonly name: string; readonly label: string; readonly description: string }[] = [
  { key: "fromDate", name: RANGE_FROM_FIELD, label: RANGE_COPY.fromLabel, description: RANGE_COPY.fromDescription },
  { key: "toDate", name: RANGE_TO_FIELD, label: RANGE_COPY.toLabel, description: RANGE_COPY.toDescription },
];
const EMPTY_RANGE: RangeValue = { fromDate: "", toDate: "", currency: "" };
const FIELD_LABELS: Readonly<Record<string, string | undefined>> = {
  [RECIPIENT_FIELD]: RECIPIENT_LABEL,
  [ORGANIZATION_FIELD]: ORGANIZATION_LABEL,
  [MINISTRY_FIELD]: MINISTRY_LABEL,
  [DURATION_FIELD]: DURATION_WORDING.legend,
  [`${DURATION_FIELD}.shareThroughDate`]: DURATION_WORDING.dateLabel,
  [`${DURATION_FIELD}.throughDate`]: DURATION_WORDING.dateLabel,
  [RANGE_FIELD]: RANGE_COPY.heading,
  [RANGE_FROM_FIELD]: RANGE_COPY.fromLabel,
  [RANGE_TO_FIELD]: RANGE_COPY.toLabel,
  [RANGE_CURRENCY_FIELD]: RANGE_COPY.currencyLabel,
};
/** The reviewed range as the form holds it: two calendar dates as their fields state them, and the one currency chosen. */
type RangeValue = { readonly fromDate: string; readonly toDate: string; readonly currency: string };
type InvitationFormValues = { coachPrincipalId: string; organizationId: string; ministryId: string; duration: DurationValue | null; financialRange: RangeValue | null };
/** Nothing is chosen yet, no module is switched on and no range is stated, so the form opens in the state an invitation must start in. */
const INITIAL_VALUES: InvitationFormValues = { coachPrincipalId: "", organizationId: "", ministryId: "", duration: null, financialRange: null };
const UNSELECTED_MODULES = { "support-goal": false, "support-results": false, targets: false, "check-ins": false, "task-summaries": false } satisfies InvitationPayload["modules"];
const isoDateOf = (date: CivilDate | null): string => (date === null ? "" : serialiseCivilDate(date));
const durationOf = (value: DurationValue | null): InvitationPayload["duration"] => (value === null ? { kind: "through-date", shareThroughDate: "" } : value.kind === "ongoing" ? { kind: "ongoing" } : { kind: "through-date", shareThroughDate: isoDateOf(value.throughDate) });
/** Whether the worker is stating a range at all: a currency on its own shares nothing, so only the dates decide it. */
const statesRange = (value: RangeValue | null): boolean => value !== null && (value.fromDate.trim() !== "" || value.toDate.trim() !== "");
/** The one currency a range is reviewed in: the chosen one, or the only currency the source holds when it holds one. */
const currencyOf = (value: RangeValue | null, rangeCurrencies: readonly string[]): string => {
  const chosen = value?.currency.trim() ?? "";
  return chosen !== "" ? chosen : rangeCurrencies.length === 1 ? (rangeCurrencies[0] ?? "") : "";
};
/** Whether two stated dates describe no period at all: such a pair is never sent, because no figure could be read for it. */
const rangeReversedOf = (value: RangeValue | null): boolean => value !== null && value.fromDate.trim() !== "" && value.toDate.trim() !== "" && value.toDate.trim() < value.fromDate.trim();
/**
 * The range as the payload states it, or nothing at all when the worker states no range. A stated range keeps its dates
 * exactly as the fields hold them — including one not chosen yet — so the schema names what is missing rather than this
 * form inviting a coach over a shorter period than the one being reviewed.
 */
function rangeOf(value: RangeValue | null, rangeCurrencies: readonly string[]): InvitationPayload["financialRange"] {
  if (value === null || !statesRange(value)) return undefined;
  const currency = currencyOf(value, rangeCurrencies);
  return { fromDate: value.fromDate.trim(), toDate: value.toDate.trim(), ...(currency === "" ? {} : { currency }) };
}
/** The currency fact this payload still lacks that the schema cannot express, because it knows nothing of how many the source holds. */
const rangeCurrencyOutstanding = (value: RangeValue | null, rangeCurrencies: readonly string[]): boolean => statesRange(value) && rangeCurrencies.length > 1 && currencyOf(value, rangeCurrencies) === "";
const payloadOf = (values: InvitationFormValues, rangeCurrencies: readonly string[]): InvitationPayload => {
  const financialRange = rangeOf(values.financialRange, rangeCurrencies);
  return { coachPrincipalId: values.coachPrincipalId.trim(), organizationId: values.organizationId.trim(), ministryId: values.ministryId.trim(), modules: UNSELECTED_MODULES, duration: durationOf(values.duration), ...(financialRange === undefined ? {} : { financialRange }) };
};
const labelForPath = (path: string, values: InvitationFormValues): string => (path === DURATION_FIELD || path === `${DURATION_FIELD}.shareThroughDate` ? (values.duration === null ? DURATION_WORDING.legend : DURATION_WORDING.dateLabel) : (FIELD_LABELS[path] ?? ""));
function outstandingLabels(payload: InvitationPayload, values: InvitationFormValues): readonly string[] {
  const parsed = invitationPayloadSchema.safeParse(payload);
  if (parsed.success) return [];
  const labels: string[] = [];
  for (const issue of parsed.error.issues) {
    const label = labelForPath(issue.path.join("."), values);
    if (label !== "" && !labels.includes(label)) labels.push(label);
  }
  return labels;
}
const listOf = (items: readonly string[]): string => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] ?? ""}`);
const describedByOf = (...ids: ReadonlyArray<string | undefined>): string | undefined => {
  const stated = ids.filter((id): id is string => id !== undefined && id.trim() !== "");
  return stated.length === 0 ? undefined : stated.join(" ");
};
type ChoiceOption = { readonly value: string; readonly label: string };
const recipientOptionsOf = (candidates: InvitationCandidates): readonly ChoiceOption[] => candidates.recipients.map((recipient) => ({ value: recipient.principalId, label: recipient.displayName }));
const organizationOptionsOf = (candidates: InvitationCandidates): readonly ChoiceOption[] => candidates.organizations.map((organization) => ({ value: organization.organizationId, label: organization.displayName }));
const ministryOptionsOf = (candidates: InvitationCandidates): readonly ChoiceOption[] => candidates.ministries.map((ministry) => ({ value: ministry.ministryId, label: ministry.displayName }));
function candidatesGap(candidates: InvitationCandidates): string | null {
  const missing = [candidates.recipients.length === 0 ? NO_RECIPIENTS : null, candidates.organizations.length === 0 ? NO_ORGANIZATIONS : null, candidates.ministries.length === 0 ? NO_MINISTRIES : null].filter((sentence): sentence is string => sentence !== null);
  return missing.length === 0 ? null : missing.join(" ");
}
const chosenName = (options: readonly ChoiceOption[], value: string): string => options.find((option) => option.value === value)?.label ?? NOT_CHOSEN;
const admittedReference = (value: string, options: readonly ChoiceOption[]): string => (options.some((option) => option.value === value.trim()) ? value.trim() : "");
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
            if (next !== "" && !options.some((option) => option.value === next)) return;
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
const ReviewedFact = ({ term, value }: { readonly term: string; readonly value: string }): ReactElement => <Fact term={term}>{<bdi>{value}</bdi>}</Fact>;
type RangeDateFieldProps = { readonly name: string; readonly label: string; readonly description: string; readonly value: string; readonly min: string; readonly max: string; readonly error: readonly string[] | undefined; readonly locale: string; readonly onChange: (next: string) => void };
/**
 * One calendar day of the reviewed range: a native date field, which is the control this application enters a civil day
 * through, so the value is a civil day rather than a fabricated midnight. The paired day bounds it while the range is
 * being stated, so the calendar a worker opens cannot offer a pair that describes no period.
 */
const RangeDateField = ({ name, label, description, value, min, max, error, locale, onChange }: RangeDateFieldProps): ReactElement => (
  <FormField name={name} label={label} description={`${description} ${civilDateConvention(value)}`} error={error}>
    {(control) => (
      <Input id={control.id} type="date" lang={locale} value={value} min={min === "" ? undefined : min} max={max === "" ? undefined : max} aria-describedby={control.describedBy} aria-invalid={control.invalid ? true : undefined} onChange={(event) => onChange(event.currentTarget.value)} className="w-full sm:max-w-60" />
    )}
  </FormField>
);
function ReviewedDuration({ value }: { readonly value: DurationValue | null }): ReactElement {
  const term = DURATION_WORDING.legend;
  if (value === null) return <Fact {...{ term, detailClassName: "min-w-0 text-pretty" }}>{DURATION_WORDING.missingIsNotPermission}</Fact>;
  const wording = DURATION_WORDING.kinds[value.kind];
  const date = value.kind === "through-date" ? isoDateOf(value.throughDate) : "";
  return (
    <Fact term={term} detailClassName="flex min-w-0 flex-col gap-1">
      <span className="font-medium">{wording.label}</span>
      {value.kind !== "through-date" ? null : date === "" ? <span>{DURATION_WORDING.dateRequired}</span> : <bdi className="mono-identifier">{date}</bdi>}
      <span className="text-pretty text-muted-foreground">{wording.hint}</span>
    </Fact>
  );
}
/**
 * The reviewed range as the confirmation states it: the two exact calendar days and the one currency that would be
 * recorded, or the plain statement that this invitation shares no figure. The period and the currency are shown as the
 * payload carries them, so the review can never promise a wider share than the mutation records.
 */
const ReviewedRange = ({ value, rangeCurrencies }: { readonly value: RangeValue | null; readonly rangeCurrencies: readonly string[] }): ReactElement => {
  const term = RANGE_COPY.reviewTerm;
  if (value === null || !statesRange(value)) return <Fact {...{ term, detailClassName: "min-w-0 text-pretty" }}>{RANGE_COPY.reviewNone}</Fact>;
  const currency = currencyOf(value, rangeCurrencies);
  return (
    <Fact term={term} detailClassName="flex min-w-0 flex-col gap-1">
      <span className="flex flex-wrap items-baseline gap-x-1.5">
        <bdi className="mono-identifier">{value.fromDate.trim() === "" ? RANGE_COPY.fromLabel : value.fromDate.trim()}</bdi>
        <span>{"to"}</span>
        <bdi className="mono-identifier">{value.toDate.trim() === "" ? RANGE_COPY.toLabel : value.toDate.trim()}</bdi>
        {currency === "" ? null : (
          <>
            <span>{"in"}</span>
            <bdi className="mono-identifier">{currency}</bdi>
          </>
        )}
      </span>
      <span className="text-pretty text-muted-foreground">{RANGE_COPY.reviewNotReadable}</span>
    </Fact>
  );
};
type ReviewedInvitationProps = { readonly values: InvitationFormValues; readonly recipientOptions: readonly ChoiceOption[]; readonly organizationOptions: readonly ChoiceOption[]; readonly ministryOptions: readonly ChoiceOption[]; readonly rangeCurrencies: readonly string[] };
const ReviewedInvitation = ({ values, recipientOptions, organizationOptions, ministryOptions, rangeCurrencies }: ReviewedInvitationProps): ReactElement => (
  <dl className="flex min-w-0 flex-col gap-3">
    <ReviewedFact term={RECIPIENT_LABEL} value={chosenName(recipientOptions, values.coachPrincipalId)} />
    <ReviewedFact term={ORGANIZATION_LABEL} value={chosenName(organizationOptions, values.organizationId)} />
    <ReviewedFact term={MINISTRY_LABEL} value={chosenName(ministryOptions, values.ministryId)} />
    <Fact term={MODULES_HEADING}>
      <ul className="flex min-w-0 list-disc flex-col gap-1 ps-4">
        {Object.entries(MODULE_COPY).map(([key, wording]) => (
          <li key={key} className="min-w-0">
            <span className="font-medium">{wording.name}</span>
            <span className="text-muted-foreground">{` — ${MODULE_STATE_WORD}`}</span>
          </li>
        ))}
      </ul>
    </Fact>
    <ReviewedDuration value={values.duration} />
    <ReviewedRange value={values.financialRange} rangeCurrencies={rangeCurrencies} />
  </dl>
);
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
  const submit = useCallback((input: MutationInput<InvitationPayload>): Promise<MutationOutcome> => mutateAsync({ operationId: input.operationId, scope: input.scope, expectedRevision: input.expectedRevision, payload: input.payload }), [mutateAsync]);
  const handleSettled = useCallback(
    (outcome: MutationOutcome): void => {
      setSettledOutcome(outcome);
      onInvited?.(outcome);
    },
    [onInvited],
  );
  const fieldErrors = settledOutcome !== null && settledOutcome.outcome === "invalid" ? fieldErrorsFromInvalid(settledOutcome) : null;
  const clearRefusal = useCallback((): void => setSettledOutcome(null), []);
  const recordDuration = (next: DurationValue | null): void => {
    form.setFieldValue(DURATION_FIELD, next);
    clearRefusal();
  };
  const chooseOption = (name: ChoiceFieldName, next: string): void => {
    form.setFieldValue(name, next);
    clearRefusal();
  };
  const gap = candidatesGap(candidates);
  const recipientOptions = recipientOptionsOf(candidates);
  const organizationOptions = organizationOptionsOf(candidates);
  const ministryOptions = ministryOptionsOf(candidates);
  const optionsByField: Readonly<Record<ChoiceFieldName, readonly ChoiceOption[]>> = { [RECIPIENT_FIELD]: recipientOptions, [ORGANIZATION_FIELD]: organizationOptions, [MINISTRY_FIELD]: ministryOptions };
  const durationMessages = fieldErrors === null ? undefined : (fieldErrors.byField[DURATION_FIELD] ?? fieldErrors.byField[`${DURATION_FIELD}.shareThroughDate`] ?? fieldErrors.byField[`${DURATION_FIELD}.throughDate`]);
  const rangeMessages = fieldErrors === null ? undefined : fieldErrors.byField[RANGE_FIELD]; // A range the service refused states its messages against the range itself, so they are shown on the group whose facts they describe rather than against a field that carries no rule.
  const recorded = settledOutcome !== null && (settledOutcome.outcome === "accepted" || settledOutcome.outcome === "alreadyAccepted");
  return (
    <section data-slot="invitation-form" aria-labelledby={headingId} className={cn("flex min-w-0 flex-col gap-6", className)}>
      <div className="flex min-w-0 flex-col gap-2">
        <h2 {...{ id: headingId, className: "type-section-title" }}>{"Invite a coach"}</h2>
        <p className="type-supporting text-pretty">{SECTION_LEAD}</p>
      </div>
      <section aria-labelledby={stagesId} className="flex min-w-0 flex-col gap-2">
        <h3 {...{ id: stagesId, className: "type-subsection-title" }}>{"What an invitation does, and what it never does"}</h3>
        <p className="type-supporting text-pretty">{"These four things are separate outcomes, and recording an invitation reaches only the first: it sends no message, verifies nobody and makes nothing readable."}</p>
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
        <Alert id={gapId} role={undefined}>
          <AlertTitle>{"No admitted choice is available for this invitation"}</AlertTitle>
          <AlertDescription>
            <p>{gap}</p>
            <p>{"An invitation needs one admitted person, organization and ministry, so nothing can be submitted from this surface until the source admits them."}</p>
          </AlertDescription>
        </Alert>
      )}
      <form.Subscribe selector={(state) => state.values}>
        {(values) => {
          const payload = payloadOf({ ...values, coachPrincipalId: admittedReference(values.coachPrincipalId, recipientOptions), organizationId: admittedReference(values.organizationId, organizationOptions), ministryId: admittedReference(values.ministryId, ministryOptions) }, rangeCurrencies);
          // The two dates are read as one fact: a pair that ends before it starts is refused here rather than sent to a service that would refuse it, and a range in a source holding several currencies names the one it was reviewed in before the mutation is asked.
          const rangeReversed = rangeReversedOf(values.financialRange);
          const outstanding = [...outstandingLabels(payload, values), ...(rangeCurrencyOutstanding(values.financialRange, rangeCurrencies) ? [RANGE_COPY.currencyLabel] : [])];
          const rangeCurrencyChoices: readonly ChoiceOption[] = rangeCurrencies.map((currency) => ({ value: currency, label: currency }));
          const chosenCurrency = currencyOf(values.financialRange, rangeCurrencies);
          const currentRange = values.financialRange ?? EMPTY_RANGE;
          const setRange = (next: RangeValue): void => {
            form.setFieldValue(RANGE_FIELD, next);
            clearRefusal();
          };
          return (
            <div className="flex min-w-0 flex-col gap-6">
              {CHOICE_FIELDS.map((choice) => (
                <ChoiceSelect
                  key={choice.name}
                  name={choice.name}
                  label={choice.label}
                  description={choice.description}
                  placeholder={choice.placeholder}
                  value={values[choice.name]}
                  options={optionsByField[choice.name]}
                  error={fieldErrors?.byField[choice.name]}
                  gapReason={gap}
                  reasonId={gapId}
                  onSelect={(next) => chooseOption(choice.name, next)}
                />
              ))}
              <Separator />
              <section aria-labelledby={modulesId} className="flex min-w-0 flex-col gap-2">
                <h3 {...{ id: modulesId, className: "type-subsection-title" }}>{MODULES_HEADING}</h3>
                <p className="type-supporting text-pretty">{"Every module is recorded as switched off when the invitation is created. You choose which ones to switch on once the person has accepted, so nothing here pre-selects a module and no module can be read before then."}</p>
                <ul className="flex min-w-0 flex-col gap-3">
                  {Object.entries(MODULE_COPY).map(([key, wording]) => (
                    <li key={key} className="flex min-w-0 flex-col gap-0.5">
                      <p className="type-body">
                        <span className="font-medium text-foreground">{wording.name}</span>
                        <span className="text-muted-foreground">{` — ${MODULE_STATE_WORD}`}</span>
                      </p>
                      <p className="type-supporting text-pretty">{wording.description}</p>
                    </li>
                  ))}
                </ul>
              </section>
              <Separator />
              <DurationControl value={values.duration} onChange={recordDuration} error={durationMessages === undefined ? null : durationMessages.join(" ")} locale={locale} />
              <Separator />
              {rangeCurrencies.length === 0 ? (
                // A source nothing could be read from is stated as that, never as a range of zero or as a period of its own.
                <section aria-labelledby={rangeId} className="flex min-w-0 flex-col gap-2">
                  <h3 id={rangeId} className="type-subsection-title">
                    {RANGE_COPY.heading}
                  </h3>
                  <p className="type-supporting text-pretty">{RANGE_COPY.unreadable}</p>
                </section>
              ) : (
                <FormFieldGroup legend={RANGE_COPY.heading} name={RANGE_FIELD} description={RANGE_COPY.lead} error={rangeMessages} optionalHint>
                  {() => (
                    <div className="flex min-w-0 flex-col gap-3">
                      {RANGE_DAYS.map((day) => (
                        <RangeDateField
                          key={day.name}
                          name={day.name}
                          label={day.label}
                          description={day.description}
                          value={currentRange[day.key]}
                          min={day.key === "toDate" ? currentRange.fromDate : ""}
                          max={day.key === "fromDate" ? currentRange.toDate : ""}
                          error={day.key === "toDate" && rangeReversed ? [RANGE_COPY.tooEarly] : fieldErrors?.byField[day.name]}
                          locale={locale}
                          onChange={(next) => setRange(day.key === "fromDate" ? { ...currentRange, fromDate: next } : { ...currentRange, toDate: next })}
                        />
                      ))}
                      {rangeCurrencyChoices.length > 1 ? (
                        <ChoiceSelect
                          name={RANGE_CURRENCY_FIELD}
                          label={RANGE_COPY.currencyLabel}
                          description={RANGE_COPY.currencyDescription}
                          placeholder={RANGE_COPY.currencyPlaceholder}
                          value={chosenCurrency}
                          options={rangeCurrencyChoices}
                          error={fieldErrors?.byField[RANGE_CURRENCY_FIELD]}
                          gapReason={null}
                          reasonId={undefined}
                          onSelect={(next) => setRange({ ...currentRange, currency: next })}
                        />
                      ) : (
                        <p className="type-supporting text-pretty">{`${RANGE_COPY.currencyDescription} ${RANGE_COPY.singleCurrency(chosenCurrency)}`}</p>
                      )}
                      {rangeCurrencyChoices.length > 1 ? <p className="type-supporting text-pretty">{RANGE_COPY.currencyRequired}</p> : null}
                      <p className="type-supporting text-pretty">{RANGE_COPY.optionalNote}</p>
                    </div>
                  )}
                </FormFieldGroup>
              )}
              {outstanding.length === 0 ? null : <p className="type-supporting text-pretty">{`Still needed before this invitation can be recorded: ${listOf(outstanding)}.`}</p>}
              {gap === null && !rangeReversed ? (
                <ActionReview<InvitationPayload>
                  title={"Record this invitation"}
                  description={<ReviewedInvitation values={values} recipientOptions={recipientOptions} organizationOptions={organizationOptions} ministryOptions={ministryOptions} rangeCurrencies={rangeCurrencies} />}
                  consequence={"Recording an invitation adds the invitation record and nothing else: no message leaves this application, the person's identity is not verified, and no module becomes readable."}
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
                  <p id={gap === null ? rangeBlockedId : undefined} className="type-supporting text-pretty">
                    {gap === null ? RANGE_COPY.reversed : "Nothing can be submitted until the missing choice above is available."}
                  </p>
                </div>
              )}
              {recorded ? <p className="type-supporting text-pretty">{"Recording an invitation reached the first of the four outcomes above and no further: identity verification, deliberate acceptance and live access have not happened."}</p> : null}
            </div>
          );
        }}
      </form.Subscribe>
    </section>
  );
}
