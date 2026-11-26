"use client";
import Link from "next/link";
import type { ReactElement } from "react";
import { StateNotice } from "@/components/state-notice";
import { Badge } from "@/components/ui/badge";
import { buttonVariants, BUTTON_WRAP_CLASS } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { CivilDate } from "@/modules/time/civil";
import { COACHING_COPY } from "../copy";
type PreparationRecord = { readonly body: string; readonly updatedOn: CivilDate | string | null; readonly audience: "private" };
type PreparationSourceIdentity = { readonly system: string; readonly reference: string };
export type PreparationSurfaceProps = { readonly preparation: PreparationRecord | null; readonly busy?: boolean; readonly unavailable?: PreparationSourceIdentity | null };
type PreparationView = { readonly state: "busy" } | { readonly state: "unavailable"; readonly source: PreparationSourceIdentity } | { readonly state: "present"; readonly body: string; readonly updatedOn: CivilDate | string | null } | { readonly state: "absent" };
const CHECK_INS_HREF = "/coaching/check-ins";
function resolveView({ preparation, busy = false, unavailable = null }: PreparationSurfaceProps): PreparationView {
  if (busy) return { state: "busy" };
  if (unavailable !== null) return { state: "unavailable", source: unavailable };
  if (preparation !== null) return { state: "present", body: preparation.body, updatedOn: preparation.updatedOn };
  return { state: "absent" };
}
function PreparationContent({ view }: { readonly view: PreparationView }): ReactElement {
  switch (view.state) {
    case "busy":
      return <output className="block text-sm text-muted-foreground text-pretty wrap-anywhere">Loading your private notes…</output>;
    case "unavailable":
      return <StateNotice kind="unavailable" title="Private notes unavailable" description={COACHING_COPY.overview.unavailable} source={view.source} headingLevel={3} />;
    case "present":
      return view.body.trim() === "" ? <p className="type-supporting text-pretty wrap-anywhere">No private notes yet.</p> : <bdi className="block break-words text-pretty whitespace-pre-wrap">{view.body}</bdi>;
    case "absent":
      return <StateNotice kind="empty" title="No coaching notes yet" description={COACHING_COPY.overview.empty} action={{ label: "Write a check-in", href: CHECK_INS_HREF }} headingLevel={3} />;
  }
}
export default function PreparationSurface(props: PreparationSurfaceProps): ReactElement {
  const view = resolveView(props);
  return (
    <section aria-labelledby="coaching-preparation-heading" data-slot="preparation-surface" data-preparation-state={view.state} className="flex min-w-0 flex-col text-start">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="wrap-anywhere">
            <h2 {...{ id: "coaching-preparation-heading", className: "type-section-title" }}>{"Private coaching notes"}</h2>
          </CardTitle>
          <CardDescription className="text-pretty wrap-anywhere">{COACHING_COPY.overview.purpose}</CardDescription>
          <CardAction>
            <Badge variant="secondary">Only visible to you</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          <p className="type-supporting text-pretty wrap-anywhere">
            <bdi>Only you can see these notes — never shared with your coach.</bdi>
          </p>
          <Separator />
          <PreparationContent view={view} />
        </CardContent>
        {view.state === "present" ? (
          <CardFooter className="flex-col items-start gap-2">
            <p className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-muted-foreground">
              {view.updatedOn === null ? (
                "No update date recorded."
              ) : (
                <>
                  <span>Last updated</span>
                  {/* The civil date in its stored form: a calendar day is never given a time or a zone. */}
                  <bdi className="mono-identifier">{view.updatedOn.toString()}</bdi>
                </>
              )}
            </p>
            <Link {...{ href: CHECK_INS_HREF, "data-slot": "button", className: cn(buttonVariants({ variant: "outline", size: "sm" }), BUTTON_WRAP_CLASS) }}>Write a check-in</Link>
          </CardFooter>
        ) : null}
      </Card>
    </section>
  );
}
