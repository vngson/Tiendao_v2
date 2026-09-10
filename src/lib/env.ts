/**
 * Centralized, validated environment variables.
 * Fails fast at startup if required vars are missing.
 */
import { z } from "zod";

const EnvSchema = z
  .object({
    // Provider selector — choose the AI backend for translation.
    // 'gemini' (default) uses Google Gemini; 'groq' uses Llama/Qwen via
    // the OpenAI-compatible Groq API; 'm3' posts to a localhost
    // OpenAI-compatible endpoint (M3_API_BASE) for offline / private use;
    // 'cmdc' shells out to the Command Code CLI in headless print mode.
    TRANSLATION_PROVIDER: z
      .enum(["gemini", "groq", "m3", "cmdc"])
      .default("gemini"),
    // Gemini is the legacy default — keeping the env optional means a
    // Groq-only or M3-only dev setup doesn't need to set a placeholder key.
    GEMINI_API_KEY: z.string().optional(),
    GROQ_API_KEY: z.string().optional(),
    TRANSLATION_MODEL: z.string().default("gemini-2.0-flash-exp"),
    // M3 (localhost OpenAI-compatible) — these are read by
    // M3TranslationProvider directly without going through the Zod refine,
    // because M3 setup is optional and may run with no API key (LM Studio
    // default) and a non-M3 `TRANSLATION_PROVIDER`.
    M3_API_BASE: z.string().optional(),
    M3_API_KEY: z.string().optional(),
    M3_MODEL: z.string().optional(),
    // CMDC (Command Code CLI) — read by CmdcTranslationProvider. The CLI
    // carries its own authentication, so there is nothing to validate here
    // beyond the executable name and call budget.
    CMDC_BIN: z.string().default("cmdc"),
    CMDC_MODEL: z.string().optional(),
    CMDC_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
    CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
    // Vercel KV (optional in dev — code degrades gracefully when absent)
    KV_URL: z.string().optional(),
    KV_REST_API_URL: z.string().optional(),
    KV_REST_API_TOKEN: z.string().optional(),
    KV_REST_API_READ_ONLY_TOKEN: z.string().optional(),
  })
  // Cross-field check: the selected provider's key must be present.
  // 'm3' is allowed to run with an empty key (e.g. unauthenticated LM
  // Studio at localhost) as long as M3_API_BASE is configured.
  .refine(
    (env) => {
      if (env.TRANSLATION_PROVIDER === "gemini") {
        return !!env.GEMINI_API_KEY && env.GEMINI_API_KEY.length > 0;
      }
      if (env.TRANSLATION_PROVIDER === "groq") {
        return !!env.GROQ_API_KEY && env.GROQ_API_KEY.length > 0;
      }
      if (env.TRANSLATION_PROVIDER === "m3") {
        return !!env.M3_API_BASE && env.M3_API_BASE.length > 0;
      }
      return true;
    },
    {
      message:
        "Selected TRANSLATION_PROVIDER is missing required config " +
        "(need GEMINI_API_KEY for 'gemini', GROQ_API_KEY for 'groq', or M3_API_BASE for 'm3').",
    },
  );

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function isKvConfigured(): boolean {
  const env = getEnv();
  if (!env.KV_REST_API_URL || !env.KV_REST_API_TOKEN) return false;
  // Reject placeholder values left in .env (e.g. "https://...") so callers fall back gracefully.
  try {
    const u = new URL(env.KV_REST_API_URL);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return u.hostname.includes(".") && u.hostname !== "...";
  } catch {
    return false;
  }
}
