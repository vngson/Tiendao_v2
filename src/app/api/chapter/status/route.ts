import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { CacheService } from "@/infrastructure/storage/cache";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  jobId: z.string().min(1).max(128),
});

export async function GET(request: NextRequest) {
  const rl = await checkRateLimit(`jobstatus:${getClientIp(request.headers)}`, {
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
    return NextResponse.json({ error: "Missing or invalid jobId" }, { status: 400 });
  }

  const cache = new CacheService();
  const job = await cache.getJob(parsed.data.jobId);
  if (!job) {
    return NextResponse.json(
      { status: "expired", error: "Job no longer exists or expired" },
      { status: 410 },
    );
  }

  if (job.status === "completed") {
    return NextResponse.json({ status: "completed", result: job.result });
  }
  if (job.status === "failed") {
    return NextResponse.json(
      { status: "failed", error: job.error ?? "Unknown error" },
      { status: 500 },
    );
  }
  return NextResponse.json({ status: "processing" });
}
