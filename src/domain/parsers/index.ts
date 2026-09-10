/**
 * Side-effect module: register all built-in parsers at import time.
 * Import this once at process boot (API routes) instead of in every request.
 */
import { ParserFactory } from "@/domain/parsers/website-parser";
import { ShuhaigeParser } from "@/domain/parsers/shuhaige-parser";
import { M51readParser } from "@/domain/parsers/m51read-parser";

ParserFactory.register(new ShuhaigeParser());
ParserFactory.register(new M51readParser());

export { ParserFactory };
export type { WebsiteParser } from "@/domain/parsers/website-parser";
