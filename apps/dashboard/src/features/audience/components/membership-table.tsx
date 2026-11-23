"use client";
import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from "react";
import RecordList, { useRecordListWindow, type RecordListColumnDef, type RecordListQueryState } from "@/components/record-list";
import StateNotice from "@/components/state-notice";
import StatusBadge, { MEMBERSHIP_STATUS, statusBadgeProps, VALUE_STATE_WORDS } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ELIGIBLE_HEADING, EXCLUDED_HEADING, EXCLUSION_REASON_COPY, MEMBERSHIP_COLUMN_HEADINGS, MEMBERSHIP_STATE_DESCRIPTIONS, NOT_CONSENT_STATEMENT, PURPOSE_LABEL } from "@/features/audience/copy/membership";
import { useAudience, type AudienceEnvelope } from "../hooks/use-audience-reads";
import { cn } from "@/lib/cn";
import { countFormatOf } from "@/lib/count-format";
import { DEFAULT_PAGE_SIZE, FIRST_PAGE, offeredPageSize } from "@/lib/page-window";
import type { Scope, ValueState } from "@/modules/data-service/envelope";
import type { FieldMessages, ReadResult } from "@/modules/data-service/outcome";
type MembershipMember = AudienceEnvelope["data"]["members"][number];
type MembershipView = AudienceEnvelope["data"];
type ExclusionReasonKey = keyof typeof EXCLUSION_REASON_COPY;
type MembershipStateKey = keyof typeof MEMBERSHIP_STATE_DESCRIPTIONS;
const EXCLUSION_REASON_ORDER = Object.keys(EXCLUSION_REASON_COPY) as readonly ExclusionReasonKey[];
const MEMBERSHIP_STATE_ORDER = Object.keys(MEMBERSHIP_STATE_DESCRIPTIONS) as readonly MembershipStateKey[];
const NO_COLUMNS_HIDDEN: RecordListQueryState["columnVisibility"] = {};
const SURFACE_COPY = {
  loadingTitle: "Reading this publisher's audience",
  loadingBody: "The counts, the states and the members are on their way; nothing is shown as empty or zero until the read answers.",
  unavailableTitle: "This publisher's audience could not be read",
  deniedTitle: "This audience is not available in the current scope and session",
  refusedTitle: "This request was not one the audience read admits",
  emptyTitle: "No membership for this purpose yet",
  emptyBody: "Nobody is eligible and nobody is excluded: this publisher's Update email has no membership in this context yet, and the counts below would all be zero rather than unknown.",
  retry: "Try again",
  readAt: "Read at",
  fromSource: "from",
  eligibleFigureLabel: "Eligible memberships",
  excludedFigureLabel: "Excluded memberships",
} as const;
const statedState = (valueStates: Readonly<Record<string, ValueState>>, path: string): ValueState => valueStates[path] ?? "unknown";
function StatedValue({ value, mono = false }: { readonly value: string; readonly mono?: boolean }): ReactElement {
  const stated = value.trim();
  return stated === "" ? <span className="text-muted-foreground">Not stated</span> : mono ? <bdi className="mono-identifier">{stated}</bdi> : <bdi>{stated}</bdi>;
}
function CountFigure({ count, state, locale }: { readonly count: number; readonly state: ValueState; readonly locale: string }): ReactElement {
  if (!Number.isFinite(count)) return <StatusBadge {...statusBadgeProps(VALUE_STATE_WORDS, "unknown")} />;
  const format = countFormatOf(locale);
  switch (state) {
    case "value":
    case "zero":
      return <span className="tabular-figures">{format.format(count)}</span>;
    case "incomplete-subtotal":
      return (
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
          <span className="tabular-figures">{format.format(count)}</span>
          <StatusBadge {...statusBadgeProps(VALUE_STATE_WORDS, "incomplete-subtotal")} />
        </span>
      );
    case "unknown":
    case "withheld":
    case "unavailable":
      return <StatusBadge {...statusBadgeProps(VALUE_STATE_WORDS, state)} />;
  }
}
const refusalSummary = (fields: FieldMessages): string =>
  Object.entries(fields)
    .flatMap(([field, fieldMessages]) => fieldMessages.map((message) => `${field}: ${message}`))
    .join(" ") || SURFACE_COPY.refusedTitle;
type CountCardProps = { readonly heading: string; readonly figureLabel: string; readonly count: number; readonly state: ValueState; readonly locale: string; readonly children: ReactNode };
const CountCard = ({ heading, figureLabel, count, state, locale, children }: CountCardProps): ReactElement => (
  <Card>
    <CardHeader>
      <CardTitle>
        <h2 className="type-section-title">{heading}</h2>
      </CardTitle>
    </CardHeader>
    <CardContent className="flex flex-col gap-3">
      <p className="flex flex-wrap items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-tight">
          <span className="sr-only">{`${figureLabel}: `}</span>
          <CountFigure count={count} state={state} locale={locale} />
        </span>
      </p>
      {children}
    </CardContent>
  </Card>
);
type MembershipCountsProps = { readonly view: MembershipView; readonly valueStates: Readonly<Record<string, ValueState>>; readonly locale: string; readonly className?: string };
const MembershipCounts = ({ view, valueStates, locale, className }: MembershipCountsProps): ReactElement => (
  <div data-slot="membership-counts" className={cn("grid gap-3 lg:grid-cols-2", className)}>
    <CountCard heading={ELIGIBLE_HEADING} figureLabel={SURFACE_COPY.eligibleFigureLabel} count={view.counts.eligible} state={statedState(valueStates, "counts.eligible")} locale={locale}>
      <ul className="flex flex-col gap-2.5">
        {MEMBERSHIP_STATE_ORDER.map((state) => {
          const description = MEMBERSHIP_STATE_DESCRIPTIONS[state];
          return (
            <li key={state} className="flex flex-col gap-1">
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <StatusBadge {...statusBadgeProps(MEMBERSHIP_STATUS, state)} />
                <span>
                  <CountFigure count={view.memberStates[state]} state={statedState(valueStates, `memberStates.${state}`)} locale={locale} />
                </span>
                <span className="text-muted-foreground">{description.eligibleSuffix}</span>
              </p>
              <p className="max-w-prose text-pretty text-xs text-muted-foreground">{description.description}</p>
            </li>
          );
        })}
      </ul>
    </CountCard>
    <CountCard heading={EXCLUDED_HEADING} figureLabel={SURFACE_COPY.excludedFigureLabel} count={view.counts.excluded} state={statedState(valueStates, "counts.excluded")} locale={locale}>
      <ul className="flex flex-col gap-2">
        {EXCLUSION_REASON_ORDER.map((reason) => (
          <li key={reason} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span>
              <CountFigure count={view.excludedByReason[reason]} state={statedState(valueStates, `excludedByReason.${reason}`)} locale={locale} />
            </span>
            <span className="max-w-prose text-pretty text-xs text-muted-foreground">{EXCLUSION_REASON_COPY[reason]}</span>
          </li>
        ))}
      </ul>
    </CountCard>
  </div>
);
const columnOf = (id: string, header: string, cell: (member: MembershipMember) => ReactNode, enableHiding = true): RecordListColumnDef<MembershipMember> => ({ id, header, enableSorting: false, enableHiding, cell: (context) => cell(context.row.original) });
const identityCell = (member: MembershipMember): ReactNode => {
  const name = (member.displayName ?? "").trim();
  return name === "" ? <bdi className="mono-identifier">{member.recipientId}</bdi> : <bdi>{name}</bdi>;
};
type MembershipSource = AudienceEnvelope | ReadResult<AudienceEnvelope>;
export type MembershipTableProps = { readonly envelope: MembershipSource; readonly scope: Scope; /** The interface locale this surface formats its counts in, stated by the route that composes it. */ readonly locale: string; readonly className?: string };
/** The publisher's audience for this purpose: the read's whole-result counts and one page of members, with every state the read can answer in kept distinct. */ export function MembershipTable({ envelope, scope, locale, className }: MembershipTableProps): ReactElement {
  const initial = useMemo<ReadResult<AudienceEnvelope>>(() => ("kind" in envelope ? envelope : { kind: "envelope", envelope }), [envelope]);
  const initialWindow = initial.kind === "envelope" ? initial.envelope.data.page : undefined;
  // The window the read states is the window this surface opens on, inside the pages that exist. The address owns it from then on, so opening a member and returning reopens the page the reader left.
  const openingLastPage = initialWindow === undefined || initialWindow.total === 0 ? undefined : Math.max(FIRST_PAGE, initialWindow.pageCount);
  const listWindow = useRecordListWindow({ page: openingLastPage === undefined ? FIRST_PAGE : Math.min(Math.max(FIRST_PAGE, initialWindow?.page ?? FIRST_PAGE), openingLastPage), pageSize: initialWindow?.pageSize ?? DEFAULT_PAGE_SIZE });
  const page = openingLastPage === undefined ? listWindow.page : Math.min(listWindow.page, openingLastPage);
  const pageSize = offeredPageSize(listWindow.pageSize);
  const setWindow = listWindow.setWindow;
  const [columnVisibility, setColumnVisibility] = useState<RecordListQueryState["columnVisibility"]>(NO_COLUMNS_HIDDEN); // The columns a worker shows are presentation only, so they stay in this component rather than in the address.
  const publisherId = initial.kind === "envelope" ? initial.envelope.data.publisherId : null;
  const audienceQuery = useMemo<{ readonly page: number; readonly pageSize: number; readonly publisherId?: string }>(() => ({ page, pageSize, ...(publisherId === null ? {} : { publisherId }) }), [publisherId, page, pageSize]);
  const audience = useAudience({ scope, query: audienceQuery });
  const read: ReadResult<AudienceEnvelope> | undefined = audience.data ?? (initial.kind !== "envelope" || (initial.envelope.data.page.page === page && initial.envelope.data.page.pageSize === pageSize) ? initial : undefined);
  const statedPage = read !== undefined && read.kind === "envelope" ? read.envelope.data.page : undefined;
  const lastStatedPage = statedPage === undefined || statedPage.total === 0 ? undefined : Math.max(FIRST_PAGE, statedPage.pageCount);
  const handleQueryStateChange = useCallback(
    (next: RecordListQueryState) => {
      const requestedPage = Math.max(FIRST_PAGE, Math.trunc(next.page)); // The read answers members in its own order and declares no sort parameter, so no order is ever stated here: the window is written to the address and the columns stay in this component.
      setColumnVisibility(next.columnVisibility);
      setWindow({ page: lastStatedPage === undefined ? requestedPage : Math.min(requestedPage, lastStatedPage), pageSize: offeredPageSize(next.pageSize) });
    },
    [lastStatedPage, setWindow],
  );
  const purpose = read !== undefined && read.kind === "envelope" ? read.envelope.data.purpose : null;
  const columns = useMemo<ReadonlyArray<RecordListColumnDef<MembershipMember>>>(
    () => [
      columnOf("identity", MEMBERSHIP_COLUMN_HEADINGS.identity, identityCell, false),
      columnOf("emailValue", MEMBERSHIP_COLUMN_HEADINGS.emailValue, () => <span className="text-muted-foreground text-pretty">No address in this projection</span>),
      columnOf("state", MEMBERSHIP_COLUMN_HEADINGS.state, (member) => <StatusBadge {...statusBadgeProps(MEMBERSHIP_STATUS, member.state)} />),
      columnOf("languagePreference", MEMBERSHIP_COLUMN_HEADINGS.languagePreference, (member) => <StatedValue value={member.languagePreference} />),
      columnOf("purpose", MEMBERSHIP_COLUMN_HEADINGS.purpose, () => (purpose === null ? null : PURPOSE_LABEL[purpose])),
      columnOf("since", MEMBERSHIP_COLUMN_HEADINGS.since, (member) => <StatedValue value={member.acceptedOn ?? ""} mono />),
      columnOf("exclusionReason", MEMBERSHIP_COLUMN_HEADINGS.exclusionReason, (member) => (member.exclusionReason === null ? null : <span className="text-pretty">{EXCLUSION_REASON_COPY[member.exclusionReason]}</span>)),
    ],
    [purpose],
  );
  const retry = { label: SURFACE_COPY.retry, onClick: (): void => void audience.refetch() };
  let content: ReactElement;
  if (read === undefined) {
    content = <StateNotice kind="loading" title={SURFACE_COPY.loadingTitle} description={SURFACE_COPY.loadingBody} headingLevel={2} loadingLines={6} />;
  } else if (read.kind === "denied") {
    content = <StateNotice kind="denied" title={SURFACE_COPY.deniedTitle} reasonCode={read.denied.reasonCode} headingLevel={2} />;
  } else if (read.kind === "unavailable") {
    content = <StateNotice kind="unavailable" title={SURFACE_COPY.unavailableTitle} description={read.unavailable.guidance} source={read.unavailable.source} retry={retry} headingLevel={2} />;
  } else if (read.kind === "refused") {
    content = <StateNotice kind="refused" title={SURFACE_COPY.refusedTitle} description={refusalSummary(read.refused.fields)} headingLevel={2} />;
  } else {
    const stated = read.envelope;
    const view = stated.data;
    content = (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Badge variant="secondary">{PURPOSE_LABEL[view.purpose]}</Badge>
          <p className="text-xs text-muted-foreground">
            {`${SURFACE_COPY.readAt} `}
            <bdi className="mono-identifier">{stated.asOf}</bdi>
            {` ${SURFACE_COPY.fromSource} `}
            <bdi className="mono-identifier">{stated.source.system}</bdi>
          </p>
        </div>
        <MembershipCounts view={view} valueStates={stated.valueStates} locale={locale} />
        <p className="max-w-prose text-pretty type-supporting">{NOT_CONSENT_STATEMENT}</p>
        {view.page.total === 0 ? (
          <StateNotice kind="empty" title={SURFACE_COPY.emptyTitle} description={SURFACE_COPY.emptyBody} headingLevel={2} />
        ) : (
          <RecordList<MembershipMember> label={MEMBERSHIP_COLUMN_HEADINGS.caption} columns={columns} rows={view.members} rowCount={view.page.total} queryState={{ sort: [], page, pageSize, columnVisibility }} onQueryStateChange={handleQueryStateChange} getRowId={(row) => row.membershipId} itemNoun="members" />
        )}
      </div>
    );
  }
  return (
    <div data-slot="membership-table" className={cn("flex flex-col gap-4", className)}>
      {content}
    </div>
  );
}
export default MembershipTable;
