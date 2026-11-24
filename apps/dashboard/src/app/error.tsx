"use client";
import { useRouter } from "next/navigation";
import { startTransition, type ReactElement } from "react";
import { StateNotice } from "@/components/state-notice";
const BOUNDARY_EXPLANATION = [
  "The page stopped before it finished drawing, so this is not an empty list, a zero or a missing record: the surface has no result to give.",
  "If you had just saved something, that save may or may not have completed, and this screen cannot tell you which.",
  "Text you had already typed in a form on this page is still in that form, so you can begin again without retyping it.",
  "Trying the page again re-renders it from the data it reads; it repeats no save and sends nothing.",
].join(" ");
const DIGEST_PATTERN = /^[A-Za-z0-9_+:.-]{1,64}$/;
function describeFailure(digest: string | undefined): string {
  const reference = digest?.trim() ?? "";
  if (!DIGEST_PATTERN.test(reference)) return BOUNDARY_EXPLANATION;
  return `${BOUNDARY_EXPLANATION} Reference ${reference} identifies this failure in the server log.`;
}
/** The recoverable state a failed route segment renders. */ export default function AppErrorBoundary({ error, reset }: { readonly error: Error & { digest?: string }; readonly reset: () => void }): ReactElement {
  const router = useRouter();
  const retry = (): void => {
    startTransition(() => {
      router.refresh();
      reset();
    });
  };
  return <StateNotice kind="unavailable" headingLevel={1} title="This page could not be shown" description={describeFailure(error.digest)} retry={{ label: "Try this page again", onClick: retry }} className="mx-auto my-6 w-full max-w-2xl" />;
}
