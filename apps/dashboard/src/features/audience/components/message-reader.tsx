/**
 * The one reading surface for a produced message: the HTML and the plain-text alternative of one
 * notification, and the link-only form a protected notice takes.
 */
import type { ReactElement } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import RenderedContent from "@/components/rendered-content";
import StatusBadge, { SEND_STATUS, type SendStatus, type StatusTone } from "@/components/status-badge";
import { INBOX_TAB_LABELS, PROTECTED_NOTICE_COPY } from "@/features/audience/copy/inbox";
import { cn } from "@/lib/cn";
import { destinationProblemOf } from "@/lib/destination";
/** The two writing directions a message body renders in. */
export type MessageDirection = "ltr" | "rtl";

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
const TAB_LIST_LABEL = "Message rendering";

const PROTECTED_LINK_LABEL = "Open the protected Update";
/** Props of {@link ServerHtml}. */
export interface ServerHtmlProps {
  readonly html: string;
  readonly direction: MessageDirection;
  readonly lang?: string;
  readonly className?: string;
}
/** The audience feature's reading block for one produced message. */
export function ServerHtml({ html, direction, lang, className }: ServerHtmlProps): ReactElement | null {
  if (html.trim().length === 0) {
    return null;
  }
  return <RenderedContent html={html} direction={direction} lang={lang} className={cn(RENDERED_PROSE, className)} />;
}
/** Props of {@link MessageReader}. */
export interface MessageReaderProps {
  readonly sender: string;
  readonly subject: string;
  readonly asOfLabel: string;
  readonly audienceLabel: string;
  readonly audienceTone?: StatusTone;
  readonly languageTag: string;
  readonly direction: MessageDirection;
  readonly protected: boolean;
  readonly html: string;
  readonly plainText: string;
  readonly noticeHref?: string;
  readonly sendState: SendStatus;
  readonly className?: string;
}
/** Renders one produced message: who it came from, what it is called, what state it is in, and its HTML or its plain text — or, for a protected notice, the link that stands in for both. */
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
    <article aria-label={subjectLabel.length === 0 ? undefined : subjectLabel} className={cn("min-w-0", className)}>
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
                  <TabsContent value="html" className="rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring">
                    <ServerHtml html={html} direction={direction} lang={languageTag} />
                  </TabsContent>
                  <TabsContent value="plain" className="rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring">
                    <pre className="whitespace-pre-wrap break-words text-sm leading-relaxed">{plainText}</pre>
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
