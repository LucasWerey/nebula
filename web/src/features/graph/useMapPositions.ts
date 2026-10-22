import { useCallback, useEffect, useRef, useState } from "react";
import { readStored, writeStored } from "../../lib/storage";
import type { Point } from "./graph";

type Positions = Record<string, Point>;

export function useMapPositions(storageKey: string) {
  const [positions, setPositions] = useState<Positions>(() => readStored(storageKey, {}));
  const latest = useRef(positions);

  useEffect(() => {
    const stored = readStored<Positions>(storageKey, {});
    latest.current = stored;
    setPositions(stored);
  }, [storageKey]);

  const move = useCallback((patch: Positions) => {
    latest.current = { ...latest.current, ...patch };
    setPositions(latest.current);
  }, []);

  const persist = useCallback(() => writeStored(storageKey, latest.current), [storageKey]);

  const reset = useCallback(() => {
    latest.current = {};
    setPositions({});
    writeStored(storageKey, {});
  }, [storageKey]);

  return { positions, move, persist, reset, customized: Object.keys(positions).length > 0 };
}
