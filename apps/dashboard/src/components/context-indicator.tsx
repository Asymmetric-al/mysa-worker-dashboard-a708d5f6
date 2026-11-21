"use client";

/**
 * The one active-context display, and the one control that asks to change it.
 *
 * Every read in this application is authorised inside a scope, and the envelope that carries the data
 * states that scope. This component is where the scope becomes visible text, because the two things a
 * worker must never have to guess are which organisation and which ministry the record in front of them
 * belongs to (AAP 0.7.1, 0.10.1 Shell row). What it displays comes from `scope` — the authority the
 * data on screen was actually read under — and never from a record's fields, a display name or an email
 * address: equal-looking identifiers, names and addresses establish neither identity nor authority, so
 * the resolved scope is the only source. A response that arrived from a context the shell has already
 * left therefore shows up here as a mismatch between the ministry named and the ministry the page is
 * about, rather than being hidden behind a label the client invented for itself.
 *
 * **There is one context switch in this application, and it is not in this file.** The confirmation
 * dialog and the fence that cancels in-flight reads, empties the query cache and then dispatches the
 * context-selection mutation — in that order — live in `components/context-switch-guard`, and the shell
 * composes them once, so the switch is available from wherever the indicator is visible. This file
 * *requests* a change through `onRequestContext` and nothing else: it never calls a mutation, never
 * opens a second dialog for the same decision, and never shows a context the service has not
 * confirmed. A second confirmation surface here would be a second implementation of one decision, which
 * is exactly what the project rule forbids. The one thing it does reuse from the guard is its outcome
 * vocabulary: the notice below renders {@link ContextSwitchResult.summary}, so a refusal, a conflict and
 * an undetermined result are worded once, in the module that owns those sentences.
 *
 * **One ministry opens directly; several offer a chooser.** With a single admitted membership the
 * component is a static label: no menu, no control that opens onto one option, and nothing to press.
 * With more than one it is a menu button listing exactly the memberships the session resolver admitted —
 * a membership the principal does not hold is absent rather than disabled, because a disabled entry
 * would disclose that some other context exists and would imply an access request this release does not
 * offer. There is deliberately no "add an organisation", no "request access" and no membership
 * management: the retained job is choosing between contexts already admitted, and nothing else.
 *
 * **The support subject appears only where financial facts do.** A support projection is scoped to a
 * finance subject that is not the ministry it is reported in, so a surface showing money or a support
 * goal sets `showSupportSubject`; a relationship surface leaves it off rather than displaying an
 * identifier whose relevance it cannot explain.
 *
 * Accessibility and direction are structural. The chooser's accessible name carries both full names even
 * when the visible text is truncated, the tooltip offers the same full names plus the two opaque
 * references, and the current membership carries `aria-current="true"`. Opening, arrow navigation,
 * Escape and focus return are the installed `DropdownMenu`'s own behaviour — it composes Base UI inside
 * `components/ui`, so no primitive is imported directly here. Long labels truncate inside the control
 * and wrap in the static form, so the indicator stays visible at 320 CSS px and never pushes the header
 * into horizontal scroll. Only logical utilities are used, and every label and reference is wrapped in
 * `<bdi>` — a ministry named in an Arabic script cannot reorder the sentence around it, and an opaque
 * reference renders in the monospace, isolated `mono-identifier` utility so a leading zero survives.
 *
 * Layering: this file sits in the shared component layer, above `components/ui` and the envelope
 * contract, below the shell that renders it. It imports no feature, no store and no service, holds no
 * state of its own, reads no clock and formats no money. Every class is a token utility or a variant of
 * an installed component: no colour, radius, shadow or spacing literal appears here.
 */

import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import type { ContextSwitchResult, OutcomeSummary } from "@/components/context-switch-guard";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import type { Scope } from "@/modules/data-service/envelope";

// ---------------------------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------------------------

/**
 * One membership the session resolver admitted, as the shell supplies it.
 *
 * The labels are the words the person recognises and the identifiers are opaque strings with no
 * readable meaning. The pairs are distinct references — an organisation admits ministries, and a
 * ministry is not a finance subject — so they are never compared with or substituted for one another.
 */
export interface AdmittedContext {
  /** The organisation this membership is admitted under. */
  readonly organizationId: string;
  /** The organisation's display name, or an empty string when the source states none. */
  readonly organizationLabel: string;
  /** The ministry the membership admits. */
  readonly ministryId: string;
  /** The ministry's display name, or an empty string when the source states none. */
  readonly ministryLabel: string;
}

/**
 * The context a selection asks for: a scope without the acting principal.
 *
 * The principal is the session's and is never a choice a surface offers, so it cannot appear in a
 * request by construction. `supportSubjectId` is part of the shape a selection may carry, and this file
 * leaves it unset: the support subject identifies the finance projection of the context being moved to,
 * so only the service can resolve it. Carrying the current context's subject across would name another
 * context's projection.
 */
export interface ContextRequest {
  /** The organisation being asked for. */
  readonly organizationId: string;
  /** The ministry being asked for, which the selected organisation must admit. */
  readonly ministryId: string;
  /** The finance subject the caller already knows, when the service need not resolve it. */
  readonly supportSubjectId?: string;
}

/** Props of {@link ContextIndicator}. */
export interface ContextIndicatorProps {
  /**
   * The exact authority the visible data was read under, from the read envelope. Supplied rather than
   * derived, so a hand-built context object cannot compile into this component.
   */
  readonly scope: Scope;

  /**
   * Every membership the session admits. Memberships the principal does not hold must not be listed:
   * a disabled or greyed entry would disclose a context the caller cannot enter.
   */
  readonly admissions: readonly AdmittedContext[];

  /**
   * Asks for a different context. This is a request, not a switch: the shell routes it through
   * `ContextSwitchGuard` and `useContextFence`, which decide whether unsaved work must be resolved
   * first and perform the change once the service accepts it.
   */
  readonly onRequestContext: (next: ContextRequest) => void;

  /**
   * Whether this surface displays financial facts. A support projection is scoped to its finance
   * subject, so Support overview, Gifts, the reports and a coaching financial range pass `true`; a
   * relationship surface leaves it unset.
   */
  readonly showSupportSubject?: boolean;

  /**
   * The outcome of the last switch attempt, from the fence.
   *
   * Supplied, a refusal, a conflict or an undetermined result is explained here, in the words the guard
   * module owns, and the context shown stays the one the service confirmed. Omitted, nothing is
   * reported in this component: the shell may be reporting the same attempt in the dialog it owns, and
   * one attempt must not be announced twice.
   */
  readonly lastResult?: ContextSwitchResult | null;

  /** Layout classes for the wrapper. Never a colour, a radius or a shadow. */
  readonly className?: string;
}

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

/**
 * How an opaque reference renders: the monospace family, isolated from the surrounding direction, and
 * breakable so a long identifier wraps inside a narrow popover instead of being clipped.
 */
const IDENTIFIER_CLASS = "mono-identifier break-all";

/**
 * A label, or `null` when the source stated none.
 *
 * A blank name must never render as an empty prominent line: that would leave the surface looking like
 * it had a context whose name was simply missing, so it falls through to the opaque reference instead,
 * which at least says which context is in force.
 */
function labelOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Whether an admitted membership is the context currently in force. Compared by identifier only. */
function isCurrentContext(admission: AdmittedContext, scope: Scope): boolean {
  return (
    admission.organizationId === scope.organizationId && admission.ministryId === scope.ministryId
  );
}

/**
 * The two identifiers of a membership, joined for a React key only.
 *
 * It is a render key and never an identity: nothing compares it, joins on it, parses it or sends it
 * anywhere. Authority is always the pair of opaque references, checked as two values.
 */
function keyOf(context: { readonly organizationId: string; readonly ministryId: string }): string {
  return `${context.organizationId}::${context.ministryId}`;
}

/** The words that name a context in text, falling back to its reference when it has no name. */
function describeContext(
  organizationLabel: string | null,
  organizationReference: string,
  ministryLabel: string | null,
  ministryReference: string,
): string {
  return `${organizationLabel ?? organizationReference}, ${ministryLabel ?? ministryReference}`;
}

// ---------------------------------------------------------------------------------------------
// The two-line name, in truncating and wrapping forms
// ---------------------------------------------------------------------------------------------

/** Props of {@link ContextName}. */
interface ContextNameProps {
  /** The organisation's name, or `null` when no name is known. */
  readonly organizationLabel: string | null;
  /** The organisation reference rendered when no name is known. */
  readonly organizationReference: string;
  /** The ministry's name, or `null` when no name is known. */
  readonly ministryLabel: string | null;
  /** The ministry reference rendered when no name is known. */
  readonly ministryReference: string;
  /**
   * `true` inside the chooser, where the control's width is bounded and an ellipsis keeps one row; a
   * static label leaves it `false` and wraps, so a long name is readable in full rather than hidden.
   */
  readonly truncate: boolean;
  /** Whether to mark the ministry line as the context currently in force. */
  readonly markCurrent?: boolean;
  /**
   * Words a screen reader hears before the names, so the static form says what it is answering. The
   * chooser needs none: its accessible name already begins with the same words.
   */
  readonly srPrefix?: string;
}

/**
 * The active context as two lines: the organisation above the ministry, because a worker belongs to a
 * ministry of an organisation and reading the pair in that order matches how the pair is chosen.
 */
function ContextName({
  organizationLabel,
  organizationReference,
  ministryLabel,
  ministryReference,
  truncate,
  markCurrent = false,
  srPrefix,
}: ContextNameProps): ReactElement {
  const line = truncate ? "truncate" : "break-words";

  return (
    <span className="flex min-w-0 max-w-full flex-col items-start">
      {srPrefix === undefined ? null : <span className="sr-only">{srPrefix}</span>}
      <span className={cn("max-w-full text-xs leading-tight text-muted-foreground", line)}>
        {organizationLabel === null ? (
          <bdi className={IDENTIFIER_CLASS}>{organizationReference}</bdi>
        ) : (
          <bdi>{organizationLabel}</bdi>
        )}
      </span>
      <span
        className={cn("max-w-full text-sm leading-tight font-medium", line)}
        // The static form is the whole of the "which context is this" answer, so it is marked as the
        // current one. Inside the chooser the marking belongs to the menu item that denotes this
        // context, and inside the trigger the control's accessible name already says it.
        aria-current={markCurrent ? "true" : undefined}
      >
        {ministryLabel === null ? (
          <bdi className={IDENTIFIER_CLASS}>{ministryReference}</bdi>
        ) : (
          <bdi>{ministryLabel}</bdi>
        )}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// The finance subject, shown only where financial facts are shown
// ---------------------------------------------------------------------------------------------

/**
 * The support subject a projection is scoped to.
 *
 * It renders as a reference rather than a friendly name because that is exactly what the scope carries:
 * the support subject identifies a finance projection, not a ministry, and naming it after the ministry
 * would assert an identity relationship the envelope never states. A surface that shows money says which
 * projection the money was read from, which is what lets a worker compare two screens honestly.
 */
function SupportSubject({ reference }: { readonly reference: string }): ReactElement {
  return (
    <span className="flex min-w-0 max-w-full items-center gap-1.5">
      <span className="shrink-0 text-xs text-muted-foreground">Support subject</span>
      <Badge variant="outline" className="max-w-full">
        <bdi className={cn(IDENTIFIER_CLASS, "truncate")}>{reference}</bdi>
      </Badge>
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// What the last attempt settled as
// ---------------------------------------------------------------------------------------------

/**
 * The last switch attempt, when it did not change the context.
 *
 * The sentence and the machine value are the guard module's own summary, so a refusal reads identically
 * wherever it appears and a closed reason code is printed as the service wrote it rather than softened
 * into a friendlier phrase. An undetermined result is stated as uncertainty with its operation, never as
 * a success and never as an invitation to repeat the attempt.
 */
function SwitchNotice({ summary }: { readonly summary: OutcomeSummary }): ReactElement {
  return (
    // `<output>` carries the implicit `status` role, so the outcome is announced once and politely, and
    // it is still ordinary text for a reader who sees it.
    <output className="flex min-w-0 max-w-full flex-col gap-0.5 text-xs">
      <span className="break-words text-foreground">{summary.sentence}</span>
      {summary.detail === undefined ? null : (
        <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
          <span className="shrink-0">{summary.detail.label}</span>
          <bdi className={cn(IDENTIFIER_CLASS, "truncate")}>{summary.detail.value}</bdi>
        </span>
      )}
    </output>
  );
}

// ---------------------------------------------------------------------------------------------
// The chooser
// ---------------------------------------------------------------------------------------------

/**
 * The request one selection makes.
 *
 * Only the two references travel. `supportSubjectId` is deliberately left for the service to resolve:
 * the subject belongs to the context being moved to, and carrying the current context's subject across
 * would name another context's finance projection.
 */
function requestFor(admission: AdmittedContext): ContextRequest {
  return { organizationId: admission.organizationId, ministryId: admission.ministryId };
}

/** Props of {@link ContextChooser}. */
interface ContextChooserProps {
  /** Every admitted membership, in the order the session resolver supplied them. */
  readonly admissions: readonly AdmittedContext[];
  /** The membership currently in force, or `null` when it is not among the admissions. */
  readonly current: AdmittedContext | null;
  /** The scope the visible data was read under, for the references the tooltip states. */
  readonly scope: Scope;
  /** The control's accessible name, which carries both full names even when truncated. */
  readonly triggerLabel: string;
  /** Asks the shell for a different context; never performs the change itself. */
  readonly onRequestContext: (next: ContextRequest) => void;
  /** The visible two-line name inside the control. */
  readonly children: ReactNode;
}

/**
 * The chooser offered when more than one membership is admitted.
 *
 * It composes the installed menu rather than a select, because the list is a list of destinations the
 * worker moves between rather than a form value, and because the design system's menu already supplies
 * the keyboard behaviour — Enter or Space opens, arrows move, Escape closes and focus returns. Selecting
 * the membership already in force asks for nothing: it closes the menu, because a request that would be
 * answered `unchanged` is not worth making.
 */
function ContextChooser({
  admissions,
  current,
  scope,
  triggerLabel,
  onRequestContext,
  children,
}: ContextChooserProps): ReactElement {
  const currentKey = current === null ? null : keyOf(current);
  // The tooltip states the names in full — a truncated label cannot — and the two references, which
  // are what distinguishes two ministries whose names read alike.
  const organizationName = current === null ? null : labelOrNull(current.organizationLabel);
  const ministryName = current === null ? null : labelOrNull(current.ministryLabel);

  return (
    <DropdownMenu>
      <TooltipProvider>
        <Tooltip>
          {/*
            One element is both the menu trigger and the tooltip trigger, so the full names are
            reachable by pointer without adding a second control to the header. This is the composition
            Base UI documents for exactly this case: the tooltip's props merge onto the menu's trigger,
            and neither replaces the other's behaviour.
          */}
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                type="button"
                aria-label={triggerLabel}
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "h-auto max-w-full min-w-0 justify-start gap-2 px-2.5 py-1 text-start",
                )}
              >
                {children}
                <ChevronsUpDownIcon
                  aria-hidden="true"
                  className="ms-auto size-3.5 shrink-0 text-muted-foreground"
                />
              </DropdownMenuTrigger>
            }
          />
          <TooltipContent className="flex-col items-start gap-1">
            <span className="flex w-full min-w-0 items-start gap-1">
              <span className="shrink-0">Ministry</span>
              <span className="break-words font-medium">{ministryName ?? scope.ministryId}</span>
            </span>
            <span className="flex w-full min-w-0 items-start gap-1">
              <span className="shrink-0">Organization</span>
              <span className="break-words">{organizationName ?? scope.organizationId}</span>
            </span>
            <Separator className="my-0.5" />
            <span className="flex w-full min-w-0 items-start gap-1">
              <span className="shrink-0">Ministry reference</span>
              <bdi className={IDENTIFIER_CLASS}>{scope.ministryId}</bdi>
            </span>
            <span className="flex w-full min-w-0 items-start gap-1">
              <span className="shrink-0">Organization reference</span>
              <bdi className={IDENTIFIER_CLASS}>{scope.organizationId}</bdi>
            </span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <DropdownMenuContent align="start" className="w-64 max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel>Admitted contexts</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {admissions.map((admission) => {
          const atCurrent = keyOf(admission) === currentKey;
          return (
            <DropdownMenuItem
              key={keyOf(admission)}
              aria-current={atCurrent ? "true" : undefined}
              className="items-start"
              onClick={() => {
                if (atCurrent) {
                  return;
                }
                onRequestContext(requestFor(admission));
              }}
            >
              <ContextName
                organizationLabel={labelOrNull(admission.organizationLabel)}
                organizationReference={admission.organizationId}
                ministryLabel={labelOrNull(admission.ministryLabel)}
                ministryReference={admission.ministryId}
                truncate
              />
              {atCurrent ? (
                // The word carries the state; the tick repeats it for speed of scanning only.
                <span className="ms-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  <CheckIcon aria-hidden="true" className="size-3.5" />
                  Current
                </span>
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------------------------
// The indicator
// ---------------------------------------------------------------------------------------------

/**
 * The active context, always stated, and the one place a change of context is asked for.
 *
 * It holds no state: the context it shows is the one the props name, so a refused, conflicting or
 * undetermined attempt leaves the previous context on screen — which is the truth — instead of a
 * selection the service never accepted. The membership list is likewise the session's, supplied rather
 * than cached, so a context the principal stops being admitted to disappears with the next render.
 */
export function ContextIndicator({
  scope,
  admissions,
  onRequestContext,
  showSupportSubject = false,
  lastResult = null,
  className,
}: ContextIndicatorProps): ReactElement {
  const current = admissions.find((admission) => isCurrentContext(admission, scope)) ?? null;
  const canChoose = admissions.length > 1;

  const organizationLabel = current === null ? null : labelOrNull(current.organizationLabel);
  const ministryLabel = current === null ? null : labelOrNull(current.ministryLabel);

  // The two names and the mode they render in, shared by the trigger and the static form.
  const nameProps = {
    organizationLabel,
    organizationReference: scope.organizationId,
    ministryLabel,
    ministryReference: scope.ministryId,
    truncate: canChoose,
  } as const;

  // A switch that took effect needs no notice: the new context is the statement. Only the three
  // outcomes that left the context where it was are reported here.
  const notice = lastResult === null || lastResult.switched ? null : lastResult.summary;

  return (
    <div className={cn("flex min-w-0 max-w-full flex-col gap-1", className)}>
      {canChoose ? (
        <ContextChooser
          admissions={admissions}
          current={current}
          scope={scope}
          triggerLabel={`Active context: ${describeContext(
            organizationLabel,
            scope.organizationId,
            ministryLabel,
            scope.ministryId,
          )}. Change context.`}
          onRequestContext={onRequestContext}
        >
          <ContextName {...nameProps} />
        </ContextChooser>
      ) : (
        // With one membership there is nothing to choose, so the label is not a control: it is the
        // answer, marked as the context in force and announced as such.
        <ContextName {...nameProps} markCurrent srPrefix="Active context. " />
      )}

      {showSupportSubject ? <SupportSubject reference={scope.supportSubjectId} /> : null}

      {current === null ? (
        // The scope names a context the session does not admit. Saying so is the honest rendering: the
        // alternative is a blank or a guessed name, and either would hide that the screen and the
        // session disagree.
        <span className="max-w-full break-words text-xs text-muted-foreground">
          This context is not among the memberships this session admits, so no names are available
          for it. The references above identify what was read.
        </span>
      ) : null}

      {notice === null ? null : <SwitchNotice summary={notice} />}
    </div>
  );
}

export default ContextIndicator;
