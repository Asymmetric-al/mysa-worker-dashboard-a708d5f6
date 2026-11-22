/** `/coaching` — the worker's coaching overview: optional private preparation, the sharing state a coach can read right now, and the coaching screens this page leads to. */
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import { buttonVariants } from "@/components/ui/button";
import PreparationSurface, { type PreparationSurfaceProps } from "@/features/coaching/components/preparation-surface";
import type { CoachingGrantView, FinancialRange, GrantDurationView, ModuleRead, SharingOutcome } from "@/features/coaching/components/sharing-summary";
import { COACHING_COPY } from "@/features/coaching/copy";
import { cn } from "@/lib/cn";
import { reads } from "@/modules/data-service";
import SharingSummaryLocale from "./sharing-summary-locale";
// The envelope's own shape, taken from the read rather than restated
type CoachingOverviewResult = Awaited<ReturnType<typeof reads.coaching.readCoachingOverview>>;
type CoachingOverviewEnvelope = Extract<CoachingOverviewResult, { kind: "envelope" }>["envelope"];
type CoachingOverview = CoachingOverviewEnvelope["data"];
type CoachingRelationship = CoachingOverview["relationships"][number];
type RelationshipDuration = CoachingRelationship["duration"];
type PreparationRecordView = CoachingOverview["preparation"][number];
type PreparationView = PreparationSurfaceProps["preparation"];
/** The page title, from the family copy's own heading for this surface. */
export const metadata: Metadata = { title: COACHING_COPY.overview.heading };
const DESTINATIONS_LABEL = "Coaching destinations";
const DESTINATIONS = [
  { href: "/coaching/targets", label: COACHING_COPY.targets.heading },
  { href: "/coaching/coach", label: COACHING_COPY.coachPortfolio.heading },
] as const;
const DESTINATION_LINK_CLASS = "h-auto min-h-8 max-w-full whitespace-normal py-1.5";
function currentRelationshipOf(overview: CoachingOverview): CoachingRelationship | null {
  const live = overview.relationships.find((relationship) => relationship.grantId === overview.activeGrantId);
  return live ?? overview.relationships[0] ?? null;
}
function currentPreparationOf(records: CoachingOverview["preparation"]): PreparationRecordView | null {
  let current: PreparationRecordView | null = null;
  let latestDay = "";
  for (const record of records) {
    if (record.updatedOn === null) continue;
    if (current === null || record.updatedOn > latestDay) {
      current = record;
      latestDay = record.updatedOn;
    }
  }
  return current ?? records[0] ?? null;
}
function preparationViewOf(overview: CoachingOverview): PreparationView {
  const record = currentPreparationOf(overview.preparation);
  if (record === null) return null;
  return { body: record.body ?? "", updatedOn: record.updatedOn, audience: "private" };
}
function outcomeOf(reached: boolean): SharingOutcome {
  return reached ? "reached" : "not-reached";
}
function durationViewOf(duration: RelationshipDuration): GrantDurationView {
  if (duration.kind === "ongoing") return { kind: "ongoing" };
  if (duration.kind === "none") return { kind: "none" };
  return { kind: "through-date", throughDate: duration.shareThroughDate };
}
function grantViewOf(relationship: CoachingRelationship): CoachingGrantView {
  const readable = relationship.outcomes.accessLive;
  const modules: readonly ModuleRead[] = readable ? relationship.admittedModules.map((admitted) => ({ key: admitted.module, readState: admitted.readState })) : [];
  return {
    state: relationship.state,
    availability: relationship.availability,
    modules,
    duration: durationViewOf(relationship.duration),
    shareCutoff: { instant: relationship.duration.cutoffInstant ?? relationship.duration.boundInstant ?? "", zone: relationship.duration.frozenZone ?? "", sourceLimitWins: relationship.duration.boundedBy === "source" },
    // The range this relationship's own record states, passed through as the read projected it: the period, the one
    // currency and the figure a coach reads for it, or no range at all when the record states none.
    financialRange: financialRangeOf(relationship),
    outcomes: { delivery: outcomeOf(relationship.outcomes.invitationIssued), identityVerification: outcomeOf(relationship.outcomes.identityVerified), acceptance: outcomeOf(relationship.outcomes.accepted), access: outcomeOf(relationship.outcomes.accessLive) },
  };
}

/** One relationship's reviewed range in the summary's own shape, with nothing derived here: the read computed the figure. */
function financialRangeOf(relationship: CoachingRelationship): FinancialRange | null {
  const range = relationship.financialRange;
  return range === null ? null : { from: range.from, to: range.to, currency: range.currency, money: range.money, valueState: range.valueState };
}
/** The worker's coaching overview. */
export default async function CoachingPage(): Promise<ReactElement> {
  const result = await reads.coaching.readCoachingOverview();
  if (result.kind === "denied") {
    return (
      <div className="flex min-w-0 flex-col gap-6 text-start">
        <StateNotice kind="denied" headingLevel={1} title={COACHING_COPY.overview.heading} reasonCode={result.denied.reasonCode} />
      </div>
    );
  }
  if (result.kind === "unavailable") {
    return (
      <div className="flex min-w-0 flex-col gap-6 text-start">
        <StateNotice kind="unavailable" headingLevel={1} title={COACHING_COPY.overview.heading} description={COACHING_COPY.overview.unavailable} source={result.unavailable.source} />
      </div>
    );
  }
  if (result.kind === "refused") {
    // This route calls the read directly, so the request is its own and never one a handler refuses: the arm is stated the same way as the others rather than thrown, and the notice's own sentence says the request was refused rather than the source failing.
    return (
      <div className="flex min-w-0 flex-col gap-6 text-start">
        <StateNotice kind="refused" headingLevel={1} title={COACHING_COPY.overview.heading} />
      </div>
    );
  }
  const overview = result.envelope.data;
  const relationship = currentRelationshipOf(overview);
  const grant = relationship === null ? null : grantViewOf(relationship);
  return (
    <div className="flex min-w-0 flex-col gap-6 text-start">
      {/* The one h1 on this page, from the family's copy: the composed surfaces open their own
          sections at level two, so the outline starts here. */}
      <h1 className="text-2xl font-semibold text-pretty wrap-anywhere">{COACHING_COPY.overview.heading}</h1>
      <nav aria-label={DESTINATIONS_LABEL} className="min-w-0">
        <ul className="flex flex-wrap gap-2">
          {DESTINATIONS.map((destination) => (
            <li key={destination.href} className="min-w-0">
              <Link href={destination.href} className={cn(buttonVariants({ variant: "outline", size: "sm" }), DESTINATION_LINK_CLASS)}>
                {destination.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {/* Prepare first, then share: the order the worker's own decision takes. */}
      <PreparationSurface preparation={preparationViewOf(overview)} />
      {/* The summary formats money in the reader's interface locale, which only the client composition
          beside this route can read; the route itself never states a locale. */}
      <SharingSummaryLocale grant={grant} />
    </div>
  );
}
