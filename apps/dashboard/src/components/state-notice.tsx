"use client";

/**
 * The single surface for the seven states that are not a result.
 *
 * An empty collection, a load in progress, a source that could not be read, an effect whose fate
 * is unknown, a refused request, a period that is only partly covered and a language with no
 * permitted edition are seven different facts, and no two of them may share a rendering.
 * "Nothing matched these filters" is not "no contacts yet"; an outage is neither an empty list
 * nor a zero; an unknown outcome is neither success nor failure; a refusal must not show, by a
 * count, a title, a size or even a difference in wording, that anything exists. Keeping those
 * rules in one component is what stops a dozen hand-written empty states from drifting apart and
 * silently presenting one state as another.
 *
 * Each kind has exactly one rendering rule:
 *
 * - `empty` composes the design system's `Empty` and offers the caller's real first action, never
 *   an illustration.
 * - `loading` uses `Spinner` and `Skeleton` sized to the region it replaces, and marks the region
 *   `aria-busy` instead of adding a live-region message that would repeat on every render.
 * - `unavailable` names the source that could not be read, renders no number at all, and offers
 *   the caller's retry.
 * - `unknown` shows the `operationId` and permits checking the result, and — only where the
 *   caller decides it — replaying the same request. It never offers to send the work again.
 * - `denied` prints the closed reason code beside wording that is identical whether or not a
 *   record exists. The caller names the surface, never the record.
 * - `partial-coverage` states the covered range, the period outside it and that its totals are
 *   incomplete subtotals.
 * - `language-unavailable` reports the missing language and names no edition the reader may not
 *   read.
 *
 * Composition, not re-styling: the frame comes from `components/ui` (`Empty`, `Alert`, `Button`,
 * `Spinner`, `Skeleton`) and every colour, radius and space value from the tokens declared in
 * `styles/globals.css`. No money is formatted here — a notice that mentions an amount receives
 * text the money module already produced — and no total is computed here.
 *
 * Announced once, and at the right priority: a genuinely empty collection and an unreadable source
 * are announced once as they appear, in an alert region, because the surface in front of the
 * reader has just become a different thing; the four explanatory kinds sit in a polite status
 * region instead, because a refusal and an undetermined effect must not interrupt, and a partial
 * period or a missing language is information rather than an alarm. The busy kind states itself
 * through `aria-busy`. The title is a real heading element at the level the surrounding page needs,
 * so the notice joins the document outline instead of sitting outside it. Every control is a
 * keyboard-reachable design-system button of at least 24x24 CSS px, and an opaque source reference
 * or operation id renders inside `<bdi>` with the monospace identifier utility, so a leading zero
 * survives and a mixed-direction neighbour cannot reorder it.
 *
 * Holds no state of its own beyond the in-flight flag of an action the caller supplied: the state
 * a notice renders is the state it is given.
 */

import Link from "next/link";
import {
  CircleAlertIcon,
  CloudOffIcon,
  LanguagesIcon,
  ShieldAlertIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useRef, useState, type ReactElement, type ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";
import { formatSourceReference, type SourceReference } from "@/lib/ids";
import type { Coverage, CoverageState } from "@/modules/data-service/envelope";
import type { DenialReason } from "@/modules/data-service/outcome";

/**
 * Every state this component renders, listed once so the closed set has a runtime form as well
 * as a type. A caller that switches over these seven is exhaustive by construction.
 */
export const NOTICE_KINDS = [
  "empty",
  "loading",
  "unavailable",
  "unknown",
  "denied",
  "partial-coverage",
  "language-unavailable",
] as const;

/** One state a surface can be in instead of showing a result. */
export type NoticeKind = (typeof NOTICE_KINDS)[number];

/**
 * An in-page command a notice may run. It returns a promise when the work is asynchronous, so
 * the notice can hold the control busy until the caller's request settles.
 */
export type NoticeHandler = () => void | Promise<void>;

/**
 * The one call to action a notice offers.
 *
 * An action is either a destination (`href`, rendered as a link so it opens in a new tab and
 * reads as navigation) or an in-page command (`onClick`); when both are given the destination
 * wins. An action with neither renders nothing, because a control that does nothing is worse
 * than no control.
 */
export interface NoticeAction {
  readonly label: string;
  readonly href?: string;
  readonly onClick?: NoticeHandler;
}

/**
 * A re-request of the work that produced the notice.
 *
 * `onClick` must re-request the same work under the same identity — the same `operationId` for a
 * mutation — so a retry is a replay the service answers with the original result rather than a
 * second effect. Nothing here mints a new attempt, and nothing here labels uncertainty as a
 * failure.
 */
export interface NoticeRetry {
  readonly label: string;
  readonly onClick: NoticeHandler;
}

/** The heading levels a surrounding page can need; the level is the caller's, not the notice's. */
export type NoticeHeadingLevel = 1 | 2 | 3 | 4;

/** Props of {@link StateNotice}. */
export interface StateNoticeProps {
  /** Which state this notice reports. The seven rules are exclusive. */
  readonly kind: NoticeKind;

  /**
   * The notice's heading, or its visible status line for `loading`. For `denied` it names the
   * surface ("This partner record"), never the record: a title carrying a name would say that
   * the record exists.
   */
  readonly title: string;

  /** The caller's own sentence about this surface — never a count, an amount or a record name. */
  readonly description?: string;

  /** The one call to action. `empty` requires one for the job to be completable at all. */
  readonly action?: NoticeAction;

  /** The source that could not be read, for `unavailable`: an opaque `{ system, reference }`. */
  readonly source?: SourceReference;

  /** The re-request offered beside `unavailable` and `unknown`. */
  readonly retry?: NoticeRetry;

  /** The attempt whose fate is not known, for `unknown`. Rendered verbatim, leading zeros kept. */
  readonly operationId?: string;

  /** The period the source does or does not cover, for `partial-coverage`. */
  readonly coverage?: Coverage;

  /** The closed denial reason code, for `denied`. A code describes the request, not a record. */
  readonly reasonCode?: DenialReason;

  /** The heading level that fits the surrounding page. Defaults to 3. */
  readonly headingLevel?: NoticeHeadingLevel;

  /**
   * How many skeleton lines `loading` renders, so the busy region keeps the density of the region
   * it replaces instead of collapsing it. Defaults to 3 and is clamped to 1–12.
   */
  readonly loadingLines?: number;

  /** Layout classes for the surface the notice sits in. Never a colour, radius or shadow. */
  readonly className?: string;
}

/** The heading element for each level. A real heading, so the notice joins the document outline. */
const HEADING_TAG: Readonly<Record<NoticeHeadingLevel, "h1" | "h2" | "h3" | "h4">> = {
  1: "h1",
  2: "h2",
  3: "h3",
  4: "h4",
};

/** Relative widths for the `loading` skeleton lines, cycled so a block does not read as one bar. */
const LOADING_LINE_WIDTHS = ["w-full", "w-2/3", "w-4/5", "w-1/2"] as const;

/** The density ceiling for `loading` skeleton lines: past this the skeleton is the page. */
const MAX_LOADING_LINES = 12;

/** The density a notice assumes when the caller states none. */
const DEFAULT_LOADING_LINES = 3;

/** The kinds that share the alert frame; the two that frame themselves are excluded. */
type AlertNoticeKind = Exclude<NoticeKind, "empty" | "loading">;

/** What the alert frame shows, decided per kind by {@link renderAlertContent}. */
interface AlertContent {
  readonly icon: ReactElement;
  readonly body: ReactNode;
}

/** The values {@link renderAlertContent} needs to state each kind honestly. */
interface AlertContentInput {
  readonly kind: AlertNoticeKind;
  readonly description: string | undefined;
  readonly source: SourceReference | undefined;
  readonly retry: NoticeRetry | undefined;
  readonly operationId: string | undefined;
  readonly coverage: Coverage | undefined;
  readonly reasonCode: DenialReason | undefined;
}

/** The notice's heading, rendered as the element its level names. */
function NoticeHeading({
  level,
  children,
}: {
  readonly level: NoticeHeadingLevel;
  readonly children: ReactNode;
}): ReactElement {
  const Tag = HEADING_TAG[level];
  return <Tag>{children}</Tag>;
}

/**
 * How a notice's control behaves when the label is longer than the space it has.
 *
 * The design system's button is a single-line pill, and its label here is the caller's, so at a
 * phone width a long label such as "Replay the same request" would paint past the card's inline
 * edge instead of inside it. Allowing the label to wrap keeps the padding, the radius and the
 * focus ring intact while the control grows tall enough for two lines — never clipped, never
 * outside the surface, and still comfortably above the 24x24 CSS px target floor.
 */
const NOTICE_CONTROL_CLASS = "h-auto max-w-full whitespace-normal";

/** The height floor for each control size, kept above the target-size minimum once it may wrap. */
const NOTICE_CONTROL_HEIGHT: Readonly<Record<"default" | "sm", string>> = {
  default: "min-h-9 py-2",
  sm: "min-h-8 py-1.5",
};

/** Props of {@link NoticeButton}. */
interface NoticeButtonProps {
  readonly action: NoticeAction;
  readonly variant: "default" | "outline";
  readonly size: "default" | "sm";
  /** Whether the action this control starts is still running. */
  readonly pending: boolean;
  /** The in-page command, absent when the action is a destination or names no command. */
  readonly onRun: (() => void) | undefined;
}

/**
 * One call to action, as a design-system button or as the same button's styling on a real link.
 *
 * A destination renders through `next/link`, so it is navigation a reader can open in a new tab
 * and a keyboard user can follow with Enter; a command renders as a `type="button"` control so
 * it can never submit a surrounding form. While the command runs, the control carries the busy
 * spinner and is disabled, which is the one piece of state a notice keeps.
 */
function NoticeButton({
  action,
  variant,
  size,
  pending,
  onRun,
}: NoticeButtonProps): ReactElement | null {
  const controlClass = cn(NOTICE_CONTROL_CLASS, NOTICE_CONTROL_HEIGHT[size]);
  if (action.href !== undefined) {
    return (
      <Link href={action.href} className={cn(buttonVariants({ variant, size }), controlClass)}>
        {action.label}
      </Link>
    );
  }
  if (onRun === undefined) {
    return null;
  }
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={pending}
      onClick={onRun}
      className={controlClass}
    >
      {pending ? <Spinner /> : null}
      {action.label}
    </Button>
  );
}

/**
 * The period the source covers and, by implication, the period outside it.
 *
 * The covered range is what the envelope states; the gap is every date outside it. A boundary the
 * source did not state is reported as unstated rather than as the earliest or latest day it holds,
 * because those are different facts and only one of them is known.
 */
function CoverageGapSentence({ coverage }: { readonly coverage: Coverage }): ReactNode {
  const { from, to } = coverage;
  if (from === null && to === null) {
    return "The source stated neither a start nor an end for the period its records cover.";
  }
  if (to === null) {
    return (
      <>
        The source covers records from <bdi>{from}</bdi> onwards; every date before that one is
        outside the covered period.
      </>
    );
  }
  if (from === null) {
    return (
      <>
        The source covers records up to <bdi>{to}</bdi>; every date after that one is outside the
        covered period.
      </>
    );
  }
  return (
    <>
      The source covers records from <bdi>{from}</bdi> to <bdi>{to}</bdi>; every date before or
      after that range is outside the covered period.
    </>
  );
}

/** What the coverage state means for a total computed over the period. */
function CoverageCompletenessSentence({ state }: { readonly state: CoverageState }): string {
  switch (state) {
    case "complete":
      return "The source reports that period as fully covered, so a total over it covers all of the period.";
    case "partial":
      return "The source reports that period as only partly covered, so every total here is an incomplete subtotal rather than a whole-period figure.";
    case "unknown":
      return "Whether the source covers that whole period is not known, so every total here is an incomplete subtotal rather than a whole-period figure.";
  }
}

/** The two sentences `partial-coverage` owes a reader: what is covered, and what that makes a total. */
function CoverageSummary({ coverage }: { readonly coverage: Coverage | undefined }): ReactElement {
  if (coverage === undefined) {
    return (
      <>
        <p>The source did not state the period its records cover.</p>
        <p>
          Without a stated period, no total here can be presented as a whole-period figure, so every
          total is an incomplete subtotal.
        </p>
      </>
    );
  }
  return (
    <>
      <p>
        <CoverageGapSentence coverage={coverage} />
      </p>
      <p>
        <CoverageCompletenessSentence state={coverage.state} />
      </p>
    </>
  );
}

/**
 * The icon and the sentences for one explanatory kind.
 *
 * Every kind states its own fact in fixed wording before the caller's sentence, so a source
 * outage, an undetermined effect, a refusal, a partial period and a missing language cannot be
 * distinguished only by whatever a caller happened to write. The icons are decorative — the text
 * carries the meaning — and they give each kind a shape that survives greyscale and a reader who
 * cannot resolve colour.
 */
function renderAlertContent(input: AlertContentInput): AlertContent {
  const { kind, description, source, retry, operationId, coverage, reasonCode } = input;
  switch (kind) {
    case "unavailable":
      return {
        icon: <CloudOffIcon aria-hidden="true" />,
        body: (
          <>
            <p>
              The source that holds this data could not be read, so this surface reports the outage
              instead of an empty result or a zero.
            </p>
            {source === undefined ? null : (
              <p>
                Source <bdi className="mono-identifier">{formatSourceReference(source)}</bdi>.
              </p>
            )}
            {description === undefined ? null : <p>{description}</p>}
            {retry === undefined ? null : (
              <p>
                Retrying re-requests this read. Until it succeeds, no value on this surface stands
                in for the missing data.
              </p>
            )}
          </>
        ),
      };
    case "unknown":
      return {
        icon: <CircleAlertIcon aria-hidden="true" />,
        body: (
          <>
            <p>
              This change may have been applied and its acknowledgement never arrived, so its
              outcome is not known.
            </p>
            {operationId === undefined ? null : (
              <p>
                Operation <bdi className="mono-identifier">{operationId}</bdi>. Checking it returns
                the original result when the change was applied, and applies nothing when it was
                not.
              </p>
            )}
            {description === undefined ? null : <p>{description}</p>}
            <p>
              No second attempt starts from here: a check reads what happened, and repeating the
              same request under the same operation replays its original result rather than
              repeating the effect.
            </p>
          </>
        ),
      };
    case "denied":
      return {
        icon: <ShieldAlertIcon aria-hidden="true" />,
        body: (
          <>
            <p>This request is not permitted in the current scope and session.</p>
            {reasonCode === undefined ? null : (
              <p>
                Reason <bdi className="mono-identifier">{reasonCode}</bdi>.
              </p>
            )}
            {description === undefined ? null : <p>{description}</p>}
            <p>
              The answer is identical whether or not anything exists here, so nothing on this
              surface reveals what it cannot show.
            </p>
          </>
        ),
      };
    case "partial-coverage":
      return {
        icon: <TriangleAlertIcon aria-hidden="true" />,
        body: (
          <>
            <CoverageSummary coverage={coverage} />
            {description === undefined ? null : <p>{description}</p>}
          </>
        ),
      };
    case "language-unavailable":
      return {
        icon: <LanguagesIcon aria-hidden="true" />,
        body: (
          <>
            <p>
              No edition this reader is permitted to read exists in the requested language, so
              nothing is shown in its place.
            </p>
            {description === undefined ? null : <p>{description}</p>}
            <p>
              A fallback the reader may not read is neither offered nor named here, so this surface
              reports the missing language instead of substituting one.
            </p>
          </>
        ),
      };
  }
}

/**
 * The one empty, busy, unavailable, unknown, denied, partial-coverage or language-unavailable
 * surface in the application.
 *
 * Every list, card, chart, detail and export note renders its non-result states through this
 * component, which is what keeps "genuinely empty", "still loading", "could not be read", "not
 * known", "not permitted", "partly covered" and "not available in this language" seven separate
 * renderings rather than seven shades of the same blank panel.
 *
 * Takes no full-page mode: a denial renders beside the independent work that is still available
 * on the surface, so refusing one read never takes a page away.
 */
export function StateNotice({
  kind,
  title,
  description,
  action,
  source,
  retry,
  operationId,
  coverage,
  reasonCode,
  headingLevel = 3,
  loadingLines = DEFAULT_LOADING_LINES,
  className,
}: StateNoticeProps): ReactElement {
  const regionRef = useRef<HTMLDivElement | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  /**
   * Runs one action the caller supplied, holding the notice busy until it settles.
   *
   * The in-flight flag is mirrored in a ref so two activations in the same tick cannot both run —
   * a retry that started twice would be two requests where the contract promises one replay. A
   * rejected promise leaves the notice exactly as it stands: what the retry did is the caller's
   * to report, and an outage it did not clear is still the state this notice is rendering. Focus
   * returns to the region after a retry, because the control that was focused may be gone by then
   * and a keyboard user would otherwise land back at the top of the document.
   */
  const run = (handler: NoticeHandler, returnFocusToNotice: boolean): void => {
    if (pendingRef.current) {
      return;
    }
    pendingRef.current = true;
    setPending(true);

    const settle = (): void => {
      pendingRef.current = false;
      setPending(false);
      if (returnFocusToNotice) {
        regionRef.current?.focus();
      }
    };

    let result: void | Promise<void>;
    try {
      result = handler();
    } catch {
      settle();
      return;
    }
    void Promise.resolve(result).then(settle, settle);
  };

  const actionOnClick = action?.onClick;
  const runAction =
    actionOnClick === undefined
      ? undefined
      : (): void => {
          run(actionOnClick, false);
        };
  const retryOnClick = retry?.onClick;
  const runRetry =
    retryOnClick === undefined
      ? undefined
      : (): void => {
          run(retryOnClick, true);
        };

  /** `true` only while an action runs, so `aria-busy` states the region's own condition. */
  const busy = pending ? true : undefined;

  if (kind === "empty") {
    return (
      <Empty
        ref={regionRef}
        role="alert"
        aria-busy={busy}
        tabIndex={-1}
        // A phone width cannot spare the design system's large empty-state padding: at 320 CSS px
        // it would leave a text column narrower than a word. The padding steps down on narrow
        // surfaces and is unchanged from the small breakpoint upwards.
        className={cn("p-6 sm:p-12", className)}
      >
        <EmptyHeader>
          <EmptyTitle>
            <NoticeHeading level={headingLevel}>{title}</NoticeHeading>
          </EmptyTitle>
          {description === undefined ? null : <EmptyDescription>{description}</EmptyDescription>}
        </EmptyHeader>
        {action === undefined ? null : (
          <EmptyContent>
            <NoticeButton
              action={action}
              variant="default"
              size="default"
              pending={pending}
              onRun={runAction}
            />
          </EmptyContent>
        )}
      </Empty>
    );
  }

  if (kind === "loading") {
    const lines = Math.min(Math.max(Math.trunc(loadingLines), 1), MAX_LOADING_LINES);
    return (
      <div
        ref={regionRef}
        aria-busy={true}
        tabIndex={-1}
        className={cn(
          "flex w-full flex-col gap-3 rounded-lg border border-dashed border-border p-6",
          className,
        )}
      >
        {/*
          The status line is deliberately not a heading. It exists only while the region is busy,
          so a heading here would add a heading to the page's outline and remove it again on every
          load; `aria-busy` and this visible line state the condition without that churn.
        */}
        <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Spinner />
          <span>{title}</span>
        </p>
        {description === undefined ? null : (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
        <div aria-hidden="true" className="flex flex-col gap-2">
          {Array.from({ length: lines }, (_, line) => (
            <Skeleton
              key={line}
              className={cn(
                "h-4 rounded-md",
                LOADING_LINE_WIDTHS[line % LOADING_LINE_WIDTHS.length],
              )}
            />
          ))}
        </div>
      </div>
    );
  }

  const { icon, body } = renderAlertContent({
    kind,
    description,
    source,
    retry,
    operationId,
    coverage,
    reasonCode,
  });

  const buttons: ReactElement[] = [];
  if (action !== undefined) {
    const actionButton = (
      <NoticeButton
        key="action"
        action={action}
        variant="default"
        size="sm"
        pending={pending}
        onRun={runAction}
      />
    );
    if (actionButton !== null) {
      buttons.push(actionButton);
    }
  }
  if (retry !== undefined) {
    buttons.push(
      <NoticeButton
        key="retry"
        action={retry}
        variant="outline"
        size="sm"
        pending={pending}
        onRun={runRetry}
      />,
    );
  }

  return (
    <Alert
      ref={regionRef}
      role={kind === "unavailable" ? "alert" : "status"}
      aria-busy={busy}
      tabIndex={-1}
      className={className}
    >
      {icon}
      <AlertTitle>
        <NoticeHeading level={headingLevel}>{title}</NoticeHeading>
      </AlertTitle>
      <AlertDescription>
        {body}
        {buttons.length === 0 ? null : (
          <div className="flex flex-wrap items-center gap-2">{buttons}</div>
        )}
      </AlertDescription>
    </Alert>
  );
}

export default StateNotice;
