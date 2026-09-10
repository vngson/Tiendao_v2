/**
 * Orchestrates translation: chunks long chapters, calls the provider, and
 * stitches results back together in order. Cache-friendly: caller is expected
 * to cache the final stitched result.
 */
import {
  type TranslationProvider,
  type TranslationResult,
  type NovelMetaTranslation,
} from "@/infrastructure/ai/translation-provider";
import { chunkParagraphs } from "@/infrastructure/ai/chunking";

export interface TranslationServiceOptions {
  /** Max characters per chunk. Default 6000. */
  maxCharsPerChunk?: number;
}

export class TranslationService {
  constructor(
    private readonly provider: TranslationProvider,
    private readonly opts: TranslationServiceOptions = {},
  ) {}

  get providerId(): string {
    return this.provider.id;
  }

  get model(): string {
    return this.provider.model;
  }

  async translate(args: {
    paragraphs: readonly string[];
    title?: string;
    /** Optional glossary (CN → VI) injected into every chunk prompt to keep
     *  character names consistent across parallel chunks. The caller is
     *  expected to cache this per novel. When absent, chunks translate
     *  without an anchor — first-chapter cost only. */
    glossary?: Readonly<Record<string, string>>;
    signal?: AbortSignal;
  }): Promise<TranslationResult> {
    const maxChars = this.opts.maxCharsPerChunk ?? 6_000;
    const chunks = chunkParagraphs(args.paragraphs, maxChars);

    if (chunks.length === 0) {
      return { title: args.title ?? "", paragraphs: [] };
    }

    // Single-chunk case: glossary goes straight into the one request.
    if (chunks.length === 1) {
      return this.provider.translate({
        paragraphs: chunks[0]!.paragraphs,
        title: args.title,
        glossary: args.glossary,
        signal: args.signal,
      });
    }

    // Translate chunks in parallel. Order matters for the final stitched
    // output, but `Promise.all` preserves the input array order regardless
    // of which chunk finishes first — so we don't need to track indexes
    // explicitly. The title only needs to be set once (whichever chunk
    // returns it first), so we race-aware pick the first non-empty title.
    const results = await Promise.all(
      chunks.map((chunk) =>
        this.provider.translate({
          paragraphs: chunk.paragraphs,
          title: args.title,
          glossary: args.glossary,
          signal: args.signal,
        }),
      ),
    );

    let translatedTitle = args.title ?? "";
    const stitched: string[] = [];
    let inputTokens = 0;
    let outputTokens = 0;

    for (let i = 0; i < results.length; i += 1) {
      const result = results[i]!;
      const chunk = chunks[i]!;
      if (!translatedTitle && result.title) translatedTitle = result.title;
      if (result.paragraphs.length !== chunk.paragraphs.length) {
        throw new Error(
          `Translation provider dropped or merged paragraphs: ` +
            `expected ${chunk.paragraphs.length}, got ${result.paragraphs.length}`,
        );
      }
      for (const p of result.paragraphs) stitched.push(p);
      if (result.usage) {
        inputTokens += result.usage.inputTokens ?? 0;
        outputTokens += result.usage.outputTokens ?? 0;
      }
    }

    return {
      title: translatedTitle,
      paragraphs: stitched,
      usage:
        inputTokens || outputTokens
          ? { inputTokens, outputTokens }
          : undefined,
    };
  }

  /**
   * Extract a glossary of Chinese proper nouns from the source paragraphs,
   * then merge with `existing` (so the glossary grows incrementally across
   * chapters). Returns the merged map — never throws on provider failure
   * (returns the existing glossary unchanged).
   *
   * When the provider doesn't implement `extractGlossary`, returns the
   * existing glossary as-is.
   */
  async extractAndMergeGlossary(args: {
    paragraphs: readonly string[];
    existing?: Readonly<Record<string, string>>;
    signal?: AbortSignal;
  }): Promise<Record<string, string>> {
    const provider = this.provider as TranslationProvider & {
      extractGlossary?: (a: typeof args) => Promise<Record<string, string>>;
    };
    if (typeof provider.extractGlossary !== "function") {
      return { ...(args.existing ?? {}) };
    }
    try {
      const merged = await provider.extractGlossary(args);
      return merged ?? { ...(args.existing ?? {}) };
    } catch {
      // Provider hiccup — proceed without an updated glossary. Translation
      // will still run; just without name consistency enforcement for this
      // chapter.
      return { ...(args.existing ?? {}) };
    }
  }

  /**
   * Translate novel-level metadata (title + description + author + genre +
   * status). Provider-specific: some providers may translate directly, others
   * may go through `translate()` with a wrapping paragraph. Here we delegate
   * straight to the provider — Gemini has a dedicated low-token path for this.
   */
  translateNovelMeta(args: {
    title: string;
    description: string;
    author?: string;
    genre?: readonly string[];
    status?: string;
    signal?: AbortSignal;
  }): Promise<NovelMetaTranslation> {
    // TranslationProvider does not (yet) declare this in its public interface,
    // so we reach through duck-typing. All current providers (Gemini) implement it.
    const provider = this.provider as TranslationProvider & {
      translateNovelMeta?: (a: typeof args) => Promise<NovelMetaTranslation>;
    };
    if (typeof provider.translateNovelMeta !== "function") {
      return Promise.resolve({
        titleVi: args.title,
        descriptionVi: args.description,
      });
    }
    return provider.translateNovelMeta(args);
  }

  /**
   * Translate a batch of chapter titles in one round-trip.
   * Falls back to raw titles if the provider doesn't expose it.
   */
  translateChapterTitles(args: {
    titles: readonly string[];
    signal?: AbortSignal;
  }): Promise<string[]> {
    const provider = this.provider as TranslationProvider & {
      translateChapterTitles?: (a: typeof args) => Promise<string[]>;
    };
    if (typeof provider.translateChapterTitles !== "function") {
      return Promise.resolve([...args.titles]);
    }
    return provider.translateChapterTitles(args);
  }
}
