import { useState } from "react";
import { Banner } from "@ledgerhq/lumen-ui-react";
import type { CompatIssue } from "../../api/types";
import { readStored, writeStored } from "../../lib/storage";

const KEY = "compatDismissed";

export function CompatBanners({ issues }: { issues: CompatIssue[] }) {
  const [dismissed, setDismissed] = useState<string[]>(() => readStored(KEY, []));
  const visible = issues.filter(i => i.level === "error" || !dismissed.includes(i.key));
  if (!visible.length) return null;

  const dismiss = (key: string) => {
    const next = [...dismissed, key];
    setDismissed(next);
    writeStored(KEY, next);
  };

  return (
    <div className="mb-16 flex flex-col gap-8">
      {visible.map(issue => (
        <Banner
          key={issue.key}
          appearance={issue.level}
          title={issue.level === "error" ? "Nebula can't read your sessions" : issue.level === "warning" ? "Some features are unavailable" : "Untested Claude Code version"}
          description={issue.message}
          onClose={issue.level === "error" ? undefined : () => dismiss(issue.key)}
          closeAriaLabel="Dismiss"
        />
      ))}
    </div>
  );
}
