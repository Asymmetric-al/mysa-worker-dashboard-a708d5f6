/**
 * The one surface that turns a session state into the notice a worker reads.
 *
 * **Why it exists.** AAP 0.10.1's first family admits a session in four states and adds the no-access
 * recovery state, each with its own way forward, and AAP 0.7.2 states that a no-access user's "only
 * honest outcome is account-recovery guidance". The wording for those five states is already owned by
 * `../copy/session-states`; what was missing is the surface that maps a state to it. This file is that
 * mapping and nothing more.
 *
 * **What it composes.** `components/state-notice` — the application's single surface for a state that is
 * not a result — carries the notice itself, so no empty, denied, unavailable or recovery presentation is
 * written here a second time (AAP 0.3.4, Rule 1 clause 2). The per-state `noticeKind` is passed through
 * from the copy module rather than re-derived, and no sixth kind is added: the copy module gives
 * `no-access` no notice at all, because its subject is an account to recover rather than a surface that
 * stopped, so that state renders the standalone `NO_ACCESS_RECOVERY` block from the same module.
 *
 * **What it refuses to promise.** There is no authenticator in this release, so no state renders a
 * password field, a sign-in link or a retry the component cannot perform: `expired` states re-entry
 * guidance only, and every state names the Help destination the copy module owns. A refusal reveals
 * nothing — AAP 0.3.2 requires authorisation before enumeration, so no count, title, size, identifier or
 * existence hint is concatenated into the denial; the only data-driven value rendered anywhere here is
 * the source reference of an outage, and `StateNotice` isolates it in a `<bdi>` so an unknown-direction
 * reference cannot reorder the sentence.
 *
 * **Where it sits.** The shell owns the page's landmarks and its `h1`; this component renders one
 * section-level notice inside that `<main>`, in the same order on every state — title, the sentence, the
 * Help action, then the ordered steps — so the Help destination keeps one position across screens
 * (WCAG 3.2.6 Consistent Help, AAP 0.12.1 criterion 20).
 *
 * **Layering.** `features/shell → components`. It imports no other feature, no store and no development
 * runtime, reads no clock, and holds no state, so it stays server-renderable and safe to place
 * defensively on any surface. `SessionState` comes from the envelope module because the service's index
 * does not re-export the type, exactly as `../copy/session-states` takes it.
 */

import Link from "next/link";
import type { ReactElement } from "react";

import StateNotice, { type NoticeAction, type NoticeHeadingLevel } from "@/components/state-notice";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { SourceReference } from "@/lib/ids";
import type { SessionState } from "@/modules/data-service/envelope";

import { NO_ACCESS_RECOVERY, SESSION_STATE_COPY, type SessionStateEntry } from "../copy/session-states";

/** The headings a section-level notice may need, mapped once so the recovery block and the notice agree. */
const HEADING_TAGS: Readonly<Record<NoticeHeadingLevel, "h1" | "h2" | "h3" | "h4">> = {
  1: "h1",
  2: "h2",
  3: "h3",
  4: "h4",
};

/**
 * The level a section-level notice starts at: the route owns the page's `h1`, so this notice is the `h2`
 * beneath it. A caller rendering the notice as the whole page — a gate that replaces the route — passes
 * `headingLevel={1}` instead, because the level belongs to the surrounding page, not to the notice.
 */
const DEFAULT_HEADING_LEVEL: NoticeHeadingLevel = 2;

/**
 * The heading weight a page-level notice and a section-level one each need: the same two the pages and
 * sections of this application already use, so a recovery block sits in the document's own scale.
 */
const PAGE_HEADING_CLASS = "text-2xl font-semibold text-pretty wrap-anywhere";

const SECTION_HEADING_CLASS = "font-heading text-base font-medium";

/** The name the ordered steps carry, so a screen reader announces them as one group rather than as loose items. */
const STEPS_LABEL = "Recovery steps";

/**
 * The recovery block's Help link needs the design system's small button shape with its fixed height
 * lifted, so a translated or zoomed label wraps inside it instead of being clipped, and a 32 px minimum
 * height so the target clears WCAG 2.5.8's 24x24 CSS px.
 */
const HELP_LINK_CLASS = "h-auto min-h-8 max-w-full whitespace-normal";

/**
 * The one Help action, taken wholly from the copy module so the sentence and the route have a single
 * owner and the destination keeps the same place on every non-admitted state (WCAG 3.2.6).
 */
const HELP_ACTION: NoticeAction = { label: NO_ACCESS_RECOVERY.helpLabel, href: NO_ACCESS_RECOVERY.helpHref };

/** The jobs a caller may narrow the recovery wording to, listed once so the closed set also has a runtime form. */
export const SESSION_STATE_INTENTS = ["open-workspace", "switch-context", "open-record", "save-change"] as const;

/** The job a caller was attempting when the session state stopped it; it narrows the wording and nothing else. */
export type SessionStateIntent = (typeof SESSION_STATE_INTENTS)[number];

/**
 * What each intent adds to the copy module's own sentence. Each states the job that stopped and nothing
 * else: no destination is invented, and no retry is offered, because only the surface that placed this
 * notice knows whether one exists.
 */
const INTENT_SENTENCE: Readonly<Record<SessionStateIntent, string>> = {
  "open-workspace": "The job that stopped here was opening the workspace.",
  "switch-context": "The job that stopped here was switching to another organization or ministry.",
  "open-record": "The job that stopped here was opening a record.",
  "save-change": "The job that stopped here was saving a change.",
};

/** Props of {@link SessionStateNotice}. */
export interface SessionStateNoticeProps {
  /** The state the session resolved to; `signed-in` renders nothing at all. */
  readonly state: SessionState;
  /** The job the reader was attempting, where the caller knows it. */
  readonly intent?: SessionStateIntent;
  /** The source an outage is about, where the caller knows it; only the state whose copy names a source shows it. */
  readonly source?: SourceReference;
  /** The heading level the surrounding page needs. */
  readonly headingLevel?: NoticeHeadingLevel;
}

/** The four states that grant nothing: every state except an admitted session. */
type RecoveryState = Exclude<SessionState, "signed-in">;

/** Appends the intent sentence to the copy module's own sentence, leaving that sentence untouched. */
function describe(body: string, intent: SessionStateIntent | undefined): string {
  return intent === undefined ? body : `${body} ${INTENT_SENTENCE[intent]}`;
}

/**
 * The ordered steps a reader can take next, from the copy module. A state whose copy states no steps
 * renders no empty list, and the list works for one step as well as for several.
 */
function RecoverySteps({ steps }: { readonly steps: readonly string[] }): ReactElement | null {
  if (steps.length === 0) {
    return null;
  }
  return (
    <ol aria-label={STEPS_LABEL} className="flex list-decimal flex-col gap-2 ps-5 text-sm text-muted-foreground marker:text-foreground">
      {steps.map((step) => (
        <li key={step} className="text-start">
          {step}
        </li>
      ))}
    </ol>
  );
}

interface RecoveryBlockProps {
  readonly copy: SessionStateEntry;
  readonly intent: SessionStateIntent | undefined;
  readonly headingLevel: NoticeHeadingLevel;
}

/**
 * The standalone guidance block a state with no notice kind renders: the copy module's title, sentence
 * and steps with the shared Help action placed before them, so the action sits in the same relative
 * position a notice puts it in. Nothing here restates a state's meaning — every word is the copy's.
 */
function RecoveryBlock({ copy, intent, headingLevel }: RecoveryBlockProps): ReactElement {
  const Heading = HEADING_TAGS[headingLevel];
  const headingClass = headingLevel === 1 ? PAGE_HEADING_CLASS : SECTION_HEADING_CLASS;
  return (
    <section aria-label={copy.title} className="flex w-full flex-col gap-3 text-start">
      <Heading className={headingClass}>{copy.title}</Heading>
      <p className="text-sm text-balance text-muted-foreground md:text-pretty">{describe(copy.body, intent)}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={NO_ACCESS_RECOVERY.helpHref} className={cn(buttonVariants({ variant: "default", size: "sm" }), HELP_LINK_CLASS)}>
          {HELP_ACTION.label}
        </Link>
      </div>
      <RecoverySteps steps={copy.recoverySteps} />
    </section>
  );
}

interface SessionNoticeProps {
  readonly state: RecoveryState;
  readonly intent: SessionStateIntent | undefined;
  readonly source: SourceReference | undefined;
  readonly headingLevel: NoticeHeadingLevel;
}

/**
 * One non-admitted state rendered through the single notice pattern, or through the recovery block when
 * the copy module declares no notice kind for it.
 */
function SessionNotice({ state, intent, source, headingLevel }: SessionNoticeProps): ReactElement {
  const copy = SESSION_STATE_COPY[state];
  if (copy.noticeKind === null) {
    return <RecoveryBlock copy={copy} intent={intent} headingLevel={headingLevel} />;
  }
  return (
    <div className="flex w-full flex-col gap-4 text-start">
      <StateNotice
        kind={copy.noticeKind}
        title={copy.title}
        description={describe(copy.body, intent)}
        action={HELP_ACTION}
        // An outage is the one state whose copy carries a source label, and naming the source of a read
        // that failed is the whole point of it. A refusal names no source, so none is passed to it.
        source={copy.sourceLabel === undefined ? undefined : source}
        headingLevel={headingLevel}
      />
      <RecoverySteps steps={copy.recoverySteps} />
    </div>
  );
}

/**
 * Proves the switch below handled every session state: a state added to the service's union makes this
 * argument fail to compile, rather than letting the new state reach a silent empty screen at run time.
 */
function unhandledSessionState(state: never): never {
  throw new Error(`SessionStateNotice has no notice for the session state ${String(state)}.`);
}

/** The one notice a session state renders: nothing when admitted, and the copy module's wording, steps and Help destination otherwise. */
export function SessionStateNotice({ state, intent, source, headingLevel = DEFAULT_HEADING_LEVEL }: SessionStateNoticeProps): ReactElement | null {
  switch (state) {
    case "signed-in":
      // An admitted session renders the workspace, so there is nothing to report. Returning nothing keeps
      // this component safe to place defensively on a surface that is already showing its records.
      return null;
    case "unavailable":
    case "denied":
    case "expired":
    case "no-access":
      // One renderer serves all four: the words, the notice kind and the steps come from the copy module,
      // and what this file adds is the mapping, the shared Help action and the source an outage names.
      return <SessionNotice state={state} intent={intent} source={source} headingLevel={headingLevel} />;
    default:
      return unhandledSessionState(state);
  }
}

export default SessionStateNotice;
