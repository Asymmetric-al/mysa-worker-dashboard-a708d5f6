"use client";
import Link from "next/link";
import { useCallback, useId, useMemo, useState, type ReactElement } from "react";
import RecordList, { useRecordListWindow, type RecordListColumnDef, type RecordListQueryState } from "@/components/record-list";
import StateNotice from "@/components/state-notice";
import StatusBadge, { COACHING_STATUS, statusBadgeProps } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { MODULE_KEYS, type GrantLifecycleState, type ModuleKey } from "@/modules/coaching/grant";
import type { Scope } from "@/modules/data-service/envelope";
import { COACHING_COPY, GRANT_STATE_COPY, MODULE_COPY } from "../copy";
import { useCoachPortfolio } from "../hooks/use-coaching";
import { Panel } from "./panel";
type PortfolioPayload = Extract<NonNullable<ReturnType<typeof useCoachPortfolio>["data"]>, { readonly kind: "envelope" }>["envelope"]["data"];
type PortfolioSubject = PortfolioPayload["subjects"][number];
type CoachPortfolioProps = { readonly initialQuery: RecordListQueryState; readonly scope: Scope; readonly locale: string; readonly onOpen?: (subjectId: string) => void };
const COACHING_DEFAULT_PAGE_SIZE = 25;
const COACHING_MAX_PAGE_SIZE = 100;
const COACHING_PAGE_SIZES: readonly number[] = [COACHING_DEFAULT_PAGE_SIZE, COACHING_MAX_PAGE_SIZE];
const FIRST_PAGE = 1;
const RETRY_LABEL = "Try again";
const COLUMN_LABELS = { worker: "Worker", ministry: "Ministry", modules: "Shared with you", access: "Access", ends: "Access ends" } as const;
const MUTED_TEXT_CLASS = "type-supporting text-pretty";
const IDENTITY_STATEMENT =
  "A row names the worker by the identity this read reports and by nothing else: a matching name, address or email establishes neither identity nor authority. No private note, check-in answer, task description, amount or donor appears on this page, and no relationship is compared with another.";
function windowOf<T>(items: readonly T[], page: number, pageSize: number): { readonly items: readonly T[]; readonly page: number } {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Number.isFinite(page) ? Math.min(Math.max(FIRST_PAGE, Math.trunc(page)), pageCount) : FIRST_PAGE;
  const firstIndex = (current - FIRST_PAGE) * pageSize;
  return { items: items.slice(firstIndex, firstIndex + pageSize), page: current };
}
const familyPageSize = (stated: number): number => (stated === COACHING_MAX_PAGE_SIZE ? COACHING_MAX_PAGE_SIZE : COACHING_DEFAULT_PAGE_SIZE);
function moduleKeysOf(subject: PortfolioSubject): readonly ModuleKey[] {
  const admitted = new Set(subject.admittedModules.map((entry) => entry.module));
  return MODULE_KEYS.filter((key) => admitted.has(key));
}
const accessWordOf = (subject: PortfolioSubject): GrantLifecycleState => (subject.duration.openAtRead ? "active" : "expired");
const RIGHT_TO_LEFT_PRIMARY_SUBTAGS: ReadonlySet<string> = new Set(["ar", "arc", "ckb", "dv", "fa", "he", "ks", "ku", "ps", "sd", "ug", "ur", "yi"]);
function directionOfLocale(locale: string): "ltr" | "rtl" {
  const primary = locale.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return RIGHT_TO_LEFT_PRIMARY_SUBTAGS.has(primary) ? "rtl" : "ltr";
}
const subjectHref = (subjectId: string): string => `/coaching/coach/${encodeURIComponent(subjectId)}`;
const SubjectCell = ({ subject, onOpen }: { readonly subject: PortfolioSubject; readonly onOpen: ((subjectId: string) => void) | undefined }): ReactElement => (
  <Link href={subjectHref(subject.grantId)} className={"inline-flex min-h-6 items-center rounded-sm font-medium inline-link focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"} onClick={() => onOpen?.(subject.grantId)}>
    <bdi className="mono-identifier">{subject.workerPrincipalId}</bdi>
  </Link>
);
function ModulesCell({ subject }: { readonly subject: PortfolioSubject }): ReactElement {
  const keys = moduleKeysOf(subject);
  if (keys.length === 0) return <span className={MUTED_TEXT_CLASS}>{"No module is switched on for this relationship yet, so nothing is readable under it."}</span>;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {keys.map((key) => (
        <Badge key={key} variant="secondary" className={"h-auto max-w-full whitespace-normal"}>
          <bdi>{MODULE_COPY[key].name}</bdi>
        </Badge>
      ))}
    </span>
  );
}
function AccessCell({ subject }: { readonly subject: PortfolioSubject }): ReactElement {
  const state = accessWordOf(subject);
  const copy = GRANT_STATE_COPY[state];
  return <StatusBadge label={copy.label} tone={statusBadgeProps(COACHING_STATUS, state).tone} srPrefix={"Access"} />;
}
function AccessEndsCell({ subject }: { readonly subject: PortfolioSubject }): ReactElement {
  const { duration } = subject;
  if (duration.boundInstant === null) return <span className={MUTED_TEXT_CLASS}>{"This relationship reports no end instant, so this row states none."}</span>;
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <bdi className="mono-identifier">{duration.boundInstant}</bdi>
      {duration.frozenZone === null ? null : (
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-1 text-xs text-muted-foreground">
          <span>In</span>
          <bdi className="mono-identifier">{duration.frozenZone}</bdi>
        </span>
      )}
      {duration.shareThroughDate === null ? null : (
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-1 text-xs text-muted-foreground">
          <span>Shared through</span>
          <bdi className="mono-identifier">{duration.shareThroughDate}</bdi>
        </span>
      )}
      {duration.boundedBy === "source" ? <span className="text-xs text-pretty text-muted-foreground">{"An end set earlier by the source decides this one."}</span> : null}
    </span>
  );
}
export default function CoachPortfolio({ initialQuery, scope, locale, onOpen }: CoachPortfolioProps): ReactElement {
  const headingId = useId();
  const heading = COACHING_COPY.coachPortfolio.heading;
  const portfolio = useCoachPortfolio(scope);
  // The address owns the page window, so a coach who opens a relationship and comes back reads the page they left rather than the first one. No ordering is held, because this read applies its own and takes no ordering parameter, and the visible columns stay in this component, because hiding one never changes which relationships the read authorised.
  const listWindow = useRecordListWindow({ page: initialQuery.page, pageSize: familyPageSize(initialQuery.pageSize) });
  const setWindow = listWindow.setWindow;
  const [columnVisibility, setColumnVisibility] = useState<RecordListQueryState["columnVisibility"]>(initialQuery.columnVisibility);
  const queryState: RecordListQueryState = { sort: [], page: Math.max(FIRST_PAGE, listWindow.page), pageSize: familyPageSize(listWindow.pageSize), columnVisibility };
  const handleQueryStateChange = useCallback(
    (next: RecordListQueryState) => {
      setColumnVisibility(next.columnVisibility);
      setWindow({ page: Math.max(FIRST_PAGE, next.page), pageSize: familyPageSize(next.pageSize) });
    },
    [setWindow],
  );
  const columns = useMemo<ReadonlyArray<RecordListColumnDef<PortfolioSubject>>>(
    () => [
      { id: "worker", header: COLUMN_LABELS.worker, enableSorting: false, enableHiding: false, cell: (context) => <SubjectCell subject={context.row.original} onOpen={onOpen} /> },
      { id: "ministry", header: COLUMN_LABELS.ministry, enableSorting: false, cell: (context) => <bdi className="mono-identifier">{context.row.original.ministryId}</bdi> },
      { id: "modules", header: COLUMN_LABELS.modules, enableSorting: false, cell: (context) => <ModulesCell subject={context.row.original} /> },
      { id: "access", header: COLUMN_LABELS.access, enableSorting: false, cell: (context) => <AccessCell subject={context.row.original} /> },
      { id: "ends", header: COLUMN_LABELS.ends, enableSorting: false, cell: (context) => <AccessEndsCell subject={context.row.original} /> },
    ],
    [onOpen],
  );
  const retry = {
    label: RETRY_LABEL,
    onClick: () => {
      void portfolio.refetch();
    },
  };
  const read = portfolio.data;
  let content: ReactElement;
  if (portfolio.isPending) {
    content = <StateNotice kind="loading" title={heading} headingLevel={3} loadingLines={4} />;
  } else if (read === undefined) {
    content = <StateNotice kind="unavailable" title={heading} retry={retry} headingLevel={3} />;
  } else if (read.kind === "denied") {
    content = <StateNotice kind="denied" title={heading} reasonCode={read.denied.reasonCode} headingLevel={3} />;
  } else if (read.kind === "unavailable") {
    content = <StateNotice kind="unavailable" title={heading} description={read.unavailable.guidance} source={read.unavailable.source} retry={retry} headingLevel={3} />;
  } else if (read.kind === "refused") {
    content = <StateNotice kind="refused" title={heading} headingLevel={3} />;
  } else if (read.envelope.data.holdsNoSubjects) {
    content = <StateNotice kind="empty" title={heading} description={COACHING_COPY.coachPortfolio.empty} headingLevel={3} />;
  } else {
    const subjects = read.envelope.data.subjects;
    const visiblePage = windowOf(subjects, queryState.page, queryState.pageSize);
    content = (
      <>
        <p className="max-w-prose type-supporting text-pretty">{"Each relationship is listed by the ministry it covers and then by the grant's own identity, in the order this read answers with: nothing on this page re-orders, narrows or adds the relationships together."}</p>
        <RecordList
          label={heading}
          columns={columns}
          rows={visiblePage.items}
          rowCount={subjects.length}
          queryState={{ sort: [], page: visiblePage.page, pageSize: queryState.pageSize, columnVisibility: queryState.columnVisibility }}
          onQueryStateChange={handleQueryStateChange}
          getRowId={(subject) => subject.grantId}
          itemNoun={"relationships"}
          pageSizeOptions={COACHING_PAGE_SIZES}
        />
        <p className="max-w-prose text-xs text-pretty text-muted-foreground">{IDENTITY_STATEMENT}</p>
      </>
    );
  }
  return (
    <section aria-labelledby={headingId} dir={directionOfLocale(locale)} className="min-w-0">
      <Panel titleId={headingId} headingLevel={2} title={heading} description={COACHING_COPY.coachPortfolio.purpose} cardClassName="min-w-0" titleClassName="text-pretty" contentClassName="flex min-w-0 flex-col gap-4">
        <p className="max-w-prose type-supporting text-pretty">{"This view is read-only: a coach can read what the worker switched on, and cannot edit, assign, remind, complete, reopen, export or impersonate anything. Stopping a share never recalls what was already read."}</p>
        <Separator />
        {content}
      </Panel>
    </section>
  );
}
