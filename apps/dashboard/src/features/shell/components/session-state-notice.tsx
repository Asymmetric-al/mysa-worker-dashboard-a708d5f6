import Link from "next/link";
import type { ReactElement } from "react";

import StateNotice, { type NoticeAction, type NoticeHeadingLevel } from "@/components/state-notice";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { SourceReference } from "@/lib/ids";
import type { SessionState } from "@/modules/data-service/envelope";

import { NO_ACCESS_RECOVERY, SESSION_STATE_COPY, type SessionStateEntry } from "../copy/session-states";
const HEADING_TAGS: Readonly<Record<NoticeHeadingLevel, "h1" | "h2" | "h3" | "h4">> = { 1: "h1", 2: "h2", 3: "h3", 4: "h4" };
/** The level a section-level notice starts at; a gate that replaces the route passes `headingLevel={1}`, because the level belongs to the surrounding page. */
const DEFAULT_HEADING_LEVEL: NoticeHeadingLevel = 2;
/** The same two heading weights the pages and sections of this application use, so a recovery block sits in the document's own scale. */
const PAGE_HEADING_CLASS = "text-2xl font-semibold text-pretty wrap-anywhere";
const SECTION_HEADING_CLASS = "font-heading text-base font-medium";
const STEPS_LABEL = "Recovery steps";
/** The design system's small button shape with its fixed height lifted, so a translated or zoomed label wraps instead of clipping, and a 32 px minimum height so the target clears WCAG 2.5.8's 24x24 CSS px. */
const HELP_LINK_CLASS = "h-auto min-h-8 max-w-full whitespace-normal";
const HELP_ACTION: NoticeAction = { label: NO_ACCESS_RECOVERY.helpLabel, href: NO_ACCESS_RECOVERY.helpHref };
export const SESSION_STATE_INTENTS = ["open-workspace", "switch-context", "open-record", "save-change"] as const;
export type SessionStateIntent = (typeof SESSION_STATE_INTENTS)[number];

const INTENT_SENTENCE: Readonly<Record<SessionStateIntent, string>> = {
  "open-workspace": "The job that stopped here was opening the workspace.",
  "switch-context": "The job that stopped here was switching to another organization or ministry.",
  "open-record": "The job that stopped here was opening a record.",
  "save-change": "The job that stopped here was saving a change.",
};
export type SessionStateNoticeProps = {
  /** The state the session resolved to; `signed-in` renders nothing at all. */
  readonly state: SessionState;
  readonly intent?: SessionStateIntent;
  /** The source an outage is about, where the caller knows it; only the state whose copy names a source shows it. */
  readonly source?: SourceReference;
  readonly headingLevel?: NoticeHeadingLevel;
};
type RecoveryState = Exclude<SessionState, "signed-in">;

function describe(body: string, intent: SessionStateIntent | undefined): string {
  return intent === undefined ? body : `${body} ${INTENT_SENTENCE[intent]}`;
}
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
type RecoveryBlockProps = { readonly copy: SessionStateEntry; readonly intent: SessionStateIntent | undefined; readonly headingLevel: NoticeHeadingLevel };
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
type SessionNoticeProps = { readonly state: RecoveryState; readonly intent: SessionStateIntent | undefined; readonly source: SourceReference | undefined; readonly headingLevel: NoticeHeadingLevel };
function SessionNotice({ state, intent, source, headingLevel }: SessionNoticeProps): ReactElement {
  const copy = SESSION_STATE_COPY[state];
  if (copy.noticeKind === null) {
    return <RecoveryBlock copy={copy} intent={intent} headingLevel={headingLevel} />;
  }
  return (
    <div className="flex w-full flex-col gap-4 text-start">
      <StateNotice kind={copy.noticeKind} title={copy.title} description={describe(copy.body, intent)} action={HELP_ACTION} source={copy.sourceLabel === undefined ? undefined : source} headingLevel={headingLevel} />
      <RecoverySteps steps={copy.recoverySteps} />
    </div>
  );
}
/** A state added to the service's union makes this argument fail to compile, rather than reaching a silent empty screen at run time. */
function unhandledSessionState(state: never): never {
  throw new Error(`SessionStateNotice has no notice for the session state ${String(state)}.`);
}
export function SessionStateNotice({ state, intent, source, headingLevel = DEFAULT_HEADING_LEVEL }: SessionStateNoticeProps): ReactElement | null {
  switch (state) {
    case "signed-in":
      // An admitted session renders the workspace; returning nothing keeps this component safe to place on a surface already showing its records.
      return null;
    case "unavailable":
    case "denied":
    case "expired":
    case "no-access":
      return <SessionNotice state={state} intent={intent} source={source} headingLevel={headingLevel} />;
    default:
      return unhandledSessionState(state);
  }
}

export default SessionStateNotice;
