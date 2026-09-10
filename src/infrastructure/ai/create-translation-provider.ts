/**
 * Provider factory.
 *
 * Single source of truth for "which AI backend does the translation
 * service use". Replaces the prior pattern of hard-coding
 * `new GeminiTranslationProvider()` at every route entry point.
 *
 * Selection happens via `TRANSLATION_PROVIDER` env (`gemini` | `groq`
 * | `m3` | `cmdc`) with a small allowance to override per call (handy for
 * tests).
 */
import { getEnv } from "@/lib/env";
import { GeminiTranslationProvider } from "@/infrastructure/ai/gemini-translation-provider";
import { GroqTranslationProvider } from "@/infrastructure/ai/groq-translation-provider";
import { M3TranslationProvider } from "@/infrastructure/ai/m3-translation-provider";
import { CmdcTranslationProvider } from "@/infrastructure/ai/cmdc-translation-provider";
import type { TranslationProvider } from "@/infrastructure/ai/translation-provider";

/**
 * Build a `TranslationProvider` for the currently configured backend.
 * Reads `TRANSLATION_PROVIDER` from env on each call so hot-reload / Vercel
 * edge config swaps are picked up without a redeploy.
 */
export function createTranslationProvider(): TranslationProvider {
  const env = getEnv();
  switch (env.TRANSLATION_PROVIDER) {
    case "groq":
      return new GroqTranslationProvider();
    case "m3":
      return new M3TranslationProvider();
    case "cmdc":
      return new CmdcTranslationProvider();
    case "gemini":
    default:
      return new GeminiTranslationProvider();
  }
}
