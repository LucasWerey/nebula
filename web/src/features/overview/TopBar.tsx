import { Button, IconButton, SegmentedControl, SegmentedControlButton, Tooltip, TooltipContent, TooltipTrigger } from "@ledgerhq/lumen-ui-react";
import { Bell, BellFill, Chart1, Home, Moon, Sun } from "@ledgerhq/lumen-ui-react/symbols";
import { cn } from "@ledgerhq/lumen-design-core/cn";
import type { Overview } from "../../api/types";
import { money } from "../../lib/format";
import type { NotifyState } from "../alerts/useAttention";

export type ColorScheme = "system" | "light" | "dark";
export type View = "sessions" | "costs";

type Props = {
  overview: Overview | null;
  error: string | null;
  view: View;
  onViewChange: (view: View) => void;
  notify: NotifyState;
  onToggleNotify: () => void;
  needsYouCount: number;
  colorScheme: ColorScheme;
  onColorSchemeChange: (scheme: ColorScheme) => void;
};

const NEXT_SCHEME: Record<ColorScheme, ColorScheme> = { system: "light", light: "dark", dark: "system" };
const NOTIFY_TEXT: Record<NotifyState, string> = {
  on: "Alerts on",
  off: "Alerts off",
  blocked: "Alerts blocked",
  ask: "Allow in Chrome",
};
const NOTIFY_LABEL: Record<NotifyState, string> = {
  on: "Desktop alerts are on. Click to turn them off.",
  off: "Turn on desktop alerts when a session needs you or looks stuck.",
  blocked: "Chrome blocks notifications for localhost. Allow them in the site settings, then click again.",
  ask: "Chrome didn't show its permission prompt. Open chrome://settings/content/siteDetails?site=http%3A%2F%2Flocalhost%3A7878, set Notifications to Allow, then reload.",
};

export function TopBar(props: Props) {
  const { overview, error, view, onViewChange, notify, onToggleNotify, needsYouCount, colorScheme, onColorSchemeChange } = props;
  const live = overview?.live ?? [];
  const today = overview?.todayCost ?? 0;
  const kpis = [
    { label: "Running", value: String(live.length) },
    { label: "Working", value: String(live.filter(s => s.status === "busy").length) },
    { label: "Needs you", value: String(needsYouCount) },
    { label: "Subagents active", value: String(live.reduce((n, s) => n + s.subagents.filter(a => a.running).length, 0)) },
    { label: "Running cost", value: money(live.reduce((n, s) => n + s.cost, 0)) },
  ];

  return (
    <header className="flex flex-wrap items-center gap-x-24 gap-y-8 border-b border-muted-subtle bg-canvas-sheet px-20 py-12">
      <div className="flex items-center gap-8">
        <img src="/favicon.svg" alt="" className="size-24 rounded-sm" />
        <span className="heading-5-semi-bold text-base">Nebula</span>
      </div>
      <SegmentedControl selectedValue={view} onSelectedChange={v => onViewChange(v as View)} tabLayout="fit">
        <SegmentedControlButton value="sessions" icon={Home}>
          Sessions
        </SegmentedControlButton>
        <SegmentedControlButton value="costs" icon={Chart1}>
          Costs
        </SegmentedControlButton>
      </SegmentedControl>
      <dl className="flex flex-wrap gap-x-24 gap-y-4">
        {kpis.map(k => (
          <div key={k.label} className="flex flex-col">
            <dt className="body-4 uppercase text-muted">{k.label}</dt>
            <dd className={cn("heading-5-semi-bold", k.label === "Needs you" && needsYouCount > 0 ? "text-active" : "text-base")}>{k.value}</dd>
          </div>
        ))}
        <div className="flex flex-col">
          <dt className="body-4 uppercase text-muted">Today</dt>
          <dd className="heading-5-semi-bold text-base">{money(today)}</dd>
        </div>
      </dl>
      <div className="ml-auto flex items-center gap-12">
        <span className={error ? "body-4 text-error" : "body-4 text-muted-subtle"}>
          {error ? `offline — ${error}` : overview ? `updated ${new Date(overview.now).toLocaleTimeString()}` : "loading…"}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              appearance={notify === "on" ? "accent" : "gray"}
              icon={notify === "on" ? BellFill : Bell}
              aria-pressed={notify === "on"}
              aria-label={NOTIFY_LABEL[notify]}
              onClick={onToggleNotify}
            >
              {NOTIFY_TEXT[notify]}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{NOTIFY_LABEL[notify]}</TooltipContent>
        </Tooltip>
        <IconButton
          aria-label={`Theme: ${colorScheme}`}
          tooltip
          tooltipText={`Theme: ${colorScheme}`}
          appearance="gray"
          size="sm"
          icon={colorScheme === "dark" ? Moon : Sun}
          onClick={() => onColorSchemeChange(NEXT_SCHEME[colorScheme])}
        />
      </div>
    </header>
  );
}
