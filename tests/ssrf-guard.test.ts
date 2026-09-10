import { describe, expect, it } from "vitest";
import { SsrfBlockedError, validatePublicUrl } from "@/lib/ssrf-guard";

describe("validatePublicUrl", () => {
  it("accepts public https URLs", () => {
    const url = validatePublicUrl("https://m.shuhaige.net/386531/");
    expect(url.hostname).toBe("m.shuhaige.net");
  });

  it("blocks localhost", () => {
    expect(() => validatePublicUrl("http://localhost/x")).toThrow(SsrfBlockedError);
    expect(() => validatePublicUrl("http://localhost.localdomain/x")).toThrow(
      SsrfBlockedError,
    );
  });

  it("blocks private IPv4 literals", () => {
    expect(() => validatePublicUrl("http://127.0.0.1/x")).toThrow(SsrfBlockedError);
    expect(() => validatePublicUrl("http://10.0.0.1/x")).toThrow(SsrfBlockedError);
    expect(() => validatePublicUrl("http://192.168.1.1/x")).toThrow(SsrfBlockedError);
    expect(() => validatePublicUrl("http://169.254.169.254/latest/meta-data/")).toThrow(
      SsrfBlockedError,
    );
  });

  it("blocks IPv6 loopback and link-local", () => {
    expect(() => validatePublicUrl("http://[::1]/x")).toThrow(SsrfBlockedError);
    expect(() => validatePublicUrl("http://[fe80::1]/x")).toThrow(SsrfBlockedError);
  });

  it("blocks link-local hostnames", () => {
    expect(() => validatePublicUrl("http://server.local/x")).toThrow(SsrfBlockedError);
    expect(() => validatePublicUrl("http://printer.lan/x")).toThrow(SsrfBlockedError);
    expect(() => validatePublicUrl("http://foo.corp/x")).toThrow(SsrfBlockedError);
  });

  it("blocks cloud metadata paths even on public hosts", () => {
    expect(() =>
      validatePublicUrl("https://example.com/latest/meta-data/"),
    ).toThrow(SsrfBlockedError);
    expect(() =>
      validatePublicUrl("https://example.com/computeMetadata/v1/"),
    ).toThrow(SsrfBlockedError);
  });

  it("blocks non-http(s) protocols", () => {
    expect(() => validatePublicUrl("ftp://example.com/x")).toThrow(SsrfBlockedError);
    expect(() => validatePublicUrl("file:///etc/passwd")).toThrow(SsrfBlockedError);
    expect(() => validatePublicUrl("javascript:alert(1)")).toThrow(SsrfBlockedError);
  });

  it("rejects garbage input", () => {
    expect(() => validatePublicUrl("not a url")).toThrow(SsrfBlockedError);
  });
});
