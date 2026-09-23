type JsonRecord = Record<string, unknown>;

function jsonValue(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return value;
    try { return jsonValue(JSON.parse(trimmed)); } catch { return value; }
  }
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as JsonRecord).map(([key, child]) => [key, jsonValue(child)]));
  }
  return value;
}

export function audienceFrom(value: unknown) {
  const root = jsonValue(value);
  const source = root && typeof root === "object" && !Array.isArray(root) ? root as JsonRecord : {};
  const findDistribution = (input: unknown): unknown => {
    const normalized = jsonValue(input);
    if (!normalized || typeof normalized !== "object") return null;
    if (Array.isArray(normalized)) {
      for (const item of normalized) { const found = findDistribution(item); if (found) return found; }
      return null;
    }
    const object = normalized as JsonRecord;
    for (const [key, child] of Object.entries(object)) {
      if (/(?:近.?分钟|全场).*看播|实时.*人群|人群.*分布/.test(key) && child && typeof child === "object") return child;
    }
    for (const child of Object.values(object)) { const found = findDistribution(child); if (found) return found; }
    return null;
  };
  const shareValue = (input: unknown) => {
    if (input && typeof input === "object" && !Array.isArray(input)) {
      const row = input as JsonRecord;
      return shareValue(row.percent ?? row.percentage ?? row.share ?? row.ratio ?? row.value);
    }
    const raw = String(input ?? "").trim();
    const parsed = Number(raw.replace(/[%％,]/g, ""));
    if (!Number.isFinite(parsed)) return 0;
    return /[%％]/.test(raw) || parsed > 1 ? parsed : parsed * 100;
  };
  const distribution = Array.isArray(root)
    ? root
    : findDistribution(root) ?? source["近1分钟看播"] ?? source["全场看播"];
  const entries: Array<[string, unknown]> = Array.isArray(distribution)
    ? distribution.map((item) => {
      const row = item && typeof item === "object" ? item as JsonRecord : {};
      return [String(row.label ?? row.name ?? row.audience_name ?? row.key ?? "人群"), row] as [string, unknown];
    })
    : distribution && typeof distribution === "object" ? Object.entries(distribution as JsonRecord) : [];
  return entries
    .map(([label, share]) => ({ label, value: shareValue(share) }))
    .filter((item) => item.value > 0)
    .sort((left, right) => right.value - left.value);
}

export function audienceScopeFrom(value: unknown, scope: "FULL_SESSION_VIEWER" | "FULL_SESSION_BUYER") {
  const root = jsonValue(value);
  if (!root || typeof root !== "object" || Array.isArray(root)) return [];
  const source = root as JsonRecord;
  const unitIsPercent = String(source["单位"] ?? "").includes("%");
  const keys = scope === "FULL_SESSION_VIEWER"
    ? ["全场看播", "全场看播用户"]
    : ["全场购买", "全场购买用户"];
  const distribution = keys.map((key) => source[key]).find((item) => item && typeof item === "object");
  if (!distribution || Array.isArray(distribution)) return [];
  return Object.entries(distribution as JsonRecord)
    .map(([label, input]) => {
      const raw = String(input ?? "").trim();
      const parsed = Number(raw.replace(/[%％,]/g, ""));
      const value = Number.isFinite(parsed) ? (unitIsPercent || /[％%]/.test(raw) || parsed > 1 ? parsed : parsed * 100) : NaN;
      return { label, value };
    })
    .filter((item) => Number.isFinite(item.value) && item.value >= 0);
}
