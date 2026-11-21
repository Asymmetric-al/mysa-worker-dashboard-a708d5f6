"use client";

/**
 * The partner record's section bodies: the facts one partner record shows, handed to
 * `@/components/record-detail`, which owns the shell for the direct route, the desktop side panel and
 * the phone page.
 *
 * Why this file is only bodies. `RecordDetail` already fixes the section order, the heading levels,
 * the separators, the skip link, the avatar and the three presentations, and it refuses to render a
 * denied read. Repeating any of that here would create the second detail pattern the plan forbids, so
 * this file fills the seven slots the record body declares and builds the one identity the header
 * renders. The eighth fact of the specification's list — identity — is that header, which is why
 * nothing below re-states a record's name, avatar or reference in a section of its own.
 *
 * The distinction the whole feature turns on, kept here in the rendering rather than in prose:
 *
 * - Private notes and private preparation are a different record class from shared facts. They are
 *   read from the private envelope, rendered on a visually distinct surface under their own audience
 *   label, and omitted altogether when the caller supplies no private read. A shared projection can
 *   never carry their text, and no section here derives a private body from a count or a difference.
 * - Contactability, consent to hear from one publisher for one purpose, and a reader grant for
 *   protected content are three separate facts. The contact-methods section states contactability and
 *   names the other two as separately recorded; it never collapses them into a "can contact" verdict.
 * - A restriction is its own labelled line. It is not a tag and not a note, and it is never summarised
 *   into a quieter shape that a reader could mistake for the absence of a restriction.
 * - Actual activity is what happened, with the precision its date is known to. A gift, a scheduled
 *   task or the act of opening a mail or dialer app is not an activity, and completing a task proves
 *   nothing about contact, payment or fulfilment.
 * - Support history is financial. Every amount is rendered by `@/modules/money/format`, which turns an
 *   exact minor-unit integer plus the `ValueState` the read envelope recorded into display text, a
 *   machine-stable form and a full accessible sentence. This file performs no arithmetic, computes no
 *   total and derives no percentage: a figure whose state is not a number renders its state word
 *   instead of a plausible `0`, and no value is inferred by subtraction from anything else.
 *
 * What it never does, because each would be a second source of a fact that already has one owner:
 *
 * - It fetches nothing and reads no clock. Every value arrives as a prop from the route — a Server
 *   Component read or a client envelope — and no code path here calls an HTTP route, the store or the
 *   service.
 * - It constructs no date. A civil date renders as the ISO `YYYY-MM-DD` string the service supplied,
 *   isolated in `<bdi>`, with its precision stated in words beside it; an instant the source recorded
 *   is rendered verbatim. There is no parsing, no formatting and no arithmetic on a date, so no
 *   display zone can rebase a series or shift a day.
 * - It merges nothing. Two records that look alike stay two records: the relationship section lists
 *   counterparts by the read's own labels and identifiers, and the file contains no duplicate hint, no
 *   match suggestion and no join on a name, an email address or a postal address.
 * - It owns no state. The identity it builds and the sections it fills are pure functions of the data
 *   it is given, so the same record read twice renders the same body.
 *
 * States per section, never shared: a read that answered renders its content; a genuinely empty
 * collection renders the honest empty state with a real first action; a source that could not be read
 * renders `unavailable` with the source's opaque reference and the caller's retry; a refused read
 * renders `denied` with wording identical whether or not a record exists, carrying no count, title or
 * size; and a period the envelope reports as partly covered renders `partial-coverage`, because a
 * total over partial coverage is an incomplete subtotal and must not read as a whole-period figure.
 * Every one of those words comes from `../copy/states`, the family's single wording source.
 *
 * Direction and width: each body is a one-column stack, spacing uses logical utilities only, and every
 * name, amount, reference and date sits inside `<bdi>` so a right-to-left name or a leading-zero
 * identifier cannot reorder its neighbours. At 320 CSS px the stacks narrow rather than scroll, and
 * nothing here introduces a second scroll region or a horizontal gesture.
 */

import Link from "next/link";
import type { ReactElement, ReactNode } from "react";

import RecordDetail, {
  type RecordDetailBreadcrumbEntry,
  type RecordDetailIdentity,
  type RecordDetailLayout,
  type RecordDetailSectionSlots,
} from "@/components/record-detail";
import StateNotice, {
  type NoticeAction,
  type NoticeHeadingLevel,
  type NoticeRetry,
  type StateNoticeProps,
} from "@/components/state-notice";
import StatusBadge, {
  BUCKET_STATUS,
  statusBadgeProps,
  valueStateWord,
  type StatusBadgeSpec,
} from "@/components/status-badge";
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
import {
  ARCHIVE_COPY,
  AUDIENCE_LABEL_COPY,
  IDENTITY_COPY,
  INTERACTION_COPY,
  PRIVATE_RECORD_COPY,
} from "../copy/privacy";
import {
  PARTNER_ACTION_LABELS,
  SURFACE_STATE_COPY,
  VALUE_STATE_COPY,
  type PartnersSurface,
  type SurfaceState,
} from "../copy/states";

// ---------------------------------------------------------------------------------------------
// The contract with the route
// ---------------------------------------------------------------------------------------------

/**
 * The opaque source pair a failed read reports, taken from the notice that renders it so this file
 * cannot invent a reference shape of its own.
 */
type ReadSource = NonNullable<StateNoticeProps["source"]>;

/**
 * The closed denial reason code a refused read reports.
 *
 * A code describes the request and never a record, which is what lets a denial keep its wording
 * identical whether or not anything exists behind it.
 */
type DenialCode = NonNullable<StateNoticeProps["reasonCode"]>;

/**
 * One read this body renders.
 *
 * Three of the members are not results, and they stay apart: `loading` is work still in progress,
 * `unavailable` is a source that did not answer, and `denied` is a request this scope does not admit.
 * None of them may be rendered as the fourth member with no records in it, which is the single
 * confusion this type exists to prevent. A caller that has not read a source omits the prop entirely,
 * so "not read here" is distinguishable from "read and genuinely empty".
 */
export type PartnerReadResult<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "read"; readonly envelope: ReadEnvelope<T> }
  | { readonly kind: "unavailable"; readonly source?: ReadSource; readonly onRetry?: () => void }
  | {
      readonly kind: "denied";
      readonly reasonCode?: DenialCode;
      readonly onSwitchContext?: () => void;
    };

/**
 * One record this partner is related to, as the read stated the relationship.
 *
 * `label` is the source's own supported label, rendered exactly as supplied because the roster's
 * relationship facet is an open value set: inventing a word here would invent a relationship. The
 * counterpart carries its own kind and identifier, so a household, a church, an organisation and an
 * organisation's representative remain visibly distinct records rather than fields of this one.
 */
export interface PartnerRelationship {
  /** The supported relationship label the read supplied, rendered verbatim. */
  readonly label: string;
  /** The other record, when the read names one. */
  readonly counterpart?: {
    readonly partnerId: string;
    readonly kind: PartnerKind;
    readonly displayName: string;
    /** Where that record can be opened, when the route admits it. */
    readonly href?: string;
  };
  /** A source-supplied detail about the relationship, rendered verbatim. */
  readonly detail?: string;
}

/**
 * One money figure of the support-history section.
 *
 * `path` is the key the read recorded this figure's state under in `envelope.valueStates`, so the
 * rendering of the amount is decided by the envelope rather than by this file. `amount` is the exact
 * minor-unit integer the source supplied: it is formatted, never summed, compared or rounded here.
 */
export interface PartnerSupportFigure {
  /** The envelope key this figure's `ValueState` is recorded under. */
  readonly path: string;
  /** The measure in words, including the currency and period the read states. */
  readonly label: string;
  /** The exact amount, as the source stated it. */
  readonly amount: GiftRowRecord["amount"];
  /** Where the records behind this figure can be read, when the route admits it. */
  readonly href?: string;
}

/**
 * One received gift or allocation row of the support-history section.
 *
 * The row keeps its own grain — a split gift shows only the allocation this read is authorised to see
 * — and its own provenance, so nothing here presents one row as a whole gift when the source
 * reported an allocation of it.
 */
export interface PartnerSupportGift {
  /** The authorised gift or allocation row, at the grain the read reported it. */
  readonly gift: GiftRowRecord;
  /** The envelope key this row's amount state is recorded under. */
  readonly amountPath: string;
}

/** One recurring commitment the source states for this partner, read-only. */
export interface PartnerSupportCommitment {
  /** The commitment row as the source states it. */
  readonly commitment: CommitmentRowRecord;
  /** The envelope key this commitment's per-occurrence amount state is recorded under. */
  readonly amountPath: string;
}

/**
 * The authorised support history of one partner record.
 *
 * Five measures stay five measures: the figures are the read's own totals on the named basis, the gift
 * rows are what the source recorded, the commitments are promises rather than money, and the goal and
 * monthly equivalent belong to the support surface rather than to a contact record. Nothing here adds
 * one measure to another, and the basis and period are stated in the read's own words so a reader
 * knows what the figures are over.
 */
export interface PartnerSupportHistory {
  /** The named received-support basis the figures are computed on, as the read stated it. */
  readonly basis: string;
  /** The period the figures cover, worded by the read. */
  readonly periodLabel: string;
  /** The totals the read authorises for this record, in its own order. */
  readonly figures: readonly PartnerSupportFigure[];
  /** Received gift and allocation rows, at the grain the read reported them. */
  readonly gifts?: readonly PartnerSupportGift[];
  /** The recurring commitments the source states, read-only. */
  readonly commitments?: readonly PartnerSupportCommitment[];
  /** Where every gift recorded for this partner can be read, filtered and exported. */
  readonly ledgerHref?: string;
}

/**
 * What one partner read carries for this record body.
 *
 * The record itself is `PartnerRecord` from the envelope module, so identity, contact methods,
 * restrictions and the record class are the stored shapes rather than a second description of them.
 * `secondaryName` is the read's own second identity line — it is never assembled here from name
 * parts, and the individual parts are edited by the contact edit form the route mounts, because the
 * record keeps them for editing rather than for deriving a display name.
 */
export interface PartnerDetailData {
  /** The record this body shows. */
  readonly partner: PartnerRecord;
  /** The read's own second identity line, when it supplies one. */
  readonly secondaryName?: string;
  /** An admitted portrait, or absent so the initials stand in and no image is requested. */
  readonly avatarSrc?: string;
  /** How this record relates to the worker's context, in the read's own supported labels. */
  readonly relationshipContext: readonly PartnerRelationship[];
  /** Work linked to this record, read through this record's own envelope. */
  readonly openTasks: readonly TaskRecord[];
  /** Authorised support history. Absent means the read withheld it, so its section is omitted. */
  readonly supportHistory?: PartnerSupportHistory;
}

/**
 * What the private read carries for this record.
 *
 * `preparation` is the worker's own preparation record for this partner, including whether it is
 * archived: archiving hides it from working lists and deletes nothing, so both states stay readable
 * here. `notes` are private notes, whose audience is the literal `private`.
 */
export interface PartnerPrivateData {
  /** The private notes the worker wrote about this partner, newest first as the read ordered them. */
  readonly notes: readonly PrivateNoteRecord[];
  /** The private preparation record for this partner, when one exists. */
  readonly preparation?: {
    readonly partnerId: string;
    readonly archived: boolean;
  };
}

/**
 * The controls the route mounts, passed in rather than imported.
 *
 * Every control belongs to the route's composition: mounting a composer or an edit form here would make
 * this file import its siblings, and the import graph would stop being acyclic. `bar` carries the
 * record-level controls the route chose (edit, tagging, archive), `status` replaces the default state
 * label, and the two section slots render inside the section whose job they complete, so an action in
 * the record's bar is also reachable in the body.
 */
export interface PartnerDetailActions {
  /** The record's own controls, rendered in the body's action bar. */
  readonly bar?: ReactNode;
  /** The record's state label, rendered beside the identity heading instead of the default one. */
  readonly status?: ReactNode;
  /** The private-note composer, rendered at the top of the private-notes section. */
  readonly privateNote?: ReactNode;
  /** The interaction form, rendered at the top of the actual-activity section. */
  readonly interaction?: ReactNode;
}

/**
 * The destinations a section's real first action needs, supplied by the route.
 *
 * An empty section offers the action that begins it, and only the route knows the address of that
 * surface, so the addresses arrive as props. A destination the route does not supply leaves the empty
 * state without a control rather than with one that does nothing.
 */
export interface PartnerDetailLinks {
  /** Where an interaction can be logged for this partner. */
  readonly logInteraction?: string;
  /** Where a follow-up task for this partner can be created. */
  readonly createTask?: string;
  /** Where private preparation can be added. */
  readonly addPreparation?: string;
}

/** Props of {@link PartnerDetailSections}. */
export interface PartnerDetailSectionsProps {
  /** The record read: identity, permitted contact methods, restrictions, relationships, work, support. */
  readonly partner: PartnerReadResult<PartnerDetailData>;
  /** The private read. Omitted, the private sections are omitted rather than rendered empty. */
  readonly privatePreparation?: PartnerReadResult<PartnerPrivateData>;
  /** The interaction read. Omitted, the activity section is omitted rather than rendered empty. */
  readonly interactions?: PartnerReadResult<readonly InteractionRecord[]>;
  /** Which of the three presentations renders this body. Forwarded to `RecordDetail`. */
  readonly layout: RecordDetailLayout;
  /**
   * The display locale for every formatted amount, read from the reader's settings by the caller.
   * Required, because an ambient locale would make the same amount render differently on two machines.
   */
  readonly locale: string;
  /** The controls the route mounts. */
  readonly actions?: PartnerDetailActions;
  /** The destinations a section's first action needs. */
  readonly links?: PartnerDetailLinks;
  /** The list context being returned to, with the filters it was read under. */
  readonly breadcrumb?: readonly RecordDetailBreadcrumbEntry[];
}

// ---------------------------------------------------------------------------------------------
// Wording this file alone owns
// ---------------------------------------------------------------------------------------------

/**
 * The words for what a state means, lettered exactly as the family's copy modules spell them.
 *
 * Only phrasing with no home in `../copy` is declared here: the copy modules own every state, value
 * state, permission fact, identity rule and archive consequence, and the words below are the small
 * connective sentences those entries need (an empty list's own line, a gift's date when the source
 * stated none) plus the heading of the private-notes surface.
 */
const READING_RECORD_TITLE = "Reading this partner record";
const NO_RESTRICTION_RECORDED = "No restriction is recorded for this relationship.";
const NO_RELATIONSHIP_RECORDED = "No relationship label is recorded for this record.";
const CONTACT_METHOD_PERMITTED = "Permitted on this record";
const CONTACT_METHOD_NOT_PERMITTED = "Not permitted on this record";
const CONTACT_METHODS_UNVERIFIED =
  "This application verifies none of these details, so a value here is what the record holds rather than a confirmed address or number.";
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
const TASKS_PROVE_NOTHING =
  "A completed task records that the work was closed. It proves nothing about contact, payment or fulfilment.";
const SUPPORT_BASIS_LEAD = "Received support on the named basis";
const COMMITMENTS_GROUP_TITLE = "Recurring commitments the source states";
const SUPPORT_LEDGER_LINK_LABEL = "See every gift recorded for this partner";

/** The words for each contact method, so a kind is never printed as a stored token. */
const CONTACT_METHOD_KIND_LABELS: Readonly<Record<ContactMethodKind, string>> = {
  email: "Email address",
  phone: "Phone number",
  postal: "Postal address",
};

/**
 * The words for each date precision.
 *
 * Keyed by the record's own union, so a precision added to the stored form fails to compile here
 * rather than reaching a surface unworded. It states what is known rather than what is guessed: an
 * approximate date is not rounded to a day, and an unknown one is not filled in.
 */
const PRECISION_WORDS: Readonly<Record<InteractionRecord["precision"], string>> = {
  date: "Date recorded",
  approximate: "Approximate date",
  unknown: "Date not known",
};

/** The words for each task status. Completing or cancelling are different fates and read differently. */
const TASK_STATUS_LABELS: Readonly<Record<TaskRecord["status"], StatusBadgeSpec>> = {
  open: { label: "Open", tone: "info" },
  completed: { label: "Completed", tone: "positive" },
  reopened: { label: "Reopened", tone: "caution" },
  cancelled: { label: "Cancelled", tone: "muted" },
};

/**
 * The heading level a notice takes inside a section.
 *
 * The body's identity is the surface's `h1` or `h2` and every section heading sits one level below it,
 * so a notice inside a section takes the next level down again and the outline never skips a step.
 */
const NOTICE_HEADING_BY_LAYOUT: Readonly<Record<RecordDetailLayout, NoticeHeadingLevel>> = {
  page: 3,
  panel: 4,
  sheet: 4,
};

/** The states whose amount is a real figure, and so the only ones that print digits. */
const STATES_WITH_A_NUMBER: ReadonlySet<ValueState> = new Set<ValueState>([
  "value",
  "zero",
  "incomplete-subtotal",
]);

// ---------------------------------------------------------------------------------------------
// Small readers of the data
// ---------------------------------------------------------------------------------------------

/**
 * The record class in words.
 *
 * The roster's own contact-type vocabulary supplies the words, so a record kind is spelled one way
 * across the family. An unmapped member falls back to the stored token rather than to a friendlier
 * invention, because a wrong word about what a record is would be worse than an unfamiliar one.
 */
function partnerKindLabel(kind: PartnerKind): string {
  return FACET_VALUE_LABELS["contact-type"][kind] ?? kind;
}

/**
 * The state the read recorded for one value-bearing path.
 *
 * A path the envelope does not carry falls back to `unknown`, never to `value`: defaulting to `value`
 * would print a number nobody recorded and turn a missing state into a confident figure, which is the
 * one rendering the five-state rule exists to prevent.
 */
function valueStateOf(
  valueStates: Readonly<Record<string, ValueState>>,
  path: string,
): ValueState {
  return valueStates[path] ?? "unknown";
}

/** The retry a notice offers for a read the caller can re-request, or nothing when it cannot. */
function retryOf(onRetry: (() => void) | undefined): NoticeRetry | undefined {
  return onRetry === undefined
    ? undefined
    : { label: PARTNER_ACTION_LABELS.retry, onClick: onRetry };
}

/** The partial-coverage state a read's coverage calls for, or nothing when the period is covered. */
function coverageNoticeOf(coverage: Coverage): SectionNoticeState | undefined {
  return coverage.state === "complete" ? undefined : "partial-coverage";
}

// ---------------------------------------------------------------------------------------------
// The one amount rendering of this body
// ---------------------------------------------------------------------------------------------

/**
 * One amount, rendered from the single money formatter and the state the envelope recorded.
 *
 * `formatMinor` supplies the three pieces this body needs and nothing else does: the display text, the
 * accessible sentence that names the state, and — through the sentence — the guarantee that a value
 * that is not a number never prints as `0`. The sentence is the element's `title`, so a pointer reader
 * sees it on hover, and it is also the visually hidden text, with the digits and the state chip hidden
 * from assistive technology so a screen reader hears the sentence once instead of a number and a chip
 * and a sentence in turn.
 *
 * No arithmetic happens here and none can: the amount arrives as an exact minor-unit integer, and the
 * currency's exponent is the formatter's concern. An amount whose currency the money module holds no
 * exponent for renders its integer minor units, the code and an explicit unknown-currency statement
 * rather than being given two decimals or a default currency.
 */
function PartnerAmount({
  amount,
  valueState,
  locale,
}: {
  readonly amount: GiftRowRecord["amount"];
  readonly valueState: ValueState;
  readonly locale: string;
}): ReactElement {
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

/**
 * The figures of the support section, each read against the state the envelope recorded for its path.
 *
 * Rendered as a description list so a screen reader reads each label with its amount, and deliberately
 * without a total of its own: the sum of these figures is the read's summary, and a second addition
 * here would be a second source for the number the report, the chart, the CSV and the print view must
 * agree on.
 */
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
        const amount = (
          <PartnerAmount
            amount={figure.amount}
            valueState={valueStateOf(valueStates, figure.path)}
            locale={locale}
          />
        );
        return (
          <div
            key={`${figure.path}-${String(index)}`}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"
          >
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

/**
 * What each non-ordinary value state present in a set of figures means, said once.
 *
 * The words come from `../copy/states`, so a record body and a report explain "withheld" or "incomplete
 * subtotal" identically, and a genuinely recorded `value` gets no explanation because a rendered amount
 * states its own meaning. This is the one place a reader learns that an amount they can see is not the
 * whole story.
 */
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

// ---------------------------------------------------------------------------------------------
// The four states a section renders instead of its content
// ---------------------------------------------------------------------------------------------

/** The states a section renders in place of content: all of them a `StateNotice` can carry. */
type SectionNoticeState = Extract<SurfaceState, "empty" | "unavailable" | "denied" | "partial-coverage">;

/** Props of {@link SectionNotice}. */
interface SectionNoticeProps {
  /** Which surface needs the notice, so the family's own wording for it is used. */
  readonly surface: PartnersSurface;
  /** Which of the four states this section is in. */
  readonly state: SectionNoticeState;
  /** The heading level the surrounding body needs. */
  readonly headingLevel: NoticeHeadingLevel;
  /** The destination of the section's first action, when the route supplies one. */
  readonly actionHref?: string;
  /** The in-page command of the section's first action, when the caller has one. */
  readonly onAction?: () => void;
  /** The source that could not be read, for `unavailable`. */
  readonly source?: ReadSource;
  /** The re-request offered beside `unavailable`. */
  readonly retry?: NoticeRetry;
  /** The period the source does or does not cover, for `partial-coverage`. */
  readonly coverage?: Coverage;
  /** The closed reason code, for `denied`. */
  readonly reasonCode?: DenialCode;
  /** The caller's own sentence, replacing the family's general one. */
  readonly description?: string;
  /** Layout classes for the notice's own surface. Never a colour, radius or shadow. */
  readonly className?: string;
}

/**
 * One section's non-result state, worded by the family's copy module.
 *
 * The four states stay four renderings: `empty` offers the action that begins the section, because a
 * collection with nothing in it is not a dead end; `unavailable` names the source that did not answer
 * and offers the caller's retry, never a zero and never an empty list; `denied` carries the closed
 * reason code and wording that is identical whether or not a record exists, so nothing here discloses
 * a count, a title or a size; and `partial-coverage` states the covered range and that a total over it
 * is an incomplete subtotal.
 */
function SectionNotice({
  surface,
  state,
  headingLevel,
  actionHref,
  onAction,
  source,
  retry,
  coverage,
  reasonCode,
  description,
  className,
}: SectionNoticeProps): ReactElement {
  const copy = SURFACE_STATE_COPY[surface][state];
  const action: NoticeAction | undefined =
    copy.actionLabel === undefined || (actionHref === undefined && onAction === undefined)
      ? undefined
      : { label: copy.actionLabel, href: actionHref, onClick: onAction };

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

/**
 * The notice for a read that has not answered, or nothing when it has.
 *
 * A `loading` read states that it is working rather than that the section is empty; an `unavailable`
 * read names its source and its retry; a `denied` read keeps the refusal's wording free of any hint
 * that something is behind it. The caller renders the answered case itself.
 */
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
      return (
        <StateNotice
          kind="loading"
          title={READING_RECORD_TITLE}
          headingLevel={headingLevel}
          loadingLines={4}
        />
      );
    case "unavailable":
      return (
        <SectionNotice
          surface={surface}
          state="unavailable"
          headingLevel={headingLevel}
          source={read.source}
          retry={retryOf(read.onRetry)}
        />
      );
    case "denied":
      return (
        <SectionNotice
          surface={surface}
          state="denied"
          headingLevel={headingLevel}
          reasonCode={read.reasonCode}
          onAction={read.onSwitchContext}
        />
      );
  }
}

// ---------------------------------------------------------------------------------------------
// Section bodies, in the order `RecordDetail` fixes
// ---------------------------------------------------------------------------------------------

/**
 * Permitted contact methods.
 *
 * Each method states its own `permitted` flag in words beside a chip, and no line summarises the set
 * into a "can contact" verdict: a record may permit an email address and forbid a phone number, and a
 * merge of the two would lose the restriction that matters. The section also states the two facts
 * contactability is not — consent to hear from this ministry, and a reader grant for protected content
 * — and that this application verifies none of these details, so nothing here reads as confirmed.
 */
function ContactMethodsBody({ partner }: { readonly partner: PartnerRecord }): ReactElement {
  return (
    <div className="flex flex-col gap-3">
      {partner.contactMethods.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {PERMISSION_FACT_COPY.contactability.whenAbsent}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {partner.contactMethods.map((method, index) => (
            <li
              key={`${method.kind}-${String(index)}`}
              className="flex flex-wrap items-center gap-2"
            >
              <span className="text-sm text-muted-foreground">
                {CONTACT_METHOD_KIND_LABELS[method.kind]}
              </span>
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
      <p className="text-sm text-muted-foreground">
        {PERMISSION_FACT_COPY.contactability.explanation}
      </p>
      <p className="text-sm text-muted-foreground">{CONTACT_METHODS_SEPARATE_FACTS}</p>
      <p className="text-xs text-muted-foreground">{CONTACT_METHODS_UNVERIFIED}</p>
    </div>
  );
}

/**
 * Restrictions, each in its own words.
 *
 * A restriction says what must not happen for this relationship. Its label is the source's own short
 * kind rather than a closed taxonomy, and a negative restriction keeps its full sentence instead of
 * being reduced to a quieter chip, because the sentence is the part a reader has to act on. Nothing
 * here counts, ranks or summarises them.
 */
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

/**
 * How this record relates to the worker's context, in the read's own labels.
 *
 * A relationship label is an open value set the service enumerates, so it is rendered exactly as
 * supplied rather than mapped into a taxonomy invented here. A counterpart keeps its own kind and
 * identifier, so a household, a church, an organisation and an organisation's representative stay four
 * distinct records; the closing note says in the family's own words that a shared name or address never
 * makes two records one.
 */
function RelationshipBody({
  relationships,
}: {
  readonly relationships: readonly PartnerRelationship[];
}): ReactElement {
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
                      <Link
                        className="text-sm underline-offset-4 hover:underline"
                        href={relationship.counterpart.href}
                      >
                        <bdi>{relationship.counterpart.displayName}</bdi>
                      </Link>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {partnerKindLabel(relationship.counterpart.kind)}
                    </span>
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

/** One interaction that actually happened, with the precision its date is known to. */
function InteractionItem({
  interaction,
}: {
  readonly interaction: InteractionRecord;
}): ReactElement {
  const roles = interaction.participants
    .map((participant) => participant.role)
    .filter((role) => role.length > 0);

  return (
    <li className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-sm font-medium">
          <bdi>{interaction.type}</bdi>
        </span>
        <span className="text-xs text-muted-foreground">
          {PRECISION_WORDS[interaction.precision]}
        </span>
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
          <StatusBadge
            label={AUDIENCE_LABEL_COPY[interaction.note.audience].label}
            tone="muted"
            srPrefix="Note audience"
          />
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

/**
 * Actual activity: what happened, read from the interaction envelope.
 *
 * The section is titled for what it holds, and its empty state says what it does not hold — a gift, a
 * scheduled task or an app launch is not an interaction — so a quiet list is never read as a quiet
 * relationship. The composer arrives from the route, which is what lets the same section offer the work
 * in a panel and on a page without this file importing a sibling component.
 */
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
      {partial === undefined ? null : (
        <SectionNotice
          surface="interactions"
          state={partial}
          headingLevel={headingLevel}
          coverage={read.envelope.coverage}
        />
      )}
      {interactions.length === 0 ? (
        <SectionNotice
          surface="interactions"
          state="empty"
          headingLevel={headingLevel}
          actionHref={links.logInteraction}
        />
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

/** One private note, on the private surface and under its own audience label. */
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

/**
 * Private notes and private preparation, rendered only from the private read.
 *
 * Two properties keep the class boundary visible. The section is omitted entirely when the caller
 * supplies no private read, so a shared projection can never render an empty private section that would
 * invite a reader to work out what is missing. And the notes sit on their own card under their own
 * audience label, with the archive state stated where the worker's preparation is, so private text is
 * never mistaken for a shared fact.
 */
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
          <StatusBadge
            label={PREPARATION_ARCHIVED_LABEL}
            tone="muted"
            srPrefix="Private preparation"
          />
          <p className="text-sm text-muted-foreground">{PREPARATION_ARCHIVED_EXPLANATION}</p>
        </div>
      ) : null}
      {notes.length === 0 ? (
        <SectionNotice
          surface="private-preparation"
          state="empty"
          headingLevel={headingLevel}
          actionHref={links.addPreparation}
        />
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

/** One piece of open work linked to this record. */
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
          <bdi className="mono-identifier">{task.plannedTime}</bdi>{" "}
          <bdi>{task.timeZone}</bdi> — {TASK_PLANNED_IS_NOT_HELD}
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

/**
 * Open work linked to this record, read through the record's own envelope.
 *
 * The section reads the tasks the partner read carried, so it needs nothing from the work feature: one
 * envelope, one owner of filtering and status, and no second import path between feature folders. A
 * due date is rendered as the civil date the service supplied, never re-derived or compared with a
 * clock here, so nothing in this body can call a task overdue.
 */
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
      {partial === undefined ? null : (
        <SectionNotice
          surface="open-tasks"
          state={partial}
          headingLevel={headingLevel}
          coverage={coverage}
        />
      )}
      {tasks.length === 0 ? (
        <SectionNotice
          surface="open-tasks"
          state="empty"
          headingLevel={headingLevel}
          actionHref={links.createTask}
        />
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

/** One received gift or allocation row, at the grain the read reported it. */
function GiftItem({
  row,
  valueState,
  locale,
}: {
  readonly row: PartnerSupportGift;
  readonly valueState: ValueState;
  readonly locale: string;
}): ReactElement {
  const { gift } = row;
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-sm">
          <span className="sr-only">{`${PRECISION_WORDS[gift.datePrecision]}: `}</span>
          {gift.originalGiftOn === null ? (
            <span className="text-muted-foreground">{GIFT_DATE_NOT_RECORDED}</span>
          ) : (
            <bdi className="mono-identifier">{gift.originalGiftOn}</bdi>
          )}
        </span>
        <span className="text-xs text-muted-foreground">
          {gift.allocationId === null ? GIFT_GRAIN_WHOLE : GIFT_GRAIN_ALLOCATION}
        </span>
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

/** One recurring commitment the source states, read-only. */
function CommitmentItem({
  row,
  valueState,
  locale,
}: {
  readonly row: PartnerSupportCommitment;
  readonly valueState: ValueState;
  readonly locale: string;
}): ReactElement {
  const { commitment } = row;
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-sm">
          <bdi>{commitment.cadence}</bdi>
        </span>
        <div>
          <StatusBadge
            {...statusBadgeProps(BUCKET_STATUS, commitment.bucketState)}
            srPrefix="Recurring outcome"
          />
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
        <PartnerAmount
          amount={commitment.perOccurrence}
          valueState={valueState}
          locale={locale}
        />
      </div>
    </li>
  );
}

/**
 * Authorised support history: the read's figures, the gift rows at their own grain, and the recurring
 * commitments the source states.
 *
 * Five measures stay five measures here. The figures are the read's totals on the one named basis, the
 * gift rows are what the source recorded, and a commitment is a promise rather than money: nothing in
 * this section adds one to another, and no amount is inferred from a missing row. Every amount is
 * formatted from exact minor units with the state the envelope recorded for its path, so a withheld
 * value, an unknown currency, a genuine zero, an unavailable source and an incomplete subtotal render
 * five different things — and the notes under the figures say what the states present mean, in the
 * family's own words.
 */
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
      {partial === undefined ? null : (
        <SectionNotice
          surface="support-history"
          state={partial}
          headingLevel={headingLevel}
          coverage={coverage}
        />
      )}
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
              <GiftItem
                key={row.gift.giftRowId}
                row={row}
                valueState={valueStateOf(valueStates, row.amountPath)}
                locale={locale}
              />
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
              <CommitmentItem
                key={row.commitment.commitmentRowId}
                row={row}
                valueState={valueStateOf(valueStates, row.amountPath)}
                locale={locale}
              />
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

// ---------------------------------------------------------------------------------------------
// The body
// ---------------------------------------------------------------------------------------------

/**
 * The record's state label when the route supplies none.
 *
 * The audience tells a reader whether they are looking at a shared record or at the worker's own
 * preparation, and a source-supplied stage is shown when the read states one. Both are words, never a
 * colour alone.
 */
function RecordAudienceStatus({ record }: { readonly record: PartnerRecord }): ReactElement {
  const audienceLabel = FACET_VALUE_LABELS["preparation-state"][record.audience] ?? record.audience;
  return (
    <div className="flex flex-col items-end gap-1">
      <StatusBadge
        label={audienceLabel}
        tone={record.audience === "private" ? "muted" : "neutral"}
        srPrefix="Audience"
      />
      {record.stage === null ? null : (
        <StatusBadge label={record.stage} tone="info" srPrefix="Stage" />
      )}
    </div>
  );
}

/**
 * One partner record, in the single detail body every presentation renders.
 *
 * The partner read is required; the private and interaction reads are optional, and an omitted one
 * omits its section rather than emptying it. That is the whole of the composition rule: the sections
 * and their order belong to `RecordDetail`, the content belongs here, and no presentation changes which
 * facts a record shows.
 */
export default function PartnerDetailSections({
  partner,
  privatePreparation,
  interactions,
  layout,
  locale,
  actions,
  links = {},
  breadcrumb,
}: PartnerDetailSectionsProps): ReactElement {
  const headingLevel = NOTICE_HEADING_BY_LAYOUT[layout];

  // A record that was refused or never arrived is reported as that fact, never as a body with no
  // sections: an identity heading would be a name this read never supplied, and the notice carries no
  // count, title or size for anything behind it.
  if (partner.kind !== "read") {
    return (
      <ReadNotice read={partner} surface="partner-detail" headingLevel={layout === "page" ? 1 : 2} />
    );
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
    activity:
      interactions === undefined ? undefined : (
        <ActivityBody
          read={interactions}
          headingLevel={headingLevel}
          composer={actions?.interaction}
          links={links}
        />
      ),
    privateNotes:
      privatePreparation === undefined ? undefined : (
        <PrivateNotesBody
          read={privatePreparation}
          headingLevel={headingLevel}
          composer={actions?.privateNote}
          links={links}
        />
      ),
    openTasks: (
      <OpenTasksBody
        tasks={envelope.data.openTasks}
        coverage={envelope.coverage}
        headingLevel={headingLevel}
        links={links}
      />
    ),
    supportHistory:
      envelope.data.supportHistory === undefined ? undefined : (
        <SupportHistoryBody
          history={envelope.data.supportHistory}
          coverage={envelope.coverage}
          valueStates={envelope.valueStates}
          locale={locale}
          headingLevel={headingLevel}
        />
      ),
  };

  return (
    <RecordDetail
      layout={layout}
      identity={identity}
      sections={sections}
      breadcrumb={breadcrumb}
      status={actions?.status ?? <RecordAudienceStatus record={record} />}
      actions={actions?.bar}
    />
  );
}
