import type { ReactElement, ReactNode } from "react";
import StatusBadge, { type StatusTone } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { reads } from "@/modules/data-service";
import { CONTINUATION_WINDOW_COPY, NOMINAL_VS_RESOLVED, NO_DEADLINE_NOTICE, PRECISION_COPY, STATUS_COPY, WINDOW_COPY, type ReferralStatusWord } from "../copy";
// The referral detail read's own types, narrowed to the facts this panel renders: the service is reached only through its published surface, so no shape is restated by hand.
type ReferralDetailEnvelope = Extract<Awaited<ReturnType<typeof reads.referrals.readReferral>>, { readonly kind: "envelope" }>["envelope"];
type ReferralDetailData = ReferralDetailEnvelope["data"];
type ReferralDetailRow = Extract<ReferralDetailData, { readonly view: "detail" }>["referral"];
type ReferralDeadline = NonNullable<ReferralDetailRow["deadline"]>;
type ReferralNominalWindow = NonNullable<ReferralDeadline["nominal"]>;
export type ReferralWindowSource = Pick<ReferralDetailRow, "referralId" | "datePrecision" | "originalIntroductionOn" | "sourceZone" | "windowKind" | "status" | "deadline" | "predecessorId">;
export type ReferralWindowPanelProps = { readonly referral: ReferralWindowSource; readonly dir?: "ltr" | "rtl"; readonly className?: string };
const WINDOW_STATUS_TONE: Readonly<Record<ReferralStatusWord, StatusTone>> = { active: "positive", expired: "neutral", "no-deadline": "muted", refused: "caution", withdrawn: "neutral", revoked: "danger", erased: "muted", departed: "neutral" };
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
function Fact({ term, children }: { readonly term: string; readonly children: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
      <dt className="shrink-0 text-muted-foreground">{term}</dt>
      <dd className="flex min-w-0 flex-col gap-1 break-words">{children}</dd>
    </div>
  );
}
type NominalAndResolvedProps = { readonly headingId: string; readonly nominal: ReferralNominalWindow | null; readonly nominalUnavailableReason: string | null; readonly end: string; readonly sourceZone: string };
/** The calendar wording and the resolved end, kept as two labelled facts: never merged and never reconciled here. */
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
type WindowBodyProps = { readonly referral: ReferralWindowSource; readonly nominalHeadingId: string };
function WindowBody({ referral, nominalHeadingId }: WindowBodyProps): ReactElement {
  // A date that is approximate or unknown supports no deadline: the surface says so and shows no endpoint, no Active or Expired word and no countdown.
  if (referral.datePrecision !== "date") {
    const precision = PRECISION_COPY[referral.datePrecision];
    return (
      // A static explanation rather than a live announcement: `role` is left off so rendering the panel announces nothing.
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
      <NominalAndResolved headingId={nominalHeadingId} nominal={nominal} nominalUnavailableReason={deadline.nominalUnavailableReason} end={deadline.end} sourceZone={referral.sourceZone} />
      {continued ? <p className="text-pretty text-muted-foreground">{CONTINUATION_WINDOW_COPY.oneSuccessor}</p> : null}
      {predecessor === null ? null : (
        <p className="text-pretty">
          <span className="font-medium">{CONTINUATION_WINDOW_COPY.predecessorLabel}</span> <bdi className="mono-identifier break-all">{predecessor}</bdi>
        </p>
      )}
      <p className="text-pretty text-xs text-muted-foreground">{WINDOW_COPY.endpointResolvedOnce}</p>
    </div>
  );
}
export default function ReferralWindowPanel({ referral, dir, className }: ReferralWindowPanelProps): ReactElement {
  const idBase = `referral-window-${referral.referralId.replace(/[^A-Za-z0-9_-]+/gu, "-")}`;
  const headingId = `${idBase}-heading`;
  const nominalHeadingId = `${idBase}-nominal`;
  const continued = referral.windowKind === "continued";
  // The heading names what the cycle actually carries: a continuation, a resolved New window, or its window in general — never a New window to point at where there is none.
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
