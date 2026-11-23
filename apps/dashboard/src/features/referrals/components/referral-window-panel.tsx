import type { ReactElement, ReactNode } from "react";
import StatusBadge, { type StatusTone } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { reads } from "@/modules/data-service";
import { CONTINUATION_WINDOW_COPY, NOMINAL_VS_RESOLVED, NO_DEADLINE_NOTICE, PRECISION_COPY, STATUS_COPY, WINDOW_COPY, type ReferralStatusWord } from "../copy";
type ReferralDetailEnvelope = Extract<Awaited<ReturnType<typeof reads.referrals.readReferral>>, { readonly kind: "envelope" }>["envelope"];
type ReferralDetailData = ReferralDetailEnvelope["data"];
type ReferralDetailRow = Extract<ReferralDetailData, { readonly view: "detail" }>["referral"];
type ReferralDeadline = NonNullable<ReferralDetailRow["deadline"]>;
type ReferralNominalWindow = NonNullable<ReferralDeadline["nominal"]>;
export type ReferralWindowSource = Pick<ReferralDetailRow, "referralId" | "datePrecision" | "originalIntroductionOn" | "sourceZone" | "windowKind" | "status" | "deadline" | "predecessorId">;
export type ReferralWindowPanelProps = { readonly referral: ReferralWindowSource; readonly dir?: "ltr" | "rtl"; readonly className?: string };
const WINDOW_STATUS_TONE: Readonly<Record<ReferralStatusWord, StatusTone>> = { active: "positive", expired: "neutral", "no-deadline": "muted", refused: "caution", withdrawn: "neutral", revoked: "danger", erased: "muted", departed: "neutral" };
const EnvelopeValue = ({ value }: { readonly value: string }): ReactElement => (
  <bdi>
    <time className="tabular-figures" dateTime={value}>
      {value}
    </time>
  </bdi>
);
const Fact = ({ term, children }: { readonly term: string; readonly children: ReactNode }): ReactElement => (
  <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
    <dt className="shrink-0 text-muted-foreground">{term}</dt>
    <dd className="flex min-w-0 flex-col gap-1 break-words">{children}</dd>
  </div>
);
type NominalAndResolvedProps = { readonly headingId: string; readonly nominal: ReferralNominalWindow | null; readonly nominalUnavailableReason: string | null; readonly end: string; readonly sourceZone: string };
function NominalAndResolved({ headingId, nominal, nominalUnavailableReason, end, sourceZone }: NominalAndResolvedProps): ReactElement {
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2">
      <h4 id={headingId} className="type-group-title text-pretty">
        {NOMINAL_VS_RESOLVED.heading}
      </h4>
      <dl className="flex min-w-0 flex-col gap-2">
        <Fact term={NOMINAL_VS_RESOLVED.nominalLabel}>
          {nominal === null ? (
            <>
              <p className="type-supporting text-pretty">{NOMINAL_VS_RESOLVED.nominalUnavailable}</p>
              {nominalUnavailableReason === null ? null : <p className="type-supporting text-pretty">{nominalUnavailableReason}</p>}
            </>
          ) : (
            <>
              <p className="type-body">
                <EnvelopeValue value={nominal.lastIncludedOn} />
              </p>
              <p className="type-supporting text-pretty">{nominal.wording}</p>
            </>
          )}
        </Fact>
        <Fact term={NOMINAL_VS_RESOLVED.resolvedLabel}>
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 type-body">
            <EnvelopeValue value={end} />
            <bdi className="break-all">{sourceZone}</bdi>
          </p>
        </Fact>
      </dl>
      {nominal !== null && nominal.disagreesWithResolved ? <p className="type-supporting text-pretty">{NOMINAL_VS_RESOLVED.disagreementNote}</p> : null}
    </section>
  );
}
function newWindowStatements(referral: ReferralWindowSource, deadline: ReferralDeadline, nominal: ReferralNominalWindow | null, disagrees: boolean): readonly string[] {
  const statements: string[] = [];
  const introductionOn = referral.originalIntroductionOn;
  if (introductionOn !== null && nominal !== null) statements.push(WINDOW_COPY.dayOne(introductionOn));
  if (nominal !== null && !disagrees) statements.push(WINDOW_COPY.lastIncluded(nominal.lastIncludedOn), WINDOW_COPY.exclusiveEndpoint(deadline.end, referral.sourceZone));
  return statements;
}
function WindowNotice({ title, lines }: { readonly title: string; readonly lines: readonly string[] }): ReactElement {
  return (
    <Alert role={undefined}>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        {lines.map((line) => (
          <p key={line} className="type-supporting text-pretty">
            {line}
          </p>
        ))}
      </AlertDescription>
    </Alert>
  );
}
function WindowBody({ referral, nominalHeadingId }: { readonly referral: ReferralWindowSource; readonly nominalHeadingId: string }): ReactElement {
  const precision = PRECISION_COPY[referral.datePrecision];
  const notice = referral.datePrecision !== "date" ? { title: precision.label, lines: [NO_DEADLINE_NOTICE, precision.hint] } : referral.status.status === "refused" ? { title: STATUS_COPY.refused.label, lines: [WINDOW_COPY.unresolvedWindow, STATUS_COPY.refused.description] } : null;
  if (notice !== null) return <WindowNotice title={notice.title} lines={notice.lines} />;
  const deadline = referral.deadline;
  if (deadline === null) return <p className="type-supporting text-pretty">{WINDOW_COPY.noWindowRecorded}</p>;
  const nominal = deadline.nominal;
  const continued = referral.windowKind === "continued";
  const statements = continued ? [] : newWindowStatements(referral, deadline, nominal, nominal !== null && nominal.disagreesWithResolved);
  const predecessor = referral.predecessorId;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {continued ? <p className="type-supporting text-pretty">{CONTINUATION_WINDOW_COPY.explanation}</p> : null}
      {statements.length === 0 ? null : (
        <ul className="flex min-w-0 flex-col gap-1.5">
          {statements.map((statement) => (
            <li key={statement} className="text-pretty">
              {statement}
            </li>
          ))}
        </ul>
      )}
      {continued ? <p className="type-supporting text-pretty">{CONTINUATION_WINDOW_COPY.elapsedNotCalendar}</p> : null}
      {continued || statements.length > 0 ? <Separator /> : null}
      <NominalAndResolved headingId={nominalHeadingId} nominal={nominal} nominalUnavailableReason={deadline.nominalUnavailableReason} end={deadline.end} sourceZone={referral.sourceZone} />
      {continued ? <p className="type-supporting text-pretty">{CONTINUATION_WINDOW_COPY.oneSuccessor}</p> : null}
      {predecessor === null ? null : (
        <p className="type-body text-pretty">
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
  const heading = continued ? CONTINUATION_WINDOW_COPY.heading : !continued && referral.deadline !== null ? WINDOW_COPY.newWindowHeading : WINDOW_COPY.heading;
  const status = STATUS_COPY[referral.status.status];
  return (
    <section aria-labelledby={headingId} data-slot="referral-window-panel" dir={dir} className={cn("flex min-w-0 flex-col", className)}>
      <Card>
        <CardHeader>
          <CardTitle>
            <h3 id={headingId} className="type-subsection-title text-pretty break-words">
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
