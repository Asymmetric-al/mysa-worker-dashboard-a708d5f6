"use client";
import { useRouter } from "next/navigation";
import { useCallback, useState, type ReactElement } from "react";
import ActionReview, { type MutationSubmit } from "@/components/action-review";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import { submitDevAction } from "../api-client";
import { RESET_COPY } from "../copy/dev-labels";
type ResetInput = Omit<MutationInput<unknown>, "operationId">;
export type DevResetControlProps = { readonly scope: Scope; readonly expectedRevision: string };
/** The Settings screen's section for the destructive development reset; whether it is offered at all is the Server Component's decision, made from whether `readDevState` answered an envelope. */ export function DevResetControl({ scope, expectedRevision }: DevResetControlProps): ReactElement {
  const router = useRouter();
  const rereadServerRender = useCallback((): void => {
    router.refresh();
  }, [router]);
  const submit = useCallback<MutationSubmit<unknown>>((input) => submitDevAction("resetSeed", input), []);
  const [input] = useState<ResetInput>(() => ({ scope, expectedRevision, payload: {} }));
  const consequence = (
    <>
      <p className="type-supporting">{RESET_COPY.irreversibleNote}</p>
      <p className="type-supporting">{RESET_COPY.sameAsCommandNote}</p>
    </>
  );
  return <ActionReview title={RESET_COPY.title} headingLevel={2} consequential description={<p className="type-supporting">{RESET_COPY.body}</p>} consequence={consequence} confirmLabel={RESET_COPY.confirmLabel} cancelLabel={RESET_COPY.cancelLabel} input={input} submit={submit} onSettled={rereadServerRender} />;
}
export default DevResetControl;
