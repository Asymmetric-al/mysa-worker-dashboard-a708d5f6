"use client";
import Link from "next/link";
import type { ReactElement } from "react";
import { StateNotice } from "@/components/state-notice";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { CivilDate } from "@/modules/time/civil";
import { COACHING_COPY } from "../copy";
type PreparationRecord = { readonly body: string; readonly updatedOn: CivilDate | string | null; readonly audience: "private" };
type PreparationSourceIdentity = { readonly system: string; readonly reference: string };
export type PreparationSurfaceProps = { readonly preparation: PreparationRecord | null; readonly busy?: boolean; readonly unavailable?: PreparationSourceIdentity | null };
type PreparationView = { readonly state: "busy" } | { readonly state: "unavailable"; readonly source: PreparationSourceIdentity } | { readonly state: "present"; readonly body: string; readonly updatedOn: CivilDate | string | null } | { readonly state: "absent" };
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
const CHECK_INS_HREF = "/coaching/check-ins";
const HEADING_ID = "coaching-preparation-heading";
const LINK_CONTROL_CLASS = "h-auto min-h-8 max-w-full whitespace-normal py-1.5";
function resolveView({ preparation, busy = false, unavailable = null }: PreparationSurfaceProps): PreparationView {
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
function PreparationContent({ view }: { readonly view: PreparationView }): ReactElement {
  switch (view.state) {
    case "busy":
      return (
        // `<output>` is the native status region, so the sentence is announced as it appears without a
        // `role` standing in for the element. The surrounding section is deliberately not marked
        // `aria-busy`: a busy region defers the announcements of the live regions inside it, which would
        // mute the one sentence that says the surface is reading rather than empty.
        <output className="block text-sm text-muted-foreground text-pretty wrap-anywhere">{BUSY_STATEMENT}</output>
      );
    case "unavailable":
      return <StateNotice kind="unavailable" title={UNAVAILABLE_NOTICE_TITLE} description={COACHING_COPY.overview.unavailable} source={view.source} headingLevel={3} />;
    case "present":
      return view.body.trim() === "" ? (
        // A record with no text is a record, not an empty preparation: it says so rather than showing a
        // blank region a reader would take for a surface that failed to load.
        <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{EMPTY_BODY_STATEMENT}</p>
      ) : (
        // Plain text, never HTML and never the content family's renderer: the line breaks the worker
        // wrote are the formatting, and `<bdi>` isolates the text from its mixed-direction neighbours.
        <bdi className="block break-words text-pretty whitespace-pre-wrap">{view.body}</bdi>
      );
    case "absent":
      return <StateNotice kind="empty" title={EMPTY_NOTICE_TITLE} description={COACHING_COPY.overview.empty} action={{ label: CHECK_INS_LINK_LABEL, href: CHECK_INS_HREF }} headingLevel={3} />;
  }
}
export default function PreparationSurface(props: PreparationSurfaceProps): ReactElement {
  const view = resolveView(props);
  return (
    // A named section rather than a bare div: the heading describes the region, so a screen-reader user
    // can reach "Private preparation" directly and the text starts at the reading edge in either
    // direction.
    <section aria-labelledby={HEADING_ID} data-slot="preparation-surface" data-preparation-state={view.state} className="flex min-w-0 flex-col text-start">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="wrap-anywhere">
            <h2 id={HEADING_ID}>{PREPARATION_HEADING}</h2>
          </CardTitle>
          <CardDescription className="text-pretty wrap-anywhere">{COACHING_COPY.overview.purpose}</CardDescription>
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
            <Link href={CHECK_INS_HREF} className={cn(buttonVariants({ variant: "outline", size: "sm" }), LINK_CONTROL_CLASS)}>
              {CHECK_INS_LINK_LABEL}
            </Link>
          </CardFooter>
        ) : null}
      </Card>
    </section>
  );
}
