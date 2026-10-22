const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function withTz(url: string) {
  return `${url}${url.includes("?") ? "&" : "?"}tz=${encodeURIComponent(browserTz)}`;
}
