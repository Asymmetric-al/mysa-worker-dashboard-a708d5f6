"use client";

/**
 * The single recoverable boundary for the application's route segments.
 *
 * A page whose rendering throws has no result to give, and the one thing that must not happen
 * next is for the failure to read as a result: a blank region, an empty list or a zero would
 * each be taken as a fact about the reader's data. This surface replaces the failed segment. It
 * names what happened in plain language, offers the one action that can help — asking the router
 * to re-request the segment and then clearing the boundary so the fresh render mounts — and
 * leaves the application shell around it untouched, so navigation, the active context and the
 * persistent **Development data** label all survive the surface that failed.
 *
 * It renders the owned `state-notice` pattern instead of a panel of its own, in that pattern's
 * `unavailable` kind: the only one of the seven whose meaning is "this surface could not be
 * produced". `unknown` would assert that a change of the reader's may have been applied and
 * offer a replay under an operation identity this boundary never has; `empty` would state a
 * fact about the collection; `denied` would imply a permission refusal that did not happen. The
 * retry goes in that pattern's `retry` slot — the one control on the surface — so the reader is
 * offered a single next step rather than a quiet retry beside a louder unrelated action.
 *
 * What it deliberately never renders: the thrown error's own message and its stack trace, which
 * carry record bodies, identifiers and file paths; any record data at all; and any way to "send
 * again", because a failed render is not an accepted effect whose acknowledgement went missing.
 * It writes no diagnostic of its own either — Next already reports the error on the server, and
 * `lib/logger` is the mutation log — so there is no `console` call, no telemetry client and no
 * network request in this file. The only thing it takes from the error is its `digest`: an
 * opaque reference, rendered as text and only when the failure came from the server to produce
 * one.
 *
 * The heading is the page's `h1`, because the failed segment took its own heading with it and
 * this boundary is now the whole of that page's content. The shell supplies the only `main`
 * landmark, the only skip link and the one Development data label, so none of them is repeated
 * here — a second landmark would split the reading order exactly when a reader is already lost.
 */

import { useRouter } from "next/navigation";
import { startTransition, type ReactElement } from "react";

import { StateNotice } from "@/components/state-notice";

/**
 * The props Next hands a route-segment boundary. `digest` is an automatically generated hash of
 * a server-side error, present only for failures raised while rendering on the server.
 */
export interface AppErrorBoundaryProps {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}

/** What happened, in words a reader can act on rather than a fault classification. */
const BOUNDARY_TITLE = "This page could not be shown";

/**
 * The explanation, in the order a reader needs it.
 *
 * First that this is not a fact about their data, because a region emptied by a crash reads
 * exactly like an empty collection and confusing the two is the failure this paragraph exists
 * to prevent. Then that a save they had just started has an outcome this screen cannot vouch
 * for: neither success nor failure is claimed on their behalf, since the truth is not known
 * here. Then that typed text stays where the form kept it — stated conditionally, because this
 * boundary preserved nothing itself and pages without a form have nothing to keep. Last, what
 * trying again does, because a reader who suspects a retry re-sends their work will not press
 * it.
 */
const BOUNDARY_EXPLANATION = [
  "The page stopped before it finished drawing, so this is not an empty list, a zero or a missing record: the surface has no result to give.",
  "If you had just saved something, that save may or may not have completed, and this screen cannot tell you which.",
  "Text you had already typed in a form on this page is still in that form, so you can begin again without retyping it.",
  "Trying the page again re-renders it from the data it reads; it repeats no save and sends nothing.",
].join(" ");

/**
 * The shape a reference has to match before it is shown.
 *
 * The digest is documented as a hash, so anything outside that shape is not the opaque
 * identifier this line claims to display: a blank value names no failure, and a longer or
 * whitespaced one would read as part of the sentence rather than as a reference. In either case
 * the reference sentence is left out entirely rather than half-filled.
 */
const DIGEST_PATTERN = /^[A-Za-z0-9_+:.-]{1,64}$/;

/**
 * The notice's description: the fixed explanation plus, when there is one, the server's
 * reference for this failure. Rendering the reference as text is deliberate — it is an opaque
 * identifier, never a message, a record name or a value to interpret.
 */
function describeFailure(digest: string | undefined): string {
  const reference = digest?.trim() ?? "";
  if (!DIGEST_PATTERN.test(reference)) {
    return BOUNDARY_EXPLANATION;
  }
  return `${BOUNDARY_EXPLANATION} Reference ${reference} identifies this failure in the server log.`;
}

/**
 * The recoverable state a failed route segment renders.
 *
 * The retry does two things, because either one alone leaves the surface stuck. `reset` on its
 * own only re-renders the segment from the payload the router already holds, so a failure that
 * happened while the server was rendering it rejects in exactly the same way and the notice
 * never clears; `router.refresh` on its own asks the server for the segment again but leaves the
 * boundary in its error state, so the fresh result never mounts. Together they re-request the
 * segment and clear the boundary for the render that follows. Both run inside one transition so
 * the notice stays readable until the new payload arrives instead of flashing an empty region.
 *
 * Neither step navigates away, reloads the document, discards what a form already holds in the
 * browser, or starts a save a second time: the refresh re-reads, and the boundary itself
 * performs no change on the reader's behalf.
 *
 * A retry that fails again leaves focus on the document body rather than inside the notice: the
 * notice is rebuilt for each failure, and this boundary is remounted by `reset` itself, so no
 * focus target it could hold survives that render. What a reader gets instead is the notice's
 * own `role="alert"` region re-announcing the failure, and one Tab returning to the retry
 * control — Chrome keeps its sequential focus starting point where that control was. Moving
 * focus into the rebuilt notice is the shared notice component's call, not a second copy of it
 * here.
 */
export default function AppErrorBoundary({ error, reset }: AppErrorBoundaryProps): ReactElement {
  const router = useRouter();

  const retry = (): void => {
    startTransition(() => {
      router.refresh();
      reset();
    });
  };

  return (
    <StateNotice
      kind="unavailable"
      headingLevel={1}
      title={BOUNDARY_TITLE}
      description={describeFailure(error.digest)}
      retry={{ label: "Try this page again", onClick: retry }}
      // A message this short reads badly at the width of a full desktop content region, and a
      // phone width cannot spare horizontal margins: the block is centred and capped at a
      // comfortable measure, and the shell's own content padding is left to the shell.
      className="mx-auto my-6 w-full max-w-2xl"
    />
  );
}
