/**
 * M3 (localhost Anthropic-style) translation provider.
 *
 * Posts to the Anthropic Messages API at
 * `{M3_API_BASE}/v1/messages`. This is the same shape Claude Code / the
 * Anthropic SDK use, so any local Anthropic-compatible proxy works (e.g.
 * one pointed at `ANTHROPIC_BASE_URL` for `claude` CLI on this host).
 *
 * Required env:
 *   M3_API_BASE   — e.g. http://localhost:8080 or https://api.example.com
 *   M3_API_KEY    — sent as `x-api-key` (NOT `Authorization: Bearer`).
 *                   Same value as `ANTHROPIC_AUTH_TOKEN`.
 *   M3_MODEL      — model identifier (defaults to MiniMax-M3-Nhom06).
 *
 * Selection: `TRANSLATION_PROVIDER=m3`.
 */
import { getEnv } from "@/lib/env";
import type {
  TranslationProvider,
  TranslationResult,
  NovelMetaTranslation,
} from "@/infrastructure/ai/translation-provider";

const DEFAULT_MODEL = "MiniMax-M3-Nhom06";
const DEFAULT_API_BASE = "http://localhost:8080";
const ANTHROPIC_VERSION = "2023-06-01";

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

const META_SYSTEM_PROMPT = `
Bạn là dịch giả tiểu thuyết Trung Quốc (thể loại tu tiên, tiên hiệp, huyền huyễn, kiếm hiệp, dị giới) sang tiếng Việt.

Yêu cầu:
- Dịch tự nhiên, đúng văn phong tiên hiệp / tu tiên.
- Giữ nhất quán tên nhân vật, địa danh, môn phái, công pháp.
- KHÔNG tóm tắt, KHÔNG thêm nội dung ngoài bản dịch, KHÔNG dùng markdown.
- Với chương: chỉ dịch phần tiêu đề, giữ format "Chương X" nếu có.
- Với thể loại tiếng Việt, KHÔNG phiên âm Hán Việt nguyên xi — hãy dịch theo nghĩa.
- Với tên tác giả: phiên âm Hán Việt tự nhiên hoặc giữ nguyên nếu đã phổ biến.
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
  if (!s) return null;
  let cleaned = s;
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  }
  try {
    return JSON.parse(cleaned);
  } catch {
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

function pickString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

interface AnthropicMessagesResponse {
  id?: string;
  type?: string;
  role?: string;
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

interface M3Env {
  M3_API_BASE: string | undefined;
  M3_API_KEY: string | undefined;
  M3_MODEL: string | undefined;
}

function readM3Env(): M3Env {
  const env = getEnv() as unknown as M3Env & Record<string, string | undefined>;
  return {
    M3_API_BASE: env.M3_API_BASE,
    M3_API_KEY: env.M3_API_KEY,
    M3_MODEL: env.M3_MODEL,
  };
}

export class M3TranslationProvider implements TranslationProvider {
  readonly id = "m3";
  readonly model: string;
  private readonly endpoint: string;
  private readonly apiKey: string;

  constructor(opts?: { model?: string; apiBase?: string; apiKey?: string }) {
    const env = readM3Env();
    this.model = opts?.model ?? env.M3_MODEL ?? DEFAULT_MODEL;
    const base = (opts?.apiBase ?? env.M3_API_BASE ?? DEFAULT_API_BASE).replace(
      /\/+$/,
      "",
    );
    // Anthropic Messages path — never OpenAI's /v1/chat/completions.
    this.endpoint = `${base}/v1/messages`;
    this.apiKey = opts?.apiKey ?? env.M3_API_KEY ?? "";
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
    // eslint-disable-next-line no-console
    console.log(
      `[m3-meta raw+${raw.length}B] ${raw.slice(0, 600)}${raw.length > 600 ? "…(truncated)" : ""}`,
    );
    const parsed = (safeParseJson(raw) ?? {}) as {
      titleVi?: unknown;
      descriptionVi?: unknown;
      authorVi?: unknown;
      genreVi?: unknown;
      statusVi?: unknown;
    };
    // eslint-disable-next-line no-console
    console.log(
      `[m3-meta parsed] keys=${Object.keys(parsed).join(",")} title=${JSON.stringify((parsed as { titleVi?: unknown }).titleVi)?.slice(0, 120)}`,
    );

    // M3 returns VI translations under the same key names as the input
    // (`title`, `description`, …) instead of the `*Vi` suffix. Treat the
    // un-suffixed keys as an alias so the translation isn't dropped on
    // the floor.
    const titleVi =
      pickString(parsed.titleVi) ?? pickString((parsed as { title?: unknown }).title);
    const descriptionVi =
      pickString(parsed.descriptionVi) ??
      pickString((parsed as { description?: unknown }).description);
    const authorVi =
      pickString(parsed.authorVi) ?? pickString((parsed as { author?: unknown }).author);
    const genreViRaw =
      (Array.isArray(parsed.genreVi) ? parsed.genreVi : null) ??
      (Array.isArray((parsed as { genre?: unknown }).genre)
        ? ((parsed as { genre?: unknown }).genre as unknown)
        : null);
    const statusVi =
      pickString(parsed.statusVi) ?? pickString((parsed as { status?: unknown }).status);

    const fallback: NovelMetaTranslation = {
      titleVi: args.title,
      descriptionVi: args.description,
    };
    const out: NovelMetaTranslation = { ...fallback };

    if (titleVi && titleVi.length > 0) {
      out.titleVi = titleVi;
    }
    if (descriptionVi && descriptionVi.length > 0) {
      out.descriptionVi = descriptionVi;
    }
    if (hasAuthor) {
      out.authorVi = authorVi && authorVi.length > 0 ? authorVi : args.author!;
    }
    if (hasGenre) {
      const translated = readStringArray(genreViRaw);
      out.genreVi =
        translated.length === args.genre!.length
          ? translated
          : args.genre!.map((g) => g);
    }
    if (hasStatus) {
      out.statusVi = statusVi && statusVi.length > 0 ? statusVi : args.status!;
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
   * Send one Anthropic Messages request and return the assistant text.
   *
   * Body: { model, system, messages: [{role:"user", content: text}], max_tokens }.
   * Headers: `x-api-key` + `anthropic-version: 2023-06-01` (Anthropic SDK
   * standard). `temperature` is omitted — the server's defaults are fine
   * for translation and explicit values vary across model deployments.
   *
   * Response: { content: [{ type: "text", text: "..." }, ...] }. Multi-block
   * responses get concatenated.
   */
  private async complete(args: {
    system: string;
    user: string;
    maxTokens: number;
    signal?: AbortSignal;
  }): Promise<string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": ANTHROPIC_VERSION,
    };
    if (this.apiKey) headers["x-api-key"] = this.apiKey;

    const res = await fetch(this.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.model,
        system: args.system,
        messages: [{ role: "user", content: args.user }],
        max_tokens: args.maxTokens,
      }),
      signal: args.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let hint = "";
      if (res.status === 401) {
        hint = " — check M3_API_KEY (= ANTHROPIC_AUTH_TOKEN). Backend rejected x-api-key.";
      } else if (res.status === 404) {
        hint = ` — ${this.endpoint} not found. Confirm M3_API_BASE (== ANTHROPIC_BASE_URL) and that backend exposes /v1/messages. Model: "${this.model}".`;
      } else if (res.status === 529 || res.status === 503 || res.status === 502) {
        hint = ` — backend overloaded / unavailable at ${this.endpoint}.`;
      } else if (res.status === 0) {
        hint = ` — could not reach ${this.endpoint}. Is the backend running?`;
      }
      throw new Error(
        `M3 API ${res.status}${hint}: ${text.slice(0, 300) || res.statusText}`,
      );
    }
    const data = (await res.json()) as AnthropicMessagesResponse;
    const blocks = Array.isArray(data.content) ? data.content : [];
    const text = blocks
      .filter((b) => b && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("");
    if (!text) {
      throw new Error(
        `M3 returned empty response (stop_reason=${data.stop_reason ?? "unknown"})`,
      );
    }
    return text;
  }
}
