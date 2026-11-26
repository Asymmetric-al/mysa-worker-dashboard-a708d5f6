"use client";
import { ArrowLeftIcon, ReceiptTextIcon } from "lucide-react";
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
import { CopyButton } from "@/components/ui/copy-button";
import { IconTile } from "@/components/ui/icon-tile";
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
const TASK_FIELD_LABELS = { title: "Task title", category: "Category", dueOn: "Due date", partnerId: "Partner reference" } as const;
const FIELD_LABELS: Readonly<Record<string, string | undefined>> = { ...TASK_FIELD_LABELS, operation: "Request" };
const GRAIN_WORD: Readonly<Record<RowGrain, string>> = { gift: "Whole gift", allocation: "Split allocation" };
const VALUE_STATE_WORD: Readonly<Record<ValueState, string>> = { value: "Recorded", zero: "Recorded zero", unknown: "Unknown", withheld: "Withheld", unavailable: "Unavailable", "incomplete-subtotal": "Incomplete subtotal" };
const PRECISION_LEAD: Readonly<Record<LedgerRow["datePrecision"], string>> = { date: "Exact date recorded by the source.", approximate: "Approximate date from the source.", unknown: "Date wasn’t recorded by the source." };
const DECIMAL_PLACES_WORD: Readonly<Record<number, string>> = { 0: "no decimal places", 1: "1 decimal place", 2: "2 decimal places", 3: "3 decimal places" };
const DENIED_DESCRIPTION = "Your current session doesn’t have permission to view gift records in this ministry context.";
const FOLLOW_UP_FIELDS = [
  { name: "title", label: TASK_FIELD_LABELS.title, description: "Short summary for your task list (for example, “Send thank-you note for March gift”).", required: true, wide: true },
  { name: "category", label: TASK_FIELD_LABELS.category, description: "Optional tag such as “Thank you” or “Follow-up”.", hint: true },
  { name: "dueOn", label: TASK_FIELD_LABELS.dueOn, description: "Calendar day you plan to complete this (optional).", hint: true, type: "date" },
  { name: "partnerId", label: TASK_FIELD_LABELS.partnerId, description: "Pre-filled from this gift when available. Clear it if you don’t want to link a partner.", hint: true, wide: true, autoComplete: "off" },
] as const;
type FollowUpFieldName = (typeof FOLLOW_UP_FIELDS)[number]["name"];
const Fact = factFrame({ rowClassName: "flex min-w-0 flex-col gap-1", termClassName: "text-sm font-medium", valueClassName: "min-w-0 text-sm text-pretty break-words text-muted-foreground" });
const Frame = ({ dir, className, returnHref, children }: { readonly dir?: "ltr" | "rtl"; readonly className?: string; readonly returnHref: string; readonly children: ReactNode }): ReactElement => (
  <div data-slot="gift-detail" dir={dir} className={cn("mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6 py-6", className)}>
    <nav aria-label="Return path" className="min-w-0">
      <Link href={returnHref} className="inline-link inline-flex min-h-target max-w-full items-center gap-1.5 text-sm font-medium text-primary">
        <ArrowLeftIcon aria-hidden="true" className="size-4 shrink-0 rtl:rotate-180" />
        <span className="min-w-0 text-pretty">Back to Gifts</span>
      </Link>
    </nav>
    {children}
  </div>
);
const LoadingBody = (): ReactElement => (
  <div aria-busy={true} className="flex min-w-0 flex-col gap-4">
    <p className="sr-only">Loading gift details…</p>
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
      <>The source didn’t specify a currency, so this amount can’t be totalled or compared with other currencies.</>
    ) : (
      <>This currency’s decimal precision isn’t configured here, so the amount is shown as unknown rather than rounded or guessed.</>
    );
  }
  return (
    <>
      <bdi className="mono-identifier">{currency}</bdi> uses {DECIMAL_PLACES_WORD[exponent] ?? `${String(exponent)} decimal places`}.
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
  const retry = { label: "Try again", onClick: (): void => void gifts.refetch() };
  const framed = (children: ReactNode): ReactElement => <Frame {...{ dir, className, returnHref }}>{children}</Frame>;
  if (gifts.isPending) return framed(<LoadingBody />);
  if (gifts.isError || read === undefined) return framed(<StateNotice kind="unavailable" headingLevel={1} title="Couldn’t load this gift" description={"Couldn’t reach the giving source right now — shown as unavailable rather than empty or zero."} retry={retry} />);
  if (read.kind === "denied") return framed(<StateNotice kind="denied" headingLevel={1} title="This gift isn’t available in this context" reasonCode={read.denied.reasonCode} description={DENIED_DESCRIPTION} />);
  if (read.kind === "unavailable") return framed(<StateNotice kind="unavailable" headingLevel={1} title="Giving source unavailable" source={read.unavailable.source} description={read.unavailable.guidance} retry={retry} />);
  if (read.kind === "refused") return framed(<StateNotice kind="refused" headingLevel={1} title="Couldn’t open this gift" description={refusalSummary(read.refused)} />);
  if (located === null) {
    const total = read.envelope.data.report.total;
    const description = `This filter returned ${String(total)} ${total === 1 ? "gift" : "gifts"}, and none matched this ID. The gift may sit outside your current period or filter settings.`;
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
      <header className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border/80 bg-surface-subtle p-5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <IconTile variant="soft" size="sm">
            <ReceiptTextIcon />
          </IconTile>
          <Badge variant="secondary">{GRAIN_WORD[grain]}</Badge>
          <Badge variant="outline">{VALUE_STATE_WORD[amountState]}</Badge>
          {row.refundOf === undefined ? null : <Badge variant="outline">Correction</Badge>}
        </div>
        <h1 {...{ id: recordHeadingId, className: "type-page-title" }}>Gift details</h1>
        <p className="type-supporting min-w-0 text-pretty">Read-only gift record from your giving source, shown in its original currency and allocation.</p>
        <p className="flex min-w-0 flex-wrap items-baseline gap-2 break-words" data-grain={grain} data-value-state={amountState} data-gift-row-id={row.giftRowId}>
          <AmountValue money={row.amount} valueState={amountState} locale={locale} emphasis="headline" />
        </p>
      </header>
      <Card className="min-w-0">
        <CardContent>
          <dl className="flex min-w-0 flex-col gap-3 divide-y divide-border/70 [&>div]:pt-3 [&>div:first-child]:pt-0">
            <Fact term="Date given">
              {originalDate === undefined ? (
                "No gift date recorded by the source."
              ) : (
                <>
                  <time dateTime={originalDate}>
                    <bdi className="mono-identifier">{originalDate}</bdi>
                  </time>{" "}
                  — {PRECISION_LEAD[row.datePrecision]}
                </>
              )}
            </Fact>
            <Fact term="Recorded on">
              <time dateTime={entryDate}>
                <bdi className="mono-identifier">{entryDate}</bdi>
              </time>{" "}
              — When the giving source entered this record (may differ from the gift date).
            </Fact>
            <Fact term="Currency precision">
              <CurrencyPrecision currency={row.amount.currency} />
            </Fact>
            <Fact term="Partner">
              {row.attribution.kind === "partner" ? (
                <>
                  Partner record <bdi className="mono-identifier">{row.attribution.partnerId}</bdi>. Linked directly by source ID, never guessed from a matching name.
                </>
              ) : row.attribution.kind === "anonymous" ? (
                "Anonymous gift — no partner is named or inferred."
              ) : (
                "Unattributed in the giving source — the amount stands, and no partner is guessed."
              )}
            </Fact>
            <Fact term="Designation">{row.designation === undefined ? "No designation recorded." : <bdi>{row.designation}</bdi>}</Fact>
            <Fact term="Value status">
              <span className="font-medium text-foreground">{VALUE_STATE_WORD[amountState]}</span> — {VALUE_STATE_MEANING[amountState]}
            </Fact>
          </dl>
        </CardContent>
      </Card>
      <SectionCard headingId={grainHeadingId} title="How this row is counted" cardClassName="min-w-0" contentClassName="flex min-w-0 flex-col gap-3">
        <p className="type-supporting">
          {grain === "allocation"
            ? "This row is one authorised allocation of a split gift. Only the allocation visible to your account is shown here."
            : row.refundOf === undefined
              ? "This row is a complete unsplit gift."
              : "This row is a separate correction or refund entry linked to the original row below, never silently netted out."}
        </p>
        <p className="type-supporting">Each row stands on its own; totals across the ledger count each gift once without double-counting splits.</p>
      </SectionCard>
      {correction === undefined && row.refundOf === undefined ? null : (
        <SectionCard headingId={correctionHeadingId} title={row.refundOf === undefined ? "Related correction" : "Correction or refund"} cardClassName="min-w-0" contentClassName="flex min-w-0 flex-col gap-3">
          {row.refundOf === undefined ? null : (
            <p className="type-supporting">
              Adjusts row <bdi className="mono-identifier">{row.refundOf}</bdi>.{" "}
              {correctedRow === undefined ? (
                "The original row isn’t in your current filter view."
              ) : (
                <>
                  The original row appears under gift <bdi className="mono-identifier">{correctedRow.giftId}</bdi>.
                </>
              )}{" "}
              Both rows stay visible so adjustments remain transparent.
            </p>
          )}
          {correction === undefined ? null : (
            <p className="type-supporting">
              Correction row <bdi className="mono-identifier">{correction.giftRowId}</bdi> is also in this view with its own date and amount. Both rows stay separate so nothing is hidden.
            </p>
          )}
        </SectionCard>
      )}
      <SectionCard headingId={provenanceHeadingId} title="Source provenance" cardClassName="min-w-0" contentClassName="flex min-w-0 flex-col gap-3">
        <p className="type-supporting">Exact source identifiers as reported by your giving system.</p>
        <dl className="flex min-w-0 flex-col gap-2">
          {[
            { label: "Source system", value: row.provenance.system, copy: false },
            { label: "Source reference", value: row.provenance.reference, copy: true },
            { label: "Full reference", value: formatSourceReference(row.provenance), copy: true },
          ].map((fact) => (
            <Fact
              key={fact.label}
              term={fact.label}
              value={
                <span className="inline-flex flex-wrap items-center gap-1">
                  <bdi className="mono-identifier">{fact.value}</bdi>
                  {fact.copy ? <CopyButton value={fact.value} label={`Copy ${fact.label.toLowerCase()}`} /> : null}
                </span>
              }
            />
          ))}
        </dl>
      </SectionCard>
      <SectionCard headingId={snapshotHeadingId} title="Snapshot & coverage" cardClassName="min-w-0" contentClassName="flex min-w-0 flex-col gap-3">
        <SnapshotStatement basis={snapshot.basis} currencies={snapshot.currencies} period={{ from: String(snapshot.period.from), to: String(snapshot.period.to) }} coverage={view.coverage} asOf={view.asOf} isCurrentPeriod={snapshot.period.state === "in-progress"} locale={locale} />
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
          title="Review follow-up task"
          description="Adds this task to your Tasks list without modifying the gift record."
          consequence={
            <dl className="flex min-w-0 flex-col gap-2">
              <Fact term={TASK_FIELD_LABELS.title} value={reviewed.title === "" ? "Not entered yet" : <bdi>{reviewed.title}</bdi>} />
              <Fact term={TASK_FIELD_LABELS.category} value={reviewed.category === undefined ? "None" : <bdi>{reviewed.category}</bdi>} />
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
              <Fact term={TASK_FIELD_LABELS.partnerId} value={reviewed.partnerId === undefined ? "None" : <bdi className="mono-identifier">{reviewed.partnerId}</bdi>} />
              <Fact term="Type" value="Task" />
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
              <Button {...{ type: "button", variant: "outline", onClick: startAnother }}>Create another follow-up</Button>
            </div>
          </div>
        ) : null}
      </section>
    </Frame>
  );
}
export default GiftDetail;
