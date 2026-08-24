const fallbackRetryAfterMs = 60_000;

export function getRetryAfterMilliseconds(value: string | null, now = Date.now()) {
  if (!value) {
    return fallbackRetryAfterMs;
  }

  const deltaSeconds = Number(value);
  if (Number.isFinite(deltaSeconds) && deltaSeconds > 0) {
    return Math.ceil(deltaSeconds * 1_000);
  }

  const retryAt = Date.parse(value);
  if (Number.isFinite(retryAt) && retryAt > now) {
    return retryAt - now;
  }

  return fallbackRetryAfterMs;
}
