export function frameHeadersForHub(enabled) {
  return Object.freeze({
    'X-Frame-Options': enabled ? 'SAMEORIGIN' : 'DENY',
    'Content-Security-Policy': enabled ? "frame-ancestors 'self'" : "frame-ancestors 'none'",
  });
}
