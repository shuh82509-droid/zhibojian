import { loadFeishuAnchorTrends } from "../_lib/feishu-dashboard-fallback";
import { authError, requireLiveRoomAccess } from "../_lib/central-auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function chinaDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

function validDate(value: string | null) {
  return value && /^20\d{2}-\d{2}-\d{2}$/.test(value) ? value : chinaDate();
}

export async function GET(request: Request) {
  const auth = await requireLiveRoomAccess(request);
  if (!auth.ok) return authError(auth);
  const url = new URL(request.url);
  const endDate = validDate(url.searchParams.get("date"));
  const days = Number(url.searchParams.get("days") || 14);
  try {
    const data = await loadFeishuAnchorTrends(endDate, days, url.searchParams.get("refresh") === "1");
    return Response.json({ ok: true, data });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "主播趋势暂不可用" },
      { status: 503 },
    );
  }
}
