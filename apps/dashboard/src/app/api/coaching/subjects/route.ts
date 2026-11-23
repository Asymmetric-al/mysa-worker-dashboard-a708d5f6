import { z } from "zod";
import { routeMethods } from "@/app/api/methods";
import { reads } from "@/modules/data-service";
import { readGrammar, readRoute } from "../../read";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PORTFOLIO_VIEW = "portfolio";
const IDENTITY_PARAMETERS = ["coachId", "principalId", "persona", "actingAs", "subjectPrincipalId", "as"] as const;
const MESSAGES = {
  identity: "Choose the acting coach through the development session, not the query string: an identity named in the query would be a second and silent way to claim one while the session still decides which grants are read.",
  oneSelector: "Name one selector per request: `view=portfolio` reads the whole portfolio and `subjectId=<id>` reads one subject, so naming both leaves no single read to answer.",
  selectorRequired: "Name the read: `view=portfolio` for the coach's portfolio, or `subjectId=<id>` for one subject the coach holds a grant for.",
  subjectIdBlank: "Name the subject in `subjectId`: a blank value addresses no subject, and the read would have to guess which one was meant.",
  viewNotPortfolio: "Name the view as `portfolio`: it is the only view this read serves, and any other value names a read that does not exist.",
} as const;
const coachQuerySchema = z
  .object({ view: z.string().optional(), subjectId: z.string().optional(), coachId: z.string().optional(), principalId: z.string().optional(), persona: z.string().optional(), actingAs: z.string().optional(), subjectPrincipalId: z.string().optional(), as: z.string().optional() })
  .superRefine((query, context) => {
    const claimedIdentities = IDENTITY_PARAMETERS.filter((name) => query[name] !== undefined);
    for (const name of claimedIdentities) context.addIssue({ code: "custom", path: [name], message: MESSAGES.identity });
    if (claimedIdentities.length > 0) return;
    const { subjectId, view } = query;
    if (view !== undefined && subjectId !== undefined) {
      context.addIssue({ code: "custom", path: ["view"], message: MESSAGES.oneSelector });
      context.addIssue({ code: "custom", path: ["subjectId"], message: MESSAGES.oneSelector });
      return;
    }
    if (subjectId !== undefined) {
      if (subjectId.trim().length === 0) context.addIssue({ code: "custom", path: ["subjectId"], message: MESSAGES.subjectIdBlank });
      return;
    }
    if (view !== undefined) {
      if (view !== PORTFOLIO_VIEW) context.addIssue({ code: "custom", path: ["view"], message: MESSAGES.viewNotPortfolio });
      return;
    }
    context.addIssue({ code: "custom", path: ["view"], message: MESSAGES.selectorRequired });
    context.addIssue({ code: "custom", path: ["subjectId"], message: MESSAGES.selectorRequired });
  });
const searchParametersOf = (search: URLSearchParams): Record<string, string> => Object.fromEntries(search);
/** Answers with one read envelope — the coach's portfolio, or one admitted subject's shared modules — or the read's own refusal: a named subject reads as itself, otherwise `view=portfolio` was validated and the portfolio read runs, and each arm's own answer travels untouched. */
const readCoachView = readRoute(readGrammar(coachQuerySchema, searchParametersOf), (query) => (query.subjectId !== undefined ? reads.coach.readCoachSubject({ grantId: query.subjectId }) : reads.coach.readCoachPortfolio()));
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ GET: readCoachView });
