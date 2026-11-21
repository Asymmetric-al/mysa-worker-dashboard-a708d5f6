/**
 * The one Give placement of a Worker or Project Page: the single Designation a release is approved to
 * show, or the honest statement that giving is unavailable at this placement.
 *
 * Giving is a destination an organization approves in a source, not a fund a page can choose, and this
 * release simulates it: nothing here reaches a payment provider, opens a checkout, offers a fund picker
 * or holds an amount. Two states are possible, and they never share a rendering.
 *
 * - Approved — the release resolved one approved Designation, so the card names it, states the approved
 *   word as text, carries the purpose sentence when the source supplied one, and shows the designation's
 *   opaque source-qualified identity. The destination stays inert: there is no control that could start a
 *   payment, and no form.
 * - Unavailable — the designation is missing, revoked or incompatible with this placement. The family's
 *   one non-result surface (`components/state-notice`, `kind="unavailable"`) says so in the copy module's
 *   words, together with the promise that no other fund and no default designation stands in its place.
 *   The state never reads as a zero, as an empty figure or as a stand-in amount, and it never reads as
 *   something the worker did wrong: the destination is approved elsewhere, so a page cannot supply one.
 *
 * Composition, never a second pattern (Rule 1 clause 2): the notice is `StateNotice`, the disclosure of
 * the simulated effect is `SimulationLabel`, the labels are the design system's `Card` and `Badge`, and
 * every sentence is a leaf of `../copy` — including the title that says giving is unavailable and the
 * sentence promising that nothing is substituted for the missing designation. No sentence is rewritten
 * here, so an assertion on those words reads the family's single source of them.
 *
 * This file computes and formats no financial value at all: no amount, total, percentage, progress,
 * currency or balance is modelled, so `modules/money` is not imported and nothing shown here can be
 * mistaken for a figure the finance owner would have to stand behind. `designationRef` is an opaque
 * identity, not an account.
 *
 * Direction and accessibility: the block inherits the document's direction, its spacing is logical, and
 * the designation name and its opaque reference are isolated in `<bdi>` so a mixed-direction value
 * cannot reorder its neighbours and a leading zero inside a reference survives. The state is always a
 * visible word rather than a tone, so approved and unavailable stay distinguishable in greyscale and to
 * a reader who cannot resolve colour.
 *
 * Presentation only: `layout` changes chrome — the card's density — and never the content, the order or
 * the honesty of what is shown. The component holds no state, reads no clock, fetches nothing and
 * changes nothing, so it renders on the server and in the browser alike and carries no `use client`
 * boundary of its own. The binding itself is read by the surface that hosts the placement, which is why
 * nothing here asks the service for it.
 */

import type { ReactElement } from "react";

import { SimulationLabel } from "@/components/simulation-label";
import { StateNotice } from "@/components/state-notice";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { formatSourceReference, type SourceReference } from "@/lib/ids";

import { copy } from "../copy";

/**
 * The approved half of what a give placement receives: the one Designation the release may show.
 *
 * The identity is a `SourceReference`, so two designations that happen to share a label stay two
 * designations, and the label is display text only. `purpose` is the source's own sentence about where
 * giving goes; it is optional because a source that supplied none has said nothing, which is not the
 * same as having said there is no purpose.
 */
export interface GivingDesignationApprovedView {
  readonly state: "approved";
  /** The approved Designation's display name, exactly as the source supplied it. */
  readonly designationLabel: string;
  /** The opaque, source-qualified identity of that Designation. Never parsed and never a join key. */
  readonly designationRef: SourceReference;
  /** The source's purpose sentence for the designation, when it supplied one. */
  readonly purpose?: string;
}

/**
 * The closed set of reasons a release can show no giving at all.
 *
 * A tuple rather than a bare union so the set also has a runtime form: a caller or a test can enumerate
 * it, the rendering below switches over it exhaustively, and adding a member without deciding how it
 * reads is a compile error instead of a silently unrendered state.
 */
export const GIVING_UNAVAILABLE_CAUSES = ["missing", "revoked", "incompatible"] as const;

/** Why a placement can show no giving: nothing approved, approval withdrawn, or the wrong placement. */
export type GivingUnavailableCause = (typeof GIVING_UNAVAILABLE_CAUSES)[number];

/**
 * The unavailable half of what a give placement receives.
 *
 * There is deliberately no `designationLabel`, no amount and no fallback designation: the state exists
 * precisely because the one approved destination is absent, and anything carried beside it here would
 * be a fund the source never approved.
 */
export interface GivingDesignationUnavailableView {
  readonly state: "unavailable";
  /** Which of the closed set of causes applies. Rendered as a sentence and exposed as data. */
  readonly cause: GivingUnavailableCause;
}

/**
 * What the read envelope carries for a give placement.
 *
 * Structurally the shape `readGivingBinding` returns: an approved designation with its identity, or the
 * reason there is none. It models no amount, no total and no fund list, because a placement that cannot
 * see the destination must not be able to imply a figure either.
 */
export type GivingBindingView = GivingDesignationApprovedView | GivingDesignationUnavailableView;

/**
 * Where the placement sits. `panel` is the builder's side surface; `inline` is the compact form used by
 * the review surface and the exact preview. Both show the same words in the same order.
 */
export type GivingDesignationLayout = "panel" | "inline";

/** Props of {@link GivingDesignation}. */
export interface GivingDesignationProps {
  /** The resolved binding for this placement. Required, so an unbound placement cannot render blank. */
  readonly binding: GivingBindingView;

  /** Which surface hosts the placement. Defaults to `panel`; chrome only. */
  readonly layout?: GivingDesignationLayout;

  /** Layout classes for the block this placement occupies. Never a colour, radius or shadow. */
  readonly className?: string;
}

/**
 * What the unavailable placement tells a reader, composed once from the family's wording module.
 *
 * Three sentences, each owning one fact: the explanation names the state and its possible causes, the
 * no-fallback note promises that nothing is substituted, and the never-zero note says the page states
 * this in words rather than as a figure. Joined here rather than at the call site so the notice text is
 * assembled in one place and cannot be shortened by a later caller.
 */
const GIVING_UNAVAILABLE_DESCRIPTION = [
  copy.giving.explanation,
  copy.giving.noFallbackNote,
  copy.giving.neverZeroNote,
].join(" ");

/**
 * The description the notice shows for one cause.
 *
 * The switch is exhaustive over {@link GIVING_UNAVAILABLE_CAUSES} and its `default` binds the cause to
 * `never`, so a fourth cause added to the tuple fails to compile here instead of falling through into
 * whichever sentence happened to be last. The wording module supplies one explanation that names all
 * three causes in a reader's terms and no per-cause sentence, and this file authors no wording of its
 * own, so every cause states that explanation; the block also carries the cause as `data-giving-cause`
 * so a reader of the DOM — a test included — can tell the three apart. A cause-specific sentence
 * belongs in `../copy` beside the explanation when the family gains one.
 */
function unavailableDescription(cause: GivingUnavailableCause): string {
  switch (cause) {
    case "missing":
    case "revoked":
    case "incompatible":
      return GIVING_UNAVAILABLE_DESCRIPTION;
    default: {
      const unhandled: never = cause;
      return unhandled;
    }
  }
}

/**
 * The Give placement, showing either the one approved Designation or why giving is unavailable here.
 *
 * A description rather than a control: releasing, withdrawing and binding a designation belong to the
 * surfaces that host this block, and a placement never changes what a release points at.
 */
export function GivingDesignation({
  binding,
  layout = "panel",
  className,
}: GivingDesignationProps): ReactElement {
  if (binding.state === "unavailable") {
    return (
      <div
        data-slot="giving-designation"
        data-giving-state="unavailable"
        data-giving-cause={binding.cause}
        data-layout={layout}
        className={cn("flex flex-col gap-2 text-start", className)}
      >
        <StateNotice
          kind="unavailable"
          title={copy.giving.title}
          description={unavailableDescription(binding.cause)}
        />
        <SimulationLabel effect={copy.giving.simulationKey} />
        <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">
          {copy.giving.previewInertNote}
        </p>
      </div>
    );
  }

  // A purpose the source left empty has said nothing, so it renders no paragraph at all rather than an
  // empty line that a reader would read as a purpose the source declined to state.
  const purpose = binding.purpose?.trim() ?? "";

  return (
    <Card
      size={layout === "panel" ? "default" : "sm"}
      data-giving-state="approved"
      data-layout={layout}
      className={cn("text-start", className)}
    >
      <CardHeader>
        <CardTitle className="wrap-anywhere">
          <bdi>{binding.designationLabel}</bdi>
        </CardTitle>
        {/*
          The approved word sits on its own line under the Designation rather than beside it: the
          badge is a single-line pill, and a header that shares one row with it squeezes the name into
          breaks inside words at 320 CSS px. Stacked, the name keeps the card's full width and the
          state word still sits beside the thing it describes.
        */}
        <Badge variant="secondary" className="justify-self-start">
          {copy.giving.designationApproved}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{copy.giving.designationLabel}</span>
          {/*
            The identity renders inside `<bdi>` with the identifier utility so a mixed-direction
            neighbour cannot reorder it and a leading zero in the reference survives exactly.
          */}
          <bdi className="mono-identifier wrap-anywhere">
            {formatSourceReference(binding.designationRef)}
          </bdi>
        </p>
        {purpose === "" ? null : (
          <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">
            <bdi>{purpose}</bdi>
          </p>
        )}
      </CardContent>
      <CardFooter className="flex-col items-start gap-2">
        <SimulationLabel effect={copy.giving.simulationKey} />
        <p className="text-xs text-muted-foreground text-pretty wrap-anywhere">
          {copy.giving.previewInertNote}
        </p>
      </CardFooter>
    </Card>
  );
}

export default GivingDesignation;
