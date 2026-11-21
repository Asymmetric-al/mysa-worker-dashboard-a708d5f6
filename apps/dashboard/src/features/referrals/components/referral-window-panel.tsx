/**
 * One referral cycle's window, presented exactly as the service resolved it: the calendar wording the
 * source states beside the instant that expires, the zone the endpoint was resolved in, and — where
 * the evidence cannot support a deadline — the plain statement that there is none.
 *
 * Nothing here counts days, adds seconds, compares instants or reads the clock. The last included
 * date, the exclusive endpoint, its zone and the continuation's own facts all arrive from the envelope
 * that resolved them, because the endpoint is resolved once and kept: a later change of place, of
 * display or of zone data must never move it. That arithmetic belongs to the time-window module behind
 * the service, so this file performs none of it.
 *
 * There is deliberately no module directive. No hook is read and no event is handled, so a Server
 * Component renders exactly what a client detail body renders, and the panel holds no state of its own.
 */
import type { ReactElement, ReactNode } from "react";
import StatusBadge, { type StatusTone } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { reads } from "@/modules/data-service";
import { CONTINUATION_WINDOW_COPY, NOMINAL_VS_RESOLVED, NO_DEADLINE_NOTICE, PRECISION_COPY, STATUS_COPY, WINDOW_COPY, type ReferralStatusWord } from "../copy";
// The contract: the referral detail read's own types, narrowed to the facts this panel renders. The
// service is reached only through its published surface, so no read module, store or domain evaluator
// is imported here and no shape is restated by hand.
type ReferralDetailEnvelope = Extract<Awaited<ReturnType<typeof reads.referrals.readReferral>>, { readonly kind: "envelope" }>["envelope"];

type ReferralDetailData = ReferralDetailEnvelope["data"];

type ReferralDetailRow = Extract<ReferralDetailData, { readonly view: "detail" }>["referral"];

type ReferralDeadline = NonNullable<ReferralDetailRow["deadline"]>;

type ReferralNominalWindow = NonNullable<ReferralDeadline["nominal"]>;
/** The cycle facts this panel states: the introduction date, the precision it is known to, the window the service resolved, where it stands and the cycle it continues from. */
export type ReferralWindowSource = Pick<
  ReferralDetailRow,
  "referralId" | "datePrecision" | "originalIntroductionOn" | "sourceZone" | "windowKind" | "status" | "deadline" | "predecessorId"
>;
/** Props of {@link ReferralWindowPanel}. */
export interface ReferralWindowPanelProps {
  /** The cycle as the detail read resolved it; every date, instant and zone below is read from here and none is derived. */
  readonly referral: ReferralWindowSource;
  /** The display direction the route composition states; it is set on this block only, never on a child's styles. */
  readonly dir?: "ltr" | "rtl";
  readonly className?: string;
}
/**
 * The tone each status word carries, so colour never stands alone: the word itself is the label and
 * this only decides how it reads. A window that has not ended is the ordinary case; an ended window is
 * neutral rather than a fault; an incomplete date is quiet; a window that could not be read is the one
 * state that asks for attention.
 */
const WINDOW_STATUS_TONE: Readonly<Record<ReferralStatusWord, StatusTone>> = {
  active: "positive",
  expired: "neutral",
  "no-deadline": "muted",
  refused: "caution",
  withdrawn: "neutral",
  revoked: "danger",
  erased: "muted",
  departed: "neutral",
};
/**
 * A stable id stem for this cycle's labels, derived from its own opaque reference with anything an id
 * cannot carry replaced. Deriving it rather than generating one keeps the server render and the browser
 * render identical without a hook, and keeps two cycles on one page from sharing a label.
 */
function idBaseOf(referralId: string): string {
  return `referral-window-${referralId.replace(/[^A-Za-z0-9_-]+/gu, "-")}`;
}
/** One date or instant exactly as the envelope supplied it, isolated because a date or an instant is neutral-direction text that must never reorder the runs around it. */
function EnvelopeValue({ value }: { readonly value: string }): ReactElement {
  return (
    <bdi>
      <time className="tabular-figures" dateTime={value}>
        {value}
      </time>
    </bdi>
  );
}
/** One labelled fact, with the label the copy states and the value the envelope supplied. */
function Fact({ term, children }: { readonly term: string; readonly children: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
      <dt className="shrink-0 text-muted-foreground">{term}</dt>
      <dd className="flex min-w-0 flex-col gap-1 break-words">{children}</dd>
    </div>
  );
}
interface NominalAndResolvedProps {
  readonly headingId: string;
  readonly nominal: ReferralNominalWindow | null;
  readonly nominalUnavailableReason: string | null;
  readonly end: string;
  readonly sourceZone: string;
}
/**
 * The calendar wording and the resolved end, kept as two labelled facts.
 *
 * They are never merged and never reconciled here: the resolved moment is what decides whether the
 * referral is Active or Expired, and the wording stands as it was written. Where the envelope carries
 * no calendar wording it states why in its own words, and that reason is shown rather than replaced by
 * one written here.
 */
function NominalAndResolved({ headingId, nominal, nominalUnavailableReason, end, sourceZone }: NominalAndResolvedProps): ReactElement {
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2">
      <h4 id={headingId} className="text-sm font-semibold text-pretty">
        {NOMINAL_VS_RESOLVED.heading}
      </h4>
      <dl className="flex min-w-0 flex-col gap-2">
        <Fact term={NOMINAL_VS_RESOLVED.nominalLabel}>
          {nominal === null ? (
            <>
              <p className="text-pretty">{NOMINAL_VS_RESOLVED.nominalUnavailable}</p>
              {nominalUnavailableReason === null ? null : <p className="text-pretty">{nominalUnavailableReason}</p>}
            </>
          ) : (
            <>
              <p>
                <EnvelopeValue value={nominal.lastIncludedOn} />
              </p>
              <p className="text-pretty">{nominal.wording}</p>
            </>
          )}
        </Fact>
        <Fact term={NOMINAL_VS_RESOLVED.resolvedLabel}>
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
            <EnvelopeValue value={end} />
            <bdi className="break-all">{sourceZone}</bdi>
          </p>
        </Fact>
      </dl>
      {nominal !== null && nominal.disagreesWithResolved ? <p className="text-pretty">{NOMINAL_VS_RESOLVED.disagreementNote}</p> : null}
    </section>
  );
}
/**
 * The New window's calendar statements, each a sentence the copy already words.
 *
 * `WINDOW_COPY.lengthDays` is deliberately not among them: the envelope states the last included date
 * and the wording that dates it but not the period's length in days, and counting from the
 * introduction date to the last included date would be the boundary arithmetic this panel must not
 * perform. The same absence applies to `CONTINUATION_WINDOW_COPY.elapsedSeconds`: a continued cycle's
 * deadline carries its resolved instant and no second count. Both would have to be published by the
 * referral read to be shown here.
 *
 * The exclusive-endpoint sentence names the zone and states that a read at that exact moment is
 * already Expired. It is the release's wording for a calendar-day endpoint, so it is used only where
 * the calendar rule behind that endpoint is known and agrees with the resolved instant; where the two
 * disagree the labelled comparison states both instead, and the sentence is left out rather than
 * rewritten to fit.
 */
function newWindowStatements(referral: ReferralWindowSource, deadline: ReferralDeadline, nominal: ReferralNominalWindow | null, disagrees: boolean): readonly string[] {
  const statements: string[] = [];
  const introductionOn = referral.originalIntroductionOn;
  if (introductionOn !== null && nominal !== null) {
    statements.push(WINDOW_COPY.dayOne(introductionOn));
  }
  if (nominal !== null && !disagrees) {
    statements.push(WINDOW_COPY.lastIncluded(nominal.lastIncludedOn));
    statements.push(WINDOW_COPY.exclusiveEndpoint(deadline.end, referral.sourceZone));
  }
  return statements;
}
interface WindowBodyProps {
  readonly referral: ReferralWindowSource;
  readonly nominalHeadingId: string;
}
/** Everything below the heading: the window this cycle carries, or the honest statement that it carries none. */
function WindowBody({ referral, nominalHeadingId }: WindowBodyProps): ReactElement {
  // A date that is approximate or unknown supports no deadline: the stored record is refused an
  // endpoint for it, so the surface says so and shows no endpoint, no Active or Expired word, no count
  // of days remaining and no progress affordance that could be read as a countdown.
  if (referral.datePrecision !== "date") {
    const precision = PRECISION_COPY[referral.datePrecision];
    return (
      // A static explanation rather than a live announcement: `role` is left off so rendering the
      // panel announces nothing, and the notice is read when a reader reaches it.
      <Alert role={undefined}>
        <AlertTitle>{precision.label}</AlertTitle>
        <AlertDescription>
          <p className="text-pretty">{NO_DEADLINE_NOTICE}</p>
          <p className="text-pretty">{precision.hint}</p>
        </AlertDescription>
      </Alert>
    );
  }
  if (referral.status.status === "refused") {
    return (
      <Alert role={undefined}>
        <AlertTitle>{STATUS_COPY.refused.label}</AlertTitle>
        <AlertDescription>
          <p className="text-pretty">{WINDOW_COPY.unresolvedWindow}</p>
          <p className="text-pretty">{STATUS_COPY.refused.description}</p>
        </AlertDescription>
      </Alert>
    );
  }
  const deadline = referral.deadline;
  if (deadline === null) {
    return <p className="text-pretty text-muted-foreground">{WINDOW_COPY.noWindowRecorded}</p>;
  }
  const nominal = deadline.nominal;
  const continued = referral.windowKind === "continued";
  const disagrees = nominal !== null && nominal.disagreesWithResolved;
  const statements = continued ? [] : newWindowStatements(referral, deadline, nominal, disagrees);
  const predecessor = referral.predecessorId;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {continued ? <p className="text-pretty">{CONTINUATION_WINDOW_COPY.explanation}</p> : null}
      {statements.length === 0 ? null : (
        <ul className="flex min-w-0 flex-col gap-1.5">
          {statements.map((statement) => (
            <li key={statement} className="text-pretty">
              {statement}
            </li>
          ))}
        </ul>
      )}
      {continued ? <p className="text-pretty text-muted-foreground">{CONTINUATION_WINDOW_COPY.elapsedNotCalendar}</p> : null}
      {continued || statements.length > 0 ? <Separator /> : null}
      {/* The two values are always stated under their own labels as well, because the sentences above
          embed them mid-sentence: this is where each supplied date and instant stands as its own
          machine-readable value, in the zone the envelope resolved it in. */}
      <NominalAndResolved
        headingId={nominalHeadingId}
        nominal={nominal}
        nominalUnavailableReason={deadline.nominalUnavailableReason}
        end={deadline.end}
        sourceZone={referral.sourceZone}
      />
      {continued ? <p className="text-pretty text-muted-foreground">{CONTINUATION_WINDOW_COPY.oneSuccessor}</p> : null}
      {predecessor === null ? null : (
        <p className="text-pretty">
          <span className="font-medium">{CONTINUATION_WINDOW_COPY.predecessorLabel}</span>{" "}
          <bdi className="mono-identifier break-all">{predecessor}</bdi>
        </p>
      )}
      <p className="text-pretty text-xs text-muted-foreground">{WINDOW_COPY.endpointResolvedOnce}</p>
    </div>
  );
}
/**
 * The window one referral cycle carries: where it stands, the calendar wording beside the resolved
 * end, and — for a date that cannot support a deadline — no deadline at all.
 *
 * `referral-detail` renders this in the detail body, under the surface's own section headings, so the
 * heading here is one level below them.
 */
export default function ReferralWindowPanel({ referral, dir, className }: ReferralWindowPanelProps): ReactElement {
  const idBase = idBaseOf(referral.referralId);
  const headingId = `${idBase}-heading`;
  const nominalHeadingId = `${idBase}-nominal`;
  const continued = referral.windowKind === "continued";
  // The heading names what the cycle actually carries: a continuation, a resolved New window, or the
  // cycle's window in general — the last for a date that cannot support a deadline, a window that could
  // not be read and a cycle with no window recorded, none of which is a New window to point at.
  const resolvedNewWindow = !continued && referral.deadline !== null;
  const heading = continued ? CONTINUATION_WINDOW_COPY.heading : resolvedNewWindow ? WINDOW_COPY.newWindowHeading : WINDOW_COPY.heading;
  const status = STATUS_COPY[referral.status.status];
  return (
    <section aria-labelledby={headingId} data-slot="referral-window-panel" dir={dir} className={cn("flex min-w-0 flex-col", className)}>
      <Card size="sm">
        <CardHeader>
          <CardTitle>
            <h3 id={headingId} className="text-pretty break-words">
              {heading}
            </h3>
          </CardTitle>
          <CardAction>
            <StatusBadge label={status.label} tone={WINDOW_STATUS_TONE[referral.status.status]} />
          </CardAction>
        </CardHeader>
        <CardContent className="text-sm">
          <WindowBody referral={referral} nominalHeadingId={nominalHeadingId} />
        </CardContent>
      </Card>
    </section>
  );
}
