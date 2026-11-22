"use client";
/**
 * The Partners roster (AAP 0.10.1, family 2): the family's composition root over the one filter surface, the one table
 * preset, the one paging bar and the one scroll region.
 *
 * **What this file owns.** The columns the roster shows, and only the columns the read envelope admits: identity and
 * kind, permitted contact-method availability, tags and favourite, relationship context, the most recent interaction
 * the source actually recorded, open work, and — where the read states a partner's giving facts at all — the last
 * received gift, the currencies that partner gave in during the selected period and the source's own commitment
 * status. A giving column is absent in a context whose envelope does not state those facts: not empty, not disabled,
 * and never something a tooltip explains was hidden.
 *
 * **What it never does.** It builds no table instance, sorts nothing, filters nothing, pages nothing and totals
 * nothing. The service executes every stage and answers the whole-result count beside one page of rows, so the pager
 * states the size of the result rather than the size of a page. Every count, day and currency list rendered here
 * carries the `ValueState` the envelope recorded for it, so a recorded zero, an unknown, a withheld value, an
 * unavailable source and an incomplete subtotal stay five different renderings — in the cell's text and in its
 * accessible name — and none of them is drawn as the digit 0.
 *
 * **The roster is the shared projection.** No private note body and no private preparation text is read here, so no
 * row can disclose one. Tags and favourites are the worker's own labels; the route that composes this surface mounts
 * the family's tag and favourite controls beside a record, and rows carry no selection at all, because a selection is
 * never an audience, a consent or a campaign.
 *
 * **The address owns the query.** `useRosterQuery` parses the search, the filters, the ordering, the page and the
 * column set out of the URL and writes every change back to it, so opening a record and returning re-issues the
 * identical read and the browser restores the list where it was left (AAP 0.1.1 Continuity). This file therefore
 * keeps no query state of its own.
 */
import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";
import { useMemo, type ReactElement, type ReactNode } from "react";
import { RecordList, type RecordListColumnDef, type RecordListQueryState, type SortDescriptor } from "@/components/record-list";
import { StateNotice } from "@/components/state-notice";
import StatusBadge, { valueStateWord } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { ContactMethodKind, PartnerKind, ReadEnvelope, RecordAudience, Scope, ValueState } from "@/modules/data-service/envelope";
import { FACET_VALUE_LABELS } from "../copy/facets";
import { PARTNER_ACTION_LABELS, SURFACE_STATE_COPY, VALUE_STATE_COPY } from "../copy/states";
import { ROSTER_PAGE_SIZE_CAP, ROSTER_PAGE_SIZE_DEFAULT, useRosterQuery, type RosterSort } from "../hooks/use-roster-query";
import ColumnChooser, { PARTNER_COLUMN_KEYS, admittedPartnerColumns, type PartnerColumn, type PartnerColumnKey } from "./column-chooser";
import { PartnerFacets } from "./partner-facets";
import SavedViewBar from "./saved-view-bar";

// ---------------------------------------------------------------------------------------------
// The row, as the roster read projects it
//
// The row type is declared here because this is the component that renders it: the roster read's own type lives in
// the service module, which a feature may not import, and `useRosterQuery` deliberately passes the rows through
// untyped. Every member below is one the service read actually states, and the optional two are the giving facts it
// omits entirely for a caller who may not see a partner's support history — which is exactly what makes the giving
// columns absent rather than blank in that context.
// ---------------------------------------------------------------------------------------------

/** The identity and working labels of one partner, never a contact value and never a private note. */
interface PartnerRosterRecord {
  readonly partnerId: string;
  readonly kind: PartnerKind;
  readonly displayName: string;
  readonly tags: readonly string[];
  readonly favourite: boolean;
  readonly stage: string | null;
  readonly audience: RecordAudience;
  readonly revision: string;
}

/** Where a partner's referral stands: judged by the service from its preserved endpoint, never derived here. */
type PartnerReferralStatus = "active" | "incomplete-date" | "expired";

/** One row of the roster: a partner, the admitted facts about the relationship, and the work open on it. */
export interface PartnerRosterRow {
  readonly partner: PartnerRosterRecord;
  readonly contactMethodKinds: readonly ContactMethodKind[];
  readonly initiativeIds: readonly string[];
  readonly referralStatus: PartnerReferralStatus | null;
  readonly openTaskCount: number;
  readonly overdueTaskCount: number;
  readonly undatedTaskCount: number;
  readonly lastActivityOn: string | null;
  /** The currencies the partner gave in during the period the read was asked over; absent when the read states no support facts. */
  readonly givingCurrencies?: readonly string[];
  /** The original date of the most recent received support; absent when the read states no support facts. */
  readonly lastReceivedOn?: string | null;
  /** The source's own commitment status, stated only where the source attributes a commitment to the partner. */
  readonly commitmentStatus?: string | null;
}

// ---------------------------------------------------------------------------------------------
// What the route hands this surface
// ---------------------------------------------------------------------------------------------

/** Props of {@link PartnerRoster}. */
export interface PartnerRosterProps {
  /** The exact authority the roster is read under. It is handed to the service unchanged, and the service re-derives scope from the session on every read. */
  readonly scope: Scope;
  /**
   * The row-level controls the composing route supplies — the family's tag and favourite actions, mounted once per
   * row. When it is absent the roster offers its own navigation-only row action, so a row is never without a way in.
   */
  readonly rowActions?: (row: PartnerRosterRow) => ReactNode;
  /**
   * The first action an empty roster offers. The composing route supplies the private-contact form it owns; on its
   * own the roster offers the import journey, which is a real way to begin rather than an illustration.
   */
  readonly emptyAction?: ReactNode;
  /** The writing direction of the surrounding document, supplied by the route that composes this surface. */
  readonly dir?: "ltr" | "rtl";
  readonly className?: string;
}

// ---------------------------------------------------------------------------------------------
// Fixed values and wording
// ---------------------------------------------------------------------------------------------

/** The label the toolbar, the table caption and its cell names are all built from, so one surface is named once. */
const ROSTER_LABEL = "Partner roster";

/** The noun the preset and the pager state their counts in: "Showing 1–50 of 312 partners", "No partners". */
const ITEM_NOUN = "partners";

/** The two page sizes the roster offers: the documented default and the documented cap. */
const PAGE_SIZE_OPTIONS: readonly number[] = [ROSTER_PAGE_SIZE_DEFAULT, ROSTER_PAGE_SIZE_CAP];

/** The route family this surface navigates inside, kept in one place so the list and the record cannot drift apart. */
const PARTNER_ROUTE_PREFIX = "/partners";

/** The import journey, offered as the first action of a roster that holds nothing yet. */
const IMPORT_HREF = "/partners/import";

/** The prefixes of the envelope's value-state paths: one per row of the page, and one per row member below it. */
const ROW_PATH_PREFIX = "rows.";

/** The tone each referral status carries, so colour never stands alone: the word itself is the label. */
const REFERRAL_TONES: Readonly<Record<PartnerReferralStatus, "positive" | "caution" | "muted">> = { active: "positive", "incomplete-date": "caution", expired: "muted" };

/** The three contact-method kinds the partner record holds, named as the record states them. */
const CONTACT_METHOD_LABELS: Readonly<Record<ContactMethodKind, string>> = { email: "Email", phone: "Phone", postal: "Postal" };

/**
 * The column keys that are also an ordering the service executes, and the field the read names that ordering by.
 * A column absent from this map is a fact the roster shows but does not order by, and its heading offers no sort
 * control at all rather than a control that would reorder one page.
 */
const SORT_FIELD_BY_COLUMN: Readonly<Record<string, string>> = { displayName: "displayName", kind: "kind", favourite: "favourite", recentActivity: "lastActivityOn" };

/** The inverse: the column a query's ordering is shown under, so a reloaded address marks the heading it came from. */
const COLUMN_BY_SORT_FIELD: Readonly<Record<string, PartnerColumnKey>> = { displayName: "displayName", kind: "kind", favourite: "favourite", lastActivityOn: "recentActivity" };

/** The wording this surface states for itself; every other word comes from the family's own copy modules. */
const ROSTER_COPY = {
  searchPlaceholder: "Search the whole roster",
  emptyAction: "Import a contact list",
  emptyActionNote: "A contact list is imported into this ministry and reviewed row by row before anything is accepted.",
  openRecord: (name: string): string => `Open ${name}`,
  noPermittedContact: "No permitted contact method",
  noTags: "No tag",
  noStage: "No relationship label recorded",
  noInitiative: "No initiative",
  noActivity: "No activity recorded",
  noGift: "No gift received",
  noCurrency: "No gift in this period",
  unfavourable: "Not a favourite",
  privateRecord: "Private record",
  projectionNote: "This list shows shared facts only. Notes and preparation text are read on the record itself, and a tag, a favourite or an open task proves nothing about contact, consent or giving.",
  readAtLabel: "Read at",
  loadingTitle: "Reading the partner roster",
  filtersUnavailableTitle: "The filters could not be read",
  filtersUnavailableBody: "The filter set describing this roster did not come back, so no filter control is offered here rather than one that would silently match nothing. The search, the list and the records are read independently of it, and reading again settles which it is.",
  retryFilters: "Try the filters again",
} as const;

// ---------------------------------------------------------------------------------------------
// Reading the ordering back and forth
//
// The preset speaks column identifiers and the read speaks its own field names. Both directions are stated here, once,
// so a heading, an address and a request can never name three orderings.
// ---------------------------------------------------------------------------------------------

/**
 * The members one preset change asks the roster's query to adopt, stated as a mutable patch because each member is
 * written as the change is decided; an absent member is unchanged, which is what keeps a page-size change from also
 * pinning a page.
 */
type RosterQueryPatch = { sort?: RosterSort | null; page?: number; pageSize?: number; columnVisibility?: Record<string, boolean> };

/** Whether two orderings are the same one, so a change is dispatched only when it changes something. */
function sameSort(left: RosterSort | null, right: RosterSort | null): boolean {
  if (left === null || right === null) return left === right;
  return left.field === right.field && left.direction === right.direction;
}

/** The preset's own ordering state for the query in force: no descriptor when the address states no ordering. */
function sortDescriptorsOf(sort: RosterSort | null): SortDescriptor[] {
  if (sort === null) return [];
  const columnKey = COLUMN_BY_SORT_FIELD[sort.field];
  if (columnKey === undefined) return [];
  return [{ id: columnKey, desc: sort.direction === "desc" }];
}

/** The ordering a preset change asks the read for, or none when it named a column the read cannot order by. */
function sortOfDescriptors(descriptors: readonly SortDescriptor[]): RosterSort | null {
  const [first] = descriptors;
  if (first === undefined) return null;
  const field = SORT_FIELD_BY_COLUMN[first.id];
  if (field === undefined) return null;
  return { field, direction: first.desc ? "desc" : "asc" };
}

/** Whether two column sets say the same thing, compared member by member rather than by object identity. */
function sameVisibility(left: Readonly<Record<string, boolean>>, right: Readonly<Record<string, boolean>>): boolean {
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) {
    if (left[key] !== right[key]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Reading one row member's value state
// ---------------------------------------------------------------------------------------------

/** The value states the envelope recorded, keyed by path. */
type RecordedStates = Readonly<Record<string, ValueState>>;

/**
 * The state of one member of one row. The read records one path per row member — `rows.<position>.<member>` — where
 * the position is the row's place in the page it answered with, which is also the position the preset hands each cell.
 * A member the envelope says nothing about is reported `unknown` rather than `value`: a number whose state the read
 * did not establish is not offered as a recorded one.
 */
function stateOfRowMember(states: RecordedStates | null, position: number, member: string): ValueState {
  if (states === null) return "unknown";
  const recorded = states[`${ROW_PATH_PREFIX}${String(position)}.${member}`];
  return recorded ?? "unknown";
}

/** Whether the read recorded any value it may not show here, which is the one condition the withholding note states. */
function recordsWithheldFact(states: RecordedStates | null): boolean {
  if (states === null) return false;
  for (const path of Object.keys(states)) {
    if (path.startsWith(ROW_PATH_PREFIX) && states[path] === "withheld") return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// The five renderings of a value that is not a plain number
// ---------------------------------------------------------------------------------------------

/**
 * The word and the accessible explanation for a value the read did not state as an ordinary value. `value` and
 * `zero` are handled by their callers, because a zero is a known number: a cell that holds no count states the
 * recorded zero in words, and a cell that holds one states the number.
 */
function StatedValueBadge({ state }: { readonly state: ValueState }): ReactElement | null {
  const word = valueStateWord(state);
  if (word === undefined) return null;
  const copy = VALUE_STATE_COPY[state];
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <StatusBadge label={copy.phrase} tone={word.tone} />
      <span className="sr-only">{copy.accessibleLabel}</span>
    </span>
  );
}

/**
 * One count and the state the read recorded for it. A recorded count is the number the service returned; every other
 * state states its own word instead of a number, so an unread source never reads as a count of none.
 */
function StatedCount({ count, noun, state }: { readonly count: number; readonly noun: string; readonly state: ValueState }): ReactElement {
  if (state === "value") {
    return (
      <span className="inline-flex min-w-0 items-baseline gap-1">
        <span className="tabular-figures">{String(count)}</span>
        <span>{noun}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1">
      <StatedValueBadge state={state} />
      <span className="sr-only">{noun}</span>
    </span>
  );
}

/**
 * One civil day and the state the read recorded for it. The stored day is rendered exactly as it was recorded — it is
 * a calendar day with no time and no zone behind it, so nothing here may convert it — and a recorded absence states
 * the absence in words rather than an empty cell.
 */
function StatedDay({ day, state, absent }: { readonly day: string | null; readonly state: ValueState; readonly absent: string }): ReactElement {
  if (state === "zero" || (state === "value" && (day === null || day.trim() === ""))) {
    return <span className="text-muted-foreground">{absent}</span>;
  }
  if (state === "value" && day !== null) {
    return <bdi className="mono-identifier">{day}</bdi>;
  }
  return <StatedValueBadge state={state} />;
}

// ---------------------------------------------------------------------------------------------
// The cells
// ---------------------------------------------------------------------------------------------

/** The address of one record, from its opaque identifier and never from its details. */
function partnerHref(partnerId: string): string {
  return `${PARTNER_ROUTE_PREFIX}/${encodeURIComponent(partnerId)}`;
}

/** The name a row is known by, falling back to its identifier so a record with no name is never labelled with nothing. */
function nameOf(row: PartnerRosterRow): string {
  const name = row.partner.displayName.trim();
  return name === "" ? row.partner.partnerId : name;
}

/** The wording of a value from a closed set: the source's own label where it stated one, else the value itself. */
function closedLabel(vocabulary: Readonly<Partial<Record<string, string>>>, value: string): string {
  const named = vocabulary[value];
  return named === undefined ? value : named;
}

/** One record's identity: the way into the record, and whether it is the worker's own private preparation. */
function NameCell({ row }: { readonly row: PartnerRosterRow }): ReactElement {
  const displayName = row.partner.displayName.trim();
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <Link href={partnerHref(row.partner.partnerId)} className="min-w-0 rounded-sm font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {displayName === "" ? <bdi className="mono-identifier">{row.partner.partnerId}</bdi> : <bdi className="text-pretty wrap-anywhere">{displayName}</bdi>}
      </Link>
      {row.partner.audience === "private" ? <StatusBadge label={ROSTER_COPY.privateRecord} tone="caution" /> : null}
    </span>
  );
}

/** What kind of record this is: a person, a household, a church, an organization, or the worker's own preparation. */
function KindCell({ row }: { readonly row: PartnerRosterRow }): ReactElement {
  return <span>{closedLabel(FACET_VALUE_LABELS["contact-type"], row.partner.kind)}</span>;
}

/** The contact methods this record permits, named by kind. A method another record holds grants nothing here. */
function ContactMethodCell({ row }: { readonly row: PartnerRosterRow }): ReactElement {
  if (row.contactMethodKinds.length === 0) {
    return <span className="text-muted-foreground">{ROSTER_COPY.noPermittedContact}</span>;
  }
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {row.contactMethodKinds.map((kind) => (
        <Badge key={kind} variant="secondary">
          {CONTACT_METHOD_LABELS[kind]}
        </Badge>
      ))}
    </span>
  );
}

/** The worker's own labels for the record. */
function TagsCell({ row }: { readonly row: PartnerRosterRow }): ReactElement {
  if (row.partner.tags.length === 0) {
    return <span className="text-muted-foreground">{ROSTER_COPY.noTags}</span>;
  }
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {row.partner.tags.map((tag) => (
        <Badge key={tag} variant="outline">
          <bdi className="min-w-0 wrap-anywhere">{tag}</bdi>
        </Badge>
      ))}
    </span>
  );
}

/** Whether the record is one the worker keeps close. A plain fact, stated as a word rather than as a bare flag. */
function FavouriteCell({ row }: { readonly row: PartnerRosterRow }): ReactElement {
  if (!row.partner.favourite) {
    return <span className="text-muted-foreground">{ROSTER_COPY.unfavourable}</span>;
  }
  return <StatusBadge label={closedLabel(FACET_VALUE_LABELS.favourite, "favourite")} tone="positive" />;
}

/**
 * The relationship context: the source's own relationship label, the initiatives this record is on, and where its
 * referral stands. Inclusion in an initiative is not consent, not a stage and not Update membership.
 */
function RelationshipCell({ row }: { readonly row: PartnerRosterRow }): ReactElement {
  const stage = row.partner.stage;
  const initiativeCount = row.initiativeIds.length;
  return (
    <span className="flex min-w-0 flex-col gap-1">
      {stage === null || stage.trim() === "" ? <span className="text-muted-foreground">{ROSTER_COPY.noStage}</span> : <bdi className="wrap-anywhere">{stage}</bdi>}
      <span className="text-xs text-muted-foreground">{initiativeCount === 0 ? ROSTER_COPY.noInitiative : `${String(initiativeCount)} initiative${initiativeCount === 1 ? "" : "s"}`}</span>
      {row.referralStatus === null ? null : <StatusBadge label={closedLabel(FACET_VALUE_LABELS["referral-status"], row.referralStatus)} tone={REFERRAL_TONES[row.referralStatus]} srPrefix="Referral" />}
    </span>
  );
}

/** The most recent interaction the source actually recorded. A gift and a scheduled task are neither. */
function RecentActivityCell({ row, position, states }: { readonly row: PartnerRosterRow; readonly position: number; readonly states: RecordedStates | null }): ReactElement {
  return <StatedDay day={row.lastActivityOn} state={stateOfRowMember(states, position, "lastActivityOn")} absent={ROSTER_COPY.noActivity} />;
}

/** The work open on this record, with the overdue and the undated ones counted separately rather than summed. */
function OpenTasksCell({ row, position, states }: { readonly row: PartnerRosterRow; readonly position: number; readonly states: RecordedStates | null }): ReactElement {
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <StatedCount count={row.openTaskCount} noun="open" state={stateOfRowMember(states, position, "openTaskCount")} />
      <StatedCount count={row.overdueTaskCount} noun="overdue" state={stateOfRowMember(states, position, "overdueTaskCount")} />
      <StatedCount count={row.undatedTaskCount} noun="without a due date" state={stateOfRowMember(states, position, "undatedTaskCount")} />
    </span>
  );
}

/** The original date of the most recent received support, on the basis and within the coverage the read states. */
function LastGiftCell({ row, position, states }: { readonly row: PartnerRosterRow; readonly position: number; readonly states: RecordedStates | null }): ReactElement {
  const day = row.lastReceivedOn ?? null;
  return <StatedDay day={day} state={stateOfRowMember(states, position, "lastReceivedOn")} absent={ROSTER_COPY.noGift} />;
}

/**
 * The currencies this partner gave in during the selected period. The amount itself is read on the support surface,
 * from the one report function, and is never computed or summed here: a list of currencies states which currencies
 * the period's support was received in, and nothing about how much.
 */
function GivingCurrencyCell({ row, position, states }: { readonly row: PartnerRosterRow; readonly position: number; readonly states: RecordedStates | null }): ReactElement {
  const state = stateOfRowMember(states, position, "givingCurrencies");
  const currencies = row.givingCurrencies ?? [];
  if (state === "zero" || (state === "value" && currencies.length === 0)) {
    return <span className="text-muted-foreground">{ROSTER_COPY.noCurrency}</span>;
  }
  if (state !== "value") {
    return <StatedValueBadge state={state} />;
  }
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {currencies.map((currency) => (
        <Badge key={currency} variant="secondary">
          <bdi className="mono-identifier">{currency}</bdi>
        </Badge>
      ))}
    </span>
  );
}

/**
 * The source's own commitment status for this partner. The source attributes commitment status to the support subject
 * far more often than to one partner, which is why the column is admitted only where the read states the member on the
 * rows: where it does not, the column does not exist rather than showing every partner as having no commitment.
 */
function RecurringStatusCell({ row, position, states }: { readonly row: PartnerRosterRow; readonly position: number; readonly states: RecordedStates | null }): ReactElement {
  const state = stateOfRowMember(states, position, "commitmentStatus");
  const stated = row.commitmentStatus ?? "";
  if (state === "value" && stated.trim() !== "") {
    return <bdi className="wrap-anywhere">{stated}</bdi>;
  }
  // The read recorded that the fact exists but projected no value onto this row, so the cell states what it can show
  // rather than inventing a status the source never attributed.
  return <StatedValueBadge state={state === "value" ? "unknown" : state} />;
}

// ---------------------------------------------------------------------------------------------
// The columns
// ---------------------------------------------------------------------------------------------

/** What one cell renders: the row, its place in the page (which is the position the envelope keyed its states by), and the recorded states. */
type CellRenderer = (row: PartnerRosterRow, position: number, states: RecordedStates | null) => ReactNode;

/** One cell per catalogue key, so a column the catalogue gains without a cell here fails to compile. */
const CELLS: Readonly<Record<PartnerColumnKey, CellRenderer>> = {
  displayName: (row) => <NameCell row={row} />,
  kind: (row) => <KindCell row={row} />,
  contactMethodAvailability: (row) => <ContactMethodCell row={row} />,
  tags: (row) => <TagsCell row={row} />,
  favourite: (row) => <FavouriteCell row={row} />,
  relationshipContext: (row) => <RelationshipCell row={row} />,
  recentActivity: (row, position, states) => <RecentActivityCell row={row} position={position} states={states} />,
  openTasks: (row, position, states) => <OpenTasksCell row={row} position={position} states={states} />,
  lastGiftOn: (row, position, states) => <LastGiftCell row={row} position={position} states={states} />,
  givingTotalInPeriod: (row, position, states) => <GivingCurrencyCell row={row} position={position} states={states} />,
  recurringStatus: (row, position, states) => <RecurringStatusCell row={row} position={position} states={states} />,
};

/** What each column states as its own value, so a column is a data column with a heading rather than a bare renderer. */
const ACCESSORS: Readonly<Record<PartnerColumnKey, (row: PartnerRosterRow) => string>> = {
  displayName: (row) => nameOf(row),
  kind: (row) => row.partner.kind,
  contactMethodAvailability: (row) => row.contactMethodKinds.join(" "),
  tags: (row) => row.partner.tags.join(" "),
  favourite: (row) => (row.partner.favourite ? "favourite" : "not-favourite"),
  relationshipContext: (row) => row.partner.stage ?? "",
  recentActivity: (row) => row.lastActivityOn ?? "",
  openTasks: (row) => `${String(row.openTaskCount)} ${String(row.overdueTaskCount)} ${String(row.undatedTaskCount)}`,
  lastGiftOn: (row) => row.lastReceivedOn ?? "",
  givingTotalInPeriod: (row) => (row.givingCurrencies ?? []).join(" "),
  recurringStatus: (row) => row.commitmentStatus ?? "",
};

/**
 * The columns this read admits, in the catalogue's own order. A column the read does not admit is not built at all, so
 * a giving column cannot appear, be switched on, or be described as hidden in a context that states no support facts.
 * Only a column the service can order by offers a sort control; the ordering itself is the service's.
 */
function rosterColumns(admitted: readonly PartnerColumn[], states: RecordedStates | null): ReadonlyArray<RecordListColumnDef<PartnerRosterRow>> {
  const columns: RecordListColumnDef<PartnerRosterRow>[] = [];
  for (const column of admitted) {
    const cell = CELLS[column.key];
    const accessor = ACCESSORS[column.key];
    const sortable = SORT_FIELD_BY_COLUMN[column.key] !== undefined;
    columns.push({ id: column.key, header: column.displayName, enableSorting: sortable, accessorFn: accessor, cell: (context) => cell(context.row.original, context.row.index, states) });
  }
  return columns;
}

/** One row's identity for the preset: the partner identifier, which is what every request names. */
function partnerRowId(row: PartnerRosterRow): string {
  return row.partner.partnerId;
}

/** One row's name for a control: the name it is known by, so a control names the record it acts on. */
function partnerRowLabel(row: PartnerRosterRow): string {
  return nameOf(row);
}

/** The row action a roster that was handed none offers: the way into the record, named with the record it opens. */
function OpenRecordAction({ row }: { readonly row: PartnerRosterRow }): ReactElement {
  return (
    <Link href={partnerHref(row.partner.partnerId)} aria-label={ROSTER_COPY.openRecord(nameOf(row))} className={cn(buttonVariants({ variant: "ghost", size: "icon-xs" }))}>
      <ChevronRightIcon aria-hidden="true" />
    </Link>
  );
}

// ---------------------------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------------------------

/** The first action a roster that holds no contact yet offers when the composing route supplies none of its own. */
function ImportFirstAction(): ReactElement {
  return (
    <div className="flex max-w-prose flex-col items-center gap-2">
      <Link href={IMPORT_HREF} className={cn(buttonVariants({ variant: "outline" }), "h-auto max-w-full whitespace-normal")}>
        {ROSTER_COPY.emptyAction}
      </Link>
      <p className="text-center text-xs text-pretty text-muted-foreground">{ROSTER_COPY.emptyActionNote}</p>
    </div>
  );
}

/**
 * What a read envelope states about the roster as a whole: partial coverage, a fact the context withholds, the instant
 * the list was read at. None of it is derived from the rows — each statement travels on the envelope the read answered.
 */
function RosterNotes({ envelope }: { readonly envelope: ReadEnvelope<unknown> }): ReactElement {
  const withheld = SURFACE_STATE_COPY.roster.withheld;
  const partial = SURFACE_STATE_COPY.roster["partial-coverage"];
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {recordsWithheldFact(envelope.valueStates) ? (
        <p className="flex max-w-prose flex-col items-start gap-1 text-xs text-pretty text-muted-foreground">
          <StatusBadge label={withheld.title} tone="caution" />
          <span>{withheld.body}</span>
        </p>
      ) : null}
      {envelope.coverage.state === "complete" ? null : <StateNotice kind="partial-coverage" headingLevel={3} title={partial.title} description={partial.body} coverage={envelope.coverage} />}
      <p className="max-w-prose text-xs text-pretty text-muted-foreground">{ROSTER_COPY.projectionNote}</p>
      <p className="text-xs text-muted-foreground">
        {`${ROSTER_COPY.readAtLabel}: `}
        <bdi className="mono-identifier">{envelope.asOf}</bdi>
      </p>
    </div>
  );
}

/**
 * The Partners roster for one scope: the one filter surface over the one table preset, the family's saved views and
 * column chooser beside it, and the way into each record in its row.
 *
 * The render has exactly one arm per answer the roster read can give. An envelope the service returned is the list; a
 * denial states its closed reason and nothing else — no row, no count, no name and no hint of what the roster holds; an
 * outage states its source and offers the read again; a refusal states that the request was refused rather than that the
 * source failed. A read that has not answered is a loading state, never an empty roster.
 */
export default function PartnerRoster({ scope, rowActions, emptyAction, dir, className }: PartnerRosterProps): ReactElement {
  // The columns this surface offers, named once at module scope: the same closed set is given to the one URL parser and
  // to the saved-view bar, so a stale address or a stored view cannot carry a column this surface does not have.
  const roster = useRosterQuery<PartnerRosterRow>(scope, { admittedColumnKeys: PARTNER_COLUMN_KEYS });
  const result = roster.roster.data;
  const envelope = result !== undefined && result.kind === "envelope" ? result.envelope : null;
  const states = envelope === null ? null : envelope.valueStates;
  const facetsEnvelope = roster.facets.data !== undefined && roster.facets.data.kind === "envelope" ? roster.facets.data.envelope : null;
  const admitted = useMemo(() => admittedPartnerColumns(envelope), [envelope]);
  const columns = useMemo(() => rosterColumns(admitted, states), [admitted, states]);
  const busy = roster.roster.isFetching || roster.facets.isFetching;
  const hasActiveFilters = roster.query.search !== "" || Object.keys(roster.query.facets).length > 0;
  // The preset's state and the read's query are one state: the address owns it, so a page, a sort and a visible column
  // set are the same facts here, in the handler and in the request.
  const queryState: RecordListQueryState = { sort: sortDescriptorsOf(roster.query.sort), page: roster.query.page, pageSize: roster.query.pageSize, columnVisibility: roster.query.columnVisibility };
  const changeSearch = (value: string): void => {
    roster.setQuery({ search: value });
  };
  const changeApplied = (next: Record<string, string[]>): void => {
    roster.setQuery({ facets: next });
  };
  const changeColumns = (next: Record<string, boolean>): void => {
    roster.setQuery({ columnVisibility: next });
  };
  const clearFilters = (): void => {
    roster.clearAll();
  };
  // Only the members that actually changed are dispatched: a page-size change resets the page in the one place that
  // rule lives, a new ordering returns to the first page, and a change of visible columns keeps the page it was made on.
  const changeQueryState = (next: RecordListQueryState): void => {
    const nextSort = sortOfDescriptors(next.sort);
    const patch: RosterQueryPatch = {};
    if (!sameSort(nextSort, roster.query.sort)) patch.sort = nextSort;
    if (next.page !== roster.query.page) patch.page = next.page;
    if (next.pageSize !== roster.query.pageSize) patch.pageSize = next.pageSize;
    if (!sameVisibility(next.columnVisibility, roster.query.columnVisibility)) patch.columnVisibility = next.columnVisibility;
    if (Object.keys(patch).length === 0) return;
    roster.setQuery(patch);
  };
  /** The filter set's own answer, stated beside the toolbar: a filter block that invented controls for a failed read would offer filters the service never authorised. */
  function filtersNotice(): ReactElement | null {
    const facetsResult = roster.facets.data;
    if (facetsResult === undefined) {
      if (!roster.facets.isError) return null;
      return (
        <StateNotice
          kind="unavailable"
          headingLevel={3}
          title={ROSTER_COPY.filtersUnavailableTitle}
          description={ROSTER_COPY.filtersUnavailableBody}
          retry={{
            label: ROSTER_COPY.retryFilters,
            onClick: () => {
              void roster.facets.refetch();
            },
          }}
        />
      );
    }
    switch (facetsResult.kind) {
      case "envelope":
        return null;
      case "denied":
        // A denial carries its closed reason and nothing about the records behind it.
        return <StateNotice kind="denied" headingLevel={3} title={ROSTER_COPY.filtersUnavailableTitle} description={ROSTER_COPY.filtersUnavailableBody} reasonCode={facetsResult.denied.reasonCode} />;
      case "unavailable":
        return <StateNotice kind="unavailable" headingLevel={3} title={ROSTER_COPY.filtersUnavailableTitle} description={ROSTER_COPY.filtersUnavailableBody} source={facetsResult.unavailable.source} />;
      case "refused":
        return <StateNotice kind="refused" headingLevel={3} title={ROSTER_COPY.filtersUnavailableTitle} description={ROSTER_COPY.filtersUnavailableBody} />;
    }
  }
  /** The roster itself: the list, the reason it holds none, or the answer that stands instead of a list. */
  function rosterBody(): ReactElement {
    const copy = SURFACE_STATE_COPY.roster;
    if (result === undefined) {
      if (roster.roster.isError) {
        // The request itself did not answer, so no row and no count stands in its place.
        return (
          <StateNotice
            kind="unavailable"
            headingLevel={2}
            title={copy.unavailable.title}
            description={copy.unavailable.body}
            retry={{
              label: PARTNER_ACTION_LABELS.retry,
              onClick: () => {
                void roster.roster.refetch();
              },
            }}
          />
        );
      }
      return <StateNotice kind="loading" headingLevel={2} title={ROSTER_COPY.loadingTitle} loadingLines={5} />;
    }
    switch (result.kind) {
      case "envelope": {
        const { rows, total } = result.envelope.data;
        return (
          <RecordList
            label={ROSTER_LABEL}
            columns={columns}
            rows={rows}
            rowCount={total}
            getRowId={partnerRowId}
            rowLabel={partnerRowLabel}
            queryState={queryState}
            onQueryStateChange={changeQueryState}
            rowActions={rowActions === undefined ? (row) => <OpenRecordAction row={row} /> : (row) => rowActions(row)}
            emptyAction={emptyAction === undefined ? <ImportFirstAction /> : emptyAction}
            itemNoun={ITEM_NOUN}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            hasActiveFilters={hasActiveFilters}
            onClearFilters={clearFilters}
            isLoading={roster.roster.isPlaceholderData}
          />
        );
      }
      case "denied":
        // The closed reason code is the whole answer: no row, no count and no hint of what the roster would have held.
        return <StateNotice kind="denied" headingLevel={2} title={copy.denied.title} description={copy.denied.body} reasonCode={result.denied.reasonCode} />;
      case "unavailable":
        return (
          <StateNotice
            kind="unavailable"
            headingLevel={2}
            title={copy.unavailable.title}
            description={result.unavailable.guidance}
            source={result.unavailable.source}
            retry={{
              label: PARTNER_ACTION_LABELS.retry,
              onClick: () => {
                void roster.roster.refetch();
              },
            }}
          />
        );
      case "refused":
        // The query this surface states is the read's own admitted one, so a refusal is answered in the roster's words
        // rather than thrown, and it says the request was refused — not that the partner source failed.
        return <StateNotice kind="refused" headingLevel={2} title={copy.refused.title} description={copy.refused.body} />;
    }
  }
  return (
    <div data-slot="partner-roster" dir={dir} className={cn("flex min-w-0 flex-col gap-4", className)}>
      <div className="flex min-w-0 flex-col gap-3">
        <PartnerFacets label={ROSTER_LABEL} facetsEnvelope={facetsEnvelope} search={{ value: roster.query.search, onChange: changeSearch, placeholder: ROSTER_COPY.searchPlaceholder }} applied={roster.query.facets} onAppliedChange={changeApplied} pending={busy} />
        {/* Two controls read one column set: the family's chooser states which optional columns this context admits and
            why, while the preset's own menu is the table's native affordance over the same controlled state. Neither
            keeps a copy, so both always describe the columns actually shown. */}
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <SavedViewBar scope={scope} admittedColumnKeys={PARTNER_COLUMN_KEYS} />
          <ColumnChooser value={roster.query.columnVisibility} onValueChange={changeColumns} envelope={envelope} />
        </div>
        {filtersNotice()}
      </div>
      {rosterBody()}
      {envelope === null ? null : <RosterNotes envelope={envelope} />}
    </div>
  );
}
