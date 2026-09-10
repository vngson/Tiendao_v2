/**
 * Google Gemini translation provider.
 *
 * Uses structured JSON output to guarantee one-to-one paragraph alignment.
 * Falls back gracefully when the model returns fenced code blocks around
 * the JSON (Gemini sometimes wraps JSON in ```json fences).
 */
import { GoogleGenerativeAI, type GenerationConfig } from "@google/generative-ai";
import { getEnv } from "@/lib/env";
import type {
  TranslationProvider,
  TranslationResult,
  NovelMetaTranslation,
} from "@/infrastructure/ai/translation-provider";

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
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    paragraphs: { type: "array", items: { type: "string" } },
  },
  required: ["title", "paragraphs"],
} as const;

const META_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    titleVi: { type: "string" },
    descriptionVi: { type: "string" },
    authorVi: { type: "string" },
    genreVi: { type: "array", items: { type: "string" } },
    statusVi: { type: "string" },
  },
  required: ["titleVi", "descriptionVi"],
} as const;

const CHAPTER_TITLES_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    titles: { type: "array", items: { type: "string" } },
  },
  required: ["titles"],
} as const;

const GLOSSARY_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    glossary: {
      type: "object",
      // Open-ended schema — keys/values are arbitrary Chinese → Vietnamese
      // strings. Gemini will accept any property names as long as both
      // sides are strings.
      additionalProperties: { type: "string" },
    },
  },
  required: ["glossary"],
} as const;

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
  // Strip leading/trailing whitespace and code fences.
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  }
  try {
    return JSON.parse(s);
  } catch {
    // Best effort: try to locate the first {...} block.
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(s.slice(start, end + 1));
    }
    throw new Error("Provider returned non-JSON output");
  }
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v : ""))
    .filter((s) => s.length > 0);
}

export class GeminiTranslationProvider implements TranslationProvider {
  readonly id = "gemini";
  readonly model: string;

  private readonly client: GoogleGenerativeAI;

  constructor(model?: string) {
    const env = getEnv();
    this.model = model ?? env.TRANSLATION_MODEL;
    // `EnvSchema.refine` guarantees GEMINI_API_KEY is set when
    // TRANSLATION_PROVIDER === 'gemini', so reaching this constructor
    // with the provider pinned to gemini implies the key is present.
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "GEMINI_API_KEY is required when TRANSLATION_PROVIDER=gemini",
      );
    }
    this.client = new GoogleGenerativeAI(apiKey);
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
    const generationConfig: GenerationConfig = {
      temperature: 0.4,
      topP: 0.9,
      responseMimeType: "application/json",
      // Some Gemini models accept `responseSchema`; on others it's ignored.
      responseSchema: RESPONSE_SCHEMA as unknown as GenerationConfig["responseSchema"],
      maxOutputTokens: 8192,
      // Gemini 3.x defaults to "thinking" which burns tokens before answering.
      // Cap it at a small budget so translation stays fast and cheap.
      // Gemini 3 rejects thinkingBudget: 0, so use 128 (minimum meaningful).
      // The SDK type doesn't include this field yet, so cast through unknown.
      ...({ thinkingConfig: { thinkingBudget: 128 } } as unknown as GenerationConfig),
    };

    const model = this.client.getGenerativeModel({
      model: this.model,
      systemInstruction: SYSTEM_PROMPT,
      generationConfig,
    });

    const result = await model.generateContent(
      {
        contents: [{ role: "user", parts: [{ text: body }] }],
      },
      { signal } as never,
    );

    const raw = result.response.text();
    const parsed = safeParseJson(raw) as {
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
      usage: result.response.usageMetadata
        ? {
            inputTokens: result.response.usageMetadata.promptTokenCount,
            outputTokens: result.response.usageMetadata.candidatesTokenCount,
          }
        : undefined,
    };
  }

  /**
   * Translate novel-level metadata (title + description + author + genre +
   * status) into Vietnamese.
   *
   * Used to populate `Novel.titleVi` / `Novel.descriptionVi` / `authorVi` /
   * `genreVi` / `statusVi`. The caller is expected to cache the result so
   * subsequent loads skip the network round-trip. When the optional fields
   * (`author`, `genre`, `status`) are absent or empty, the call returns the
   * raw values echoed back without spending LLM tokens on them.
   */
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
    const generationConfig: GenerationConfig = {
      temperature: 0.4,
      topP: 0.9,
      responseMimeType: "application/json",
      responseSchema: META_RESPONSE_SCHEMA as unknown as GenerationConfig["responseSchema"],
      maxOutputTokens: 4096,
      ...({ thinkingConfig: { thinkingBudget: 128 } } as unknown as GenerationConfig),
    };

    const model = this.client.getGenerativeModel({
      model: this.model,
      systemInstruction: META_SYSTEM_PROMPT,
      generationConfig,
    });

    const result = await model.generateContent(
      { contents: [{ role: "user", parts: [{ text: body }] }] },
      { signal: args.signal } as never,
    );

    const parsed = safeParseJson(result.response.text()) as {
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

  /**
   * Translate a batch of chapter titles into Vietnamese.
   *
   * Returns an array the same length as `titles`; missing/extra entries fall
   * back to the raw title. The caller is expected to cache the result so
   * subsequent loads of the same chapter-list page skip the network round-trip.
   */
  async translateChapterTitles(args: {
    titles: readonly string[];
    signal?: AbortSignal;
  }): Promise<string[]> {
    if (args.titles.length === 0) return [];

    const body = JSON.stringify({ titles: args.titles });
    const generationConfig: GenerationConfig = {
      temperature: 0.4,
      topP: 0.9,
      responseMimeType: "application/json",
      responseSchema: CHAPTER_TITLES_RESPONSE_SCHEMA as unknown as GenerationConfig["responseSchema"],
      maxOutputTokens: 8192,
      ...({ thinkingConfig: { thinkingBudget: 128 } } as unknown as GenerationConfig),
    };

    const model = this.client.getGenerativeModel({
      model: this.model,
      systemInstruction: META_SYSTEM_PROMPT,
      generationConfig,
    });

    const result = await model.generateContent(
      { contents: [{ role: "user", parts: [{ text: body }] }] },
      { signal: args.signal } as never,
    );

    const parsed = safeParseJson(result.response.text()) as {
      titles?: unknown;
    };
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
    const generationConfig: GenerationConfig = {
      temperature: 0.2,
      topP: 0.8,
      responseMimeType: "application/json",
      responseSchema: GLOSSARY_RESPONSE_SCHEMA as unknown as GenerationConfig["responseSchema"],
      maxOutputTokens: 2048,
      // Glossary extraction is purely mechanical; skip the thinking budget.
      ...({ thinkingConfig: { thinkingBudget: 128 } } as unknown as GenerationConfig),
    };

    const model = this.client.getGenerativeModel({
      model: this.model,
      systemInstruction: GLOSSARY_SYSTEM_PROMPT,
      generationConfig,
    });

    const result = await model.generateContent(
      { contents: [{ role: "user", parts: [{ text: body }] }] },
      { signal: args.signal } as never,
    );

    const parsed = safeParseJson(result.response.text()) as {
      glossary?: unknown;
    };
    const raw = parsed.glossary;
    if (!raw || typeof raw !== "object") {
      return { ...(args.existing ?? {}) };
    }
    const out: Record<string, string> = { ...(args.existing ?? {}) };
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "string" && v.length > 0 && /[一-鿿]/.test(k)) {
        out[k] = v;
      }
    }
    return out;
  }
}
