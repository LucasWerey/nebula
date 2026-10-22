import { useEffect, useState } from "react";

type PollState<T> = { data: T | null; dataUrl: string | null; error: string | null };

export function usePolling<T>(url: string | null, intervalMs: number) {
  const [state, setState] = useState<PollState<T>>({ data: null, dataUrl: null, error: null });

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as T;
        if (!cancelled) setState({ data: json, dataUrl: url, error: null });
      } catch (err) {
        if (!cancelled) setState(prev => ({ ...prev, error: err instanceof Error ? err.message : String(err) }));
      }
      if (!cancelled) timer = setTimeout(tick, intervalMs);
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [url, intervalMs]);

  return { data: state.data, error: state.error, stale: state.data !== null && state.dataUrl !== url };
}
