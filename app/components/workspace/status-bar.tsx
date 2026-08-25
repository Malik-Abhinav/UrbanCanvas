"use client";

type MessageBannerProps = {
  message: string | null;
};

/** Yellow warning banner shown under the location search form. */
export function SearchErrorBanner({ message }: MessageBannerProps) {
  if (!message) {
    return null;
  }

  return (
    <p className="mt-4 rounded border border-[#f5c542]/30 bg-[#f5c542]/10 px-3 py-2 text-sm leading-6 text-[#ffe6a1]" role="alert">
      {message}
    </p>
  );
}

/** Yellow warning banner shown under the area-selection controls. */
export function SelectionErrorBanner({ message }: MessageBannerProps) {
  if (!message) {
    return null;
  }

  return (
    <p className="mt-3 rounded border border-[#f5c542]/30 bg-[#f5c542]/10 px-3 py-2 text-sm leading-6 text-[#ffe6a1]" role="alert">
      {message}
    </p>
  );
}

type OsmErrorBannerProps = {
  message: string | null;
  canRetry: boolean;
  isFetchingOsm: boolean;
  retrySeconds: number;
  onRetry: () => void;
};

/** Red alert for OSM fetch failures, with a rate-limit-aware retry action. */
export function OsmErrorBanner({ canRetry, isFetchingOsm, message, onRetry, retrySeconds }: OsmErrorBannerProps) {
  if (!message) {
    return null;
  }

  return (
    <div className="mt-3 rounded border border-[#ff6b57]/30 bg-[#ff6b57]/10 px-3 py-2 text-sm leading-6 text-[#ffd1ca]" role="alert">
      <p>{message}</p>
      {canRetry ? (
        <button
          className="secondary-button mt-2 px-3 py-1.5 text-xs"
          disabled={isFetchingOsm || retrySeconds > 0}
          onClick={onRetry}
          type="button"
        >
          {isFetchingOsm
            ? "Retrying OSM..."
            : retrySeconds > 0
              ? `Retry OSM in ${retrySeconds}s`
              : "Retry OSM"}
        </button>
      ) : null}
    </div>
  );
}

/** Neutral live-region status line for save/load outcomes. */
export function ProjectMessageBanner({ message }: MessageBannerProps) {
  if (!message) {
    return null;
  }

  return (
    <p aria-live="polite" className="mt-3 rounded border border-white/10 bg-white/[0.04] px-3 py-2 text-sm leading-6 text-white/70">
      {message}
    </p>
  );
}

/** Red alert for project deletion failures. */
export function ProjectDeleteErrorBanner({ message }: MessageBannerProps) {
  if (!message) {
    return null;
  }

  return (
    <p className="mt-3 rounded border border-[#ff6b57]/30 bg-[#ff6b57]/10 px-3 py-2 text-sm leading-6 text-[#ffd1ca]" role="alert">
      {message}
    </p>
  );
}

/** Red alert for change-analysis failures. */
export function AnalysisMessageBanner({ message }: MessageBannerProps) {
  if (!message) {
    return null;
  }

  return (
    <p className="mt-3 rounded border border-[#ff6b57]/30 bg-[#ff6b57]/10 px-3 py-2 text-sm leading-6 text-[#ffd1ca]" role="alert">
      {message}
    </p>
  );
}
