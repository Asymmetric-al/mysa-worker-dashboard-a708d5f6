/**
 * The one reading surface for a produced message: the HTML and the plain-text alternative of one
 * notification, and the link-only form a protected notice takes.
 *
 * The synthetic inbox exists so a reader can inspect what a notification actually produced, in both
 * forms it is stored in (AAP 0.10.1 family 10), and so the protected variant is visible as the
 * minimal message it is (AAP 0.8.5). This component is that inspection, and nothing more.
 *
 * It renders supplied strings. By the time a message reaches this file its HTML and its plain text
 * have already been produced from the same stored revision by the application's one renderer, so this
 * file never parses or serialises content JSON, never imports the content module or the editor
 * packages, never builds HTML from a document and never escapes or re-escapes HTML the server
 * produced. A second converter here would be a second answer to "what does this message say", which
 * is the one thing the release forbids (Rule 1 clause 2; AAP 0.3.4).
 *
 * {@link ServerHtml} is exported because it is the audience feature's one reading block for a
 * produced message: `receiving-post` and `public-reading-view` import it rather than opening their
 * own. It owns the prose styling this surface reads in and hands the string to
 * `components/rendered-content`, the application's single rendering boundary, which states once what
 * makes that markup safe to insert and why it is not framed. Nothing here composes, sanitises or
 * re-escapes the string, which is what keeps the inbox's HTML identical to what the reader would
 * receive.
 *
 * Both tabs are real renderings of the same revision. The plain-text view is the message's own text
 * alternative with its line breaks intact, not a note saying one exists, so a reader who takes only
 * that view loses no wording — and neither view is ever left empty.
 *
 * Protected versus public is a difference in the message, not a styling of it. A protected notice
 * carries a safe sender, a subject and a link, and no protected prose, image, location, poster,
 * transcript, caption or hidden alternative such as preview text or alt text. This component proves
 * that by construction: `protected` selects a link-only body first, and the two supplied renderings
 * are never read in that case. It does not fetch the linked content, does not embed anything from it
 * and does not decide whether the reader may see it — access is rechecked at the link, which is what
 * `PROTECTED_NOTICE_COPY` states.
 *
 * Sender identity and direction are kept honest in the smallest ways that matter. The sender is
 * displayed inside `<bdi>`, because a name is direction-weak content that must not reorder the card
 * around it; the body block carries `dir` from the supplied direction, because a message has a
 * writing direction of its own and a CSS base direction would be the wrong place for it; and no
 * bidirectionality control character is inserted into any string here.
 *
 * Accessibility: the two views are a real tablist with an accessible name of its own, each panel is
 * focusable and carries a token focus ring, the article is named by the subject, and every state a
 * message carries — its audience and its send outcome — is a word from `StatusBadge`, so nothing
 * about a message is conveyed by colour alone.
 *
 * No client directive and no hook: the file is a pure function of its props, so it renders
 * identically inside a Server Component and inside a client parent, and it reads no clock, performs
 * no I/O and keeps no state. The design-system primitives it composes (`Tabs`, `ScrollArea`,
 * `Avatar`) carry their own client boundaries; nothing about them leaks into this contract.
 *
 * The simulated-effect sentence is deliberately absent: the surface that composes a message owns it
 * (`inbox-list` renders `SimulationLabel`), and two disclaimers about one effect read as one
 * disclaimer plus noise.
 *
 * Why the body is a fixed-height scroll region: `ScrollArea`'s viewport scrolls only when it has a
 * definite height, because its viewport is sized by a percentage and a percentage cannot resolve
 * against an auto-height parent — while the `Card` frame clips overflow. Letting the body size itself
 * would therefore cut a long message off with no scrollbar and no visible clue, so the region takes a
 * definite, token-scale height (`h-96`, 24rem) and scrolls inside it; the viewport is focusable and
 * ringed, so the same content is reachable by keyboard. Scope: AAP 0.10.1 family 10, 0.8.5, 0.3.4;
 * evidence for success criteria 10, 17 and 18.
 */

import type { ReactElement } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import RenderedContent from "@/components/rendered-content";
import StatusBadge, {
  SEND_STATUS,
  type SendStatus,
  type StatusTone,
} from "@/components/status-badge";
import { INBOX_TAB_LABELS, PROTECTED_NOTICE_COPY } from "@/features/audience/copy/inbox";
import { cn } from "@/lib/cn";
import { destinationProblemOf } from "@/lib/destination";

/**
 * The two writing directions a message body renders in.
 *
 * Declared here rather than imported: the content module owns the full direction vocabulary, and this
 * file may not import it (one renderer, one conversion path). The two members are the whole of what a
 * message needs, so a caller holding the revision's direction passes it through unchanged.
 */
export type MessageDirection = "ltr" | "rtl";

/**
 * How rendered prose reads inside a card.
 *
 * The renderer emits semantic markup with no classes of its own, so the reading styles live here, in
 * the single component that displays it, instead of in a second stylesheet or in per-caller class
 * lists that would drift. Every value resolves to a token utility: sizes come from the type scale,
 * spacing from the spacing scale, rules and code surfaces from `--border` and `--muted`, and links
 * keep their underline so their meaning is not carried by colour alone.
 */
const RENDERED_PROSE = cn(
  "text-sm leading-relaxed break-words",
  "[&_p]:mb-3 [&_p:last-child]:mb-0",
  "[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:font-heading [&_h2]:text-base [&_h2]:font-medium [&_h2:first-child]:mt-0",
  "[&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:font-heading [&_h3]:text-sm [&_h3]:font-medium",
  "[&_h4]:mt-4 [&_h4]:mb-2 [&_h4]:font-heading [&_h4]:text-sm [&_h4]:font-medium",
  "[&_ul]:mb-3 [&_ul]:list-disc [&_ul]:ps-5 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:ps-5 [&_li]:mb-1",
  "[&_blockquote]:my-3 [&_blockquote]:border-s-2 [&_blockquote]:border-border [&_blockquote]:ps-3",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4",
  "[&_strong]:font-semibold [&_em]:italic",
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-xs",
  "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3",
  "[&_hr]:my-4 [&_hr]:border-border",
  "[&_img]:my-3 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-lg",
);

/** The accessible name of the two-view switcher, because several messages each carry one. */
const TAB_LIST_LABEL = "Message rendering";

/** The link a protected notice offers, named for what it opens rather than for its URL. */
const PROTECTED_LINK_LABEL = "Open the protected Update";

/** Props of {@link ServerHtml}. */
export interface ServerHtmlProps {
  /**
   * The HTML the single static renderer produced from the stored revision. Never assembled,
   * concatenated or escaped here, and never a fragment this component builds from other data.
   */
  readonly html: string;
  /** The direction the message is written in, applied to the wrapper that holds the markup. */
  readonly direction: MessageDirection;
  /** The message's BCP-47 language tag, applied as `lang` so the markup is shaped and spoken as itself. */
  readonly lang?: string;
  /** Caller-supplied classes using logical utilities only; the prose styling itself is fixed below. */
  readonly className?: string;
}

/**
 * The audience feature's reading block for one produced message.
 *
 * It supplies the prose styling this surface reads in and lets `components/rendered-content` — the
 * application's single rendering boundary — insert the markup inside a block carrying the message's
 * direction and language, which is what lets the receiving post and the public reading view use it
 * directly without a second wrapper of their own. Renders nothing for a blank string, so an absent
 * body never leaves an empty frame behind.
 */
export function ServerHtml({
  html,
  direction,
  lang,
  className,
}: ServerHtmlProps): ReactElement | null {
  if (html.trim().length === 0) {
    return null;
  }

  return (
    <RenderedContent
      html={html}
      direction={direction}
      lang={lang}
      className={cn(RENDERED_PROSE, className)}
    />
  );
}

/** Props of {@link MessageReader}. */
export interface MessageReaderProps {
  /** The sender's display value, as the message carries it. Rendered isolated, never parsed. */
  readonly sender: string;
  /** The message subject, as the message carries it. */
  readonly subject: string;
  /**
   * When this message was recorded, already formatted for the reader by the caller. This component
   * reads no clock and formats no date, so the string arrives ready to display.
   */
  readonly asOfLabel: string;
  /** The audience word for this message's variant — "Public", "Approved supporter". */
  readonly audienceLabel: string;
  /** How that audience word should read. Defaults to the label's neutral tone. */
  readonly audienceTone?: StatusTone;
  /** The BCP-47 language tag of the message's own text. */
  readonly languageTag: string;
  /** The direction that text is written in. */
  readonly direction: MessageDirection;
  /**
   * Whether this message is a protected notice. When true the body is the link-only notice and the
   * two renderings below are never read, so a protected message cannot display protected prose even
   * if a caller passes prose by mistake.
   */
  readonly protected: boolean;
  /** The server-rendered HTML of a public message. Empty for a protected notice, which has none. */
  readonly html: string;
  /** The plain-text alternative of the same revision. Empty for a protected notice. */
  readonly plainText: string;
  /**
   * The link a protected notice carries. Access is rechecked when a reader follows it, so this
   * component neither follows it, resolves it nor decides what sits behind it.
   */
  readonly noticeHref?: string;
  /** The recorded send outcome, which is a submission outcome and never a claim of delivery. */
  readonly sendState: SendStatus;
  /** Caller-supplied classes, logical utilities only, for the surface that places the message. */
  readonly className?: string;
}

/**
 * Renders one produced message: who it came from, what it is called, what state it is in, and its
 * HTML or its plain text — or, for a protected notice, the link that stands in for both.
 *
 * The root is an `<article>` named by the subject, so a reader moving between messages hears what
 * each one is before its content; the collection around it (a list of messages) belongs to the
 * surface that composes this component.
 */
export function MessageReader({
  sender,
  subject,
  asOfLabel,
  audienceLabel,
  audienceTone,
  languageTag,
  direction,
  protected: isProtected,
  html,
  plainText,
  noticeHref,
  sendState,
  className,
}: MessageReaderProps): ReactElement {
  const subjectLabel = subject.trim();
  const send = SEND_STATUS[sendState];

  return (
    <article
      aria-label={subjectLabel.length === 0 ? undefined : subjectLabel}
      className={cn("min-w-0", className)}
    >
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start gap-3">
            <Avatar aria-hidden="true">
              <AvatarFallback>{initialsOf(sender)}</AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <CardDescription className="break-words">
                <span className="sr-only">Sender: </span>
                <bdi>{sender}</bdi>
              </CardDescription>
              <CardTitle className="break-words">
                <span className="sr-only">Subject: </span>
                <bdi>{subject}</bdi>
              </CardTitle>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <StatusBadge label={audienceLabel} tone={audienceTone} srPrefix="Audience" />
              <StatusBadge label={send.label} tone={send.tone} srPrefix="Send outcome" />
            </div>
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="break-words">
              <bdi>{asOfLabel}</bdi>
            </span>
            <span>
              <span className="sr-only">Language: </span>
              <bdi>{languageTag}</bdi>
            </span>
          </p>
        </CardHeader>
        <Separator />
        <CardContent>
          {isProtected ? (
            <ProtectedNotice href={noticeHref} />
          ) : (
            <Tabs defaultValue="html">
              <TabsList aria-label={TAB_LIST_LABEL}>
                <TabsTrigger value="html">{INBOX_TAB_LABELS.html}</TabsTrigger>
                <TabsTrigger value="plain">{INBOX_TAB_LABELS.plain}</TabsTrigger>
              </TabsList>
              <ScrollArea className="h-96">
                <div className="pe-3" dir={direction} lang={languageTag}>
                  <TabsContent
                    value="html"
                    className="rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring"
                  >
                    <ServerHtml html={html} direction={direction} lang={languageTag} />
                  </TabsContent>
                  <TabsContent
                    value="plain"
                    className="rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring"
                  >
                    <pre className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                      {plainText}
                    </pre>
                  </TabsContent>
                </div>
              </ScrollArea>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </article>
  );
}

/**
 * What a protected notice shows instead of a body: the message it is, why it holds no content, and
 * the link that rechecks access when it is followed.
 *
 * The absence is stated rather than hidden behind an empty frame, and nothing here describes the
 * content behind the link — no title of the protected Update, no excerpt, no poster, no transcript.
 *
 * The link is offered only when it is a destination this application serves: `@/lib/destination` owns
 * that rule, and it is the same one Home applies to the destinations its rows open. A notice whose
 * link is absent, or names another site, or carries a scheme such as `javascript:` or `data:` that
 * would run on click, renders no anchor and no link sentence — exactly as a notice with no link does,
 * so it makes no claim about following anything instead of offering a broken or unsafe link.
 */
function ProtectedNotice({ href }: { readonly href?: string }): ReactElement {
  const link = href === undefined ? "" : href.trim();
  // The anchor is the one place in this boundary where a value from the message becomes a link, so
  // the shared guard decides it and a destination the guard refuses is not rendered at all.
  const linkIsFollowable = destinationProblemOf(link) === undefined;

  return (
    <div className="flex flex-col gap-2">
      <p className="font-medium">{PROTECTED_NOTICE_COPY.heading}</p>
      <p className="text-muted-foreground">{PROTECTED_NOTICE_COPY.description}</p>
      {linkIsFollowable ? (
        <>
          <p>
            <a className="font-medium text-primary underline underline-offset-4" href={link}>
              {PROTECTED_LINK_LABEL}
            </a>
          </p>
          <p className="text-muted-foreground">{PROTECTED_NOTICE_COPY.linkStatement}</p>
        </>
      ) : null}
      <p className="text-muted-foreground">{PROTECTED_NOTICE_COPY.absenceStatement}</p>
    </div>
  );
}

/**
 * The initials an avatar shows when no portrait is admitted.
 *
 * Derived from the display value the message carries and nothing else: it is presentational, it does
 * not identify anyone, and an empty display value yields an empty fallback rather than an invented
 * letter. Code points are taken whole, so a name in a non-Latin script keeps its own first letters.
 */
function initialsOf(displayValue: string): string {
  const parts = displayValue
    .trim()
    .split(/\s+/u)
    .filter((part) => part.length > 0);
  const first = parts[0];
  if (first === undefined) {
    return "";
  }

  const last = parts.length === 1 ? undefined : parts[parts.length - 1];
  const firstLetter = Array.from(first)[0] ?? "";
  const lastLetter = last === undefined ? "" : (Array.from(last)[0] ?? "");

  return `${firstLetter}${lastLetter}`.toUpperCase();
}

export default MessageReader;
