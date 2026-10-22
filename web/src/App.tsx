import { useCallback, useEffect, useState } from "react";
import { ThemeProvider, TooltipProvider } from "@ledgerhq/lumen-ui-react";
import type { Overview } from "./api/types";
import { usePolling } from "./api/usePolling";
import { HoverTipProvider } from "./components/HoverTip";
import { readStored, writeStored } from "./lib/storage";
import { NeedsYouDialog } from "./features/alerts/NeedsYouDialog";
import { CompatBanners } from "./features/alerts/CompatBanners";
import { useAttention } from "./features/alerts/useAttention";
import { withTz } from "./lib/timezone";
import { CostsView } from "./features/costs/CostsView";
import { SessionList } from "./features/overview/SessionList";
import { TopBar, type ColorScheme, type View } from "./features/overview/TopBar";
import { SessionView } from "./features/session/SessionView";

export function App() {
  const [hours, setHours] = useState(() => readStored("hours", 24));
  const [colorScheme, setColorScheme] = useState<ColorScheme>(() => readStored("colorScheme", "system"));
  const [view, setView] = useState<View>(() => {
    const fromUrl = new URLSearchParams(location.search).get("view");
    return fromUrl === "costs" || fromUrl === "sessions" ? fromUrl : readStored("view", "sessions");
  });
  const [selected, setSelected] = useState<string | null>(() => decodeURIComponent(location.hash.slice(1)) || null);
  const { data: overview, error, stale } = usePolling<Overview>(withTz(`/api/state?hours=${hours}`), 3000);

  const openSession = useCallback((id: string) => {
    setSelected(id);
    setView("sessions");
  }, []);
  const { needsYou, notify, toggleNotify, dialog, open, dismiss, later } = useAttention(overview, view === "sessions" ? selected : null, openSession);

  const needsYouCount = Object.keys(needsYou).length;
  useEffect(() => {
    document.title = needsYouCount ? `(${needsYouCount}) Nebula` : "Nebula";
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon) icon.href = needsYouCount ? "/favicon-alert.svg" : "/favicon.svg";
  }, [needsYouCount]);

  useEffect(() => writeStored("hours", hours), [hours]);
  useEffect(() => writeStored("colorScheme", colorScheme), [colorScheme]);
  useEffect(() => writeStored("view", view), [view]);

  useEffect(() => {
    if (selected || !overview) return;
    const first = overview.live[0] ?? overview.recent[0];
    if (first) setSelected(first.sessionId);
  }, [overview, selected]);

  useEffect(() => {
    if (selected) history.replaceState(null, "", `#${encodeURIComponent(selected)}`);
  }, [selected]);

  return (
    <ThemeProvider colorScheme={colorScheme}>
      <TooltipProvider>
        <HoverTipProvider>
          <div className="grid h-full grid-rows-[auto_minmax(0,1fr)] bg-canvas text-base lg:grid-cols-[360px_minmax(0,1fr)]">
            <div className="lg:col-span-2">
              <TopBar
                overview={overview}
                error={error}
                view={view}
                onViewChange={setView}
                notify={notify}
                onToggleNotify={() => void toggleNotify()}
                needsYouCount={needsYouCount}
                colorScheme={colorScheme}
                onColorSchemeChange={setColorScheme}
              />
            </div>
            <aside className="max-h-480 overflow-y-auto border-b border-muted-subtle bg-canvas-sheet lg:max-h-none lg:border-b-0 lg:border-r">
              <SessionList
                overview={overview}
                loading={stale}
                needsYou={needsYou}
                selected={view === "sessions" ? selected : null}
                onSelect={openSession}
                hours={hours}
                onHoursChange={setHours}
              />
            </aside>
            <main className="overflow-y-auto px-24 py-20">
              <CompatBanners issues={overview?.compat ?? []} />
              {view === "costs" ? (
                <CostsView />
              ) : selected ? (
                <SessionView key={selected} sessionId={selected} />
              ) : (
                <p className="p-40 text-center body-2 text-muted">No session yet</p>
              )}
            </main>
          </div>
          <NeedsYouDialog items={dialog} onOpen={open} onDismiss={dismiss} onLater={later} />
        </HoverTipProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}
