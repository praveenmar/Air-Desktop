export function normalizeUrl(url: string, base?: string): string {
  try {
    const u = new URL(url, base);
    const path = u.pathname.replace(/\/$/, "") || "/";
    return `${u.origin}${path}`;
  } catch {
    return url;
  }
}

