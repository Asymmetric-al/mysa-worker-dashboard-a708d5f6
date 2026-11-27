"use client";
import Link from "next/link";
import { SearchIcon, XIcon } from "lucide-react";
import { useId, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { PRIMARY_NAV } from "@/components/sidebar-nav";
import { Badge } from "@/components/ui/badge";
import { buttonVariants, BUTTON_WRAP_CLASS } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import SectionCard from "@/components/section-card";
import StateNotice from "@/components/state-notice";
import { Separator } from "@/components/ui/separator";
import { normaliseSearchQuery } from "@/lib/command-search";
import { cn } from "@/lib/cn";
import { CHOOSER_COPY, CONTEXT_SWITCH_COPY, LATE_RESULT_DISCARDED } from "../copy/context-switch";
import { RESET_COPY } from "../copy/dev-labels";
import { NO_ACCESS_RECOVERY, SESSION_STATE_COPY } from "../copy/session-states";

const SECTION_IDS = { session: "help-getting-in", context: "help-context", settings: "help-settings", development: "help-development-data", destinations: "help-destinations" } as const;
const NON_ADMITTED_STATES = ["unavailable", "denied", "expired", "no-access"] as const satisfies readonly (keyof typeof SESSION_STATE_COPY)[];
type SessionStateSection = { readonly key: (typeof NON_ADMITTED_STATES)[number]; readonly title: string; readonly body: string; readonly steps: readonly string[] };
function sessionStateSectionOf(key: SessionStateSection["key"]): SessionStateSection {
  if (key === "no-access") return { key, title: NO_ACCESS_RECOVERY.title, body: NO_ACCESS_RECOVERY.body, steps: NO_ACCESS_RECOVERY.steps };
  const entry = SESSION_STATE_COPY[key];
  return { key, title: entry.title, body: entry.body, steps: entry.recoverySteps };
}
const SESSION_STATE_SECTIONS: readonly SessionStateSection[] = NON_ADMITTED_STATES.map(sessionStateSectionOf);
const SESSION_INTRO = "Access is managed by your sending organization. Below is what each access or session message means and what to do next.";
const SWITCH_CHOICES = [
  { label: CONTEXT_SWITCH_COPY.saveLabel, note: CONTEXT_SWITCH_COPY.saveNote },
  { label: CONTEXT_SWITCH_COPY.discardLabel, note: CONTEXT_SWITCH_COPY.unsavedWorkNote },
  { label: CONTEXT_SWITCH_COPY.stayLabel, note: CONTEXT_SWITCH_COPY.stayNote },
] as const;
const SETTINGS_INTRO = "Settings lets you customize how MYSA looks in this browser, choose your default update release option, check data status, or reset local sample data.";
const SETTING_FACTS: readonly { readonly heading: string; readonly body: string }[] = [
  { heading: "Appearance", body: "Switch between Light, Dark, or Match device. Applies right away in this browser." },
  { heading: "Date & number format", body: "Controls how dates, times, and numbers are formatted on screen. It doesn’t translate the app or change what partners receive." },
  { heading: "Display time zone", body: "Controls how timestamps appear on screen. Calendar-day due dates and repeating task schedules stay anchored to their original dates." },
  { heading: "Update publishing default", body: "Sets whether new ministry update submissions default to Publish only or Publish and notify partners. Changing this setting never sends anything by itself." },
  { heading: "Data & source status", body: "Shows which data source powered your view, the date range it covers, and when the page was loaded." },
  { heading: "Reset sample data", body: `${RESET_COPY.body} ${RESET_COPY.irreversibleNote}` },
];
const DEVELOPMENT_INTRO = "This workspace runs on sample development data — all organizations, ministries, partners, gifts, updates, pages, and inbox messages are simulated locally.";
const DEVELOPMENT_LABEL_POINTER = "The Development data banner stays visible in the header on every screen so you can always tell you’re looking at sample data.";
const SIMULATED_BOUNDARIES: readonly { readonly name: string; readonly where: string }[] = [
  { name: "Email sending", where: "When sending partner update notifications and on send history results." },
  { name: "Public publishing", where: "When publishing updates or ministry pages — preview how readers see them in Reader preview." },
  { name: "Giving links", where: "On ministry page giving placements — no real payment is processed." },
  { name: "Contact imports", where: "When uploading a spreadsheet in Import contacts — files are parsed locally and not virus-scanned." },
  { name: "Image & video prep", where: "When uploading photos or videos in updates and ministry pages — processed locally." },
];
const DESTINATION_DESCRIPTIONS: Readonly<Record<string, string>> = {
  "/": "See what needs your attention today, recent support changes, and drafts or tasks in progress.",
  "/partners": "Keep track of the people, families, churches, and organizations supporting your ministry — plus private contacts only you can see.",
  "/work": "Track calls, emails, thank-yous, repeating follow-up plans, and your dated agenda.",
  "/communication": "Write and publish ministry updates, manage your email audience, check send history, and preview what partners read.",
  "/support": "Follow your monthly support, received gifts, recurring commitments, support goal, and financial reports.",
  "/pages": "Build and publish your Missionary page and Project pages with photos, video, and giving links.",
  "/coaching": "Set personal targets, log check-ins, and choose exactly what to share with your coach.",
};
const DESTINATIONS: readonly { readonly href: string; readonly label: string; readonly description: string }[] = PRIMARY_NAV.filter((item) => (item.section ?? "primary") === "primary").map((item) => ({ href: item.href, label: item.label, description: DESTINATION_DESCRIPTIONS[item.href] ?? "" }));

const SECTION_SEARCH_INDEX: Readonly<Record<keyof typeof SECTION_IDS, string>> = {
  session: ["Access & session states", SESSION_INTRO, ...SESSION_STATE_SECTIONS.flatMap((entry) => [entry.title, entry.body, ...entry.steps])].join(" ").toLowerCase(),
  context: [
    "Switching ministries",
    CHOOSER_COPY.body,
    CHOOSER_COPY.oneMinistryNote,
    CONTEXT_SWITCH_COPY.title,
    CONTEXT_SWITCH_COPY.body,
    ...SWITCH_CHOICES.flatMap((choice) => [choice.label, choice.note]),
    CONTEXT_SWITCH_COPY.conflictNote,
    LATE_RESULT_DISCARDED,
  ]
    .join(" ")
    .toLowerCase(),
  settings: ["Settings & preferences", SETTINGS_INTRO, ...SETTING_FACTS.flatMap((fact) => [fact.heading, fact.body])].join(" ").toLowerCase(),
  development: ["Sample data & simulated actions", DEVELOPMENT_INTRO, DEVELOPMENT_LABEL_POINTER, ...SIMULATED_BOUNDARIES.flatMap((boundary) => [boundary.name, boundary.where])].join(" ").toLowerCase(),
  destinations: ["Workspace overview", ...DESTINATIONS.flatMap((destination) => [destination.label, destination.description])].join(" ").toLowerCase(),
};

const QUICK_JUMP: readonly { readonly key: keyof typeof SECTION_IDS; readonly label: string }[] = [
  { key: "session", label: "Access & sessions" },
  { key: "context", label: "Switching ministries" },
  { key: "settings", label: "Settings" },
  { key: "development", label: "Sample data" },
  { key: "destinations", label: "Where to start" },
];

const HelpSection = ({ id, title, description, contentClass, children }: { readonly id: string; readonly title: string; readonly description: string; readonly contentClass: string; readonly children: ReactNode }): ReactElement => (
  <SectionCard {...{ title, headingLevel: 3, headingId: id, description, contentClassName: contentClass, region: { id, className: "min-w-0" } }}>{children}</SectionCard>
);

export type HelpContentProps = { readonly className?: string };

/** Searchable reference cards for session states, ministry switching, settings, sample data, and workspace areas. */
export const HelpContent = ({ className }: HelpContentProps): ReactElement => {
  const searchId = useId();
  const [filterText, setFilterText] = useState("");
  const normalised = normaliseSearchQuery(filterText);

  const visibleKeys = useMemo(() => {
    const allKeys = Object.keys(SECTION_IDS) as (keyof typeof SECTION_IDS)[];
    if (normalised === "") return new Set(allKeys);
    const tokens = normalised.split(" ");
    return new Set(allKeys.filter((key) => tokens.every((token) => SECTION_SEARCH_INDEX[key].includes(token))));
  }, [normalised]);

  return (
    <div className={cn("flex min-w-0 flex-col gap-6 text-start", className)}>
      <section aria-label="Filter help topics" data-slot="help-search-bar" className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border/80 bg-surface-subtle p-3.5 sm:p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="min-w-48 flex-1">
            <Label htmlFor={searchId} className="sr-only">
              Search help topics
            </Label>
            <InputGroup>
              <InputGroupAddon align="inline-start">
                <SearchIcon aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                id={searchId}
                type="search"
                value={filterText}
                placeholder="Search help topics (e.g. session, time zone, simulated, reset)…"
                autoComplete="off"
                onChange={(event) => setFilterText(event.target.value)}
              />
              {filterText.length === 0 ? null : (
                <InputGroupAddon align="inline-end">
                  <InputGroupButton size="icon-xs" variant="ghost" aria-label="Clear help search" onClick={() => setFilterText("")}>
                    <XIcon aria-hidden="true" />
                  </InputGroupButton>
                </InputGroupAddon>
              )}
            </InputGroup>
          </div>
          <Badge variant="secondary" className="tabular-figures">
            {`${String(visibleKeys.size)} of ${String(QUICK_JUMP.length)} topics`}
          </Badge>
        </div>
        <nav aria-label="Jump to help topic" className="flex flex-wrap items-center gap-1.5">
          {QUICK_JUMP.filter((item) => visibleKeys.has(item.key)).map((item) => (
            <a
              key={item.key}
              href={`#${SECTION_IDS[item.key]}`}
              className="inline-flex min-h-7 items-center rounded-4xl border border-border/80 bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ring)]"
            >
              {item.label}
            </a>
          ))}
        </nav>
      </section>

      {visibleKeys.size === 0 ? (
        <StateNotice
          kind="empty"
          headingLevel={3}
          title="No help topics match your search"
          description="Try a broader word like session, ministry, settings, or simulated — or clear the search to see all five topics."
          action={{ label: "Clear search", onClick: () => setFilterText("") }}
        />
      ) : null}

      {visibleKeys.has("session") ? (
        <HelpSection id={SECTION_IDS.session} title="Access & session states" description={SESSION_INTRO} contentClass="flex min-w-0 flex-col gap-5">
          {SESSION_STATE_SECTIONS.map((state, index) => (
            <div key={state.key} className="flex min-w-0 flex-col gap-2">
              {index === 0 ? null : <Separator />}
              <h4 className="type-group-title">{state.title}</h4>
              <p className="type-supporting text-pretty wrap-anywhere">{state.body}</p>
              {state.steps.length === 0 ? null : (
                <>
                  <p className="text-sm font-medium">What you can do</p>
                  <ol className="flex list-decimal flex-col gap-1.5 ps-5 type-supporting text-pretty wrap-anywhere">
                    {state.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </>
              )}
            </div>
          ))}
        </HelpSection>
      ) : null}

      {visibleKeys.has("context") ? (
        <HelpSection id={SECTION_IDS.context} title="Switching ministries" description={CHOOSER_COPY.body} contentClass="flex min-w-0 flex-col gap-4">
          <p className="type-supporting text-pretty wrap-anywhere">{CHOOSER_COPY.oneMinistryNote}</p>
          <Separator />
          <h4 className="type-group-title">{CONTEXT_SWITCH_COPY.title}</h4>
          <p className="type-supporting text-pretty wrap-anywhere">{CONTEXT_SWITCH_COPY.body}</p>
          <dl className="flex min-w-0 flex-col gap-3">
            {SWITCH_CHOICES.map((choice) => (
              <div key={choice.label} className="flex min-w-0 flex-col gap-1">
                <dt className="text-sm font-medium">{choice.label}</dt>
                <dd className="type-supporting text-pretty wrap-anywhere">{choice.note}</dd>
              </div>
            ))}
          </dl>
          <p className="type-supporting text-pretty wrap-anywhere">{CONTEXT_SWITCH_COPY.conflictNote}</p>
          <p className="type-supporting text-pretty wrap-anywhere">{LATE_RESULT_DISCARDED}</p>
        </HelpSection>
      ) : null}

      {visibleKeys.has("settings") ? (
        <HelpSection id={SECTION_IDS.settings} title="Settings & preferences" description={SETTINGS_INTRO} contentClass="flex min-w-0 flex-col gap-4">
          {SETTING_FACTS.map((fact, index) => (
            <div key={fact.heading} className="flex min-w-0 flex-col gap-2">
              {index === 0 ? null : <Separator />}
              <h4 className="type-group-title">{fact.heading}</h4>
              <p className="type-supporting text-pretty wrap-anywhere">{fact.body}</p>
            </div>
          ))}
        </HelpSection>
      ) : null}

      {visibleKeys.has("development") ? (
        <HelpSection id={SECTION_IDS.development} title="Sample data & simulated actions" description={DEVELOPMENT_INTRO} contentClass="flex min-w-0 flex-col gap-4">
          <p className="type-supporting text-pretty wrap-anywhere">{DEVELOPMENT_LABEL_POINTER}</p>
          <Separator />
          <h4 className="type-group-title">Where actions are simulated</h4>
          <p className="type-supporting text-pretty wrap-anywhere">{"Five external actions are simulated locally and clearly labelled whenever you use them:"}</p>
          <dl className="flex min-w-0 flex-col gap-3">
            {SIMULATED_BOUNDARIES.map((boundary) => (
              <div key={boundary.name} className="flex min-w-0 flex-col gap-1">
                <dt className="text-sm font-medium">{boundary.name}</dt>
                <dd className="type-supporting text-pretty wrap-anywhere">{boundary.where}</dd>
              </div>
            ))}
          </dl>
          <Separator />
          <p className="type-supporting text-pretty wrap-anywhere">{"Important distinctions: an accepted email notification doesn’t prove delivery, publishing an update doesn’t automatically email partners, completing a task doesn’t log an interaction or gift, and a recurring commitment isn’t received money."}</p>
        </HelpSection>
      ) : null}

      {visibleKeys.has("destinations") ? (
        <HelpSection id={SECTION_IDS.destinations} title="Where to start" description="Jump straight to any part of your missionary workspace." contentClass="flex min-w-0 flex-col gap-4">
          <nav aria-label="Workspace areas" className="min-w-0">
            <ul className="grid min-w-0 gap-3 @2xl/main:grid-cols-2">
              {DESTINATIONS.map((destination) => (
                <li key={destination.href} className="flex min-w-0 flex-col gap-2 rounded-2xl border border-border/80 bg-surface-subtle p-4 shadow-xs">
                  <h4 className="type-group-title flex min-w-0 flex-wrap items-center">
                    <Link {...{ href: destination.href, "data-slot": "button", className: cn(buttonVariants({ variant: "outline", size: "sm" }), BUTTON_WRAP_CLASS) }}>{destination.label}</Link>
                  </h4>
                  {destination.description === "" ? null : <p className="type-supporting text-pretty wrap-anywhere">{destination.description}</p>}
                </li>
              ))}
            </ul>
          </nav>
        </HelpSection>
      ) : null}
    </div>
  );
};
export default HelpContent;
