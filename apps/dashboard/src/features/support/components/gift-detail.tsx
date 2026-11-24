"use client";
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useId, useMemo, useState, type ChangeEvent, type ReactElement, type ReactNode } from "react";
import ActionReview, { type MutationSubmit } from "@/components/action-review";
import { factFrame } from "@/components/fact-list";
import { civilDateConvention, fieldErrorsFromInvalid, FormField, refusalSummary, type FieldErrorLookup } from "@/components/form-field";
import SectionCard from "@/components/section-card";
import StateNotice from "@/components/state-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { formatSourceReference } from "@/lib/ids";
import type { Scope, ValueState } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import { exponentOf, UNKNOWN_CURRENCY } from "@/modules/money/currency";
import { EMPTY_STATES, GIVING_FOLLOW_UP, VALUE_STATE_MEANING } from "../copy";
import { useFollowUpTask } from "../hooks/use-follow-up-task";
import { parseGiftsQuery, toGiftsParams, useGifts, type GiftsEnvelope, type GiftsQuery } from "../hooks/use-gifts";
import { followUpTaskPayloadSchema, type FollowUpTaskInput } from "../schemas";
import AmountValue from "./amount-value";
import SnapshotStatement from "./snapshot-statement";
type LedgerRow = GiftsEnvelope["data"]["report"]["rows"][number];
type RowGrain = "gift" | "allocation";
const TASK_FIELD_LABELS = { title: "What the task is for", category: "Category", dueOn: "Due date", partnerId: "Partner reference" } as const;
const FIELD_LABELS: Readonly<Record<string, string | undefined>> = { ...TASK_FIELD_LABELS, operation: "Request" };
const GRAIN_WORD: Readonly<Record<RowGrain, string>> = { gift: "Gift grain", allocation: "Allocation grain" };
const VALUE_STATE_WORD: Readonly<Record<ValueState, string>> = { value: "Recorded amount", zero: "Recorded zero", unknown: "Unknown amount", withheld: "Withheld", unavailable: "Source unavailable", "incomplete-subtotal": "Incomplete subtotal" };
const PRECISION_LEAD: Readonly<Record<LedgerRow["datePrecision"], string>> = { date: "The source states this as a precise day.", approximate: "The source states this date approximately, so it is a guide rather than a recorded day.", unknown: "The source did not establish this date, so it is not shown as one." };
const DECIMAL_PLACES_WORD: Readonly<Record<number, string>> = { 0: "no decimal places", 1: "one decimal place", 2: "two decimal places", 3: "three decimal places" };
const DENIED_DESCRIPTION = "The read was refused before it enumerated anything, so nothing here states whether a record exists, what it holds, who it is attributed to or what it was for.";
const FOLLOW_UP_FIELDS = [
  { name: "title", label: TASK_FIELD_LABELS.title, description: "A phrase that reads at a glance in a list, such as \u201cThank her for the March gift\u201d.", required: true, wide: true },
  { name: "category", label: TASK_FIELD_LABELS.category, description: "Your own short label, such as \u201cThank you\u201d. It is free text rather than a fixed list, and it changes nothing else on the task.", hint: true },
  { name: "dueOn", label: TASK_FIELD_LABELS.dueOn, description: "The calendar day you intend to do this on. Leave it empty for a task with no date: a due date is not an appointment, and a planned day proves nothing about contact.", hint: true, type: "date" },
  { name: "partnerId", label: TASK_FIELD_LABELS.partnerId, description: "The partner record this task is about, carried from the gift as an identifier. Clear it for a task that names no record. It is never an amount and never a guess at who gave.", hint: true, wide: true, autoComplete: "off" },
] as const;
type FollowUpFieldName = (typeof FOLLOW_UP_FIELDS)[number]["name"];
const Fact = factFrame({ rowClassName: "flex min-w-0 flex-col gap-1", termClassName: "text-sm font-medium", valueClassName: "min-w-0 text-sm text-pretty break-words text-muted-foreground" });
const Frame = ({ dir, className, returnHref, children }: { readonly dir?: "ltr" | "rtl"; readonly className?: string; readonly returnHref: string; readonly children: ReactNode }): ReactElement => (
  <div data-slot="gift-detail" dir={dir} className={cn("mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6 py-6", className)}>
    <nav aria-label="Return path" className="min-w-0">
      <Link href={returnHref} className="inline-link inline-flex min-h-target max-w-full items-center gap-1.5 text-sm font-medium text-primary">
        <ArrowLeftIcon aria-hidden="true" className="size-4 shrink-0 rtl:rotate-180" />
        <span className="min-w-0 text-pretty">Back to the gifts ledger, with the filters, sort and page you came from</span>
      </Link>
    </nav>
    {children}
  </div>
);
const LoadingBody = (): ReactElement => (
  <div aria-busy={true} className="flex min-w-0 flex-col gap-4">
    <p className="sr-only">Reading this gift, its grain and the coverage it falls in.</p>
    <div aria-hidden="true" className="flex min-w-0 flex-col gap-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-5 w-2/3" />
      {[
        ["h-4 w-32", "h-4 w-5/6"],
        ["h-4 w-40", "h-4 w-3/4"],
      ].map(([heading, body]) => (
        <Card key={heading} className="min-w-0 gap-2 px-(--card-spacing)">
          <Skeleton className={heading} />
          <Skeleton className="h-4 w-full" />
          <Skeleton className={body} />
        </Card>
      ))}
    </div>
  </div>
);
const ledgerHrefOf = (query: GiftsQuery): string => {
  const stated = toGiftsParams(query).toString();
  return stated === "" ? "/support/gifts" : `/support/gifts?${stated}`;
};
function locateRow(envelope: GiftsEnvelope | null, giftId: string): { readonly row: LedgerRow; readonly index: number } | null {
  if (envelope === null) return null;
  const rows = envelope.data.report.rows;
  const byRow = rows.findIndex((candidate) => candidate.giftRowId === giftId);
  const index = byRow >= 0 ? byRow : rows.findIndex((candidate) => candidate.giftId === giftId);
  const row = index < 0 ? undefined : rows[index];
  return row === undefined ? null : { row, index };
}
const correctionAgainst = (rows: readonly LedgerRow[], row: LedgerRow): LedgerRow | undefined => rows.find((candidate) => candidate.refundOf !== undefined && candidate.refundOf === row.giftRowId);
function withoutField(lookup: FieldErrorLookup | null, path: string): FieldErrorLookup | null {
  if (lookup === null || lookup.byField[path] === undefined) return lookup;
  const byField: Record<string, readonly string[]> = { ...lookup.byField };
  delete byField[path];
  return { byField, form: lookup.form, count: Object.keys(byField).length + lookup.form.length };
}
const messagesFor = (lookup: FieldErrorLookup | null, path: string): readonly string[] | undefined => lookup?.byField[path];
function CurrencyPrecision({ currency }: { readonly currency: string }): ReactElement {
  const exponent = exponentOf(currency);
  if (exponent === undefined) {
    return currency === UNKNOWN_CURRENCY ? (
      <>The source identified no currency for this amount, so no code is shown here, nothing is assumed in its place, and the amount cannot be totalled or compared with another.</>
    ) : (
      <>The source named a currency this application holds no exponent for, so the amount is stated as unknown rather than at a precision this surface would have had to assume. The code the source used is not repeated here, because repeating it would present it as one this record can state.</>
    );
  }
  return (
    <>
      <bdi className="mono-identifier">{currency}</bdi> has {DECIMAL_PLACES_WORD[exponent] ?? `${String(exponent)} decimal places`}, so this amount is stated at exactly that precision and never at one this application assumes.
    </>
  );
}
export type GiftDetailProps = { readonly scope: Scope; readonly giftId: string; readonly locale: string; readonly dir?: "ltr" | "rtl"; readonly ledgerQuery?: GiftsQuery; readonly className?: string };
/** One gift or allocation, its grain, its correction and provenance, its coverage, and the one follow-up it may lead to. */ export function GiftDetail({ scope, giftId, locale, dir, ledgerQuery, className }: GiftDetailProps): ReactElement {
  const search = useSearchParams();
  const recordHeadingId = useId();
  const grainHeadingId = useId();
  const correctionHeadingId = useId();
  const provenanceHeadingId = useId();
  const snapshotHeadingId = useId();
  const followUpHeadingId = useId();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [partnerDraft, setPartnerDraft] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrorLookup | null>(null);
  const [lastOutcome, setLastOutcome] = useState<MutationOutcome | null>(null);
  const followUp = useFollowUpTask();
  const carriedQuery = useMemo<GiftsQuery>(() => ledgerQuery ?? parseGiftsQuery(search), [ledgerQuery, search]);
  const gifts = useGifts({ scope, query: carriedQuery, record: giftId });
  const returnHref = useMemo(() => ledgerHrefOf(carriedQuery), [carriedQuery]);
  const settle = useCallback((outcome: MutationOutcome): void => {
    setLastOutcome(outcome);
    setErrors(outcome.outcome === "invalid" ? fieldErrorsFromInvalid(outcome) : null);
  }, []);
  const startAnother = useCallback((): void => {
    setTitle("");
    setCategory("");
    setDueOn("");
    setPartnerDraft(null);
    setErrors(null);
    setLastOutcome(null);
  }, []);
  const read = gifts.data;
  const envelope = read?.kind === "envelope" ? read.envelope : null;
  const located = useMemo(() => locateRow(envelope, giftId), [envelope, giftId]);
  const retry = { label: "Read this gift again", onClick: (): void => void gifts.refetch() };
  const framed = (children: ReactNode): ReactElement => <Frame {...{ dir, className, returnHref }}>{children}</Frame>;
  if (gifts.isPending) return framed(<LoadingBody />);
  if (gifts.isError || read === undefined) return framed(<StateNotice kind="unavailable" headingLevel={1} title="This gift could not be read" description={"The ledger read behind this record did not answer, so no amount is shown: this is an outage rather than a zero and rather than an empty record."} retry={retry} />);
  if (read.kind === "denied") return framed(<StateNotice kind="denied" headingLevel={1} title="This gift is not available in this context" reasonCode={read.denied.reasonCode} description={DENIED_DESCRIPTION} />);
  if (read.kind === "unavailable") return framed(<StateNotice kind="unavailable" headingLevel={1} title="The source behind this gift is unavailable" source={read.unavailable.source} description={read.unavailable.guidance} retry={retry} />);
  if (read.kind === "refused") return framed(<StateNotice kind="refused" headingLevel={1} title="This gift's request was refused" description={refusalSummary(read.refused)} />);
  if (located === null) {
    const total = read.envelope.data.report.total;
    const description = `This read returned ${String(total)} ${total === 1 ? "row" : "rows"} for the filters this address carries, and none of them is the record it names. A record outside these filters or this page is simply not in this result, so this surface does not claim the gift does not exist.`;
    return framed(<StateNotice kind="empty" headingLevel={1} title={EMPTY_STATES.gifts.title} description={description} action={EMPTY_STATES.gifts.action} />);
  }
  const { row, index } = located;
  const view = read.envelope;
  const snapshot = view.data.report.snapshot;
  const amountState: ValueState = exponentOf(row.amount.currency) === undefined ? "unknown" : (view.valueStates[`rows.${String(index)}.amount`] ?? (row.amount.minorUnits === 0 ? "zero" : "value"));
  const grain: RowGrain = row.allocationId === undefined ? "gift" : "allocation";
  const correction = correctionAgainst(view.data.report.rows, row);
  const correctedRow = row.refundOf === undefined ? undefined : view.data.report.rows.find((candidate) => candidate.giftRowId === row.refundOf);
  const originalDate = row.originalGiftOn === undefined ? undefined : String(row.originalGiftOn);
  const entryDate = String(row.entryOn);
  const partnerId = partnerDraft ?? (row.attribution.kind === "partner" ? row.attribution.partnerId : "");
  const drafts: Readonly<Record<FollowUpFieldName, string>> = { title, category, dueOn, partnerId };
  const draftSetters: Readonly<Record<FollowUpFieldName, (value: string) => void>> = { title: setTitle, category: setCategory, dueOn: setDueOn, partnerId: setPartnerDraft };
  const candidate: FollowUpTaskInput = { title, category, dueOn, ...(partnerId.trim() === "" ? {} : { partnerId }) };
  const parsedCandidate = followUpTaskPayloadSchema.safeParse(candidate);
  const payload: FollowUpTaskInput = parsedCandidate.success ? parsedCandidate.data : candidate;
  const trimmed = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
  const reviewed = { title: trimmed(payload.title), category: trimmed(payload.category) || undefined, dueOn: trimmed(payload.dueOn) || undefined, partnerId: trimmed(payload.partnerId) || undefined };
  const submit: MutationSubmit<FollowUpTaskInput> = (request) => followUp.mutateAsync({ scope: request.scope, expectedRevision: request.expectedRevision, payload: request.payload });
  return (
    <Frame dir={dir} className={className} returnHref={returnHref}>
      <header className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant="secondary">{GRAIN_WORD[grain]}</Badge>
          <Badge variant="outline">{VALUE_STATE_WORD[amountState]}</Badge>
          {row.refundOf === undefined ? null : <Badge variant="outline">Correction</Badge>}
        </div>
        <h1 {...{ id: recordHeadingId, className: "type-page-title" }}>Gift record</h1>
        <p className="type-supporting min-w-0 text-pretty">One row of received support, stated at the grain, in the currency and with the provenance the source reports for it. Nothing on this record is recomputed: every figure is the one the read returned.</p>
        <p className="flex min-w-0 flex-wrap items-baseline gap-2 break-words" data-grain={grain} data-value-state={amountState} data-gift-row-id={row.giftRowId}>
          <AmountValue money={row.amount} valueState={amountState} locale={locale} emphasis="headline" />
        </p>
      </header>
      <Card className="min-w-0">
        <CardContent>
          <dl className="flex min-w-0 flex-col gap-3 divide-y divide-border">
            <Fact term="Original gift date">
              {originalDate === undefined ? (
                "The source did not establish when this gift was given, so no date stands in its place."
              ) : (
                <>
                  <time dateTime={originalDate}>
                    <bdi className="mono-identifier">{originalDate}</bdi>
                  </time>{" "}
                  — {PRECISION_LEAD[row.datePrecision]}
                </>
              )}
            </Fact>
            <Fact term="Entered in the source on">
              <time dateTime={entryDate}>
                <bdi className="mono-identifier">{entryDate}</bdi>
              </time>{" "}
              — The day the source entered this row, which may differ from the day of the gift and is not the day it was read.
            </Fact>
            <Fact term="Currency and precision">
              <CurrencyPrecision currency={row.amount.currency} />
            </Fact>
            <Fact term="Attribution">
              {row.attribution.kind === "partner" ? (
                <>
                  The source attributes this row to one partner record: <bdi className="mono-identifier">{row.attribution.partnerId}</bdi>. An equal-looking name or address in another record is not this reference, and nothing here joins the two.
                </>
              ) : row.attribution.kind === "anonymous" ? (
                "The source records this support as anonymous, so no partner is named here and none is inferred from another record."
              ) : (
                "The source supplied no attribution for this support. That is an absent attribution rather than an anonymous gift and rather than a missing record: the amount stands, and the partner it belongs to is not known here."
              )}
            </Fact>
            <Fact term="Designation">{row.designation === undefined ? "The source states no designation for this gift." : <bdi>{row.designation}</bdi>}</Fact>
            <Fact term="This figure's state">
              <span className="font-medium text-foreground">{VALUE_STATE_WORD[amountState]}</span> — {VALUE_STATE_MEANING[amountState]}
            </Fact>
          </dl>
        </CardContent>
      </Card>
      <SectionCard headingId={grainHeadingId} title="What this row is" cardClassName="min-w-0" contentClassName="flex min-w-0 flex-col gap-3">
        <p className="type-supporting">
          {grain === "allocation"
            ? "This row is one authorised allocation of a gift. A gift split between several destinations is reported once per allocation, and only the allocation this read is authorised to see is shown here: no other allocation of the same gift appears on this record, and none of them is added together with it."
            : row.refundOf === undefined
              ? "This row is a whole gift that carries no allocation, so it is the gift itself rather than a part of one. Nothing here divides it into allocations and no part of it is shown in place of the whole."
              : "This row is a correction that carries no allocation. It is recorded against the row named in the correction section below, so it stands on its own rather than as a part of that row: nothing here divides it into allocations and nothing here folds it back into the row it corrects."}
        </p>
        <p className="type-supporting">Another row of the same gift may exist in the ledger. Each row is its own record, and this one neither totals the others nor stands in for them.</p>
        <p className="type-supporting">The snapshot statement below states the grain rule this family reports on, including why a view that holds both grain levels counts the gift once.</p>
      </SectionCard>
      {correction === undefined && row.refundOf === undefined ? null : (
        <SectionCard headingId={correctionHeadingId} title={row.refundOf === undefined ? "A correction against this row is also in this result" : "This row is a correction"} cardClassName="min-w-0" contentClassName="flex min-w-0 flex-col gap-3">
          {row.refundOf === undefined ? null : (
            <p className="type-supporting">
              This row records a refund or correction against another row of this ledger, which the source states by that row's own row reference, <bdi className="mono-identifier">{row.refundOf}</bdi>. The row reference is the row's own identity and the gift reference is the gift the row belongs to, so the two are two
              references to one record rather than one reference spelled two ways.{" "}
              {correctedRow === undefined ? (
                "This read holds no row with that reference, so the row it corrects is not in this result, and the gift reference that row carries is not restated here."
              ) : (
                <>
                  That row is in this result, listed under the gift reference <bdi className="mono-identifier">{correctedRow.giftId}</bdi>.
                </>
              )}{" "}
              It carries its own date and its own amount, exactly as the source states them above, and it is never netted into the row it corrects: the two are read as two records, so the change is explained in the open rather than hidden inside a difference.
            </p>
          )}
          {correction === undefined ? null : (
            <p className="type-supporting">
              The result also holds the correction recorded against this row: the row <bdi className="mono-identifier">{correction.giftRowId}</bdi>, with its own date and its own amount. Both records stand as the source states them, and neither is combined with the other here.
            </p>
          )}
        </SectionCard>
      )}
      <SectionCard headingId={provenanceHeadingId} title="Provenance" cardClassName="min-w-0" contentClassName="flex min-w-0 flex-col gap-3">
        <p className="type-supporting">The record this row came from, as one opaque reference. It is printed exactly as the source gave it: it is never linked, never parsed, and never compared with another reference to decide what it means.</p>
        <dl className="flex min-w-0 flex-col gap-2">
          {[
            { label: "Source system", value: row.provenance.system },
            { label: "Source reference", value: row.provenance.reference },
            { label: "One reference", value: formatSourceReference(row.provenance) },
          ].map((fact) => (
            <Fact key={fact.label} term={fact.label} value={<bdi className="mono-identifier">{fact.value}</bdi>} />
          ))}
        </dl>
      </SectionCard>
      <SectionCard headingId={snapshotHeadingId} title="Basis, coverage and as-of" cardClassName="min-w-0" contentClassName="flex min-w-0 flex-col gap-3">
        <SnapshotStatement basis={snapshot.basis} currencies={snapshot.currencies} period={{ from: String(snapshot.period.from), to: String(snapshot.period.to) }} coverage={view.coverage} asOf={view.asOf} isCurrentPeriod={snapshot.period.state === "in-progress"} locale={locale} />
        <p className="type-supporting text-pretty">Every figure on this record was read once, at the snapshot stated here. Two surfaces compare only when their coverage and their as-of instant agree.</p>
      </SectionCard>
      <section aria-labelledby={followUpHeadingId} className="flex min-w-0 flex-col gap-3">
        <h2 {...{ id: followUpHeadingId, className: "type-section-title" }}>Follow up on this gift</h2>
        <p className="type-supporting min-w-0 text-pretty">{GIVING_FOLLOW_UP.description}</p>
        <Card className="min-w-0">
          <CardContent>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              {FOLLOW_UP_FIELDS.map((field) => {
                const fieldClass = "wide" in field && field.wide ? "min-w-0 sm:col-span-2" : undefined;
                const autoComplete = "autoComplete" in field ? field.autoComplete : undefined;
                const fieldType = "type" in field ? field.type : undefined;
                const fieldDescription = field.name === "dueOn" ? `${field.description} ${civilDateConvention(drafts.dueOn)}` : field.description;
                return (
                  <FormField key={field.name} label={field.label} name={field.name} description={fieldDescription} error={messagesFor(errors, field.name)} required={"required" in field && field.required} optionalHint={"hint" in field && field.hint} className={fieldClass}>
                    {(control) => {
                      const onFieldChange = (event: ChangeEvent<HTMLInputElement>): void => {
                        draftSetters[field.name](event.target.value);
                        setErrors((held) => withoutField(held, field.name));
                      };
                      return <Input id={control.id} name={field.name} type={fieldType} value={drafts[field.name]} autoComplete={autoComplete} required={"required" in field ? control.required : undefined} aria-describedby={control.describedBy} aria-invalid={control.invalid || undefined} onChange={onFieldChange} />;
                    }}
                  </FormField>
                );
              })}
            </div>
          </CardContent>
        </Card>
        <ActionReview<FollowUpTaskInput>
          title="Review the follow-up task"
          description="Confirming creates the task described here. Nothing else on this page is touched, and the summary states exactly what the task will carry."
          consequence={
            <dl className="flex min-w-0 flex-col gap-2">
              <Fact term={TASK_FIELD_LABELS.title} value={reviewed.title === "" ? "Not stated yet" : <bdi>{reviewed.title}</bdi>} />
              <Fact term={TASK_FIELD_LABELS.category} value={reviewed.category === undefined ? "No category" : <bdi>{reviewed.category}</bdi>} />
              <Fact
                term={TASK_FIELD_LABELS.dueOn}
                value={
                  reviewed.dueOn === undefined ? (
                    "No due date"
                  ) : (
                    <time dateTime={reviewed.dueOn}>
                      <bdi className="mono-identifier">{reviewed.dueOn}</bdi>
                    </time>
                  )
                }
              />
              <Fact term={TASK_FIELD_LABELS.partnerId} value={reviewed.partnerId === undefined ? "No partner record" : <bdi className="mono-identifier">{reviewed.partnerId}</bdi>} />
              <Fact term="Kind" value="Task" />
            </dl>
          }
          confirmLabel={GIVING_FOLLOW_UP.actionLabel}
          input={{ scope, expectedRevision: view.revision, payload }}
          submit={submit}
          onSettled={settle}
          fieldLabels={FIELD_LABELS}
          headingLevel={3}
        />
        {lastOutcome !== null && (lastOutcome.outcome === "accepted" || lastOutcome.outcome === "alreadyAccepted") ? (
          <div className="flex min-w-0 flex-col gap-2">
            <p className="type-supporting min-w-0 text-pretty">{GIVING_FOLLOW_UP.resultNote}</p>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Button {...{ type: "button", variant: "outline", onClick: startAnother }}>Start another follow-up</Button>
            </div>
          </div>
        ) : null}
      </section>
    </Frame>
  );
}
export default GiftDetail;
