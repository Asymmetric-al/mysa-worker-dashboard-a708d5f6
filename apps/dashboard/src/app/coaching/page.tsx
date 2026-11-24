import type { Metadata } from "next";
import Link from "next/link";
import type { ReactElement } from "react";
import { buttonVariants, BUTTON_WRAP_CLASS } from "@/components/ui/button";
import PreparationSurface, { type PreparationSurfaceProps } from "@/features/coaching/components/preparation-surface";
import type { CoachingGrantView, FinancialRange, GrantDurationView, ModuleRead, SharingOutcome } from "@/features/coaching/components/sharing-summary";
import { COACHING_COPY } from "@/features/coaching/copy";
import { cn } from "@/lib/cn";
import { reads } from "@/modules/data-service";
import { PageColumn, PageHeading, pageRefusalOf, type ReadNoticeCopy } from "../page-frame";
import SharingSummaryLocale from "./sharing-summary-locale";
type CoachingOverviewEnvelope = Extract<Awaited<ReturnType<typeof reads.coaching.readCoachingOverview>>, { kind: "envelope" }>["envelope"];
type CoachingOverview = CoachingOverviewEnvelope["data"];
type CoachingRelationship = CoachingOverview["relationships"][number];
type PreparationRecordView = CoachingOverview["preparation"][number];
export const metadata: Metadata = { title: COACHING_COPY.overview.heading };
/** The path this page answers on: the destination strip marks it as the destination the reader is on, and nothing else. */ const PAGE_PATH = "/coaching";
const DESTINATIONS = [
  { href: PAGE_PATH, label: COACHING_COPY.overview.heading },
  { href: "/coaching/targets", label: COACHING_COPY.targets.heading },
  { href: "/coaching/coach", label: COACHING_COPY.coachPortfolio.heading },
] as const;
const currentRelationshipOf = (overview: CoachingOverview): CoachingRelationship | null => overview.relationships.find((relationship) => relationship.grantId === overview.activeGrantId) ?? overview.relationships[0] ?? null;
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
function preparationViewOf(overview: CoachingOverview): PreparationSurfaceProps["preparation"] {
  const record = currentPreparationOf(overview.preparation);
  if (record === null) return null;
  return { body: record.body ?? "", updatedOn: record.updatedOn, audience: "private" };
}
const outcomeOf = (reached: boolean): SharingOutcome => (reached ? "reached" : "not-reached");
function durationViewOf(duration: CoachingRelationship["duration"]): GrantDurationView {
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
    financialRange: financialRangeOf(relationship), // The range this relationship's own record states, passed through as the read projected it: the period, the one currency and the figure a coach reads for it, or no range at all when the record states none.
    outcomes: { delivery: outcomeOf(relationship.outcomes.invitationIssued), identityVerification: outcomeOf(relationship.outcomes.identityVerified), acceptance: outcomeOf(relationship.outcomes.accepted), access: outcomeOf(relationship.outcomes.accessLive) },
  };
}
/** One relationship's reviewed range in the summary's own shape, with nothing derived here: the read computed the figure. */ const financialRangeOf = (relationship: CoachingRelationship): FinancialRange | null =>
  relationship.financialRange === null ? null : { from: relationship.financialRange.from, to: relationship.financialRange.to, currency: relationship.financialRange.currency, money: relationship.financialRange.money, valueState: relationship.financialRange.valueState };
const NOTICE_COPY: ReadNoticeCopy = { headingLevel: 1, denied: { title: COACHING_COPY.overview.heading }, unavailable: { title: COACHING_COPY.overview.heading, body: COACHING_COPY.overview.unavailable }, refused: { title: COACHING_COPY.overview.heading } };
/** The worker's coaching overview. */ export default async function CoachingPage(): Promise<ReactElement> {
  const result = await reads.coaching.readCoachingOverview();
  if (result.kind !== "envelope") return pageRefusalOf(result, NOTICE_COPY);
  const overview = result.envelope.data;
  const relationship = currentRelationshipOf(overview);
  const grant = relationship === null ? null : grantViewOf(relationship);
  return (
    <PageColumn>
      <PageHeading title={COACHING_COPY.overview.heading} />
      <nav aria-label="Coaching destinations" className="min-w-0">
        <ul className="flex flex-wrap gap-2">
          {DESTINATIONS.map((destination) => {
            const current = destination.href === PAGE_PATH;
            return (
              <li key={destination.href} className="min-w-0">
                <Link href={destination.href} data-slot="button" aria-current={current ? "page" : undefined} className={cn(buttonVariants({ variant: current ? "secondary" : "outline", size: "sm" }), BUTTON_WRAP_CLASS)}>
                  {destination.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <PreparationSurface preparation={preparationViewOf(overview)} />
      <SharingSummaryLocale grant={grant} />
    </PageColumn>
  );
}
