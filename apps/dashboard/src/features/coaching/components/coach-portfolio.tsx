"use client";
/**
 * The coach's read-only portfolio: the relationships the grant read actually admits — it authorises before it
 * enumerates, so a relationship this coach does not hold never reaches this component — listed with the coaching
 * family's 25 and 100 row page sizes and nothing else.
 */
import Link from "next/link";
import { useCallback, useId, useMemo, useState, type ReactElement } from "react";
import RecordList, { useRecordListWindow, type RecordListColumnDef, type RecordListQueryState } from "@/components/record-list";
import StateNotice from "@/components/state-notice";
import StatusBadge, { COACHING_STATUS, statusBadgeProps } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { MODULE_KEYS, type GrantLifecycleState, type ModuleKey } from "@/modules/coaching/grant";
import type { Scope } from "@/modules/data-service/envelope";
import { COACHING_COPY, GRANT_STATE_COPY, MODULE_COPY } from "../copy";
import { useCoachPortfolio } from "../hooks/use-coaching-reads";
/**
 * The read's own payload, taken from the hook that transports it rather than restated here, so a member the service
 * renames or removes fails to compile at this file instead of drifting into a second contract.
 */
type PortfolioPayload = Extract<NonNullable<ReturnType<typeof useCoachPortfolio>["data"]>, { readonly kind: "envelope" }>["envelope"]["data"];
/** One relationship as the read reports it: an opaque grant, the worker it names, the ministry it covers, the frozen duration and the modules switched on. */
type PortfolioSubject = PortfolioPayload["subjects"][number];
/** The window the surrounding route starts this surface from — the one the address states — and the visible columns it starts with. The address owns the window from then on; the columns are the surface's own. */
interface CoachPortfolioProps {
  readonly initialQuery: RecordListQueryState;
  /** The exact authority this read runs under; the service re-derives the session's scope on every read. */
  readonly scope: Scope;
  /** The locale the route composed this surface for, which states the direction it is read in. */
  readonly locale: string;
  /** Notified when a row is chosen, so a host may route the same relationship; the row's link stays the path to the job. */
  readonly onOpen?: (subjectId: string) => void;
}
/** The coaching family's list sizes: 25 rows by default and a cap of 100 (AAP 0.8.7), offered to the pager as the only sizes this surface states. */
const COACHING_DEFAULT_PAGE_SIZE = 25;
const COACHING_MAX_PAGE_SIZE = 100;
const COACHING_PAGE_SIZES: readonly number[] = [COACHING_DEFAULT_PAGE_SIZE, COACHING_MAX_PAGE_SIZE];
const FIRST_PAGE = 1;
const ITEM_NOUN = "relationships";
/** The route prefix a row links into, kept in one place so the list and the detail stay one address family. */
const SUBJECT_ROUTE_PREFIX = "/coaching/coach";
const RETRY_LABEL = "Try again";
const ACCESS_SR_PREFIX = "Access";
const COLUMN_LABELS = { worker: "Worker", ministry: "Ministry", modules: "Shared with you", access: "Access", ends: "Access ends" } as const;
const ROW_LINK_CLASS = "rounded-sm font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const MUTED_TEXT_CLASS = "text-sm text-pretty text-muted-foreground";
/** Module words wrap inside the cell instead of widening the table: at 320 CSS px a row must reflow rather than scroll the page. */
const MODULE_BADGE_CLASS = "h-auto max-w-full whitespace-normal";
const NO_MODULES_STATEMENT = "No module is switched on for this relationship yet, so nothing is readable under it.";
const NO_END_STATEMENT = "This relationship reports no end instant, so this row states none.";
const SOURCE_LIMIT_NOTE = "An end set earlier by the source decides this one.";
const READ_ONLY_STATEMENT = "This view is read-only: a coach can read what the worker switched on, and cannot edit, assign, remind, complete, reopen, export or impersonate anything. Stopping a share never recalls what was already read.";
const ORDER_STATEMENT = "Each relationship is listed by the ministry it covers and then by the grant's own identity, in the order this read answers with: nothing on this page re-orders, narrows or adds the relationships together.";
const IDENTITY_STATEMENT =
  "A row names the worker by the identity this read reports and by nothing else: a matching name, address or email establishes neither identity nor authority. No private note, check-in answer, task description, amount or donor appears on this page, and no relationship is compared with another.";
/** A page window over the records a read already authorised and ordered: the total stays the read's own count, and nothing is re-ordered or narrowed here. */
function windowOf<T>(items: readonly T[], page: number, pageSize: number): { readonly items: readonly T[]; readonly page: number } {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Number.isFinite(page) ? Math.min(Math.max(FIRST_PAGE, Math.trunc(page)), pageCount) : FIRST_PAGE;
  const firstIndex = (current - FIRST_PAGE) * pageSize;
  return { items: items.slice(firstIndex, firstIndex + pageSize), page: current };
}
/** The family's own row sizes: a stated size outside them is read as the default rather than sent to a pager that would clamp it silently. */
function familyPageSize(stated: number): number {
  return stated === COACHING_MAX_PAGE_SIZE ? COACHING_MAX_PAGE_SIZE : COACHING_DEFAULT_PAGE_SIZE;
}
/** The modules a relationship admits, in the domain's own order, so two rows read the same way. */
function moduleKeysOf(subject: PortfolioSubject): readonly ModuleKey[] {
  const admitted = new Set(subject.admittedModules.map((entry) => entry.module));
  return MODULE_KEYS.filter((key) => admitted.has(key));
}
/** The lifecycle word the envelope itself supports: it reports whether its frozen bound had been reached at read time, and this read admits only open relationships. */
function accessWordOf(subject: PortfolioSubject): GrantLifecycleState {
  return subject.duration.openAtRead ? "active" : "expired";
}
const RIGHT_TO_LEFT_PRIMARY_SUBTAGS: ReadonlySet<string> = new Set(["ar", "arc", "ckb", "dv", "fa", "he", "ks", "ku", "ps", "sd", "ug", "ur", "yi"]);
/** Direction is a property of the locale the route composed this surface for, stated on the block rather than in CSS, so logical spacing and mixed-direction values keep their order. */
function directionOfLocale(locale: string): "ltr" | "rtl" {
  const primary = locale.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return RIGHT_TO_LEFT_PRIMARY_SUBTAGS.has(primary) ? "rtl" : "ltr";
}
function subjectHref(subjectId: string): string {
  return `${SUBJECT_ROUTE_PREFIX}/${encodeURIComponent(subjectId)}`;
}
function SubjectCell({ subject, onOpen }: { readonly subject: PortfolioSubject; readonly onOpen: ((subjectId: string) => void) | undefined }): ReactElement {
  return (
    <Link
      href={subjectHref(subject.grantId)}
      className={ROW_LINK_CLASS}
      onClick={() => {
        // The link is the real path to the job; a host that also wants to observe the choice is told which relationship was chosen, and navigation is never left to a handler alone.
        onOpen?.(subject.grantId);
      }}
    >
      {/* The identity is data from another system: isolated, so a mixed-direction neighbour can neither reorder it nor be reordered by it. */}
      <bdi className="mono-identifier">{subject.workerPrincipalId}</bdi>
    </Link>
  );
}
function ModulesCell({ subject }: { readonly subject: PortfolioSubject }): ReactElement {
  const keys = moduleKeysOf(subject);
  if (keys.length === 0) {
    return <span className={MUTED_TEXT_CLASS}>{NO_MODULES_STATEMENT}</span>;
  }
  // Only the modules switched on are named. An absent module is never counted, listed or hinted at, so the presence of a word is the whole of what this cell states.
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {keys.map((key) => (
        <Badge key={key} variant="secondary" className={MODULE_BADGE_CLASS}>
          <bdi>{MODULE_COPY[key].name}</bdi>
        </Badge>
      ))}
    </span>
  );
}
function AccessCell({ subject }: { readonly subject: PortfolioSubject }): ReactElement {
  const state = accessWordOf(subject);
  const copy = GRANT_STATE_COPY[state];
  return <StatusBadge label={copy.label} tone={statusBadgeProps(COACHING_STATUS, state).tone} srPrefix={ACCESS_SR_PREFIX} />;
}
function AccessEndsCell({ subject }: { readonly subject: PortfolioSubject }): ReactElement {
  const { duration } = subject;
  if (duration.boundInstant === null) {
    // An absent end is stated as absent rather than left blank, because a blank line would read as an unlimited share.
    return <span className={MUTED_TEXT_CLASS}>{NO_END_STATEMENT}</span>;
  }
  return (
    <span className="flex min-w-0 flex-col gap-1">
      {/* The nominal date and the resolved instant are reported as the envelope states them: neither is derived from the other here, and neither is compared with any other row. */}
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
      {duration.boundedBy === "source" ? <span className="text-xs text-pretty text-muted-foreground">{SOURCE_LIMIT_NOTE}</span> : null}
    </span>
  );
}
export default function CoachPortfolio({ initialQuery, scope, locale, onOpen }: CoachPortfolioProps): ReactElement {
  const headingId = useId();
  const heading = COACHING_COPY.coachPortfolio.heading;
  // The family's read: the hook owns the cache key, the transport and the refusal branches, so this component never builds a query of its own.
  const portfolio = useCoachPortfolio(scope);
  const [columnVisibility, setColumnVisibility] = useState<RecordListQueryState["columnVisibility"]>(initialQuery.columnVisibility);
  // The address owns the page window, so a coach who opens a relationship and comes back reads the page they left
  // rather than the first one. No ordering is held, because this read applies its own and takes no ordering
  // parameter, and the visible columns stay in this component because hiding one never changes which relationships
  // the read authorised.
  const listWindow = useRecordListWindow({ page: initialQuery.page, pageSize: familyPageSize(initialQuery.pageSize) });
  const setWindow = listWindow.setWindow;
  const queryState: RecordListQueryState = { sort: [], page: listWindow.page, pageSize: familyPageSize(listWindow.pageSize), columnVisibility };
  const handleQueryStateChange = useCallback(
    (next: RecordListQueryState) => {
      // The page and the row size are written to the address, and the visible columns are kept here; an ordering is
      // never kept, because this read applies its own and takes no ordering parameter.
      setColumnVisibility(next.columnVisibility);
      setWindow({ page: next.page, pageSize: familyPageSize(next.pageSize) });
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
    // The read has not answered yet, and its skeleton rows state that rather than an empty portfolio.
    content = <StateNotice kind="loading" title={heading} headingLevel={3} loadingLines={4} />;
  } else if (read === undefined) {
    // No result arrived at all, which is an outage with a retry rather than a portfolio holding nothing.
    content = <StateNotice kind="unavailable" title={heading} retry={retry} headingLevel={3} />;
  } else if (read.kind === "denied") {
    // The answer is the same whether or not a relationship exists in a scope this session may not read: no count, no identity, no ministry and no size.
    content = <StateNotice kind="denied" title={heading} reasonCode={read.denied.reasonCode} headingLevel={3} />;
  } else if (read.kind === "unavailable") {
    // The refusal's own guidance and source are shown, so the outage names what failed and what to do about it.
    content = <StateNotice kind="unavailable" title={heading} description={read.unavailable.guidance} source={read.unavailable.source} retry={retry} headingLevel={3} />;
  } else if (read.kind === "refused") {
    // The request itself is the answer, so it is stated as a refusal rather than shown as an empty portfolio.
    content = <StateNotice kind="refused" title={heading} headingLevel={3} />;
  } else if (read.envelope.data.holdsNoSubjects) {
    // The read's own empty answer, which is distinct from a denial and from an outage.
    content = <StateNotice kind="empty" title={heading} description={COACHING_COPY.coachPortfolio.empty} headingLevel={3} />;
  } else {
    const subjects = read.envelope.data.subjects;
    const visiblePage = windowOf(subjects, queryState.page, queryState.pageSize);
    content = (
      <>
        <p className="max-w-prose text-sm text-pretty">{ORDER_STATEMENT}</p>
        <RecordList
          label={heading}
          columns={columns}
          rows={visiblePage.items}
          // The whole-result total is the read's own count of the relationships it admitted, never the size of the page on show.
          rowCount={subjects.length}
          queryState={{ sort: [], page: visiblePage.page, pageSize: queryState.pageSize, columnVisibility: queryState.columnVisibility }}
          onQueryStateChange={handleQueryStateChange}
          getRowId={(subject) => subject.grantId}
          itemNoun={ITEM_NOUN}
          pageSizeOptions={COACHING_PAGE_SIZES}
        />
        <p className="max-w-prose text-xs text-pretty text-muted-foreground">{IDENTITY_STATEMENT}</p>
      </>
    );
  }
  return (
    <section aria-labelledby={headingId} dir={directionOfLocale(locale)} className="min-w-0">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>
            <h2 id={headingId} className="font-heading text-xl font-semibold text-pretty">
              {heading}
            </h2>
          </CardTitle>
          <CardDescription>{COACHING_COPY.coachPortfolio.purpose}</CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          {/* The one statement of what this identity cannot do here, so the absence of a control is explained rather than guessed. */}
          <p className="max-w-prose text-sm text-pretty">{READ_ONLY_STATEMENT}</p>
          <Separator />
          {content}
        </CardContent>
      </Card>
    </section>
  );
}
