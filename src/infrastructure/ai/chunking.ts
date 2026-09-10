/**
 * Splits paragraphs into chunks that fit within a target character budget.
 * Chunks never break inside a paragraph — a paragraph is the atomic unit.
 *
 * Char-based (not token-based) is intentional: it's model-agnostic and
 * good enough as a budget guard. We pad generously because CJK chars
 * tend to be tokenized ~1:1.
 */

export interface Chunk {
  readonly paragraphs: readonly string[];
  /** Approx total characters in this chunk (sum of paragraph lengths). */
  readonly charCount: number;
}

export function chunkParagraphs(
  paragraphs: readonly string[],
  maxChars = 6_000,
): Chunk[] {
  if (paragraphs.length === 0) return [];
  const chunks: Chunk[] = [];
  let buffer: string[] = [];
  let size = 0;

  for (const p of paragraphs) {
    const len = p.length;
    // If a single paragraph exceeds the budget, emit it on its own
    // (better to truncate context than to drop the paragraph).
    if (len > maxChars) {
      if (buffer.length > 0) {
        chunks.push({ paragraphs: buffer, charCount: size });
        buffer = [];
        size = 0;
      }
      chunks.push({ paragraphs: [p], charCount: len });
      continue;
    }
    if (size + len > maxChars && buffer.length > 0) {
      chunks.push({ paragraphs: buffer, charCount: size });
      buffer = [p];
      size = len;
      continue;
    }
    buffer.push(p);
    size += len;
  }
  if (buffer.length > 0) chunks.push({ paragraphs: buffer, charCount: size });
  return chunks;
}
