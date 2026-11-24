"use client";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import type { RecordDetailProps } from "@/components/record-detail";
import RecordList, { useRecordListWindow, type RecordListColumnDef, type RecordListQueryState } from "@/components/record-list";
import SidePanel from "@/components/side-panel";
import StateNotice from "@/components/state-notice";
import StatusBadge, { type StatusTone } from "@/components/status-badge";
import { Button, BUTTON_WRAP_CLASS } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useIsMobile } from "@/components/ui/use-mobile";
import { cn } from "@/lib/cn";
import type { CheckInState } from "@/modules/coaching/checkin";
import type { Scope } from "@/modules/data-service/envelope";
import { CHECK_IN_STATE_COPY, COACHING_COPY } from "../copy";
import { useCheckIns } from "../hooks/use-coaching";
import { Panel } from "./panel";
import { storedDayText } from "./sharing-summary";
type CheckInsEnvelope = Extract<NonNullable<ReturnType<typeof useCheckIns>["data"]>, { readonly kind: "envelope" }>["envelope"];
type CheckInRow = CheckInsEnvelope["data"]["checkIns"][number];
export type CheckInListProps = { readonly initialQuery: RecordListQueryState; readonly scope: Scope; readonly locale: string; readonly onOpen?: (checkInId: string) => void };
const PAGE_SIZES: readonly number[] = [25, 100];
const DEFAULT_PAGE_SIZE = 25;
const FIRST_PAGE = 1;
const NO_ROWS: readonly CheckInRow[] = [];
const NOTICE_HEADING_LEVEL = 3;
const LOADING_LINES = 6;
const DETAIL_TITLE = "Check-in";
const DETAIL_KIND = "Check-in";
const STATE_SR_PREFIX = "Check-in state";
const NO_DATE_RECORDED = "No date recorded";
const MUTED_LINE_CLASS = "text-xs text-muted-foreground";
const COLUMN_LABELS = { date: "Date", questions: "Questions captured", state: "State", shared: "Shared" } as const;
const STATE_TONE: Readonly<Record<CheckInState, StatusTone>> = { "private-draft": "muted", shared: "positive", withdrawn: "caution", unavailable: "danger" };
function offeredPageSize(requested: number): number {
  if (!Number.isFinite(requested)) return DEFAULT_PAGE_SIZE;
  const stated = Math.trunc(requested);
  let offered = DEFAULT_PAGE_SIZE;
  for (const size of PAGE_SIZES) if (size <= stated) offered = size;
  return offered;
}
const offeredPage = (requested: number): number => (Number.isFinite(requested) ? Math.max(FIRST_PAGE, Math.trunc(requested)) : FIRST_PAGE);
// The day a check-in is filed under is the day its question set was captured, which the private save and the share both keep: the draft's own saved instant moves every time the worker writes, so dating the row by it would re-date the check-in on every autosave.
const checkInInstantOf = (row: CheckInRow): string | null => row.privateDraft?.questionsCapturedAt ?? row.shared?.questionsCapturedAt ?? null;
function checkInDayLabelOf(row: CheckInRow): string {
  const instant = checkInInstantOf(row);
  return instant === null ? NO_DATE_RECORDED : storedDayText(instant);
}
function sharingStatementOf(row: CheckInRow): string {
  const { shared } = row;
  if (shared === null) return "No shared revision: a coach reads nothing here yet.";
  const sharedOn = storedDayText(shared.sharedAt);
  if (shared.withdrawnAt === null) return `Shared revision shared on ${sharedOn}.`;
  return `Shared revision shared on ${sharedOn} and withdrawn on ${storedDayText(shared.withdrawnAt)}.`;
}
function CheckInDateCell({ row }: { readonly row: CheckInRow }): ReactElement {
  const instant = checkInInstantOf(row);
  if (instant === null) return <span className="text-muted-foreground">{NO_DATE_RECORDED}</span>;
  return (
    <time dateTime={instant} className="tabular-figures">
      <bdi>{storedDayText(instant)}</bdi>
    </time>
  );
}
const QuestionSetCount = ({ count, where }: { readonly count: number; readonly where: "draft" | "shared" }): ReactElement => (
  <span className={cn("min-w-0", count === 0 && MUTED_LINE_CLASS)}>
    {count === 0 ? (
      "No questions"
    ) : (
      <>
        <bdi className="tabular-figures">{count}</bdi> {count === 1 ? "question" : "questions"}{" "}
      </>
    )}{" "}
    in {where === "draft" ? "the private draft" : "the shared revision"}
  </span>
);
const QuestionSetsCell = ({ row }: { readonly row: CheckInRow }): ReactElement => (
  <span className="flex min-w-0 flex-col gap-0.5">
    {row.privateDraft === null ? null : <QuestionSetCount count={row.privateDraft.questions.length} where="draft" />}
    {row.shared === null ? null : <QuestionSetCount count={row.shared.questions.length} where="shared" />}
    {row.privateDraft === null && row.shared === null ? <span className="text-muted-foreground">No captured question set</span> : null}
  </span>
);
const StateCell = ({ row }: { readonly row: CheckInRow }): ReactElement => (
  <span className="flex min-w-0 flex-col gap-1">
    <StatusBadge label={CHECK_IN_STATE_COPY[row.state].label} tone={STATE_TONE[row.state]} srPrefix={STATE_SR_PREFIX} />
    {row.draftAndSharedDiffer ? <span className={MUTED_LINE_CLASS}>{"Your private draft and the shared revision hold different text."}</span> : null}
  </span>
);
function SharedCell({ row }: { readonly row: CheckInRow }): ReactElement {
  const { shared } = row;
  if (shared === null) return <span className="text-muted-foreground">{"Not shared with a coach"}</span>;
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <time dateTime={shared.sharedAt} className="tabular-figures">
        <bdi>{storedDayText(shared.sharedAt)}</bdi>
      </time>
      {shared.withdrawnAt === null ? null : (
        <span className={MUTED_LINE_CLASS}>
          Withdrawn{" "}
          <time dateTime={shared.withdrawnAt} className="tabular-figures">
            <bdi>{storedDayText(shared.withdrawnAt)}</bdi>
          </time>
        </span>
      )}
    </span>
  );
}
export default function CheckInList({ initialQuery, scope, locale, onOpen }: CheckInListProps): ReactElement {
  const isMobile = useIsMobile();
  // The address owns the window after the route seeds it, so a reader who opens a check-in and returns reopens the page they left rather than the first one. No sort is held, because the read applies its own order and takes no ordering parameter, and the visible columns stay in this component, because hiding one never changes which records the read returned.
  const listWindow = useRecordListWindow({ page: offeredPage(initialQuery.page), pageSize: offeredPageSize(initialQuery.pageSize) });
  const setWindow = listWindow.setWindow;
  const [columnVisibility, setColumnVisibility] = useState<RecordListQueryState["columnVisibility"]>(initialQuery.columnVisibility);
  const queryState: RecordListQueryState = { sort: [], page: offeredPage(listWindow.page), pageSize: offeredPageSize(listWindow.pageSize), columnVisibility };
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const readPage = queryState.page - FIRST_PAGE;
  const read = useCheckIns(scope, { ...(readPage === 0 ? {} : { page: readPage }), pageSize: queryState.pageSize });
  const result = read.data;
  const envelope = result !== undefined && result.kind === "envelope" ? result.envelope : undefined;
  const page: CheckInsEnvelope["data"]["page"] | undefined = envelope === undefined ? undefined : envelope.data.page;
  const rows: readonly CheckInRow[] = envelope === undefined ? NO_ROWS : envelope.data.checkIns;
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
  const rowActions = useCallback(
    (row: CheckInRow): ReactElement => (
      <Button type="button" variant="ghost" size="sm" className={BUTTON_WRAP_CLASS} onClick={() => openCheckIn(row.checkInId)}>
        {"Open"}
        <span className="sr-only">{` the check-in from ${checkInDayLabelOf(row)}`}</span>
      </Button>
    ),
    [openCheckIn],
  );
  const retry = {
    label: "Try again",
    onClick: () => {
      void read.refetch();
    },
  };
  const detailSource = envelope === undefined ? null : envelope.source;
  function detailOf(row: CheckInRow | null): Omit<RecordDetailProps, "layout"> {
    if (row === null) return { identity: { displayName: "", kind: DETAIL_KIND } };
    const identity = { displayName: checkInDayLabelOf(row), secondaryName: sharingStatementOf(row), kind: DETAIL_KIND };
    const status = <StatusBadge label={CHECK_IN_STATE_COPY[row.state].label} tone={STATE_TONE[row.state]} srPrefix={STATE_SR_PREFIX} />;
    if (row.state === "unavailable" && detailSource !== null) return { identity, status, unavailable: { source: detailSource } };
    return { identity, status };
  }
  const content = read.isPending ? (
    <StateNotice kind="loading" title={COACHING_COPY.checkIns.heading} headingLevel={NOTICE_HEADING_LEVEL} loadingLines={LOADING_LINES} />
  ) : result === undefined ? (
    <StateNotice kind="unavailable" title={COACHING_COPY.checkIns.heading} description={COACHING_COPY.checkIns.unavailable} retry={retry} headingLevel={NOTICE_HEADING_LEVEL} />
  ) : result.kind === "denied" ? (
    <StateNotice kind="denied" title={COACHING_COPY.checkIns.heading} reasonCode={result.denied.reasonCode} headingLevel={NOTICE_HEADING_LEVEL} />
  ) : result.kind === "unavailable" ? (
    <StateNotice kind="unavailable" title={COACHING_COPY.checkIns.heading} description={result.unavailable.guidance} source={result.unavailable.source} retry={retry} headingLevel={NOTICE_HEADING_LEVEL} />
  ) : result.kind === "refused" ? (
    <StateNotice kind="refused" title={COACHING_COPY.checkIns.heading} headingLevel={NOTICE_HEADING_LEVEL} />
  ) : envelope === undefined || page === undefined ? (
    <StateNotice kind="unavailable" title={COACHING_COPY.checkIns.heading} description={COACHING_COPY.checkIns.unavailable} retry={retry} headingLevel={NOTICE_HEADING_LEVEL} />
  ) : page.total === 0 ? (
    <StateNotice kind="empty" title={COACHING_COPY.checkIns.heading} description={COACHING_COPY.checkIns.empty} headingLevel={NOTICE_HEADING_LEVEL} />
  ) : rows.length === 0 ? (
    <StateNotice kind="loading" title={COACHING_COPY.checkIns.heading} headingLevel={NOTICE_HEADING_LEVEL} loadingLines={LOADING_LINES} />
  ) : (
    <>
      <RecordList label={"Check-in history"} columns={columns} rows={rows} rowCount={page.total} queryState={listedQuery} onQueryStateChange={handleQueryStateChange} getRowId={getRowId} rowActions={rowActions} itemNoun={"check-ins"} pageSizeOptions={PAGE_SIZES} isLoading={read.isFetching} locale={locale} />
      <Separator />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="max-w-prose text-xs text-muted-foreground text-pretty wrap-anywhere">{"A check-in's writing is not reproduced in this list: a row states the day, the captured question set and whether a revision is shared, and the words themselves are read only in the check-in itself."}</p>
        <p className="max-w-prose text-xs text-muted-foreground text-pretty wrap-anywhere">{"Every date here is the calendar day in UTC, the zone this application's coaching records are dated in, and the exact recorded instant is attached to each one."}</p>
      </div>
    </>
  );
  return (
    <section data-slot="check-in-list" data-interface-locale={locale} className="flex min-w-0 flex-col gap-4">
      <Panel {...{ headingLevel: 2, titleClassName: "text-balance", title: COACHING_COPY.checkIns.heading, description: COACHING_COPY.checkIns.purpose, contentClassName: "flex min-w-0 flex-col gap-3" }}>{content}</Panel>
      <SidePanel open={selectedRow !== null} onOpenChange={handleOpenChange} variant={isMobile ? "phone" : "desktop"} title={selectedRow === null ? DETAIL_TITLE : `${DETAIL_TITLE}, ${checkInDayLabelOf(selectedRow)}`} detail={detailOf(selectedRow)} />
    </section>
  );
}
