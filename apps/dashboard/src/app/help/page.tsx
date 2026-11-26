import type { Metadata } from "next";
import Link from "next/link";
import SimulationLabel from "@/components/simulation-label";
import { Separator } from "@/components/ui/separator";
import { HelpContent } from "@/features/shell/components/help-content";
const PAGE_TITLE = "Help & guide";
export const metadata: Metadata = { title: PAGE_TITLE, description: "Practical guides for staying connected with partners, tracking support, sharing updates, and using your missionary workspace." };
const CONTENTS_ID = "on-this-page";
const INTRODUCTION = "Practical guides for every workflow in your missionary workspace. Everything here runs on local sample data, and any simulated action is clearly labelled where you use it.";
const BODY_TEXT = "type-supporting text-pretty wrap-anywhere";
const STEP_HEADING = "type-subsection-title text-pretty wrap-anywhere";
const INLINE_LINK = "inline-flex min-h-6 items-center rounded-sm font-medium inline-link";
const SECTIONS = [
  { id: "journey-import-a-contact", label: "Add or import a partner and plan your next step" },
  { id: "journey-giving-investigation", label: "Check monthly support, drill into gifts, and export" },
  { id: "journey-update-publication", label: "Write, review, and share a ministry update" },
  { id: "journey-pages-release", label: "Build, publish, and manage a ministry page" },
  { id: "journey-outreach-coaching", label: "Run outreach, repeating tasks, and coaching" },
  { id: "simulated-effects", label: "Sample data and simulated actions" },
  { id: "development-controls", label: "Development tools" },
  { id: "session-context-settings", label: "Access, switching ministries, and settings" },
  { id: "keyboard-and-display", label: "Keyboard navigation, small screens, and accessibility" },
  { id: "known-limitations", label: "Good to know" },
] as const;
type SectionEntry = (typeof SECTIONS)[number];
type SectionId = SectionEntry["id"];
type JourneyId = Extract<SectionId, `journey-${string}`>;
type StepLink = { readonly href: string; readonly label: string };
type JourneyStep = { readonly title: string; readonly body: string; readonly boundary: string; readonly links?: readonly StepLink[] };
type Journey = { readonly heading: string; readonly steps: readonly JourneyStep[] };
const JOURNEYS: Readonly<Record<JourneyId, Journey>> = {
  "journey-import-a-contact": {
    heading: "Add or import a partner → review their profile → log activity → create a follow-up task",
    steps: [
      {
        title: "Add a private contact or import a list",
        body: "Start with a name to create a private contact that only you can see until you link it to a shared partner record. To bring in a spreadsheet, Import contacts walks you through five steps: Choose file, Match columns, Review rows, Confirm import, and Results (up to 5 MiB, 5,000 rows, 60 columns).",
        boundary: "Importing contacts never subscribes anyone to emails and never merges duplicates automatically.",
        links: [{ href: "/partners/import", label: "Open Import contacts" }],
      },
      {
        title: "Review their profile before reaching out",
        body: "Open any partner to see contact details, communication restrictions, relationship details, logged activity, private notes, open tasks, and giving history.",
        boundary: "Private contacts and private notes stay visible only to you — never shared with coaches or included in exports.",
        links: [{ href: "/partners", label: "Open Partners" }],
      },
      {
        title: "Log a conversation or visit",
        body: "Record calls, meetings, emails, or thank-yous with the date (or approximate month/year), outcome, participants, and notes.",
        boundary: "Activity logs real interactions only — separate from gifts, scheduled tasks, or simply opening your email app.",
      },
      {
        title: "Create your next follow-up task",
        body: "Add a task with a title and optional due date so no relationship slips through the cracks.",
        boundary: "Completing a task marks the reminder done — log an activity separately if you want a conversation recorded.",
        links: [{ href: "/work", label: "Open Tasks" }],
      },
    ],
  },
  "journey-giving-investigation": {
    heading: "Review monthly support → inspect individual gifts → return without losing filters → export CSV",
    steps: [
      {
        title: "Check your monthly overview and gift ledger",
        body: "Support shows your received gifts (effective cash allocations attributed to each gift’s original date), active commitments, and progress toward your monthly goal. Open Gifts to browse or filter individual entries (50 rows per page by default, up to 200).",
        boundary: "Currencies are never mixed into a single combined total, unknown currencies stay clearly marked, and missing months appear as gaps rather than fake zeros.",
        links: [
          { href: "/support", label: "Open Support" },
          { href: "/support/gifts", label: "Open Gifts" },
        ],
      },
      {
        title: "Explore the four support reports",
        body: "Use the built-in reports to compare this month and year-to-date against last year, view monthly history by year, inspect giving by partner and month, or see exactly what changed between two periods. Click any partner-by-month cell to jump straight to those gifts.",
        boundary: "Split gifts count once at their grain, and refunds are shown clearly rather than hidden.",
      },
      {
        title: "Come back right where you left off",
        body: "When you drill into a gift or partner and return, your search, filters, sort order, and scroll position stay intact.",
        boundary: "On-screen totals, charts, tables, CSV exports, and print views all come from the same data snapshot so the numbers always match.",
      },
      {
        title: "Export or print the complete result",
        body: "CSV exports include every row matching your current filters — not just the visible page — along with the date range, currency, and snapshot time.",
        boundary: "Support records are read-only here (only your personal monthly support goal can be edited).",
      },
    ],
  },
  "journey-update-publication": {
    heading: "Write an update → preview & review → publish → notify partners → check what readers see",
    steps: [
      {
        title: "Draft your update",
        body: "Write your ministry update in one or more languages and audiences (Public or Approved supporters), and insert photos or video from the media picker. Autosave protects your draft and warns you if something changed elsewhere.",
        boundary: "Images and videos are prepared locally in this development workspace.",
        links: [{ href: "/communication", label: "Open Updates" }],
      },
      {
        title: "Preview before submitting",
        body: "Open the edition preview to check layout, text direction, images, and video exactly as readers will see them.",
        boundary: "Previewing is completely safe — it sends nothing and publishes nothing.",
      },
      {
        title: "Submit and review",
        body: "Submitting freezes a snapshot for review so further draft edits can’t alter what gets approved. Each language and audience edition is reviewed independently.",
        boundary: "A reviewer cannot switch a Publish-only update into an email send without your choice.",
      },
      {
        title: "Publish and notify eligible partners",
        body: "Publishing makes each approved edition available to its audience. Sending email notices is simulated locally — each eligible partner receives one copy, and protected updates send a link-only notice so private content stays off email.",
        boundary: "An accepted email request is tracked separately from actual delivery, and unpublishing doesn’t recall copies already read.",
      },
      {
        title: "Check the Test inbox and Reader preview",
        body: "Open Test inbox to inspect the rendered HTML and plain-text emails, or open Reader preview to experience published updates as different personas.",
        boundary: "Reader access is checked every time an update is opened.",
        links: [
          { href: "/communication/inbox", label: "Open Test inbox" },
          { href: "/preview", label: "Open Reader preview" },
        ],
      },
    ],
  },
  "journey-pages-release": {
    heading: "Build a Missionary or Project page → preview → publish → control visibility",
    steps: [
      {
        title: "Assemble sections cleanly",
        body: "Choose from structured sections (story, prayer needs, gallery, video, giving link, and more) with clean, mobile-friendly layout options.",
        boundary: "Styling stays consistent across devices and languages automatically — no custom HTML or scripts needed.",
        links: [{ href: "/pages", label: "Open Ministry pages" }],
      },
      {
        title: "Reorder with clicks or keyboard",
        body: "Add, move, duplicate, or remove sections using buttons or keyboard shortcuts — no drag-and-drop required.",
        boundary: "Starting from a template creates a draft so you can review everything before publishing.",
      },
      {
        title: "Preview each language edition",
        body: "Every language edition keeps its own draft and published version, so editing English never overwrites Arabic or French. Preview video, posters, and captions before publishing.",
        boundary: "Previews never publish, send email, or process real gifts.",
      },
      {
        title: "Publish and choose who can find it",
        body: "Set visibility to Not public, Unlisted (link only), or Listed publicly. Only Listed publicly pages appear in Public pages.",
        boundary: "Hide page from public takes effect right away across all language editions, even if another draft has errors.",
        links: [{ href: "/preview/pages", label: "Open Public pages" }],
      },
      {
        title: "Giving buttons on published pages",
        body: "Every giving section uses the approved designation for that ministry or project and clearly displays the currency and goal when available.",
        boundary: "If a giving designation isn’t active, the page shows Giving unavailable instead of falling back to another fund. Giving links are simulated here.",
      },
    ],
  },
  "journey-outreach-coaching": {
    heading: "Organize outreach, referrals & repeating tasks → share with a coach → revoke anytime",
    steps: [
      {
        title: "Track an outreach initiative",
        body: "Group specific partners you’re inviting into an initiative, track stages clearly, and log responses tied to what you asked.",
        boundary: "Recording a positive response doesn’t automatically create a gift, commitment, or email subscription.",
        links: [{ href: "/partners/initiatives", label: "Open Initiatives" }],
      },
      {
        title: "Follow up on referrals",
        body: "Keep track of who introduced you and when. Active referral windows show how long you have to follow up or extend once.",
        boundary: "Approximate or unknown introduction dates don’t show artificial deadlines, and expired referrals keep only minimal history.",
        links: [{ href: "/partners/referrals", label: "Open Referrals" }],
      },
      {
        title: "Use repeating follow-up plans",
        body: "Set up recurring reminders (weekly, every few weeks, monthly, or quarterly) with a clear start date and end condition. Only one occurrence is active at a time so overdue tasks don’t pile up.",
        boundary: "Missing several dates flags the plan for review instead of flooding your list, and editing future dates leaves completed history untouched.",
        links: [{ href: "/work", label: "Open Tasks" }],
      },
      {
        title: "Share selected areas with your coach",
        body: "Invite a coach to read only the modules you choose (all start unchecked) through an end date you set. Financial summaries use their own explicit date range.",
        boundary: "Coaches get read-only access only — they can accept or leave a share, never edit your records or see private notes.",
        links: [
          { href: "/coaching", label: "Open Coaching" },
          { href: "/coaching/sharing", label: "Open Sharing" },
        ],
      },
      {
        title: "Revoke sharing anytime",
        body: "End a coach’s access immediately from the Sharing page. Once revoked or past the end date, your shared modules are closed right away.",
        boundary: "Revoking access never deletes your own targets, check-ins, or notes.",
        links: [{ href: "/coaching/sharing", label: "Manage coach sharing" }],
      },
    ],
  },
};
const SIMULATED_EFFECTS = [
  { effect: "mail-submission", title: "Email sending", where: "Shown when requesting partner update notifications and in Send history." },
  { effect: "publication-reach", title: "Public publishing", where: "Shown when publishing an update or ministry page (viewable in Reader preview)." },
  { effect: "giving-destination", title: "Giving links", where: "Shown on every giving section across ministry pages and previews." },
  { effect: "importer-safety", title: "Contact imports", where: "Shown when uploading a file in Import contacts." },
  { effect: "media-preparation", title: "Image & video prep", where: "Shown while preparing photos or videos in updates and ministry pages." },
] as const;
type ProseSection = { readonly intro: string; readonly items: readonly { readonly title: string; readonly body: string }[] };
const PROSE_SECTIONS: Readonly<Record<Exclude<SectionId, JourneyId | "simulated-effects" | "session-context-settings">, ProseSection>> = {
  "development-controls": {
    intro: "At the bottom of the page in development mode, you can test different personas, scenarios, dates, and error states without changing real records.",
    items: [
      { title: "Preview persona", body: "Switch between seeded missionary, coach, reviewer, and reader personas to see what each role can view." },
      { title: "Scenario", body: "Load a different sample dataset or simulate a data-source outage for this session." },
      { title: "Clock", body: "Jump the simulated date forward or backward to test referral windows, repeating tasks, and coaching end dates." },
      { title: "Failure simulator", body: "Simulate a single denied, conflict, unavailable, or unconfirmed response on one action to verify recovery flows." },
      { title: "Reset sample data", body: "Clear all local edits and restore the original sample dataset (same as running bun run reset)." },
    ],
  },
  "keyboard-and-display": {
    intro: "MYSA is built to work smoothly with a keyboard, on small phones, at 200% zoom, with reduced motion, and with screen readers.",
    items: [
      { title: "Keyboard support", body: "Press ? anywhere outside a text field for shortcuts, and Cmd/Ctrl+K for quick search. Every action — including reordering sections and resizing columns — works without dragging." },
      { title: "Small screens & zoom", body: "Works cleanly down to 320px width and 200% browser zoom with no awkward horizontal page scrolling." },
      { title: "Reduced motion", body: "Animations pause automatically when your operating system prefers reduced motion." },
      { title: "Screen readers & clear states", body: "Every status uses words (never color alone), every chart includes a full data table, and outages are reported honestly instead of showing zero." },
      { title: "Safe forms", body: "If a save fails, everything you typed stays right in the form, and pasting text is never blocked." },
    ],
  },
  "known-limitations": {
    intro: "A few helpful details to keep in mind when exporting files or working with video:",
    items: [
      { title: "Spreadsheet-safe CSV exports", body: "Cells starting with =, +, -, or @ are prefixed with a tab inside quotes so spreadsheets don’t accidentally run them as formulas." },
      { title: "Video container timestamps", body: "Locally processed videos strip descriptive metadata tags before preview, though container timestamps may remain." },
      { title: "Local sample performance", body: "Speed in this local development workspace reflects your own machine and sample dataset rather than production hosting." },
    ],
  },
};
const StepLinks = ({ links }: { readonly links: readonly StepLink[] }) => (
  <p className="flex min-w-0 flex-wrap gap-x-4 gap-y-1">
    {links.map((link) => (
      <Link key={link.href} href={link.href} className={INLINE_LINK}>
        {link.label}
      </Link>
    ))}
  </p>
);
const JourneySteps = ({ journey }: { readonly journey: Journey }) => (
  <ol className="flex min-w-0 list-decimal flex-col gap-5 ps-5">
    {journey.steps.map((step) => (
      <li key={step.title} className="flex min-w-0 flex-col gap-1.5">
        <h3 className={STEP_HEADING}>{step.title}</h3>
        <p className={BODY_TEXT}>{step.body}</p>
        <p className={BODY_TEXT}>{step.boundary}</p>
        {step.links === undefined ? null : <StepLinks links={step.links} />}
      </li>
    ))}
  </ol>
);
const SimulatedEffects = () => (
  <>
    <p className={BODY_TEXT}>{"The Development data badge stays visible in the header on every screen. Whenever you use one of the five simulated actions below, you’ll see a clear disclosure label:"}</p>
    <ul className="flex min-w-0 flex-col gap-5">
      {SIMULATED_EFFECTS.map((item) => (
        <li key={item.effect} className="flex min-w-0 flex-col gap-1.5">
          <h3 className={STEP_HEADING}>{item.title}</h3>
          <p className={BODY_TEXT}>{item.where}</p>
          <SimulationLabel effect={item.effect} />
        </li>
      ))}
    </ul>
    <p className={BODY_TEXT}>{"Nothing leaves this local workspace — no real emails are sent, no payments are charged, and nothing is published publicly on the internet."}</p>
  </>
);
const ProseBody = ({ section }: { readonly section: ProseSection }) => (
  <>
    <p className={BODY_TEXT}>{section.intro}</p>
    <dl className="flex min-w-0 flex-col gap-4">
      {section.items.map((item) => (
        <div key={item.title} className="flex min-w-0 flex-col gap-1">
          <dt className={"text-sm font-medium text-pretty wrap-anywhere"}>{item.title}</dt>
          <dd className={BODY_TEXT}>{item.body}</dd>
        </div>
      ))}
    </dl>
  </>
);
const isJourneyId = (id: SectionId): id is JourneyId => id in JOURNEYS;
function sectionHeading(section: SectionEntry): string {
  if (!isJourneyId(section.id)) return section.label;
  return JOURNEYS[section.id].heading;
}
function sectionBody(section: SectionEntry) {
  switch (section.id) {
    case "journey-import-a-contact":
    case "journey-giving-investigation":
    case "journey-update-publication":
    case "journey-pages-release":
    case "journey-outreach-coaching":
      return <JourneySteps journey={JOURNEYS[section.id]} />;
    case "simulated-effects":
      return <SimulatedEffects />;
    case "session-context-settings":
      return <HelpContent />;
    case "development-controls":
    case "keyboard-and-display":
    case "known-limitations":
      return <ProseBody section={PROSE_SECTIONS[section.id]} />;
    default:
      return unhandledSection(section);
  }
}
function unhandledSection(section: never): never {
  throw new Error(`The Help page has no content for the section "${String(section)}".`);
}
/** Help & guide screen: practical walkthroughs, searchable topics, simulated-action disclosures, and accessibility notes. */ export default function HelpPage() {
  return (
    <article className="flex min-w-0 flex-col gap-6 text-start">
      <header className="flex min-w-0 flex-col gap-2">
        <h1 className="type-page-title text-pretty wrap-anywhere">{PAGE_TITLE}</h1>
        <p className="max-w-prose type-supporting text-pretty wrap-anywhere">{INTRODUCTION}</p>
      </header>
      <nav aria-labelledby={CONTENTS_ID} className="flex min-w-0 flex-col gap-2">
        <h2 id={CONTENTS_ID} className="type-section-title">
          {"On this page"}
        </h2>
        <ol className="flex min-w-0 list-decimal flex-col gap-1 ps-5">
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`} className={INLINE_LINK}>
                {section.label}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {SECTIONS.map((section, index) => (
        <div key={section.id} className="flex min-w-0 flex-col gap-6">
          {index === 0 ? null : <Separator />}
          <section aria-labelledby={section.id} className="flex min-w-0 flex-col gap-3">
            <h2 id={section.id} tabIndex={-1} className="type-section-title text-pretty wrap-anywhere">
              {sectionHeading(section)}
            </h2>
            {sectionBody(section)}
          </section>
        </div>
      ))}
    </article>
  );
}
