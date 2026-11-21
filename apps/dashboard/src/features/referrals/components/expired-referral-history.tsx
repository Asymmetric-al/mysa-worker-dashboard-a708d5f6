/**
 * The permitted Expired history of one referral cycle: the approved identity, the source reference the
 * source issued, the status the record carries and the permitted dates — and nothing wider.
 *
 * Expired history is a narrow permission over history, not access to the partner record, so this
 * surface renders only the facts the service's narrow projection carries and names every fact the
 * permission withholds as an absence with its reason. A withheld fact and an empty one never render
 * alike: nothing here is left as a gap, a dash or a blank a reader would fill in with a guess.
 *
 * The projection arrives already narrowed — `readReferral` answers an expired cycle in this shape
 * whichever route reached it — so the file cannot widen it: there is no partner link, no contact
 * action, no private text, no financial figure and no search affordance that could probe a hidden
 * field here.
 *
 * No client directive and no hook: every fact arrives as a prop, so the surface renders on the server
 * and inside a client tree alike, and it decides nothing about a window, a deadline or a succession.
 */
import type { ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import StatusBadge, { statusBadgeProps, VALUE_STATE_WORDS, type StatusTone } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { reads } from "@/modules/data-service";
import { EXPIRED_HISTORY_COPY, EXPIRY_VS_CLOSURE, FORBIDDEN_FIELDS, LIST_COPY, PRECISION_COPY, STATUS_COPY, WINDOW_COPY, type ReferralStatusWord } from "../copy";
// The row this surface is about, taken from the read's own signature
/** What `readReferral` answers: the scoped envelope, a denial, or an unavailable source. */
type ReferralDetailReadResult = Awaited<ReturnType<typeof reads.referrals.readReferral>>;
/** The envelope the expired-history arm of that answer carries. */
type ReferralDetailEnvelope = Extract<ReferralDetailReadResult, { readonly kind: "envelope" }>["envelope"];
/**
 * The narrow permitted projection one expired cycle is answered in.
 *
 * It is derived from the read rather than restated, so the component can hold no field, no permission
 * exception and no fixture fallback the service does not itself put in the envelope.
 */
type ExpiredHistoryRow = Extract<ReferralDetailEnvelope["data"], { readonly view: "expired-history" }>["referral"];
// The tones this surface adds to the words the family's copy owns
/**
 * The tone each status word carries. A closure the source recorded reads as a closure: the word beside
 * it says how it closed, and this only says it did. An ended window is an ordinary outcome rather than
 * an alarm, so `expired` stays neutral and never borrows the danger tone a closure carries.
 */
const STATUS_TONE: Readonly<Record<ReferralStatusWord, StatusTone>> = {
  active: "positive",
  expired: "neutral",
  "no-deadline": "caution",
  refused: "caution",
  withdrawn: "danger",
  revoked: "danger",
  erased: "danger",
  departed: "danger",
};
/** The word a permitted value that the projection does not carry renders in, so the absence is stated rather than left blank. */
const NOT_RECORDED = statusBadgeProps(VALUE_STATE_WORDS, "unknown");
// The heading levels the surrounding page can need
/** The heading levels this surface accepts, because the level belongs to the page that composes it. */
export type ExpiredHistoryHeadingLevel = 2 | 3 | 4;
/**
 * The three tags one level derives: the record's own heading, the heading of its sub-section, and the
 * level a shared notice nests at. Deciding them once keeps a level-4 title from gaining an `h5`.
 */
const HEADINGS: Readonly<Record<ExpiredHistoryHeadingLevel, { readonly title: "h2" | "h3" | "h4"; readonly section: "h3" | "h4"; readonly notice: 3 | 4 }>> = {
  2: { title: "h2", section: "h3", notice: 3 },
  3: { title: "h3", section: "h4", notice: 4 },
  4: { title: "h4", section: "h4", notice: 4 },
};
/** Props of {@link ExpiredReferralHistory}. */
export interface ExpiredReferralHistoryProps {
  /**
   * One expired cycle exactly as the narrow permitted projection carries it, or `null` when the
   * permitted history holds none. An absent projection renders the permission and an empty or
   * unmatched-list statement, never a record built from anything else.
   */
  readonly referral: ExpiredHistoryRow | null;
  /**
   * The status word this record carries. It defaults to the projection's own status; a caller states it
   * to show a closure the source recorded — withdrawn, revoked, erased or departed — which is kept
   * visibly apart from an ordinary expiry rather than read as one.
   */
  readonly status?: ReferralStatusWord;
  /**
   * Whether the list holds nothing because a search matched nothing. That is a different fact from a
   * permission that covers no ended referral, and it is the one place a reader could mistake an empty
   * result for evidence about a withheld field.
   */
  readonly searchEmpty?: boolean;
  /** The heading level this surface takes in the surrounding page's order. */
  readonly headingLevel?: ExpiredHistoryHeadingLevel;
  /** The direction the surrounding document is read in. Every fact value is isolated on its own with `bdi`. */
  readonly dir?: "ltr" | "rtl";
  readonly className?: string;
}
/** The state word a permitted value the projection does not carry renders as, rather than an empty gap or a dash. */
function NotRecorded(): ReactElement {
  return <StatusBadge label={NOT_RECORDED.label} tone={NOT_RECORDED.tone} />;
}
/** One permitted date, printed exactly as the envelope supplied it: the surface never reformats, re-derives or reinterprets it. */
function PermittedDate({ value }: { readonly value: string | null }): ReactElement {
  return value === null ? <NotRecorded /> : <bdi className="tabular-figures">{value}</bdi>;
}
/** The four permitted facts of one expired cycle: identity, source reference, status and the permitted dates. */
function PermittedFacts({ referral, status }: { readonly referral: ExpiredHistoryRow; readonly status: ReferralStatusWord }): ReactElement {
  const labels = EXPIRED_HISTORY_COPY.fieldLabels;
  const statusCopy = STATUS_COPY[status];
  const reference = referral.sourceReference;
  // The two halves of the status vocabulary only need telling apart where both could appear: an ended
  // window, or a closure the source recorded in place of one.
  const separatesClosures = status === "expired" || statusCopy.closureRecordedBySource;
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-3 text-start text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
      <dt className="font-medium">{labels.partner}</dt>
      <dd className="min-w-0 wrap-anywhere text-muted-foreground">
        <bdi>{referral.partnerDisplayName}</bdi>
      </dd>
      <dt className="font-medium">{labels.sourceReference}</dt>
      <dd className="min-w-0 wrap-anywhere text-muted-foreground">
        {reference === null ? (
          <NotRecorded />
        ) : (
          // Printed exactly as the source gave it, in one opaque pair: never parsed, never linked and
          // never compared with another reference to decide what it means.
          <bdi className="mono-identifier">{`${reference.system}:${reference.reference}`}</bdi>
        )}
      </dd>
      <dt className="font-medium">{labels.status}</dt>
      <dd className="flex min-w-0 flex-col gap-1">
        <StatusBadge label={statusCopy.label} tone={STATUS_TONE[status]} />
        <p className="min-w-0 text-pretty wrap-anywhere text-muted-foreground">{statusCopy.description}</p>
        {separatesClosures ? <p className="min-w-0 text-pretty wrap-anywhere text-muted-foreground">{EXPIRY_VS_CLOSURE}</p> : null}
      </dd>
      {/*
        The permitted dates are one permission category, so they are one fact here and their own
        labels sit inside it. The group takes the window heading the copy already owns because the
        window is counted from the introduction date, and a date is unreadable without the precision
        it is known to — so each date fact keeps its own copy label rather than being merged.
      */}
      <dt className="font-medium">{WINDOW_COPY.heading}</dt>
      <dd className="min-w-0">
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-start sm:grid-cols-[max-content_minmax(0,1fr)]">
          <dt className="font-medium">{labels.originalIntroductionOn}</dt>
          <dd className="min-w-0 wrap-anywhere text-muted-foreground">
            <PermittedDate value={referral.originalIntroductionOn} />
          </dd>
          <dt className="font-medium">{labels.datePrecision}</dt>
          <dd className="min-w-0 wrap-anywhere text-muted-foreground">{PRECISION_COPY[referral.datePrecision].label}</dd>
          <dt className="font-medium">{labels.windowStart}</dt>
          <dd className="min-w-0 wrap-anywhere text-muted-foreground">
            <PermittedDate value={referral.windowStart} />
          </dd>
          <dt className="font-medium">{labels.windowEnd}</dt>
          <dd className="min-w-0 wrap-anywhere text-muted-foreground">
            <PermittedDate value={referral.windowEnd} />
          </dd>
        </dl>
      </dd>
    </dl>
  );
}
/** The facts this history does not carry, each with the reason it is absent, so an absence is a permission rather than a gap. */
function AbsentFacts(): ReactElement {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-start text-sm">
      {FORBIDDEN_FIELDS.map((absent) => (
        <div key={absent.field} className="flex min-w-0 flex-col gap-0.5">
          <dt className="font-medium">{absent.label}</dt>
          <dd className="min-w-0 text-pretty wrap-anywhere text-muted-foreground">{absent.reason}</dd>
        </div>
      ))}
    </dl>
  );
}
/** The permitted Expired history of one referral cycle, or the statement of what this history holds when it holds no record. */
export default function ExpiredReferralHistory({ referral, status, searchEmpty = false, headingLevel = 2, dir, className }: ExpiredReferralHistoryProps): ReactElement {
  const headings = HEADINGS[headingLevel];
  const TitleTag = headings.title;
  const SectionTag = headings.section;
  // A search that matched nothing and a permission that covers no ended referral are two different
  // facts, so each gets its own statement; neither is ever rendered as a record.
  const emptyNotice = searchEmpty ? (
    <StateNotice kind="empty" headingLevel={headings.notice} title={LIST_COPY.search.empty.title} description={EXPIRED_HISTORY_COPY.noMatchingHint} />
  ) : (
    <StateNotice kind="empty" headingLevel={headings.notice} title={LIST_COPY.views.expired.empty.title} description={LIST_COPY.views.expired.empty.body} />
  );
  return (
    <Card dir={dir} size="sm" className={cn("min-w-0", className)}>
      <CardHeader>
        <CardTitle>
          <TitleTag className="font-heading text-base font-medium">{EXPIRED_HISTORY_COPY.heading}</TitleTag>
        </CardTitle>
        <CardDescription className="text-pretty wrap-anywhere">{EXPIRED_HISTORY_COPY.explanation}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        {/* The permission is stated before the facts it covers, so nothing below is read as wider access. */}
        <Alert>
          <AlertTitle>{EXPIRED_HISTORY_COPY.permissionStatement}</AlertTitle>
          <AlertDescription>{EXPIRED_HISTORY_COPY.readOnlyNote}</AlertDescription>
        </Alert>
        {referral === null || searchEmpty ? emptyNotice : <PermittedFacts referral={referral} status={status ?? referral.status.status} />}
        <Separator />
        <div className="flex min-w-0 flex-col gap-2">
          <SectionTag className="font-heading text-sm font-medium">{EXPIRED_HISTORY_COPY.absentHeading}</SectionTag>
          <AbsentFacts />
        </div>
      </CardContent>
    </Card>
  );
}
