/** The transport layer's one grammar for the page window a URL states. */
import { z } from "zod";
/** A page value as a URL may state one: a whole number of one or more, and nothing else. */
const PAGE_NUMBER = /^[1-9][0-9]*$/u;
/** The page window a caller may state, in the shape every paging read declares it. */
export interface PagingQuery {
  readonly page?: number;
  readonly pageSize?: number;
}
/** One paging parameter as a URL carries it: trimmed, a whole number of one or more, and a safe integer, refused with the message its own route states. */
export function pagingParameter(message: string) {
  return z
    .string()
    .trim()
    .superRefine((value, context) => {
      if (!PAGE_NUMBER.test(value) || !Number.isSafeInteger(Number(value))) context.addIssue({ code: "custom", message });
    })
    .transform((value) => Number(value));
}
/** The page window a caller may state, refused by the name of the parameter it got wrong in the wording the reading route states. */
export function pagingQuerySchema(messages: { readonly page: string; readonly pageSize: string }): z.ZodType<PagingQuery> {
  return z.object({ page: pagingParameter(messages.page).optional(), pageSize: pagingParameter(messages.pageSize).optional() });
}
/** The `page` and `pageSize` a URL states, as the raw values that grammar judges: a parameter the URL omits stays absent, so the service keeps its own default. */
export function pagingParamsOf(search: URLSearchParams): Record<string, unknown> {
  return { page: search.get("page") ?? undefined, pageSize: search.get("pageSize") ?? undefined };
}
