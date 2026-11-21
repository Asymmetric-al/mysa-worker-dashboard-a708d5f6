"use client";
/**
 * The gift detail: one row of received support at the grain the source reports it, with its split,
 * its correction and its provenance stated rather than inferred, the coverage and as-of the read ran
 * at — and the one follow-up it may lead to, an ordinary task that changes nothing about the gift.
 */
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useId, useMemo, useState, type ReactElement, type ReactNode } from "react";
import ActionReview, { type MutationSubmit } from "@/components/action-review";
import { fieldErrorsFromInvalid, FormField, type FieldErrorLookup } from "@/components/form-field";
import StateNotice from "@/components/state-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
// The row this record is about, derived from the ledger read rather than described again
/** One row of the ledger read, taken from the read's own type so this file holds no second description of it. */
type LedgerRow = GiftsEnvelope["data"]["report"]["rows"][number];
/** The grain one row is reported at: a whole gift, or one authorised allocation of one. */
type RowGrain = "gift" | "allocation";
/** The words this record states in its own voice */
const RECORD_HEADING = "Gift record";
const RECORD_LEAD =
  "One row of received support, stated at the grain, in the currency and with the provenance the source reports for it. Nothing on this record is recomputed: every figure is the one the read returned.";
const RETURN_NAV_LABEL = "Return path";
const RETURN_LINK_LABEL = "Back to the gifts ledger, with the filters, sort and page you came from";
const GRAIN_HEADING = "What this row is";
const GRAIN_ALLOCATION_LEAD =
  "This row is one authorised allocation of a gift. A gift split between several destinations is " +
  "reported once per allocation, and only the allocation this read is authorised to see is shown " +
  "here: no other allocation of the same gift appears on this record, and none of them is added " +
  "together with it.";
const GRAIN_GIFT_LEAD =
  "This row is a whole gift that carries no allocation, so it is the gift itself rather than a part of one. Nothing here divides it into allocations and no part of it is shown in place of the whole.";
const GRAIN_RULE_POINTER = "The snapshot statement below states the grain rule this family reports on, including why a view that holds both grain levels counts the gift once.";
const GRAIN_SIBLING_NOTE = "Another row of the same gift may exist in the ledger. Each row is its own record, and this one neither totals the others nor stands in for them.";
const CORRECTION_HEADING = "This row is a correction";
const CORRECTION_AGAINST_HEADING = "A correction against this row is also in this result";
const CORRECTION_BADGE = "Correction";
const PROVENANCE_HEADING = "Provenance";
const PROVENANCE_LEAD =
  "The record this row came from, as one opaque reference. It is printed exactly as the source gave it: it is never linked, never parsed, and never compared with another reference to decide what it means.";
const SNAPSHOT_HEADING = "Basis, coverage and as-of";
const SNAPSHOT_NOTE = "Every figure on this record was read once, at the snapshot stated here. Two surfaces compare only when their coverage and their as-of instant agree.";
const FOLLOW_UP_HEADING = "Follow up on this gift";
const REVIEW_TITLE = "Review the follow-up task";
const REVIEW_DESCRIPTION = "Confirming creates the task described here. Nothing else on this page is touched, and the summary states exactly what the task will carry.";
const REVIEW_NO_CATEGORY = "No category";
const REVIEW_NO_DUE_DATE = "No due date";
const REVIEW_NO_PARTNER = "No partner record";
const REVIEW_KIND = "Kind";
const REVIEW_KIND_TASK = "Task";
const REVIEW_UNSTATED = "Not stated yet";
const START_ANOTHER_LABEL = "Start another follow-up";
const TITLE_LABEL = "What the task is for";
const TITLE_DESCRIPTION = "A phrase that reads at a glance in a list, such as \u201cThank her for the March gift\u201d.";
const CATEGORY_LABEL = "Category";
const CATEGORY_DESCRIPTION = "Your own short label, such as \u201cThank you\u201d. It is free text rather than a fixed list, and it changes nothing else on the task.";
const DUE_LABEL = "Due date";
const DUE_DESCRIPTION = "The calendar day you intend to do this on. Leave it empty for a task with no date: a due date is not an appointment, and a planned day proves nothing about contact.";
const PARTNER_LABEL = "Partner reference";
const PARTNER_DESCRIPTION =
  "The partner record this task is about, carried from the gift as an identifier. Clear it for a task that names no record. It is never an amount and never a guess at who gave.";
const FIELD_LABELS: Readonly<Record<string, string | undefined>> = {
  title: TITLE_LABEL,
  category: CATEGORY_LABEL,
  dueOn: DUE_LABEL,
  partnerId: PARTNER_LABEL,
  operation: "Request",
};
const LOADING_TEXT = "Reading this gift, its grain and the coverage it falls in.";
const LEDGER_HREF = "/support/gifts";
const SOURCE_SYSTEM_LABEL = "Source system";
const SOURCE_REFERENCE_LABEL = "Source reference";
const ORIGINAL_DATE_LABEL = "Original gift date";
const ENTRY_DATE_LABEL = "Entered in the source on";
const ENTRY_DATE_NOTE = "The day the source entered this row, which may differ from the day of the gift and is not the day it was read.";
const CURRENCY_LABEL = "Currency and precision";
const ATTRIBUTION_LABEL = "Attribution";
const DESIGNATION_LABEL = "Designation";
const DESIGNATION_UNSTATED = "The source states no designation for this gift.";
const STATE_LABEL = "This figure\u2019s state";
const DATE_UNSTATED = "The source did not establish when this gift was given, so no date stands in its place.";
const PRECISION_LEAD: Readonly<Record<LedgerRow["datePrecision"], string>> = {
  date: "The source states this as a precise day.",
  approximate: "The source states this date approximately, so it is a guide rather than a recorded day.",
  unknown: "The source did not establish this date, so it is not shown as one.",
};
const GRAIN_WORD: Readonly<Record<RowGrain, string>> = {
  gift: "Gift grain",
  allocation: "Allocation grain",
};
const VALUE_STATE_WORD: Readonly<Record<ValueState, string>> = {
  value: "Recorded amount",
  zero: "Recorded zero",
  unknown: "Unknown amount",
  withheld: "Withheld",
  unavailable: "Source unavailable",
  "incomplete-subtotal": "Incomplete subtotal",
};
const DECIMAL_PLACES_WORD: Readonly<Record<number, string>> = {
  0: "no decimal places",
  1: "one decimal place",
  2: "two decimal places",
  3: "three decimal places",
};
const ATTRIBUTION_ANONYMOUS = "The source records this support as anonymous, so no partner is named here and none is inferred from another record.";
const ATTRIBUTION_UNRESOLVED =
  "The source supplied no attribution for this support. That is an absent attribution rather than " +
  "an anonymous gift and rather than a missing record: the amount stands, and the partner it belongs " +
  "to is not known here.";
/** What one field of the record states */
function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-sm font-medium">{label}</dt>
      <dd className="min-w-0 text-sm text-pretty break-words text-muted-foreground">{children}</dd>
    </div>
  );
}
/** One titled block of the record body. */
function SectionCard({ id, title, children }: { readonly id: string; readonly title: string; readonly children: ReactNode }): ReactElement {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>
          <h2 id={id} className="font-heading text-base font-medium">
            {title}
          </h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3">{children}</CardContent>
    </Card>
  );
}
/** The frame every state of this record renders in: the page column, the return path and the direction the content is read in. */
function Frame({ dir, className, returnHref, children }: { readonly dir?: "ltr" | "rtl"; readonly className?: string; readonly returnHref: string; readonly children: ReactNode }): ReactElement {
  return (
    <div data-slot="gift-detail" dir={dir} className={cn("mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6 py-6", className)}>
      <nav aria-label={RETURN_NAV_LABEL} className="min-w-0">
        <Link href={returnHref} className="inline-flex min-h-target max-w-full items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline">
          <ArrowLeftIcon aria-hidden="true" className="size-4 shrink-0 rtl:rotate-180" />
          <span className="min-w-0 text-pretty">{RETURN_LINK_LABEL}</span>
        </Link>
      </nav>
      {children}
    </div>
  );
}
/** The busy body: a skeleton of the record's shape, so loading is never rendered as an empty record. */
function LoadingBody(): ReactElement {
  return (
    <div aria-busy={true} className="flex min-w-0 flex-col gap-4">
      <p className="sr-only">{LOADING_TEXT}</p>
      <div aria-hidden="true" className="flex min-w-0 flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-5 w-2/3" />
        <div className="flex min-w-0 flex-col gap-2 rounded-2xl bg-card p-6 ring-1 ring-foreground/10">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
        <div className="flex min-w-0 flex-col gap-2 rounded-2xl bg-card p-6 ring-1 ring-foreground/10">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    </div>
  );
}
/** The ledger address this record returns to: the query it was opened with, without the reference that names this row. */
function ledgerHrefOf(query: GiftsQuery): string {
  const stated = toGiftsParams(query).toString();
  return stated === "" ? LEDGER_HREF : `${LEDGER_HREF}?${stated}`;
}
/** Where one row sits in the ledger read, by the row's own identity first and then by the gift it belongs to. */
function locateRow(envelope: GiftsEnvelope | null, giftId: string): { readonly row: LedgerRow; readonly index: number } | null {
  if (envelope === null) {
    return null;
  }
  const rows = envelope.data.report.rows;
  const byRow = rows.findIndex((candidate) => candidate.giftRowId === giftId);
  const index = byRow >= 0 ? byRow : rows.findIndex((candidate) => candidate.giftId === giftId);
  if (index < 0) {
    return null;
  }
  const row = rows[index];
  return row === undefined ? null : { row, index };
}
/** The row the source recorded as a correction against this one, when the same read returned it. */
function correctionAgainst(rows: readonly LedgerRow[], row: LedgerRow): LedgerRow | undefined {
  return rows.find((candidate) => candidate.refundOf !== undefined && candidate.refundOf === row.giftRowId);
}
/**
 * The state the row's amount is rendered in.
 *
 * The read records `value` or `zero` for a row amount and derives `incomplete-subtotal` from partial
 * coverage. Neither can express an amount whose currency the source did not identify, because at row
 * grain the currency is the only evidence of it, so such a row is stated as `unknown` here rather
 * than printed at a precision or under a code the source never gave.
 */
function amountStateOf(row: LedgerRow, index: number, valueStates: Readonly<Record<string, ValueState>>): ValueState {
  if (exponentOf(row.amount.currency) === undefined) {
    return "unknown";
  }
  const recorded = valueStates[`rows.${String(index)}.amount`];
  if (recorded !== undefined) {
    return recorded;
  }
  return row.amount.minorUnits === 0 ? "zero" : "value";
}
/** The rows a field's messages are cleared from once the worker edits that field. */
function withoutField(lookup: FieldErrorLookup | null, path: string): FieldErrorLookup | null {
  if (lookup === null || lookup.byField[path] === undefined) {
    return lookup;
  }
  const byField: Record<string, readonly string[]> = { ...lookup.byField };
  delete byField[path];
  return { byField, form: lookup.form, count: Object.keys(byField).length + lookup.form.length };
}
function messagesFor(lookup: FieldErrorLookup | null, path: string): readonly string[] | undefined {
  return lookup === null ? undefined : lookup.byField[path];
}
/**
 * The precision this amount is stated at, taken from the currency the source named rather than from a
 * precision this surface would otherwise have to assume.
 */
function CurrencyPrecision({ currency }: { readonly currency: string }): ReactElement {
  const exponent = exponentOf(currency);
  if (exponent === undefined) {
    return currency === UNKNOWN_CURRENCY ? (
      <>The source identified no currency for this amount, so no code is shown here, nothing is assumed in its place, and the amount cannot be totalled or compared with another.</>
    ) : (
      <>
        The source named a currency this application holds no exponent for, so the amount is stated as unknown rather than at a precision this surface would have had to assume. The code the source
        used is not repeated here, because repeating it would present it as one this record can state.
      </>
    );
  }
  const places = DECIMAL_PLACES_WORD[exponent] ?? `${String(exponent)} decimal places`;
  return (
    <>
      <bdi className="mono-identifier">{currency}</bdi> has {places}, so this amount is stated at exactly that precision and never at one this application assumes.
    </>
  );
}
/** Props of {@link GiftDetail}. */
export type GiftDetailProps = {
  readonly scope: Scope;
  /** The row or gift this address names. Opaque: it is matched against the read's own rows and never parsed. */
  readonly giftId: string;
  readonly locale: string;
  readonly dir?: "ltr" | "rtl";
  /** The ledger query this record was opened from, so the return path restores the filters, sort and page. */
  readonly ledgerQuery?: GiftsQuery;
  readonly className?: string;
};
/** One gift or allocation, its grain, its correction and provenance, its coverage, and the one follow-up it may lead to. */
export function GiftDetail({ scope, giftId, locale, dir, ledgerQuery, className }: GiftDetailProps): ReactElement {
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
  // `null` until the worker edits it, so the reference the gift carries stays the default without
  // being copied into state on every render the read completes.
  const [partnerDraft, setPartnerDraft] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrorLookup | null>(null);
  const [lastOutcome, setLastOutcome] = useState<MutationOutcome | null>(null);
  const followUp = useFollowUpTask();
  const carriedQuery = useMemo<GiftsQuery>(() => ledgerQuery ?? parseGiftsQuery(search), [ledgerQuery, search]);
  // The read is the ledger read this record's address carries, without the reference that names the
  // row. Asking for the query the ledger asks for means an opened ledger already holds the envelope
  // this record renders, and the return path restores exactly the view the worker left. A row this
  // page does not hold — because the address states a different page or filter — is reported as the
  // read reports it rather than fetched through a second, wider read.
  const readQuery = useMemo<GiftsQuery>(() => ({ ...carriedQuery, giftId: undefined }), [carriedQuery]);
  const gifts = useGifts({ scope, query: readQuery });
  const returnHref = useMemo(() => ledgerHrefOf(readQuery), [readQuery]);
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
  const retryRead = (): void => {
    void gifts.refetch();
  };
  if (gifts.isPending) {
    return (
      <Frame dir={dir} className={className} returnHref={returnHref}>
        <LoadingBody />
      </Frame>
    );
  }
  if (gifts.isError || read === undefined) {
    return (
      <Frame dir={dir} className={className} returnHref={returnHref}>
        <StateNotice
          kind="unavailable"
          headingLevel={1}
          title="This gift could not be read"
          description="The ledger read behind this record did not answer, so no amount is shown: this is an outage rather than a zero and rather than an empty record."
          retry={{ label: "Read this gift again", onClick: retryRead }}
        />
      </Frame>
    );
  }
  if (read.kind === "denied") {
    return (
      <Frame dir={dir} className={className} returnHref={returnHref}>
        <StateNotice
          kind="denied"
          headingLevel={1}
          title="This gift is not available in this context"
          reasonCode={read.denied.reasonCode}
          description="The read was refused before it enumerated anything, so nothing here states whether a record exists, what it holds, who it is attributed to or what it was for."
        />
      </Frame>
    );
  }
  if (read.kind === "unavailable") {
    return (
      <Frame dir={dir} className={className} returnHref={returnHref}>
        <StateNotice
          kind="unavailable"
          headingLevel={1}
          title="The source behind this gift is unavailable"
          source={read.unavailable.source}
          description={read.unavailable.guidance}
          retry={{ label: "Read this gift again", onClick: retryRead }}
        />
      </Frame>
    );
  }
  if (located === null) {
    // The read answered, and this address names a row it does not hold. That is stated as the read
    // reports it: no record is fabricated from the identifier, and nothing claims the gift is absent.
    const total = read.envelope.data.report.total;
    return (
      <Frame dir={dir} className={className} returnHref={returnHref}>
        <StateNotice
          kind="empty"
          headingLevel={1}
          title={EMPTY_STATES.gifts.title}
          description={`This read returned ${String(total)} ${total === 1 ? "row" : "rows"} for the filters this address carries, and none of them is the record it names. A record outside these filters or this page is simply not in this result, so this surface does not claim the gift does not exist.`}
          action={EMPTY_STATES.gifts.action}
        />
      </Frame>
    );
  }
  const { row, index } = located;
  // The envelope this read returned, held once so every fact below is read from the same object.
  const view = read.envelope;
  const rows = view.data.report.rows;
  const amountState = amountStateOf(row, index, view.valueStates);
  const grain: RowGrain = row.allocationId === undefined ? "gift" : "allocation";
  const correction = correctionAgainst(rows, row);
  const originalDate = row.originalGiftOn === undefined ? undefined : String(row.originalGiftOn);
  const entryDate = String(row.entryOn);
  const inheritedPartnerId = row.attribution.kind === "partner" ? row.attribution.partnerId : "";
  const partnerId = partnerDraft ?? inheritedPartnerId;
  // The payload is shaped by the schema the mutation itself validates with, so the reviewed summary
  // and the request carry the same fields: a blank optional field is omitted, a title is trimmed and
  // the routing discriminant is supplied. When the form does not yet parse, the unparsed candidate is
  // handed on unchanged, so the mutation's own `invalid` outcome names what the worker typed.
  const candidate: FollowUpTaskInput = { title, category, dueOn, ...(partnerId.trim() === "" ? {} : { partnerId }) };
  const parsedCandidate = followUpTaskPayloadSchema.safeParse(candidate);
  const payload: FollowUpTaskInput = parsedCandidate.success ? parsedCandidate.data : candidate;
  // The summary the review step shows, read from the payload itself: whatever the schema normalised
  // is what will be sent, and a field the schema refused is shown as the worker typed it.
  const reviewedTitle = typeof payload.title === "string" ? payload.title.trim() : "";
  const reviewedCategory = typeof payload.category === "string" && payload.category.trim() !== "" ? payload.category.trim() : undefined;
  const reviewedDueOn = typeof payload.dueOn === "string" && payload.dueOn.trim() !== "" ? payload.dueOn.trim() : undefined;
  const reviewedPartnerId = typeof payload.partnerId === "string" && payload.partnerId.trim() !== "" ? payload.partnerId.trim() : undefined;
  const submit: MutationSubmit<FollowUpTaskInput> = (request) => followUp.mutateAsync({ scope: request.scope, expectedRevision: request.expectedRevision, payload: request.payload });
  const settledSuccess = lastOutcome !== null && (lastOutcome.outcome === "accepted" || lastOutcome.outcome === "alreadyAccepted");
  return (
    <Frame dir={dir} className={className} returnHref={returnHref}>
      <header className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant="secondary">{GRAIN_WORD[grain]}</Badge>
          <Badge variant="outline">{VALUE_STATE_WORD[amountState]}</Badge>
          {row.refundOf === undefined ? null : <Badge variant="outline">{CORRECTION_BADGE}</Badge>}
        </div>
        <h1 id={recordHeadingId} className="font-heading text-xl font-semibold tracking-tight">
          {RECORD_HEADING}
        </h1>
        <p className="min-w-0 text-sm text-pretty text-muted-foreground">{RECORD_LEAD}</p>
        <p className="flex min-w-0 flex-wrap items-baseline gap-2 break-words" data-grain={grain} data-value-state={amountState} data-gift-row-id={row.giftRowId}>
          <AmountValue money={row.amount} valueState={amountState} locale={locale} emphasis="headline" />
        </p>
      </header>
      <Card className="min-w-0">
        <CardContent>
          <dl className="flex min-w-0 flex-col gap-3 divide-y divide-border">
            <Fact label={ORIGINAL_DATE_LABEL}>
              {originalDate === undefined ? (
                DATE_UNSTATED
              ) : (
                <>
                  <time dateTime={originalDate}>
                    <bdi className="mono-identifier">{originalDate}</bdi>
                  </time>{" "}
                  — {PRECISION_LEAD[row.datePrecision]}
                </>
              )}
            </Fact>
            <Fact label={ENTRY_DATE_LABEL}>
              <time dateTime={entryDate}>
                <bdi className="mono-identifier">{entryDate}</bdi>
              </time>{" "}
              — {ENTRY_DATE_NOTE}
            </Fact>
            <Fact label={CURRENCY_LABEL}>
              <CurrencyPrecision currency={row.amount.currency} />
            </Fact>
            <Fact label={ATTRIBUTION_LABEL}>
              {row.attribution.kind === "partner" ? (
                <>
                  The source attributes this row to one partner record: <bdi className="mono-identifier">{row.attribution.partnerId}</bdi>. An equal-looking name or address in another record is not
                  this reference, and nothing here joins the two.
                </>
              ) : row.attribution.kind === "anonymous" ? (
                ATTRIBUTION_ANONYMOUS
              ) : (
                ATTRIBUTION_UNRESOLVED
              )}
            </Fact>
            <Fact label={DESIGNATION_LABEL}>{row.designation === undefined ? DESIGNATION_UNSTATED : <bdi>{row.designation}</bdi>}</Fact>
            <Fact label={STATE_LABEL}>
              <span className="font-medium text-foreground">{VALUE_STATE_WORD[amountState]}</span> — {VALUE_STATE_MEANING[amountState]}
            </Fact>
          </dl>
        </CardContent>
      </Card>
      <SectionCard id={grainHeadingId} title={GRAIN_HEADING}>
        <p>{grain === "allocation" ? GRAIN_ALLOCATION_LEAD : GRAIN_GIFT_LEAD}</p>
        <p>{GRAIN_SIBLING_NOTE}</p>
        <p className="text-muted-foreground">{GRAIN_RULE_POINTER}</p>
        <p>
          <span className="sr-only">The grain this read reports at </span>
          <bdi className="mono-identifier">{view.data.grain}</bdi>
        </p>
      </SectionCard>
      {correction === undefined && row.refundOf === undefined ? null : (
        <SectionCard id={correctionHeadingId} title={row.refundOf === undefined ? CORRECTION_AGAINST_HEADING : CORRECTION_HEADING}>
          {row.refundOf === undefined ? null : (
            <p>
              This row records a refund or correction against another row, <bdi className="mono-identifier">{row.refundOf}</bdi>. It carries its own date and its own amount, exactly as the source
              states them above, and it is never netted into the row it corrects: the two are read as two records, so the change is explained in the open rather than hidden inside a difference.
            </p>
          )}
          {correction === undefined ? null : (
            <p>
              The result also holds the correction recorded against this row: <bdi className="mono-identifier">{correction.giftRowId}</bdi>, with its own date and its own amount. Both records stand as
              the source states them, and neither is combined with the other here.
            </p>
          )}
        </SectionCard>
      )}
      <SectionCard id={provenanceHeadingId} title={PROVENANCE_HEADING}>
        <p>{PROVENANCE_LEAD}</p>
        <dl className="flex min-w-0 flex-col gap-2">
          <Fact label={SOURCE_SYSTEM_LABEL}>
            <bdi className="mono-identifier">{row.provenance.system}</bdi>
          </Fact>
          <Fact label={SOURCE_REFERENCE_LABEL}>
            <bdi className="mono-identifier">{row.provenance.reference}</bdi>
          </Fact>
          <Fact label="One reference">
            <bdi className="mono-identifier">{formatSourceReference(row.provenance)}</bdi>
          </Fact>
        </dl>
      </SectionCard>
      <SectionCard id={snapshotHeadingId} title={SNAPSHOT_HEADING}>
        <SnapshotStatement
          basis={view.data.report.snapshot.basis}
          currencies={view.data.report.snapshot.currencies}
          period={{ from: String(view.data.report.snapshot.period.from), to: String(view.data.report.snapshot.period.to) }}
          coverage={view.coverage}
          asOf={view.asOf}
          isCurrentPeriod={view.data.report.snapshot.period.state === "in-progress"}
          locale={locale}
        />
        <p className="text-sm text-pretty text-muted-foreground">{SNAPSHOT_NOTE}</p>
      </SectionCard>
      <section aria-labelledby={followUpHeadingId} className="flex min-w-0 flex-col gap-3">
        <h2 id={followUpHeadingId} className="font-heading text-base font-medium">
          {FOLLOW_UP_HEADING}
        </h2>
        <p className="min-w-0 text-sm text-pretty">{GIVING_FOLLOW_UP.description}</p>
        <Card className="min-w-0">
          <CardContent>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <FormField label={TITLE_LABEL} name="title" description={TITLE_DESCRIPTION} error={messagesFor(errors, "title")} required className="min-w-0 sm:col-span-2">
                {(field) => (
                  <Input
                    id={field.id}
                    name="title"
                    value={title}
                    autoComplete="off"
                    required={field.required}
                    aria-describedby={field.describedBy}
                    aria-invalid={field.invalid || undefined}
                    onChange={(event) => {
                      setTitle(event.target.value);
                      setErrors((held) => withoutField(held, "title"));
                    }}
                  />
                )}
              </FormField>
              <FormField label={CATEGORY_LABEL} name="category" description={CATEGORY_DESCRIPTION} error={messagesFor(errors, "category")} optionalHint>
                {(field) => (
                  <Input
                    id={field.id}
                    name="category"
                    value={category}
                    autoComplete="off"
                    aria-describedby={field.describedBy}
                    aria-invalid={field.invalid || undefined}
                    onChange={(event) => {
                      setCategory(event.target.value);
                      setErrors((held) => withoutField(held, "category"));
                    }}
                  />
                )}
              </FormField>
              <FormField label={DUE_LABEL} name="dueOn" description={DUE_DESCRIPTION} error={messagesFor(errors, "dueOn")} optionalHint>
                {(field) => (
                  <Input
                    id={field.id}
                    name="dueOn"
                    type="date"
                    value={dueOn}
                    aria-describedby={field.describedBy}
                    aria-invalid={field.invalid || undefined}
                    onChange={(event) => {
                      setDueOn(event.target.value);
                      setErrors((held) => withoutField(held, "dueOn"));
                    }}
                  />
                )}
              </FormField>
              <FormField label={PARTNER_LABEL} name="partnerId" description={PARTNER_DESCRIPTION} error={messagesFor(errors, "partnerId")} optionalHint className="min-w-0 sm:col-span-2">
                {(field) => (
                  <Input
                    id={field.id}
                    name="partnerId"
                    value={partnerId}
                    autoComplete="off"
                    aria-describedby={field.describedBy}
                    aria-invalid={field.invalid || undefined}
                    onChange={(event) => {
                      setPartnerDraft(event.target.value);
                      setErrors((held) => withoutField(held, "partnerId"));
                    }}
                  />
                )}
              </FormField>
            </div>
          </CardContent>
        </Card>
        <ActionReview<FollowUpTaskInput>
          title={REVIEW_TITLE}
          description={REVIEW_DESCRIPTION}
          consequence={
            <dl className="flex min-w-0 flex-col gap-2">
              <Fact label={TITLE_LABEL}>{reviewedTitle === "" ? REVIEW_UNSTATED : <bdi>{reviewedTitle}</bdi>}</Fact>
              <Fact label={CATEGORY_LABEL}>{reviewedCategory === undefined ? REVIEW_NO_CATEGORY : <bdi>{reviewedCategory}</bdi>}</Fact>
              <Fact label={DUE_LABEL}>
                {reviewedDueOn === undefined ? (
                  REVIEW_NO_DUE_DATE
                ) : (
                  <time dateTime={reviewedDueOn}>
                    <bdi className="mono-identifier">{reviewedDueOn}</bdi>
                  </time>
                )}
              </Fact>
              <Fact label={PARTNER_LABEL}>{reviewedPartnerId === undefined ? REVIEW_NO_PARTNER : <bdi className="mono-identifier">{reviewedPartnerId}</bdi>}</Fact>
              <Fact label={REVIEW_KIND}>{REVIEW_KIND_TASK}</Fact>
            </dl>
          }
          confirmLabel={GIVING_FOLLOW_UP.actionLabel}
          input={{ scope, expectedRevision: view.revision, payload }}
          submit={submit}
          onSettled={settle}
          fieldLabels={FIELD_LABELS}
          headingLevel={3}
        />
        {settledSuccess ? (
          <div className="flex min-w-0 flex-col gap-2">
            <p className="min-w-0 text-sm text-pretty">{GIVING_FOLLOW_UP.resultNote}</p>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={startAnother}>
                {START_ANOTHER_LABEL}
              </Button>
            </div>
          </div>
        ) : null}
      </section>
    </Frame>
  );
}
export default GiftDetail;
