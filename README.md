# Trang đọc truyện Trung → Việt

Web app đọc truyện Trung Quốc, tự động crawl và dịch sang tiếng Việt bằng AI.

## Stack

- Next.js 15 (App Router) + TypeScript strict
- Tailwind CSS
- AI dịch (chọn qua `TRANSLATION_PROVIDER`): Gemini (`@google/generative-ai`), Groq, M3 / proxy Anthropic-Messages, hoặc Command Code CLI (`cmdc`)
- Vercel KV (cache + job state)
- cheerio (HTML parsing)

## Quick start

```bash
cp .env.example .env.local
# Edit .env.local — chọn TRANSLATION_PROVIDER và cấu hình tương ứng
npm install
npm run dev
```

Với `TRANSLATION_PROVIDER=cmdc`, server cần cài sẵn và đăng nhập Command Code CLI
(`cmdc`) — provider sẽ chạy `cmdc -p` headless để dịch, không cần API key.

App chạy tại http://localhost:3000.

## Architecture

```
src/
├── app/                  # Next.js routes (UI + API)
├── domain/               # Pure business logic
│   ├── entities/         # Novel, Chapter types
│   ├── parsers/          # Website adapters
│   ├── services/         # NovelService, TranslationService, etc.
│   └── url/              # URL resolution
├── infrastructure/       # External integrations
│   ├── http/             # Fetch + SSRF protection
│   ├── ai/               # Translation providers
│   └── storage/          # Cache, jobs
└── presentation/         # React components
```

## Commands

- `npm run dev` — local dev
- `npm run build` — production build
- `npm run typecheck` — TypeScript check
- `npm run lint` — ESLint
- `npm run test` — Vitest unit tests

## Adding a new website

1. Implement `WebsiteParser` interface in `src/domain/parsers/`
2. Register in `ParserFactory` (route by hostname)
3. Add image hostname to `next.config.mjs` `images.remotePatterns`

See `src/domain/parsers/shuhaige-parser.ts` for the reference implementation.
