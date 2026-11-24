import { z } from "zod";
const PAGE_NUMBER = /^[1-9][0-9]*$/u;
/** One paging parameter as a URL carries it: trimmed, a whole number of one or more, and a safe integer, refused with the message its own route states. */ export function pagingParameter(message: string) {
  return z
    .string()
    .trim()
    .superRefine((value, context) => {
      if (!PAGE_NUMBER.test(value) || !Number.isSafeInteger(Number(value))) context.addIssue({ code: "custom", message });
    })
    .transform((value) => Number(value));
}
/** One page parameter as the four paged reads that carry a page window state it: a whole count of up to nine digits with no sign, refused with the message its own route states for the parameter. */
export function wholePageParameter(message: string) {
  return z
    .string()
    .regex(/^\d{1,9}$/u, message)
    .transform((value) => Number(value));
}
/** The page window a caller may state, refused by the name of the parameter it got wrong in the wording the reading route states. */
export const pagingQuerySchema = (messages: { readonly page: string; readonly pageSize: string }): z.ZodType<{ readonly page?: number; readonly pageSize?: number }> => z.object({ page: pagingParameter(messages.page).optional(), pageSize: pagingParameter(messages.pageSize).optional() });
/** The `page` and `pageSize` a URL states, as the raw values that grammar judges: a parameter the URL omits stays absent, so the service keeps its own default. */
export const pagingParamsOf = (search: URLSearchParams): Record<string, unknown> => ({ page: search.get("page") ?? undefined, pageSize: search.get("pageSize") ?? undefined });
