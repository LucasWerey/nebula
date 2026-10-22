import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "@ledgerhq/lumen-ui-react";
import { ChevronLeft, ChevronRight, Close, Expand, Minus, Plus } from "@ledgerhq/lumen-ui-react/symbols";

const src = (id: string) => `/api/image/${id}`;
const ZOOM_MAX = 8;
const ZOOM_STEP = 1.25;
const STAGE_PADDING = 32;

export function ImageStrip({ ids }: { ids: string[] }) {
  const [index, setIndex] = useState<number | null>(null);
  return (
    <>
      <div className="flex flex-wrap gap-8 pb-8">
        {ids.map((id, i) => (
          <button
            key={id}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Preview image ${i + 1} of ${ids.length}`}
            className="block cursor-zoom-in overflow-hidden rounded-md border border-muted-subtle bg-muted-transparent hover:border-muted"
          >
            <img src={src(id)} alt="" loading="lazy" className="block max-h-160 max-w-320 object-contain" />
          </button>
        ))}
      </div>
      {index !== null && <ImagePreview ids={ids} index={index} onIndexChange={setIndex} onClose={() => setIndex(null)} />}
    </>
  );
}

type View = { k: number; x: number; y: number };
type Size = { w: number; h: number };
const FIT: View = { k: 1, x: 0, y: 0 };

type PreviewProps = { ids: string[]; index: number; onIndexChange: (index: number) => void; onClose: () => void };

export function ImagePreview({ ids, index, onIndexChange, onClose }: PreviewProps) {
  const [view, setView] = useState<View>(FIT);
  const [natural, setNatural] = useState<Size | null>(null);
  const [stage, setStage] = useState<Size>({ w: 0, h: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; view: View } | null>(null);
  const [dragging, setDragging] = useState(false);
  const many = ids.length > 1;

  const fit = natural && stage.w ? Math.min(1, (stage.w - STAGE_PADDING) / natural.w, (stage.h - STAGE_PADDING) / natural.h) : 1;
  const scale = fit * view.k;
  const maxK = Math.max(ZOOM_MAX, 4 / fit);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStage({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const zoomTo = useCallback(
    (nextK: number, clientX?: number, clientY?: number) => {
      setView(prev => {
        const k = Math.min(maxK, Math.max(1, nextK));
        if (k === 1) return FIT;
        const rect = stageRef.current?.getBoundingClientRect();
        if (!rect || clientX === undefined || clientY === undefined) return { k, x: (prev.x * k) / prev.k, y: (prev.y * k) / prev.k };
        const px = clientX - (rect.left + rect.width / 2);
        const py = clientY - (rect.top + rect.height / 2);
        return { k, x: px - ((px - prev.x) * k) / prev.k, y: py - ((py - prev.y) * k) / prev.k };
      });
    },
    [maxK],
  );

  const zoomBy = useCallback((factor: number, clientX?: number, clientY?: number) => zoomTo(view.k * factor, clientX, clientY), [view.k, zoomTo]);

  const go = useCallback(
    (delta: number) => {
      if (!many) return;
      onIndexChange((index + delta + ids.length) % ids.length);
      setNatural(null);
      setView(FIT);
    },
    [many, index, ids.length, onIndexChange],
  );

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "+" || e.key === "=") zoomBy(ZOOM_STEP);
      else if (e.key === "-") zoomBy(1 / ZOOM_STEP);
      else if (e.key === "0") setView(FIT);
      else if (e.key === "1") zoomTo(1 / fit);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, zoomBy, zoomTo, fit, onClose]);

  const onWheel = (e: WheelEvent<HTMLDivElement>) => zoomBy(Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || view.k === 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, view };
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    setView({ ...d.view, x: d.view.x + e.clientX - d.x, y: d.view.y + e.clientY - d.y });
  };
  const onPointerUp = () => {
    drag.current = null;
    setDragging(false);
  };

  const id = ids[index];
  const width = natural ? natural.w * scale : undefined;
  const height = natural ? natural.h * scale : undefined;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-canvas-overlay"
      style={{ backdropFilter: "blur(6px)" }}
      onPointerDown={e => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={many ? `Image ${index + 1} of ${ids.length}` : "Image preview"}
        className="flex flex-col overflow-hidden rounded-xl border border-muted-subtle bg-canvas-sheet outline-none drop-shadow-2xl"
        style={{ width: "80vw", height: "80vh" }}
      >
        <header className="flex items-center gap-8 border-b border-muted-subtle px-16 py-10">
          <span className="body-2-semi-bold text-base">{many ? `Image ${index + 1} of ${ids.length}` : "Image"}</span>
          {natural && <span className="body-4 text-muted">{`${natural.w} × ${natural.h}`}</span>}
          <span className="body-4 text-muted-subtle">scroll to zoom · drag to move · double-click to toggle · 0 fit · 1 actual size</span>
          <div className="ml-auto flex items-center gap-4">
            <IconButton aria-label="Zoom out" icon={Minus} size="sm" appearance="gray" onClick={() => zoomBy(1 / ZOOM_STEP)} disabled={view.k <= 1} />
            <span className="w-48 text-center body-3-semi-bold text-base">{Math.round(scale * 100)}%</span>
            <IconButton aria-label="Zoom in" icon={Plus} size="sm" appearance="gray" onClick={() => zoomBy(ZOOM_STEP)} disabled={view.k >= maxK} />
            <IconButton aria-label="Fit to window" icon={Expand} size="sm" appearance="gray" onClick={() => setView(FIT)} />
            <a href={src(id)} target="_blank" rel="noreferrer" className="px-4 body-3 text-interactive underline-offset-2 hover:underline">
              Original
            </a>
            <IconButton aria-label="Close preview" icon={Close} size="sm" appearance="gray" onClick={onClose} />
          </div>
        </header>
        <div className="relative min-h-0 flex-1">
          <div
            ref={stageRef}
            className="absolute inset-0 select-none overflow-hidden"
            style={{ cursor: view.k > 1 ? (dragging ? "grabbing" : "grab") : "zoom-in", touchAction: "none" }}
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={e => (view.k > 1 ? setView(FIT) : zoomTo(2.5, e.clientX, e.clientY))}
          >
            <img
              key={id}
              src={src(id)}
              alt={many ? `Image ${index + 1} of ${ids.length}` : "Image"}
              draggable={false}
              onLoad={e => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              className="absolute left-1/2 top-1/2 block max-w-none"
              style={{
                width,
                height,
                visibility: natural ? "visible" : "hidden",
                transform: `translate(calc(-50% + ${view.x}px), calc(-50% + ${view.y}px))`,
                imageRendering: scale > 1.5 ? "pixelated" : "auto",
              }}
            />
          </div>
          {many && (
            <>
              <div className="absolute left-12 top-1/2 -translate-y-1/2">
                <IconButton aria-label="Previous image" icon={ChevronLeft} size="md" appearance="gray" onClick={() => go(-1)} />
              </div>
              <div className="absolute right-12 top-1/2 -translate-y-1/2">
                <IconButton aria-label="Next image" icon={ChevronRight} size="md" appearance="gray" onClick={() => go(1)} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
