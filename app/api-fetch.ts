/**
 * fetch wrapper for UrbanCanvas API calls: enforces a client-side timeout
 * and turns abort/network failures into readable errors so the UI never
 * hangs on a silent request. Returns the raw Response; callers parse it.
 */
export async function apiFetch(
  url: string,
  { timeoutMs = 45_000, ...init }: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("The request timed out. Check your connection and try again.");
    }

    if (error instanceof TypeError) {
      throw new Error("Could not reach the UrbanCanvas API. Is the server running?");
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}
