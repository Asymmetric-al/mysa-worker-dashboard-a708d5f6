/**
 * `/coaching` — the worker's coaching overview: optional private preparation, the sharing state a
 * coach can read right now, and the coaching screens this page leads to.
 *
 * **One read, on the server.** The page is a Server Component and calls
 * `reads.coaching.readCoachingOverview()` in process. It never fetches `/api/coaching`, because a
 * server read must take the same authorisation path the browser handler takes rather than paying a
 * second round trip for data it can already reach, and because scope is derived from the development
 * session inside the service — never from a parameter this file could pass.
 *
 * **The result is the closed contract, and every arm is rendered.** `envelope` composes the two
 * coaching surfaces; `denied` and `unavailable` render `components/state-notice`. A denial states the
 * surface and the reason code and nothing else — no count, no module name, no cutoff, no existence
 * hint — because authorisation precedes enumeration, and this file must not become the place where a
 * refused read is turned into an empty-looking workspace. An unavailable source is the outage, never
 * an empty list and never a zero.
 *
 * **What this file composes, and what it deliberately does not.** The headings, module vocabulary,
 * grant states, the four sharing outcomes and the cutoff sentence belong to the family
 * (`features/coaching/components/*` and `features/coaching/copy`); this file maps the envelope onto
 * their prop shapes and adds no wording of its own beyond the destination labels and the page title,
 * which come from the same copy module. Nothing here reads a clock, formats money or computes a
 * percentage: every value is rendered as the read reported it.
 *
 * **Two projections the overview read does not carry, stated here rather than invented later.**
 *
 * 1. *Preparation text.* The read reports the worker's private preparation records (identity, title,
 *    tags, revision) and not their prose. The surface's absent state would claim the worker has
 *    prepared nothing, so the record the read does report is rendered instead, with no date filled in
 *    for one the envelope did not state.
 * 2. *The share-through day.* The read states the resolved exclusive bound and its zone, not the
 *    civil date the worker chose, so the bound is rendered verbatim by `sharing-summary` and no date
 *    is derived from it here — deriving one would move a frozen cutoff, which is the one thing a
 *    cutoff must never do.
 *
 * The financial range is absent for the same reason: the overview read states none, so the summary
 * renders its own "no range reviewed" sentence instead of a figure this file invented.
 *
 * **Landmarks.** The shell above this route owns the single `main` landmark, the navigation rail, the
 * context indicator and the persistent Development data label; this file adds none of them. It renders
 * exactly one `h1` — the family's own heading for this surface, which no component supplies — above
 * the two `h2` sections the composed surfaces render, so the document outline has a head rather than
 * starting at level two.
 *
 * **Reachability.** Every coaching destination is reachable from here with one link, and each appears
 * once. `PreparationSurface` already links to `/coaching/check-ins` and `SharingSummary` to
 * `/coaching/sharing` in every state either can render, so this file lists only the two those
 * surfaces cannot reach. Adding them here as well would give one destination two links on one page.
 *
 * Direction is a property of the content, so spacing is logical and the column starts at the reading
 * edge; every value that may be mixed-direction is isolated inside the composing surface. Nothing
 * here scrolls horizontally, so the page reflows to one column at 320 CSS pixels.
 */

import type { Metadata } from "next";
import Link from "next/link";
import type { ReactElement } from "react";

import StateNotice from "@/components/state-notice";
import { buttonVariants } from "@/components/ui/button";
import PreparationSurface, {
  type PreparationSurfaceProps,
} from "@/features/coaching/components/preparation-surface";
import SharingSummary, {
  type CoachingGrantView,
  type GrantDurationView,
  type ModuleRead,
  type SharingOutcome,
} from "@/features/coaching/components/sharing-summary";
import { COACHING_COPY } from "@/features/coaching/copy";
import { cn } from "@/lib/cn";
import { reads } from "@/modules/data-service";

// ---------------------------------------------------------------------------------------------
// The envelope's own shape, taken from the read rather than restated
// ---------------------------------------------------------------------------------------------

/**
 * The overview read's types, inferred from the service.
 *
 * The view interfaces inside `data-service/reads/coaching.ts` are deliberately not exported, so a
 * route could not redeclare them into agreement with the service even if it wanted to: the shape
 * below is whatever the read actually returns. That keeps one declaration of "what a coaching
 * overview is" and makes a change to the read a compile error here rather than a silent mismatch.
 */
type CoachingOverviewResult = Awaited<ReturnType<typeof reads.coaching.readCoachingOverview>>;
type CoachingOverviewEnvelope = Extract<CoachingOverviewResult, { kind: "envelope" }>["envelope"];
type CoachingOverview = CoachingOverviewEnvelope["data"];
type CoachingRelationship = CoachingOverview["relationships"][number];
type RelationshipDuration = CoachingRelationship["duration"];

/** The preparation record the surface accepts, taken from its own props. */
type PreparationView = PreparationSurfaceProps["preparation"];

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/**
 * The page title, from the family copy's own heading for this surface.
 *
 * The root layout's template appends the application name, so this states the surface and nothing
 * that duplicates the document title.
 */
export const metadata: Metadata = {
  title: COACHING_COPY.overview.heading,
};

/** The destination list's accessible name. */
const DESTINATIONS_LABEL = "Coaching destinations";

/**
 * The two coaching destinations neither composed surface links to.
 *
 * Each label is the family's heading for that surface, so the link and the destination are named
 * once. `/coaching/check-ins` and `/coaching/sharing` are reached through `PreparationSurface` and
 * `SharingSummary`, which are the components that own the work those destinations do.
 */
const DESTINATIONS = [
  { href: "/coaching/targets", label: COACHING_COPY.targets.heading },
  { href: "/coaching/coach", label: COACHING_COPY.coachPortfolio.heading },
] as const;

/**
 * A destination control that may wrap instead of painting past the column's inline edge.
 *
 * The design system's button is a single-line pill: at 320 CSS pixels a longer label such as
 * "Coaching relationships" would overflow. Allowing the label to wrap keeps the padding, radius and
 * focus ring intact while the control grows tall enough for two lines, still above the 24x24 CSS
 * pixel target floor.
 */
const DESTINATION_LINK_CLASS = "h-auto min-h-8 max-w-full whitespace-normal py-1.5";

/**
 * The display locale the summary formats through when it is given a financial range.
 *
 * A stored viewer preference lives in the browser, and a Server Component cannot read it, so the
 * interface's default is stated here rather than guessed from the host: the host's locale is a
 * property of the machine that rendered the page, not of the reader. The overview read carries no
 * financial range today, so this value formats nothing; it is declared so the composition is
 * complete and so the summary never falls back to the host's locale on its own.
 */
const DISPLAY_LOCALE = "en";

// ---------------------------------------------------------------------------------------------
// The envelope mapped onto the family's props
// ---------------------------------------------------------------------------------------------

/**
 * The relationship this page reports as the worker's current sharing state.
 *
 * The read names the live episode, and that is the one a worker means by "what my coach can read
 * now". When no episode is live, the first relationship the read reported is rendered instead, so a
 * revoked or ended sharing is still visible to the worker who closed it rather than reading as a
 * relationship that never existed. When the worker holds none, `null` lets the summary offer its
 * real first action instead of an empty panel.
 */
function currentRelationshipOf(overview: CoachingOverview): CoachingRelationship | null {
  const live = overview.relationships.find(
    (relationship) => relationship.grantId === overview.activeGrantId,
  );
  return live ?? overview.relationships[0] ?? null;
}

/**
 * The preparation record to render, or `null` when the worker holds none.
 *
 * See the header: the read projects preparation records without their text, so the record it does
 * report is rendered as the surface's preparation. `updatedOn` is `null` because the read states no
 * date — a missing date is left missing rather than filled in with today's.
 */
function preparationViewOf(overview: CoachingOverview): PreparationView {
  const record = overview.preparation[0];
  if (record === undefined) return null;
  return { body: record.displayName, updatedOn: null, audience: "private" };
}

/** One outcome flag as the summary's own three states. A recorded flag is never `unknown`. */
function outcomeOf(reached: boolean): SharingOutcome {
  return reached ? "reached" : "not-reached";
}

/**
 * The duration as the summary reads it.
 *
 * An ongoing share says so. Every other shape renders the bound the read resolved — the exclusive
 * instant, in the zone it was frozen in — verbatim: the civil share-through date the worker chose is
 * not part of this read, and converting the bound back into a calendar day would be window
 * arithmetic this file must not perform. A record that states no usable bound renders an empty
 * bound, which the summary already reports as a share that closes on no date.
 */
function durationViewOf(duration: RelationshipDuration): GrantDurationView {
  if (duration.kind === "ongoing") return { kind: "ongoing" };
  return {
    kind: "through-date",
    throughDate: duration.cutoffInstant ?? duration.boundInstant ?? "",
  };
}

/**
 * The grant as `sharing-summary` renders it, built only from facts the read stated.
 *
 * - `availability` states what the read itself admitted the episode under: the source answered (an
 *   outage would have returned `unavailable` for the whole read) and the access context carries no
 *   permission hold.
 * - `modules` lists the modules a coach can read *now*. While access is live, every selected module
 *   is admitted and is listed as shared; when access is not live — an unaccepted invitation, a
 *   revocation, an ended episode, a reached cutoff — nothing is readable, so no module is listed and
 *   the lifecycle row above states why.
 * - `outcomes` are the four separate flags the read reports as four separate rows, so an invitation
 *   existing never reads as access, and no row claims a message arrived.
 * - `financialRange` is `null` because the overview read states none, which is the only honest answer
 *   available to a surface that must never rebuild a figure.
 */
function grantViewOf(relationship: CoachingRelationship): CoachingGrantView {
  const readable = relationship.outcomes.accessLive;
  const modules: readonly ModuleRead[] = readable
    ? relationship.selectedModules.map((key) => ({ key, readState: null }))
    : [];

  return {
    state: relationship.state,
    availability: { source: "available", permissionHold: "none" },
    modules,
    duration: durationViewOf(relationship.duration),
    shareCutoff: {
      instant: relationship.duration.cutoffInstant ?? relationship.duration.boundInstant ?? "",
      zone: relationship.duration.frozenZone ?? "",
      sourceLimitWins: relationship.duration.boundedBy === "source",
    },
    financialRange: null,
    outcomes: {
      delivery: outcomeOf(relationship.outcomes.invitationIssued),
      identityVerification: outcomeOf(relationship.outcomes.identityVerified),
      acceptance: outcomeOf(relationship.outcomes.accepted),
      access: outcomeOf(relationship.outcomes.accessLive),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------------------------

/**
 * The worker's coaching overview.
 *
 * One read and three rendering arms: the two surfaces for an envelope, the one notice for a refusal
 * and the one notice for an outage. No `try`/`catch` converts a failure into an empty page — the
 * service already answers with `unavailable`, and a thrown error belongs to the route segment's own
 * boundary, not to a handler that would hide it.
 */
export default async function CoachingPage(): Promise<ReactElement> {
  const result = await reads.coaching.readCoachingOverview();

  if (result.kind === "denied") {
    return (
      <div className="flex min-w-0 flex-col gap-6 text-start">
        <StateNotice
          kind="denied"
          headingLevel={1}
          title={COACHING_COPY.overview.heading}
          reasonCode={result.denied.reasonCode}
        />
      </div>
    );
  }

  if (result.kind === "unavailable") {
    return (
      <div className="flex min-w-0 flex-col gap-6 text-start">
        <StateNotice
          kind="unavailable"
          headingLevel={1}
          title={COACHING_COPY.overview.heading}
          description={COACHING_COPY.overview.unavailable}
          source={result.unavailable.source}
        />
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
      <h1 className="text-2xl font-semibold text-pretty wrap-anywhere">
        {COACHING_COPY.overview.heading}
      </h1>
      <nav aria-label={DESTINATIONS_LABEL} className="min-w-0">
        <ul className="flex flex-wrap gap-2">
          {DESTINATIONS.map((destination) => (
            <li key={destination.href} className="min-w-0">
              <Link
                href={destination.href}
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  DESTINATION_LINK_CLASS,
                )}
              >
                {destination.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {/* Prepare first, then share: the order the worker's own decision takes. */}
      <PreparationSurface preparation={preparationViewOf(overview)} />
      <SharingSummary grant={grant} locale={DISPLAY_LOCALE} />
    </div>
  );
}
