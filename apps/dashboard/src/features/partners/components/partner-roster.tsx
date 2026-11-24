"use client";
import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";
import { useMemo, useState, type ReactElement, type ReactNode } from "react";
import { RecordList, type RecordListColumnDef, type RecordListQueryState, type SortDescriptor } from "@/components/record-list";
import SidePanel from "@/components/side-panel";
import { StateNotice, type StateNoticeProps } from "@/components/state-notice";
import StatusBadge, { valueStateWord } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants, BUTTON_WRAP_CLASS } from "@/components/ui/button";
import { useIsMobile } from "@/components/ui/use-mobile";
import { cn } from "@/lib/cn";
import type { ContactMethodKind, PartnerKind, ReadEnvelope, RecordAudience, Scope, ValueState } from "@/modules/data-service/envelope";
import type { ReadResult } from "@/modules/data-service/outcome";
import { FACET_VALUE_LABELS } from "../copy/facets";
import { PARTNER_ACTION_LABELS, SURFACE_STATE_COPY, VALUE_STATE_COPY } from "../copy/states";
import { ROSTER_PAGE_SIZE_CAP, ROSTER_PAGE_SIZE_DEFAULT, useRosterQuery, type RosterEnvelope, type RosterSort } from "../hooks/use-roster-query";
import { tagSuggestionsOf } from "../tag-suggestions";
import ColumnChooser, { PARTNER_COLUMN_KEYS, admittedPartnerColumns, type PartnerColumn, type PartnerColumnKey } from "./column-chooser";
import { PartnerFacets } from "./partner-facets";
import PartnerRecordPanel from "./partner-record-panel";
import SavedViewBar from "./saved-view-bar";
type PartnerRosterRecord = { readonly partnerId: string; readonly kind: PartnerKind; readonly displayName: string; readonly tags: readonly string[]; readonly favourite: boolean; readonly stage: string | null; readonly audience: RecordAudience; readonly revision: string };
type PartnerReferralStatus = "active" | "incomplete-date" | "expired";
export interface PartnerRosterRow {
  readonly partner: PartnerRosterRecord;
  readonly contactMethodKinds: readonly ContactMethodKind[];
  readonly initiativeIds: readonly string[];
  readonly referralStatus: PartnerReferralStatus | null;
  readonly openTaskCount: number;
  readonly overdueTaskCount: number;
  readonly undatedTaskCount: number;
  readonly lastActivityOn: string | null;
  readonly givingCurrencies?: readonly string[];
  readonly lastReceivedOn?: string | null;
  readonly commitmentStatus?: string | null;
}
export type PartnerRosterProps = { readonly scope: Scope; readonly initialResult?: ReadResult<RosterEnvelope<PartnerRosterRow>>; readonly rowActions?: (row: PartnerRosterRow) => ReactNode; readonly emptyAction?: ReactNode; readonly dir?: "ltr" | "rtl"; readonly className?: string };
const ROSTER_LABEL = "Partner roster";
const PAGE_SIZE_OPTIONS: readonly number[] = [ROSTER_PAGE_SIZE_DEFAULT, ROSTER_PAGE_SIZE_CAP];
const ROW_PATH_PREFIX = "rows.";
const REFERRAL_TONES: Readonly<Record<PartnerReferralStatus, "positive" | "caution" | "muted">> = { active: "positive", "incomplete-date": "caution", expired: "muted" };
const CONTACT_METHOD_LABELS: Readonly<Record<ContactMethodKind, string>> = { email: "Email", phone: "Phone", postal: "Postal" };
const SORT_FIELD_BY_COLUMN: Readonly<Record<string, string>> = { displayName: "displayName", kind: "kind", favourite: "favourite", recentActivity: "lastActivityOn" };
const COLUMN_BY_SORT_FIELD: Readonly<Record<string, PartnerColumnKey>> = { displayName: "displayName", kind: "kind", favourite: "favourite", lastActivityOn: "recentActivity" };
const ROSTER_COPY = {
  openRecord: (name: string): string => `Open ${name}`,
  openBeside: "Open",
  openBesideNote: (name: string): string => ` ${name} beside the list`,
  panelTitle: "Partner record",
  filtersUnavailableTitle: "The filters could not be read",
  filtersUnavailableBody: "The filter set describing this roster did not come back, so no filter control is offered here rather than one that would silently match nothing. The search, the list and the records are read independently of it, and reading again settles which it is.",
} as const;
const sameSort = (left: RosterSort | null, right: RosterSort | null): boolean => (left === null || right === null ? left === right : left.field === right.field && left.direction === right.direction);
const sortDescriptorsOf = (sort: RosterSort | null): SortDescriptor[] => {
  const id = sort === null ? undefined : COLUMN_BY_SORT_FIELD[sort.field];
  return id === undefined ? [] : [{ id, desc: sort?.direction === "desc" }];
};
const sortOfDescriptors = (descriptors: readonly SortDescriptor[]): RosterSort | null => {
  const [first] = descriptors;
  const field = first === undefined ? undefined : SORT_FIELD_BY_COLUMN[first.id];
  return field === undefined ? null : { field, direction: first?.desc === true ? "desc" : "asc" };
};
const sameVisibility = (left: Readonly<Record<string, boolean>>, right: Readonly<Record<string, boolean>>): boolean => {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
};
type RecordedStates = Readonly<Record<string, ValueState>>;
const stateOfRowMember = (states: RecordedStates | null, position: number, member: string): ValueState => states?.[`${ROW_PATH_PREFIX}${String(position)}.${member}`] ?? "unknown";
const recordsWithheldFact = (states: RecordedStates | null): boolean => states !== null && Object.keys(states).some((path) => path.startsWith(ROW_PATH_PREFIX) && states[path] === "withheld");
function StatedValueBadge({ state }: { readonly state: ValueState }): ReactElement | null {
  const word = valueStateWord(state);
  if (word === undefined) return null;
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <StatusBadge label={VALUE_STATE_COPY[state].phrase} tone={word.tone} />
      <span className="sr-only">{VALUE_STATE_COPY[state].accessibleLabel}</span>
    </span>
  );
}
function StatedCount({ count, noun, state }: { readonly count: number; readonly noun: string; readonly state: ValueState }): ReactElement {
  const figures = state === "value" ? <span className="tabular-figures">{String(count)}</span> : <StatedValueBadge state={state} />;
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1">
      {figures}
      <span className={state === "value" ? undefined : "sr-only"}>{noun}</span>
    </span>
  );
}
function StatedDay({ day, state, absent }: { readonly day: string | null; readonly state: ValueState; readonly absent: string }): ReactElement {
  if (state === "zero" || (state === "value" && (day === null || day.trim() === ""))) return <span className="text-muted-foreground">{absent}</span>;
  if (state === "value" && day !== null) return <bdi className="mono-identifier">{day}</bdi>;
  return <StatedValueBadge state={state} />;
}
const partnerHref = (partnerId: string): string => `/partners/${encodeURIComponent(partnerId)}`;
const nameOf = (row: PartnerRosterRow): string => row.partner.displayName.trim() || row.partner.partnerId;
const closedLabel = (vocabulary: Readonly<Partial<Record<string, string>>>, value: string): string => vocabulary[value] ?? value;
function NameCell({ row }: { readonly row: PartnerRosterRow }): ReactElement {
  const displayName = row.partner.displayName.trim();
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <Link href={partnerHref(row.partner.partnerId)} className="inline-flex min-h-6 min-w-0 items-center rounded-sm font-medium inline-link focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {displayName === "" ? <bdi className="mono-identifier">{row.partner.partnerId}</bdi> : <bdi className="text-pretty wrap-anywhere">{displayName}</bdi>}
      </Link>
      {row.partner.audience === "private" ? <StatusBadge label="Private record" tone="caution" /> : null}
    </span>
  );
}
const ChipRun = ({ chips, variant }: { readonly chips: readonly { readonly key: string; readonly content: ReactNode }[]; readonly variant: "secondary" | "outline" }): ReactElement => (
  <span className="flex min-w-0 flex-wrap items-center gap-1">
    {chips.map((chip) => (
      <Badge key={chip.key} variant={variant}>
        {chip.content}
      </Badge>
    ))}
  </span>
);
const chip = (key: string, content: ReactNode): { readonly key: string; readonly content: ReactNode } => ({ key, content });
function ContactMethodCell({ row }: { readonly row: PartnerRosterRow }): ReactElement {
  if (row.contactMethodKinds.length === 0) return <span className="text-muted-foreground">No permitted contact method</span>;
  return <ChipRun variant="secondary" chips={row.contactMethodKinds.map((kind) => chip(kind, CONTACT_METHOD_LABELS[kind]))} />;
}
function TagsCell({ row }: { readonly row: PartnerRosterRow }): ReactElement {
  if (row.partner.tags.length === 0) return <span className="text-muted-foreground">No tag</span>;
  return <ChipRun variant="outline" chips={row.partner.tags.map((tag) => chip(tag, <bdi className="min-w-0 wrap-anywhere">{tag}</bdi>))} />;
}
function RelationshipCell({ row }: { readonly row: PartnerRosterRow }): ReactElement {
  const stage = row.partner.stage;
  const initiativeCount = row.initiativeIds.length;
  return (
    <span className="flex min-w-0 flex-col gap-1">
      {stage === null || stage.trim() === "" ? <span className="text-muted-foreground">No relationship label recorded</span> : <bdi className="wrap-anywhere">{stage}</bdi>}
      <span className="text-xs text-muted-foreground">{initiativeCount === 0 ? "No initiative" : `${String(initiativeCount)} initiative${initiativeCount === 1 ? "" : "s"}`}</span>
      {row.referralStatus === null ? null : <StatusBadge label={closedLabel(FACET_VALUE_LABELS["referral-status"], row.referralStatus)} tone={REFERRAL_TONES[row.referralStatus]} srPrefix="Referral" />}
    </span>
  );
}
const OpenTasksCell = ({ row, position, states }: { readonly row: PartnerRosterRow; readonly position: number; readonly states: RecordedStates | null }): ReactElement => (
  <span className="flex min-w-0 flex-col gap-1">
    <StatedCount count={row.openTaskCount} noun="open" state={stateOfRowMember(states, position, "openTaskCount")} />
    <StatedCount count={row.overdueTaskCount} noun="overdue" state={stateOfRowMember(states, position, "overdueTaskCount")} />
    <StatedCount count={row.undatedTaskCount} noun="without a due date" state={stateOfRowMember(states, position, "undatedTaskCount")} />
  </span>
);
function GivingCurrencyCell({ row, position, states }: { readonly row: PartnerRosterRow; readonly position: number; readonly states: RecordedStates | null }): ReactElement {
  const state = stateOfRowMember(states, position, "givingCurrencies");
  const currencies = row.givingCurrencies ?? [];
  if (state === "zero" || (state === "value" && currencies.length === 0)) return <span className="text-muted-foreground">No gift in this period</span>;
  if (state !== "value") return <StatedValueBadge state={state} />;
  return <ChipRun variant="secondary" chips={currencies.map((currency) => chip(currency, <bdi className="mono-identifier">{currency}</bdi>))} />;
}
function RecurringStatusCell({ row, position, states }: { readonly row: PartnerRosterRow; readonly position: number; readonly states: RecordedStates | null }): ReactElement {
  const state = stateOfRowMember(states, position, "commitmentStatus");
  const stated = row.commitmentStatus ?? "";
  if (state === "value" && stated.trim() !== "") return <bdi className="wrap-anywhere">{stated}</bdi>;
  return <StatedValueBadge state={state === "value" ? "unknown" : state} />;
}
type ColumnRender = { readonly accessor: (row: PartnerRosterRow) => string; readonly cell: (row: PartnerRosterRow, position: number, states: RecordedStates | null) => ReactNode };
const COLUMN_RENDER: Readonly<Record<PartnerColumnKey, ColumnRender>> = {
  displayName: { accessor: nameOf, cell: (row) => <NameCell row={row} /> },
  kind: { accessor: (row) => row.partner.kind, cell: (row) => <span>{closedLabel(FACET_VALUE_LABELS["contact-type"], row.partner.kind)}</span> },
  contactMethodAvailability: { accessor: (row) => row.contactMethodKinds.join(" "), cell: (row) => <ContactMethodCell row={row} /> },
  tags: { accessor: (row) => row.partner.tags.join(" "), cell: (row) => <TagsCell row={row} /> },
  favourite: { accessor: (row) => (row.partner.favourite ? "favourite" : "not-favourite"), cell: (row) => (row.partner.favourite ? <StatusBadge label={closedLabel(FACET_VALUE_LABELS.favourite, "favourite")} tone="positive" /> : <span className="text-muted-foreground">Not a favourite</span>) },
  relationshipContext: { accessor: (row) => row.partner.stage ?? "", cell: (row) => <RelationshipCell row={row} /> },
  recentActivity: { accessor: (row) => row.lastActivityOn ?? "", cell: (row, position, states) => <StatedDay day={row.lastActivityOn} state={stateOfRowMember(states, position, "lastActivityOn")} absent="No activity recorded" /> },
  openTasks: { accessor: (row) => `${String(row.openTaskCount)} ${String(row.overdueTaskCount)} ${String(row.undatedTaskCount)}`, cell: (row, position, states) => <OpenTasksCell row={row} position={position} states={states} /> },
  lastGiftOn: { accessor: (row) => row.lastReceivedOn ?? "", cell: (row, position, states) => <StatedDay day={row.lastReceivedOn ?? null} state={stateOfRowMember(states, position, "lastReceivedOn")} absent="No gift received" /> },
  givingTotalInPeriod: { accessor: (row) => (row.givingCurrencies ?? []).join(" "), cell: (row, position, states) => <GivingCurrencyCell row={row} position={position} states={states} /> },
  recurringStatus: { accessor: (row) => row.commitmentStatus ?? "", cell: (row, position, states) => <RecurringStatusCell row={row} position={position} states={states} /> },
};
const rosterColumns = (admitted: readonly PartnerColumn[], states: RecordedStates | null): ReadonlyArray<RecordListColumnDef<PartnerRosterRow>> =>
  admitted.map((column) => {
    const render = COLUMN_RENDER[column.key];
    return { id: column.key, header: column.displayName, enableSorting: SORT_FIELD_BY_COLUMN[column.key] !== undefined, accessorFn: render.accessor, cell: (context) => render.cell(context.row.original, context.row.index, states) };
  });
const OpenRecordAction = ({ row }: { readonly row: PartnerRosterRow }): ReactElement => (
  <Link href={partnerHref(row.partner.partnerId)} aria-label={ROSTER_COPY.openRecord(nameOf(row))} data-slot="button" className={cn(buttonVariants({ variant: "ghost", size: "icon-xs" }))}>
    <ChevronRightIcon aria-hidden="true" />
  </Link>
);
/** The row action that opens the record beside the list: its visible word is the same on every row, so the hidden half names the record it opens and where it opens it, and one control never reads as a second way to the record's own page. */
function OpenBesideAction({ row, onOpen }: { readonly row: PartnerRosterRow; readonly onOpen: (partnerId: string) => void }): ReactElement {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => {
        onOpen(row.partner.partnerId);
      }}
      className="max-w-full whitespace-normal"
    >
      {ROSTER_COPY.openBeside}
      <span className="sr-only">{ROSTER_COPY.openBesideNote(nameOf(row))}</span>
    </Button>
  );
}
const ImportFirstAction = (): ReactElement => (
  <div className="flex max-w-prose flex-col items-center gap-2">
    <Link href="/partners/import" data-slot="button" className={cn(buttonVariants({ variant: "outline" }), BUTTON_WRAP_CLASS)}>
      Import a contact list
    </Link>
    <p className="text-center text-xs text-pretty text-muted-foreground">A contact list is imported into this ministry and reviewed row by row before anything is accepted.</p>
  </div>
);
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
      <p className="max-w-prose text-xs text-pretty text-muted-foreground">This list shows shared facts only. Notes and preparation text are read on the record itself, and a tag, a favourite or an open task proves nothing about contact, consent or giving.</p>
      <p className="text-xs text-muted-foreground">
        Read at:
        <bdi className="mono-identifier">{envelope.asOf}</bdi>
      </p>
    </div>
  );
}
/** The Partners roster for one scope: the one filter surface over the one table preset, the family's saved views and column chooser beside it, and the way into each record in its row. */
export default function PartnerRoster({ scope, initialResult, rowActions, emptyAction, dir, className }: PartnerRosterProps): ReactElement {
  const roster = useRosterQuery<PartnerRosterRow>(scope, { admittedColumnKeys: PARTNER_COLUMN_KEYS }, initialResult);
  const result = roster.roster.data;
  const envelope = result !== undefined && result.kind === "envelope" ? result.envelope : null;
  const states = envelope === null ? null : envelope.valueStates;
  const facetsEnvelope = roster.facets.data !== undefined && roster.facets.data.kind === "envelope" ? roster.facets.data.envelope : null;
  // The labels a record's filing surface offers are this read's own tag facet, so the record opened beside the list is handed them instead of issuing the facet read a second time.
  const tagSuggestions = useMemo(() => tagSuggestionsOf(facetsEnvelope?.data), [facetsEnvelope]);
  const admitted = useMemo(() => admittedPartnerColumns(envelope), [envelope]);
  const columns = useMemo(() => rosterColumns(admitted, states), [admitted, states]);
  const busy = roster.roster.isFetching || roster.facets.isFetching;
  const hasActiveFilters = roster.query.search !== "" || Object.keys(roster.query.facets).length > 0;
  // The record opened beside the list, held as the identifier the read named so the panel's own reads stay keyed by the record rather than by its position on a page; its label is read back from the page on screen and falls back to that identifier where a filter change has since moved the row out of the page.
  const [openPartnerId, setOpenPartnerId] = useState<string | null>(null);
  const isMobile = useIsMobile();
  const openRow = openPartnerId === null ? null : (envelope?.data.rows.find((row) => row.partner.partnerId === openPartnerId) ?? null);
  const openLabel = openPartnerId === null ? null : openRow === null ? openPartnerId : nameOf(openRow);
  const openBeside = (partnerId: string): void => setOpenPartnerId(partnerId);
  // Only a close clears the selection: the shell reports the state it moved to, and a report of `true` leaves the row the panel was opened from in place.
  const closePanel = (open: boolean): void => {
    if (!open) setOpenPartnerId(null);
  };
  const queryState: RecordListQueryState = { sort: sortDescriptorsOf(roster.query.sort), page: roster.query.page, pageSize: roster.query.pageSize, columnVisibility: roster.query.columnVisibility };
  const retryFacets = { label: "Try the filters again", onClick: (): void => void roster.facets.refetch() };
  const retryRoster = { label: PARTNER_ACTION_LABELS.retry, onClick: (): void => void roster.roster.refetch() };
  const changeSearch = (value: string): void => roster.setQuery({ search: value });
  const changeApplied = (next: Record<string, string[]>): void => roster.setQuery({ facets: next });
  const changeColumns = (next: Record<string, boolean>): void => roster.setQuery({ columnVisibility: next });
  const clearFilters = (): void => roster.clearAll();
  const changeQueryState = (next: RecordListQueryState): void => {
    const nextSort = sortOfDescriptors(next.sort);
    const patch: { sort?: RosterSort | null; page?: number; pageSize?: number; columnVisibility?: Record<string, boolean> } = {};
    if (!sameSort(nextSort, roster.query.sort)) patch.sort = nextSort;
    if (next.page !== roster.query.page) patch.page = next.page;
    if (next.pageSize !== roster.query.pageSize) patch.pageSize = next.pageSize;
    if (!sameVisibility(next.columnVisibility, roster.query.columnVisibility)) patch.columnVisibility = next.columnVisibility;
    if (Object.keys(patch).length === 0) return;
    roster.setQuery(patch);
  };
  function filtersNotice(): ReactElement | null {
    const facetsResult = roster.facets.data;
    const title = ROSTER_COPY.filtersUnavailableTitle;
    const description = ROSTER_COPY.filtersUnavailableBody;
    if (facetsResult === undefined) return roster.facets.isError ? <StateNotice kind="unavailable" headingLevel={3} title={title} description={description} retry={retryFacets} /> : null;
    if (facetsResult.kind === "envelope") return null;
    const stated: Pick<StateNoticeProps, "reasonCode" | "source"> = facetsResult.kind === "denied" ? { reasonCode: facetsResult.denied.reasonCode } : facetsResult.kind === "unavailable" ? { source: facetsResult.unavailable.source } : {};
    return <StateNotice kind={facetsResult.kind} headingLevel={3} title={title} description={description} {...stated} />;
  }
  function rosterBody(): ReactElement {
    const copy = SURFACE_STATE_COPY.roster;
    if (result === undefined) {
      if (roster.roster.isError) return <StateNotice kind="unavailable" headingLevel={2} title={copy.unavailable.title} description={copy.unavailable.body} retry={retryRoster} />;
      return <StateNotice kind="loading" headingLevel={2} title="Reading the partner roster" loadingLines={5} />;
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
            getRowId={(row) => row.partner.partnerId}
            rowLabel={nameOf}
            queryState={queryState}
            onQueryStateChange={changeQueryState}
            rowActions={(row) => (
              <span className="inline-flex min-w-0 items-center justify-end gap-1">
                <OpenBesideAction row={row} onOpen={openBeside} />
                {rowActions === undefined ? <OpenRecordAction row={row} /> : rowActions(row)}
              </span>
            )}
            emptyAction={emptyAction === undefined ? <ImportFirstAction /> : emptyAction}
            itemNoun="partners"
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            hasActiveFilters={hasActiveFilters}
            onClearFilters={clearFilters}
            suppressColumnVisibilityMenu
            isLoading={roster.roster.isPlaceholderData}
          />
        );
      }
      case "denied":
        return <StateNotice kind="denied" headingLevel={2} title={copy.denied.title} description={copy.denied.body} reasonCode={result.denied.reasonCode} />;
      case "unavailable":
        return <StateNotice kind="unavailable" headingLevel={2} title={copy.unavailable.title} description={result.unavailable.guidance} source={result.unavailable.source} retry={retryRoster} />;
      case "refused":
        return <StateNotice kind="refused" headingLevel={2} title={copy.refused.title} description={copy.refused.body} />;
    }
  }
  const panelBody = openPartnerId === null ? null : <PartnerRecordPanel scope={scope} partnerId={openPartnerId} layout={isMobile ? "sheet" : "panel"} tagSuggestions={tagSuggestions} />;
  return (
    <div data-slot="partner-roster" dir={dir} className={cn("flex min-w-0 flex-col gap-4", className)}>
      <div className="flex min-w-0 flex-col gap-3">
        <PartnerFacets label={ROSTER_LABEL} facetsEnvelope={facetsEnvelope} search={{ value: roster.query.search, onChange: changeSearch, placeholder: "Search the whole roster" }} applied={roster.query.facets} onAppliedChange={changeApplied} pending={busy} />
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <SavedViewBar scope={scope} admittedColumnKeys={PARTNER_COLUMN_KEYS} initialResult={initialResult} />
          <ColumnChooser value={roster.query.columnVisibility} onValueChange={changeColumns} envelope={envelope} />
        </div>
        {filtersNotice()}
      </div>
      {/* The list and the record it opens sit side by side from the width the shared shell presents a column beside a list, so the filtered list stays in view while the record is read; below it they are one column and the record is the sheet the phone shows. */}
      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {rosterBody()}
          {envelope === null ? null : <RosterNotes envelope={envelope} />}
        </div>
        {/* Always mounted, outside the list, so a panel that closes returns focus to the row control that opened it. The body is the family's own detail body: the panel is a presentation of the record, never a second one. */}
        <SidePanel open={openPartnerId !== null} onOpenChange={closePanel} variant={isMobile ? "phone" : "desktop"} title={openLabel === null ? ROSTER_COPY.panelTitle : `${ROSTER_COPY.panelTitle}, ${openLabel}`} body={panelBody} />
      </div>
    </div>
  );
}
