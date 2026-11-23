/** The heading levels a surrounding page can need; the level is the caller's, not the notice's. */
export type NoticeHeadingLevel = 1 | 2 | 3 | 4;
/** The tag a heading level renders as, so every surface that states a level renders the same tag for it. */
export const NOTICE_HEADING_TAG: Readonly<Record<NoticeHeadingLevel, "h1" | "h2" | "h3" | "h4">> = { 1: "h1", 2: "h2", 3: "h3", 4: "h4" };
/** The level a section nests at inside a surface that already states one, capped at the deepest level this vocabulary admits. */
export const nestedNoticeHeadingLevel = (level: NoticeHeadingLevel): NoticeHeadingLevel => (level === 4 ? 4 : ((level + 1) as NoticeHeadingLevel));
