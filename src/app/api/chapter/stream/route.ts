/**
 * SSE stream for chapter translation jobs.
 *
 * Returns a `text/event-stream` response. The server polls the shared
 * CacheService job key on a tight loop and emits a single SSE message
 * (`event: status`, `data: {...}`) as soon as the job transitions out of
 * `processing`, then closes the stream. This replaces the client-side
 * `setTimeout(poll, 2000)` loop in `<ChapterContent>` so the reader
 * renders the moment the LLM completes — no 0–2s race-timing penalty.
 *
 * Backpressure: we still poll every ~500ms so a job that's already
 * completed when the client connects emits immediately on the first tick.
 *
 * Aborts: when the client closes the EventSource (navigation, retry
 * button, chapter change), Next propagates the request abort signal and
 * the loop exits.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { CacheService } from "@/infrastructure/storage/cache";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  jobId: z.string().min(1).max(128),
});

// Poll cadence — short enough that a job completing right after the
// client subscribes shows up within ~1 poll, long enough to keep the
// stream from hammering the cache backend.
const POLL_INTERVAL_MS = 500;

// Hard ceiling on stream lifetime. Translation jobs are expected to finish
// in well under a minute; if a job is still processing after this, the
// client should re-poll via the legacy `/api/chapter/status` endpoint.
const MAX_STREAM_MS = 5 * 60_000;

export async function GET(request: NextRequest) {
  const rl = await checkRateLimit(`jobsse:${getClientIp(request.headers)}`, {
    limit: 120,
    windowSeconds: 60,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests", resetSeconds: rl.resetSeconds },
      { status: 429 },
    );
  }

  const parsed = QuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Missing or invalid jobId" },
      { status: 400 },
    );
  }

  const jobId = parsed.data.jobId;
  const cache = new CacheService();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const startedAt = Date.now();
      const signal = request.signal;

      function emit(payload: unknown, event = "status") {
        const body =
          `event: ${event}\n` +
          `data: ${JSON.stringify(payload)}\n\n`;
        controller.enqueue(encoder.encode(body));
      }

      // Heartbeat so proxies + browsers don't kill an idle stream. Sent
      // before the first poll so the connection establishes immediately.
      emit({ status: "connected", jobId }, "open");

      try {
        while (Date.now() - startedAt < MAX_STREAM_MS) {
          if (signal.aborted) break;

          const job = await cache.getJob(jobId);
          if (!job) {
            emit({ status: "expired", error: "Job no longer exists or expired" });
            return;
          }

          if (job.status === "completed") {
            emit({ status: "completed", result: job.result });
            return;
          }
          if (job.status === "failed") {
            emit({
              status: "failed",
              error: job.error ?? "Unknown error",
            });
            return;
          }

          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, POLL_INTERVAL_MS);
            signal.addEventListener("abort", () => {
              clearTimeout(timer);
              resolve();
            });
          });
        }
        // Stream timed out without resolving — let the client fall back
        // to legacy polling.
        emit({ status: "timeout" });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable Nginx response buffering on hosts that proxy.
      "X-Accel-Buffering": "no",
    },
  });
}
