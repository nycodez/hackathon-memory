const dimensions = 1024

export const VECTOR_DIMENSIONS = dimensions

/**
 * Dependency-free feature hashing keeps the starter searchable before an external
 * embedding provider is configured. Replace this service with a hosted embedding
 * model while preserving the 1,024-dimension database contract.
 */
export function embedText(value: string): number[] {
  const vector = Array<number>(dimensions).fill(0)
  const terms = value.toLocaleLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []

  for (const term of terms) {
    const primary = hash(term, 2166136261) % dimensions
    const secondary = hash(term, 2654435761) % dimensions
    vector[primary] += 1
    vector[secondary] -= 0.35
  }

  const norm = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0)) || 1
  return vector.map((item) => Number((item / norm).toFixed(7)))
}

export function toVectorLiteral(vector: number[]): string {
  if (vector.length !== dimensions) throw new Error(`Expected ${dimensions} embedding dimensions`)
  return `[${vector.join(',')}]`
}

function hash(value: string, seed: number): number {
  let result = seed >>> 0
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

