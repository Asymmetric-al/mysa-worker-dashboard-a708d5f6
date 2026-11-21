"use client";
/**
 * The partner record's section bodies: the facts one partner record shows, handed to
 * `@/components/record-detail`, which owns the shell for the direct route, the desktop side panel and
 * the phone page.
 */
import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import RecordDetail, { type RecordDetailBreadcrumbEntry, type RecordDetailIdentity, type RecordDetailLayout, type RecordDetailSectionSlots } from "@/components/record-detail";
import StateNotice, { type NoticeAction, type NoticeHeadingLevel, type NoticeRetry, type StateNoticeProps } from "@/components/state-notice";
import StatusBadge, { BUCKET_STATUS, statusBadgeProps, valueStateWord, type StatusBadgeSpec } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type {
  CommitmentRowRecord,
  ContactMethodKind,
  Coverage,
  GiftRowRecord,
  InteractionRecord,
  PartnerKind,
  PartnerRecord,
  PrivateNoteRecord,
  ReadEnvelope,
  TaskRecord,
  ValueState,
} from "@/modules/data-service/envelope";
import { formatMinor } from "@/modules/money/format";
import { FACET_VALUE_LABELS, PERMISSION_FACT_COPY } from "../copy/facets";
import { ARCHIVE_COPY, AUDIENCE_LABEL_COPY, IDENTITY_COPY, INTERACTION_COPY, PRIVATE_RECORD_COPY } from "../copy/privacy";
import { PARTNER_ACTION_LABELS, SURFACE_STATE_COPY, VALUE_STATE_COPY, type PartnersSurface, type SurfaceState } from "../copy/states";
// The contract with the route
type ReadSource = NonNullable<StateNoticeProps["source"]>;

type DenialCode = NonNullable<StateNoticeProps["reasonCode"]>;
/** One read this body renders. */
export type PartnerReadResult<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "read"; readonly envelope: ReadEnvelope<T> }
  | { readonly kind: "unavailable"; readonly source?: ReadSource; readonly onRetry?: () => void }
  | {
      readonly kind: "denied";
      readonly reasonCode?: DenialCode;
      readonly onSwitchContext?: () => void;
    };
/** One record this partner is related to, as the read stated the relationship. */
export interface PartnerRelationship {
  readonly label: string;
  readonly counterpart?: {
    readonly partnerId: string;
    readonly kind: PartnerKind;
    readonly displayName: string;
    readonly href?: string;
  };
  readonly detail?: string;
}
/** One money figure of the support-history section. */
export interface PartnerSupportFigure {
  readonly path: string;
  readonly label: string;
  readonly amount: GiftRowRecord["amount"];
  readonly href?: string;
}
/** One received gift or allocation row of the support-history section. */
export interface PartnerSupportGift {
  readonly gift: GiftRowRecord;
  readonly amountPath: string;
}
/** One recurring commitment the source states for this partner, read-only. */
export interface PartnerSupportCommitment {
  readonly commitment: CommitmentRowRecord;
  readonly amountPath: string;
}
/** The authorised support history of one partner record. */
export interface PartnerSupportHistory {
  readonly basis: string;
  readonly periodLabel: string;
  readonly figures: readonly PartnerSupportFigure[];
  readonly gifts?: readonly PartnerSupportGift[];
  readonly commitments?: readonly PartnerSupportCommitment[];
  readonly ledgerHref?: string;
}
/** What one partner read carries for this record body. */
export interface PartnerDetailData {
  readonly partner: PartnerRecord;
  readonly secondaryName?: string;
  readonly avatarSrc?: string;
  readonly relationshipContext: readonly PartnerRelationship[];
  readonly openTasks: readonly TaskRecord[];
  readonly supportHistory?: PartnerSupportHistory;
}
/** What the private read carries for this record. */
export interface PartnerPrivateData {
  readonly notes: readonly PrivateNoteRecord[];
  readonly preparation?: {
    readonly partnerId: string;
    readonly archived: boolean;
  };
}
/** The controls the route mounts, passed in rather than imported. */
export interface PartnerDetailActions {
  readonly bar?: ReactNode;
  readonly status?: ReactNode;
  readonly privateNote?: ReactNode;
  readonly interaction?: ReactNode;
}
/** The destinations a section's real first action needs, supplied by the route. */
export interface PartnerDetailLinks {
  readonly logInteraction?: string;
  readonly createTask?: string;
  readonly addPreparation?: string;
}
/** Props of {@link PartnerDetailSections}. */
export interface PartnerDetailSectionsProps {
  readonly partner: PartnerReadResult<PartnerDetailData>;
  readonly privatePreparation?: PartnerReadResult<PartnerPrivateData>;
  readonly interactions?: PartnerReadResult<readonly InteractionRecord[]>;
  readonly layout: RecordDetailLayout;
  readonly locale: string;
  readonly actions?: PartnerDetailActions;
  readonly links?: PartnerDetailLinks;
  readonly breadcrumb?: readonly RecordDetailBreadcrumbEntry[];
}
// Wording this file alone owns
const READING_RECORD_TITLE = "Reading this partner record";
const NO_RESTRICTION_RECORDED = "No restriction is recorded for this relationship.";
const NO_RELATIONSHIP_RECORDED = "No relationship label is recorded for this record.";
const CONTACT_METHOD_PERMITTED = "Permitted on this record";
const CONTACT_METHOD_NOT_PERMITTED = "Not permitted on this record";
const CONTACT_METHODS_UNVERIFIED = "This application verifies none of these details, so a value here is what the record holds rather than a confirmed address or number.";
const CONTACT_METHODS_SEPARATE_FACTS = `Contactability only — ${PERMISSION_FACT_COPY.communicationConsent.label} and ${PERMISSION_FACT_COPY.protectedReaderGrant.label} are separate facts, recorded separately, and none of the three stands in for another.`;
const PRIVATE_NOTES_CARD_TITLE = "What you wrote";
const PREPARATION_ARCHIVED_LABEL = "Preparation archived";
const PREPARATION_ARCHIVED_EXPLANATION = `${ARCHIVE_COPY.archiveIsNotDelete.body} ${ARCHIVE_COPY.restore.body}`;
const GIFT_DATE_NOT_RECORDED = "Gift date not recorded";
const GIFT_GRAIN_WHOLE = "One whole gift";
const GIFT_GRAIN_ALLOCATION = "One allocation of a split gift";
const GIFT_REFUND_LABEL = "Refund or correction of an earlier gift";
const COMMITMENT_PER_OCCURRENCE = "Per occurrence";
const TASK_WITHOUT_DUE_DATE = "No due date";
const TASK_PLANNED_IS_NOT_HELD = "a planned time is not a held meeting";
const TASKS_PROVE_NOTHING = "A completed task records that the work was closed. It proves nothing about contact, payment or fulfilment.";
const SUPPORT_BASIS_LEAD = "Received support on the named basis";
const COMMITMENTS_GROUP_TITLE = "Recurring commitments the source states";
const SUPPORT_LEDGER_LINK_LABEL = "See every gift recorded for this partner";

const CONTACT_METHOD_KIND_LABELS: Readonly<Record<ContactMethodKind, string>> = {
  email: "Email address",
  phone: "Phone number",
  postal: "Postal address",
};
const PRECISION_WORDS: Readonly<Record<InteractionRecord["precision"], string>> = {
  date: "Date recorded",
  approximate: "Approximate date",
  unknown: "Date not known",
};
const TASK_STATUS_LABELS: Readonly<Record<TaskRecord["status"], StatusBadgeSpec>> = {
  open: { label: "Open", tone: "info" },
  completed: { label: "Completed", tone: "positive" },
  reopened: { label: "Reopened", tone: "caution" },
  cancelled: { label: "Cancelled", tone: "muted" },
};
const NOTICE_HEADING_BY_LAYOUT: Readonly<Record<RecordDetailLayout, NoticeHeadingLevel>> = {
  page: 3,
  panel: 4,
  sheet: 4,
};
const STATES_WITH_A_NUMBER: ReadonlySet<ValueState> = new Set<ValueState>(["value", "zero", "incomplete-subtotal"]);
// Small readers of the data
function partnerKindLabel(kind: PartnerKind): string {
  return FACET_VALUE_LABELS["contact-type"][kind] ?? kind;
}
function valueStateOf(valueStates: Readonly<Record<string, ValueState>>, path: string): ValueState {
  return valueStates[path] ?? "unknown";
}
function retryOf(onRetry: (() => void) | undefined): NoticeRetry | undefined {
  return onRetry === undefined ? undefined : { label: PARTNER_ACTION_LABELS.retry, onClick: onRetry };
}
function coverageNoticeOf(coverage: Coverage): SectionNoticeState | undefined {
  return coverage.state === "complete" ? undefined : "partial-coverage";
}
// The one amount rendering of this body
function PartnerAmount({ amount, valueState, locale }: { readonly amount: GiftRowRecord["amount"]; readonly valueState: ValueState; readonly locale: string }): ReactElement {
  const formatted = formatMinor(amount, valueState, locale);
  const word = valueStateWord(valueState);
  const chip = (
    <span aria-hidden="true">
      <StatusBadge label={word?.label ?? formatted.text} tone={word?.tone ?? "muted"} />
    </span>
  );
  if (!STATES_WITH_A_NUMBER.has(valueState)) {
    return (
      <span className="inline-flex flex-wrap items-baseline gap-2" title={formatted.accessibleLabel}>
        <span className="sr-only">{formatted.accessibleLabel}</span>
        {chip}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-baseline gap-2" title={formatted.accessibleLabel}>
      <span className="sr-only">{formatted.accessibleLabel}</span>
      <bdi aria-hidden="true" className="tabular-figures">
        {formatted.text}
      </bdi>
      {word === undefined ? null : chip}
    </span>
  );
}
function SupportFigures({
  figures,
  valueStates,
  locale,
}: {
  readonly figures: readonly PartnerSupportFigure[];
  readonly valueStates: Readonly<Record<string, ValueState>>;
  readonly locale: string;
}): ReactElement {
  return (
    <dl className="flex flex-col gap-2 text-sm">
      {figures.map((figure, index) => {
        const amount = <PartnerAmount amount={figure.amount} valueState={valueStateOf(valueStates, figure.path)} locale={locale} />;
        return (
          <div key={`${figure.path}-${String(index)}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">{figure.label}</dt>
            <dd className="flex flex-wrap items-baseline gap-2">
              {figure.href === undefined ? (
                amount
              ) : (
                <Link className="underline-offset-4 hover:underline" href={figure.href}>
                  {amount}
                </Link>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
function ValueStateNotes({ states }: { readonly states: readonly ValueState[] }): ReactElement | null {
  const distinct = [...new Set(states)].filter((state) => state !== "value");
  if (distinct.length === 0) {
    return null;
  }
  return (
    <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
      {distinct.map((state) => {
        const copy = VALUE_STATE_COPY[state];
        return (
          <li key={state}>
            <span className="font-medium">{copy.phrase}</span>
            {" — "}
            {copy.explanation ?? copy.accessibleLabel}
          </li>
        );
      })}
    </ul>
  );
}
// The four states a section renders instead of its content
type SectionNoticeState = Extract<SurfaceState, "empty" | "unavailable" | "denied" | "partial-coverage">;

interface SectionNoticeProps {
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
}
function SectionNotice({ surface, state, headingLevel, actionHref, onAction, source, retry, coverage, reasonCode, description, className }: SectionNoticeProps): ReactElement {
  const copy = SURFACE_STATE_COPY[surface][state];
  const action: NoticeAction | undefined =
    copy.actionLabel === undefined || (actionHref === undefined && onAction === undefined) ? undefined : { label: copy.actionLabel, href: actionHref, onClick: onAction };
  return (
    <StateNotice
      kind={state}
      title={copy.title}
      description={description ?? copy.body}
      action={action}
      source={source}
      retry={retry}
      coverage={coverage}
      reasonCode={reasonCode}
      headingLevel={headingLevel}
      // The notice keeps its own alignment at the start of the section it sits in, so a
      // right-to-left record does not leave its notices flush to the opposite edge.
      className={cn("text-start", className)}
    />
  );
}
function ReadNotice<T>({
  read,
  surface,
  headingLevel,
}: {
  readonly read: Exclude<PartnerReadResult<T>, { kind: "read" }>;
  readonly surface: PartnersSurface;
  readonly headingLevel: NoticeHeadingLevel;
}): ReactElement {
  switch (read.kind) {
    case "loading":
      return <StateNotice kind="loading" title={READING_RECORD_TITLE} headingLevel={headingLevel} loadingLines={4} />;
    case "unavailable":
      return <SectionNotice surface={surface} state="unavailable" headingLevel={headingLevel} source={read.source} retry={retryOf(read.onRetry)} />;
    case "denied":
      return <SectionNotice surface={surface} state="denied" headingLevel={headingLevel} reasonCode={read.reasonCode} onAction={read.onSwitchContext} />;
  }
}
// Section bodies, in the order `RecordDetail` fixes
function ContactMethodsBody({ partner }: { readonly partner: PartnerRecord }): ReactElement {
  return (
    <div className="flex flex-col gap-3">
      {partner.contactMethods.length === 0 ? (
        <p className="text-sm text-muted-foreground">{PERMISSION_FACT_COPY.contactability.whenAbsent}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {partner.contactMethods.map((method, index) => (
            <li key={`${method.kind}-${String(index)}`} className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">{CONTACT_METHOD_KIND_LABELS[method.kind]}</span>
              {/* An address, a number and a postal line are weak-direction values, so each is
                  isolated: a right-to-left neighbour cannot reorder it, and a leading zero survives. */}
              <bdi className="mono-identifier text-sm">{method.value}</bdi>
              <StatusBadge
                label={method.permitted ? CONTACT_METHOD_PERMITTED : CONTACT_METHOD_NOT_PERMITTED}
                tone={method.permitted ? "positive" : "muted"}
                srPrefix={CONTACT_METHOD_KIND_LABELS[method.kind]}
              />
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-muted-foreground">{PERMISSION_FACT_COPY.contactability.explanation}</p>
      <p className="text-sm text-muted-foreground">{CONTACT_METHODS_SEPARATE_FACTS}</p>
      <p className="text-xs text-muted-foreground">{CONTACT_METHODS_UNVERIFIED}</p>
    </div>
  );
}
function RestrictionsBody({ partner }: { readonly partner: PartnerRecord }): ReactElement {
  if (partner.restrictions.length === 0) {
    return <p className="text-sm text-muted-foreground">{NO_RESTRICTION_RECORDED}</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {partner.restrictions.map((restriction, index) => (
        <li key={`${restriction.kind}-${String(index)}`} className="flex flex-wrap items-baseline gap-2">
          <Badge variant="outline">
            <bdi>{restriction.kind}</bdi>
          </Badge>
          <span className="text-sm">
            <bdi>{restriction.detail}</bdi>
          </span>
        </li>
      ))}
    </ul>
  );
}
function RelationshipBody({ relationships }: { readonly relationships: readonly PartnerRelationship[] }): ReactElement {
  return (
    <div className="flex flex-col gap-3">
      {relationships.length === 0 ? (
        <p className="text-sm text-muted-foreground">{NO_RELATIONSHIP_RECORDED}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {relationships.map((relationship, index) => (
            <li key={`${relationship.label}-${String(index)}`} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">
                  <bdi>{relationship.label}</bdi>
                </Badge>
                {relationship.counterpart === undefined ? null : (
                  <>
                    {relationship.counterpart.href === undefined ? (
                      <span className="text-sm">
                        <bdi>{relationship.counterpart.displayName}</bdi>
                      </span>
                    ) : (
                      <Link className="text-sm underline-offset-4 hover:underline" href={relationship.counterpart.href}>
                        <bdi>{relationship.counterpart.displayName}</bdi>
                      </Link>
                    )}
                    <span className="text-xs text-muted-foreground">{partnerKindLabel(relationship.counterpart.kind)}</span>
                  </>
                )}
              </div>
              {relationship.detail === undefined ? null : (
                <p className="text-sm text-muted-foreground">
                  <bdi>{relationship.detail}</bdi>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {/* A static explanation, so its container carries no live-region role of its own. */}
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
        <span className="text-sm font-medium">
          <bdi>{interaction.type}</bdi>
        </span>
        <span className="text-xs text-muted-foreground">{PRECISION_WORDS[interaction.precision]}</span>
      </div>
      {interaction.occurredOn === null ? null : (
        <p className="text-sm">
          <bdi className="mono-identifier">{interaction.occurredOn}</bdi>
        </p>
      )}
      {interaction.outcome.length === 0 ? null : (
        <p className="text-sm text-muted-foreground">
          <bdi>{interaction.outcome}</bdi>
        </p>
      )}
      {roles.length === 0 ? null : (
        <p className="text-xs text-muted-foreground">
          <span className="sr-only">Participants: </span>
          <bdi>{roles.join(", ")}</bdi>
        </p>
      )}
      {interaction.note === null ? null : (
        <div className="flex flex-col gap-1 rounded-lg border border-border p-2">
          <StatusBadge label={AUDIENCE_LABEL_COPY[interaction.note.audience].label} tone="muted" srPrefix="Note audience" />
          <p className="whitespace-pre-line text-sm">
            <bdi>{interaction.note.body}</bdi>
          </p>
        </div>
      )}
      {interaction.provenance === null ? null : (
        <p className="text-xs text-muted-foreground">
          <span className="sr-only">{`Recorded by the ${interaction.provenance.system} source as `}</span>
          <bdi className="mono-identifier">{interaction.provenance.reference}</bdi>
        </p>
      )}
    </li>
  );
}
function ActivityBody({
  read,
  headingLevel,
  composer,
  links,
}: {
  readonly read: PartnerReadResult<readonly InteractionRecord[]>;
  readonly headingLevel: NoticeHeadingLevel;
  readonly composer?: ReactNode;
  readonly links: PartnerDetailLinks;
}): ReactElement {
  if (read.kind !== "read") {
    return <ReadNotice read={read} surface="interactions" headingLevel={headingLevel} />;
  }
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
function PrivateNoteItem({ note }: { readonly note: PrivateNoteRecord }): ReactElement {
  const audience = AUDIENCE_LABEL_COPY[note.audience];
  return (
    <li className="flex flex-col gap-1">
      <StatusBadge label={audience.label} tone="muted" srPrefix="Audience" />
      <p className="whitespace-pre-line text-sm">
        <bdi>{note.body}</bdi>
      </p>
      <p className="text-xs text-muted-foreground">
        <span className="sr-only">Written at </span>
        <bdi className="mono-identifier">{note.createdAt}</bdi>
      </p>
    </li>
  );
}
function PrivateNotesBody({
  read,
  headingLevel,
  composer,
  links,
}: {
  readonly read: PartnerReadResult<PartnerPrivateData>;
  readonly headingLevel: NoticeHeadingLevel;
  readonly composer?: ReactNode;
  readonly links: PartnerDetailLinks;
}): ReactElement {
  if (read.kind !== "read") {
    return <ReadNotice read={read} surface="private-preparation" headingLevel={headingLevel} />;
  }
  const { notes, preparation } = read.envelope.data;
  const archived = preparation?.archived === true;
  return (
    <div className="flex flex-col gap-3">
      {composer}
      {archived ? (
        <div className="flex flex-col gap-1">
          <StatusBadge label={PREPARATION_ARCHIVED_LABEL} tone="muted" srPrefix="Private preparation" />
          <p className="text-sm text-muted-foreground">{PREPARATION_ARCHIVED_EXPLANATION}</p>
        </div>
      ) : null}
      {notes.length === 0 ? (
        <SectionNotice surface="private-preparation" state="empty" headingLevel={headingLevel} actionHref={links.addPreparation} />
      ) : (
        <Card size="sm" className="bg-muted/30">
          <CardHeader>
            <CardTitle className="text-sm">{PRIVATE_NOTES_CARD_TITLE}</CardTitle>
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
function TaskItem({ task }: { readonly task: TaskRecord }): ReactElement {
  return (
    <li className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-sm font-medium">
          <bdi>{task.title}</bdi>
        </span>
        <StatusBadge {...TASK_STATUS_LABELS[task.status]} srPrefix="Task status" />
      </div>
      <p className="text-xs text-muted-foreground">
        {task.dueOn === null ? (
          TASK_WITHOUT_DUE_DATE
        ) : (
          <>
            <span className="sr-only">Due </span>
            <bdi className="mono-identifier">{task.dueOn}</bdi>
          </>
        )}
      </p>
      {task.plannedTime === null || task.timeZone === null ? null : (
        <p className="text-xs text-muted-foreground">
          <span className="sr-only">Planned time </span>
          <bdi className="mono-identifier">{task.plannedTime}</bdi> <bdi>{task.timeZone}</bdi> — {TASK_PLANNED_IS_NOT_HELD}
        </p>
      )}
      {task.category === null ? null : (
        <div>
          <Badge variant="outline">
            <bdi>{task.category}</bdi>
          </Badge>
        </div>
      )}
    </li>
  );
}
function OpenTasksBody({
  tasks,
  coverage,
  headingLevel,
  links,
}: {
  readonly tasks: readonly TaskRecord[];
  readonly coverage: Coverage;
  readonly headingLevel: NoticeHeadingLevel;
  readonly links: PartnerDetailLinks;
}): ReactElement {
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
          <p className="text-xs text-muted-foreground">{TASKS_PROVE_NOTHING}</p>
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
          {gift.originalGiftOn === null ? <span className="text-muted-foreground">{GIFT_DATE_NOT_RECORDED}</span> : <bdi className="mono-identifier">{gift.originalGiftOn}</bdi>}
        </span>
        <span className="text-xs text-muted-foreground">{gift.allocationId === null ? GIFT_GRAIN_WHOLE : GIFT_GRAIN_ALLOCATION}</span>
        {gift.designation === null ? null : (
          <span className="text-xs text-muted-foreground">
            <span className="sr-only">Designation </span>
            <bdi>{gift.designation}</bdi>
          </span>
        )}
        {gift.refundOf === null ? null : (
          <div>
            <StatusBadge label={GIFT_REFUND_LABEL} tone="caution" srPrefix="This row" />
          </div>
        )}
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
        <span className="text-sm">
          <bdi>{commitment.cadence}</bdi>
        </span>
        <div>
          <StatusBadge {...statusBadgeProps(BUCKET_STATUS, commitment.bucketState)} srPrefix="Recurring outcome" />
        </div>
        {commitment.nextEligibleOn === null ? null : (
          <span className="text-xs text-muted-foreground">
            <span className="sr-only">Next eligible on </span>
            <bdi className="mono-identifier">{commitment.nextEligibleOn}</bdi>
          </span>
        )}
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="text-xs text-muted-foreground">{COMMITMENT_PER_OCCURRENCE}</span>
        <PartnerAmount amount={commitment.perOccurrence} valueState={valueState} locale={locale} />
      </div>
    </li>
  );
}
function SupportHistoryBody({
  history,
  coverage,
  valueStates,
  locale,
  headingLevel,
}: {
  readonly history: PartnerSupportHistory;
  readonly coverage: Coverage;
  readonly valueStates: Readonly<Record<string, ValueState>>;
  readonly locale: string;
  readonly headingLevel: NoticeHeadingLevel;
}): ReactElement {
  const gifts = history.gifts ?? [];
  const commitments = history.commitments ?? [];
  const partial = coverageNoticeOf(coverage);
  const states: ValueState[] = [
    ...history.figures.map((figure) => valueStateOf(valueStates, figure.path)),
    ...gifts.map((row) => valueStateOf(valueStates, row.amountPath)),
    ...commitments.map((row) => valueStateOf(valueStates, row.amountPath)),
  ];
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {SUPPORT_BASIS_LEAD}: <bdi>{history.basis}</bdi> — {history.periodLabel}
      </p>
      {partial === undefined ? null : <SectionNotice surface="support-history" state={partial} headingLevel={headingLevel} coverage={coverage} />}
      {history.figures.length === 0 ? (
        <SectionNotice surface="support-history" state="empty" headingLevel={headingLevel} />
      ) : (
        <SupportFigures figures={history.figures} valueStates={valueStates} locale={locale} />
      )}
      <ValueStateNotes states={states} />
      {gifts.length === 0 ? null : (
        <>
          <Separator />
          <ul className="flex flex-col gap-2">
            {gifts.map((row) => (
              <GiftItem key={row.gift.giftRowId} row={row} valueState={valueStateOf(valueStates, row.amountPath)} locale={locale} />
            ))}
          </ul>
        </>
      )}
      {commitments.length === 0 ? null : (
        <>
          <Separator />
          <p className="text-sm font-medium">{COMMITMENTS_GROUP_TITLE}</p>
          <ul className="flex flex-col gap-2">
            {commitments.map((row) => (
              <CommitmentItem key={row.commitment.commitmentRowId} row={row} valueState={valueStateOf(valueStates, row.amountPath)} locale={locale} />
            ))}
          </ul>
        </>
      )}
      {history.ledgerHref === undefined ? null : (
        <Link className="text-sm underline-offset-4 hover:underline" href={history.ledgerHref}>
          {SUPPORT_LEDGER_LINK_LABEL}
        </Link>
      )}
    </div>
  );
}
// The body
function RecordAudienceStatus({ record }: { readonly record: PartnerRecord }): ReactElement {
  const audienceLabel = FACET_VALUE_LABELS["preparation-state"][record.audience] ?? record.audience;
  return (
    <div className="flex flex-col items-end gap-1">
      <StatusBadge label={audienceLabel} tone={record.audience === "private" ? "muted" : "neutral"} srPrefix="Audience" />
      {record.stage === null ? null : <StatusBadge label={record.stage} tone="info" srPrefix="Stage" />}
    </div>
  );
}
/** One partner record, in the single detail body every presentation renders. */
export default function PartnerDetailSections({ partner, privatePreparation, interactions, layout, locale, actions, links = {}, breadcrumb }: PartnerDetailSectionsProps): ReactElement {
  const headingLevel = NOTICE_HEADING_BY_LAYOUT[layout];
  // A record that was refused or never arrived is reported as that fact, never as a body with no
  // sections: an identity heading would be a name this read never supplied, and the notice carries no
  // count, title or size for anything behind it.
  if (partner.kind !== "read") {
    return <ReadNotice read={partner} surface="partner-detail" headingLevel={layout === "page" ? 1 : 2} />;
  }
  const { envelope } = partner;
  const { partner: record } = envelope.data;
  const identity: RecordDetailIdentity = {
    displayName: record.displayName,
    secondaryName: envelope.data.secondaryName,
    kind: partnerKindLabel(record.kind),
    avatarSrc: envelope.data.avatarSrc,
    reference: record.source ?? undefined,
  };
  const sections: RecordDetailSectionSlots = {
    contactMethods: <ContactMethodsBody partner={record} />,
    restrictions: <RestrictionsBody partner={record} />,
    relationshipContext: <RelationshipBody relationships={envelope.data.relationshipContext} />,
    activity: interactions === undefined ? undefined : <ActivityBody read={interactions} headingLevel={headingLevel} composer={actions?.interaction} links={links} />,
    privateNotes: privatePreparation === undefined ? undefined : <PrivateNotesBody read={privatePreparation} headingLevel={headingLevel} composer={actions?.privateNote} links={links} />,
    openTasks: <OpenTasksBody tasks={envelope.data.openTasks} coverage={envelope.coverage} headingLevel={headingLevel} links={links} />,
    supportHistory:
      envelope.data.supportHistory === undefined ? undefined : (
        <SupportHistoryBody history={envelope.data.supportHistory} coverage={envelope.coverage} valueStates={envelope.valueStates} locale={locale} headingLevel={headingLevel} />
      ),
  };
  return <RecordDetail layout={layout} identity={identity} sections={sections} breadcrumb={breadcrumb} status={actions?.status ?? <RecordAudienceStatus record={record} />} actions={actions?.bar} />;
}
