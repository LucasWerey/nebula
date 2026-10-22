import { createContext, useCallback, useContext, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";

type TipState = { text: string; x: number; y: number } | null;
type TipHandlers = {
  onMouseMove: (e: MouseEvent) => void;
  onMouseLeave: () => void;
};

const HoverTipContext = createContext<(text: string) => TipHandlers>(() => ({
  onMouseMove: () => undefined,
  onMouseLeave: () => undefined,
}));

export const useHoverTip = () => useContext(HoverTipContext);

export function HoverTipProvider({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<TipState>(null);
  const ref = useRef<HTMLDivElement>(null);

  const handlers = useCallback(
    (text: string): TipHandlers => ({
      onMouseMove: e => setTip({ text, x: e.clientX, y: e.clientY }),
      onMouseLeave: () => setTip(null),
    }),
    [],
  );

  const style = useMemo(() => {
    if (!tip) return undefined;
    const w = ref.current?.offsetWidth ?? 280;
    const h = ref.current?.offsetHeight ?? 60;
    const left = Math.min(tip.x + 14, window.innerWidth - w - 8);
    const top = tip.y + 16 + h > window.innerHeight ? tip.y - h - 10 : tip.y + 16;
    return { left, top };
  }, [tip]);

  return (
    <HoverTipContext.Provider value={handlers}>
      {children}
      {tip && (
        <div
          ref={ref}
          role="tooltip"
          style={style}
          className="pointer-events-none fixed z-50 max-w-400 whitespace-pre-wrap rounded-sm border border-muted-subtle bg-canvas-sheet px-12 py-8 text-base body-3 drop-shadow-md"
        >
          {tip.text}
        </div>
      )}
    </HoverTipContext.Provider>
  );
}
