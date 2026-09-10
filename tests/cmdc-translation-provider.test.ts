import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { CmdcTranslationProvider } from "@/infrastructure/ai/cmdc-translation-provider";

interface FakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: EventEmitter & { end: (chunk?: string, enc?: string) => void };
  kill: () => void;
}

let lastPrompt = "";

function fakeChild(opts: {
  stdout?: string;
  stderr?: string;
  code?: number | null;
  signal?: string | null;
}): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const stdin = new EventEmitter() as FakeChild["stdin"];
  stdin.end = (chunk?: string) => {
    lastPrompt = chunk ?? "";
  };
  child.stdin = stdin;
  child.kill = vi.fn();
  // Emit after the provider has attached its listeners.
  setImmediate(() => {
    if (opts.stdout) child.stdout.emit("data", Buffer.from(opts.stdout));
    if (opts.stderr) child.stderr.emit("data", Buffer.from(opts.stderr));
    child.emit("close", opts.code ?? 0, opts.signal ?? null);
  });
  return child;
}

describe("CmdcTranslationProvider", () => {
  beforeEach(() => {
    process.env.TRANSLATION_PROVIDER = "cmdc";
    lastPrompt = "";
    spawnMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs the CLI headlessly and parses the translated JSON", async () => {
    spawnMock.mockReturnValue(
      fakeChild({
        stdout: JSON.stringify({
          title: "Chương 1",
          paragraphs: ["Đoạn một.", "Đoạn hai."],
        }),
      }),
    );

    const provider = new CmdcTranslationProvider();
    const result = await provider.translate({
      title: "第一章",
      paragraphs: ["第一段。", "第二段。"],
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "cmdc",
      ["-p", "--skip-onboarding"],
      expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }),
    );
    expect(lastPrompt).toContain("第一段。");
    expect(result).toEqual({
      title: "Chương 1",
      paragraphs: ["Đoạn một.", "Đoạn hai."],
    });
  });

  it("passes the configured model through as -m", async () => {
    spawnMock.mockReturnValue(fakeChild({ stdout: '{"title":"","paragraphs":["a"]}' }));

    const provider = new CmdcTranslationProvider({ model: "claude-sonnet-4-6" });
    await provider.translate({ paragraphs: ["x"] });

    expect(spawnMock).toHaveBeenCalledWith(
      "cmdc",
      ["-p", "--skip-onboarding", "-m", "claude-sonnet-4-6"],
      expect.anything(),
    );
    expect(provider.model).toBe("claude-sonnet-4-6");
  });

  it("pads missing paragraphs instead of failing the whole chunk", async () => {
    spawnMock.mockReturnValue(
      fakeChild({ stdout: '{"title":"T","paragraphs":["chỉ một"]}' }),
    );

    const provider = new CmdcTranslationProvider();
    const result = await provider.translate({ paragraphs: ["a", "b", "c"] });

    expect(result.paragraphs).toEqual(["chỉ một", "", ""]);
  });

  it("surfaces a non-zero exit with an actionable hint", async () => {
    spawnMock.mockReturnValue(fakeChild({ code: 3, stderr: "not logged in" }));

    const provider = new CmdcTranslationProvider();
    await expect(provider.translate({ paragraphs: ["x"] })).rejects.toThrow(
      /cmdc exited with 3 — cmdc is not authenticated/,
    );
  });

  it("explains a plan-restricted model on exit 4", async () => {
    spawnMock.mockReturnValue(
      fakeChild({
        code: 4,
        stderr:
          'Error: 403 MODEL_NOT_IN_PLAN: Gemini 3.6 Flash available in Pro and above plans',
      }),
    );

    const provider = new CmdcTranslationProvider({ model: "google/gemini-3.6-flash" });
    await expect(provider.translate({ paragraphs: ["x"] })).rejects.toThrow(
      /not included in this account's plan/,
    );
  });

  it("explains an unknown model id", async () => {
    spawnMock.mockReturnValue(
      fakeChild({
        code: 1,
        stderr: 'Error: unknown model "nope".\nRun "cmd --list-models"',
      }),
    );

    const provider = new CmdcTranslationProvider();
    await expect(provider.translate({ paragraphs: ["x"] })).rejects.toThrow(
      /not a valid model id/,
    );
  });

  it("rejects an empty response", async () => {
    spawnMock.mockReturnValue(fakeChild({ stdout: "   " }));

    const provider = new CmdcTranslationProvider();
    await expect(provider.translate({ paragraphs: ["x"] })).rejects.toThrow(
      /empty response/,
    );
  });

  it("keeps only Han-keyed glossary entries", async () => {
    spawnMock.mockReturnValue(
      fakeChild({
        stdout: JSON.stringify({
          glossary: { "楚枫": "Sở Phong", hello: "không hợp lệ", "筑基": "Trúc Cơ" },
        }),
      }),
    );

    const provider = new CmdcTranslationProvider();
    const glossary = await provider.extractGlossary({ paragraphs: ["楚枫筑基"] });

    expect(glossary).toEqual({ "楚枫": "Sở Phong", "筑基": "Trúc Cơ" });
  });

  it("maps chapter titles positionally and falls back to the raw title", async () => {
    spawnMock.mockReturnValue(
      fakeChild({ stdout: JSON.stringify({ titles: ["Chương một"] }) }),
    );

    const provider = new CmdcTranslationProvider();
    const titles = await provider.translateChapterTitles({
      titles: ["第一章", "第二章"],
    });

    expect(titles).toEqual(["Chương một", "第二章"]);
  });
});
