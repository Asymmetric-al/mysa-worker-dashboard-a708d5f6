"use client";
import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import { refusalSummary } from "@/components/form-field";
import RecordDetail, { type RecordDetailBreadcrumbEntry, type RecordDetailIdentity, type RecordDetailLayout, type RecordDetailSectionSlots } from "@/components/record-detail";
import StateNotice, { type NoticeAction, type NoticeHeadingLevel, type NoticeRetry, type StateNoticeProps } from "@/components/state-notice";
import StatusBadge, { BUCKET_STATUS, statusBadgeProps, TASK_STATUS, valueStateWord } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants, BUTTON_WRAP_CLASS } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { CommitmentRowRecord, ContactMethodKind, Coverage, GiftRowRecord, InteractionRecord, PartnerKind, PartnerRecord, PrivateNoteRecord, ReadEnvelope, TaskRecord, ValueState } from "@/modules/data-service/envelope";
import type { FieldMessages } from "@/modules/data-service/outcome";
import { formatMinor } from "@/modules/money/format";
import { FACET_VALUE_LABELS, PERMISSION_FACT_COPY } from "../copy/facets";
import { ARCHIVE_COPY, AUDIENCE_LABEL_COPY, CONTACT_HANDOFF_COPY, IDENTITY_COPY, INTERACTION_COPY, PRIVATE_RECORD_COPY } from "../copy/privacy";
import { PARTNER_ACTION_LABELS, SURFACE_STATE_COPY, VALUE_STATE_COPY, type PartnersSurface, type SurfaceState } from "../copy/states";
type ReadSource = NonNullable<StateNoticeProps["source"]>;
type DenialCode = NonNullable<StateNoticeProps["reasonCode"]>;
export type PartnerReadResult<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "read"; readonly envelope: ReadEnvelope<T> }
  | { readonly kind: "unavailable"; readonly source?: ReadSource; readonly onRetry?: () => void }
  | { readonly kind: "denied"; readonly reasonCode?: DenialCode; readonly onSwitchContext?: () => void }
  | { readonly kind: "refused"; readonly fields: FieldMessages };
export type PartnerRelationship = { readonly label: string; readonly counterpart?: { readonly partnerId: string; readonly kind: PartnerKind; readonly displayName: string; readonly href?: string }; readonly detail?: string };
export type PartnerSupportFigure = { readonly path: string; readonly label: string; readonly amount: GiftRowRecord["amount"]; readonly href?: string };
export type PartnerSupportGift = { readonly gift: GiftRowRecord; readonly amountPath: string };
export type PartnerSupportCommitment = { readonly commitment: CommitmentRowRecord; readonly amountPath: string };
export type PartnerSupportHistory = {
  readonly basis: string;
  readonly periodLabel?: string;
  readonly figures: readonly PartnerSupportFigure[];
  readonly gifts?: readonly PartnerSupportGift[];
  readonly commitments?: readonly PartnerSupportCommitment[];
  readonly ledgerHref?: string;
  readonly outage?: { readonly system: string; readonly reference: string; readonly guidance: string };
};
export type PartnerDetailData = {
  readonly partner: PartnerRecord;
  readonly secondaryName?: string;
  readonly avatarSrc?: string;
  readonly relationshipContext: readonly PartnerRelationship[];
  readonly openTasks: readonly TaskRecord[];
  readonly supportHistory?: PartnerSupportHistory;
  readonly referralSourceZone: string;
};
export type PartnerPrivateData = { readonly notes: readonly PrivateNoteRecord[]; readonly preparation?: { readonly partnerId: string; readonly archived: boolean } };
export type PartnerDetailActions = { readonly bar?: ReactNode; readonly status?: ReactNode; readonly privateNote?: ReactNode; readonly interaction?: ReactNode; readonly preparation?: ReactNode; readonly filing?: ReactNode };
export type PartnerDetailLinks = { readonly logInteraction?: string; readonly createTask?: string; readonly addPreparation?: string };
export type PartnerDetailSectionsProps = {
  readonly partner: PartnerReadResult<PartnerDetailData>;
  readonly privatePreparation?: PartnerReadResult<PartnerPrivateData>;
  readonly interactions?: PartnerReadResult<readonly InteractionRecord[]>;
  readonly layout: RecordDetailLayout;
  readonly locale: string;
  readonly actions?: PartnerDetailActions;
  readonly links?: PartnerDetailLinks;
  readonly breadcrumb?: readonly RecordDetailBreadcrumbEntry[];
};
const CONTACT_METHOD_KIND_LABELS: Readonly<Record<ContactMethodKind, string>> = { email: "Email address", phone: "Phone number", postal: "Postal address" };
/** The two contact methods a handoff exists for: a postal line leaves the application on no scheme, so it keeps its value and offers none. */
const CONTACT_HANDOFFS: Readonly<Partial<Record<ContactMethodKind, { readonly scheme: "mailto:" | "tel:"; readonly label: string }>>> = { email: { scheme: "mailto:", label: "Email" }, phone: { scheme: "tel:", label: "Call" } };
const CONTACT_HANDOFF_CLASS = cn(buttonVariants({ variant: "outline", size: "sm" }), BUTTON_WRAP_CLASS);
const CONTACT_METHODS_HANDOFF = `${INTERACTION_COPY.whatDoesNot.body} ${CONTACT_HANDOFF_COPY.recordsNothing.body}`;
const PRECISION_WORDS: Readonly<Record<InteractionRecord["precision"], string>> = { date: "Date recorded", approximate: "Approximate date", unknown: "Date not known" };
const NOTICE_HEADING_BY_LAYOUT: Readonly<Record<RecordDetailLayout, NoticeHeadingLevel>> = { page: 3, panel: 4, sheet: 4 };
const STATES_WITH_A_NUMBER: ReadonlySet<ValueState> = new Set<ValueState>(["value", "zero", "incomplete-subtotal"]);
const partnerKindLabel = (kind: PartnerKind): string => FACET_VALUE_LABELS["contact-type"][kind] ?? kind;
const valueStateOf = (valueStates: Readonly<Record<string, ValueState>>, path: string): ValueState => valueStates[path] ?? "unknown";
const coverageNoticeOf = (coverage: Coverage): SectionNoticeState | undefined => (coverage.state === "complete" ? undefined : "partial-coverage");
const FactLine = ({ className, label, value }: { readonly className: string; readonly label?: string; readonly value: ReactNode }): ReactElement => (
  <p className={className}>
    {label === undefined ? null : <span className="sr-only">{label}</span>}
    {value}
  </p>
);
function PartnerAmount({ amount, valueState, locale }: { readonly amount: GiftRowRecord["amount"]; readonly valueState: ValueState; readonly locale: string }): ReactElement {
  const formatted = formatMinor(amount, valueState, locale);
  const word = valueStateWord(valueState);
  const numbered = STATES_WITH_A_NUMBER.has(valueState);
  return (
    <span className="inline-flex flex-wrap items-baseline gap-2" title={formatted.accessibleLabel}>
      <span className="sr-only">{formatted.accessibleLabel}</span>
      {numbered ? <bdi {...{ "aria-hidden": "true", className: "tabular-figures" }}>{formatted.text}</bdi> : null}
      {numbered && word === undefined ? null : (
        <span aria-hidden="true">
          <StatusBadge label={word?.label ?? formatted.text} tone={word?.tone ?? "muted"} />
        </span>
      )}
    </span>
  );
}
const SupportFigures = ({ figures, valueStates, locale }: { readonly figures: readonly PartnerSupportFigure[]; readonly valueStates: Readonly<Record<string, ValueState>>; readonly locale: string }): ReactElement => (
  <dl className="flex flex-col gap-2 text-sm">
    {figures.map((figure, index) => {
      const amount = <PartnerAmount amount={figure.amount} valueState={valueStateOf(valueStates, figure.path)} locale={locale} />;
      return (
        <div key={`${figure.path}-${String(index)}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">{figure.label}</dt>
          <dd className="flex flex-wrap items-baseline gap-2">{figure.href === undefined ? amount : <Link {...{ className: "inline-link", href: figure.href }}>{amount}</Link>}</dd>
        </div>
      );
    })}
  </dl>
);
function ValueStateNotes({ states }: { readonly states: readonly ValueState[] }): ReactElement | null {
  const distinct = [...new Set(states)].filter((state) => state !== "value");
  if (distinct.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
      {distinct.map((state) => (
        <li key={state}>
          <span className="font-medium">{VALUE_STATE_COPY[state].phrase}</span>
          {" — "}
          {VALUE_STATE_COPY[state].explanation ?? VALUE_STATE_COPY[state].accessibleLabel}
        </li>
      ))}
    </ul>
  );
}
type SectionNoticeState = Extract<SurfaceState, "empty" | "unavailable" | "denied" | "refused" | "partial-coverage">;
type SectionNoticeProps = {
  readonly surface: PartnersSurface;
  readonly state: SectionNoticeState;
  readonly headingLevel: NoticeHeadingLevel;
  readonly actionHref?: string;
  readonly onAction?: () => void;
  readonly source?: ReadSource;
  readonly retry?: NoticeRetry;
  readonly coverage?: Coverage;
  readonly reasonCode?: DenialCode;
  readonly description?: string;
  readonly className?: string;
};
function SectionNotice({ surface, state, headingLevel, actionHref, onAction, source, retry, coverage, reasonCode, description, className }: SectionNoticeProps): ReactElement {
  const copy = SURFACE_STATE_COPY[surface][state];
  const action: NoticeAction | undefined = copy.actionLabel === undefined || (actionHref === undefined && onAction === undefined) ? undefined : { label: copy.actionLabel, href: actionHref, onClick: onAction };
  return <StateNotice kind={state} title={copy.title} description={description ?? copy.body} action={action} source={source} retry={retry} coverage={coverage} reasonCode={reasonCode} headingLevel={headingLevel} className={cn("text-start", className)} />;
}
function ReadNotice<T>({ read, surface, headingLevel }: { readonly read: Exclude<PartnerReadResult<T>, { kind: "read" }>; readonly surface: PartnersSurface; readonly headingLevel: NoticeHeadingLevel }): ReactElement {
  switch (read.kind) {
    case "loading":
      return <StateNotice kind="loading" title="Reading this partner record" headingLevel={headingLevel} loadingLines={4} />;
    case "unavailable":
      return <SectionNotice surface={surface} state="unavailable" headingLevel={headingLevel} source={read.source} retry={read.onRetry === undefined ? undefined : { label: PARTNER_ACTION_LABELS.retry, onClick: read.onRetry }} />;
    case "denied":
      return <SectionNotice surface={surface} state="denied" headingLevel={headingLevel} reasonCode={read.reasonCode} onAction={read.onSwitchContext} />;
    case "refused":
      return <SectionNotice surface={surface} state="refused" headingLevel={headingLevel} description={refusalSummary(read)} />;
  }
}
function ContactMethodsBody({ partner }: { readonly partner: PartnerRecord }): ReactElement {
  const methodLine = (method: PartnerRecord["contactMethods"][number], index: number): ReactElement => {
    const handoff = CONTACT_HANDOFFS[method.kind];
    return (
      <li key={`${method.kind}-${String(index)}`} className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">{CONTACT_METHOD_KIND_LABELS[method.kind]}</span>
        <bdi className="mono-identifier text-sm">{method.value}</bdi>
        <StatusBadge label={method.permitted ? "Permitted on this record" : "Not permitted on this record"} tone={method.permitted ? "positive" : "muted"} srPrefix={CONTACT_METHOD_KIND_LABELS[method.kind]} />
        {/* The row keeps the value the record stores and offers the handoff beside it: the link carries that value unchanged, and its hidden half names the value it would open, so the visible word alone never leaves two rows reading the same. */}
        {handoff === undefined ? null : (
          <a href={`${handoff.scheme}${method.value}`} data-slot="button" className={CONTACT_HANDOFF_CLASS}>
            {handoff.label}
            <span className="sr-only">{`: ${method.value}`}</span>
          </a>
        )}
      </li>
    );
  };
  const offersHandoff = partner.contactMethods.some((method) => CONTACT_HANDOFFS[method.kind] !== undefined);
  return (
    <div className="flex flex-col gap-3">
      {partner.contactMethods.length === 0 ? <p className="type-supporting">{PERMISSION_FACT_COPY.contactability.whenAbsent}</p> : <ul className="flex flex-col gap-2">{partner.contactMethods.map(methodLine)}</ul>}
      {offersHandoff ? <p className="type-supporting">{CONTACT_METHODS_HANDOFF}</p> : null}
      <p className="type-supporting">{PERMISSION_FACT_COPY.contactability.explanation}</p>
      <p className="type-supporting">{`Contactability only — ${PERMISSION_FACT_COPY.communicationConsent.label} and ${PERMISSION_FACT_COPY.protectedReaderGrant.label} are separate facts, recorded separately, and none of the three stands in for another.`}</p>
      <p className="text-xs text-muted-foreground">This application verifies none of these details, so a value here is what the record holds rather than a confirmed address or number.</p>
    </div>
  );
}
function RestrictionsBody({ partner }: { readonly partner: PartnerRecord }): ReactElement {
  if (partner.restrictions.length === 0) return <p className="type-supporting">No restriction is recorded for this relationship.</p>;
  const restrictionLine = (restriction: PartnerRecord["restrictions"][number], index: number): ReactElement => (
    <li key={`${restriction.kind}-${String(index)}`} className="flex flex-wrap items-baseline gap-2">
      <Badge variant="outline">
        <bdi>{restriction.kind}</bdi>
      </Badge>
      <bdi className="text-sm">{restriction.detail}</bdi>
    </li>
  );
  return <ul className="flex flex-col gap-2">{partner.restrictions.map(restrictionLine)}</ul>;
}
function CounterpartName({ counterpart }: { readonly counterpart: NonNullable<PartnerRelationship["counterpart"]> }): ReactElement {
  const name = <bdi>{counterpart.displayName}</bdi>;
  return counterpart.href === undefined ? <span className="text-sm">{name}</span> : <Link {...{ className: "text-sm inline-link", href: counterpart.href }}>{name}</Link>;
}
function RelationshipBody({ relationships }: { readonly relationships: readonly PartnerRelationship[] }): ReactElement {
  const relationshipLine = (relationship: PartnerRelationship, index: number): ReactElement => {
    const counterpart = relationship.counterpart;
    return (
      <li key={`${relationship.label}-${String(index)}`} className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            <bdi>{relationship.label}</bdi>
          </Badge>
          {counterpart === undefined ? null : (
            <>
              <CounterpartName counterpart={counterpart} />
              <span className="text-xs text-muted-foreground">{partnerKindLabel(counterpart.kind)}</span>
            </>
          )}
        </div>
        {relationship.detail === undefined ? null : <FactLine className="type-supporting" value={<bdi>{relationship.detail}</bdi>} />}
      </li>
    );
  };
  return (
    <div className="flex flex-col gap-3">
      {relationships.length === 0 ? <p className="type-supporting">No relationship label is recorded for this record.</p> : <ul className="flex flex-col gap-2">{relationships.map(relationshipLine)}</ul>}
      <Alert role={undefined} className="bg-muted/40">
        <AlertTitle>{IDENTITY_COPY.distinctKinds.title}</AlertTitle>
        <AlertDescription>
          {IDENTITY_COPY.distinctKinds.body} {IDENTITY_COPY.noJoinKey.body}
        </AlertDescription>
      </Alert>
    </div>
  );
}
function InteractionItem({ interaction }: { readonly interaction: InteractionRecord }): ReactElement {
  const roles = interaction.participants.map((participant) => participant.role).filter((role) => role.length > 0);
  return (
    <li className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <bdi className="text-sm font-medium">{interaction.type}</bdi>
        <span className="text-xs text-muted-foreground">{PRECISION_WORDS[interaction.precision]}</span>
      </div>
      {interaction.occurredOn === null ? null : <FactLine className="type-body" value={<bdi className="mono-identifier">{interaction.occurredOn}</bdi>} />}
      {interaction.outcome.length === 0 ? null : <FactLine className="type-supporting" value={<bdi>{interaction.outcome}</bdi>} />}
      {roles.length === 0 ? null : <FactLine className="text-xs text-muted-foreground" label="Participants: " value={<bdi>{roles.join(", ")}</bdi>} />}
      {interaction.note === null ? null : (
        <div className="flex flex-col gap-1 rounded-lg border border-border p-2">
          <StatusBadge label={AUDIENCE_LABEL_COPY[interaction.note.audience].label} tone="muted" srPrefix="Note audience" />
          <bdi className="whitespace-pre-line text-sm">{interaction.note.body}</bdi>
        </div>
      )}
      {interaction.provenance === null ? null : <FactLine className="text-xs text-muted-foreground" label={`Recorded by the ${interaction.provenance.system} source as `} value={<bdi className="mono-identifier">{interaction.provenance.reference}</bdi>} />}
    </li>
  );
}
function ActivityBody({ read, headingLevel, composer, links }: { readonly read: PartnerReadResult<readonly InteractionRecord[]>; readonly headingLevel: NoticeHeadingLevel; readonly composer?: ReactNode; readonly links: PartnerDetailLinks }): ReactElement {
  if (read.kind !== "read") return <ReadNotice read={read} surface="interactions" headingLevel={headingLevel} />;
  const interactions = read.envelope.data;
  const partial = coverageNoticeOf(read.envelope.coverage);
  return (
    <div className="flex flex-col gap-3">
      {composer}
      {partial === undefined ? null : <SectionNotice surface="interactions" state={partial} headingLevel={headingLevel} coverage={read.envelope.coverage} />}
      {interactions.length === 0 ? (
        <SectionNotice surface="interactions" state="empty" headingLevel={headingLevel} actionHref={links.logInteraction} />
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {interactions.map((interaction) => (
              <InteractionItem key={interaction.interactionId} interaction={interaction} />
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{INTERACTION_COPY.whatDoesNot.body}</p>
        </>
      )}
    </div>
  );
}
const PrivateNoteItem = ({ note }: { readonly note: PrivateNoteRecord }): ReactElement => (
  <li className="flex flex-col gap-1">
    <StatusBadge label={AUDIENCE_LABEL_COPY[note.audience].label} tone="muted" srPrefix="Audience" />
    <p className="whitespace-pre-line type-body">
      <bdi>{note.body}</bdi>
    </p>
    <FactLine className="text-xs text-muted-foreground" label="Written at " value={<bdi className="mono-identifier">{note.createdAt}</bdi>} />
  </li>
);
function PrivateNotesBody({ read, headingLevel, composer, preparation: preparationAction, links }: { readonly read: PartnerReadResult<PartnerPrivateData>; readonly headingLevel: NoticeHeadingLevel; readonly composer?: ReactNode; readonly preparation?: ReactNode; readonly links: PartnerDetailLinks }): ReactElement {
  if (read.kind !== "read") return <ReadNotice read={read} surface="private-preparation" headingLevel={headingLevel} />;
  const { notes, preparation } = read.envelope.data;
  const archived = preparation?.archived === true;
  return (
    <div className="flex flex-col gap-3">
      {composer}
      {/* The preparation record's own lifecycle sits beside the note composer: private preparation is this section's record class, and a shared record is handed no control here at all. */}
      {preparationAction}
      {archived ? (
        <div className="flex flex-col gap-1">
          <StatusBadge label="Preparation archived" tone="muted" srPrefix="Private preparation" />
          <p className="type-supporting">{`${ARCHIVE_COPY.archiveIsNotDelete.body} ${ARCHIVE_COPY.restore.body}`}</p>
        </div>
      ) : null}
      {notes.length === 0 ? (
        <SectionNotice surface="private-preparation" state="empty" headingLevel={headingLevel} actionHref={links.addPreparation} />
      ) : (
        <Card variant="muted">
          <CardHeader>
            <CardTitle className="text-sm">What you wrote</CardTitle>
            <CardDescription>{PRIVATE_RECORD_COPY.noteIsPrivate.body}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-3">
              {notes.map((note) => (
                <PrivateNoteItem key={note.noteId} note={note} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <p className="text-xs text-muted-foreground">{PRIVATE_RECORD_COPY.remainsPrivate.body}</p>
    </div>
  );
}
const TaskItem = ({ task }: { readonly task: TaskRecord }): ReactElement => (
  <li className="flex flex-col gap-1">
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <bdi className="text-sm font-medium">{task.title}</bdi>
      <StatusBadge {...TASK_STATUS[task.status]} srPrefix="Task status" />
    </div>
    <FactLine className="text-xs text-muted-foreground" label={task.dueOn === null ? undefined : "Due "} value={task.dueOn === null ? "No due date" : <bdi className="mono-identifier">{task.dueOn}</bdi>} />
    {task.plannedTime === null || task.timeZone === null ? null : (
      <p className="text-xs text-muted-foreground">
        <span className="sr-only">Planned time </span>
        <bdi className="mono-identifier">{task.plannedTime}</bdi> <bdi>{task.timeZone}</bdi> — a planned time is not a held meeting
      </p>
    )}
    {task.category === null ? null : (
      <Badge variant="outline">
        <bdi>{task.category}</bdi>
      </Badge>
    )}
  </li>
);
function OpenTasksBody({ tasks, coverage, headingLevel, links }: { readonly tasks: readonly TaskRecord[]; readonly coverage: Coverage; readonly headingLevel: NoticeHeadingLevel; readonly links: PartnerDetailLinks }): ReactElement {
  const partial = coverageNoticeOf(coverage);
  return (
    <div className="flex flex-col gap-3">
      {partial === undefined ? null : <SectionNotice surface="open-tasks" state={partial} headingLevel={headingLevel} coverage={coverage} />}
      {tasks.length === 0 ? (
        <SectionNotice surface="open-tasks" state="empty" headingLevel={headingLevel} actionHref={links.createTask} />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {tasks.map((task) => (
              <TaskItem key={task.taskId} task={task} />
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">A completed task records that the work was closed. It proves nothing about contact, payment or fulfilment.</p>
        </>
      )}
    </div>
  );
}
function GiftItem({ row, valueState, locale }: { readonly row: PartnerSupportGift; readonly valueState: ValueState; readonly locale: string }): ReactElement {
  const { gift } = row;
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-sm">
          <span className="sr-only">{`${PRECISION_WORDS[gift.datePrecision]}: `}</span>
          {gift.originalGiftOn === null ? <span className="text-muted-foreground">Gift date not recorded</span> : <bdi className="mono-identifier">{gift.originalGiftOn}</bdi>}
        </span>
        <span className="text-xs text-muted-foreground">{gift.allocationId === null ? "One whole gift" : "One allocation of a split gift"}</span>
        {gift.designation === null ? null : (
          <span className="text-xs text-muted-foreground">
            <span className="sr-only">Designation </span>
            <bdi>{gift.designation}</bdi>
          </span>
        )}
        {gift.refundOf === null ? null : <StatusBadge label="Refund or correction of an earlier gift" tone="caution" srPrefix="This row" />}
      </div>
      <PartnerAmount amount={gift.amount} valueState={valueState} locale={locale} />
    </li>
  );
}
function CommitmentItem({ row, valueState, locale }: { readonly row: PartnerSupportCommitment; readonly valueState: ValueState; readonly locale: string }): ReactElement {
  const { commitment } = row;
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <div className="flex min-w-0 flex-col gap-1">
        <bdi className="text-sm">{commitment.cadence}</bdi>
        <StatusBadge {...statusBadgeProps(BUCKET_STATUS, commitment.bucketState)} srPrefix="Recurring outcome" />
        {commitment.nextEligibleOn === null ? null : (
          <span className="text-xs text-muted-foreground">
            <span className="sr-only">Next eligible on </span>
            <bdi className="mono-identifier">{commitment.nextEligibleOn}</bdi>
          </span>
        )}
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="text-xs text-muted-foreground">Per occurrence</span>
        <PartnerAmount amount={commitment.perOccurrence} valueState={valueState} locale={locale} />
      </div>
    </li>
  );
}
function SupportRowList({ rows, title }: { readonly rows: readonly ReactNode[]; readonly title?: string }): ReactElement | null {
  if (rows.length === 0) return null;
  return (
    <>
      <Separator />
      {title === undefined ? null : <p className="type-group-title">{title}</p>}
      <ul className="flex flex-col gap-2">{rows}</ul>
    </>
  );
}
function SupportHistoryBody({ history, coverage, valueStates, locale, headingLevel }: { readonly history: PartnerSupportHistory; readonly coverage: Coverage; readonly valueStates: Readonly<Record<string, ValueState>>; readonly locale: string; readonly headingLevel: NoticeHeadingLevel }): ReactElement {
  const outage = history.outage;
  if (outage !== undefined) return <SectionNotice surface="support-history" state="unavailable" headingLevel={headingLevel} source={{ system: outage.system, reference: outage.reference }} description={outage.guidance} />;
  const gifts = history.gifts ?? [];
  const commitments = history.commitments ?? [];
  const partial = coverageNoticeOf(coverage);
  const states: ValueState[] = [...history.figures.map((figure) => valueStateOf(valueStates, figure.path)), ...gifts.map((row) => valueStateOf(valueStates, row.amountPath)), ...commitments.map((row) => valueStateOf(valueStates, row.amountPath))];
  return (
    <div className="flex flex-col gap-3">
      <p className="type-supporting">
        Received support on the named basis: <bdi>{history.basis}</bdi>
        {history.periodLabel === undefined ? null : <> — {history.periodLabel}</>}
      </p>
      {partial === undefined ? null : <SectionNotice surface="support-history" state={partial} headingLevel={headingLevel} coverage={coverage} />}
      {history.figures.length === 0 ? <SectionNotice surface="support-history" state="empty" headingLevel={headingLevel} /> : <SupportFigures figures={history.figures} valueStates={valueStates} locale={locale} />}
      <ValueStateNotes states={states} />
      <SupportRowList
        rows={gifts.map((row) => (
          <GiftItem key={row.gift.giftRowId} row={row} valueState={valueStateOf(valueStates, row.amountPath)} locale={locale} />
        ))}
      />
      <SupportRowList {...{ title: "Recurring commitments the source states", rows: commitments.map((row) => <CommitmentItem key={row.commitment.commitmentRowId} row={row} valueState={valueStateOf(valueStates, row.amountPath)} locale={locale} />) }} />
      {history.ledgerHref === undefined ? null : <Link {...{ className: "text-sm inline-link", href: history.ledgerHref }}>See every gift recorded for this partner</Link>}
    </div>
  );
}
const RecordAudienceStatus = ({ record }: { readonly record: PartnerRecord }): ReactElement => (
  <div className="flex flex-col items-end gap-1">
    <StatusBadge label={FACET_VALUE_LABELS["preparation-state"][record.audience] ?? record.audience} tone={record.audience === "private" ? "muted" : "neutral"} srPrefix="Audience" />
    {record.stage === null ? null : <StatusBadge label={record.stage} tone="info" srPrefix="Stage" />}
  </div>
);
export default function PartnerDetailSections({ partner, privatePreparation, interactions, layout, locale, actions, links = {}, breadcrumb }: PartnerDetailSectionsProps): ReactElement {
  const headingLevel = NOTICE_HEADING_BY_LAYOUT[layout];
  if (partner.kind !== "read") return <ReadNotice read={partner} surface="partner-detail" headingLevel={layout === "page" ? 1 : 2} />;
  const { envelope } = partner;
  const record = envelope.data.partner;
  const identity: RecordDetailIdentity = { displayName: record.displayName, secondaryName: envelope.data.secondaryName, kind: partnerKindLabel(record.kind), avatarSrc: envelope.data.avatarSrc, reference: record.source ?? undefined };
  const sections: RecordDetailSectionSlots = {
    contactMethods: <ContactMethodsBody partner={record} />,
    restrictions: <RestrictionsBody partner={record} />,
    relationshipContext: <RelationshipBody relationships={envelope.data.relationshipContext} />,
    activity: interactions === undefined ? undefined : <ActivityBody read={interactions} headingLevel={headingLevel} composer={actions?.interaction} links={links} />,
    privateNotes: privatePreparation === undefined ? undefined : <PrivateNotesBody read={privatePreparation} headingLevel={headingLevel} composer={actions?.privateNote} preparation={actions?.preparation} links={links} />,
    openTasks: <OpenTasksBody tasks={envelope.data.openTasks} coverage={envelope.coverage} headingLevel={headingLevel} links={links} />,
    supportHistory: envelope.data.supportHistory === undefined ? undefined : <SupportHistoryBody history={envelope.data.supportHistory} coverage={envelope.coverage} valueStates={envelope.valueStates} locale={locale} headingLevel={headingLevel} />,
  };
  return <RecordDetail layout={layout} identity={identity} sections={sections} breadcrumb={breadcrumb} status={actions?.status ?? <RecordAudienceStatus record={record} />} actions={actions?.bar} trailing={actions?.filing} />;
}
