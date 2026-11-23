import { reads } from "@/modules/data-service";
import { readJudgement, readRoute } from "../read";
import { supportQueryFromSearch } from "./query";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Answers with the Support overview for the period, currency and filters the caller stated. */
export const GET = readRoute(readJudgement(supportQueryFromSearch), (query) => reads.support.readSupportOverview(query));
