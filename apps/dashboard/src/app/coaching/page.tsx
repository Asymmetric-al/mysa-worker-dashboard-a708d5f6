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
 * which come from the same copy module. The sharing summary is composed through
 * `./sharing-summary-locale`, which supplies the reader's interface locale from the shell's one
 * preference provider: a Server Component cannot read a browser preference, and the coaching family may
 * not import the shell feature that owns it, so that single composition lives beside this route.
 * Nothing here reads a clock, formats money or computes a percentage: every value is rendered as the
 * read reported it.
 *
 * **Every value this page shows is the read's own.** The overview read carries the private
 * preparation's prose — the principal's own latest note on the record, with the civil day it stands for
 * — the relationship's availability, the one state each admitted module was read in, and the civil
 * Share-through day the frozen cutoff implies. This file chooses which preparation record is current
 * and maps those facts onto the surfaces' props; it derives none of them. In particular it converts no
 * instant into a calendar day, because that conversion is the calendar rule `modules/time` owns and a
 * second implementation of it could move a frozen cutoff, which is the one thing a cutoff must never do.
 *
 * The financial range is absent because the overview read states none, so the summary renders its own
 * "no range reviewed" sentence instead of a figure this file invented.
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
import type {
  CoachingGrantView,
  GrantDurationView,
  ModuleRead,
  SharingOutcome,
} from "@/features/coaching/components/sharing-summary";
import { COACHING_COPY } from "@/features/coaching/copy";
import { cn } from "@/lib/cn";
import { reads } from "@/modules/data-service";

import SharingSummaryLocale from "./sharing-summary-locale";

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

/** One private preparation record as the overview read projects it. */
type PreparationRecordView = CoachingOverview["preparation"][number];

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
 * The preparation record to present: the one that was written to most recently.
 *
 * The read states each record's own prose and the civil day that prose stands for, and reports the
 * records in its own order — by name. A worker's current preparation is the one updated last, so the
 * record is chosen by the day it states; when no record states a day, because nothing has been written
 * on any of them, the read's own first record is presented, since a record with an empty body is still a
 * record. `null` is reserved for a worker holding no preparation record at all.
 */
function currentPreparationOf(
  records: CoachingOverview["preparation"],
): PreparationRecordView | null {
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

/**
 * The preparation as the surface renders it, built from the record the read projected.
 *
 * The body is the record class's own prose and the date is the day the read resolved for it; both are
 * passed through unchanged. An absent body becomes an empty string so the surface states that the
 * preparation has no text in it yet, and a day the read did not state stays absent rather than being
 * filled in with today's.
 */
function preparationViewOf(overview: CoachingOverview): PreparationView {
  const record = currentPreparationOf(overview.preparation);
  if (record === null) return null;
  return { body: record.body ?? "", updatedOn: record.updatedOn, audience: "private" };
}

/** One outcome flag as the summary's own three states. A recorded flag is never `unknown`. */
function outcomeOf(reached: boolean): SharingOutcome {
  return reached ? "reached" : "not-reached";
}

/**
 * The duration as the summary reads it, in the read's own three states.
 *
 * The overview read states which of the three a relationship stands in — an open-ended share, a share
 * bound to a Share-through day, or a record carrying no usable duration at all — and it states the
 * civil day the frozen cutoff implies, in its stored `YYYY-MM-DD` form. All of that is passed through
 * as it was read: this file converts no instant into a calendar day, because that conversion is the
 * calendar rule `modules/time` owns and a frozen bound must never be moved by a second implementation
 * of it. A `through-date` whose day the read could not resolve passes `null` rather than an empty
 * string, so the summary can say that no day could be resolved instead of rendering a blank one.
 */
function durationViewOf(duration: RelationshipDuration): GrantDurationView {
  if (duration.kind === "ongoing") return { kind: "ongoing" };
  if (duration.kind === "none") return { kind: "none" };
  return { kind: "through-date", throughDate: duration.shareThroughDate };
}

/**
 * The grant as `sharing-summary` renders it, built only from facts the read stated.
 *
 * - `availability` is the read's own answer, passed through unchanged: whether the source behind the
 *   modules a coach can read answered, and whether a permission hold is in force. Neither is inferred
 *   here — a whole-read outage returns `unavailable` for this route, so a source that answered for one
 *   module and not another reaches the summary as that module's state, not as a page-level outage.
 * - `modules` lists the modules a coach can read *now*, each with the single state the read found it
 *   in, so an empty, partly covered, held, unavailable or ended module is distinguishable on the
 *   surface. When access is not live — an unaccepted invitation, a revocation, an ended episode, a
 *   reached cutoff — nothing is readable, so the read reports no admitted module and nothing is listed;
 *   the lifecycle row above states why.
 * - `outcomes` are the four separate flags the read reports as four separate rows, so an invitation
 *   existing never reads as access, and no row claims a message arrived.
 * - `financialRange` is `null` because the overview read states none, which is the only honest answer
 *   available to a surface that must never rebuild a figure.
 */
function grantViewOf(relationship: CoachingRelationship): CoachingGrantView {
  const readable = relationship.outcomes.accessLive;
  const modules: readonly ModuleRead[] = readable
    ? relationship.admittedModules.map((admitted) => ({
        key: admitted.module,
        readState: admitted.readState,
      }))
    : [];

  return {
    state: relationship.state,
    availability: relationship.availability,
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
      {/* The summary formats money in the reader's interface locale, which only the client composition
          beside this route can read; the route itself never states a locale. */}
      <SharingSummaryLocale grant={grant} />
    </div>
  );
}
