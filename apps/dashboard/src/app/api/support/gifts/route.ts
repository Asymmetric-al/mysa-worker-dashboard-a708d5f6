import { reads } from "@/modules/data-service";
import { readJudgement, readRoute } from "../../read";
import { supportQueryFromSearch } from "../query";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Answers with one page of the gifts ledger for the filter set the caller stated. */
export const GET = readRoute(readJudgement(supportQueryFromSearch), (query) => reads.support.readGifts(query));
