import { reads } from "@/modules/data-service";
import { readJudgement, readRoute } from "../../read";
import { supportPageFromSearch } from "../query";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Answers with one page of the subject's commitments and the partitions the read states beside it. */
export const GET = readRoute(readJudgement(supportPageFromSearch), (query) => reads.support.readCommitments(query));
