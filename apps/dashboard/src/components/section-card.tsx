import type { ReactElement, ReactNode } from "react";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";
type HeadingLevel = 1 | 2 | 3 | 4;
const HEADING_TAG: Readonly<Record<HeadingLevel, "h1" | "h2" | "h3" | "h4">> = { 1: "h1", 2: "h2", 3: "h3", 4: "h4" };
/** The one type scale's heading utility per level, so a titled region states the level it sits at with the same measure on every surface. A caller adds wrapping utilities; it states no size or weight of its own. */
const HEADING_SCALE: Readonly<Record<HeadingLevel, string>> = { 1: "type-page-title", 2: "type-section-title", 3: "type-subsection-title", 4: "type-group-title" };
export type SectionCardProps = {
  readonly title: ReactNode;
  readonly children: ReactNode;
  readonly headingLevel?: HeadingLevel;
  readonly headingId?: string;
  readonly headingClassName?: string;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
  readonly headerExtra?: ReactNode;
  readonly titleClassName?: string;
  readonly headerClassName?: string;
  readonly contentClassName?: string;
  readonly cardClassName?: string;
  readonly cardSize?: "default" | "sm";
  readonly cardVariant?: "default" | "muted" | "soft";
  readonly dataSlot?: string;
  readonly cardData?: Readonly<Record<string, string>>;
  readonly region?: { readonly id: string; readonly className?: string };
};
/** One titled region of a surface: the card frame, its heading of the caller's level, its optional description and action, and its content. */
export function SectionCard({ title, children, headingLevel = 2, headingId, headingClassName, description, action, headerExtra, titleClassName, headerClassName, contentClassName, cardClassName, cardSize, cardVariant, dataSlot, cardData, region }: SectionCardProps): ReactElement {
  const Heading = HEADING_TAG[headingLevel];
  const card = (
    <Card {...cardData} {...(cardSize === undefined ? {} : { size: cardSize })} {...(cardVariant === undefined ? {} : { variant: cardVariant })} {...(dataSlot === undefined ? {} : { "data-slot": dataSlot })} className={cardClassName}>
      <CardHeader className={headerClassName}>
        <CardTitle className={titleClassName}>
          <Heading {...(headingId === undefined ? {} : { id: headingId })} className={cn(HEADING_SCALE[headingLevel], headingClassName)}>
            {title}
          </Heading>
        </CardTitle>
        {description === undefined ? null : <CardDescription>{description}</CardDescription>}
        {action === undefined ? null : <CardAction>{action}</CardAction>}
        {headerExtra}
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
  );
  return region === undefined ? (
    card
  ) : (
    <section aria-labelledby={region.id} className={cn(region.className)}>
      {card}
    </section>
  );
}
export default SectionCard;
