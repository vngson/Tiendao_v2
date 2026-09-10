import { describe, expect, it } from "vitest";
import {
  InvalidNovelUrlError,
  isSupportedHostname,
  resolveNovelUrl,
} from "@/domain/url/novel-url-resolver";

describe("resolveNovelUrl", () => {
  it("extracts novel info from a chapter URL", () => {
    const result = resolveNovelUrl(
      "https://m.shuhaige.net/386531/132855416.html",
    );
    expect(result).toMatchObject({
      origin: "https://m.shuhaige.net",
      novelId: "386531",
      novelUrl: "https://m.shuhaige.net/386531/",
      kind: "chapter",
      originalUrl: "https://m.shuhaige.net/386531/132855416.html",
    });
  });

  it("extracts novel info from a novel-page URL", () => {
    const result = resolveNovelUrl("https://m.shuhaige.net/386531/");
    expect(result).toMatchObject({
      novelId: "386531",
      kind: "novel-page",
      novelUrl: "https://m.shuhaige.net/386531/",
    });
  });

  it("handles paginated chapter-list URLs", () => {
    const result = resolveNovelUrl("https://m.shuhaige.net/386531_2/");
    expect(result.novelId).toBe("386531");
    expect(result.novelUrl).toBe("https://m.shuhaige.net/386531/");
  });

  it("rejects unsupported protocols", () => {
    expect(() => resolveNovelUrl("ftp://m.shuhaige.net/386531/")).toThrow(
      InvalidNovelUrlError,
    );
  });

  it("rejects unknown hostnames", () => {
    expect(() => resolveNovelUrl("https://example.com/386531/")).toThrow(
      InvalidNovelUrlError,
    );
  });

  it("rejects garbage input", () => {
    expect(() => resolveNovelUrl("not a url")).toThrow(InvalidNovelUrlError);
  });
});

describe("isSupportedHostname", () => {
  it("returns true for known hostnames", () => {
    expect(isSupportedHostname("m.shuhaige.net")).toBe(true);
  });

  it("returns false for unknown hostnames", () => {
    expect(isSupportedHostname("malicious.example.com")).toBe(false);
  });
});
