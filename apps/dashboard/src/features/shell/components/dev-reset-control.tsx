"use client";

/**
 * The Settings screen's confirmed reset: the same `resetSeed` the development region dispatches, on
 * the surface that is supposed to carry it.
 *
 * **Why this file exists.** AAP 0.7.2, "The reset path", states that `bun run reset` re-seeds every
 * session deterministically and that "the Settings screen exposes the same operation through
 * `resetSeed` with a confirmation", and 0.10.1's Shell/Home/Settings/Help family lists "source status
 * and reset" among the things Settings covers. The operation, its validation, its revision check and
 * its deterministic re-seed are all already implemented; what was missing is the surface. This file
 * is that surface and nothing more, which is why it holds no logic the operation already owns.
 *
 * **Why it composes rather than builds.** AAP 0.3.4 makes "action review and result" a shared concern
 * with exactly one implementation, and 0.6.4 requires a consequential action to confirm through that
 * step. So the destructive confirmation is `components/action-review` — the same step the development
 * panel renders — and the receipt of the attempt is `OperationResult`'s. That single decision gives
 * this surface the attempt identity (one `operationId` per intent, reused by a replay), the in-flight
 * fence against a double press, the focus handling of a settled outcome and every one of the eight
 * outcomes, none of which this file could restate without becoming a second, drifting implementation
 * of them (Rule 1 clause 2).
 *
 * **The words are not written here.** Every sentence comes from `../copy/dev-labels`'s `RESET_COPY`,
 * the shell's one module for the development controls' wording, so the Settings reset and the
 * development region's reset say the same thing about the same act. Nothing here restates
 * `components/dev-banner`'s persistent **Development data** label or `components/simulation-label`'s
 * per-effect sentences: the shell owns the first and the effect components own the second, and a
 * second copy on this surface would give one sentence two owners.
 *
 * **The input is the envelope's own.** `scope` and `expectedRevision` arrive as props, taken from the
 * `readDevState` envelope by the Server Component that mounts this control, so the reset presents the
 * authority it was read under and the revision it saw — the whole of the contract's caller-owned
 * fields (AAP 0.7.1). The payload is the empty object the mutation declares, because a reset states
 * nothing. Nothing here derives a scope, invents a revision or mints an identity.
 *
 * **One settled attempt re-reads the server render, and its record survives that.** A reset changes the
 * seeded world, so the revision this page holds is no longer the one that stands; `router.refresh()`
 * re-renders the Server Component so the section's source status reports the re-seeded facts. The input
 * this step presents is therefore fixed for the visit — the authority and the revision the page read when
 * it mounted — because the shared step recognises the attempt it made by that input: re-deriving it from
 * the refreshed props would make the step treat its own record as a different attempt and drop the
 * receipt the person is still reading. A record that does have to be applied against a newer revision
 * gets it from the conflict's own `currentRevision`, which the shared step already offers as `reapply`.
 *
 * **Accessibility and direction.** The step is a `<section>` with a real `h2` heading — the level this
 * page needs, since the page's own title is its `h1` and nothing sits between them — its review
 * content precedes its controls in DOM order, and every control it renders is at least 24x24 CSS px
 * (WCAG 2.5.8). Every colour, radius, shadow and space resolves to a token declared once in
 * `styles/globals.css`, and this file adds no class of its own, so an RTL page mirrors the step
 * without a second style and nothing here depends on a physical side.
 *
 * **Layering.** `features/shell → components → components/ui`. It imports no store, no service read,
 * no development-runtime module and no second transport: the one call to `/api/dev` is
 * `../api-client`'s `submitDevAction`, the family's single owner of that request shape.
 */

import { useRouter } from "next/navigation";
import { useCallback, useState, type ReactElement } from "react";

import ActionReview, { type MutationSubmit } from "@/components/action-review";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";

import { submitDevAction } from "../api-client";
import { RESET_COPY } from "../copy/dev-labels";

/** The one development control this surface dispatches, by the name the handler accepts. */
const RESET_ACTION = "resetSeed";

/**
 * The reviewed reset as the shared step submits it: the three caller-owned fields and no identity.
 *
 * Typed from the contract rather than restated, so a change to the four-field mutation input is a
 * compile error here instead of a payload this file quietly builds wrong. `payload` is `unknown`
 * because the reset declares no field to state.
 */
type ResetInput = Omit<MutationInput<unknown>, "operationId">;

/** Props of {@link DevResetControl}. */
export interface DevResetControlProps {
  /**
   * The exact authority the development read ran under, from its own envelope.
   *
   * Passed through untouched: the service re-authorises it on submit, so a stale or foreign scope
   * produces a `denied` outcome rather than a reset performed in an authority this page guessed.
   */
  readonly scope: Scope;

  /**
   * The revision the envelope reported, presented as `expectedRevision`.
   *
   * A reset replaces the seeded documents, so a revision older than the one now stored is answered as
   * a `conflict` with the current revision — which is why the page re-reads after an attempt settles.
   */
  readonly expectedRevision: string;
}

/**
 * The Settings screen's section for the destructive development reset.
 *
 * Renders the shared review step with the destructive confirmation (`consequential`), so the person
 * reads what the reset discards before it runs, and reports its outcome in place. It renders no
 * control of its own, no summary of the last outcome and no availability switch: whether a reset is
 * offered at all is the Server Component's decision, made from whether `readDevState` answered an
 * envelope, because that read is the only thing that knows whether this build carries the runtime.
 */
export function DevResetControl({ scope, expectedRevision }: DevResetControlProps): ReactElement {
  const router = useRouter();

  /* The seed changed, so the server render that supplied the source status is out of date: the refresh
   * is what reports the re-seeded facts beside this step. It changes the props this component receives,
   * not the input below, so the attempt's record stays on the page. */
  const rereadServerRender = useCallback((): void => {
    router.refresh();
  }, [router]);

  /* `submitDevAction` is the family's one `/api/dev` transport, so this surface dispatches the same
   * call the development region does instead of growing a second path to the same route. */
  const submit = useCallback<MutationSubmit<unknown>>((input) => submitDevAction(RESET_ACTION, input), []);

  /* Fixed for the visit: the shared step identifies the attempt it made by this input, so a refreshed
   * `expectedRevision` must not reach it — see this file's header. */
  const [input] = useState<ResetInput>(() => ({ scope, expectedRevision, payload: {} }));

  return (
    <ActionReview
      title={RESET_COPY.title}
      headingLevel={2}
      consequential
      description={<p>{RESET_COPY.body}</p>}
      consequence={
        <>
          <p>{RESET_COPY.irreversibleNote}</p>
          <p>{RESET_COPY.sameAsCommandNote}</p>
        </>
      }
      confirmLabel={RESET_COPY.confirmLabel}
      cancelLabel={RESET_COPY.cancelLabel}
      input={input}
      submit={submit}
      onSettled={rereadServerRender}
    />
  );
}

export default DevResetControl;
