import { authError, requireLiveRoomAccess, sessionPayload } from "../_lib/central-auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireLiveRoomAccess(request);
  if (!auth.ok) return authError(auth);
  return Response.json(sessionPayload(auth), { headers: { "Cache-Control": "no-store" } });
}
