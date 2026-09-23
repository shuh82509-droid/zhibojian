import { downloadMessageImage } from "../_lib/coco";
import { authError, requireLiveRoomAccess } from "../_lib/central-auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireLiveRoomAccess(request);
  if (!auth.ok) return authError(auth);
  const url = new URL(request.url);
  try {
    const response = await downloadMessageImage(url.searchParams.get("messageId") ?? "", url.searchParams.get("fileKey") ?? "");
    return new Response(response.body, {
      headers: {
        "Content-Type": response.headers.get("Content-Type") ?? "image/jpeg",
        "Cache-Control": "private, max-age=900",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load visual" }, { status: 404 });
  }
}
