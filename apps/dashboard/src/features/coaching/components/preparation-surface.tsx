"use client";

/**
 * The worker's own optional coaching preparation, and the plain statement that a coach never sees it.
 *
 * Preparation is a record class of its own: it is written for the worker, it is optional, and nothing
 * in it reaches a coach. A grant shares chosen modules (AAP 0.8.4), and this record is not one of
 * them, so the surface states that in words on every rendering — present, absent and unavailable —
 * because a privacy sentence that disappeared with a state could be read as a rule that had changed.
 * The text is the worker's own writing, so it renders as plain text with its line breaks intact. It is
 * never routed through the content family's editor or static renderer: this is not published prose and
 * must not become content-typed, re-serialised or linkable.
 *
 * Read-only preparation; authoring happens in the private check-in draft. The Coaching family's named
 * mutations contain no preparation mutation, so this surface deliberately offers none: it fetches
 * nothing, calls no mutation and renders only what its route hands it. The nearest real first action is
 * the private check-in draft at `/coaching/check-ins`, which is where a worker writes today, and that
 * is the destination both the absent rendering and the present rendering offer.
 *
 * Four states, four statements, no two blending into one:
 *
 * - present — the body as plain text (`whitespace-pre-wrap`), the civil date the envelope supplied, and
 *   the record-class statement.
 * - absent — `components/state-notice`'s `empty` kind with the real first action. Empty means the worker
 *   has not prepared anything yet; it is never a disabled control and never a placeholder illustration.
 * - unavailable — `components/state-notice`'s `unavailable` kind carrying the source identity that could
 *   not be read. An outage is not "no preparation yet" and it is not a zero.
 * - busy — a visible sentence, because a surface that is reading must never look empty. It outranks the
 *   other three for as long as it holds, the precedence this application gives a load over an error.
 *
 * Composition, never a second pattern (Rule 1 clause 2): the card, badges, separator and control come
 * from `components/ui`, the two non-result states from `components/state-notice`, and every sentence
 * `copy.ts` owns is rendered from `COACHING_COPY.overview`. No coach name, recipient, module list,
 * share control or timing appears here — disclosure is `sharing-summary`'s job — and no amount, measure,
 * cutoff or percentage is modelled, so nothing shown can be mistaken for a financial or shared fact.
 *
 * The date is the civil date the envelope supplied, printed in its stored ISO form. Nothing here reads a
 * clock, calls `Date`, or formats through `Intl`: a display locale belongs to the reader's settings, and
 * converting a calendar date here would pull a calendar library into the browser bundle for one line.
 * Direction is content: spacing is logical, the surface starts its text at the reading edge, and the
 * private statement and the body are isolated in `<bdi>` so a mixed-direction neighbour cannot reorder
 * them and a leading zero in an identifier survives.
 */

import Link from "next/link";
import type { ReactElement } from "react";

import { StateNotice } from "@/components/state-notice";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { CivilDate } from "@/modules/time/civil";

import { COACHING_COPY } from "../copy";

/**
 * One preparation record, as the route read it.
 *
 * `audience` is the literal `"private"` rather than a union, so a shared projection can never be passed
 * here by mistake and no reader of this file has to wonder whose copy is on screen. `updatedOn` is a
 * civil date and is `null` when the record carries no date: a date the envelope did not supply is not
 * filled in with today's.
 */
interface PreparationRecord {
  readonly body: string;
  readonly updatedOn: CivilDate | null;
  readonly audience: "private";
}

/**
 * The opaque identity of a source that could not be read, as the read envelope reports it.
 *
 * Both members are opaque: `reference` is never parsed, never compared across systems and never a join
 * key. It is declared here in the envelope's shape so it can be handed straight to `StateNotice`, which
 * is the one surface that states an outage and the source behind it.
 */
interface PreparationSourceIdentity {
  readonly system: string;
  readonly reference: string;
}

/** Props of {@link PreparationSurface}. The route reads the record and passes it; nothing is fetched here. */
export interface PreparationSurfaceProps {
  /** The worker's private preparation, or `null` when the worker has not prepared anything yet. */
  readonly preparation: PreparationRecord | null;

  /** Whether the route is still reading. A busy surface states that it is reading instead of looking empty. */
  readonly busy?: boolean;

  /**
   * The source that could not be read, when the read failed. Absent or `null` means the read answered;
   * it is the reason an outage is stated rather than an empty preparation being reported in its place.
   */
  readonly unavailable?: PreparationSourceIdentity | null;
}

/**
 * What this surface renders, with the data each state needs already attached.
 *
 * Resolving the four states once — rather than testing three props in several places — is what keeps the
 * precedence in one readable place and lets the branches below be exhaustive by construction.
 */
type PreparationView =
  | { readonly state: "busy" }
  | { readonly state: "unavailable"; readonly source: PreparationSourceIdentity }
  | { readonly state: "present"; readonly body: string; readonly updatedOn: CivilDate | null }
  | { readonly state: "absent" };

/**
 * This surface's own microcopy.
 *
 * `copy.ts` owns the family's state vocabulary and every sentence it supplies is rendered from it here:
 * the surface purpose, the absent sentence and the outage sentence all come from `COACHING_COPY.overview`.
 * The module holds no key for a preparation heading, a record-class label, the class statement itself,
 * the two notice titles, a busy line or a date label, so those are stated here; they belong beside
 * `COACHING_COPY` when the family gains keys for them. No limit, count, measure or period is restated:
 * this surface shows none.
 */
const PREPARATION_HEADING = "Private preparation";
const PRIVATE_CLASS_LABEL = "Private to you";
const PRIVATE_CLASS_STATEMENT = "Only you can see this; a coach you invite never sees it.";
const EMPTY_NOTICE_TITLE = "No preparation yet";
const UNAVAILABLE_NOTICE_TITLE = "Preparation unavailable";
const BUSY_STATEMENT = "Reading your preparation. Anything already saved is untouched.";
const UPDATED_ON_LABEL = "Last updated";
const NO_UPDATED_ON_STATEMENT = "No update date was recorded for this preparation.";
const EMPTY_BODY_STATEMENT = "This preparation has no text in it yet.";
const CHECK_INS_LINK_LABEL = "Write a check-in";

/**
 * The one destination where a worker writes today: the private check-in draft.
 *
 * The write itself is a check-in's own autosave, so this surface links to it rather than inventing a
 * preparation save that the service does not offer.
 */
const CHECK_INS_HREF = "/coaching/check-ins";

/** The id the section is labelled by. Derived, not generated, so the server and the browser agree. */
const HEADING_ID = "coaching-preparation-heading";

/**
 * A destination control that may wrap instead of painting past the card's inline edge.
 *
 * The design system's button is a single-line pill, so at 320 CSS px a longer label would overflow the
 * card; wrapping keeps the padding, radius and focus ring while the control grows tall enough for two
 * lines, still above the 24x24 CSS px target floor.
 */
const LINK_CONTROL_CLASS = "h-auto min-h-8 max-w-full whitespace-normal py-1.5";

/**
 * Settles which of the four statements this surface renders, in one place.
 *
 * The precedence is the application's own: a load outranks an error, so a route that is reading states
 * that it is reading, and the outage it is retrying is still reported when the read settles again. An
 * outage outranks a record, because a read that failed says nothing trustworthy about what the record
 * holds; a record outranks absence, because a record that exists is not an empty preparation.
 */
function resolveView({
  preparation,
  busy = false,
  unavailable = null,
}: PreparationSurfaceProps): PreparationView {
  if (busy) {
    return { state: "busy" };
  }
  if (unavailable !== null) {
    return { state: "unavailable", source: unavailable };
  }
  if (preparation !== null) {
    return { state: "present", body: preparation.body, updatedOn: preparation.updatedOn };
  }
  return { state: "absent" };
}

/**
 * The record region of the card: one rendering per state, exhaustive over {@link PreparationView}.
 *
 * The two non-result states are `StateNotice` rather than hand-written panels, so "nothing written yet"
 * and "the source could not be read" keep the wording and the frame every other surface uses for them.
 * The private-class statement sits above this region and is never part of a branch, so no state can
 * render without it.
 */
function PreparationContent({ view }: { readonly view: PreparationView }): ReactElement {
  switch (view.state) {
    case "busy":
      return (
        // `<output>` is the native status region, so the sentence is announced as it appears without a
        // `role` standing in for the element. The surrounding section is deliberately not marked
        // `aria-busy`: a busy region defers the announcements of the live regions inside it, which would
        // mute the one sentence that says the surface is reading rather than empty.
        <output className="block text-sm text-muted-foreground text-pretty wrap-anywhere">
          {BUSY_STATEMENT}
        </output>
      );
    case "unavailable":
      return (
        <StateNotice
          kind="unavailable"
          title={UNAVAILABLE_NOTICE_TITLE}
          description={COACHING_COPY.overview.unavailable}
          source={view.source}
          headingLevel={3}
        />
      );
    case "present":
      return view.body.trim() === "" ? (
        // A record with no text is a record, not an empty preparation: it says so rather than showing a
        // blank region a reader would take for a surface that failed to load.
        <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">
          {EMPTY_BODY_STATEMENT}
        </p>
      ) : (
        // Plain text, never HTML and never the content family's renderer: the line breaks the worker
        // wrote are the formatting, and `<bdi>` isolates the text from its mixed-direction neighbours.
        <bdi className="block break-words text-pretty whitespace-pre-wrap">{view.body}</bdi>
      );
    case "absent":
      return (
        <StateNotice
          kind="empty"
          title={EMPTY_NOTICE_TITLE}
          description={COACHING_COPY.overview.empty}
          action={{ label: CHECK_INS_LINK_LABEL, href: CHECK_INS_HREF }}
          headingLevel={3}
        />
      );
  }
}

/**
 * The worker's optional private preparation: the record, or the honest non-result, with the statement
 * that a coach never sees it on every rendering.
 *
 * Read-only preparation; authoring happens in the private check-in draft, so the only control here is
 * navigation to it. Nothing on this surface can share, publish, notify or write.
 */
export default function PreparationSurface(props: PreparationSurfaceProps): ReactElement {
  const view = resolveView(props);

  return (
    // A named section rather than a bare div: the heading describes the region, so a screen-reader user
    // can reach "Private preparation" directly and the text starts at the reading edge in either
    // direction.
    <section
      aria-labelledby={HEADING_ID}
      data-slot="preparation-surface"
      data-preparation-state={view.state}
      className="flex min-w-0 flex-col text-start"
    >
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="wrap-anywhere">
            <h2 id={HEADING_ID}>{PREPARATION_HEADING}</h2>
          </CardTitle>
          <CardDescription className="text-pretty wrap-anywhere">
            {COACHING_COPY.overview.purpose}
          </CardDescription>
          {/*
            The record class is a visible word, never a tone: "Private to you" stays readable in
            greyscale and to a reader who cannot resolve colour.
          */}
          <CardAction>
            <Badge variant="secondary">{PRIVATE_CLASS_LABEL}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">
            <bdi>{PRIVATE_CLASS_STATEMENT}</bdi>
          </p>
          <Separator />
          <PreparationContent view={view} />
        </CardContent>
        {view.state === "present" ? (
          <CardFooter className="flex-col items-start gap-2">
            <p className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-muted-foreground">
              {view.updatedOn === null ? (
                NO_UPDATED_ON_STATEMENT
              ) : (
                <>
                  <span>{UPDATED_ON_LABEL}</span>
                  {/* The civil date in its stored form: a calendar day is never given a time or a zone. */}
                  <bdi className="mono-identifier">{view.updatedOn.toString()}</bdi>
                </>
              )}
            </p>
            <Link
              href={CHECK_INS_HREF}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), LINK_CONTROL_CLASS)}
            >
              {CHECK_INS_LINK_LABEL}
            </Link>
          </CardFooter>
        ) : null}
      </Card>
    </section>
  );
}
