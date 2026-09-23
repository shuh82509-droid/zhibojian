const CENTRAL_AUTHORITY_BASE = String(
  process.env.CENTRAL_AUTHORITY_BASE || "https://app.fandow.top/fd-026222/wis-video-center/api",
).replace(/\/+$/u, "");
const CENTRAL_AUTHORITY_FALLBACK_BASE = String(
  process.env.CENTRAL_AUTHORITY_FALLBACK_BASE || "",
).replace(/\/+$/u, "");
const REQUIRED_MODULE = "live-room-management";

type PermissionSet = {
  super_admin?: boolean;
  operation_admin?: boolean;
  manage_permissions?: boolean;
};

type CentralUser = { realName?: string; name?: string };

export type CentralAuth = {
  ok: boolean;
  status: number;
  detail?: string;
  mode?: "internal" | "central";
  user?: CentralUser;
  permissions?: PermissionSet;
};

function directInternalRequest(request: Request) {
  return !request.headers.get("x-forwarded-for") && !request.headers.get("x-real-ip");
}

function authorityHeaders(request: Request) {
  const headers = new Headers({ Accept: "application/json" });
  const cookie = request.headers.get("cookie");
  const oaToken = request.headers.get("x-oa-token");
  if (cookie) headers.set("Cookie", cookie);
  if (oaToken) headers.set("X-OA-Token", oaToken);
  return headers;
}

async function fetchCentralAuthority(request: Request) {
  const bases = [...new Set([CENTRAL_AUTHORITY_BASE, CENTRAL_AUTHORITY_FALLBACK_BASE].filter(Boolean))];
  let lastResponse: Response | undefined;
  let lastError: unknown;
  for (const base of bases) {
    try {
      const response = await fetch(`${base}/central-auth/me`, {
        headers: authorityHeaders(request), redirect: "manual", signal: AbortSignal.timeout(15_000),
      });
      if (response.status < 500) return response;
      lastResponse = response;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastResponse) return lastResponse;
  throw lastError || new Error("central authority unavailable");
}

export async function requireLiveRoomAccess(request: Request): Promise<CentralAuth> {
  if (directInternalRequest(request)) {
    return {
      ok: true,
      status: 200,
      mode: "internal",
      user: { name: "服务器本机验收" },
      permissions: { super_admin: true, operation_admin: true, manage_permissions: true },
    };
  }
  let upstream: Response;
  try {
    upstream = await fetchCentralAuthority(request);
  } catch {
    return { ok: false, status: 503, detail: "统一权限服务暂时不可用，请稍后刷新。" };
  }
  const payload = await upstream.json().catch(() => ({})) as {
    detail?: string;
    user?: CentralUser;
    permissions?: PermissionSet;
    access?: { allowed_modules?: string[] };
  };
  if (upstream.status !== 200) {
    const status = upstream.status === 401 || (upstream.status >= 300 && upstream.status < 400)
      ? 401
      : upstream.status === 403 ? 403 : 503;
    return {
      ok: false,
      status,
      detail: payload.detail || (status === 403 ? "当前账号未开通中枢登录权限。" : "统一登录状态已失效。"),
    };
  }
  if (!payload.access?.allowed_modules?.includes(REQUIRED_MODULE)) {
    return { ok: false, status: 403, detail: "当前账号未开通直播间管理权限。" };
  }
  return {
    ok: true, status: 200, mode: "central",
    user: payload.user || {}, permissions: payload.permissions || {},
  };
}

export function authError(auth: CentralAuth) {
  return Response.json({ error: auth.detail || "无权访问直播数据中心" }, { status: auth.status || 403 });
}

export function sessionPayload(auth: CentralAuth) {
  const permissions = auth.permissions || {};
  const name = String(auth.user?.realName || auth.user?.name || (auth.mode === "internal" ? "服务器本机验收" : "已授权成员"));
  const role = permissions.super_admin || permissions.manage_permissions
    ? "中枢管理员"
    : permissions.operation_admin ? "运营管理员" : "已授权成员";
  return {
    user: { name, role },
    permissions: {
      super_admin: Boolean(permissions.super_admin),
      operation_admin: Boolean(permissions.operation_admin),
      manage_permissions: Boolean(permissions.manage_permissions),
    },
    access: { required_module: REQUIRED_MODULE },
  };
}
