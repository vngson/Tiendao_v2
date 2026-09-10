/**
 * Translation provider contract. Translates a list of Chinese paragraphs
 * into Vietnamese, preserving order and granularity.
 *
 * Implementations MUST:
 *  - Return exactly one output paragraph per input paragraph
 *    (or empty string when the provider drops a paragraph — but never
 *    re-order or merge).
 *  - Translate, not summarize.
 *  - Preserve proper nouns / character names.
 */
export interface TranslationProvider {
  /** Short identifier used in cache keys and logs. */
  readonly id: string;
  /** Underlying model identifier (for cache invalidation when swapped). */
  readonly model: string;
  translate(args: {
    paragraphs: readonly string[];
    /** Optional title to translate too. May be empty. */
    title?: string;
    /** Optional CN→VI glossary injected into the prompt so the model uses
     *  consistent renderings for proper nouns across chunks. When present,
     *  the model MUST prefer the supplied Vietnamese renderings. */
    glossary?: Readonly<Record<string, string>>;
    /** Optional signal for cancellation (caller-side timeout/abort). */
    signal?: AbortSignal;
  }): Promise<TranslationResult>;

  /** Translate novel-level metadata. Optional — service falls back to raw if missing. */
  translateNovelMeta?(args: {
    title: string;
    description: string;
    /** Author name. Empty string when unknown — caller should skip translation in that case. */
    author?: string;
    /** Genre tags (e.g. ["玄幻", "修真"]). Empty array when unknown — caller skips. */
    genre?: readonly string[];
    /** Publication status (e.g. "连载中"). Empty string when unknown — caller skips. */
    status?: string;
    signal?: AbortSignal;
  }): Promise<NovelMetaTranslation>;

  /** Translate a batch of chapter titles in one round-trip. Optional — falls back to raw. */
  translateChapterTitles?(args: {
    titles: readonly string[];
    signal?: AbortSignal;
  }): Promise<string[]>;

  /**
   * Extract a Chinese-proper-noun glossary from the source paragraphs and
   * translate each term into Vietnamese. Returned entries become a
   * per-novel anchor for downstream chunk translations so the model
   * renders the same character name the same way across chunks.
   *
   * Implementations SHOULD:
   *  - Return only terms that actually appear in the input (no hallucinated
   *    glossary entries).
   *  - Limit output to the most frequent / most important terms (e.g.
   *    character names, sect names, place names, technique names) — not
   *    every common noun.
   *  - Preserve the original Chinese spelling as the key, and the
   *    Vietnamese rendering as the value.
   *
   * Caller falls back to no-glossary translation when this method is
   * absent or throws — the failure is non-fatal.
   */
  extractGlossary?(args: {
    paragraphs: readonly string[];
    existing?: Readonly<Record<string, string>>;
    signal?: AbortSignal;
  }): Promise<Record<string, string>>;
}

export interface TranslationResult {
  /** Translated title, or echo of input when no title was given. */
  title: string;
  /** One translated paragraph per input paragraph, preserving order. */
  paragraphs: string[];
  /** Token usage reported by the provider, when available. */
  usage?: { inputTokens?: number; outputTokens?: number };
}

/** Vietnamese metadata for a novel. Used to populate `titleVi` / `descriptionVi`. */
export interface NovelMetaTranslation {
  /** Vietnamese rendering of the novel title. */
  titleVi: string;
  /** Vietnamese rendering of the description / synopsis. */
  descriptionVi: string;
  /** Vietnamese rendering of the author name (echoed back when source is empty). */
  authorVi?: string;
  /** Vietnamese renderings of the genre tags, preserving input order. */
  genreVi?: readonly string[];
  /** Vietnamese rendering of the publication status. */
  statusVi?: string;
}
