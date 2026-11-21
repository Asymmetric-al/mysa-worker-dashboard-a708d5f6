"use client";
import { useRouter } from "next/navigation";
import { useCallback, useState, type ReactElement } from "react";
import ActionReview, { type MutationSubmit } from "@/components/action-review";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import { submitDevAction } from "../api-client";
import { RESET_COPY } from "../copy/dev-labels";
const RESET_ACTION = "resetSeed";
/** The reviewed reset as the shared step submits it: the three caller-owned fields and no identity, typed from the contract rather than restated so a change there is a compile error here. */
type ResetInput = Omit<MutationInput<unknown>, "operationId">;
export type DevResetControlProps = {
  /** The exact authority the development read ran under; the service re-authorises it on submit, so a stale or foreign scope answers `denied`. */
  readonly scope: Scope;
  /** The revision the envelope reported, presented as `expectedRevision`; a reset replaces the seeded documents, so an older one is answered `conflict`. */
  readonly expectedRevision: string;
};
/** The Settings screen's section for the destructive development reset; whether it is offered at all is the Server Component's decision, made from whether `readDevState` answered an envelope. */
export function DevResetControl({ scope, expectedRevision }: DevResetControlProps): ReactElement {
  const router = useRouter();
  const rereadServerRender = useCallback((): void => {
    router.refresh();
  }, [router]);
  const submit = useCallback<MutationSubmit<unknown>>((input) => submitDevAction(RESET_ACTION, input), []);
  // Fixed for the visit: the shared step recognises the attempt it made by this input, so a refreshed `expectedRevision` must not reach it.
  const [input] = useState<ResetInput>(() => ({ scope, expectedRevision, payload: {} }));
  const consequence = (
    <>
      <p>{RESET_COPY.irreversibleNote}</p>
      <p>{RESET_COPY.sameAsCommandNote}</p>
    </>
  );
  return <ActionReview title={RESET_COPY.title} headingLevel={2} consequential description={<p>{RESET_COPY.body}</p>} consequence={consequence} confirmLabel={RESET_COPY.confirmLabel} cancelLabel={RESET_COPY.cancelLabel} input={input} submit={submit} onSettled={rereadServerRender} />;
}
export default DevResetControl;
