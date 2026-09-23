export function integrationBaseFromPrefix(prefix: string | null): string {
  for (const base of ["/yxb/wis-marketing-hub", "/fd-026222/wis-marketing-hub"]) {
    if (prefix === `${base}/modules/data-center`) return base;
  }
  return "";
}
