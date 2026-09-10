/**
 * CMDC (Command Code CLI) translation provider.
 *
 * Runs the `cmdc` CLI in headless print mode (`cmdc -p`) as a child
 * process: the prompt is piped over stdin, and the assistant's final
 * answer is read back from stdout (progress goes to stderr, which we
 * keep separate). No API endpoint or key is involved — the CLI reuses
 * whatever account it is already signed in with, so this provider only
 * works on a host that has `cmdc` installed and authenticated.
 *
 * Env:
 *   CMDC_BIN        — CLI executable (default "cmdc"; use an absolute
 *                     path when the server's PATH lacks it).
 *   CMDC_MODEL      — optional model id passed through as `-m`; the CLI's
 *                     configured default model is used when unset.
 *   CMDC_TIMEOUT_MS — per-call timeout (default 300000).
 *
 * Selection: `TRANSLATION_PROVIDER=cmdc`.
 */
import { spawn } from "node:child_process";
import { getEnv } from "@/lib/env";
import type {
  TranslationProvider,
  TranslationResult,
  NovelMetaTranslation,
} from "@/infrastructure/ai/translation-provider";

const DEFAULT_BIN = "cmdc";
const DEFAULT_TIMEOUT_MS = 300_000;
/** Cache-key stand-in when the CLI's own default model is in use. */
const DEFAULT_MODEL = "cmdc-default";

/**
 * Exit codes documented for headless mode, mapped to actionable hints.
 * Exit 4 is deliberately absent — it covers both "permission engine
 * denied" and `MODEL_NOT_IN_PLAN`, and the code alone can't tell them
 * apart, so that case is resolved from stderr in `describeExit`.
 */
const EXIT_HINTS: Readonly<Record<number, string>> = {
  3: "cmdc is not authenticated — run `cmdc` once and sign in",
  5: "rate limit exceeded",
  6: "network failure",
  7: "Command Code server error",
  8: "max turns reached before a final answer",
  9: "model produced no response",
  10: "insufficient credits",
};

/** Turn a non-zero exit into an actionable hint, preferring stderr's specifics. */
function describeExit(code: number | null, stderr: string): string {
  if (/MODEL_NOT_IN_PLAN/i.test(stderr)) {
    return (
      "the configured CMDC_MODEL is not included in this account's plan. " +
      "Pick one of the models allowed by the plan (see `cmdc --list-models`) " +
      "or run that model as extra on-demand usage"
    );
  }
  if (/unknown model/i.test(stderr)) {
    return "CMDC_MODEL is not a valid model id — list them with `cmdc --list-models`";
  }
  return code !== null ? EXIT_HINTS[code] ?? "" : "";
}

/**
 * Prepended to every prompt. The CLI runs a coding agent by default, so
 * without this it may reach for file/bash tools instead of answering.
 */
const HARNESS_PREAMBLE = `
Bạn đang được gọi như một hàm dịch thuật không tương tác, KHÔNG phải một trợ lý coding.
- TUYỆT ĐỐI KHÔNG sử dụng bất kỳ tool nào (không đọc file, không chạy lệnh, không tìm kiếm).
- Chỉ in ra đúng kết quả cuối cùng theo yêu cầu bên dưới.
`.trim();

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

/** Short system prompt for batch title / metadata translation. */
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

/**
 * Output schemas are pinned in the prompt (not just described) because
 * this provider has no equivalent of Gemini's `responseSchema` — the model
 * must know the exact key names it is expected to emit.
 */
const META_SCHEMA_PROMPT = `
## OUTPUT SCHEMA (bắt buộc, dùng đúng tên key)
{
  "titleVi": "tiêu đề truyện đã dịch",
  "descriptionVi": "mô tả truyện đã dịch",
  "authorVi": "tên tác giả (chỉ khi input có author)",
  "genreVi": ["thể loại 1", "thể loại 2"],
  "statusVi": "trạng thái (chỉ khi input có status)"
}
`;

const TITLES_SCHEMA_PROMPT = `
## OUTPUT SCHEMA (bắt buộc, dùng đúng tên key)
{
  "titles": ["tiêu đề thứ nhất đã dịch", "tiêu đề thứ hai đã dịch"]
}
Mảng "titles" phải có ĐÚNG số phần tử và ĐÚNG thứ tự như input.
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

## OUTPUT SCHEMA (bắt buộc)
{
  "glossary": { "楚枫": "Sở Phong", "筑基": "Trúc Cơ" }
}
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

/** System prompt + harness notice + JSON body, as one CLI prompt. */
function buildPrompt(system: string, user: string): string {
  return [HARNESS_PREAMBLE, "", system.trim(), "", "## INPUT (JSON)", user].join(
    "\n",
  );
}

export class CmdcTranslationProvider implements TranslationProvider {
  readonly id = "cmdc";
  readonly model: string;
  private readonly bin: string;
  private readonly timeoutMs: number;
  private readonly modelFlag: string | undefined;

  constructor(opts?: { model?: string; bin?: string; timeoutMs?: number }) {
    const env = getEnv();
    this.bin = opts?.bin ?? env.CMDC_BIN;
    this.modelFlag = opts?.model ?? env.CMDC_MODEL;
    this.model = this.modelFlag ?? DEFAULT_MODEL;
    this.timeoutMs = opts?.timeoutMs ?? env.CMDC_TIMEOUT_MS;
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
    const raw = await this.runCli(buildPrompt(SYSTEM_PROMPT, body), signal);
    const parsed = (safeParseJson(raw) ?? {}) as {
      title?: unknown;
      paragraphs?: unknown;
    };
    const translatedTitle =
      pickString(parsed.title) ?? title ?? "";
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
    const raw = await this.runCli(
      buildPrompt(`${META_SYSTEM_PROMPT}\n${META_SCHEMA_PROMPT}`, body),
      args.signal,
    );
    const parsed = (safeParseJson(raw) ?? {}) as {
      titleVi?: unknown;
      descriptionVi?: unknown;
      authorVi?: unknown;
      genreVi?: unknown;
      statusVi?: unknown;
    };

    // The schema asks for `*Vi` keys, but models occasionally echo the
    // input key names instead — accept those as aliases so the
    // translation isn't dropped on the floor.
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

    const out: NovelMetaTranslation = {
      titleVi: titleVi ?? args.title,
      descriptionVi: descriptionVi ?? args.description,
    };
    if (hasAuthor) {
      out.authorVi = authorVi ?? args.author!;
    }
    if (hasGenre) {
      const translated = readStringArray(genreViRaw);
      out.genreVi =
        translated.length === args.genre!.length
          ? translated
          : args.genre!.map((g) => g);
    }
    if (hasStatus) {
      out.statusVi = statusVi ?? args.status!;
    }
    return out;
  }

  async translateChapterTitles(args: {
    titles: readonly string[];
    signal?: AbortSignal;
  }): Promise<string[]> {
    if (args.titles.length === 0) return [];
    const body = JSON.stringify({ titles: args.titles });
    const raw = await this.runCli(
      buildPrompt(`${META_SYSTEM_PROMPT}\n${TITLES_SCHEMA_PROMPT}`, body),
      args.signal,
    );
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
    const raw = await this.runCli(
      buildPrompt(GLOSSARY_SYSTEM_PROMPT, body),
      args.signal,
    );
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
   * Run `cmdc -p --skip-onboarding` with `prompt` on stdin and resolve with
   * the trimmed stdout. stderr is captured only for error messages, since
   * the CLI writes progress noise there.
   */
  private runCli(prompt: string, signal?: AbortSignal): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const args = ["-p", "--skip-onboarding"];
      if (this.modelFlag) args.push("-m", this.modelFlag);

      const child = spawn(this.bin, args, {
        stdio: ["pipe", "pipe", "pipe"],
        signal,
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      const timer = setTimeout(() => {
        finish(() => {
          child.kill("SIGKILL");
          reject(
            new Error(`cmdc timed out after ${this.timeoutMs}ms (CMDC_TIMEOUT_MS)`),
          );
        });
      }, this.timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      child.on("error", (err: Error) => {
        finish(() =>
          reject(
            new Error(
              `could not run "${this.bin}": ${err.message}. ` +
                "Install the Command Code CLI or set CMDC_BIN to its path.",
            ),
          ),
        );
      });

      child.on("close", (code, signalName) => {
        finish(() => {
          if (code === 0) {
            const text = stdout.trim();
            if (!text) {
              reject(new Error("cmdc returned an empty response"));
              return;
            }
            resolve(text);
            return;
          }
          const trimmed = stderr.trim();
          const hint = describeExit(code, trimmed);
          reject(
            new Error(
              `cmdc exited with ${code ?? signalName}` +
                `${hint ? ` — ${hint}` : ""}: ` +
                `${trimmed.slice(0, 300) || "(no stderr)"}`,
            ),
          );
        });
      });

      // The CLI can close stdin early (e.g. bad flags); don't let the
      // resulting EPIPE surface as an unhandled stream error.
      child.stdin?.on("error", () => {});
      child.stdin?.end(prompt, "utf8");
    });
  }
}
