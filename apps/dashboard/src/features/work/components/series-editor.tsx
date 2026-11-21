"use client";
/**
 * The one series editor: the create surface for a repeating plan, and the prospective "this and future"
 * revision of a plan that already exists.
 *
 * It states the closed rule and nothing beyond it — the five repeat profiles, a first due date, the planning
 * zone the dates are civil dates in, the interval and the day of the month only for the profiles that read
 * them, and an explicit end condition. A field the chosen profile does not read is emptied rather than
 * submitted as a stale value, the ongoing-personal-series policy is offered only where the envelope admits it,
 * and a revision names the explicit boundary it applies from so the dates before it keep the rule they were
 * planned under.
 *
 * What this file deliberately does not do: it computes no next date and resolves no month day. The rule is
 * judged by `../schemas/series`, the attempt's identity belongs to `useReviewedMutation`, `OperationResult` is
 * the one receipt, and pause, resume and stop are the one `SeriesStateControls`. The service resolves the dates
 * a rule produces, and `series-preview` states them.
 */
import { useForm } from "@tanstack/react-form";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import type { ZodError } from "zod";
import { intentKeyOf, mayReplay, useReviewedMutation } from "@/components/action-review";
import FormField, { fieldErrorsFromInvalid, FormErrorSummary, FormFieldGroup, type FieldErrorLookup, type FormFieldControl } from "@/components/form-field";
import OperationResult from "@/components/operation-result";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { MutationInput, ReadAction, Scope } from "@/modules/data-service/envelope";
import { invalid, UNIDENTIFIED_ATTEMPT, type MutationOutcome } from "@/modules/data-service/outcome";
import { parseCivilDate, serialiseCivilDate } from "@/modules/time/civil";
import type { RepeatProfile, SeriesEnd, SeriesState } from "@/modules/time/recurrence";
import { PAUSED_NOTE, STOPPED_NOTE } from "../copy/missed-dates";
import {
  DAY_OF_MONTH_LABEL,
  END_CONDITION_LABELS,
  END_COUNT_LABEL,
  END_DATE_LABEL,
  FIRST_DUE_DATE_HINT,
  FIRST_DUE_DATE_LABEL,
  INTERVAL_LABEL,
  INTERVAL_UNIT_LABELS,
  MISSING_MONTHLY_DAY_DISCLOSURE,
  ONGOING_POLICY_NOTE,
  PLANNING_TIME_ZONE_LABEL,
  PLANNING_TIME_ZONE_NOTE,
  REPEAT_PROFILE_DESCRIPTIONS,
  REPEAT_PROFILE_FIELDS,
  REPEAT_PROFILE_LABELS,
  REPEAT_PROFILE_ORDER,
} from "../copy/repeat-profiles";
import { useSeriesMutations } from "../hooks/use-series-mutations";
import { createSeriesSchema, editThisAndFutureSchema, type CreateSeriesPayload, type EditThisAndFuturePayload, type SeriesEndPayload } from "../schemas/series";
import { SeriesStateControls } from "./occurrence-actions";

// ---------------------------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------------------------

/** The end of a plan as a read states it: the same three shapes the schema admits, with the date as stored. */
export type SeriesEndFacts = { readonly kind: "on-date"; readonly on: string } | { readonly kind: "after-count"; readonly count: number } | { readonly kind: "ongoing-personal-policy" };

/** The rule a plan repeats by, as the envelope published it. */
export type SeriesRuleFacts = {
  readonly profile: RepeatProfile;
  readonly interval: number;
  /** Absent for a profile that takes no day of the month, so a value is never carried for a profile that would not read it. */
  readonly dayOfMonth: number | null;
  readonly firstDueOn: string;
  readonly planningTimeZone: string;
  readonly end: SeriesEndFacts;
};

/** An existing plan as the read stated it. The identity is the plan's own; nothing here is re-derived. */
export type SeriesEditorCurrent = { readonly title: string; readonly rule: SeriesRuleFacts };

/** What the open form holds. Every member is text, because every control is a text control. */
type SeriesFormValues = { title: string; category: string; note: string; firstDueOn: string; planningTimeZone: string; profile: RepeatProfile; interval: string; dayOfMonth: string; endKind: SeriesEnd["kind"]; endOn: string; endCount: string };

/** The values a host may hand back so an interrupted entry is restored rather than re-entered (WCAG 3.3.7 Redundant Entry). */
export type SeriesEditorInitialValues = Partial<SeriesFormValues>;

type SeriesPayload = CreateSeriesPayload | EditThisAndFuturePayload;

/** The outcomes a host can act on as a save. */
type AppliedOutcome = Extract<MutationOutcome, { readonly outcome: "accepted" | "alreadyAccepted" }>;
type ReceiptOutcome = Exclude<MutationOutcome, { readonly outcome: "invalid" }>;

interface SeriesEditorCommonProps {
  /** The authority this surface acts in, exactly as the envelope that admitted it reported it. Never re-derived here. */
  readonly scope: Scope;
  /** The revision the surface loaded: the collection's for a new plan, the plan's for a revision, so a stale write is a conflict rather than an overwrite. */
  readonly expectedRevision: string;
  /** The IANA zones this surface admits for planning; the plan's own zone is added when it is not already listed. */
  readonly planningTimeZoneChoices: readonly string[];
  /** Whether the qualified ongoing-personal-series policy applies to this worker, which is the only condition that offers a plan with no end. */
  readonly ongoingPolicyAdmitted: boolean;
  readonly initialValues?: SeriesEditorInitialValues;
  readonly headingLevel?: 2 | 3 | 4;
  /** Called once when an attempt settles as applied, so the host can re-read what it shows. */
  readonly onSaved?: (outcome: AppliedOutcome) => void;
  /** Reads one operation's result: supplied only by a host that can re-read an attempt whose acknowledgement was lost. */
  readonly onCheckResult?: () => void;
  /** The host's return path: it leaves before a save, and it leaves again once the receipt is what the worker has read. The host is also where the keyboard position returns, because it owns the control that opened this surface. */
  readonly onCancel?: () => void;
  readonly dir?: "ltr" | "rtl";
  readonly className?: string;
}

/**
 * The editor's contract. A new plan needs the collection's revision; a prospective revision needs the plan it
 * revises, the explicit boundary it applies from, its current state and the actions the envelope admitted.
 */
export type SeriesEditorProps =
  | (SeriesEditorCommonProps & { readonly mode: "create"; readonly current?: null | undefined })
  | (SeriesEditorCommonProps & { readonly mode: "edit-this-and-future"; readonly current: SeriesEditorCurrent; readonly seriesId: string; readonly effectiveFrom: string; readonly state: SeriesState; readonly actions: readonly ReadAction[] });

// ---------------------------------------------------------------------------------------------
// The closed sets, and the copy this surface owns
// ---------------------------------------------------------------------------------------------

const EMPTY_ACTIONS: readonly ReadAction[] = [];
const HEADING_TAG: Readonly<Record<2 | 3 | 4, "h2" | "h3" | "h4">> = { 2: "h2", 3: "h3", 4: "h4" };

/** The three end shapes in the order they are offered, typed against the closed union so a fourth shape cannot be listed. */
const END_KIND_ORDER = ["on-date", "after-count", "ongoing-personal-policy"] as const satisfies readonly SeriesEnd["kind"][];

/**
 * The unit an interval is stated in, or `null` for a profile that takes no interval. Keyed by the closed set,
 * so a sixth profile cannot compile and the interval field can never appear for a profile that does not read it.
 */
const INTERVAL_UNIT_OF_PROFILE: Readonly<Record<RepeatProfile, "weeks" | "months" | null>> = { none: null, weekly: null, everyNWeeks: "weeks", monthlyOnDay: null, everyNMonths: "months" };

/** A new plan opens weekly: the shortest rule that actually repeats, so the fields a worker has to consider appear with their real meaning on the first render. */
const DEFAULT_PROFILE: RepeatProfile = "weekly";

/** An end is always stated, and a date names when a plan stops rather than a count of dates it may still produce. */
const DEFAULT_END_KIND: SeriesEnd["kind"] = "on-date";

const CREATE_HEADING = "New repeating plan";
const REVISE_HEADING = "Revise this plan from a boundary";
const CREATE_FORM_HELP = "A plan needs a title, a first due date and the timezone it is planned in. Choose how it repeats and when it ends; the category and the note are optional.";
const REVISE_FORM_HELP = "This change revises the plan from the boundary above onward. The dates before that boundary, and every completed date, keep the rule they were planned under.";
const CREATE_RECEIPT_HEADING = "Creating this plan";
const REVISE_RECEIPT_HEADING = "Revising the plan";
const TITLE_LABEL = "Title";
const TITLE_DESCRIPTION = "The work this plan repeats, in a few words.";
const CATEGORY_LABEL = "Category";
const CATEGORY_DESCRIPTION = "Your own short label for finding similar plans; it is not a shared taxonomy and not a stage.";
const NOTE_LABEL = "Note";
const NOTE_DESCRIPTION = "A short reminder about this plan, kept with it. Writing it sends nothing and changes no other record.";
const PROFILE_LEGEND = "How this plan repeats";
const PROFILE_GROUP_DESCRIPTION = "This is a closed set: there is no custom interval beyond these profiles, and only a profile that reads an interval or a day of the month shows that field.";
const DAY_OF_MONTH_DESCRIPTION = MISSING_MONTHLY_DAY_DISCLOSURE;
const END_LEGEND = "When this plan ends";
const END_GROUP_DESCRIPTION = "Every plan states when it stops, so an end is always chosen: an end date, a number of occurrences, or — only where the policy applies — no end at all.";
const END_DATE_DESCRIPTION = "The last calendar date this plan may produce. It is a civil date, so it stays that date wherever you are.";
const END_COUNT_DESCRIPTION = "How many dates this plan may produce in total, counted from the first due date.";
const FIRST_DUE_DATE_LOCKED_NOTE = "The first due date belongs to the plan itself, so a prospective revision keeps it: only the rule from the boundary onward changes.";
const CURRENT_RULE_HEADING = "The rule in force now";
const EFFECTIVE_BOUNDARY_LABEL = "Takes effect from";
const EFFECTIVE_BOUNDARY_EXPLANATION = "The dates before that boundary keep the rule they were planned under, and completed history is untouched.";
const COMPLETED_HISTORY_NOTE = "Completed dates are never rewritten by this change: a revision only shapes the dates from the boundary onward.";
const STATE_DIFFERENCE_LEAD = "Paused and stopped are not the same:";
const STOPPED_ALERT_TITLE = "This plan is stopped";
const STOPPED_NO_REVISION_NOTE = "A stopped plan admits no further date and cannot be resumed, so there is no later rule for this change to revise. The rule it last used is shown above, unchanged.";
const NOT_STATED_TEXT = "Not stated";
const PENDING_SENTENCE = "Working: nothing else is submitted while this change is in flight.";
const CREATE_LABEL = "Create plan";
const REVISE_LABEL = "Apply this revision";
const SAVING_LABEL = "Saving…";
const CANCEL_LABEL = "Cancel";
const DONE_LABEL = "Done";

const TITLE_FIELD = "title";
const CATEGORY_FIELD = "category";
const NOTE_FIELD = "note";
const FIRST_DUE_ON_FIELD = "firstDueOn";
const PLANNING_TIME_ZONE_FIELD = "planningTimeZone";
const PROFILE_FIELD = "profile";
const INTERVAL_FIELD = "interval";
const DAY_OF_MONTH_FIELD = "dayOfMonth";
const END_FIELD = "end";
const END_ON_FIELD = "end.on";
const END_COUNT_FIELD = "end.count";
const FIELD_LABELS: Readonly<Record<string, string | undefined>> = {
  [TITLE_FIELD]: TITLE_LABEL,
  [CATEGORY_FIELD]: CATEGORY_LABEL,
  [NOTE_FIELD]: NOTE_LABEL,
  [FIRST_DUE_ON_FIELD]: FIRST_DUE_DATE_LABEL,
  [PLANNING_TIME_ZONE_FIELD]: PLANNING_TIME_ZONE_LABEL,
  [PROFILE_FIELD]: PROFILE_LEGEND,
  [INTERVAL_FIELD]: INTERVAL_LABEL,
  [DAY_OF_MONTH_FIELD]: DAY_OF_MONTH_LABEL,
  [END_FIELD]: END_LEGEND,
  [END_ON_FIELD]: END_DATE_LABEL,
  [END_COUNT_FIELD]: END_COUNT_LABEL,
  seriesId: "Plan",
  effectiveFrom: EFFECTIVE_BOUNDARY_LABEL,
};
const FIELD_ORDER = [TITLE_FIELD, CATEGORY_FIELD, NOTE_FIELD, FIRST_DUE_ON_FIELD, PLANNING_TIME_ZONE_FIELD, PROFILE_FIELD, INTERVAL_FIELD, DAY_OF_MONTH_FIELD, END_FIELD, END_ON_FIELD, END_COUNT_FIELD] as const;

// ---------------------------------------------------------------------------------------------
// Reading values, composing the payload and judging it
// ---------------------------------------------------------------------------------------------

const blankToUndefined = (value: string): string | undefined => (value.trim() === "" ? undefined : value);

/** A number the schema must judge: a blank entry is never silently read as zero or one. */
function statedNumber(value: string): number {
  const trimmed = value.trim();
  return trimmed === "" ? Number.NaN : Number(trimmed);
}

const isRepeatProfile = (value: unknown): value is RepeatProfile => typeof value === "string" && (REPEAT_PROFILE_ORDER as readonly string[]).includes(value);

const isEndKind = (value: unknown): value is SeriesEnd["kind"] => typeof value === "string" && (END_KIND_ORDER as readonly string[]).includes(value);

/** The next end shape a change leaves the form in, taken from the closed set or left as it was. */
const admittedEndKindOf = (value: unknown, fallback: SeriesEnd["kind"]): SeriesEnd["kind"] => (isEndKind(value) ? value : fallback);

/** The aria wiring every control under a `FormField` carries, so its description and its invalid state are never dropped. */
function controlAria(control: FormFieldControl): { readonly "aria-describedby": string | undefined; readonly "aria-invalid": true | undefined; readonly "aria-required": true | undefined } {
  return { "aria-describedby": control.describedBy, "aria-invalid": control.invalid ? true : undefined, "aria-required": control.required ? true : undefined };
}

/** The messages for one field path, or `undefined` when the refusal named none. */
function fieldMessagesOf(errors: FieldErrorLookup | null, path: string): readonly string[] | undefined {
  if (errors === null) return undefined;
  return errors.byField[path];
}

/** Reads a refusal raised before submission through the one owner of the path-to-message mapping, so no second copy of it lives here. */
function refusalOf(error: ZodError): FieldErrorLookup {
  return fieldErrorsFromInvalid(invalid({ operationId: UNIDENTIFIED_ATTEMPT, fields: error }));
}

/** The two payload shapes are told apart by the identity they carry: a revision names the plan it revises, and a creation names none. */
const isRevisionPayload = (payload: SeriesPayload): payload is EditThisAndFuturePayload => "seriesId" in payload;

/** The end the form states, in the shape the schema reads. A blank entry is sent as it stands so the schema names what is missing. */
function endPayloadOf(values: SeriesFormValues): SeriesEndPayload {
  switch (values.endKind) {
    case "on-date":
      return { kind: "on-date", on: values.endOn };
    case "after-count":
      return { kind: "after-count", count: statedNumber(values.endCount) };
    case "ongoing-personal-policy":
      return { kind: "ongoing-personal-policy" };
  }
}

/**
 * The payload the form's values describe, before the schema judges it. Members of the profile the chosen rule
 * does not read are absent rather than empty, so nothing stale is ever submitted with a new profile, and the
 * plan's own label and note are not restated in a revision because a plan holds neither.
 */
function composePayload(values: SeriesFormValues, seriesId: string | null, effectiveFrom: string): SeriesPayload {
  const intervalUnit = INTERVAL_UNIT_OF_PROFILE[values.profile];
  const readsDayOfMonth = REPEAT_PROFILE_FIELDS[values.profile].includes("dayOfMonth");
  const members = { title: values.title, planningTimeZone: values.planningTimeZone, profile: values.profile, ...(intervalUnit === null ? {} : { interval: statedNumber(values.interval) }), ...(readsDayOfMonth ? { dayOfMonth: statedNumber(values.dayOfMonth) } : {}), end: endPayloadOf(values) };
  return seriesId === null ? { ...members, category: blankToUndefined(values.category), note: blankToUndefined(values.note), firstDueOn: values.firstDueOn } : { seriesId, effectiveFrom, ...members, category: undefined, note: undefined };
}

/** Judges the composed payload with the schema that owns its shape, so an obviously invalid form never reaches the route. */
function parsePayload(payload: SeriesPayload): { readonly parsed: SeriesPayload } | { readonly refused: ZodError } {
  const checked = isRevisionPayload(payload) ? editThisAndFutureSchema.safeParse(payload) : createSeriesSchema.safeParse(payload);
  return checked.success ? { parsed: checked.data } : { refused: checked.error };
}

/** The end condition a read stated, as the form holds it, clamped to the shapes this worker is offered. */
function admittedEndKind(rule: SeriesRuleFacts | null, admitted: readonly SeriesEnd["kind"][]): SeriesEnd["kind"] {
  const stated = rule === null ? DEFAULT_END_KIND : rule.end.kind;
  if (admitted.includes(stated)) return stated;
  return admitted[0] ?? DEFAULT_END_KIND;
}

/** The values the form opens with: the plan's for a revision, overlaid by anything an interrupted entry restored. */
function defaultsOf(current: SeriesEditorCurrent | null, admittedEndKinds: readonly SeriesEnd["kind"][], zoneFallback: string, initialValues: SeriesEditorInitialValues | undefined): SeriesFormValues {
  const stated: SeriesEditorInitialValues = initialValues ?? {};
  const rule = current?.rule ?? null;
  const end = rule?.end ?? null;
  return {
    title: stated.title ?? current?.title ?? "",
    category: stated.category ?? "",
    note: stated.note ?? "",
    firstDueOn: stated.firstDueOn ?? rule?.firstDueOn ?? "",
    planningTimeZone: stated.planningTimeZone ?? rule?.planningTimeZone ?? zoneFallback,
    profile: stated.profile ?? rule?.profile ?? DEFAULT_PROFILE,
    interval: stated.interval ?? (rule === null ? "" : String(rule.interval)),
    dayOfMonth: stated.dayOfMonth ?? (rule?.dayOfMonth === null || rule?.dayOfMonth === undefined ? "" : String(rule.dayOfMonth)),
    endKind: stated.endKind !== undefined && admittedEndKinds.includes(stated.endKind) ? stated.endKind : admittedEndKind(rule, admittedEndKinds),
    endOn: stated.endOn ?? (end?.kind === "on-date" ? end.on : ""),
    endCount: stated.endCount ?? (end?.kind === "after-count" ? String(end.count) : ""),
  };
}

/** A calendar date as stored, displayed from the value the envelope supplied rather than recomputed in this zone. */
function CivilDateText({ value }: { readonly value: string }): ReactElement {
  const stored = value.trim();
  const parsed = parseCivilDate(stored);
  if (parsed.status === "refused") return <span className="min-w-0 wrap-anywhere">{stored === "" ? NOT_STATED_TEXT : stored}</span>;
  const iso = serialiseCivilDate(parsed.date);
  return (
    <bdi>
      <time className="tabular-figures" dateTime={iso}>
        {iso}
      </time>
    </bdi>
  );
}

/** One fact of a rule, labelled and stated as it stands. */
function RuleFact({ label, children }: { readonly label: string; readonly children: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm wrap-anywhere">{children}</dd>
    </div>
  );
}

/** The end of a stated rule in the plan's own terms. */
function EndFacts({ end }: { readonly end: SeriesEndFacts }): ReactElement {
  switch (end.kind) {
    case "on-date":
      return (
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="text-muted-foreground">{`${END_DATE_LABEL}:`}</span>
          <CivilDateText value={end.on} />
        </span>
      );
    case "after-count":
      return (
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="text-muted-foreground">{`${END_COUNT_LABEL}:`}</span>
          <bdi className="tabular-figures">{String(end.count)}</bdi>
        </span>
      );
    case "ongoing-personal-policy":
      return <span>{END_CONDITION_LABELS["ongoing-personal-policy"]}</span>;
  }
}

/**
 * The rule in force now, beside the change being composed. A prospective revision is read against this, so
 * what it keeps and what it replaces are both visible before anything is sent.
 */
function CurrentRule({ current, effectiveFrom }: { readonly current: SeriesEditorCurrent; readonly effectiveFrom: string }): ReactElement {
  const headingId = useId();
  const rule = current.rule;
  const intervalUnit = INTERVAL_UNIT_OF_PROFILE[rule.profile];
  const readsDayOfMonth = REPEAT_PROFILE_FIELDS[rule.profile].includes("dayOfMonth");
  return (
    <section aria-labelledby={headingId} data-slot="series-current-rule" className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-muted/40 p-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h4 id={headingId} className="font-heading text-sm font-medium">
          {CURRENT_RULE_HEADING}
        </h4>
        <p className="text-sm text-pretty">
          <span className="font-medium">{REPEAT_PROFILE_LABELS[rule.profile]}</span>
          <span className="text-muted-foreground">{` — ${REPEAT_PROFILE_DESCRIPTIONS[rule.profile]}`}</span>
        </p>
      </div>
      <dl className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
        <RuleFact label={FIRST_DUE_DATE_LABEL}>
          <CivilDateText value={rule.firstDueOn} />
        </RuleFact>
        <RuleFact label={PLANNING_TIME_ZONE_LABEL}>
          <bdi>{rule.planningTimeZone.trim() === "" ? NOT_STATED_TEXT : rule.planningTimeZone}</bdi>
        </RuleFact>
        {intervalUnit === null ? null : (
          <RuleFact label={INTERVAL_LABEL}>
            <bdi className="tabular-figures">{String(rule.interval)}</bdi>
            {` ${INTERVAL_UNIT_LABELS[intervalUnit]}`}
          </RuleFact>
        )}
        {readsDayOfMonth ? (
          <RuleFact label={DAY_OF_MONTH_LABEL}>
            <bdi className="tabular-figures">{rule.dayOfMonth === null ? NOT_STATED_TEXT : String(rule.dayOfMonth)}</bdi>
          </RuleFact>
        ) : null}
        <RuleFact label={END_LEGEND}>
          <EndFacts end={rule.end} />
        </RuleFact>
        <RuleFact label={EFFECTIVE_BOUNDARY_LABEL}>
          <CivilDateText value={effectiveFrom} />
        </RuleFact>
      </dl>
      <p className="text-sm text-pretty text-muted-foreground">{EFFECTIVE_BOUNDARY_EXPLANATION}</p>
      <p className="text-sm text-pretty text-muted-foreground">{COMPLETED_HISTORY_NOTE}</p>
      <p className="text-sm text-pretty text-muted-foreground">{FIRST_DUE_DATE_LOCKED_NOTE}</p>
    </section>
  );
}

/** The one durable receipt of an attempt, focused when it appears so a keyboard user lands on the record of what happened. */
function Receipt({
  outcome,
  heading,
  headingLevel,
  onCheckResult,
  onRetrySameWork,
  onReapply,
}: {
  readonly outcome: ReceiptOutcome;
  readonly heading: string;
  readonly headingLevel: 3 | 4;
  readonly onCheckResult?: (() => void) | undefined;
  readonly onRetrySameWork?: (() => void) | undefined;
  readonly onReapply?: (() => void) | undefined;
}): ReactElement {
  const frameRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    frameRef.current?.focus();
  }, [outcome]);
  return (
    <div ref={frameRef} tabIndex={-1} data-slot="series-editor-result" data-outcome={outcome.outcome} className="flex min-w-0 flex-col gap-2 outline-none">
      <OperationResult outcome={outcome} heading={heading} headingLevel={headingLevel} onCheckResult={onCheckResult} onRetrySameWork={onRetrySameWork} onReapply={onReapply} fieldLabels={FIELD_LABELS} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------------------------

/** The create surface of a repeating plan, and the prospective "this and future" revision of one. */
export default function SeriesEditor(props: SeriesEditorProps): ReactElement {
  const { scope, expectedRevision, planningTimeZoneChoices, ongoingPolicyAdmitted, initialValues, headingLevel = 3, onSaved, onCheckResult, onCancel, dir, className } = props;
  const editFacts = props.mode === "edit-this-and-future" ? props : null;
  const revising = editFacts !== null;
  const current = editFacts?.current ?? null;
  const seriesId = editFacts?.seriesId ?? null;
  const effectiveFrom = editFacts?.effectiveFrom ?? "";
  const planState: SeriesState = editFacts?.state ?? "active";
  const admittedActions: readonly ReadAction[] = editFacts?.actions ?? EMPTY_ACTIONS;
  // A stopped plan admits no later rule, so the service would answer `unchanged`: the revision form is not
  // offered at all and the plan's last rule is shown read-only instead.
  const stopped = planState === "stopped";
  const headingId = useId();
  const optionIdPrefix = useId();
  const Heading = HEADING_TAG[headingLevel];
  const receiptHeadingLevel: 3 | 4 = headingLevel === 2 ? 3 : 4;
  // The policy is the only condition under which a plan may state no end, so an unadmitted policy removes that
  // shape from the offered set rather than leaving it visible and refused on submit.
  const admittedEndKinds = useMemo<readonly SeriesEnd["kind"][]>(() => (ongoingPolicyAdmitted ? [...END_KIND_ORDER] : END_KIND_ORDER.filter((kind) => kind !== "ongoing-personal-policy")), [ongoingPolicyAdmitted]);
  const currentZone = current?.rule.planningTimeZone ?? "";
  const zoneChoices = useMemo<readonly string[]>(() => {
    const zones: string[] = [];
    for (const stated of [currentZone, ...planningTimeZoneChoices]) {
      const zone = stated.trim();
      if (zone !== "" && !zones.includes(zone)) zones.push(zone);
    }
    return zones;
  }, [currentZone, planningTimeZoneChoices]);
  const form = useForm({ defaultValues: defaultsOf(current, admittedEndKinds, zoneChoices[0] ?? "", initialValues) });
  const { createSeries, editThisAndFuture } = useSeriesMutations(scope);
  const submitSeries = useCallback(
    async (input: MutationInput<SeriesPayload>): Promise<MutationOutcome> => {
      // The attempt's identity belongs to the shared attempt owner: an unchanged intent reuses it and a changed
      // intent mints a new one, so this file states only the scope, the revision it read and the payload.
      const identity = { operationId: input.operationId, expectedRevision: input.expectedRevision };
      return isRevisionPayload(input.payload) ? editThisAndFuture.mutateAsync({ ...identity, payload: input.payload }) : createSeries.mutateAsync({ ...identity, payload: input.payload });
    },
    [createSeries, editThisAndFuture],
  );
  const { pending, outcome, reviewedIntent, submit, retry, reapply } = useReviewedMutation<SeriesPayload>(submitSeries);
  const [refusal, setRefusal] = useState<FieldErrorLookup | null>(null);
  const savedOutcome = useRef<MutationOutcome | null>(null);
  const settle = useCallback(
    (settled: MutationOutcome | null): void => {
      if (settled === null) return;
      // One refusal presentation for every path: a refusal raised here and one the service returned are read the same way.
      setRefusal(settled.outcome === "invalid" ? fieldErrorsFromInvalid(settled) : null);
      if ((settled.outcome === "accepted" || settled.outcome === "alreadyAccepted") && savedOutcome.current !== settled) {
        savedOutcome.current = settled;
        onSaved?.(settled);
      }
    },
    [onSaved],
  );
  const clearRefusal = useCallback((): void => {
    setRefusal((held) => (held === null ? held : null));
  }, []);
  const changeProfile = (next: RepeatProfile): void => {
    form.setFieldValue("profile", next);
    // The members the new profile does not read are emptied, so no interval or day travels with a rule that does
    // not read it; everything the worker still needs stays exactly as they entered it.
    if (INTERVAL_UNIT_OF_PROFILE[next] === null) form.setFieldValue("interval", "");
    if (!REPEAT_PROFILE_FIELDS[next].includes("dayOfMonth")) form.setFieldValue("dayOfMonth", "");
    clearRefusal();
  };
  const changeEndKind = (next: SeriesEnd["kind"]): void => {
    form.setFieldValue("endKind", next);
    // The field of the shape being left is emptied, so an end date never rides along with a count of occurrences.
    if (next !== "on-date") form.setFieldValue("endOn", "");
    if (next !== "after-count") form.setFieldValue("endCount", "");
    clearRefusal();
  };
  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (pending || stopped) return;
    const checked = parsePayload(composePayload(form.state.values, seriesId, effectiveFrom));
    if ("refused" in checked) {
      setRefusal(refusalOf(checked.refused));
      return;
    }
    setRefusal(null);
    void submit({ scope, expectedRevision, payload: checked.parsed }).then(settle);
  };
  const retrySameWork = (): void => {
    void retry().then(settle);
  };
  const reapplyInput = (): void => {
    void reapply().then(settle);
  };
  const endGroupDescription = `${END_GROUP_DESCRIPTION} ${ONGOING_POLICY_NOTE}`;
  return (
    <section dir={dir} aria-labelledby={headingId} aria-busy={pending ? true : undefined} data-slot="series-editor" data-mode={props.mode} className={cn("flex min-w-0 flex-col gap-5", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <Heading id={headingId} className="font-heading text-lg font-medium">
          {revising ? REVISE_HEADING : CREATE_HEADING}
        </Heading>
        <p className="text-sm text-pretty text-muted-foreground">{revising ? REVISE_FORM_HELP : CREATE_FORM_HELP}</p>
      </div>
      {current === null ? null : <CurrentRule current={current} effectiveFrom={effectiveFrom} />}
      {stopped ? (
        <Alert>
          <AlertTitle>{STOPPED_ALERT_TITLE}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <p>{STOPPED_NOTE}</p>
            <p>{STOPPED_NO_REVISION_NOTE}</p>
          </AlertDescription>
        </Alert>
      ) : (
        <form noValidate onSubmit={onSubmit} className="flex min-w-0 flex-col gap-5">
          {refusal === null || refusal.count === 0 ? null : <FormErrorSummary errors={refusal} labels={FIELD_LABELS} order={FIELD_ORDER} headingLevel={receiptHeadingLevel} />}
          <form.Subscribe selector={(state) => state.values}>
            {(values) => {
              const payload = composePayload(values, seriesId, effectiveFrom);
              const receipt = reviewedIntent !== null && reviewedIntent === intentKeyOf({ scope, expectedRevision, payload }) ? outcome : null;
              const applied = receipt !== null && (receipt.outcome === "accepted" || receipt.outcome === "alreadyAccepted" || receipt.outcome === "unchanged");
              const intervalUnit = INTERVAL_UNIT_OF_PROFILE[values.profile];
              const readsDayOfMonth = REPEAT_PROFILE_FIELDS[values.profile].includes("dayOfMonth");
              return (
                <div className="flex min-w-0 flex-col gap-5">
                  <form.Field name="title">
                    {(field) => (
                      <FormField name={TITLE_FIELD} label={TITLE_LABEL} description={TITLE_DESCRIPTION} error={fieldMessagesOf(refusal, TITLE_FIELD)} required>
                        {(control) => (
                          <Input
                            id={control.id}
                            name={TITLE_FIELD}
                            type="text"
                            autoComplete="off"
                            className="w-full"
                            required={control.required}
                            value={field.state.value}
                            onChange={(event) => {
                              field.handleChange(event.currentTarget.value);
                              clearRefusal();
                            }}
                            onBlur={field.handleBlur}
                            {...controlAria(control)}
                          />
                        )}
                      </FormField>
                    )}
                  </form.Field>
                  {revising ? null : (
                    <>
                      <form.Field name="category">
                        {(field) => (
                          <FormField name={CATEGORY_FIELD} label={CATEGORY_LABEL} description={CATEGORY_DESCRIPTION} error={fieldMessagesOf(refusal, CATEGORY_FIELD)} optionalHint>
                            {(control) => (
                              <Input
                                id={control.id}
                                name={CATEGORY_FIELD}
                                type="text"
                                autoComplete="off"
                                className="w-full sm:max-w-72"
                                value={field.state.value}
                                onChange={(event) => {
                                  field.handleChange(event.currentTarget.value);
                                  clearRefusal();
                                }}
                                onBlur={field.handleBlur}
                                {...controlAria(control)}
                              />
                            )}
                          </FormField>
                        )}
                      </form.Field>
                      <form.Field name="note">
                        {(field) => (
                          <FormField name={NOTE_FIELD} label={NOTE_LABEL} description={NOTE_DESCRIPTION} error={fieldMessagesOf(refusal, NOTE_FIELD)} optionalHint>
                            {(control) => (
                              <Input
                                id={control.id}
                                name={NOTE_FIELD}
                                type="text"
                                autoComplete="off"
                                className="w-full"
                                value={field.state.value}
                                onChange={(event) => {
                                  field.handleChange(event.currentTarget.value);
                                  clearRefusal();
                                }}
                                onBlur={field.handleBlur}
                                {...controlAria(control)}
                              />
                            )}
                          </FormField>
                        )}
                      </form.Field>
                      <form.Field name="firstDueOn">
                        {(field) => (
                          <FormField name={FIRST_DUE_ON_FIELD} label={FIRST_DUE_DATE_LABEL} description={FIRST_DUE_DATE_HINT} error={fieldMessagesOf(refusal, FIRST_DUE_ON_FIELD)} required>
                            {(control) => (
                              <Input
                                id={control.id}
                                name={FIRST_DUE_ON_FIELD}
                                type="date"
                                className="w-full sm:max-w-60"
                                required={control.required}
                                value={field.state.value}
                                onChange={(event) => {
                                  field.handleChange(event.currentTarget.value);
                                  clearRefusal();
                                }}
                                onBlur={field.handleBlur}
                                {...controlAria(control)}
                              />
                            )}
                          </FormField>
                        )}
                      </form.Field>
                    </>
                  )}
                  <form.Field name="planningTimeZone">
                    {(field) => (
                      <FormField name={PLANNING_TIME_ZONE_FIELD} label={PLANNING_TIME_ZONE_LABEL} description={PLANNING_TIME_ZONE_NOTE} error={fieldMessagesOf(refusal, PLANNING_TIME_ZONE_FIELD)} required>
                        {(control) => (
                          <NativeSelect
                            id={control.id}
                            name={PLANNING_TIME_ZONE_FIELD}
                            className="w-full sm:max-w-72"
                            required={control.required}
                            value={field.state.value}
                            onChange={(event) => {
                              field.handleChange(event.currentTarget.value);
                              clearRefusal();
                            }}
                            onBlur={field.handleBlur}
                            {...controlAria(control)}
                          >
                            {zoneChoices.length === 0 ? <NativeSelectOption value="">{NOT_STATED_TEXT}</NativeSelectOption> : null}
                            {zoneChoices.map((zone) => (
                              <NativeSelectOption key={zone} value={zone}>
                                {zone}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        )}
                      </FormField>
                    )}
                  </form.Field>
                  <FormFieldGroup legend={PROFILE_LEGEND} name={PROFILE_FIELD} description={PROFILE_GROUP_DESCRIPTION} error={fieldMessagesOf(refusal, PROFILE_FIELD)} required>
                    {(group) => (
                      <RadioGroup
                        value={values.profile}
                        onValueChange={(next) => {
                          if (isRepeatProfile(next)) changeProfile(next);
                        }}
                        aria-labelledby={group.legendId}
                        aria-describedby={group.describedBy}
                        aria-invalid={group.invalid ? true : undefined}
                      >
                        {REPEAT_PROFILE_ORDER.map((profile) => {
                          const optionId = `${optionIdPrefix}-profile-${profile}`;
                          const hintId = `${optionId}-hint`;
                          return (
                            <label key={profile} htmlFor={optionId} className="flex min-h-target items-start gap-3 py-1">
                              <RadioGroupItem id={optionId} value={profile} aria-label={REPEAT_PROFILE_LABELS[profile]} aria-describedby={hintId} className="mt-0.5" />
                              <span className="flex min-w-0 flex-col gap-0.5">
                                <span className="text-sm font-medium">{REPEAT_PROFILE_LABELS[profile]}</span>
                                <span id={hintId} className="text-sm text-pretty text-muted-foreground">
                                  {REPEAT_PROFILE_DESCRIPTIONS[profile]}
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </RadioGroup>
                    )}
                  </FormFieldGroup>
                  {intervalUnit === null ? null : (
                    <form.Field name="interval">
                      {(field) => (
                        <FormField name={INTERVAL_FIELD} label={INTERVAL_LABEL} description={`A whole number of at least 1: this plan returns every that many ${INTERVAL_UNIT_LABELS[intervalUnit]}.`} error={fieldMessagesOf(refusal, INTERVAL_FIELD)} required>
                          {(control) => (
                            <Input
                              id={control.id}
                              name={INTERVAL_FIELD}
                              type="number"
                              min={1}
                              step={1}
                              inputMode="numeric"
                              className="w-full sm:max-w-40"
                              required={control.required}
                              value={field.state.value}
                              onChange={(event) => {
                                field.handleChange(event.currentTarget.value);
                                clearRefusal();
                              }}
                              onBlur={field.handleBlur}
                              {...controlAria(control)}
                            />
                          )}
                        </FormField>
                      )}
                    </form.Field>
                  )}
                  {readsDayOfMonth ? (
                    <form.Field name="dayOfMonth">
                      {(field) => (
                        <FormField name={DAY_OF_MONTH_FIELD} label={DAY_OF_MONTH_LABEL} description={DAY_OF_MONTH_DESCRIPTION} error={fieldMessagesOf(refusal, DAY_OF_MONTH_FIELD)} required>
                          {(control) => (
                            <Input
                              id={control.id}
                              name={DAY_OF_MONTH_FIELD}
                              type="number"
                              min={1}
                              max={31}
                              step={1}
                              inputMode="numeric"
                              className="w-full sm:max-w-40"
                              required={control.required}
                              value={field.state.value}
                              onChange={(event) => {
                                field.handleChange(event.currentTarget.value);
                                clearRefusal();
                              }}
                              onBlur={field.handleBlur}
                              {...controlAria(control)}
                            />
                          )}
                        </FormField>
                      )}
                    </form.Field>
                  ) : null}
                  <FormFieldGroup legend={END_LEGEND} name={END_FIELD} description={endGroupDescription} error={fieldMessagesOf(refusal, END_FIELD)} required>
                    {(group) => (
                      <RadioGroup
                        orientation="vertical"
                        value={values.endKind}
                        onValueChange={(next) => {
                          changeEndKind(admittedEndKindOf(next, values.endKind));
                        }}
                        aria-labelledby={group.legendId}
                        aria-describedby={group.describedBy}
                        aria-invalid={group.invalid ? true : undefined}
                      >
                        {admittedEndKinds.map((kind) => {
                          const optionId = `${optionIdPrefix}-end-${kind}`;
                          return (
                            <label key={kind} htmlFor={optionId} className="flex min-h-target items-start gap-3 py-1">
                              <RadioGroupItem id={optionId} value={kind} aria-label={END_CONDITION_LABELS[kind]} className="mt-0.5" />
                              <span className="min-w-0 text-sm font-medium">{END_CONDITION_LABELS[kind]}</span>
                            </label>
                          );
                        })}
                      </RadioGroup>
                    )}
                  </FormFieldGroup>
                  {values.endKind === "on-date" ? (
                    <form.Field name="endOn">
                      {(field) => (
                        <FormField name={END_ON_FIELD} label={END_DATE_LABEL} description={END_DATE_DESCRIPTION} error={fieldMessagesOf(refusal, END_ON_FIELD)} required>
                          {(control) => (
                            <Input
                              id={control.id}
                              name={END_ON_FIELD}
                              type="date"
                              className="w-full sm:max-w-60"
                              required={control.required}
                              value={field.state.value}
                              onChange={(event) => {
                                field.handleChange(event.currentTarget.value);
                                clearRefusal();
                              }}
                              onBlur={field.handleBlur}
                              {...controlAria(control)}
                            />
                          )}
                        </FormField>
                      )}
                    </form.Field>
                  ) : null}
                  {values.endKind === "after-count" ? (
                    <form.Field name="endCount">
                      {(field) => (
                        <FormField name={END_COUNT_FIELD} label={END_COUNT_LABEL} description={END_COUNT_DESCRIPTION} error={fieldMessagesOf(refusal, END_COUNT_FIELD)} required>
                          {(control) => (
                            <Input
                              id={control.id}
                              name={END_COUNT_FIELD}
                              type="number"
                              min={1}
                              step={1}
                              inputMode="numeric"
                              className="w-full sm:max-w-40"
                              required={control.required}
                              value={field.state.value}
                              onChange={(event) => {
                                field.handleChange(event.currentTarget.value);
                                clearRefusal();
                              }}
                              onBlur={field.handleBlur}
                              {...controlAria(control)}
                            />
                          )}
                        </FormField>
                      )}
                    </form.Field>
                  ) : null}
                  {receipt === null || receipt.outcome === "invalid" ? null : (
                    <Receipt outcome={receipt} heading={revising ? REVISE_RECEIPT_HEADING : CREATE_RECEIPT_HEADING} headingLevel={receiptHeadingLevel} onCheckResult={onCheckResult} onRetrySameWork={mayReplay(receipt) ? retrySameWork : undefined} onReapply={receipt.outcome === "conflict" ? reapplyInput : undefined} />
                  )}
                  {pending ? <output className="block text-sm text-muted-foreground">{PENDING_SENTENCE}</output> : null}
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                    {applied ? (
                      onCancel === undefined ? null : (
                        <Button type="button" onClick={onCancel}>
                          {DONE_LABEL}
                        </Button>
                      )
                    ) : (
                      <>
                        {onCancel === undefined ? null : (
                          <Button type="button" variant="outline" onClick={onCancel}>
                            {CANCEL_LABEL}
                          </Button>
                        )}
                        <Button type="submit" disabled={pending} aria-busy={pending ? true : undefined}>
                          {pending ? SAVING_LABEL : revising ? REVISE_LABEL : CREATE_LABEL}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            }}
          </form.Subscribe>
        </form>
      )}
      {editFacts === null ? null : (
        <>
          <Separator />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-sm font-medium">{STATE_DIFFERENCE_LEAD}</p>
            <p className="text-sm text-pretty text-muted-foreground">{PAUSED_NOTE}</p>
            <p className="text-sm text-pretty text-muted-foreground">{STOPPED_NOTE}</p>
          </div>
          <SeriesStateControls scope={scope} seriesId={editFacts.seriesId} revision={expectedRevision} state={editFacts.state} actions={admittedActions} onCheckResult={onCheckResult} headingLevel={headingLevel} />
        </>
      )}
    </section>
  );
}
