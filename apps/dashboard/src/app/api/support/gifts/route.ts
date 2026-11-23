import { reads } from "@/modules/data-service";
import { readJudgement, readRoute } from "../../read";
import { giftsQueryFromSearch } from "../query";
import { routeMethods } from "@/app/api/methods";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Answers with one page of the gifts ledger for the filter set the caller stated — or, where the address names one record, with the result that holds that record. */
const readGifts = readRoute(readJudgement(giftsQueryFromSearch), (query) => reads.support.readGifts(query));
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ GET: readGifts });
