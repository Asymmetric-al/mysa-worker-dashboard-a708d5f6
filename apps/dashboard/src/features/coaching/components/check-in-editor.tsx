"use client";
import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import ActionReview, { intentKeyOf } from "@/components/action-review";
import { FormField } from "@/components/form-field";
import OperationResult from "@/components/operation-result";
import StateNotice from "@/components/state-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, BUTTON_WRAP_CLASS } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import type { SourceReference } from "@/lib/ids";
import { CHECKIN_MAX_ANSWER_SCALARS, CHECKIN_MAX_QUESTION_SCALARS, CHECKIN_MAX_QUESTIONS, CHECKIN_MAX_REQUEST_BYTES, validateCheckInRequest, type CheckInAnswer, type CheckInPayload, type CheckInViolation } from "@/modules/coaching/checkin";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import { CHECK_IN_STATE_COPY, COACHING_COPY, LIMIT_COPY, STOP_EFFECT_COPY } from "../copy";
import { useSaveCheckIn, useShareCheckIn, useUpdateSharedCheckIn, useWithdrawCheckIn } from "../hooks/use-coaching";
import { storedDayText } from "./sharing-summary";
import type { CheckInSavePayload, CheckInSharePayload, CheckInUpdateSharedPayload, CheckInWithdrawPayload } from "../schemas";
import { Panel } from "./panel";
export type CheckInBody = { readonly questions: readonly string[]; readonly answers: readonly string[]; readonly unassignedAnswers: readonly string[] };
type EditorQuestion = { readonly id: string; readonly wording: string };
type EditorText = { readonly identity: string; readonly questions: readonly EditorQuestion[]; readonly answers: readonly string[] };
type FocusTarget = { readonly field: "question" | "answer"; readonly position: number };
type EditorState = "private-draft" | "shared" | "withdrawn" | "unavailable";
export interface CheckInEditorProps {
  readonly captured: { readonly questions: readonly { readonly id: string; readonly wording: string; readonly order: number }[]; readonly capturedAt: string } | null;
  readonly questionBank?: readonly { readonly id: string; readonly wording: string }[];
  readonly revisions: { readonly draft: { readonly revisionId: string; readonly body: CheckInBody } | null; readonly shared: { readonly revisionId: string; readonly body: CheckInBody; readonly sharedAt: string; readonly withdrawnAt?: string | null } | null };
  readonly checkInId: string | null;
  readonly scope: Scope;
  readonly expectedRevision: string;
  readonly locale: string;
  readonly unavailable?: { readonly source: SourceReference } | null;
  readonly className?: string;
}
type HeldWrite =
  | { readonly review: "share"; readonly input: Omit<MutationInput<CheckInSharePayload>, "operationId"> }
  | { readonly review: "update"; readonly input: Omit<MutationInput<CheckInUpdateSharedPayload>, "operationId"> }
  | { readonly review: "withdraw"; readonly input: Omit<MutationInput<CheckInWithdrawPayload>, "operationId"> };
type HeldReceipt = { readonly write: HeldWrite; readonly outcome: MutationOutcome | null };
const DRAFT_UNSAVED_SENTENCE = "Not saved yet: this draft holds changes the saved private revision does not, and autosave writes them as soon as writing pauses.";
const AUTOSAVE_PAUSE_MS = 800;
const DRAFT_SAVED_SENTENCE = "Saved: this draft matches the private revision the source holds, so autosave has nothing left to write.";
const QUESTION_LABEL = "Question";
const ANSWER_LABEL = "Answer";
const COMPLETION_LABEL = "Draft completion";
const SHARED_SAME_SENTENCE = "Your private draft and the shared revision hold the same text.";
const UNASSIGNED_DRAFT_SENTENCE =
  "These answers belong to no question in the captured set, so they are kept exactly as you saved them: this editor writes answers beside their questions, and there is nowhere here to change them. Saving the private draft keeps them, and sharing a check-in copies the saved private draft as it stands.";
const UNASSIGNED_SHARED_SENTENCE = "These answers belong to no question in the captured question set, and they came into this revision with the private draft it was shared from. Updating the shared check-in sends the answers written beside these questions, so they are not part of that update.";
const EMPTY_ANSWERS: readonly string[] = [];
const scalarCount = (text: string): number => Array.from(text).length;
const PATH_POSITION = /\[(\d+)\]/u;
const FIELD_IN_PATH = /^(questions|answers)\[(\d+)\]/u;
const positionFromPath = (path: string): number | null => {
  const digits = PATH_POSITION.exec(path)?.[1];
  return digits === undefined || !Number.isFinite(Number.parseInt(digits, 10)) ? null : Number.parseInt(digits, 10);
};
const fieldKeyOf = (path: string): string | null => {
  const [, family, position] = FIELD_IN_PATH.exec(path) ?? [];
  return family === undefined || position === undefined ? null : `${family}.${position}`;
};
function refusalTextOf(violation: CheckInViolation): string {
  switch (violation.reason) {
    case "too-many-questions":
      return LIMIT_COPY.questionSetExceeded(violation.measured);
    case "question-too-long": {
      const position = positionFromPath(violation.path);
      return position === null ? violation.message : LIMIT_COPY.questionTextExceeded(position + 1, violation.measured);
    }
    case "answer-too-long": {
      const position = positionFromPath(violation.path);
      return position === null ? violation.message : LIMIT_COPY.answerTextExceeded(position + 1, violation.measured);
    }
    case "request-too-large":
      return LIMIT_COPY.requestSizeExceeded(violation.measured);
    default:
      return violation.message;
  }
}
function refusalMessagesByField(violations: readonly CheckInViolation[]): ReadonlyMap<string, string> {
  const byField = new Map<string, string>();
  for (const violation of violations) {
    const key = fieldKeyOf(violation.path);
    if (key !== null && !byField.has(key)) byField.set(key, refusalTextOf(violation));
  }
  return byField;
}
const countSentence = (noun: string, position: number, scalars: number, limit: number): string => `${noun} ${position} is ${scalars} of ${limit} characters.`;
const completionSentence = (answered: number, total: number): string => (total === 0 ? "No question has been captured yet, so there is nothing to complete." : `${answered} of ${total} questions answered.`);
const questionSetCountSentence = (count: number): string => `This check-in carries ${count} of ${CHECKIN_MAX_QUESTIONS} questions.`;
const questionSetFullSentence = (count: number): string => `This check-in carries ${count} of ${CHECKIN_MAX_QUESTIONS} questions, so a further question is refused rather than added. Take one out first, and nothing here was dropped.`;
const refusalCountSentence = (count: number): string =>
  count === 1
    ? "One value is outside a limit: it is marked beside its field with the count it reached and the limit it crossed. Nothing was shortened and nothing was dropped."
    : `${count} values are outside a limit: each is marked beside its field with the count it reached and the limit it crossed. Nothing was shortened and nothing was dropped.`;
function fieldLabelsOf(count: number): Readonly<Record<string, string>> {
  const labels: Record<string, string> = {};
  for (let position = 0; position < count; position += 1) {
    labels[`questions.${position}`] = `${QUESTION_LABEL} ${position + 1}`;
    labels[`answers.${position}`] = `${ANSWER_LABEL} ${position + 1}`;
  }
  return labels;
}
function focusSentence(target: FocusTarget, scalars: number): string {
  const noun = target.field === "question" ? QUESTION_LABEL : ANSWER_LABEL;
  const limit = target.field === "question" ? CHECKIN_MAX_QUESTION_SCALARS : CHECKIN_MAX_ANSWER_SCALARS;
  return `${noun} ${target.position + 1} is ${scalars} of ${limit} characters.`;
}
const signatureOf = (questions: readonly string[], answers: readonly string[]): string => JSON.stringify([questions, answers]);
const answerSequenceOf = (body: CheckInBody): readonly CheckInAnswer[] => [...body.questions.map((_, position) => ({ questionOrder: position, text: body.answers[position] ?? "" })), ...body.unassignedAnswers.map((text) => ({ questionOrder: null, text }))];
const answerSequenceTextOf = (answers: readonly CheckInAnswer[]): string => answers.map((answer) => `${answer.questionOrder}:${answer.text}`).join("\u0000");
const sameWordings = (left: readonly string[], right: readonly string[]): boolean => left.length === right.length && left.every((wording, index) => wording === right[index]);
const requestOf = (questions: readonly EditorQuestion[], answers: readonly string[]): CheckInPayload => ({ questions: questions.map((question, index) => ({ wording: question.wording, order: index })), answers: questions.map((_, index) => ({ questionOrder: index, text: answers[index] ?? "" })) });
const bodyOf = (questions: readonly EditorQuestion[], answers: readonly string[]): Pick<CheckInSavePayload, "questions" | "answers"> => ({ questions: questions.map((question) => question.wording), answers: questions.map((_, index) => answers[index] ?? "") });
const savedBodyOf = (revisions: CheckInEditorProps["revisions"]): CheckInBody | null => revisions.draft?.body ?? revisions.shared?.body ?? null;
function seededQuestions(props: CheckInEditorProps): readonly EditorQuestion[] {
  const frozen = props.captured?.questions;
  if (frozen !== undefined && frozen.length > 0) return [...frozen].sort((one, two) => one.order - two.order).map((question) => ({ id: question.id, wording: question.wording }));
  const saved = savedBodyOf(props.revisions);
  if (saved !== null && saved.questions.length > 0) return saved.questions.map((wording, index) => ({ id: `saved-question-${index}`, wording }));
  return (props.questionBank ?? []).map((question) => ({ id: question.id, wording: question.wording }));
}
const seededAnswers = (props: CheckInEditorProps): readonly string[] => savedBodyOf(props.revisions)?.answers.slice() ?? EMPTY_ANSWERS;
const editorStateOf = (unavailable: { readonly source: SourceReference } | null, hasShared: boolean, withdrawn: boolean): EditorState => (unavailable !== null ? "unavailable" : !hasShared ? "private-draft" : withdrawn ? "withdrawn" : "shared");
/** Whether an outcome reports a result that stands: a change applied once, one already applied, one with nothing to change, or one whose acknowledgement was lost and whose result is worth checking. A receipt is held for these and for no other outcome. */
const RECEIPT_OUTCOMES: ReadonlySet<MutationOutcome["outcome"]> = new Set<MutationOutcome["outcome"]>(["accepted", "alreadyAccepted", "unchanged", "unknown"]);
const holdsReceipt = (outcome: MutationOutcome | null): boolean => outcome !== null && RECEIPT_OUTCOMES.has(outcome.outcome);
/** The facts one review presents while its receipt stands: the facts the attempt submitted, kept while the live facts name the same change, or while the re-read has taken the review's own block away. */
function heldFacts<P>(held: Omit<MutationInput<P>, "operationId"> | null, live: Omit<MutationInput<P>, "operationId"> | null, keyOf: (payload: P) => string): Omit<MutationInput<P>, "operationId"> | null {
  if (held === null) return null;
  return live === null || keyOf(live.payload) === keyOf(held.payload) ? held : null;
}
type QuestionRowProps = {
  readonly position: number;
  readonly wording: string;
  readonly answer: string;
  readonly wordingRefusal: string | undefined;
  readonly answerRefusal: string | undefined;
  readonly onWording: (next: string) => void;
  readonly onAnswer: (next: string) => void;
  readonly onRemove: () => void;
  readonly onFocus: (target: FocusTarget) => void;
};
function QuestionRow({ position, wording, answer, wordingRefusal, answerRefusal, onWording, onAnswer, onRemove, onFocus }: QuestionRowProps): ReactElement {
  const number = position + 1;
  const asked = wording.trim();
  return (
    <div data-slot="check-in-question" className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-3">
      <FormField label={`${QUESTION_LABEL} ${number} wording`} name={`checkin-question-${position}`} description={countSentence(QUESTION_LABEL, number, scalarCount(wording), CHECKIN_MAX_QUESTION_SCALARS)} error={wordingRefusal}>
        {(field) => <Input id={field.id} name={`checkin-question-${position}`} value={wording} autoComplete="off" aria-describedby={field.describedBy} aria-invalid={field.invalid || undefined} onChange={(event) => onWording(event.target.value)} onFocus={() => onFocus({ field: "question", position })} />}
      </FormField>
      <FormField label={asked === "" ? `${ANSWER_LABEL} ${number}` : asked} name={`checkin-answer-${position}`} description={countSentence(ANSWER_LABEL, number, scalarCount(answer), CHECKIN_MAX_ANSWER_SCALARS)} error={answerRefusal}>
        {(field) => <Textarea id={field.id} name={`checkin-answer-${position}`} value={answer} rows={4} aria-describedby={field.describedBy} aria-invalid={field.invalid || undefined} onChange={(event) => onAnswer(event.target.value)} onFocus={() => onFocus({ field: "answer", position })} />}
      </FormField>
      <div className="flex flex-wrap items-center gap-2">
        <Button {...{ type: "button", variant: "ghost", size: "sm", onClick: onRemove }}>{"Remove this question"}</Button>
      </div>
    </div>
  );
}
/** One ordered read of a question set, written once: the shared revision, the review of what sharing makes readable and the review of an update state the same pairs, so all three render this list. */
const AnswerList = ({ questions, answers, keyPrefix, listClassName = "flex min-w-0 list-decimal flex-col gap-2 ps-4", muted = false }: { readonly questions: readonly string[]; readonly answers: readonly string[]; readonly keyPrefix: string; readonly listClassName?: string; readonly muted?: boolean }): ReactElement => (
  <ol className={listClassName}>
    {questions.map((question, position) => {
      const answer = answers[position] ?? "";
      return (
        <li key={`${keyPrefix}-${String(position)}`} className="min-w-0 text-pretty">
          <span className="block font-medium wrap-anywhere">
            <bdi>{question}</bdi>
          </span>
          <span className={cn("block wrap-anywhere", muted && "text-muted-foreground")}>{answer.trim() === "" ? "No answer yet." : <bdi>{answer}</bdi>}</span>
        </li>
      );
    })}
  </ol>
);
/** The answers a revision holds that belong to no question in its captured set: they hold no position, so this editor reads them here rather than writing them beside a question. */ const UnassignedAnswers = ({ answers, keyPrefix }: { readonly answers: readonly string[]; readonly keyPrefix: string }): ReactElement => (
  <ul className="flex min-w-0 list-disc flex-col gap-1 ps-4 text-sm text-muted-foreground">
    {answers.map((answer, position) => (
      <li key={`${keyPrefix}-unassigned-${String(position)}`} className="wrap-anywhere">
        <bdi>{answer}</bdi>
      </li>
    ))}
  </ul>
);
const WithdrawEffects = (): ReactElement => (
  <div className="flex min-w-0 flex-col gap-2">
    <p className="text-pretty wrap-anywhere">{STOP_EFFECT_COPY["withdraw-check-in"].consequence}</p>
    <p className="text-pretty wrap-anywhere">{STOP_EFFECT_COPY["withdraw-check-in"].assurance}</p>
  </div>
);
export default function CheckInEditor(props: CheckInEditorProps): ReactElement {
  const { revisions, checkInId, scope, expectedRevision, locale, unavailable = null, questionBank, className } = props;
  const [headingId, limitsId, completionId, refusalId] = [useId(), useId(), useId(), useId()];
  const identity = revisions.draft?.revisionId ?? revisions.shared?.revisionId ?? "no-revision";
  const [text, setText] = useState<EditorText>(() => ({ identity, questions: seededQuestions(props), answers: seededAnswers(props) }));
  const [draftQuestion, setDraftQuestion] = useState("");
  const [addRefusal, setAddRefusal] = useState<string | null>(null);
  const [focused, setFocused] = useState<FocusTarget | null>(null);
  const [saved, setSaved] = useState<{ readonly identity: string; readonly signature: string } | null>(null);
  const [known, setKnown] = useState<{ readonly from: string; readonly revision: string } | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [withdrawnHere, setWithdrawnHere] = useState(false);
  const [receipt, setReceipt] = useState<HeldReceipt | null>(null);
  const [savedFromHere, setSavedFromHere] = useState<string | null>(null);
  const writtenQuestions = useRef(0);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveWriting = useRef(false);
  const autosaveWritten = useRef<string | null>(null);
  const draftEdited = useRef(false);
  const save = useSaveCheckIn();
  const share = useShareCheckIn();
  const updateShared = useUpdateSharedCheckIn();
  const withdraw = useWithdrawCheckIn();
  const savedBody = savedBodyOf(revisions);
  const typedSignature = signatureOf(
    text.questions.map((question) => question.wording),
    text.answers,
  );
  const incomingSignature = savedBody === null ? null : signatureOf(savedBody.questions, savedBody.answers);
  // A re-read lands mid-sentence whenever a write made here comes back, and the read is never a reason to replace what the person is still typing: while the surface holds exactly the text this editor last submitted and this editor holds more, the newer text stays and only the revision behind it advances.
  const carriesTypedText = savedFromHere !== null && incomingSignature === savedFromHere && typedSignature !== incomingSignature;
  const active: EditorText = text.identity === identity ? text : carriesTypedText ? { ...text, identity } : { identity, questions: seededQuestions(props), answers: seededAnswers(props) };
  const { questions, answers } = active;
  const violations = validateCheckInRequest(requestOf(questions, answers));
  const refusalByField = refusalMessagesByField(violations);
  const formRefusals = violations.filter((violation) => fieldKeyOf(violation.path) === null).map(refusalTextOf);
  const body = bodyOf(questions, answers);
  const signature = signatureOf(body.questions, body.answers);
  const savedSignature = saved !== null && saved.identity === identity ? saved.signature : incomingSignature;
  const dirty = signature !== savedSignature;
  const answered = questions.filter((_, index) => (answers[index] ?? "").trim() !== "").length;
  const effectiveRevision = known !== null && known.from === expectedRevision ? known.revision : expectedRevision;
  const effectiveCheckInId = checkInId ?? createdId;
  const shared = revisions.shared;
  const sharedWithdrawn = shared !== null && ((shared.withdrawnAt ?? null) !== null || withdrawnHere);
  const sharedCopy = shared === null ? null : CHECK_IN_STATE_COPY[sharedWithdrawn ? "withdrawn" : "shared"];
  // The footer states the one fact the list states, from the same comparison the read makes: the saved private draft against the shared revision, never the text still being edited, which the unsaved sentence above already speaks for. A draft with no saved revision has no text to compare, so the footer makes no claim at all.
  const sharedDiffers = revisions.draft === null || shared === null ? null : answerSequenceTextOf(answerSequenceOf(revisions.draft.body)) !== answerSequenceTextOf(answerSequenceOf(shared.body));
  const unassignedSaved = revisions.draft?.body.unassignedAnswers ?? EMPTY_ANSWERS;
  const unassignedShared = shared?.body.unassignedAnswers ?? EMPTY_ANSWERS;
  const state = editorStateOf(unavailable, shared !== null, sharedWithdrawn);
  const readable = unavailable === null;
  const canSave = readable && violations.length === 0;
  const focusedScalars = focused === null ? 0 : focused.field === "question" ? scalarCount(questions[focused.position]?.wording ?? "") : scalarCount(answers[focused.position] ?? "");
  const offered = (questionBank ?? []).filter((question) => !questions.some((captured) => captured.id === question.id));
  const updateText = (next: { readonly questions?: readonly EditorQuestion[]; readonly answers?: readonly string[] }): void => {
    draftEdited.current = true;
    setText({ identity, questions: next.questions ?? questions, answers: next.answers ?? answers });
  };
  const changeWording = (position: number, wording: string): void => {
    updateText({ questions: questions.map((question, index) => (index === position ? { id: question.id, wording } : question)) });
  };
  const changeAnswer = (position: number, answer: string): void => {
    updateText({ answers: questions.map((_, index) => (index === position ? answer : (answers[index] ?? ""))) });
  };
  const removeQuestion = (position: number): void => {
    setAddRefusal(null);
    updateText({ questions: questions.filter((_, index) => index !== position), answers: questions.map((_, index) => answers[index] ?? "").filter((_, index) => index !== position) });
  };
  const addQuestion = (id: string, wording: string): void => {
    if (questions.length >= CHECKIN_MAX_QUESTIONS) {
      setAddRefusal(questionSetFullSentence(questions.length));
      return;
    }
    setAddRefusal(null);
    updateText({ questions: [...questions, { id, wording }], answers: [...questions.map((_, index) => answers[index] ?? ""), ""] });
  };
  const addWrittenQuestion = (): void => {
    const wording = draftQuestion.trim();
    if (wording === "") {
      setAddRefusal("A question needs words before it joins the set: write it above and add it again.");
      return;
    }
    const id = `written-question-${writtenQuestions.current}`;
    writtenQuestions.current += 1;
    addQuestion(id, wording);
    if (questions.length < CHECKIN_MAX_QUESTIONS) setDraftQuestion("");
  };
  const adoptOutcome = (outcome: MutationOutcome, submittedSignature: string | null): void => {
    if (outcome.outcome !== "accepted" && outcome.outcome !== "alreadyAccepted" && outcome.outcome !== "unchanged") return;
    setKnown({ from: expectedRevision, revision: outcome.revision });
    if (outcome.outcome !== "unchanged") {
      const created = outcome.created?.[0];
      if (created !== undefined) setCreatedId(created);
    }
    if (submittedSignature !== null) {
      setSavedFromHere(submittedSignature);
      setSaved({ identity, signature: submittedSignature });
    }
  };
  const savePayload: CheckInSavePayload = { ...(effectiveCheckInId === null ? {} : { checkInId: effectiveCheckInId }), questions: body.questions, answers: body.answers };
  const sharePayload: CheckInSharePayload | null = readable && shared === null && effectiveCheckInId !== null && savedBody !== null ? { checkInId: effectiveCheckInId, questions: [...savedBody.questions], answers: [...savedBody.answers] } : null;
  const sharedWordings = shared?.body.questions ?? [];
  const questionsMatchShared =
    shared !== null &&
    sameWordings(
      questions.map((question) => question.wording),
      sharedWordings,
    );
  const updatePayload: CheckInUpdateSharedPayload | null =
    readable && shared !== null && !sharedWithdrawn && effectiveCheckInId !== null && questionsMatchShared && violations.length === 0 ? { checkInId: effectiveCheckInId, sharedRevisionId: shared.revisionId, questions: [...sharedWordings], answers: questions.map((_, index) => answers[index] ?? "") } : null;
  const withdrawPayload: CheckInWithdrawPayload | null = readable && shared !== null && !sharedWithdrawn && effectiveCheckInId !== null ? { checkInId: effectiveCheckInId, sharedRevisionId: shared.revisionId } : null;
  const liveShare = sharePayload === null ? null : { scope, expectedRevision: effectiveRevision, payload: sharePayload };
  const liveUpdate = updatePayload === null ? null : { scope, expectedRevision: effectiveRevision, payload: updatePayload };
  const liveWithdraw = withdrawPayload === null ? null : { scope, expectedRevision: effectiveRevision, payload: withdrawPayload };
  const written = receipt?.write ?? null;
  const submittedShare = written?.review === "share" ? written.input : null;
  const submittedUpdate = written?.review === "update" ? written.input : null;
  const submittedWithdraw = written?.review === "withdraw" ? written.input : null;
  const receiptHeld = receipt !== null && holdsReceipt(receipt.outcome);
  const heldShare = receiptHeld ? submittedShare : null;
  const heldUpdate = receiptHeld ? submittedUpdate : null;
  const heldWithdraw = receiptHeld ? submittedWithdraw : null;
  // The change one review applies, apart from the revision the surface presented and the shared revision it names: the re-read after an applied change advances both, so a receipt keyed on either would leave the screen for a change nobody made here. The answers a review would send are the change itself, so editing them withholds the receipt exactly as the review step says.
  const changeKeyOf = (payload: unknown): string => intentKeyOf({ scope, expectedRevision: "check-in-change", payload });
  const answersKeyOf = (payload: { readonly checkInId: string; readonly questions: readonly string[]; readonly answers: readonly string[] }): string => changeKeyOf({ checkInId: payload.checkInId, questions: payload.questions, answers: payload.answers });
  // What each review presents: the facts its held receipt submitted while that receipt stands, the facts of an attempt still in flight, and the live facts otherwise, falling back to the submitted facts so a receipt already in hand never leaves the screen with the block that offered it. The route re-read after an applied change hands this surface a new revision — and, for a share or a withdrawal, a check-in that no longer offers the review at all — so a review presenting the live facts would drop its receipt and re-arm its confirm button for a change nobody made.
  const shareInput = heldFacts(heldShare, liveShare, answersKeyOf) ?? (share.isPending ? submittedShare : (liveShare ?? submittedShare));
  const updateInput = heldFacts(heldUpdate, liveUpdate, answersKeyOf) ?? (updateShared.isPending ? submittedUpdate : (liveUpdate ?? submittedUpdate));
  const withdrawInput = heldFacts(heldWithdraw, liveWithdraw, (payload: CheckInWithdrawPayload) => changeKeyOf({ checkInId: payload.checkInId })) ?? (withdraw.isPending ? submittedWithdraw : (liveWithdraw ?? submittedWithdraw));
  /** Records the facts one reviewed write submits before the mutation runs, so its review keeps describing the change that was made rather than the one the re-read presents. One write is held at a time: a new submit for any review replaces the previous receipt, while a re-apply of the change already held against the revision a conflict reported keeps the facts the review is showing. */
  const hold = (write: HeldWrite): void => {
    setReceipt((current) => ({ write: current !== null && changeKeyOf(current.write.input.payload) === changeKeyOf(write.input.payload) ? current.write : write, outcome: null }));
  };
  const submitShare = (attempt: MutationInput<CheckInSharePayload>): Promise<MutationOutcome> => {
    hold({ review: "share", input: { scope: attempt.scope, expectedRevision: attempt.expectedRevision, payload: attempt.payload } });
    return share.mutateAsync(attempt);
  };
  const submitUpdate = (attempt: MutationInput<CheckInUpdateSharedPayload>): Promise<MutationOutcome> => {
    hold({ review: "update", input: { scope: attempt.scope, expectedRevision: attempt.expectedRevision, payload: attempt.payload } });
    return updateShared.mutateAsync(attempt);
  };
  const submitWithdraw = (attempt: MutationInput<CheckInWithdrawPayload>): Promise<MutationOutcome> => {
    hold({ review: "withdraw", input: { scope: attempt.scope, expectedRevision: attempt.expectedRevision, payload: attempt.payload } });
    return withdraw.mutateAsync(attempt);
  };
  // An outcome settles the receipt of the write that submitted it, so a slower write answering after a newer submit leaves the newer receipt alone.
  const settleWrite = (review: HeldWrite["review"], outcome: MutationOutcome): void => {
    adoptOutcome(outcome, null);
    setReceipt((current) => (current !== null && current.write.review === review ? { write: current.write, outcome } : current));
  };
  const settleShare = (outcome: MutationOutcome): void => settleWrite("share", outcome);
  const settleUpdate = (outcome: MutationOutcome): void => settleWrite("update", outcome);
  const settleWithdrawal = (outcome: MutationOutcome): void => {
    settleWrite("withdraw", outcome);
    if (outcome.outcome === "accepted" || outcome.outcome === "unchanged") setWithdrawnHere(true);
  };
  // An autosave keeps the private draft the way the reviewed writes keep theirs: one write at a time, so a share, an update or a withdrawal never races the draft underneath it and always presents the revision the surface was read at.
  const reviewedWritePending = share.isPending || updateShared.isPending || withdraw.isPending;
  /** The facts one autosave writes: the draft's own text, the revision the surface presents and the check-in it writes to. Two writes with the same key are the same write, so a draft that has been through the debounce waits for a further edit, a new revision or the explicit button rather than retrying itself. */
  const autosaveKeyOf = (draftSignature: string): string => JSON.stringify([draftSignature, effectiveRevision, effectiveCheckInId]);
  const autosaveDue = readable && canSave && dirty && !save.isPending && !reviewedWritePending ? autosaveKeyOf(signature) : null;
  /** Writes the private draft exactly as the button does, for the debounce below: never before the person has changed the draft, never while a reviewed write or the save this editor already began is still running. */ const writeAutosave = (): void => {
    if (!draftEdited.current || autosaveWriting.current || autosaveDue === null) return;
    const submitted = signature;
    autosaveWriting.current = true;
    autosaveWritten.current = autosaveDue;
    save.mutate(
      { scope, expectedRevision: effectiveRevision, payload: savePayload },
      {
        onSettled: () => {
          autosaveWriting.current = false;
        },
        onSuccess: (outcome) => adoptOutcome(outcome, submitted),
      },
    );
  };
  // The timer runs the newest write rather than the one the debounce was armed with, so a save never presents a payload, a revision or a scope the surface has stopped showing.
  const autosave = useRef<() => void>(() => {});
  useEffect(() => {
    autosave.current = writeAutosave;
  });
  useEffect(() => {
    if (autosaveDue === null || autosaveWritten.current === autosaveDue) return;
    autosaveTimer.current = setTimeout(() => {
      autosaveTimer.current = null;
      autosave.current();
    }, AUTOSAVE_PAUSE_MS);
    return () => {
      if (autosaveTimer.current !== null) clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
    };
  }, [autosaveDue]);
  const submitSave = (): void => {
    if (!canSave || save.isPending) return;
    const submitted = signature;
    autosaveWritten.current = autosaveKeyOf(submitted);
    save.mutate({ scope, expectedRevision: effectiveRevision, payload: savePayload }, { onSuccess: (outcome) => adoptOutcome(outcome, submitted) });
  };
  const saveReplayable = save.data !== undefined && (save.data.outcome === "unavailable" || save.data.outcome === "unknown");
  const blockedReason =
    unavailable !== null ? (
      <p className="type-body text-pretty text-destructive wrap-anywhere">{"Nothing can be saved, shared, updated or withdrawn while the source cannot be read, and nothing you wrote has been lost."}</p>
    ) : violations.length === 0 ? null : (
      <Alert variant="destructive">
        <AlertTitle>{"Nothing will be sent yet"}</AlertTitle>
        <AlertDescription>
          <p className="text-pretty">{refusalCountSentence(violations.length)}</p>
          {formRefusals.length === 0 ? null : (
            <ul className="flex min-w-0 list-disc flex-col gap-1 ps-4">
              {formRefusals.map((sentence) => (
                <li key={sentence} className="min-w-0 wrap-anywhere">
                  {sentence}
                </li>
              ))}
            </ul>
          )}
        </AlertDescription>
      </Alert>
    );
  return (
    <section aria-labelledby={headingId} data-slot="check-in-editor" data-interface-locale={locale} data-check-in-state={state} className={cn("flex min-w-0 flex-col gap-6 text-start", className)}>
      <Panel titleId={headingId} headingLevel={2} title="Write a check-in" description={COACHING_COPY.checkIns.purpose} descriptionClassName="text-pretty wrap-anywhere" cardClassName="min-w-0" contentClassName="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-col gap-2" aria-labelledby={limitsId}>
          <h3 {...{ id: limitsId, className: "type-subsection-title" }}>{"The limits this check-in works within"}</h3>
          <ul className="flex min-w-0 list-disc flex-col gap-1 ps-4 text-sm text-pretty text-muted-foreground">
            <li className="wrap-anywhere">
              At most <bdi className="tabular-figures">{CHECKIN_MAX_QUESTIONS}</bdi> questions in one check-in.
            </li>
            <li className="wrap-anywhere">
              At most <bdi className="tabular-figures">{CHECKIN_MAX_QUESTION_SCALARS}</bdi> characters in a question, counted one per Unicode character, so a character outside the basic plane counts once.
            </li>
            <li className="wrap-anywhere">
              At most <bdi className="tabular-figures">{CHECKIN_MAX_ANSWER_SCALARS}</bdi> characters in an answer, counted the same way.
            </li>
            <li className="wrap-anywhere">
              At most <bdi className="tabular-figures">{CHECKIN_MAX_REQUEST_BYTES}</bdi> bytes once the whole check-in is sent.
            </li>
          </ul>
          <p className="type-supporting text-pretty wrap-anywhere">{"A value that crosses one of these limits is refused with the count it reached, and it is never shortened: nothing you wrote is cut down to fit, and no question leaves the set without you removing it yourself."}</p>
        </div>
        {focused === null ? null : (
          <p className="type-supporting wrap-anywhere">
            {"Where you are"}: {focusSentence(focused, focusedScalars)}
          </p>
        )}
      </Panel>
      {unavailable === null ? null : <StateNotice kind="unavailable" title="This check-in cannot be read right now" description={COACHING_COPY.checkIns.unavailable} source={unavailable.source} headingLevel={3} />}
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="wrap-anywhere">
            <h3 className="type-subsection-title flex min-w-0 flex-wrap items-center gap-2">
              {"Your private draft"}
              <Badge variant="secondary">{CHECK_IN_STATE_COPY["private-draft"].label}</Badge>
            </h3>
          </CardTitle>
          <CardDescription className="text-pretty wrap-anywhere">{CHECK_IN_STATE_COPY["private-draft"].description}</CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          <p className="type-supporting text-pretty wrap-anywhere">{"Only you can read this draft: autosave writes it as a private revision while you write, and it reaches no coach. Sharing is a separate action you take deliberately."}</p>
          <p className="type-supporting text-pretty wrap-anywhere">
            {"The questions were fixed when this check-in started, so a change to the offered list cannot rewrite what you are already writing."}
            {props.captured === null ? null : (
              <>
                {" "}
                {"Captured"} <bdi className="mono-identifier">{storedDayText(props.captured.capturedAt)}</bdi>.
              </>
            )}
          </p>
          <div className="flex min-w-0 flex-col gap-2">
            <p id={completionId} className="type-body text-pretty">
              <span className="font-medium">{COMPLETION_LABEL}</span> {completionSentence(answered, questions.length)}{" "}
            </p>
            {questions.length === 0 ? null : <Progress value={answered} max={questions.length} aria-label={COMPLETION_LABEL} aria-describedby={completionId} />}
          </div>
          <div {...{ id: refusalId, "aria-live": "polite", "aria-atomic": "true", "data-slot": "check-in-refusal", className: "flex min-w-0 flex-col gap-2" }}>{blockedReason}</div>
          <div className="flex min-w-0 flex-col gap-3">
            {questions.map((question, position) => (
              <QuestionRow
                key={question.id}
                position={position}
                wording={question.wording}
                answer={answers[position] ?? ""}
                wordingRefusal={refusalByField.get(`questions.${position}`)}
                answerRefusal={refusalByField.get(`answers.${position}`)}
                onWording={(next) => changeWording(position, next)}
                onAnswer={(next) => changeAnswer(position, next)}
                onRemove={() => removeQuestion(position)}
                onFocus={setFocused}
              />
            ))}
            {questions.length === 0 ? <p className="type-supporting text-pretty wrap-anywhere">{"No questions yet. Add one below or take one from the offered list; a check-in with no questions is still a private note to yourself."}</p> : null}
          </div>
          {unassignedSaved.length === 0 ? null : (
            <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3">
              <h4 className="text-sm font-medium">{"Saved answers that belong to no question"}</h4>
              <UnassignedAnswers answers={unassignedSaved} keyPrefix="draft" />
              <p className="text-sm text-pretty text-muted-foreground wrap-anywhere">{UNASSIGNED_DRAFT_SENTENCE}</p>
            </div>
          )}
          <Separator />
          <div className="flex min-w-0 flex-col gap-3">
            <h4 className="type-group-title">{"Add a question"}</h4>
            <FormField label="The question you want to answer" name="checkin-new-question" description="Write it in your own words, or take one of the offered questions below.">
              {(field) => <Input id={field.id} name="checkin-new-question" value={draftQuestion} autoComplete="off" aria-describedby={field.describedBy} onChange={(event) => setDraftQuestion(event.target.value)} />}
            </FormField>
            <div className="flex flex-wrap items-center gap-2">
              <Button {...{ type: "button", variant: "secondary", onClick: addWrittenQuestion }}>{"Add question"}</Button>
              <p className="type-supporting">{questionSetCountSentence(questions.length)}</p>
            </div>
            {addRefusal === null ? null : <output className="block text-sm text-pretty text-destructive wrap-anywhere">{addRefusal}</output>}
            <div className="flex min-w-0 flex-col gap-2">
              <h5 className="type-group-title">{"Offered questions"}</h5>
              {offered.length === 0 ? (
                <p className="type-supporting text-pretty wrap-anywhere">{"No offered questions came with this check-in, so every question is one you write yourself."}</p>
              ) : (
                <ul className="flex min-w-0 flex-col items-start gap-2">
                  {offered.map((question) => (
                    <li key={question.id} className="min-w-0 max-w-full">
                      <Button type="button" variant="outline" size="sm" className={cn(BUTTON_WRAP_CLASS, "text-start")} onClick={() => addQuestion(question.id, question.wording)}>
                        {`Add: `}
                        <bdi className="wrap-anywhere">{question.wording}</bdi>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <Separator />
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button {...{ type: "button", onClick: submitSave, disabled: !canSave || save.isPending, "aria-describedby": canSave ? undefined : refusalId }}>{save.isPending ? "Saving the private draft" : "Save private draft"}</Button>
              <output className="text-sm text-pretty text-muted-foreground wrap-anywhere">{save.isPending ? "Saving the private draft. Nothing you wrote is cleared while it saves." : dirty ? DRAFT_UNSAVED_SENTENCE : DRAFT_SAVED_SENTENCE}</output>
            </div>
            {save.data === undefined ? null : <OperationResult outcome={save.data} headingLevel={4} fieldLabels={fieldLabelsOf(questions.length)} {...(saveReplayable ? { onRetrySameWork: submitSave } : {})} />}
          </div>
        </CardContent>
      </Card>
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="wrap-anywhere">
            <h3 className="type-subsection-title flex min-w-0 flex-wrap items-center gap-2">
              {"The shared revision"}
              <Badge variant={sharedWithdrawn ? "outline" : "secondary"}>{sharedCopy === null ? "Not shared" : sharedCopy.label}</Badge>
            </h3>
          </CardTitle>
          <CardDescription className="text-pretty wrap-anywhere">{sharedCopy === null ? "No revision is shared, so a coach can read nothing from this check-in yet." : sharedCopy.description}</CardDescription>
        </CardHeader>
        {shared === null ? null : (
          <CardContent className="flex min-w-0 flex-col gap-3">
            <p className="type-body">
              {"Shared on"} <bdi className="mono-identifier">{storedDayText(shared.sharedAt)}</bdi>.
            </p>
            <AnswerList questions={shared.body.questions} answers={shared.body.answers} keyPrefix="shared" listClassName="flex min-w-0 list-decimal flex-col gap-3 ps-4" muted />
            {unassignedShared.length === 0 ? null : (
              <div className="flex min-w-0 flex-col gap-2">
                <h4 className="type-group-title">{"Answers that belong to no question"}</h4>
                <UnassignedAnswers answers={unassignedShared} keyPrefix="shared" />
                <p className="type-supporting text-pretty wrap-anywhere">{UNASSIGNED_SHARED_SENTENCE}</p>
              </div>
            )}
            {sharedDiffers === null ? null : <p className="type-supporting text-pretty wrap-anywhere">{sharedDiffers ? "Your private draft and the shared revision hold different text, and the shared revision changes only through Update shared check-in." : SHARED_SAME_SENTENCE}</p>}
            {sharedWithdrawn ? <p className="type-supporting text-pretty wrap-anywhere">{"A withdrawn revision cannot be shared again, so a new check-in would carry anything you want a coach to read next."}</p> : null}
          </CardContent>
        )}
      </Card>
      {savedBody === null || shared !== null || effectiveCheckInId !== null ? null : <p className="type-supporting text-pretty wrap-anywhere">{"The check-in's own identity is not known here yet, so sharing has to start from its list rather than from this view."}</p>}
      {shareInput === null ? null : (
        <ActionReview<CheckInSharePayload>
          title="Share this check-in with your coach"
          description={
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-pretty">{"The revision that will be shared"}</p>
              {savedBody === null ? null : <AnswerList questions={savedBody.questions} answers={savedBody.answers} keyPrefix="share" />}
              {savedBody === null || savedBody.unassignedAnswers.length === 0 ? null : (
                <div className="flex min-w-0 flex-col gap-1">
                  <UnassignedAnswers answers={savedBody.unassignedAnswers} keyPrefix="share" />
                  <p className="text-pretty">{"These answers belong to no question in the captured set: this share sends the saved private draft as it stands, so they stay with it rather than beside a question."}</p>
                </div>
              )}
              {dirty ? <p className="text-pretty">{"This shares the saved private revision, so the changes still unsaved above are not part of it."}</p> : null}
            </div>
          }
          consequence={<p className="type-supporting text-pretty wrap-anywhere">{"Sharing makes the saved private revision readable by the named coach, for the duration this relationship was accepted with. It sends no notification, records no interaction and creates no task."}</p>}
          confirmLabel="Share with coach"
          headingLevel={3}
          input={shareInput}
          submit={submitShare}
          onSettled={settleShare}
        />
      )}
      {shared === null || sharedWithdrawn || questionsMatchShared ? null : (
        <Alert>
          <AlertTitle>{"This draft asks different questions from the shared revision"}</AlertTitle>
          <AlertDescription>
            <p className="text-pretty wrap-anywhere">{"Update shared check-in changes answers only, on the question set the shared revision captured. Answer those questions here, or share a new check-in that carries the questions you now want to ask."}</p>
          </AlertDescription>
        </Alert>
      )}
      {updateInput === null ? null : (
        <ActionReview<CheckInUpdateSharedPayload>
          title="Update the shared check-in"
          description={<AnswerList questions={questions.map((question) => question.wording)} answers={answers} keyPrefix="update" />}
          consequence={<p className="type-supporting text-pretty wrap-anywhere">{"The answers below become the shared revision, which is the only way a shared check-in changes. This step does not save your private draft."}</p>}
          confirmLabel="Update shared check-in"
          headingLevel={3}
          input={updateInput}
          submit={submitUpdate}
          onSettled={settleUpdate}
        />
      )}
      {withdrawInput === null ? null : (
        <ActionReview<CheckInWithdrawPayload> title={STOP_EFFECT_COPY["withdraw-check-in"].title} description={<WithdrawEffects />} consequence={<WithdrawEffects />} confirmLabel="Withdraw shared check-in" consequential headingLevel={3} input={withdrawInput} submit={submitWithdraw} onSettled={settleWithdrawal} />
      )}
    </section>
  );
}
