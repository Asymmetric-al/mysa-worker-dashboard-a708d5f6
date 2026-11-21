import type { ComponentPropsWithoutRef } from "react";

import { Info } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/cn";

/**
 * The label every simulated external effect shows, at the point the worker triggers it and again on
 * the result that follows.
 *
 * Five effects in this release would leave the application in production and are simulated here
 * instead: a submitted mail, a publication's reach, a giving destination, a contact import and media
 * preparation. AAP 0.7.2 fixes the sentence each one states, and Rule 1 clause 3 requires that a
 * simulated external effect be labelled as such rather than described as real. Those five sentences
 * are reproduced verbatim below: they are the one place the interface says what did not happen, so
 * none of them may be paraphrased, softened, shortened or merged with another.
 *
 * Publication and notification stay two labels. A publish-and-notify surface renders
 * `publication-reach` beside `mail-submission`, because publication is not delivery and a provider's
 * acceptance is not a person reading (AAP 0.8.5). Nothing here folds two effects into one sentence.
 *
 * The label is a disclosure, not a status. It states the limitation before the effect runs, and it
 * keeps the same wording when the simulated effect fails, so it cannot be read as a success or as an
 * error. There is deliberately no `tone`, `variant`, `status` or `onDismiss` prop and no dismiss
 * control: a caller cannot re-tone the sentence into an alarm or a celebration, and cannot remove it
 * and leave the effect unlabelled. Withdrawal and cancellation never claim to recall a message or a
 * third-party copy, so the label makes no such claim either.
 *
 * The persistent **Development data** marker on every screen belongs to `components/dev-banner.tsx`.
 * This component labels one simulated effect and never restates that marker's wording, so the two
 * disclosures cannot be confused for each other.
 *
 * It holds no state, performs no I/O and reads no clock, so it renders on the server and in the
 * browser alike and carries no `use client` boundary of its own.
 */

/**
 * The closed set of simulated external effects: one member per boundary that would leave the
 * application in production.
 *
 * The union is the component's contract. A caller cannot pass a free string, so a surface cannot
 * invent a sixth effect or ship a typo that renders no disclosure, and a new boundary cannot be
 * labelled without appearing both here and in {@link SIMULATION_LABELS}.
 */
export type SimulatedEffect =
  | "mail-submission"
  | "publication-reach"
  | "giving-destination"
  | "importer-safety"
  | "media-preparation";

/**
 * The exact sentence each simulated boundary states, in the specification's own words (AAP 0.7.2).
 *
 * `satisfies` makes the mapping exhaustive in both directions: a member of {@link SimulatedEffect}
 * with no sentence fails to compile, and a sentence for an effect that does not exist is rejected as
 * an excess property. It is frozen because the wording is part of the specification — a runtime
 * mutation of it would silently change what the interface claims about an effect that never happened.
 */
export const SIMULATION_LABELS = Object.freeze({
  "mail-submission": "simulated — no mail leaves this application",
  "publication-reach": "simulated publication; reach is demonstrated in the receiving preview",
  "giving-destination": "simulated giving destination; no payment is taken",
  "importer-safety": "synthetic files only; a successful local parse is not a safety qualification",
  "media-preparation": "local processing; not production scanning or transcoding",
} as const satisfies Record<SimulatedEffect, string>);

/**
 * Where the label sits. `inline` is the compact form placed immediately after the control that
 * triggers the effect; `block` is the surface-sized form for the result that follows it. Both are the
 * same sentence, and a surface that triggers a simulated effect shows it in both places.
 */
export type SimulationLabelContext = "inline" | "block";

/**
 * Props of {@link SimulationLabel}.
 *
 * `effect`, `context` and `className` are the whole presentation contract. The remaining element
 * attributes are available so a caller can attach an `id`, a `data-*` hook or `dir`, but the ones
 * that would change what the disclosure says or whether it can be reached are removed from the type:
 * `children` would let a caller replace the specified sentence, `role` and `aria-live` would turn a
 * static disclosure into a live region that announces on every render, `hidden` and `aria-hidden`
 * would let a caller hide it, and `style` would let a caller restate a colour, radius or spacing the
 * token layer owns.
 */
export interface SimulationLabelProps extends Omit<
  ComponentPropsWithoutRef<"div">,
  | "children"
  | "style"
  | "role"
  | "hidden"
  | "aria-hidden"
  | "aria-live"
  | "aria-atomic"
  | "dangerouslySetInnerHTML"
> {
  /** Which simulated boundary is disclosed. Required, so an unlabelled simulation cannot compile. */
  effect: SimulatedEffect;
  /** `inline` (default) beside the trigger, `block` on the result that follows it. */
  context?: SimulationLabelContext;
}

/**
 * The inline form paints its own page background rather than taking a muted one.
 *
 * The design system's muted foreground measures about 4.4:1 over the muted surface and about 4.8:1
 * over the page background (recorded against the token in `styles/globals.css`), so a disclosure
 * placed on the muted surface would fall below the 4.5:1 WCAG AA minimum for body text wherever a
 * caller put it. Painting the background holds the sentence at AA wherever the form lands, and the
 * border keeps it distinct from the surface around it. `w-fit` with `max-w-full` lets the sentence
 * wrap inside a 320 CSS px viewport instead of forcing the page to scroll, and `text-start` keeps it
 * aligned with the document's direction rather than the screen's.
 */
const INLINE_SURFACE =
  "flex w-fit max-w-full items-start gap-2 rounded-md border border-border bg-background px-2.5 " +
  "py-1.5 text-start text-sm text-muted-foreground text-pretty wrap-anywhere";

/**
 * The icon is decorative — the sentence carries the whole meaning — so it is `aria-hidden` and never
 * the sole indication of anything. `mt-0.5` (2px) centres the 16px icon on the first 20px line of the
 * inline sentence; the block form leaves that alignment to `Alert`, whose own rules nudge a child
 * svg into place.
 */
const INLINE_ICON = "mt-0.5 size-4 shrink-0";
const BLOCK_ICON = "size-4 shrink-0";

/**
 * Resolves the sentence for an effect, refusing a value that has none.
 *
 * The union makes an unknown value a compile error, but a consumer building the prop from dynamic
 * data can still cast one in. Rendering nothing would leave a simulated effect unlabelled — the one
 * outcome Rule 1 clause 3 forbids — so an unrecognised effect is reported as the defect it is rather
 * than silently producing an empty sentence.
 */
function labelFor(effect: SimulatedEffect): string {
  if (!Object.hasOwn(SIMULATION_LABELS, effect)) {
    throw new Error(
      `SimulationLabel received an effect it has no sentence for: "${String(effect)}". ` +
        "Every simulated boundary must state what did not happen, so add the effect to " +
        "SIMULATION_LABELS instead of passing a value the interface cannot label.",
    );
  }

  return SIMULATION_LABELS[effect];
}

/**
 * Discloses one simulated external effect: the compact sentence beside the control that triggers it,
 * or the block form on the result that follows.
 *
 * Both forms are static text in reading order. Neither is a live region, so mounting the label
 * announces nothing and the announcing region stays the caller's own result surface — which is why
 * the block form passes `role={undefined}` to `Alert`, whose `role="alert"` default would otherwise
 * make a permanent disclosure announce itself on every render.
 */
export function SimulationLabel({
  effect,
  context = "inline",
  className,
  ...rest
}: SimulationLabelProps) {
  const sentence = labelFor(effect);

  if (context === "block") {
    return (
      <Alert
        {...rest}
        // A disclosure that states a limitation takes the informational variant and never
        // `destructive`: an alarm-toned sentence would present an honest simulation as a fault.
        variant="default"
        role={undefined}
        data-simulation-effect={effect}
        data-simulation-context="block"
        className={className}
      >
        <Info aria-hidden="true" focusable="false" className={BLOCK_ICON} />
        <AlertDescription>{sentence}</AlertDescription>
      </Alert>
    );
  }

  return (
    <p
      {...rest}
      data-slot="simulation-label"
      data-simulation-effect={effect}
      data-simulation-context="inline"
      className={cn(INLINE_SURFACE, className)}
    >
      <Info aria-hidden="true" focusable="false" className={INLINE_ICON} />
      <span>{sentence}</span>
    </p>
  );
}

export default SimulationLabel;
