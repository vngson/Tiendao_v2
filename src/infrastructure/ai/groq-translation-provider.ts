/**
 * Groq translation provider.
 *
 * Uses the OpenAI-compatible Chat Completions endpoint at
 * `https://api.groq.com/openai/v1/chat/completions`. Groq hosts Llama 3.3
 * 70B and other open models on a custom LPU; the free tier is generous
 * (14,400 RPD, 30 RPM) — suitable as a Gemini fallback when the Gemini
 * free quota runs out.
 *
 * Structured JSON output uses `response_format: { type: "json_object" }`,
 * available on Llama 3.3 70B Versatile. The schema is enforced via the
 * prompt (no `responseSchema` field like Gemini has). When parsing fails
 * we strip code fences before retrying — same defensive `safeParseJson`
 * pattern Gemini uses.
 */
import { getEnv } from "@/lib/env";
import type {
  TranslationProvider,
  TranslationResult,
  NovelMetaTranslation,
} from "@/infrastructure/ai/translation-provider";

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
// Default to Qwen 3.6 27B — picked because it is the most reliable
// multilingual translation model in the free Groq tier (1K RPD, 200K TPD
// at the time of writing). The Llama 3.x family is gated for many
// accounts and was returning `model_not_found` on this project's key.
// Override via TRANSLATION_MODEL in `.env` if you have access to a
// different model (e.g. `openai/gpt-oss-120b` for higher quality).
const DEFAULT_MODEL = "qwen/qwen3.6-27b";

const SYSTEM_PROMPT = `
Bạn là một dịch giả chuyên nghiệp chuyên dịch tiểu thuyết Trung Quốc thuộc thể loại:
- Tu tiên
- Tiên hiệp
- Huyền huyễn
- Kiếm hiệp
- Dị giới

Nhiệm vụ của bạn là chuyển ngữ nội dung từ tiếng Trung sang tiếng Việt với chất lượng như một bản dịch tiểu thuyết chuyên nghiệp, tự nhiên và giàu không khí.

## YÊU CẦU BẮT BUỘC

### 1. Dịch đầy đủ
- Dịch toàn bộ nội dung được cung cấp.
- KHÔNG tóm tắt.
- KHÔNG bỏ sót câu, đoạn hoặc chi tiết.
- KHÔNG tự thêm nội dung không có trong bản gốc.

### 2. Giữ nguyên cấu trúc
- Giữ nguyên thứ tự các đoạn văn.
- Mỗi phần tử trong paragraphs đầu vào phải tương ứng với đúng một phần tử trong paragraphs đầu ra.
- Không tự ý gộp hoặc chia đoạn nếu không cần thiết.

### 3. Văn phong
- Dịch theo văn phong tiểu thuyết tiên hiệp / tu tiên / huyền huyễn tự nhiên bằng tiếng Việt.
- Câu văn phải mượt mà, dễ đọc, có cảm giác như một tiểu thuyết đã được biên dịch chuyên nghiệp.
- Ưu tiên cách diễn đạt tự nhiên thay vì dịch từng chữ máy móc.
- Giữ được không khí cổ phong, huyền huyễn và tu tiên của nguyên tác khi phù hợp.
- Không sử dụng văn phong quá hiện đại hoặc đời thường nếu bối cảnh là cổ phong / tu tiên.

### 4. Thuật ngữ tu tiên và huyền huyễn
Dịch nhất quán các thuật ngữ theo cách dùng phổ biến trong tiểu thuyết tiên hiệp tiếng Việt.

Ví dụ:

炼气 → Luyện Khí
筑基 → Trúc Cơ
金丹 → Kim Đan
元婴 → Nguyên Anh
化神 → Hóa Thần
渡劫 → Độ Kiếp
飞升 → Phi Thăng
灵气 → Linh Khí
灵石 → Linh Thạch
丹药 → Đan Dược
法宝 → Pháp Bảo
功法 → Công Pháp
宗门 → Tông Môn
洞府 → Động Phủ

Khi gặp thuật ngữ mới, hãy chọn cách dịch phù hợp với ngữ cảnh và duy trì cách dịch đó nhất quán trong toàn bộ nội dung.

### 5. Tên riêng
- Giữ nguyên tên nhân vật theo cách phiên âm/dịch phù hợp.
- Giữ nhất quán tên nhân vật trong toàn bộ chapter.
- Không tự ý thay đổi tên nhân vật giữa các đoạn.
- Địa danh, môn phái, bí cảnh, công pháp, pháp bảo và các danh từ riêng cần được chuyển ngữ tự nhiên và nhất quán.

### 5b. CẤM giữ chữ Hán trong output
- KHÔNG ĐƯỢC giữ bất kỳ chữ Hán tự nào trong bản dịch — kể cả tên nhân vật, địa danh, pháp bảo, công pháp, chiêu thức.
- Mọi chữ Hán PHẢI được phiên âm Hán Việt (vd "楚枫" → "Sở Phong") hoặc dịch nghĩa nếu là thuật ngữ (vd "天元大陆" → "Đại lục Thiên Nguyên").
- KHÔNG viết "Tiêu Bắc Thuần ngưng tụ toàn thân khí thế để về phía楚枫" — phải viết "...để về phía Sở Phong".
- Nếu bản gốc có một glossary đính kèm (mục "GLOSSARY" trong user prompt), PHẢI dùng đúng phiên âm / dịch nghĩa đã liệt kê trong glossary cho các tên riêng xuất hiện ở đó.

### 6. Không thêm nội dung ngoài bản dịch
- KHÔNG thêm lời mở đầu.
- KHÔNG thêm lời giải thích.
- KHÔNG thêm chú thích.
- KHÔNG thêm nhận xét.
- KHÔNG sử dụng markdown.

## OUTPUT FORMAT

Chỉ trả về JSON hợp lệ.

Schema chính xác:

{
  "title": "Tiêu đề chương đã được dịch sang tiếng Việt",
  "paragraphs": [
    "Đoạn văn thứ nhất đã dịch",
    "Đoạn văn thứ hai đã dịch"
  ]
}

Không trả về bất kỳ nội dung nào ngoài JSON.
`;

/** Short system prompt for batch title / metadata translation.
 *  Reuses the same style rules (tu tien / huyen huy) as the main prompt. */
const META_SYSTEM_PROMPT = `
Bạn là dịch giả tiểu thuyết Trung Quốc (thể loại tu tiên, tiên hiệp, huyền huyễn, kiếm hiệp, dị giới) sang tiếng Việt.

Yêu cầu:
- Dịch tự nhiên, đúng văn phong tiên hiệp / tu tiên.
- Giữ nhất quán tên nhân vật, địa danh, môn phái, công pháp.
- KHÔNG tóm tắt, KHÔNG thêm nội dung ngoài bản dịch, KHÔNG dùng markdown.
- Với chương: chỉ dịch phần tiêu đề, giữ format "Chương X" nếu có.
- Với thể loại tiếng Việt, KHÔNG phiên âm Hán Việt nguyên xi — hãy dịch theo nghĩa (vd "Tu tiên" không phải "Tu tiên", giữ nguyên).
- Với tên tác giả: phiên âm Hán Việt tự nhiên (vd "忘语" → "Vong Ngữ") hoặc giữ nguyên nếu đã phổ biến.
- Với trạng thái: dịch theo nghĩa (vd "连载中" → "Đang ra", "完结" → "Hoàn thành").

Trường nào input không có (undefined) thì BỎ QUA, không trả về trong JSON.
Chỉ trả về JSON hợp lệ theo schema. Không trả thêm gì khác.
`;

const GLOSSARY_SYSTEM_PROMPT = `
Bạn là trợ lý trích xuất thuật ngữ cho bản dịch tiểu thuyết Trung Quốc (thể loại tu tiên, tiên hiệp, huyền huyễn, kiếm hiệp, dị giới) sang tiếng Việt.

Nhiệm vụ: đọc các đoạn văn tiếng Trung được cung cấp, trích ra TÊN RIÊNG (nhân vật, địa danh, môn phái, pháp bảo, công pháp, chiêu thức) xuất hiện trong đoạn đó, và phiên âm / dịch sang tiếng Việt.

Yêu cầu:
- CHỈ trích những thuật ngữ thực sự xuất hiện trong đoạn văn (key là chữ Hán xuất hiện thật, value là bản Việt).
- Mỗi key CHỈ chứa chữ Hán — KHÔNG lẫn tiếng Việt, phiên âm, hay chữ số trong key.
- value là bản Việt tự nhiên: phiên âm Hán Việt cho tên nhân vật (vd "楚枫" → "Sở Phong"), dịch nghĩa cho thuật ngữ tu tiên (vd "筑基" → "Trúc Cơ", "金丹" → "Kim Đan").
- BỎ QUA các từ chung chung (thiên, địa, nhân, kiếm, đan...) — chỉ giữ các danh từ riêng / thuật ngữ chuyên ngành.
- Trả về JSON đúng schema. KHÔNG markdown, KHÔNG giải thích.
`;

function safeParseJson(raw: string): unknown {
  const s = raw.trim();
  // Empty or whitespace-only content → caller will fall back to source
  // (treat as "no structured response"). Throwing here would crash the
  // whole request on transient model hiccups; the caller has better
  // recovery logic via per-field fallback.
  if (!s) return null;
  let cleaned = s;
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  }
  // Direct parse first.
  try {
    return JSON.parse(cleaned);
  } catch {
    // Models that ignore `json_object` output mode sometimes wrap JSON in
    // prose. Find the first balanced `{...}` block and try again.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        // fall through
      }
    }
    return null;
  }
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v : ""))
    .filter((s) => s.length > 0);
}

interface GroqChatResponse {
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export class GroqTranslationProvider implements TranslationProvider {
  readonly id = "groq";
  readonly model: string;
  private readonly apiKey: string;

  constructor(model?: string, apiKey?: string) {
    const env = getEnv();
    this.model = model ?? env.TRANSLATION_MODEL;
    // `EnvSchema.refine` guarantees GROQ_API_KEY is set when
    // TRANSLATION_PROVIDER === 'groq', so reaching this constructor
    // via the factory implies the key is present. The explicit check
    // also catches direct callers passing TRANSLATION_PROVIDER unset.
    const resolved = apiKey ?? env.GROQ_API_KEY;
    if (!resolved) {
      throw new Error(
        "GROQ_API_KEY is required when TRANSLATION_PROVIDER=groq",
      );
    }
    this.apiKey = resolved;
  }

  async translate({
    paragraphs,
    title,
    glossary,
    signal,
  }: {
    paragraphs: readonly string[];
    title?: string;
    glossary?: Readonly<Record<string, string>>;
    signal?: AbortSignal;
  }): Promise<TranslationResult> {
    if (paragraphs.length === 0) {
      return { title: title ?? "", paragraphs: [] };
    }

    const body = JSON.stringify({
      title: title ?? "",
      paragraphs,
      glossary: glossary && Object.keys(glossary).length > 0 ? glossary : undefined,
    });
    const raw = await this.complete({
      system: SYSTEM_PROMPT,
      user: body,
      maxTokens: 8192,
      signal,
    });
    const parsed = (safeParseJson(raw) ?? {}) as {
      title?: unknown;
      paragraphs?: unknown;
    };

    const translatedTitle =
      typeof parsed.title === "string" && parsed.title.length > 0
        ? parsed.title
        : title ?? "";

    const translatedParagraphs = readStringArray(parsed.paragraphs);
    return {
      title: translatedTitle,
      paragraphs:
        translatedParagraphs.length === paragraphs.length
          ? translatedParagraphs
          : paragraphs.map((_, i) => translatedParagraphs[i] ?? ""),
    };
  }

  async translateNovelMeta(args: {
    title: string;
    description: string;
    author?: string;
    genre?: readonly string[];
    status?: string;
    signal?: AbortSignal;
  }): Promise<NovelMetaTranslation> {
    const hasAuthor = typeof args.author === "string" && args.author.trim().length > 0;
    const hasGenre = Array.isArray(args.genre) && args.genre.length > 0;
    const hasStatus = typeof args.status === "string" && args.status.trim().length > 0;

    const body = JSON.stringify({
      title: args.title,
      description: args.description,
      author: hasAuthor ? args.author : undefined,
      genre: hasGenre ? args.genre : undefined,
      status: hasStatus ? args.status : undefined,
    });
    const raw = await this.complete({
      system: META_SYSTEM_PROMPT,
      user: body,
      maxTokens: 4096,
      signal: args.signal,
    });
    const parsed = (safeParseJson(raw) ?? {}) as {
      titleVi?: unknown;
      descriptionVi?: unknown;
      authorVi?: unknown;
      genreVi?: unknown;
      statusVi?: unknown;
    };

    const fallback: NovelMetaTranslation = {
      titleVi: args.title,
      descriptionVi: args.description,
    };
    const out: NovelMetaTranslation = { ...fallback };

    if (typeof parsed.titleVi === "string" && parsed.titleVi.length > 0) {
      out.titleVi = parsed.titleVi;
    }
    if (typeof parsed.descriptionVi === "string" && parsed.descriptionVi.length > 0) {
      out.descriptionVi = parsed.descriptionVi;
    }
    if (hasAuthor) {
      out.authorVi =
        typeof parsed.authorVi === "string" && parsed.authorVi.length > 0
          ? parsed.authorVi
          : args.author!;
    }
    if (hasGenre) {
      const translated = readStringArray(parsed.genreVi);
      out.genreVi =
        translated.length === args.genre!.length
          ? translated
          : args.genre!.map((g) => g);
    }
    if (hasStatus) {
      out.statusVi =
        typeof parsed.statusVi === "string" && parsed.statusVi.length > 0
          ? parsed.statusVi
          : args.status!;
    }
    return out;
  }

  async translateChapterTitles(args: {
    titles: readonly string[];
    signal?: AbortSignal;
  }): Promise<string[]> {
    if (args.titles.length === 0) return [];
    const body = JSON.stringify({ titles: args.titles });
    const raw = await this.complete({
      system: META_SYSTEM_PROMPT,
      user: body,
      maxTokens: 8192,
      signal: args.signal,
    });
    const parsed = (safeParseJson(raw) ?? {}) as { titles?: unknown };
    const translated = readStringArray(parsed.titles);
    return args.titles.map((raw, i) => translated[i] ?? raw);
  }

  async extractGlossary(args: {
    paragraphs: readonly string[];
    existing?: Readonly<Record<string, string>>;
    signal?: AbortSignal;
  }): Promise<Record<string, string>> {
    if (args.paragraphs.length === 0) return { ...(args.existing ?? {}) };
    const body = JSON.stringify({
      paragraphs: args.paragraphs,
      existing: args.existing ?? {},
    });
    const raw = await this.complete({
      system: GLOSSARY_SYSTEM_PROMPT,
      user: body,
      maxTokens: 2048,
      signal: args.signal,
    });
    const parsed = (safeParseJson(raw) ?? {}) as { glossary?: unknown };
    const obj = parsed.glossary;
    if (!obj || typeof obj !== "object") {
      return { ...(args.existing ?? {}) };
    }
    const out: Record<string, string> = { ...(args.existing ?? {}) };
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof v === "string" && v.length > 0 && /[一-鿿]/.test(k)) {
        out[k] = v;
      }
    }
    return out;
  }

  /**
   * Issue a single OpenAI-compatible chat completion against Groq and
   * return the assistant content string.
   *
   * We deliberately do NOT set `response_format: json_object`. Some
   * OSS models on Groq (Qwen, GPT-OSS) intermittently emit empty
   * `{}` content under that mode, which the Groq endpoint rejects
   * upstream with `json_validate_failed`. The system prompts already
   * end with "Chỉ trả về JSON hợp lệ", and `safeParseJson` tolerates
   * prose-wrapped or empty output — robust enough to skip the strict
   * mode that triggers the upstream validation error.
   */
  private async complete(args: {
    system: string;
    user: string;
    maxTokens: number;
    signal?: AbortSignal;
  }): Promise<string> {
    const res = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.4,
        top_p: 0.9,
        max_tokens: args.maxTokens,
        messages: [
          { role: "system", content: args.system },
          { role: "user", content: args.user },
        ],
      }),
      signal: args.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let hint = "";
      if (res.status === 401) {
        hint =
          " — check GROQ_API_KEY (key is invalid/expired; verify at https://console.groq.com/keys)";
      } else if (res.status === 404) {
        hint = ` — model "${this.model}" not available on this account. ` +
          "Default \"openai/gpt-oss-120b\" works on every Groq tier; " +
          "Llama 3.x family is gated for many accounts. " +
          "Override via TRANSLATION_MODEL (see https://console.groq.com/docs/models).";
      }
      throw new Error(
        `Groq API ${res.status}${hint}: ${text.slice(0, 300) || res.statusText}`,
      );
    }
    const data = (await res.json()) as GroqChatResponse;
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Groq returned empty response");
    }
    return content;
  }
}
