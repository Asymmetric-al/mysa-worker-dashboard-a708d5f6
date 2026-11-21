"use client";

/**
 * The Help destination's content: guidance for the retained workflows only, in one fixed order that
 * does not vary by session state, viewport or persona.
 *
 * **Why this screen is in scope.** AAP 0.10.1's Shell/Home/Settings/Help family requires that "Help
 * covers only these workflows with a real configured destination", and AAP 0.6.4 makes the shell carry
 * that destination: `components/sidebar-nav` lists `/help` last in the rail, `components/app-shell`
 * points every refused session at it, and the account-recovery block in `copy/session-states` names the
 * same route. Criterion 21 requires the route to be reachable from `/` through the shell's own
 * navigation, so nothing here assumes a typed URL, and nothing here is a second way into a job.
 *
 * **Consistent Help (WCAG 3.2.6).** One component renders all five sections in a fixed order, with no
 * section conditional on a session state, a persona or a viewport: guidance that reordered itself would
 * have to be found again on every screen. Nothing here reads a record, so a refusal on any other surface
 * changes no word of this page and the content needs no data of its own.
 *
 * **One statement of each fact, taken from its owner.**
 *
 * - The four non-admitted states render `SESSION_STATE_COPY` and the standalone `NO_ACCESS_RECOVERY`
 *   block exactly as their notices render them, so Help cannot contradict the notice a reader has just
 *   seen and no state is described twice.
 * - The Save / Discard / Stay decision renders `CHOOSER_COPY`, `CONTEXT_SWITCH_COPY` and
 *   `LATE_RESULT_DISCARDED`, so the three choices keep their one wording.
 * - The reset paragraph is `RESET_COPY`'s own two sentences.
 * - The destination list is `PRIMARY_NAV`'s own entries in the rail's own order, so it cannot fall
 *   behind the navigation: a destination the rail gains appears here without an edit, and one it loses
 *   leaves with it.
 *
 * Two things are pointed at and deliberately not restated: the persistent **Development data** label
 * belongs to `components/dev-banner`, and the five effect sentences belong to
 * `components/simulation-label`. The fourth section therefore names each boundary and where its label
 * appears rather than reproducing a sentence that would then have two sources. For the same reason this
 * file composes no form, no control and no second version of a journey: it explains, and each
 * destination completes the job itself.
 *
 * **Only what the delivered application does.** Every sentence here is true of this repository: there is
 * no deployment story, no production authentication, no OAuth flow, no provider integration and no
 * message that leaves the application, so none of them is described, promised or hinted at. Rule 1
 * clause 3's distinctions survive into the wording wherever a reader could otherwise draw a false
 * conclusion from this page: completing a task proves nothing about contact, a commitment is not
 * received money, and a publication is not a delivery.
 *
 * **Why a static content module carries a client directive.** The navigation model the last section
 * reuses lives in `components/sidebar-nav`, which is a client module, and Next refuses to let a Server
 * Component read a value out of one — the rejected read fails with "{imported module
 * …sidebar-nav}.PRIMARY_NAV.map is not a function". The alternative, hand-writing a second navigation
 * list here, is the drift this section exists to prevent, so the boundary is carried instead. There is
 * no hook, no event handler, no read and no clock in this module, which is what keeps the page fully
 * server-rendered for every persona and every session state.
 *
 * **Headings, direction and narrow screens.** The route owns the page's single `h1`, so the five
 * sections open at level two and each state, setting and destination at level three. Every value stated
 * here is fixed copy rather than a record value, which is why no `<bdi>` isolation is needed; classes
 * are logical utilities resolving to the tokens declared once in `styles/globals.css`, targets are at
 * least 24x24 CSS px with the shared focus ring, and the sections stack in one column at 320 CSS pixels
 * without horizontal scrolling.
 */

import Link from "next/link";
import type { ReactElement } from "react";

import { PRIMARY_NAV } from "@/components/sidebar-nav";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";

import { CHOOSER_COPY, CONTEXT_SWITCH_COPY, LATE_RESULT_DISCARDED } from "../copy/context-switch";
import { RESET_COPY } from "../copy/dev-labels";
import { NO_ACCESS_RECOVERY, SESSION_STATE_COPY } from "../copy/session-states";

// Fixed values

/**
 * The ids the five section headings carry.
 *
 * Declared once so a section's `aria-labelledby` and its heading cannot disagree, and static because the
 * component renders once per page: a generated id would only add a hook where none is needed.
 */
const SECTION_IDS = {
  session: "help-getting-in",
  context: "help-context",
  settings: "help-settings",
  development: "help-development-data",
  destinations: "help-destinations",
} as const;

/** The destinations' link class: the shared size, with room to wrap rather than clip a long label. */
const DESTINATION_LINK_CLASS = "h-auto min-h-8 max-w-full whitespace-normal py-1.5";

/** The words above an ordered list of recovery steps. */
const STEPS_LABEL = "What you can do";

/**
 * The four states a session that is not admitted can meet, in the order Help explains them: the source
 * that did not answer, the surface that is refused, the session that has ended, and the account that
 * admits nothing at all.
 *
 * `satisfies` pins each member to a key of `SESSION_STATE_COPY`, so a state renamed or removed in the
 * copy module fails this file's compilation instead of rendering nothing here.
 */
const NON_ADMITTED_STATES = ["unavailable", "denied", "expired", "no-access"] as const satisfies readonly (keyof typeof SESSION_STATE_COPY)[];

/** One non-admitted state, reduced to the three fields Help renders. */
interface SessionStateSection {
  readonly key: (typeof NON_ADMITTED_STATES)[number];
  readonly title: string;
  readonly body: string;
  readonly steps: readonly string[];
}

/**
 * The three fields Help needs for one state, taken from the copy that owns them.
 *
 * The account that admits nothing is the one case whose subject is the standalone recovery block rather
 * than a surface that stopped, so it renders `NO_ACCESS_RECOVERY`'s own words — the same block, and the
 * same steps array, that the shell shows a person who reaches no workspace at all.
 */
function sessionStateSectionOf(key: SessionStateSection["key"]): SessionStateSection {
  if (key === "no-access") {
    return { key, title: NO_ACCESS_RECOVERY.title, body: NO_ACCESS_RECOVERY.body, steps: NO_ACCESS_RECOVERY.steps };
  }
  const entry = SESSION_STATE_COPY[key];
  return { key, title: entry.title, body: entry.body, steps: entry.recoverySteps };
}

const SESSION_STATE_SECTIONS: readonly SessionStateSection[] = NON_ADMITTED_STATES.map(sessionStateSectionOf);

/** What admission is, and what the four states below have in common. */
const SESSION_INTRO =
  "Admission is decided outside this workspace, by the organization a session works with, and every read and every change is authorised against what that admission allows. The four states below are what a session that is not admitted meets; each is stated in the same words wherever it appears, and each says what did not happen before it says what can be done.";

/** The three answers the Save / Discard / Stay decision offers, each labelled with its own words. */
const SWITCH_CHOICES = [
  { label: CONTEXT_SWITCH_COPY.saveLabel, note: CONTEXT_SWITCH_COPY.saveNote },
  { label: CONTEXT_SWITCH_COPY.discardLabel, note: CONTEXT_SWITCH_COPY.unsavedWorkNote },
  { label: CONTEXT_SWITCH_COPY.stayLabel, note: CONTEXT_SWITCH_COPY.stayNote },
] as const;

/** What Settings holds, and the one thing none of its preferences changes. */
const SETTINGS_INTRO =
  "Settings holds three presentation preferences for this browser, one panel that states where this session's data came from, and the reset that re-seeds the development data. None of the three preferences changes which records may be read, which ministry the session works in, or anything a partner receives.";

/** One setting Help explains: its name in Settings, and what it does and does not change. */
interface SettingFact {
  readonly heading: string;
  readonly body: string;
}

const SETTING_FACTS: readonly SettingFact[] = [
  {
    heading: "Appearance",
    body: "Light, dark, or matching your device. A choice applies to this browser and takes effect immediately, and matching your device follows your operating system while the page is open. Nothing else in the workspace changes with it.",
  },
  {
    heading: "Interface language",
    body: "Sets the language of the dates, times and numbers shown to you. It does not translate the interface, and it is never the language of anything sent to a partner.",
  },
  {
    heading: "Display time zone",
    body: "Changes how a time of day is shown to you. A date with no time of day — a due date, an introduction date — keeps the day the service recorded, and no deadline moves with this setting.",
  },
  {
    heading: "Source status",
    body: "States the source system, the source reference, the coverage that source reports and the instant the page read it, and adds the development scenario when the session carries one. Every value there is read rather than computed, and a status this session may not read, or one whose source did not answer, is stated as exactly that rather than as an absence.",
  },
  {
    heading: "Reset",
    // The two sentences that own this operation: what it deletes and re-seeds, and what it costs.
    body: `${RESET_COPY.body} ${RESET_COPY.irreversibleNote}`,
  },
];

/** The one fact about the dataset that no other sentence on this page carries. */
const DEVELOPMENT_INTRO =
  "This workspace runs on one synthetic development dataset: the organizations, ministries, people, gifts, commitments, updates, pages and messages are seeded data rather than anyone's real records, and the same data stands behind every screen of the session.";

/** Where the shell's own label sits, and what it means a reader may rely on. */
const DEVELOPMENT_LABEL_POINTER =
  "The shell says so on every screen. The Development data label sits in the header, beneath the current organization and ministry, states the same thing on every page, and names the development scenario the session is running in when there is one. It is the label to look for whenever a page seems to describe real people or real money.";

/** What the five effect labels are for. */
const SIMULATED_INTRO =
  "Five effects would leave this application in production, and none of them does. Each is labelled where it is triggered — beside the control that triggers it, and again on the result that follows — and each label states what did not happen.";

/** One simulated boundary: the effect, and where its label appears. */
interface SimulatedBoundary {
  readonly name: string;
  readonly where: string;
}

/**
 * The five boundaries, named so a reader knows what to look for — never with the sentences the labels
 * themselves state, which `components/simulation-label` owns.
 */
const SIMULATED_BOUNDARIES: readonly SimulatedBoundary[] = [
  { name: "Mail submission", where: "beside the control that requests a notification for a publication, and on the per-send results that follow it." },
  { name: "Publication reach", where: "on the result of a release, because what a release reaches is shown in the receiving preview instead of being published anywhere." },
  { name: "Giving destination", where: "on every placement that offers giving, where no payment can be taken." },
  { name: "Importer safety", where: "in the contact import journey, where a parse that succeeded says nothing about whether the file was safe." },
  { name: "Media preparation", where: "while an image or a video is prepared, where that processing happens inside this application." },
];

/** The distinctions a reader might otherwise lose while reading a result. */
const RESULT_DISTINCTIONS =
  "An accepted notification is not a message that was delivered or read, a release is not a delivery, a completed task proves nothing about contact, and a commitment is not received money. Each surface states which of those it is reporting.";

/** What the destination list is, and where it comes from. */
const DESTINATIONS_INTRO = "Each retained workflow begins at one of these destinations, and each destination is the shell's own entry for it, listed in the navigation's order.";

/** The accessible name of the destination list, so it is not a second unnamed navigation landmark. */
const DESTINATIONS_NAV_LABEL = "Workflow destinations";

/** The foot of the rail, and where a destination's sub-surfaces appear. */
const RAIL_FOOT_NOTE =
  "Settings and Help sit together at the foot of the same rail, below its rule, and keep that position on every screen. A destination that has sub-surfaces shows them beneath it in the rail.";

/**
 * One sentence per destination, keyed by the href the navigation model states.
 *
 * The sentences are Help's own; the labels and the destinations are `PRIMARY_NAV`'s. A destination the
 * rail gains renders here immediately with its label and no sentence, rather than being withheld until
 * this file catches up, so the list can lag in wording but never in reach.
 */
const DESTINATION_DESCRIPTIONS: Readonly<Record<string, string>> = {
  "/": "The day's three questions in one place: what needs attention, what is information only, and which work is unfinished — each item with the reason it is there and where it leads.",
  "/partners":
    "The roster over people, households, churches and other organizations, together with the private preparation records you keep before anything is shared. A record opens into identity, permitted contact methods, restrictions, actual activity, private notes, open tasks and the support history you are authorised to read.",
  "/work":
    "Today, upcoming, overdue, all and undated tasks, a dated agenda, and a repeating plan you can pause, resume or stop. Completing a task records that the task is done and says nothing about contact, payment or a message.",
  "/support": "Received support on one named basis, the commitments behind it, one goal and four fixed reports. Every value here is read: no action posts, corrects, refunds or infers money.",
  "/communication":
    "Ministry Updates and their variants, the audience that may be notified, the per-send results, and the synthetic inbox that shows how a message renders. A release is not a delivery.",
  "/pages": "Worker and Project Pages: the section builder, the locale editions, the reach setting, the withdrawal of an edition, and a preview that cannot start giving.",
  "/coaching": "Your own preparation, targets and check-ins, and the modules you share with a coach for a stated time. A coach reads only what has been shared, and only until that sharing ends.",
};

/** One destination as Help renders it: the navigation's label and href, and Help's own sentence. */
interface HelpDestination {
  readonly href: string;
  readonly label: string;
  readonly description: string;
}

/**
 * The everyday destinations, taken from the navigation model rather than written out here.
 *
 * The band test mirrors `components/sidebar-nav`'s own default (`item.section ?? "primary"`), so the
 * quiet foot of the rail — Settings and Help — is described by the closing note instead of being listed
 * as a workflow.
 */
const DESTINATIONS: readonly HelpDestination[] = PRIMARY_NAV.filter((item) => (item.section ?? "primary") === "primary").map((item) => ({
  href: item.href,
  label: item.label,
  description: DESTINATION_DESCRIPTIONS[item.href] ?? "",
}));

// The component

/** Props of {@link HelpContent}: the composition hook the Help route may use to place the content. */
export interface HelpContentProps {
  readonly className?: string;
}

/** The Help destination's content: the five retained-workflow sections, in their one fixed order. */
export function HelpContent({ className }: HelpContentProps): ReactElement {
  return (
    <div className={cn("flex min-w-0 flex-col gap-6 text-start", className)}>
      {/* 1. Getting in, and what an unadmitted session meets. */}
      <section aria-labelledby={SECTION_IDS.session} className="min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 id={SECTION_IDS.session}>Getting in and session states</h2>
            </CardTitle>
            <CardDescription>{SESSION_INTRO}</CardDescription>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-5">
            {SESSION_STATE_SECTIONS.map((state, index) => (
              <div key={state.key} className="flex min-w-0 flex-col gap-2">
                {index === 0 ? null : <Separator />}
                <h3 className="font-medium">{state.title}</h3>
                <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{state.body}</p>
                {state.steps.length === 0 ? null : (
                  <>
                    <p className="text-sm font-medium">{STEPS_LABEL}</p>
                    <ol className="flex list-decimal flex-col gap-1.5 ps-5 text-sm text-pretty wrap-anywhere">
                      {state.steps.map((step) => (
                        /* One step, keyed by its own text: the copy module's steps are distinct
                           sentences, so the text is the identity they already have. */
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  </>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      {/* 2. The chooser, and the decision a switch with unsaved work requires. */}
      <section aria-labelledby={SECTION_IDS.context} className="min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 id={SECTION_IDS.context}>Choosing and switching context</h2>
            </CardTitle>
            <CardDescription>{CHOOSER_COPY.body}</CardDescription>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-4">
            <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{CHOOSER_COPY.oneMinistryNote}</p>
            <Separator />
            <h3 className="font-medium">{CONTEXT_SWITCH_COPY.title}</h3>
            <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{CONTEXT_SWITCH_COPY.body}</p>
            <dl className="flex min-w-0 flex-col gap-3">
              {SWITCH_CHOICES.map((choice) => (
                <div key={choice.label} className="flex min-w-0 flex-col gap-1">
                  <dt className="text-sm font-medium">{choice.label}</dt>
                  <dd className="text-sm text-muted-foreground text-pretty wrap-anywhere">{choice.note}</dd>
                </div>
              ))}
            </dl>
            <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{CONTEXT_SWITCH_COPY.conflictNote}</p>
            <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{LATE_RESULT_DISCARDED}</p>
          </CardContent>
        </Card>
      </section>

      {/* 3. The presentation preferences, the source status and the reset. */}
      <section aria-labelledby={SECTION_IDS.settings} className="min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 id={SECTION_IDS.settings}>Settings</h2>
            </CardTitle>
            <CardDescription>{SETTINGS_INTRO}</CardDescription>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-4">
            {SETTING_FACTS.map((fact, index) => (
              <div key={fact.heading} className="flex min-w-0 flex-col gap-2">
                {index === 0 ? null : <Separator />}
                <h3 className="font-medium">{fact.heading}</h3>
                <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{fact.body}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      {/* 4. The synthetic dataset, its persistent label, and where each effect label appears. */}
      <section aria-labelledby={SECTION_IDS.development} className="min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 id={SECTION_IDS.development}>Development data and simulated effects</h2>
            </CardTitle>
            <CardDescription>{DEVELOPMENT_INTRO}</CardDescription>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-4">
            <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{DEVELOPMENT_LABEL_POINTER}</p>
            <Separator />
            <h3 className="font-medium">Where an effect is labelled</h3>
            <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{SIMULATED_INTRO}</p>
            <dl className="flex min-w-0 flex-col gap-3">
              {SIMULATED_BOUNDARIES.map((boundary) => (
                <div key={boundary.name} className="flex min-w-0 flex-col gap-1">
                  <dt className="text-sm font-medium">{boundary.name}</dt>
                  <dd className="text-sm text-muted-foreground text-pretty wrap-anywhere">{boundary.where}</dd>
                </div>
              ))}
            </dl>
            <Separator />
            <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{RESULT_DISTINCTIONS}</p>
          </CardContent>
        </Card>
      </section>

      {/* 5. Where each retained workflow begins, from the shell's own navigation model. */}
      <section aria-labelledby={SECTION_IDS.destinations} className="min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 id={SECTION_IDS.destinations}>Where each job begins</h2>
            </CardTitle>
            <CardDescription>{DESTINATIONS_INTRO}</CardDescription>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-4">
            <nav aria-label={DESTINATIONS_NAV_LABEL} className="min-w-0">
              <ul className="flex min-w-0 flex-col gap-4">
                {DESTINATIONS.map((destination) => (
                  <li key={destination.href} className="flex min-w-0 flex-col gap-2">
                    {/* The heading holds the destination itself, so the link's text is the heading's
                        text and a screen reader hears one name for one destination. */}
                    <h3 className="flex min-w-0 flex-wrap items-center">
                      <Link href={destination.href} className={cn(buttonVariants({ variant: "outline", size: "sm" }), DESTINATION_LINK_CLASS)}>
                        {destination.label}
                      </Link>
                    </h3>
                    {destination.description === "" ? null : <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{destination.description}</p>}
                  </li>
                ))}
              </ul>
            </nav>
            <Separator />
            <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{RAIL_FOOT_NOTE}</p>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

export default HelpContent;
