/** `/help` — the Help destination: guidance for the five retained workflows of the first release. */
import type { Metadata } from "next";
import Link from "next/link";
import SimulationLabel from "@/components/simulation-label";
import { Separator } from "@/components/ui/separator";
import { HelpContent } from "@/features/shell/components/help-content";
const PAGE_TITLE = "Help";
export const metadata: Metadata = { title: PAGE_TITLE, description: "Guidance for the workflows in this first release." };
/** The table of contents' heading, which is also its `nav` landmark's accessible name. */
const CONTENTS_ID = "on-this-page";
const CONTENTS_HEADING = "On this page";
const INTRODUCTION =
  "This page covers the five workflows of the first release and nothing outside them. Every record in the application is synthetic, and every external effect is simulated and labelled where you trigger it. The Development data label sits in the application shell on every screen, including this one, and cannot be dismissed.";
const PAGE_COLUMN = "flex min-w-0 flex-col gap-6 text-start";
const BODY_TEXT = "text-sm text-muted-foreground text-pretty wrap-anywhere";
const SECTION_HEADING = "text-lg font-semibold text-pretty wrap-anywhere";
const STEP_HEADING = "text-sm font-semibold text-pretty wrap-anywhere";
const INLINE_LINK = "inline-flex min-h-6 items-center rounded-sm font-medium underline underline-offset-4";
/** The page's sections, in the order it renders them: the five journeys first, then the label and its effects, the development controls, session and context, keyboard and display, and the limitations. */
const SECTIONS = [
  { id: "journey-import-a-contact", label: "Add a contact and create the next task" },
  { id: "journey-giving-investigation", label: "Investigate a giving change and export it" },
  { id: "journey-update-publication", label: "Write, review and publish an Update" },
  { id: "journey-pages-release", label: "Compose, release and withdraw a Page" },
  { id: "journey-outreach-coaching", label: "Work outreach and a series, then share coaching" },
  { id: "simulated-effects", label: "The Development data label and simulated effects" },
  { id: "development-controls", label: "Development controls" },
  { id: "session-context-settings", label: "Session states, context and settings" },
  { id: "keyboard-and-display", label: "Keyboard, small screens, zoom and reduced motion" },
  { id: "known-limitations", label: "Known limitations" },
] as const;
type SectionEntry = (typeof SECTIONS)[number];
type SectionId = SectionEntry["id"];
type JourneyId = Extract<SectionId, `journey-${string}`>;
type ProseSectionId = Exclude<SectionId, JourneyId | "simulated-effects" | "session-context-settings">;
/** One destination a step offers: descriptive link text, and a route the shell's navigation lists. */
interface StepLink {
  readonly href: string;
  readonly label: string;
}
interface JourneyStep {
  readonly title: string;
  readonly body: string;
  readonly boundary: string;
  readonly links?: readonly StepLink[];
}
interface Journey {
  readonly heading: string;
  readonly steps: readonly JourneyStep[];
}
const JOURNEYS: Readonly<Record<JourneyId, Journey>> = {
  "journey-import-a-contact": {
    heading: "Import or add a contact → review context → log an actual interaction → create a next task.",
    steps: [
      {
        title: "Add a private contact, or bring a list in",
        body: "A private contact needs a name and nothing else, and stays your own preparation until you deliberately link it to a shared record. A list arrives through five steps — Choose file, Map, Validate and review, Selectively accept, Results — and the limits are stated before processing begins: 5 MiB, 5,000 nonblank rows, 60 columns and 2,000 characters per cell.",
        boundary: "A column that looks like a subscription flag is never consent, importing or editing a " + "contact subscribes no one, and a duplicate suggestion never merges two records. The importer-safety label sits beside the file you submit.",
        links: [{ href: "/partners/import", label: "the contact import journey" }],
      },
      {
        title: "Review the context before you act",
        body: "A record opens into identity, permitted contact methods, restrictions, the relationship " + "context, actual activity, private notes, open tasks and the support history you are " + "authorised to read.",
        boundary: "Private preparation and private notes stay private: they never appear in a shared projection, an export, or another record's audience.",
        links: [{ href: "/partners", label: "the Partners roster" }],
      },
      {
        title: "Log an interaction that actually happened",
        body: "An interaction records something that took place, with a date or honest precision, an outcome, the participants and a note labelled with the audience it belongs to.",
        boundary: "A gift, a scheduled task, or opening a mail or dialer app is not an interaction.",
      },
      {
        title: "Create the next task",
        body: "The task needs only a title. A due date is a civil date rather than a fabricated midnight, and a meeting's planned time is not the time it was held.",
        boundary: "If the task cannot be created, the interaction you already saved is not submitted again: the two are separate attempts with separate results. Completing the task proves the task is done and nothing about contact or payment.",
        links: [{ href: "/work", label: "the Work lists" }],
      },
    ],
  },
  "journey-giving-investigation": {
    heading: "Investigate a monthly or yearly giving change → drill into exact records → return with filters intact → export the complete result.",
    steps: [
      {
        title: "Read the month, then open the ledger",
        body: "Received support is stated on one named basis: effective cash allocations attributed to the " + "original gift date, in a stated currency and period, at a stated coverage and as-of time. " + "The ledger lists the records behind it, 50 rows at a time by default and 200 at most.",
        boundary: "Mixed currencies stay separate with no combined total, a gift whose currency is unknown is never given one, and a missing month is a gap rather than a zero.",
        links: [
          { href: "/support", label: "the Support overview" },
          { href: "/support/gifts", label: "the Gifts ledger" },
        ],
      },
      {
        title: "Drill into the exact records",
        body: "A cell in the partner-by-month matrix opens the gifts behind it, and four fixed reports are the whole set: monthly and year-to-date received with an equal-elapsed-period comparison, monthly history for a chosen year, the partner-by-month matrix, and period comparison with a signed difference and reconciling contributor deltas.",
        boundary: "There is no report designer and no fifth report. A split gift counts once at its own grain, and a refund is explained in detail rather than hidden.",
      },
      {
        title: "Return with the filters you left",
        body: "The filter, the sort and the scroll position you drilled from are restored when you come back, so an investigation is a detour rather than a reset.",
        boundary: "The total on screen, the chart series, the table, the drilldown, the export and the print " + "view are one result from one snapshot, and they agree exactly in count and in minor-unit " + "sums per currency.",
      },
      {
        title: "Export the complete result",
        body: "A CSV export covers the whole query rather than the loaded page, and carries its grain, basis, currency, period, coverage and snapshot time; the print view renders that same result.",
        boundary: "Nothing in Support posts, corrects, refunds or infers money. The support goal is the only value you can edit, and only where the surface offers that action.",
      },
    ],
  },
  "journey-update-publication": {
    heading: "Write an Update → preview and review it → publish → simulate eligible notices → inspect the rendered message and the receiving experience.",
    steps: [
      {
        title: "Write one variant",
        body: "One editor serves an Update's prose in each locale and audience variant, with images and " + "video placed through the media picker; autosave carries the revision it expects, so a change " + "made elsewhere is detected instead of overwritten.",
        boundary: "Media preparation happens inside this application, and the label beside the placement states that it is local processing.",
        links: [{ href: "/communication", label: "the Updates list" }],
      },
      { title: "Preview the revision you acknowledged", body: "The preview shows that exact revision, with its media, at the variant's own preview route.", boundary: "It is inert: it sends nothing, subscribes no reader and publishes nothing." },
      { title: "Review once", body: "A review is one step, and it freezes the exact revisions it approves, so a draft edited afterwards cannot change what was approved.", boundary: "A reviewer cannot turn Publish only into Publish and notify now, and approving one language or one audience approves no other." },
      {
        title: "Publish, then notify",
        body: "Results are reported per variant: if one locale releases and a sibling fails, the success and the sibling's prior good release both stand. A notification request is simulated rather than sent, the mail-submission label sits on the control that requests it and again on every per-send result, and each eligible recipient receives exactly one copy with one pinned rendition, while a protected notice is a minimal link-only message carrying no protected prose, images, poster, transcript or captions.",
        boundary: "Accepted, failed and unknown are three different results: an accepted notification is neither a delivery nor a reading, an unknown result offers a check of the result rather than a second send, and a withdrawal does not recall a copy already seen.",
      },
      {
        title: "Inspect the message and the receiving experience",
        body: "The synthetic inbox renders the HTML and the plain-text form of each notice, and the receiving " + "preview shows the list and the exact post for the persona you selected, rechecking access " + "every time it is opened.",
        boundary: "What a reader may see is decided again on open, not by the session that sent the notice.",
        links: [
          { href: "/communication/inbox", label: "the synthetic inbox" },
          { href: "/preview", label: "the receiving preview" },
        ],
      },
    ],
  },
  "journey-pages-release": {
    heading: "Compose a Worker or Project Page → preview the selected locale edition and video → release → withdraw visibility.",
    steps: [
      {
        title: "Compose from the two catalogues",
        body: "Each of the two guided catalogues offers all eight admitted section types, and a section offers " + "only admitted presentation choices: normal or emphasized treatment, single-column or " + "two-column image and text, start or centre alignment, and cover or contain image fit.",
        boundary: "There is no arbitrary styling, script, embed or per-page theme: a presentation value outside the admitted set is rejected rather than styled.",
        links: [{ href: "/pages", label: "the Pages catalogue" }],
      },
      { title: "Build without dragging", body: "Add, move, duplicate and remove all work with a keyboard and a single pointer, and a preset creates a reviewable draft rather than a release.", boundary: "Nothing here needs a drag, and no arrangement is reachable only by pointer gesture." },
      {
        title: "Preview one locale edition",
        body: "Each locale edition has its own draft, candidate and release, so editing the English never overwrites an Arabic draft or advances a French release. The preview shows the selected edition exactly, with its video, poster and captions, and the media-preparation label appears beside each image or video while it is prepared.",
        boundary: "It is exact, currently authorised and inert: it sends no mail, subscribes no reader, publishes nothing and starts no payment.",
      },
      {
        title: "Release, set reach, then withdraw",
        body: "Reach is one of three values: Not public, Shared by link: public, or Listed publicly. The discovery index lists only the Listed-public editions, and a direct link to a link-public edition is served with noindex. The publication-reach label appears on the release result, because what a release reaches is demonstrated in the receiving preview rather than published anywhere.",
        boundary: "Stop showing me publicly takes effect immediately and contains every locale edition, even when an unrelated draft is invalid; a withdrawn edition becomes a neutral tombstone.",
        links: [{ href: "/preview/pages", label: "the discovery index" }],
      },
      {
        title: "Giving and language on a released edition",
        body: "Every Give placement uses the release's one approved Designation, and a placement appears only where the source qualifies the amount, goal, measure, currency, period and coverage.",
        boundary:
          "When that Designation is missing, revoked or incompatible the page shows Giving unavailable " + "with no fallback fund and takes no payment, and the giving-destination label appears on the " + "placement itself; a locale with no permitted fallback shows Language unavailable rather than " + "guessing.",
      },
    ],
  },
  "journey-outreach-coaching": {
    heading: "Manage an initiative, a referral and a recurring task → share coaching context → revoke it.",
    steps: [
      {
        title: "Run an initiative",
        body: "The working list holds only the partners you explicitly selected: included, removed and " + "excluded are three different states, stages come from a source-approved list with no drag " + "board, and each Request's response binds to the terms version it answers.",
        boundary: "Agreement creates no pledge, gift, task, subscription or send, and a job title or household " + "relationship establishes no authority. Closing requires a disposition for owned unfinished " + "work, and reopening preserves history.",
        links: [{ href: "/partners/initiatives", label: "the initiatives" }],
      },
      {
        title: "Work a referral",
        body: "A referral carries its original introduction date with its precision. The New window counts " + "N calendar days with the introduction date as day one and ends at an exclusive endpoint, and " + "Continue ends at the acceptance instant plus N × 86,400 seconds.",
        boundary: "Unknown or approximate precision shows no deadline and no Continue; expired history shows " + "identity, source reference, status and permitted dates only; Continue consumes one cycle and " + "admits at most one follow-on cycle.",
        links: [{ href: "/partners/referrals", label: "the referrals" }],
      },
      {
        title: "Keep a recurring task useful",
        body: "One of the five repeat profiles, with a first due date, a planning timezone and an explicit " + "end. A missing monthly day resolves to the final day of that month and the resolution is " + "disclosed, and only one occurrence is actionable at a time.",
        boundary: "Several missed dates produce Plan needs review rather than an overdue stack, a this-and-future " + "change is prospective and leaves completed history intact, and a stale action cannot undo a Stop.",
        links: [{ href: "/work", label: "the Work lists" }],
      },
      {
        title: "Share coaching context",
        body: "The invitation names the recipient, organization, ministry, five modules that all start unselected, and a duration. The share cutoff is the exclusive start of the civil day after the Share-through date you choose, frozen when the invitation is accepted, and financial sharing uses a separately reviewed fixed date range.",
        boundary: "The coach view is read-only, authorises before it enumerates and shows only admitted modules; a coach holds exactly two actions — accept, and leave.",
        links: [
          { href: "/coaching", label: "your coaching preparation" },
          { href: "/coaching/sharing", label: "coaching sharing" },
        ],
      },
      {
        title: "Revoke it",
        body: "Revocation sits beside the modules it ends, on the same sharing surface, and after the cutoff every read is denied.",
        boundary: "Revocation and every stop action work even when a draft is invalid, never delete your own work, and never claim to recall information that has already been seen.",
        links: [{ href: "/coaching/sharing", label: "coaching sharing" }],
      },
    ],
  },
};
/** Where the persistent label sits, and what the five effect labels state between them. */
const SIMULATED_INTRO = "The Development data label sits in the application shell on every screen, is not dismissible, and stays present on a denied, expired or unavailable surface too. Each of the five effects below is disclosed where you trigger it, and each sentence is the shared label's own.";
/** The boundary all five labels add up to. */
const SIMULATED_CLOSING = "Nothing outside this application changes: no mail leaves it, no payment is taken, and no third-party copy exists. A withdrawal stops this application serving an edition; it does not recall a copy that has already been seen.";
/** The five simulated effects, each with the trigger point it is labelled at. */
const SIMULATED_EFFECTS = [
  { effect: "mail-submission", title: "Mail submission", where: "Labelled when you request a notification for a publication, and again on the per-send result that follows it." },
  { effect: "publication-reach", title: "Publication reach", where: "Labelled on a release result, because what a release reaches is demonstrated in the receiving preview rather than published anywhere." },
  { effect: "giving-destination", title: "Giving destination", where: "Labelled on every placement that offers giving, where no payment can be taken." },
  { effect: "importer-safety", title: "Importer safety", where: "Labelled when you submit a file to the import journey, where a successful local parse says nothing about whether the file was safe." },
  { effect: "media-preparation", title: "Media preparation", where: "Labelled while an image or a video is prepared, here in the Update editor and in the Page builder." },
] as const;
interface ProseItem {
  readonly title: string;
  readonly body: string;
}
interface ProseSection {
  readonly intro: string;
  readonly items: readonly ProseItem[];
}
/** The three sections that are prose rather than a journey, a label list or the shared Help content. */
const PROSE_SECTIONS: Readonly<Record<ProseSectionId, ProseSection>> = {
  "development-controls": {
    intro: "The development panel states the identity this session carries and selects a scenario, a clock and a failure plan, and offers the same reset Settings offers. None of them is a permission, and none of them changes anything outside this session.",
    items: [
      {
        title: "Preview persona",
        body: "States the seeded persona the session carries and the roster the runtime lists, so a preview shows what that identity is given. It switches nothing: the identity is the seeded session the browser carries, every read that follows is authorised again, and a persona that may not read a surface receives the honest denial instead of a hidden destination.",
      },
      { title: "Scenario", body: "Selects which seeded world the session runs in — which source is unavailable, which content state is seeded, which setting a journey is under — for that session only, so two sessions can be in two scenarios at once." },
      {
        title: "Clock",
        body: "An offset from one fixed seed instant, moved only by these controls. Moving it forward moves every boundary that is decided when you read: the referral windows, the notification usefulness window, the confirmation window, the coaching share cutoff and recurrence. Nothing advances it in the background.",
      },
      {
        title: "Failure plan",
        body: "Arms one mode for one named read or mutation and stays visible while armed. Scope denial refuses a surface without revealing whether anything exists behind it; a changed revision shows the current value beside the input you kept; a lost acknowledgement offers a check of the result by its operation identity instead of a second send.",
      },
      { title: "Reset", body: "Deletes this session's local store and re-seeds it deterministically from the seeded data — the same operation as running bun run reset from the repository root. Every accepted edit is discarded and there is no undo. It is offered here and in Settings." },
    ],
  },
  "keyboard-and-display": {
    intro: "Every retained job completes with a keyboard, on a narrow screen, at 200% zoom, with reduced motion, and with a screen reader describing it.",
    items: [
      {
        title: "Keyboard",
        body: "Every job is reachable from the keyboard and nothing needs dragging: list reordering, section moves and column sizing all offer button alternatives. The focus indicator stays visible and is never hidden behind the sticky header, and a table's scroll region is labelled, focusable, and the only thing that scrolls sideways.",
      },
      {
        title: "Small screens and zoom",
        body: "At 320 CSS pixels every job still completes: the shell collapses to phone navigation, the detail body becomes a full page, and the partner-by-month report switches to a period-first presentation rather than asking you to drag. 200% zoom behaves the same way, and the page itself never scrolls horizontally.",
      },
      { title: "Reduced motion", body: "Transitions are restrained and are dropped when your device asks for reduced motion." },
      { title: "Screen readers", body: "State is carried by text and never by colour alone, every chart exposes a data table and a short summary, loading never renders as empty, and a source that did not answer says unavailable rather than zero." },
      { title: "Forms", body: "A save that fails keeps what you already entered, and pasting into a field is never blocked." },
    ],
  },
  "known-limitations": {
    intro: "Three limitations are disclosed rather than hidden, and none of them is a capability.",
    items: [
      { title: "A tab prefix inside an exported cell", body: "A CSV export prefixes a tab inside any quoted field whose first character is =, +, - or @, or the full-width equivalent, so a spreadsheet does not evaluate the cell as a formula. The tab is part of the value and persists if the file is reimported." },
      { title: "Container timestamps after a video copy-remux", body: "A video copy-remux can retain the container's creation and modification timestamps. Descriptive tags are verified absent before the rendition is served, and an asset that still reports one is rejected." },
      { title: "Performance observations describe one environment", body: "The published figures — a filtered gifts page and a full 100,000-row export, measured over a workload of 10,000 partners and 100,000 gifts — are observations from the environment they were measured on, not a promise about capacity elsewhere." },
    ],
  },
};
function StepLinks({ links }: { readonly links: readonly StepLink[] }) {
  return (
    <p className="flex min-w-0 flex-wrap gap-x-4 gap-y-1">
      {links.map((link) => (
        <Link key={link.href} href={link.href} className={INLINE_LINK}>
          {link.label}
        </Link>
      ))}
    </p>
  );
}
/** One journey's steps: what you do, what it produces, and the boundary that keeps the result honest. */
function JourneySteps({ journey }: { readonly journey: Journey }) {
  return (
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
}
function SimulatedEffects() {
  return (
    <>
      <p className={BODY_TEXT}>{SIMULATED_INTRO}</p>
      <ul className="flex min-w-0 flex-col gap-5">
        {SIMULATED_EFFECTS.map((item) => (
          <li key={item.effect} className="flex min-w-0 flex-col gap-1.5">
            <h3 className={STEP_HEADING}>{item.title}</h3>
            <p className={BODY_TEXT}>{item.where}</p>
            <SimulationLabel effect={item.effect} />
          </li>
        ))}
      </ul>
      <p className={BODY_TEXT}>{SIMULATED_CLOSING}</p>
    </>
  );
}
function ProseBody({ section }: { readonly section: ProseSection }) {
  return (
    <>
      <p className={BODY_TEXT}>{section.intro}</p>
      <dl className="flex min-w-0 flex-col gap-4">
        {section.items.map((item) => (
          <div key={item.title} className="flex min-w-0 flex-col gap-1">
            <dt className={STEP_HEADING}>{item.title}</dt>
            <dd className={BODY_TEXT}>{item.body}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
function isJourneyId(id: SectionId): id is JourneyId {
  return id in JOURNEYS;
}
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
/** Reports a section no content was written for; unreachable while `SECTIONS` and the switch agree. */
function unhandledSection(section: never): never {
  throw new Error(`The Help page has no content for the section "${String(section)}".`);
}
/** The Help screen: one `h1`, the in-page contents, then every section in the one order the contents lists. */
export default function HelpPage() {
  return (
    <article className={PAGE_COLUMN}>
      <header className="flex min-w-0 flex-col gap-3">
        <h1 className="text-2xl font-semibold text-pretty wrap-anywhere">{PAGE_TITLE}</h1>
        <p className="max-w-prose text-sm text-muted-foreground text-pretty wrap-anywhere">{INTRODUCTION}</p>
      </header>
      <nav aria-labelledby={CONTENTS_ID} className="flex min-w-0 flex-col gap-2">
        <h2 id={CONTENTS_ID} className="text-base font-semibold">
          {CONTENTS_HEADING}
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
            {/* Focusable, so an in-page link lands on the heading it names instead of scrolling past it. */}
            <h2 id={section.id} tabIndex={-1} className={SECTION_HEADING}>
              {sectionHeading(section)}
            </h2>
            {sectionBody(section)}
          </section>
        </div>
      ))}
    </article>
  );
}
