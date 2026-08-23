export type AsyncScope = Readonly<{
  subjectKey: string
  generation: number
  token: symbol
}>

export function createAsyncScope(subjectKey: string, generation: number): AsyncScope {
  return { subjectKey, generation, token: Symbol(subjectKey) }
}

export function isCurrentAsyncScope(
  active: AsyncScope | null,
  candidate: AsyncScope,
  currentSubjectKey: string,
  currentGeneration: number,
): boolean {
  return active === candidate
    && candidate.subjectKey === currentSubjectKey
    && candidate.generation === currentGeneration
}

/** Whether an in-flight operation occupies this subject/login generation. */
export function hasCurrentAsyncOperation(
  active: AsyncScope | null,
  currentSubjectKey: string,
  currentGeneration: number,
): boolean {
  return active !== null
    && active.subjectKey === currentSubjectKey
    && active.generation === currentGeneration
}
