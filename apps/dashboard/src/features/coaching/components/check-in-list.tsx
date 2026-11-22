"use client";
/** The worker's check-in history: the family's one list and pager pattern over the named `readCheckIns` read, paged 25 rows by default and 100 at most, keeping the private draft and the shared revision distinguishable in the same row without reproducing either one's text. */
import { useCallback, useMemo, useState, type ReactElement } from "react";
import type { RecordDetailProps } from "@/components/record-detail";
import RecordList, { useRecordListWindow, type RecordListColumnDef, type RecordListQueryState } from "@/components/record-list";
import SidePanel from "@/components/side-panel";
import StateNotice from "@/components/state-notice";
import StatusBadge, { type StatusTone } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useIsMobile } from "@/components/ui/use-mobile";
import { cn } from "@/lib/cn";
import type { CheckInState } from "@/modules/coaching/checkin";
import type { Scope } from "@/modules/data-service/envelope";
import { parseCivilDate, serialiseCivilDate, type CivilDate } from "@/modules/time/civil";
import { CHECK_IN_STATE_COPY, COACHING_COPY } from "../copy";
import { useCheckIns } from "../hooks/use-coaching-reads";

// ---------------------------------------------------------------------------------------------
// The read's own shapes, taken from the read rather than restated
// ---------------------------------------------------------------------------------------------

/** The result the family's hook answers with, so a member the service adds, renames or removes fails to compile here instead of drifting into a second contract. */
type CheckInsResult = NonNullable<ReturnType<typeof useCheckIns>["data"]>;

/** The envelope itself: this page of check-ins, the page window the read executed and the limits in force. */
type CheckInsEnvelope = Extract<CheckInsResult, { readonly kind: "envelope" }>["envelope"];

/** One check-in as the read states it: its read state, its private autosave and its shared revision kept apart. */
type CheckInRow = CheckInsEnvelope["data"]["checkIns"][number];

/** The page window the read reports, counted from a zero index and capped at the family's ceiling. */
type CheckInPage = CheckInsEnvelope["data"]["page"];

/** Props of {@link CheckInList}. */
export interface CheckInListProps {
  /** The query state the surrounding route starts this list from — the window the address states — which the address owns from then on. */
  readonly initialQuery: RecordListQueryState;
  /** The exact authority these check-ins are read under; the service re-derives scope from it on every read. */
  readonly scope: Scope;
  /** The direction and language the surrounding document resolved, recorded on this region without re-rendering any stored value. */
  readonly locale: string;
  /** Told the identifier of the check-in whose detail was opened, for a route that wants to record the visit. */
  readonly onOpen?: (checkInId: string) => void;
}

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** The family's page sizes: 25 rows by default and 100 as the most one page may hold (AAP 0.8.7). The support lists' 50/200 belong to those surfaces and are not offered here. */
const PAGE_SIZES: readonly number[] = [25, 100];

const DEFAULT_PAGE_SIZE = 25;

/** The page the pager counts from. The read indexes its window from zero, so the two are mapped in one place below rather than at every call. */
const FIRST_PAGE = 1;

/** No row and no page is stated yet: the first read has not answered, so nothing stands in for it. */
const NO_ROWS: readonly CheckInRow[] = [];

/** The calendar-day prefix of a stored ISO instant, which this application records in UTC: the day a record is dated by, taken before any time of day. */
const STORED_DAY = /^(\d{4}-\d{2}-\d{2})(?:[T ]|$)/u;

/** The list states a heading, so every notice beneath it sits one level lower. */
const NOTICE_HEADING_LEVEL = 3;

const LOADING_LINES = 6;

const RETRY_LABEL = "Try again";

const LIST_LABEL = "Check-in history";

const ITEM_NOUN = "check-ins";

const OPEN_LABEL = "Open";

const DETAIL_TITLE = "Check-in";

const DETAIL_KIND = "Check-in";

const STATE_SR_PREFIX = "Check-in state";

const NO_DATE_RECORDED = "No date recorded";

const NOT_SHARED = "Not shared with a coach";

const MUTED_LINE_CLASS = "text-xs text-muted-foreground";

/** The column headings, plain strings because the list's own Columns menu reads each of them as the column's visible name. */
const COLUMN_LABELS = { date: "Date", questions: "Questions captured", state: "State", shared: "Shared" } as const;

/** The tone each read state carries. The word itself is always rendered beside it, so colour never carries the state alone. */
const STATE_TONE: Readonly<Record<CheckInState, StatusTone>> = { "private-draft": "muted", shared: "positive", withdrawn: "caution", unavailable: "danger" };

/** The two facts this list deliberately does not reproduce: the writing itself, and the zone every date is stated in. */
const WRITING_NOTE = "A check-in's writing is not reproduced in this list: a row states the day, the captured question set and whether a revision is shared, and the words themselves are read only in the check-in itself.";

const DATE_BASIS_NOTE = "Every date here is the calendar day in UTC, the zone this application's coaching records are dated in, and the exact recorded instant is attached to each one.";

/** What a row whose private draft and shared revision hold different text says about itself, so the two revisions are never read as one. */
const DRAFT_DIFFERS_NOTE = "Your private draft and the shared revision hold different text.";

// ---------------------------------------------------------------------------------------------
// Pure readings of the page window and of a stored instant
// ---------------------------------------------------------------------------------------------

/** The largest offered page size at or below a stated one, so the window the list asks for is a window its own pager can also state. */
function offeredPageSize(requested: number): number {
  if (!Number.isFinite(requested)) return DEFAULT_PAGE_SIZE;
  const stated = Math.trunc(requested);
  let offered = DEFAULT_PAGE_SIZE;
  for (const size of PAGE_SIZES) {
    if (size <= stated) offered = size;
  }
  return offered;
}

function offeredPage(requested: number): number {
  return Number.isFinite(requested) ? Math.max(FIRST_PAGE, Math.trunc(requested)) : FIRST_PAGE;
}

/** The calendar day a stored instant falls on, read back through the one civil-date parser rather than trusted as text. */
function civilDayOf(storedInstant: string): CivilDate | null {
  const written = STORED_DAY.exec(storedInstant);
  const day = written === null ? undefined : written[1];
  if (day === undefined) return null;
  const parsed = parseCivilDate(day);
  return parsed.status === "parsed" ? parsed.date : null;
}

/** The day as `YYYY-MM-DD`, or the stored value exactly as recorded when it does not read as a day, so nothing is guessed in its place. */
function dayTextOf(storedInstant: string): string {
  const day = civilDayOf(storedInstant);
  return day === null ? storedInstant : serialiseCivilDate(day);
}

/** The instant this check-in is dated by: the saved private draft's, or the shared revision's when no draft exists. */
function checkInInstantOf(row: CheckInRow): string | null {
  return row.privateDraft?.savedAt ?? row.shared?.sharedAt ?? null;
}

function checkInDayLabelOf(row: CheckInRow): string {
  const instant = checkInInstantOf(row);
  return instant === null ? NO_DATE_RECORDED : dayTextOf(instant);
}

/** One sentence naming the shared revision's state, written from the record rather than inferred from the badge above it. */
function sharingStatementOf(row: CheckInRow): string {
  const { shared } = row;
  if (shared === null) return "No shared revision: a coach reads nothing here yet.";
  const sharedOn = dayTextOf(shared.sharedAt);
  if (shared.withdrawnAt === null) return `Shared revision shared on ${sharedOn}.`;
  return `Shared revision shared on ${sharedOn} and withdrawn on ${dayTextOf(shared.withdrawnAt)}.`;
}

// ---------------------------------------------------------------------------------------------
// The cells
// ---------------------------------------------------------------------------------------------

/** The day this check-in is dated by, with the exact recorded instant attached as the element's machine-readable value. */
function CheckInDateCell({ row }: { readonly row: CheckInRow }): ReactElement {
  const instant = checkInInstantOf(row);
  if (instant === null) return <span className="text-muted-foreground">{NO_DATE_RECORDED}</span>;
  return (
    <time dateTime={instant} className="tabular-figures">
      <bdi>{dayTextOf(instant)}</bdi>
    </time>
  );
}

/** One captured question set and its size, stated in words so an absent question set reads as none rather than as a bare zero. */
function QuestionSetCount({ count, where }: { readonly count: number; readonly where: "draft" | "shared" }): ReactElement {
  const place = where === "draft" ? "the private draft" : "the shared revision";
  return (
    <span className={cn("min-w-0", count === 0 && MUTED_LINE_CLASS)}>
      {count === 0 ? (
        "No questions"
      ) : (
        <>
          <bdi className="tabular-figures">{count}</bdi> {count === 1 ? "question" : "questions"}
        </>
      )}{" "}
      in {place}
    </span>
  );
}

/** The captured question set of each revision the row holds. Both sizes are stated where both exist, because the shared revision is a snapshot and may hold a different set from the draft beside it. */
function QuestionSetsCell({ row }: { readonly row: CheckInRow }): ReactElement {
  const { privateDraft, shared } = row;
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      {privateDraft === null ? null : <QuestionSetCount count={privateDraft.questions.length} where="draft" />}
      {shared === null ? null : <QuestionSetCount count={shared.questions.length} where="shared" />}
      {privateDraft === null && shared === null ? <span className="text-muted-foreground">No captured question set</span> : null}
    </span>
  );
}

/** The row's read state as a word, with the one fact the badge cannot carry: whether the two revisions hold different text. */
function StateCell({ row }: { readonly row: CheckInRow }): ReactElement {
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <StatusBadge label={CHECK_IN_STATE_COPY[row.state].label} tone={STATE_TONE[row.state]} srPrefix={STATE_SR_PREFIX} />
      {row.draftAndSharedDiffer ? <span className={MUTED_LINE_CLASS}>{DRAFT_DIFFERS_NOTE}</span> : null}
    </span>
  );
}

/** When a revision is shared, and when it was withdrawn. A row that shares nothing says so rather than leaving the cell blank. */
function SharedCell({ row }: { readonly row: CheckInRow }): ReactElement {
  const { shared } = row;
  if (shared === null) return <span className="text-muted-foreground">{NOT_SHARED}</span>;
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <time dateTime={shared.sharedAt} className="tabular-figures">
        <bdi>{dayTextOf(shared.sharedAt)}</bdi>
      </time>
      {shared.withdrawnAt === null ? null : (
        <span className={MUTED_LINE_CLASS}>
          Withdrawn{" "}
          <time dateTime={shared.withdrawnAt} className="tabular-figures">
            <bdi>{dayTextOf(shared.withdrawnAt)}</bdi>
          </time>
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------------------------

/** The worker's check-in history, composed from the one list, pager and record-detail patterns: 25 rows a page by default and 100 at most, with each row's private draft and shared revision told apart and no writing reproduced. */
export default function CheckInList({ initialQuery, scope, locale, onOpen }: CheckInListProps): ReactElement {
  const isMobile = useIsMobile();
  // The address owns the window after the route seeds it, so a reader who opens a check-in and returns reopens the
  // page they left rather than the first one. No sort is held, because the read applies its own order and takes no
  // ordering parameter: a sort stated here would describe rows this surface never reordered. The page size is kept
  // to one the pager also offers, so the window asked for and the window displayed are the same window, and the
  // visible columns stay in this component because hiding a column never changes which records the read returned.
  const listWindow = useRecordListWindow({ page: offeredPage(initialQuery.page), pageSize: offeredPageSize(initialQuery.pageSize) });
  const setWindow = listWindow.setWindow;
  const [columnVisibility, setColumnVisibility] = useState<RecordListQueryState["columnVisibility"]>(initialQuery.columnVisibility);
  const queryState: RecordListQueryState = { sort: [], page: offeredPage(listWindow.page), pageSize: offeredPageSize(listWindow.pageSize), columnVisibility };
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The read counts its window from zero while the transport's page grammar admits a whole number of one
  // or more, so the first page states no page at all — the same window the read defaults to — and every
  // later page states its zero-based index. Mapping the two here keeps the rows returned, the caption and
  // the pager on one window.
  const readPage = queryState.page - FIRST_PAGE;
  const read = useCheckIns(scope, { ...(readPage === 0 ? {} : { page: readPage }), pageSize: queryState.pageSize });
  const result = read.data;
  const envelope = result !== undefined && result.kind === "envelope" ? result.envelope : undefined;
  const page: CheckInPage | undefined = envelope === undefined ? undefined : envelope.data.page;
  const rows: readonly CheckInRow[] = envelope === undefined ? NO_ROWS : envelope.data.checkIns;
  // The window the pager states is the window the read answered with, not the one requested: a page the
  // read clamped to its own last one is therefore described by the caption, the rows and the pager alike,
  // and no second state is kept beside the answer to say so.
  const listedQuery: RecordListQueryState = { sort: [], page: page === undefined ? queryState.page : page.index + FIRST_PAGE, pageSize: page === undefined ? queryState.pageSize : page.size, columnVisibility: queryState.columnVisibility };
  const selectedRow = useMemo(() => rows.find((row) => row.checkInId === selectedId) ?? null, [rows, selectedId]);
  const openCheckIn = useCallback(
    (checkInId: string) => {
      setSelectedId(checkInId);
      onOpen?.(checkInId);
    },
    [onOpen],
  );
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) setSelectedId(null);
  }, []);
  const handleQueryStateChange = useCallback(
    (next: RecordListQueryState) => {
      setColumnVisibility(next.columnVisibility);
      setWindow({ page: offeredPage(next.page), pageSize: offeredPageSize(next.pageSize) });
    },
    [setWindow],
  );
  const getRowId = useCallback((row: CheckInRow): string => row.checkInId, []);
  const columns = useMemo<ReadonlyArray<RecordListColumnDef<CheckInRow>>>(
    () => [
      { id: "date", header: COLUMN_LABELS.date, enableSorting: false, enableHiding: false, cell: (context) => <CheckInDateCell row={context.row.original} /> },
      { id: "questions", header: COLUMN_LABELS.questions, enableSorting: false, cell: (context) => <QuestionSetsCell row={context.row.original} /> },
      { id: "state", header: COLUMN_LABELS.state, enableSorting: false, enableHiding: false, cell: (context) => <StateCell row={context.row.original} /> },
      { id: "shared", header: COLUMN_LABELS.shared, enableSorting: false, cell: (context) => <SharedCell row={context.row.original} /> },
    ],
    [],
  );
  // The row action is the design system's Button, sized above the 24 CSS px floor, and its visible word is
  // the first thing its accessible name says so a voice command that names the control still matches it.
  const rowActions = useCallback(
    (row: CheckInRow): ReactElement => (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto max-w-full py-1 whitespace-normal"
        onClick={() => {
          openCheckIn(row.checkInId);
        }}
      >
        {OPEN_LABEL}
        <span className="sr-only">{` the check-in from ${checkInDayLabelOf(row)}`}</span>
      </Button>
    ),
    [openCheckIn],
  );
  const retry = {
    label: RETRY_LABEL,
    onClick: () => {
      void read.refetch();
    },
  };
  const detailSource = envelope === undefined ? null : envelope.source;
  function detailOf(row: CheckInRow | null): Omit<RecordDetailProps, "layout"> {
    if (row === null) return { identity: { displayName: "", kind: DETAIL_KIND } };
    const identity = { displayName: checkInDayLabelOf(row), secondaryName: sharingStatementOf(row), kind: DETAIL_KIND };
    const status = <StatusBadge label={CHECK_IN_STATE_COPY[row.state].label} tone={STATE_TONE[row.state]} srPrefix={STATE_SR_PREFIX} />;
    // A check-in whose own source could not be read is stated as an outage in the body rather than as a
    // record holding nothing, which is what an empty body would say.
    if (row.state === "unavailable" && detailSource !== null) return { identity, status, unavailable: { source: detailSource } };
    return { identity, status };
  }
  let content: ReactElement;
  if (read.isPending) {
    content = <StateNotice kind="loading" title={COACHING_COPY.checkIns.heading} headingLevel={NOTICE_HEADING_LEVEL} loadingLines={LOADING_LINES} />;
  } else if (result === undefined) {
    content = <StateNotice kind="unavailable" title={COACHING_COPY.checkIns.heading} description={COACHING_COPY.checkIns.unavailable} retry={retry} headingLevel={NOTICE_HEADING_LEVEL} />;
  } else if (result.kind === "denied") {
    // A denial states no count, title or size: the answer is the same whether or not anything exists in
    // the scope this session may not read.
    content = <StateNotice kind="denied" title={COACHING_COPY.checkIns.heading} reasonCode={result.denied.reasonCode} headingLevel={NOTICE_HEADING_LEVEL} />;
  } else if (result.kind === "unavailable") {
    content = <StateNotice kind="unavailable" title={COACHING_COPY.checkIns.heading} description={result.unavailable.guidance} source={result.unavailable.source} retry={retry} headingLevel={NOTICE_HEADING_LEVEL} />;
  } else if (result.kind === "refused") {
    content = <StateNotice kind="refused" title={COACHING_COPY.checkIns.heading} headingLevel={NOTICE_HEADING_LEVEL} />;
  } else if (envelope === undefined || page === undefined) {
    content = <StateNotice kind="unavailable" title={COACHING_COPY.checkIns.heading} description={COACHING_COPY.checkIns.unavailable} retry={retry} headingLevel={NOTICE_HEADING_LEVEL} />;
  } else if (page.total === 0) {
    // A genuine empty history rather than a failed read, with the family's own first step stated in words.
    content = <StateNotice kind="empty" title={COACHING_COPY.checkIns.heading} description={COACHING_COPY.checkIns.empty} headingLevel={NOTICE_HEADING_LEVEL} />;
  } else if (rows.length === 0) {
    // The read states a result but answered an empty window, so a served page is still on its way. An
    // empty table here would claim the history holds nothing.
    content = <StateNotice kind="loading" title={COACHING_COPY.checkIns.heading} headingLevel={NOTICE_HEADING_LEVEL} loadingLines={LOADING_LINES} />;
  } else {
    content = (
      <>
        <RecordList label={LIST_LABEL} columns={columns} rows={rows} rowCount={page.total} queryState={listedQuery} onQueryStateChange={handleQueryStateChange} getRowId={getRowId} rowActions={rowActions} itemNoun={ITEM_NOUN} pageSizeOptions={PAGE_SIZES} isLoading={read.isFetching} />
        <Separator />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="max-w-prose text-xs text-muted-foreground text-pretty wrap-anywhere">{WRITING_NOTE}</p>
          <p className="max-w-prose text-xs text-muted-foreground text-pretty wrap-anywhere">{DATE_BASIS_NOTE}</p>
        </div>
      </>
    );
  }
  return (
    <section data-slot="check-in-list" data-interface-locale={locale} className="flex min-w-0 flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="font-heading text-lg font-semibold text-balance">{COACHING_COPY.checkIns.heading}</h2>
          </CardTitle>
          <CardDescription>{COACHING_COPY.checkIns.purpose}</CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-3">{content}</CardContent>
      </Card>
      {/* Always mounted so the panel can return focus to the row that opened it: a panel unmounted at the
          moment it closes would strand focus on the document instead. */}
      <SidePanel open={selectedRow !== null} onOpenChange={handleOpenChange} variant={isMobile ? "phone" : "desktop"} title={selectedRow === null ? DETAIL_TITLE : `${DETAIL_TITLE}, ${checkInDayLabelOf(selectedRow)}`} detail={detailOf(selectedRow)} />
    </section>
  );
}
