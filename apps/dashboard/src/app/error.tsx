"use client";
import { useRouter } from "next/navigation";
import { startTransition, type ReactElement } from "react";
import { StateNotice } from "@/components/state-notice";
const BOUNDARY_EXPLANATION = [
  "This page stopped before it finished loading, so nothing is replaced with an empty list or zero.",
  "If you just submitted a change, check before retrying — any unsaved text you typed stays safe in the form.",
  "Trying again reloads the page without resending anything.",
].join(" ");
const DIGEST_PATTERN = /^[A-Za-z0-9_+:.-]{1,64}$/;
function describeFailure(digest: string | undefined): string {
  const reference = digest?.trim() ?? "";
  if (!DIGEST_PATTERN.test(reference)) return BOUNDARY_EXPLANATION;
  return `${BOUNDARY_EXPLANATION} Reference: ${reference}.`;
}
/** The recoverable state a failed route segment renders. */ export default function AppErrorBoundary({ error, reset }: { readonly error: Error & { digest?: string }; readonly reset: () => void }): ReactElement {
  const router = useRouter();
  const retry = (): void => {
    startTransition(() => {
      router.refresh();
      reset();
    });
  };
  return <StateNotice kind="unavailable" headingLevel={1} title="Something went wrong loading this page" description={describeFailure(error.digest)} retry={{ label: "Try again", onClick: retry }} className="mx-auto my-6 w-full max-w-2xl" />;
}
