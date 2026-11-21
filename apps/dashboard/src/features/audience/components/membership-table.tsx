"use client";
/**
 * The publisher's audience for the one purpose this release keeps memberships for: the four membership
 * states with the read's own whole-result counts, every exclusion reason, the not-consent statement, and
 * one page of members.
 *
 * Every figure here is the read's. The surface prints the counts the envelope carries for the whole
 * result and the one page it returned, and it narrows nothing: `readAudience` accepts a publisher, a
 * page and a page size and answers the whole purpose audience, so a filter offered here could only be
 * applied to the loaded page while the pager kept stating the whole-result window — a claim this
 * surface would have no way to keep. Filtering, ordering, paging and counting stay the service's.
 */
import { useCallback, useMemo, useState, type ReactElement } from "react";
import RecordList, { type RecordListColumnDef, type RecordListQueryState } from "@/components/record-list";
import StateNotice from "@/components/state-notice";
import StatusBadge, { MEMBERSHIP_STATUS, statusBadgeProps, VALUE_STATE_WORDS } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ELIGIBLE_HEADING, EXCLUDED_HEADING, EXCLUSION_REASON_COPY, MEMBERSHIP_COLUMN_HEADINGS, MEMBERSHIP_STATE_DESCRIPTIONS, NOT_CONSENT_STATEMENT, PURPOSE_LABEL } from "@/features/audience/copy/membership";
import { useAudience, type AudienceEnvelope } from "../hooks/use-audience-reads";
import { cn } from "@/lib/cn";
import type { Scope, ValueState } from "@/modules/data-service/envelope";
import type { FieldMessages, ReadResult } from "@/modules/data-service/outcome";
// The shapes this surface reads, taken from the read rather than restated
/** One member as the read projects it: the membership, the state it is in at the read's instant, the person's own reading language and the reason it is excluded. The address the membership stores is deliberately not part of the projection. */
type MembershipMember = AudienceEnvelope["data"]["members"][number];
/** The publisher's audience: whole-result counts, the four state counts, every exclusion reason, and one page of members. */
type MembershipView = AudienceEnvelope["data"];
/** The exclusion reasons the copy module words, and the four membership states it describes. */
type ExclusionReasonKey = keyof typeof EXCLUSION_REASON_COPY;
type MembershipStateKey = keyof typeof MEMBERSHIP_STATE_DESCRIPTIONS;
// The read states its own order for these, and the copy module's declaration order is that order
const EXCLUSION_REASON_ORDER = Object.keys(EXCLUSION_REASON_COPY) as readonly ExclusionReasonKey[];
const MEMBERSHIP_STATE_ORDER = Object.keys(MEMBERSHIP_STATE_DESCRIPTIONS) as readonly MembershipStateKey[];
// Fixed values
/** The noun the preset's own pager, empty notice and selection summary state. */
const ITEM_NOUN = "members";
const FIRST_PAGE = 1;
const DEFAULT_PAGE_SIZE = 50;
const NO_COLUMNS_HIDDEN: RecordListQueryState["columnVisibility"] = {};
/** The counts are whole-result figures, so they are grouped the way every other figure on the application is. */
const countFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
/** The one statement this surface adds to the copy module: the read projects the audience without the address a membership stores, so the column states that absence rather than inventing a value. */
const ADDRESS_NOT_IN_PROJECTION = "No address in this projection";
/** What a column says when the record itself states nothing for it: a blank cell reads as a rendering fault, and a word the copy module does not own would invent a state the membership is not in. */
const NOT_STATED = "Not stated";
/** The wording the copy module does not own, gathered once so this file states no sentence twice. */
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
// Reading the read's own numbers
/** The state the read recorded for one field path, and `unknown` for a path it stated nothing about: a number the read did not state is never printed as one. */
function statedState(valueStates: Readonly<Record<string, ValueState>>, path: string): ValueState {
  return valueStates[path] ?? "unknown";
}
/** A record value rendered as the record states it, or as the fact that it states nothing — never as a blank cell a reader could take for a rendering fault. */
function StatedValue({ value, mono = false }: { readonly value: string; readonly mono?: boolean }): ReactElement {
  const stated = value.trim();
  if (stated === "") {
    return <span className="text-muted-foreground">{NOT_STATED}</span>;
  }
  return mono ? <bdi className="mono-identifier">{stated}</bdi> : <bdi>{stated}</bdi>;
}
/** A count rendered from the value state its own read recorded, so a genuine zero stays a number while an unknown, withheld or unavailable count never becomes one. */
function CountFigure({ count, state }: { readonly count: number; readonly state: ValueState }): ReactElement {
  if (!Number.isFinite(count)) {
    // A count that is not a number is never printed as one; it is reported as the unknown it is.
    return <StatusBadge {...statusBadgeProps(VALUE_STATE_WORDS, "unknown")} />;
  }
  switch (state) {
    case "value":
    case "zero":
      return <span className="tabular-figures">{countFormat.format(count)}</span>;
    case "incomplete-subtotal":
      return (
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
          <span className="tabular-figures">{countFormat.format(count)}</span>
          <StatusBadge {...statusBadgeProps(VALUE_STATE_WORDS, "incomplete-subtotal")} />
        </span>
      );
    case "unknown":
    case "withheld":
    case "unavailable":
      return <StatusBadge {...statusBadgeProps(VALUE_STATE_WORDS, state)} />;
  }
}
/** Every message a refusal keyed by field path, in one sentence a notice can state. */
function refusalSummary(fields: FieldMessages): string {
  const messages: string[] = [];
  for (const [field, fieldMessages] of Object.entries(fields)) {
    for (const message of fieldMessages) {
      messages.push(`${field}: ${message}`);
    }
  }
  return messages.length === 0 ? SURFACE_COPY.refusedTitle : messages.join(" ");
}
/** The one figure a counts block states first, with the phrase that names which count it is for a screen reader. */
function CountHeadline({ label, count, state }: { readonly label: string; readonly count: number; readonly state: ValueState }): ReactElement {
  return (
    <p className="flex flex-wrap items-baseline gap-2">
      <span className="text-2xl font-semibold tracking-tight">
        <span className="sr-only">{`${label}: `}</span>
        <CountFigure count={count} state={state} />
      </span>
    </p>
  );
}
// The counts panel
interface MembershipCountsProps {
  readonly view: MembershipView;
  readonly valueStates: Readonly<Record<string, ValueState>>;
  readonly className?: string;
}
/** The whole-result counts the read states: eligible and excluded totals, the four state counts with the eligibility each sentence states, and every exclusion reason with its own count. */
function MembershipCounts({ view, valueStates, className }: MembershipCountsProps): ReactElement {
  return (
    <div data-slot="membership-counts" className={cn("grid gap-3 lg:grid-cols-2", className)}>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="font-heading text-base font-medium">{ELIGIBLE_HEADING}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <CountHeadline label={SURFACE_COPY.eligibleFigureLabel} count={view.counts.eligible} state={statedState(valueStates, "counts.eligible")} />
          <ul className="flex flex-col gap-2.5">
            {MEMBERSHIP_STATE_ORDER.map((state) => {
              const description = MEMBERSHIP_STATE_DESCRIPTIONS[state];
              return (
                <li key={state} className="flex flex-col gap-1">
                  <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <StatusBadge {...statusBadgeProps(MEMBERSHIP_STATUS, state)} />
                    <span>
                      <CountFigure count={view.memberStates[state]} state={statedState(valueStates, `memberStates.${state}`)} />
                    </span>
                    <span className="text-muted-foreground">{description.eligibleSuffix}</span>
                  </p>
                  <p className="max-w-prose text-pretty text-xs leading-snug text-muted-foreground">{description.description}</p>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="font-heading text-base font-medium">{EXCLUDED_HEADING}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <CountHeadline label={SURFACE_COPY.excludedFigureLabel} count={view.counts.excluded} state={statedState(valueStates, "counts.excluded")} />
          <ul className="flex flex-col gap-2">
            {EXCLUSION_REASON_ORDER.map((reason) => (
              <li key={reason} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span>
                  <CountFigure count={view.excludedByReason[reason]} state={statedState(valueStates, `excludedByReason.${reason}`)} />
                </span>
                <span className="max-w-prose text-pretty text-xs leading-snug text-muted-foreground">{EXCLUSION_REASON_COPY[reason]}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
// The surface
/** The union a route hands this surface: the envelope its read produced, or the denial, outage or refusal it answered with, so a server-side refusal renders as the refusal it is rather than as an audience. */
type MembershipSource = AudienceEnvelope | ReadResult<AudienceEnvelope>;
export interface MembershipTableProps {
  /** What the route's read produced, taken as it stands: nothing here re-derives it, re-counts it or fills in what it omits. */
  readonly envelope: MembershipSource;
  /** The authority the route read under. Every browser read of this surface is issued under the same scope. */
  readonly scope: Scope;
  readonly className?: string;
}
/** The union the route handed over, as the one result shape this surface renders. An envelope carries no `kind` member, so the two arms are told apart without guessing. */
function asReadResult(value: MembershipSource): ReadResult<AudienceEnvelope> {
  return "kind" in value ? value : { kind: "envelope", envelope: value };
}

/** The publisher's audience for this purpose: the read's whole-result counts and one page of members, with every state the read can answer in kept distinct. */
export function MembershipTable({ envelope, scope, className }: MembershipTableProps): ReactElement {
  const initial = useMemo(() => asReadResult(envelope), [envelope]);
  const initialWindow = initial.kind === "envelope" ? initial.envelope.data.page : undefined;
  // The query this surface controls is exactly the query the read declares — a page and its size — plus
  // the publisher the server resolved, so the browser read answers for the same audience. No order is
  // held here because the read states its own and offers no sort parameter.
  const [queryState, setQueryState] = useState<RecordListQueryState>(() => ({
    sort: [],
    // The window the read states is the window this surface opens on, inside the pages that exist.
    page: initialWindow === undefined ? FIRST_PAGE : Math.min(Math.max(FIRST_PAGE, initialWindow.page), Math.max(FIRST_PAGE, initialWindow.pageCount)),
    pageSize: initialWindow?.pageSize ?? DEFAULT_PAGE_SIZE,
    columnVisibility: NO_COLUMNS_HIDDEN,
  }));
  const publisherId = initial.kind === "envelope" ? initial.envelope.data.publisherId : null;
  const audienceQuery = useMemo<{ readonly page: number; readonly pageSize: number; readonly publisherId?: string }>(
    () => ({ page: queryState.page, pageSize: queryState.pageSize, ...(publisherId === null ? {} : { publisherId }) }),
    [publisherId, queryState.page, queryState.pageSize],
  );
  const audience = useAudience({ scope, query: audienceQuery });
  // The server's answer stands in while the browser read has no answer of its own, and only for the
  // window it describes: a page change must never be presented under the previous page's rows, so the
  // fallback stops the moment the asked-for window differs from the envelope's own.
  const initialDescribesAskedWindow = initial.kind !== "envelope" || (initial.envelope.data.page.page === queryState.page && initial.envelope.data.page.pageSize === queryState.pageSize);
  const read: ReadResult<AudienceEnvelope> | undefined = audience.data ?? (initialDescribesAskedWindow ? initial : undefined);
  const statedPage = read !== undefined && read.kind === "envelope" ? read.envelope.data.page : undefined;
  // The last page the read states, when it states any: a request for a page beyond it is answered with
  // the last page that exists rather than an empty window under a pager that says otherwise. The bound
  // comes from the read's own page count, never from a count taken here.
  const lastStatedPage = statedPage === undefined || statedPage.total === 0 ? undefined : Math.max(FIRST_PAGE, statedPage.pageCount);
  const handleQueryStateChange = useCallback(
    (next: RecordListQueryState) => {
      // The read answers members in its own order and declares no sort parameter, so no column offers a
      // sort and no order is ever stated here. Visibility is presentation only: hiding a column narrows
      // what is shown of a row, never which rows the read returned.
      const requestedPage = Math.max(FIRST_PAGE, Math.trunc(next.page));
      setQueryState({
        sort: [],
        page: lastStatedPage === undefined ? requestedPage : Math.min(requestedPage, lastStatedPage),
        pageSize: next.pageSize,
        columnVisibility: next.columnVisibility,
      });
    },
    [lastStatedPage],
  );
  const purpose = read !== undefined && read.kind === "envelope" ? read.envelope.data.purpose : null;
  const columns = useMemo<ReadonlyArray<RecordListColumnDef<MembershipMember>>>(
    () => [
      {
        id: "identity",
        header: MEMBERSHIP_COLUMN_HEADINGS.identity,
        enableSorting: false,
        // The row's name is never the one column a worker can hide: a row with no identity is unusable.
        enableHiding: false,
        cell: (context) => {
          const member = context.row.original;
          const name = member.displayName === null ? "" : member.displayName.trim();
          // A membership the source states no display name for is identified by the opaque recipient
          // reference a notification result records it under — never by an address, which this read does
          // not project and which establishes no identity in any case.
          return name === "" ? <bdi className="mono-identifier">{member.recipientId}</bdi> : <bdi>{name}</bdi>;
        },
      },
      {
        id: "emailValue",
        header: MEMBERSHIP_COLUMN_HEADINGS.emailValue,
        enableSorting: false,
        // The read projects the audience without the address a membership stores, so the column states
        // that absence rather than repeating a value the projection does not carry.
        cell: () => <span className="text-muted-foreground text-pretty">{ADDRESS_NOT_IN_PROJECTION}</span>,
      },
      {
        id: "state",
        header: MEMBERSHIP_COLUMN_HEADINGS.state,
        enableSorting: false,
        cell: (context) => <StatusBadge {...statusBadgeProps(MEMBERSHIP_STATUS, context.row.original.state)} />,
      },
      {
        id: "languagePreference",
        header: MEMBERSHIP_COLUMN_HEADINGS.languagePreference,
        enableSorting: false,
        // The person's reading language stands on its own column: it records no consent, proves no
        // address and confirms nothing, so it is never merged into the state or the purpose beside it.
        cell: (context) => <StatedValue value={context.row.original.languagePreference} />,
      },
      {
        id: "purpose",
        header: MEMBERSHIP_COLUMN_HEADINGS.purpose,
        enableSorting: false,
        cell: () => (purpose === null ? null : PURPOSE_LABEL[purpose]),
      },
      {
        id: "since",
        header: MEMBERSHIP_COLUMN_HEADINGS.since,
        enableSorting: false,
        // The acceptance instant is printed exactly as the record states it, in the offset it was
        // recorded with. Rebasing it into a display zone here would state another instant than the one the
        // membership holds.
        cell: (context) => {
          const acceptedOn = context.row.original.acceptedOn;
          return <StatedValue value={acceptedOn ?? ""} mono />;
        },
      },
      {
        id: "exclusionReason",
        header: MEMBERSHIP_COLUMN_HEADINGS.exclusionReason,
        enableSorting: false,
        // An eligible member is excluded by nothing, so the cell states nothing rather than a word the
        // copy module does not own or a fabricated "none" that reads like a reason.
        cell: (context) => {
          const reason = context.row.original.exclusionReason;
          return reason === null ? null : <span className="text-pretty">{EXCLUSION_REASON_COPY[reason]}</span>;
        },
      },
    ],
    [purpose],
  );
  const retry = {
    label: SURFACE_COPY.retry,
    onClick: (): void => {
      void audience.refetch();
    },
  };
  let content: ReactElement;
  if (read === undefined) {
    // The read has not answered, so nothing is counted and no empty result is implied.
    content = <StateNotice kind="loading" title={SURFACE_COPY.loadingTitle} description={SURFACE_COPY.loadingBody} headingLevel={2} loadingLines={6} />;
  } else if (read.kind === "denied") {
    // A denial states no count, no title and no size: the answer is the same whether or not anything
    // exists in the scope this session may not read, so no block of this surface renders beside it.
    content = <StateNotice kind="denied" title={SURFACE_COPY.deniedTitle} reasonCode={read.denied.reasonCode} headingLevel={2} />;
  } else if (read.kind === "unavailable") {
    content = <StateNotice kind="unavailable" title={SURFACE_COPY.unavailableTitle} description={read.unavailable.guidance} source={read.unavailable.source} retry={retry} headingLevel={2} />;
  } else if (read.kind === "refused") {
    // The request this surface sent is not one the read admits: the source behind it answered, so the
    // refusal's own field messages are the answer rather than an empty audience.
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
        <MembershipCounts view={view} valueStates={stated.valueStates} />
        <p className="max-w-prose text-pretty text-sm text-muted-foreground">{NOT_CONSENT_STATEMENT}</p>
        {/* No busy skeleton is handed to the preset below: the rows it receives are the ones the read
            answered with, so a placeholder would hide data that exists. A window with no rows yet is the
            loading state above rather than a skeleton drawn over this one. */}
        {view.page.total === 0 ? (
          // Nobody holds a membership for this purpose: that is a genuine zero on every count above, and it
          // is stated as the empty collection it is rather than as an outage or an unknown.
          <StateNotice kind="empty" title={SURFACE_COPY.emptyTitle} description={SURFACE_COPY.emptyBody} headingLevel={2} />
        ) : (
          <RecordList<MembershipMember>
            label={MEMBERSHIP_COLUMN_HEADINGS.caption}
            columns={columns}
            rows={view.members}
            rowCount={view.page.total}
            queryState={queryState}
            onQueryStateChange={handleQueryStateChange}
            getRowId={(row) => row.membershipId}
            itemNoun={ITEM_NOUN}
          />
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

