import type { ReactElement } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DirectionProvider } from "@/components/ui/direction";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import RenderedContent from "@/components/rendered-content";
import StatusBadge, { SEND_STATUS, type SendStatus, type StatusTone } from "@/components/status-badge";
import { INBOX_TAB_LABELS, PROTECTED_NOTICE_COPY } from "@/features/audience/copy/inbox";
import { cn } from "@/lib/cn";
import { destinationProblemOf } from "@/lib/destination";
export type MessageDirection = "ltr" | "rtl";
const RENDERED_PROSE = cn(
  "type-body break-words [&_p]:mb-3 [&_p:last-child]:mb-0 [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:type-section-title [&_h2:first-child]:mt-0 [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:type-subsection-title [&_h4]:mt-4 [&_h4]:mb-2 [&_h4]:type-group-title [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:ps-5 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:ps-5 [&_li]:mb-1 [&_blockquote]:my-3 [&_blockquote]:border-s-2 [&_blockquote]:border-border [&_blockquote]:ps-3 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 [&_strong]:font-semibold [&_em]:italic [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-xs [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_hr]:my-4 [&_hr]:border-border [&_img]:my-3 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-lg",
);
export type ServerHtmlProps = { readonly html: string; readonly direction: MessageDirection; readonly lang?: string; readonly className?: string };
export const ServerHtml = ({ html, direction, lang, className }: ServerHtmlProps): ReactElement | null => (html.trim().length === 0 ? null : <RenderedContent html={html} direction={direction} lang={lang} className={cn(RENDERED_PROSE, className)} />);
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
export function MessageReader({ sender, subject, asOfLabel, audienceLabel, audienceTone, languageTag, direction, protected: isProtected, html, plainText, noticeHref, sendState, className }: MessageReaderProps): ReactElement {
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
            <bdi className="break-words">{asOfLabel}</bdi>
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
              <TabsList aria-label="Message rendering">
                <TabsTrigger value="html">{INBOX_TAB_LABELS.html}</TabsTrigger>
                <TabsTrigger value="plain">{INBOX_TAB_LABELS.plain}</TabsTrigger>
              </TabsList>
              <ScrollArea className="h-96">
                <DirectionProvider direction={direction}>
                  <div className="pe-3" dir={direction} lang={languageTag}>
                    <TabsContent value="html" className="rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring">
                      <ServerHtml html={html} direction={direction} lang={languageTag} />
                    </TabsContent>
                    <TabsContent value="plain" className="rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring">
                      <pre className="whitespace-pre-wrap break-words type-body">{plainText}</pre>
                    </TabsContent>
                  </div>
                </DirectionProvider>
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
  return (
    <div className="flex flex-col gap-2">
      <p className="font-medium">{PROTECTED_NOTICE_COPY.heading}</p>
      <p className="type-supporting">{PROTECTED_NOTICE_COPY.description}</p>
      {destinationProblemOf(link) === undefined ? (
        <>
          <p>
            <a {...{ className: "inline-flex min-h-6 items-center font-medium text-primary inline-link", href: link }}>{"Open the protected Update"}</a>
          </p>
          <p className="type-supporting">{PROTECTED_NOTICE_COPY.linkStatement}</p>
        </>
      ) : null}
      <p className="type-supporting">{PROTECTED_NOTICE_COPY.absenceStatement}</p>
    </div>
  );
}
const initialsOf = (displayValue: string): string => {
  const parts = displayValue
    .trim()
    .split(/\s+/u)
    .filter((part) => part.length > 0);
  const last = parts.length === 1 ? "" : (parts[parts.length - 1] ?? "");
  return `${Array.from(parts[0] ?? "")[0] ?? ""}${Array.from(last)[0] ?? ""}`.toUpperCase();
};
export default MessageReader;
