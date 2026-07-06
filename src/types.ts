export const SUBJECTS = [
  'Verbal Reasoning',
  'Numerical Reasoning',
  'Analytical Ability',
  'Filipino',
  'General Information',
] as const

export type Subject = (typeof SUBJECTS)[number]

export type ChoiceId = 'A' | 'B' | 'C' | 'D' | 'E'

export type Choice = {
  id: ChoiceId
  text: string
  image?: string
}

export type Question = {
  id: string
  subject: Subject
  prompt: string
  hint: string
  choices: Choice[]
  correctChoiceId: ChoiceId
  explanation?: string
  image?: string
}

export type ExamQuestion = {
  id: string
  itemNumber: number
  question: Question
  choices: Choice[]
}

export type ExamMode =
  | {
      kind: 'mixed'
      itemCount?: number
    }
  | {
      kind: 'subject'
      subject: Subject
      itemCount?: number
    }

export type ExamSession = {
  examNumber: number
  mode: ExamMode
  title: string
  timed: boolean
  questions: ExamQuestion[]
}

export type AnswerMap = Record<string, ChoiceId>

export type QuestionHistoryEntry = {
  questionId: string
  lastAnsweredExamNumber: number
  eligibleAgainAfterExamNumber: number
}

export type QuestionHistory = Record<string, QuestionHistoryEntry>

export type ReviewFilter = 'all' | 'correct' | 'wrong'
