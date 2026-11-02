import { previewPathPrefix } from "@/lib/preview-path-prefix";

/** Keep API calls on the preview prefix when the desk is embedded under /hds-…/ */
export function apiUrl(path: string): string {
  if (typeof window === "undefined") return path;
  const prefix = previewPathPrefix(window.location.hostname, window.location.pathname);
  return prefix ? `${prefix}${path}` : path;
}
