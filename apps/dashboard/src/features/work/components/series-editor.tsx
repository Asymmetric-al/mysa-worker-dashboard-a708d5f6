"use client";
import { useForm } from "@tanstack/react-form";
import { useCallback, useId, useMemo, useRef, useState, type FormEvent, type ReactElement } from "react";
import type { ZodError } from "zod";
import { intentKeyOf, mayReplay, useReviewedMutation } from "@/components/action-review";
import { factFrame } from "@/components/fact-list";
import { fieldErrorsFromInvalid, FormErrorSummary, type FieldErrorLookup } from "@/components/form-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { MutationInput, ReadAction, Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
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
import { createSeriesSchema, editThisAndFutureSchema, endPayloadOf, statedNumber, type CreateSeriesPayload, type EditThisAndFuturePayload } from "../schemas/series";
import { SeriesStateControls } from "./occurrence-actions";
import { BoundField, FormChoiceGroup, FormFooter, FormReceipt, FormSelectField, refusalLookupOf, type TextSpec } from "./reviewed-form";
import StatedDate from "./stated-instant";
export type SeriesEndFacts = { readonly kind: "on-date"; readonly on: string } | { readonly kind: "after-count"; readonly count: number } | { readonly kind: "ongoing-personal-policy" };
export type SeriesRuleFacts = { readonly profile: RepeatProfile; readonly interval: number; readonly dayOfMonth: number | null; readonly firstDueOn: string; readonly planningTimeZone: string; readonly end: SeriesEndFacts };
export type SeriesEditorCurrent = { readonly title: string; readonly rule: SeriesRuleFacts };
type SeriesFormValues = { title: string; category: string; note: string; firstDueOn: string; planningTimeZone: string; profile: RepeatProfile; interval: string; dayOfMonth: string; endKind: SeriesEnd["kind"]; endOn: string; endCount: string };
export type SeriesEditorInitialValues = Partial<SeriesFormValues>;
type SeriesPayload = CreateSeriesPayload | EditThisAndFuturePayload;
interface SeriesEditorCommonProps {
  readonly scope: Scope;
  readonly expectedRevision: string;
  readonly planningTimeZoneChoices: readonly string[];
  readonly ongoingPolicyAdmitted: boolean;
  readonly initialValues?: SeriesEditorInitialValues;
  readonly headingLevel?: 2 | 3 | 4;
  readonly onSaved?: (outcome: Extract<MutationOutcome, { readonly outcome: "accepted" | "alreadyAccepted" }>) => void;
  readonly onCheckResult?: () => void;
  readonly onCancel?: () => void;
  readonly dir?: "ltr" | "rtl";
  readonly className?: string;
}
export type SeriesEditorProps =
  | (SeriesEditorCommonProps & { readonly mode: "create"; readonly current?: null | undefined })
  | (SeriesEditorCommonProps & { readonly mode: "edit-this-and-future"; readonly current: SeriesEditorCurrent; readonly seriesId: string; readonly effectiveFrom: string; readonly state: SeriesState; readonly actions: readonly ReadAction[] });
const EMPTY_ACTIONS: readonly ReadAction[] = [];
const HEADING_TAG: Readonly<Record<2 | 3 | 4, "h2" | "h3" | "h4">> = { 2: "h2", 3: "h3", 4: "h4" };
/** The one type scale's heading utility per level, so the editor's own title states the level it is rendered at with the same measure on every surface. */ const HEADING_SCALE: Readonly<Record<2 | 3 | 4, string>> = { 2: "type-section-title", 3: "type-subsection-title", 4: "type-group-title" };
const END_KIND_ORDER = ["on-date", "after-count", "ongoing-personal-policy"] as const satisfies readonly SeriesEnd["kind"][];
const INTERVAL_UNIT_OF_PROFILE: Readonly<Record<RepeatProfile, "weeks" | "months" | null>> = { none: null, weekly: null, everyNWeeks: "weeks", monthlyOnDay: null, everyNMonths: "months" };
const DEFAULT_END_KIND: SeriesEnd["kind"] = "on-date";
const HEADINGS = { create: "New repeating plan", revise: "Revise this plan from a boundary", receiptCreate: "Creating this plan", receiptRevise: "Revising the plan", currentRule: "The rule in force now", stopped: "This plan is stopped" } as const;
const HELP = {
  create: "A plan needs a title, a first due date and the timezone it is planned in. Choose how it repeats and when it ends; the category and the note are optional.",
  revise: "This change revises the plan from the boundary above onward. The dates before that boundary, and every completed date, keep the rule they were planned under.",
} as const;
const LABELS = { title: "Title", category: "Category", note: "Note", profiles: "How this plan repeats", ends: "When this plan ends" } as const;
const DESCRIPTIONS = {
  title: "The work this plan repeats, in a few words.",
  category: "Your own short label for finding similar plans; it is not a shared taxonomy and not a stage.",
  note: "A short reminder about this plan, kept with it. Writing it sends nothing and changes no other record.",
  profiles: "This is a closed set: there is no custom interval beyond these profiles, and only a profile that reads an interval or a day of the month shows that field.",
  ends: "Every plan states when it stops, so an end is always chosen: an end date, a number of occurrences, or — only where the policy applies — no end at all.",
  endDate: "The last calendar date this plan may produce. It is a civil date, so it stays that date wherever you are.",
  endCount: "How many dates this plan may produce in total, counted from the first due date.",
} as const;
const EFFECTIVE_BOUNDARY_LABEL = "Takes effect from";
const NOT_STATED_TEXT = "Not stated";
const FIELD_NAMES = { title: "title", category: "category", note: "note", firstDueOn: "firstDueOn", planningTimeZone: "planningTimeZone", profile: "profile", interval: "interval", dayOfMonth: "dayOfMonth", end: "end", endOn: "end.on", endCount: "end.count" } as const;
const FIELD_LABELS: Readonly<Record<string, string | undefined>> = {
  [FIELD_NAMES.title]: LABELS.title,
  [FIELD_NAMES.category]: LABELS.category,
  [FIELD_NAMES.note]: LABELS.note,
  [FIELD_NAMES.firstDueOn]: FIRST_DUE_DATE_LABEL,
  [FIELD_NAMES.planningTimeZone]: PLANNING_TIME_ZONE_LABEL,
  [FIELD_NAMES.profile]: LABELS.profiles,
  [FIELD_NAMES.interval]: INTERVAL_LABEL,
  [FIELD_NAMES.dayOfMonth]: DAY_OF_MONTH_LABEL,
  [FIELD_NAMES.end]: LABELS.ends,
  [FIELD_NAMES.endOn]: END_DATE_LABEL,
  [FIELD_NAMES.endCount]: END_COUNT_LABEL,
  seriesId: "Plan",
  effectiveFrom: EFFECTIVE_BOUNDARY_LABEL,
};
const FIELD_ORDER = [FIELD_NAMES.title, FIELD_NAMES.category, FIELD_NAMES.note, FIELD_NAMES.firstDueOn, FIELD_NAMES.planningTimeZone, FIELD_NAMES.profile, FIELD_NAMES.interval, FIELD_NAMES.dayOfMonth, FIELD_NAMES.end, FIELD_NAMES.endOn, FIELD_NAMES.endCount] as const;
type SeriesTextKey = "title" | "category" | "note" | "firstDueOn" | "planningTimeZone" | "interval" | "dayOfMonth" | "endOn" | "endCount";
const FIELDS: Readonly<Record<SeriesTextKey, TextSpec<SeriesTextKey>>> = {
  title: { name: FIELD_NAMES.title, label: LABELS.title, description: DESCRIPTIONS.title, mark: "required", type: "text", className: "w-full", autoComplete: "off" },
  category: { name: FIELD_NAMES.category, label: LABELS.category, description: DESCRIPTIONS.category, mark: "optional", type: "text", className: "w-full sm:max-w-72", autoComplete: "off" },
  note: { name: FIELD_NAMES.note, label: LABELS.note, description: DESCRIPTIONS.note, mark: "optional", type: "text", className: "w-full", autoComplete: "off" },
  firstDueOn: { name: FIELD_NAMES.firstDueOn, label: FIRST_DUE_DATE_LABEL, description: FIRST_DUE_DATE_HINT, mark: "required", type: "date", className: "w-full sm:max-w-60" },
  planningTimeZone: { name: FIELD_NAMES.planningTimeZone, label: PLANNING_TIME_ZONE_LABEL, description: PLANNING_TIME_ZONE_NOTE, mark: "required", type: "text", className: "w-full sm:max-w-72", autoComplete: "off" },
  interval: { name: FIELD_NAMES.interval, label: INTERVAL_LABEL, mark: "required", type: "number", min: 1, step: 1, inputMode: "numeric", className: "w-full sm:max-w-40" },
  dayOfMonth: { name: FIELD_NAMES.dayOfMonth, label: DAY_OF_MONTH_LABEL, description: MISSING_MONTHLY_DAY_DISCLOSURE, mark: "required", type: "number", min: 1, max: 31, step: 1, inputMode: "numeric", className: "w-full sm:max-w-40" },
  endOn: { name: "endOn", controlName: FIELD_NAMES.endOn, label: END_DATE_LABEL, description: DESCRIPTIONS.endDate, mark: "required", type: "date", className: "w-full sm:max-w-60" },
  endCount: { name: "endCount", controlName: FIELD_NAMES.endCount, label: END_COUNT_LABEL, description: DESCRIPTIONS.endCount, mark: "required", type: "number", min: 1, step: 1, inputMode: "numeric", className: "w-full sm:max-w-40" },
};
const intervalSpec = (unit: "weeks" | "months"): TextSpec<SeriesTextKey> => ({ ...FIELDS.interval, description: `A whole number of at least 1: this plan returns every that many ${INTERVAL_UNIT_LABELS[unit]}.` });
const PROFILE_OPTIONS = REPEAT_PROFILE_ORDER.map((profile) => ({ value: profile, label: REPEAT_PROFILE_LABELS[profile], hint: REPEAT_PROFILE_DESCRIPTIONS[profile] }));
const END_OPTIONS = END_KIND_ORDER.map((kind) => ({ value: kind, label: END_CONDITION_LABELS[kind] }));
const blankToUndefined = (value: string): string | undefined => (value.trim() === "" ? undefined : value);
const isRevisionPayload = (payload: SeriesPayload): payload is EditThisAndFuturePayload => "seriesId" in payload;
function composePayload(values: SeriesFormValues, seriesId: string | null, effectiveFrom: string): SeriesPayload {
  const intervalUnit = INTERVAL_UNIT_OF_PROFILE[values.profile];
  const readsDayOfMonth = REPEAT_PROFILE_FIELDS[values.profile].includes("dayOfMonth");
  const members = {
    title: values.title,
    planningTimeZone: values.planningTimeZone,
    profile: values.profile,
    ...(intervalUnit === null ? {} : { interval: statedNumber(values.interval) }),
    ...(readsDayOfMonth ? { dayOfMonth: statedNumber(values.dayOfMonth) } : {}),
    end: endPayloadOf(values.endKind, values.endOn, values.endCount),
  };
  return seriesId === null ? { ...members, category: blankToUndefined(values.category), note: blankToUndefined(values.note), firstDueOn: values.firstDueOn } : { seriesId, effectiveFrom, ...members, category: undefined, note: undefined };
}
function parsePayload(payload: SeriesPayload): { readonly parsed: SeriesPayload } | { readonly refused: ZodError } {
  const checked = isRevisionPayload(payload) ? editThisAndFutureSchema.safeParse(payload) : createSeriesSchema.safeParse(payload);
  return checked.success ? { parsed: checked.data } : { refused: checked.error };
}
function admittedEndKind(rule: SeriesRuleFacts | null, admitted: readonly SeriesEnd["kind"][]): SeriesEnd["kind"] {
  const stated = rule === null ? DEFAULT_END_KIND : rule.end.kind;
  return admitted.includes(stated) ? stated : (admitted[0] ?? DEFAULT_END_KIND);
}
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
    profile: stated.profile ?? rule?.profile ?? "weekly",
    interval: stated.interval ?? (rule === null ? "" : String(rule.interval)),
    dayOfMonth: stated.dayOfMonth ?? (rule?.dayOfMonth === null || rule?.dayOfMonth === undefined ? "" : String(rule.dayOfMonth)),
    endKind: stated.endKind !== undefined && admittedEndKinds.includes(stated.endKind) ? stated.endKind : admittedEndKind(rule, admittedEndKinds),
    endOn: stated.endOn ?? (end?.kind === "on-date" ? end.on : ""),
    endCount: stated.endCount ?? (end?.kind === "after-count" ? String(end.count) : ""),
  };
}
const RuleFact = factFrame({ rowClassName: "flex min-w-0 flex-col gap-0.5", termClassName: "type-supporting", valueClassName: "min-w-0 type-body wrap-anywhere" });
function EndFacts({ end }: { readonly end: SeriesEndFacts }): ReactElement {
  if (end.kind === "ongoing-personal-policy") return <span>{END_CONDITION_LABELS["ongoing-personal-policy"]}</span>;
  const stated = end.kind === "on-date" ? { label: END_DATE_LABEL, value: <StatedDate value={end.on} className="tabular-figures" /> } : { label: END_COUNT_LABEL, value: <bdi className="tabular-figures">{String(end.count)}</bdi> };
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <span className="text-muted-foreground">{`${stated.label}:`}</span>
      {stated.value}
    </span>
  );
}
function CurrentRule({ current, effectiveFrom }: { readonly current: SeriesEditorCurrent; readonly effectiveFrom: string }): ReactElement {
  const headingId = useId();
  const { rule } = current;
  const intervalUnit = INTERVAL_UNIT_OF_PROFILE[rule.profile];
  const readsDayOfMonth = REPEAT_PROFILE_FIELDS[rule.profile].includes("dayOfMonth");
  return (
    <section aria-labelledby={headingId} data-slot="series-current-rule" className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-muted/40 p-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h4 id={headingId} className="type-group-title">
          {HEADINGS.currentRule}
        </h4>
        <p className="type-body text-pretty">
          <span className="font-medium">{REPEAT_PROFILE_LABELS[rule.profile]}</span>
          <span className="text-muted-foreground">{` — ${REPEAT_PROFILE_DESCRIPTIONS[rule.profile]}`}</span>
        </p>
      </div>
      <dl className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
        <RuleFact term={FIRST_DUE_DATE_LABEL}>
          <StatedDate value={rule.firstDueOn} className="tabular-figures" />
        </RuleFact>
        <RuleFact term={PLANNING_TIME_ZONE_LABEL}>
          <bdi>{rule.planningTimeZone.trim() === "" ? NOT_STATED_TEXT : rule.planningTimeZone}</bdi>
        </RuleFact>
        {intervalUnit === null ? null : (
          <RuleFact term={INTERVAL_LABEL}>
            <bdi className="tabular-figures">{String(rule.interval)}</bdi>
            {` ${INTERVAL_UNIT_LABELS[intervalUnit]}`}
          </RuleFact>
        )}
        {readsDayOfMonth ? (
          <RuleFact term={DAY_OF_MONTH_LABEL}>
            <bdi className="tabular-figures">{rule.dayOfMonth === null ? NOT_STATED_TEXT : String(rule.dayOfMonth)}</bdi>
          </RuleFact>
        ) : null}
        <RuleFact term={LABELS.ends}>
          <EndFacts end={rule.end} />
        </RuleFact>
        <RuleFact term={EFFECTIVE_BOUNDARY_LABEL}>
          <StatedDate value={effectiveFrom} className="tabular-figures" />
        </RuleFact>
      </dl>
      <p className="type-supporting text-pretty">{"The dates before that boundary keep the rule they were planned under, and completed history is untouched."}</p>
      <p className="type-supporting text-pretty">{"Completed dates are never rewritten by this change: a revision only shapes the dates from the boundary onward."}</p>
      <p className="type-supporting text-pretty">{"The first due date belongs to the plan itself, so a prospective revision keeps it: only the rule from the boundary onward changes."}</p>
    </section>
  );
}
/** The create surface of a repeating plan, and the prospective "this and future" revision of one. */ export default function SeriesEditor(props: SeriesEditorProps): ReactElement {
  const { scope, expectedRevision, planningTimeZoneChoices, ongoingPolicyAdmitted, initialValues, headingLevel = 3, onSaved, onCheckResult, onCancel, dir, className } = props;
  const editFacts = props.mode === "edit-this-and-future" ? props : null;
  const revising = editFacts !== null;
  const current = editFacts?.current ?? null;
  const seriesId = editFacts?.seriesId ?? null;
  const effectiveFrom = editFacts?.effectiveFrom ?? "";
  const stopped = (editFacts?.state ?? "active") === "stopped";
  const headingId = useId();
  const optionIdPrefix = useId();
  const Heading = HEADING_TAG[headingLevel];
  const receiptHeadingLevel: 3 | 4 = headingLevel === 2 ? 3 : 4;
  const admittedEndKinds = useMemo<readonly SeriesEnd["kind"][]>(() => (ongoingPolicyAdmitted ? [...END_KIND_ORDER] : END_KIND_ORDER.filter((kind) => kind !== "ongoing-personal-policy")), [ongoingPolicyAdmitted]);
  const zoneChoices = useMemo<readonly string[]>(() => [...new Set([current?.rule.planningTimeZone ?? "", ...planningTimeZoneChoices].map((stated) => stated.trim()).filter((zone) => zone !== ""))], [current?.rule.planningTimeZone, planningTimeZoneChoices]);
  const form = useForm({ defaultValues: defaultsOf(current, admittedEndKinds, zoneChoices[0] ?? "", initialValues) });
  const { createSeries, editThisAndFuture } = useSeriesMutations(scope);
  const submitSeries = useCallback(
    async (input: MutationInput<SeriesPayload>): Promise<MutationOutcome> => {
      const identity = { operationId: input.operationId, expectedRevision: input.expectedRevision };
      return isRevisionPayload(input.payload) ? editThisAndFuture.mutateAsync({ ...identity, payload: input.payload }) : createSeries.mutateAsync({ ...identity, payload: input.payload });
    },
    [createSeries, editThisAndFuture],
  );
  const { pending, outcome, reviewedIntent, submit, retry, reapply } = useReviewedMutation<SeriesPayload>(submitSeries);
  const [refusal, setRefusal] = useState<FieldErrorLookup | null>(null);
  const saved = useRef<MutationOutcome | null>(null);
  const settle = useCallback(
    (settled: MutationOutcome | null): void => {
      if (settled === null) return;
      setRefusal(settled.outcome === "invalid" ? fieldErrorsFromInvalid(settled) : null);
      if ((settled.outcome === "accepted" || settled.outcome === "alreadyAccepted") && saved.current !== settled) {
        saved.current = settled;
        onSaved?.(settled);
      }
    },
    [onSaved],
  );
  const clearRefusal = useCallback((): void => setRefusal((held) => (held === null ? held : null)), []);
  const edit = (name: SeriesTextKey, value: string): void => {
    form.setFieldValue(name, value);
    clearRefusal();
  };
  const changeProfile = (next: string): void => {
    if (!((value: string): value is RepeatProfile => REPEAT_PROFILE_ORDER.some((profile) => profile === value))(next)) return;
    form.setFieldValue("profile", next);
    if (INTERVAL_UNIT_OF_PROFILE[next] === null) form.setFieldValue("interval", "");
    if (!REPEAT_PROFILE_FIELDS[next].includes("dayOfMonth")) form.setFieldValue("dayOfMonth", "");
    clearRefusal();
  };
  const changeEndKind = (next: string): void => {
    const admitted = ((value: string, fallback: SeriesEnd["kind"]): SeriesEnd["kind"] => (((value: string): value is SeriesEnd["kind"] => END_KIND_ORDER.some((kind) => kind === value))(value) ? value : fallback))(next, form.state.values.endKind);
    form.setFieldValue("endKind", admitted);
    if (admitted !== "on-date") form.setFieldValue("endOn", "");
    if (admitted !== "after-count") form.setFieldValue("endCount", "");
    clearRefusal();
  };
  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (pending || stopped) return;
    const checked = parsePayload(composePayload(form.state.values, seriesId, effectiveFrom));
    if ("refused" in checked) {
      setRefusal(refusalLookupOf(checked.refused));
      return;
    }
    setRefusal(null);
    void submit({ scope, expectedRevision, payload: checked.parsed }).then(settle);
  };
  return (
    <section dir={dir} aria-labelledby={headingId} aria-busy={pending ? true : undefined} data-slot="series-editor" data-mode={props.mode} className={cn("flex min-w-0 flex-col gap-5", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <Heading id={headingId} className={HEADING_SCALE[headingLevel]}>
          {revising ? HEADINGS.revise : HEADINGS.create}
        </Heading>
        <p className="type-supporting text-pretty">{revising ? HELP.revise : HELP.create}</p>
      </div>
      {current === null ? null : <CurrentRule current={current} effectiveFrom={effectiveFrom} />}
      {stopped ? (
        <Alert>
          <AlertTitle>{HEADINGS.stopped}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <p>{STOPPED_NOTE}</p>
            <p>{"A stopped plan admits no further date and cannot be resumed, so there is no later rule for this change to revise. The rule it last used is shown above, unchanged."}</p>
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
              const retryReceipt = receipt !== null && mayReplay(receipt) ? () => void retry().then(settle) : undefined;
              const reapplyReceipt = receipt !== null && receipt.outcome === "conflict" ? () => void reapply().then(settle) : undefined;
              return (
                <div className="flex min-w-0 flex-col gap-5">
                  <BoundField spec={FIELDS.title} values={values} errors={refusal} onEdit={edit} />
                  {revising ? null : (
                    <>
                      <BoundField spec={FIELDS.category} values={values} errors={refusal} onEdit={edit} />
                      <BoundField spec={FIELDS.note} values={values} errors={refusal} onEdit={edit} />
                      <BoundField spec={FIELDS.firstDueOn} values={values} errors={refusal} onEdit={edit} />
                    </>
                  )}
                  <FormSelectField name={FIELD_NAMES.planningTimeZone} label={PLANNING_TIME_ZONE_LABEL} description={PLANNING_TIME_ZONE_NOTE} errors={refusal} mark="required" className="w-full sm:max-w-72" value={values.planningTimeZone} onValueChange={(value) => edit("planningTimeZone", value)}>
                    {zoneChoices.length === 0 ? <NativeSelectOption value="">{NOT_STATED_TEXT}</NativeSelectOption> : null}
                    {zoneChoices.map((zone) => (
                      <NativeSelectOption key={zone} value={zone}>
                        {zone}
                      </NativeSelectOption>
                    ))}
                  </FormSelectField>
                  <FormChoiceGroup name={FIELD_NAMES.profile} legend={LABELS.profiles} description={DESCRIPTIONS.profiles} errors={refusal} required value={values.profile} options={PROFILE_OPTIONS} onValueChange={changeProfile} idPrefix={optionIdPrefix} />
                  {intervalUnit === null ? null : <BoundField spec={intervalSpec(intervalUnit)} values={values} errors={refusal} onEdit={edit} />}
                  {REPEAT_PROFILE_FIELDS[values.profile].includes("dayOfMonth") ? <BoundField spec={FIELDS.dayOfMonth} values={values} errors={refusal} onEdit={edit} /> : null}
                  <FormChoiceGroup name={FIELD_NAMES.end} legend={LABELS.ends} description={`${DESCRIPTIONS.ends} ${ONGOING_POLICY_NOTE}`} errors={refusal} required value={values.endKind} options={END_OPTIONS} onValueChange={changeEndKind} orientation="vertical" idPrefix={optionIdPrefix} />
                  {values.endKind === "on-date" ? <BoundField spec={FIELDS.endOn} values={values} errors={refusal} onEdit={edit} /> : null}
                  {values.endKind === "after-count" ? <BoundField spec={FIELDS.endCount} values={values} errors={refusal} onEdit={edit} /> : null}
                  {receipt === null || receipt.outcome === "invalid" ? null : (
                    <FormReceipt outcome={receipt} heading={revising ? HEADINGS.receiptRevise : HEADINGS.receiptCreate} headingLevel={receiptHeadingLevel} dataSlot="series-editor-result" fieldLabels={FIELD_LABELS} onCheckResult={onCheckResult} onRetrySameWork={retryReceipt} onReapply={reapplyReceipt} />
                  )}
                  {pending ? <output className="block type-supporting">{"Working: nothing else is submitted while this change is in flight."}</output> : null}
                  <FormFooter pending={pending} applied={applied} submitLabel={revising ? "Apply this revision" : "Create plan"} onCancel={onCancel} onDismiss={onCancel} />
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
            <p className="type-group-title">{"Paused and stopped are not the same:"}</p>
            <p className="type-supporting text-pretty">{PAUSED_NOTE}</p>
            <p className="type-supporting text-pretty">{STOPPED_NOTE}</p>
          </div>
          <SeriesStateControls scope={scope} seriesId={editFacts.seriesId} revision={expectedRevision} state={editFacts.state} actions={editFacts?.actions ?? EMPTY_ACTIONS} onCheckResult={onCheckResult} headingLevel={headingLevel} />
        </>
      )}
    </section>
  );
}
