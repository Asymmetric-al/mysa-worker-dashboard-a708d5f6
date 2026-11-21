"use client";
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

const SECTION_IDS = { session: "help-getting-in", context: "help-context", settings: "help-settings", development: "help-development-data", destinations: "help-destinations" } as const;

const DESTINATION_LINK_CLASS = "h-auto min-h-8 max-w-full whitespace-normal py-1.5";

const STEPS_LABEL = "What you can do";

const NON_ADMITTED_STATES = ["unavailable", "denied", "expired", "no-access"] as const satisfies readonly (keyof typeof SESSION_STATE_COPY)[];

type SessionStateSection = { readonly key: (typeof NON_ADMITTED_STATES)[number]; readonly title: string; readonly body: string; readonly steps: readonly string[] };

function sessionStateSectionOf(key: SessionStateSection["key"]): SessionStateSection {
  if (key === "no-access") {
    return { key, title: NO_ACCESS_RECOVERY.title, body: NO_ACCESS_RECOVERY.body, steps: NO_ACCESS_RECOVERY.steps };
  }
  const entry = SESSION_STATE_COPY[key];
  return { key, title: entry.title, body: entry.body, steps: entry.recoverySteps };
}

const SESSION_STATE_SECTIONS: readonly SessionStateSection[] = NON_ADMITTED_STATES.map(sessionStateSectionOf);
const SESSION_INTRO =
  "Admission is decided outside this workspace, by the organization a session works with, and every read and every change is authorised against what that admission allows. The four states below are what a session that is not admitted meets; each is stated in the same words wherever it appears, and each says what did not happen before it says what can be done.";
const SWITCH_CHOICES = [
  { label: CONTEXT_SWITCH_COPY.saveLabel, note: CONTEXT_SWITCH_COPY.saveNote },
  { label: CONTEXT_SWITCH_COPY.discardLabel, note: CONTEXT_SWITCH_COPY.unsavedWorkNote },
  { label: CONTEXT_SWITCH_COPY.stayLabel, note: CONTEXT_SWITCH_COPY.stayNote },
] as const;
const SETTINGS_INTRO =
  "Settings holds three presentation preferences for this browser, one panel that states where this session's data came from, and the reset that re-seeds the development data. None of the three preferences changes which records may be read, which ministry the session works in, or anything a partner receives.";
type SettingFact = { readonly heading: string; readonly body: string };
const SETTING_FACTS: readonly SettingFact[] = [
  { heading: "Appearance", body: "Light, dark, or matching your device. A choice applies to this browser and takes effect immediately, and matching your device follows your operating system while the page is open. Nothing else in the workspace changes with it." },
  { heading: "Interface language", body: "Sets the language of the dates, times and numbers shown to you. It does not translate the interface, and it is never the language of anything sent to a partner." },
  { heading: "Display time zone", body: "Changes how a time of day is shown to you. A date with no time of day — a due date, an introduction date — keeps the day the service recorded, and no deadline moves with this setting." },
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
const DEVELOPMENT_INTRO = "This workspace runs on one synthetic development dataset: the organizations, ministries, people, gifts, commitments, updates, pages and messages are seeded data rather than anyone's real records, and the same data stands behind every screen of the session.";
const DEVELOPMENT_LABEL_POINTER =
  "The shell says so on every screen. The Development data label sits in the header, beneath the current organization and ministry, states the same thing on every page, and names the development scenario the session is running in when there is one. It is the label to look for whenever a page seems to describe real people or real money.";
const SIMULATED_INTRO = "Five effects would leave this application in production, and none of them does. Each is labelled where it is triggered — beside the control that triggers it, and again on the result that follows — and each label states what did not happen.";
type SimulatedBoundary = { readonly name: string; readonly where: string };

/** The five boundaries, named so a reader knows what to look for — never with the sentences the labels themselves state, which `components/simulation-label` owns. */
const SIMULATED_BOUNDARIES: readonly SimulatedBoundary[] = [
  { name: "Mail submission", where: "beside the control that requests a notification for a publication, and on the per-send results that follow it." },
  { name: "Publication reach", where: "on the result of a release, because what a release reaches is shown in the receiving preview instead of being published anywhere." },
  { name: "Giving destination", where: "on every placement that offers giving, where no payment can be taken." },
  { name: "Importer safety", where: "in the contact import journey, where a parse that succeeded says nothing about whether the file was safe." },
  { name: "Media preparation", where: "while an image or a video is prepared, where that processing happens inside this application." },
];
const RESULT_DISTINCTIONS = "An accepted notification is not a message that was delivered or read, a release is not a delivery, a completed task proves nothing about contact, and a commitment is not received money. Each surface states which of those it is reporting.";
const DESTINATIONS_INTRO = "Each retained workflow begins at one of these destinations, and each destination is the shell's own entry for it, listed in the navigation's order.";

/** The accessible name of the destination list, so it is not a second unnamed navigation landmark. */
const DESTINATIONS_NAV_LABEL = "Workflow destinations";
const RAIL_FOOT_NOTE = "Settings and Help sit together at the foot of the same rail, below its rule, and keep that position on every screen. A destination that has sub-surfaces shows them beneath it in the rail.";
const DESTINATION_DESCRIPTIONS: Readonly<Record<string, string>> = {
  "/": "The day's three questions in one place: what needs attention, what is information only, and which work is unfinished — each item with the reason it is there and where it leads.",
  "/partners":
    "The roster over people, households, churches and other organizations, together with the private preparation records you keep before anything is shared. A record opens into identity, permitted contact methods, restrictions, actual activity, private notes, open tasks and the support history you are authorised to read.",
  "/work": "Today, upcoming, overdue, all and undated tasks, a dated agenda, and a repeating plan you can pause, resume or stop. Completing a task records that the task is done and says nothing about contact, payment or a message.",
  "/support": "Received support on one named basis, the commitments behind it, one goal and four fixed reports. Every value here is read: no action posts, corrects, refunds or infers money.",
  "/communication": "Ministry Updates and their variants, the audience that may be notified, the per-send results, and the synthetic inbox that shows how a message renders. A release is not a delivery.",
  "/pages": "Worker and Project Pages: the section builder, the locale editions, the reach setting, the withdrawal of an edition, and a preview that cannot start giving.",
  "/coaching": "Your own preparation, targets and check-ins, and the modules you share with a coach for a stated time. A coach reads only what has been shared, and only until that sharing ends.",
};
type HelpDestination = { readonly href: string; readonly label: string; readonly description: string };
/** The everyday destinations, taken from the navigation model rather than written out here. */
const DESTINATIONS: readonly HelpDestination[] = PRIMARY_NAV.filter((item) => (item.section ?? "primary") === "primary").map((item) => ({ href: item.href, label: item.label, description: DESTINATION_DESCRIPTIONS[item.href] ?? "" }));
export type HelpContentProps = { readonly className?: string };
export function HelpContent({ className }: HelpContentProps): ReactElement {
  return (
    <div className={cn("flex min-w-0 flex-col gap-6 text-start", className)}>
      <section aria-labelledby={SECTION_IDS.session} className="min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>
              <h3 id={SECTION_IDS.session}>Getting in and session states</h3>
            </CardTitle>
            <CardDescription>{SESSION_INTRO}</CardDescription>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-5">
            {SESSION_STATE_SECTIONS.map((state, index) => (
              <div key={state.key} className="flex min-w-0 flex-col gap-2">
                {index === 0 ? null : <Separator />}
                <h4 className="font-medium">{state.title}</h4>
                <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{state.body}</p>
                {state.steps.length === 0 ? null : (
                  <>
                    <p className="text-sm font-medium">{STEPS_LABEL}</p>
                    <ol className="flex list-decimal flex-col gap-1.5 ps-5 text-sm text-pretty wrap-anywhere">
                      {state.steps.map((step) => (
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
      <section aria-labelledby={SECTION_IDS.context} className="min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>
              <h3 id={SECTION_IDS.context}>Choosing and switching context</h3>
            </CardTitle>
            <CardDescription>{CHOOSER_COPY.body}</CardDescription>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-4">
            <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{CHOOSER_COPY.oneMinistryNote}</p>
            <Separator />
            <h4 className="font-medium">{CONTEXT_SWITCH_COPY.title}</h4>
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
      <section aria-labelledby={SECTION_IDS.settings} className="min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>
              <h3 id={SECTION_IDS.settings}>Settings and its preferences</h3>
            </CardTitle>
            <CardDescription>{SETTINGS_INTRO}</CardDescription>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-4">
            {SETTING_FACTS.map((fact, index) => (
              <div key={fact.heading} className="flex min-w-0 flex-col gap-2">
                {index === 0 ? null : <Separator />}
                <h4 className="font-medium">{fact.heading}</h4>
                <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{fact.body}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
      <section aria-labelledby={SECTION_IDS.development} className="min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>
              <h3 id={SECTION_IDS.development}>The synthetic dataset and where each effect is labelled</h3>
            </CardTitle>
            <CardDescription>{DEVELOPMENT_INTRO}</CardDescription>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-4">
            <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{DEVELOPMENT_LABEL_POINTER}</p>
            <Separator />
            <h4 className="font-medium">Where an effect is labelled</h4>
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
      <section aria-labelledby={SECTION_IDS.destinations} className="min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>
              <h3 id={SECTION_IDS.destinations}>Where each job begins</h3>
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
                    <h4 className="flex min-w-0 flex-wrap items-center">
                      <Link href={destination.href} className={cn(buttonVariants({ variant: "outline", size: "sm" }), DESTINATION_LINK_CLASS)}>
                        {destination.label}
                      </Link>
                    </h4>
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
