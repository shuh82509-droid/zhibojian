import { loadBusinessOverview } from "../_lib/business-overview";
import { authError, requireLiveRoomAccess } from "../_lib/central-auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function chinaDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export async function GET(request: Request) {
  const auth = await requireLiveRoomAccess(request);
  if (!auth.ok) return authError(auth);
  try {
    const url = new URL(request.url);
    const raw = url.searchParams.get("date") || chinaDate();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : chinaDate();
    const value = await loadBusinessOverview(date, url.searchParams.get("refresh") === "1");
    return Response.json(value, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "直播经营总览读取失败" }, { status: 502 });
  }
}
