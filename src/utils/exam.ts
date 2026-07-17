import { questionBank } from '../data/questionBank'
import {
  SUBJECTS,
  type AnswerMap,
  type ExamMode,
  type ExamQuestion,
  type ExamSession,
  type Question,
  type QuestionHistory,
  type QuestionHistoryEntry,
  type Subject,
} from '../types'

const HISTORY_KEY = 'cscprep:question-history:v1'
const COMPLETED_EXAM_COUNT_KEY = 'cscprep:completed-exam-count:v1'
const ITEMS_PER_SUBJECT = 20
const TOTAL_EXAM_ITEMS = 100
const RANDOM_EXAM_ITEMS = 150
const MAX_EXAM_ITEMS = 150
const COOLDOWN_EXAMS = 2
const MIXED_EXAM_SUBJECT_COUNTS: Partial<Record<Subject, number>> = {
  'Verbal Reasoning': 40,
  'Analytical Ability': 25,
  'Numerical Reasoning': 25,
  'General Information': 10,
  Filipino: 10,
}

function isExamEligibleQuestion(question: Question): boolean {
  if (question.status === 'excluded' || question.status === 'needs-review') {
    return false
  }

  const hasPlaceholderChoices = question.choices.some((choice) => {
    const text = choice.text.trim()
    return !text || /^Option [A-E]$/.test(text) || /^Choice [A-E]$/.test(text)
  })

  const hasCorrectChoice = question.choices.some((choice) => choice.id === question.correctChoiceId)

  return Boolean(
    question.prompt.trim() &&
    question.choices.length >= 2 &&
    !hasPlaceholderChoices &&
    hasCorrectChoice
  )
}

function getExamEligibleQuestions(): Question[] {
  return questionBank.filter(isExamEligibleQuestion)
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items]

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]]
  }

  return copy
}

function byLeastRecentCooldown(a: QuestionHistoryEntry, b: QuestionHistoryEntry): number {
  return (
    a.eligibleAgainAfterExamNumber - b.eligibleAgainAfterExamNumber ||
    a.lastAnsweredExamNumber - b.lastAnsweredExamNumber
  )
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson<T>(key: string, value: T): void {
  window.localStorage.setItem(key, JSON.stringify(value))
}

export function getCompletedExamCount(): number {
  const value = Number(window.localStorage.getItem(COMPLETED_EXAM_COUNT_KEY))
  return Number.isFinite(value) && value > 0 ? value : 0
}

function setCompletedExamCount(count: number): void {
  window.localStorage.setItem(COMPLETED_EXAM_COUNT_KEY, String(count))
}

export function getQuestionHistory(): QuestionHistory {
  return readJson<QuestionHistory>(HISTORY_KEY, {})
}

function saveQuestionHistory(history: QuestionHistory): void {
  writeJson(HISTORY_KEY, history)
}

export function resetQuestionHistory(): void {
  window.localStorage.removeItem(HISTORY_KEY)
  window.localStorage.removeItem(COMPLETED_EXAM_COUNT_KEY)
}

function questionsBySubject(subject: Subject): Question[] {
  return getExamEligibleQuestions().filter((question) => question.subject === subject)
}

function pickQuestions(
  questions: Question[],
  history: QuestionHistory,
  examNumber: number,
  targetCount: number,
  excludedQuestionIds = new Set<string>(),
): Question[] {
  const availableQuestions = questions.filter((question) => !excludedQuestionIds.has(question.id))
  const eligible = availableQuestions.filter((question) => {
    const entry = history[question.id]
    return !entry || examNumber > entry.eligibleAgainAfterExamNumber
  })
  const coolingDown = availableQuestions
    .filter((question) => !eligible.includes(question))
    .sort((a, b) => byLeastRecentCooldown(history[a.id], history[b.id]))

  return [
    ...shuffle(eligible).slice(0, targetCount),
    ...coolingDown.slice(0, Math.max(0, targetCount - eligible.length)),
  ].slice(0, targetCount)
}

function getSessionTitle(mode: ExamMode): string {
  if (mode.kind === 'mixed') {
    return 'Random Exam'
  }

  return `${mode.subject} Exam`
}

function preservesChoiceOrder(question: Question): boolean {
  return Boolean(question.image)
}

function allocateProportionately(itemCount: number, subjectCounts: Record<Subject, number>): Record<Subject, number> {
  const total = Object.values(subjectCounts).reduce((a, b) => a + b, 0)
  if (total === 0) {
    return SUBJECTS.reduce((acc, sub) => ({ ...acc, [sub]: 0 }), {} as Record<Subject, number>)
  }

  const allocations: Record<Subject, number> = {} as Record<Subject, number>
  let allocatedSum = 0
  const remainders: { subject: Subject; remainder: number }[] = []

  SUBJECTS.forEach((subject) => {
    const count = subjectCounts[subject] ?? 0
    const exact = (count / total) * itemCount
    const floor = Math.floor(exact)
    allocations[subject] = floor
    allocatedSum += floor
    remainders.push({ subject, remainder: exact - floor })
  })

  remainders.sort((a, b) => b.remainder - a.remainder)

  let index = 0
  while (allocatedSum < itemCount && index < remainders.length) {
    const sub = remainders[index].subject
    allocations[sub] += 1
    allocatedSum += 1
    index += 1
  }

  if (allocatedSum < itemCount) {
    for (const sub of SUBJECTS) {
      const limit = subjectCounts[sub] ?? 0
      while (allocations[sub] < limit && allocatedSum < itemCount) {
        allocations[sub] += 1
        allocatedSum += 1
      }
    }
  }

  return allocations
}

export function createExamSession(mode: ExamMode = { kind: 'mixed' }, timed = false): ExamSession {
  return createExamSessionWithExclusions(mode, timed)
}

export function createExamSessionWithExclusions(
  mode: ExamMode = { kind: 'mixed' },
  timed = false,
  excludedQuestionIds = new Set<string>(),
): ExamSession {
  const history = getQuestionHistory()
  const examNumber = getCompletedExamCount() + 1
  const allEligibleQuestions = getExamEligibleQuestions()

  const questions = (() => {
    if (mode.kind === 'mixed') {
      const itemCount = Math.min(
        Math.max(1, Math.floor(mode.itemCount ?? RANDOM_EXAM_ITEMS)),
        MAX_EXAM_ITEMS,
        allEligibleQuestions.length,
      )
      const allocations = allocateProportionately(itemCount, MIXED_EXAM_SUBJECT_COUNTS as Record<Subject, number>)
      const selectedQuestionIds = new Set<string>()

      return SUBJECTS.flatMap((subject) => {
        const targetCount = allocations[subject] ?? 0

        if (targetCount === 0) {
          return []
        }

        const subjectQuestions = pickQuestions(
          questionsBySubject(subject),
          history,
          examNumber,
          targetCount,
          new Set([...selectedQuestionIds, ...excludedQuestionIds]),
        )

        subjectQuestions.forEach((question) => selectedQuestionIds.add(question.id))
        return subjectQuestions
      })
    }

    const subjectQuestionCount = Math.min(
      Math.max(1, Math.floor(mode.itemCount ?? TOTAL_EXAM_ITEMS)),
      MAX_EXAM_ITEMS,
      questionsBySubject(mode.subject).length,
    )

    return pickQuestions(questionsBySubject(mode.subject), history, examNumber, subjectQuestionCount, excludedQuestionIds)
  })()
  const orderedQuestions = shuffle(questions)

  return {
    examNumber,
    mode,
    title: getSessionTitle(mode),
    timed,
    questions: orderedQuestions.map<ExamQuestion>((question, index) => ({
      id: `${question.id}-${index + 1}`,
      itemNumber: index + 1,
      question,
      choices: preservesChoiceOrder(question) ? question.choices : shuffle(question.choices),
    })),
  }
}

function replacementPoolForQuestion(session: ExamSession, targetQuestion: Question): Question[] {
  if (session.mode.kind === 'subject') {
    return questionsBySubject(session.mode.subject)
  }

  const sameSubjectPool = questionsBySubject(targetQuestion.subject)
  return sameSubjectPool.length > 0 ? sameSubjectPool : getExamEligibleQuestions()
}

export function replaceExamQuestion(
  session: ExamSession,
  itemId: string,
  excludedQuestionIds = new Set<string>(),
): ExamSession {
  const targetItem = session.questions.find((question) => question.id === itemId)

  if (!targetItem) {
    return session
  }

  const excludedIds = new Set([
    ...session.questions.map((question) => question.question.id),
    ...excludedQuestionIds,
  ])
  const history = getQuestionHistory()
  const replacementPool = replacementPoolForQuestion(session, targetItem.question)
  const candidates = replacementPool.filter((question) => !excludedIds.has(question.id))
  const eligibleCandidates = candidates.filter((question) => {
    const entry = history[question.id]
    return !entry || session.examNumber > entry.eligibleAgainAfterExamNumber
  })
  const fallbackCandidates = candidates
    .filter((question) => !eligibleCandidates.includes(question))
    .sort((a, b) => byLeastRecentCooldown(history[a.id], history[b.id]))
  const replacementQuestion = shuffle(eligibleCandidates)[0] ?? fallbackCandidates[0]

  if (!replacementQuestion) {
    return session
  }

  const replacementChoices = preservesChoiceOrder(replacementQuestion)
    ? replacementQuestion.choices
    : shuffle(replacementQuestion.choices)

  return {
    ...session,
    questions: session.questions.map((question) => (
      question.id === itemId
        ? {
            ...question,
            question: replacementQuestion,
            choices: replacementChoices,
          }
        : question
    )),
  }
}

export function completeExam(session: ExamSession, answers: AnswerMap): void {
  const history = getQuestionHistory()

  session.questions.forEach(({ id, question }) => {
    if (!answers[id]) {
      return
    }

    history[question.id] = {
      questionId: question.id,
      lastAnsweredExamNumber: session.examNumber,
      eligibleAgainAfterExamNumber: session.examNumber + COOLDOWN_EXAMS,
    }
  })

  saveQuestionHistory(history)
  setCompletedExamCount(Math.max(getCompletedExamCount(), session.examNumber))
}

export function countSubjectQuestions(): Record<Subject, number> {
  return SUBJECTS.reduce(
    (counts, subject) => ({
      ...counts,
      [subject]: questionsBySubject(subject).length,
    }),
    {} as Record<Subject, number>,
  )
}

export function getAnsweredHistoryCount(): number {
  const questionIds = new Set(getExamEligibleQuestions().map((question) => question.id))

  return Object.keys(getQuestionHistory()).filter((questionId) => questionIds.has(questionId)).length
}

export function getLoadedQuestionCount(): number {
  return getExamEligibleQuestions().length
}

export { COOLDOWN_EXAMS, ITEMS_PER_SUBJECT, MAX_EXAM_ITEMS, MIXED_EXAM_SUBJECT_COUNTS, RANDOM_EXAM_ITEMS, TOTAL_EXAM_ITEMS }
