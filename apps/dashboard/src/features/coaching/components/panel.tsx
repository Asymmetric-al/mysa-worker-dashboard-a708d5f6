import type { ReactElement, ReactNode } from "react";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";
export type PanelProps = {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
  readonly footer?: ReactNode;
  readonly headingLevel?: 2 | 3 | 4;
  readonly titleId?: string;
  readonly cardClassName?: string;
  readonly titleClassName?: string;
  readonly descriptionClassName?: string;
  readonly contentClassName?: string;
  readonly children: ReactNode;
};
const PANEL_HEADING_TAG = { 2: "h2", 3: "h3", 4: "h4" } as const;
/** The card frame every coaching region sits in: one title, an optional description, card action and footer around the region's own body, so the section frame is written once rather than per component. */
export function Panel({ title, description, action, footer, headingLevel = 2, titleId, cardClassName, titleClassName, descriptionClassName, contentClassName = "flex min-w-0 flex-col gap-3", children }: PanelProps): ReactElement {
  const Heading = PANEL_HEADING_TAG[headingLevel];
  return (
    <Card className={cn(cardClassName)}>
      <CardHeader>
        <CardTitle className={titleClassName}>
          <Heading id={titleId}>{title}</Heading>
        </CardTitle>
        {description === undefined ? null : <CardDescription className={descriptionClassName}>{description}</CardDescription>}
        {action === undefined ? null : <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
      {footer === undefined ? null : <CardFooter>{footer}</CardFooter>}
    </Card>
  );
}
export default Panel;
