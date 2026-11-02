import { useEffect, useRef, useState } from "react";
import type { Candle } from "@/lib/ta";
import { emaLine, flipMarkers } from "@/lib/ta";
import type { Interval } from "@/lib/universe";
import { fmtPx, fmtQty } from "@/lib/format";

type Marker = {
  time: number;
  position: "belowBar" | "aboveBar";
  color: string;
  shape: "arrowUp" | "arrowDown";
  text: string;
};

type SeriesApi = { setData: (data: unknown[]) => void };
type ChartApi = {
  remove: () => void;
  addSeries: (def: unknown, opts: unknown) => SeriesApi;
  timeScale: () => {
    fitContent: () => void;
    getVisibleLogicalRange: () => { from: number; to: number } | null;
    setVisibleLogicalRange: (range: { from: number; to: number }) => void;
  };
  subscribeCrosshairMove: (cb: (param: { time?: number }) => void) => void;
};

type Bundle = {
  chart: ChartApi;
  candle: SeriesApi;
  ema9: SeriesApi;
  ema21: SeriesApi;
  ema55: SeriesApi;
  vol: SeriesApi;
  setMarkers: (markers: Marker[]) => void;
};

export function ChartPane({
  candles,
  interval,
  focusKey,
}: {
  candles: Candle[];
  interval: Interval;
  focusKey: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<Bundle | null>(null);
  const fitted = useRef("");
  const lookup = useRef(new Map<number, Candle>());
  const [hover, setHover] = useState<Candle | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [failed, setFailed] = useState(false);

  lookup.current = new Map(candles.map((c) => [c.time, c]));

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    let dead = false;
    let chart: ChartApi | null = null;

    void import("lightweight-charts").then((lc) => {
      if (dead || !host.current) return;
      const created = lc.createChart(host.current, {
        autoSize: true,
        layout: {
          background: { type: lc.ColorType.Solid, color: "#10161e" },
          textColor: "#8b9aaf",
          fontFamily: "IBM Plex Mono, ui-monospace, monospace",
        },
        grid: {
          vertLines: { color: "rgba(90,112,138,0.28)" },
          horzLines: { color: "rgba(90,112,138,0.28)" },
        },
        rightPriceScale: { borderColor: "#263140" },
        timeScale: { borderColor: "#263140", timeVisible: true, secondsVisible: false },
        crosshair: {
          vertLine: { color: "#e7b15a", labelBackgroundColor: "#18202b" },
          horzLine: { color: "#e7b15a", labelBackgroundColor: "#18202b" },
        },
      });
      if (dead) {
        created.remove();
        return;
      }
      chart = created as unknown as ChartApi;
      const candle = chart.addSeries(lc.CandlestickSeries, {
        upColor: "#3dce8a",
        downColor: "#ff5c73",
        wickUpColor: "#3dce8a",
        wickDownColor: "#ff5c73",
        borderVisible: false,
        priceLineColor: "#e7eef7",
      });
      candle.setData([]);
      const scale = (created as unknown as { priceScale: (id: string) => { applyOptions: (o: unknown) => void } }).priceScale;
      created.priceScale("right").applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } });
      const vol = chart.addSeries(lc.HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "vol",
        lastValueVisible: false,
        priceLineVisible: false,
      });
      scale.call(created, "vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      const line = (color: string, width: 1 | 2) =>
        chart!.addSeries(lc.LineSeries, {
          color,
          lineWidth: width,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
      const markers = lc.createSeriesMarkers(candle as never, []);
      api.current = {
        chart,
        candle,
        ema9: line("#e7b15a", 2),
        ema21: line("#e7eef7", 1),
        ema55: line("#5d6b7e", 1),
        vol,
        setMarkers: (next) => markers.setMarkers(next as never),
      };
      created.subscribeCrosshairMove((param) => {
        const time = param.time;
        setHover(typeof time === "number" ? (lookup.current.get(time) ?? null) : null);
      });
      setEpoch((n) => n + 1);
      setFailed(false);
    }).catch(() => {
      if (!dead) setFailed(true);
    });

    return () => {
      dead = true;
      chart?.remove();
      api.current = null;
      fitted.current = "";
    };
  }, []);

  useEffect(() => {
    const bundle = api.current;
    if (!bundle || candles.length === 0) return;
    const range = bundle.chart.timeScale().getVisibleLogicalRange();
    bundle.candle.setData(
      candles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })),
    );
    bundle.vol.setData(
      candles.map((c) => ({
        time: c.time,
        value: c.volume,
        color: c.close >= c.open ? "rgba(61,206,138,0.45)" : "rgba(255,92,115,0.4)",
      })),
    );
    bundle.ema9.setData(emaLine(candles, 9));
    bundle.ema21.setData(emaLine(candles, 21));
    bundle.ema55.setData(emaLine(candles, 55));
    const markers = flipMarkers(candles, interval).map((m) => ({
      time: m.time,
      position: m.bias === "long" ? ("belowBar" as const) : ("aboveBar" as const),
      color: m.bias === "long" ? "#3dce8a" : "#ff5c73",
      shape: m.bias === "long" ? ("arrowUp" as const) : ("arrowDown" as const),
      text: m.bias === "long" ? "Long" : "Short",
    }));
    bundle.setMarkers(markers);
    if (fitted.current !== focusKey) {
      bundle.chart.timeScale().fitContent();
      fitted.current = focusKey;
    } else if (range) {
      bundle.chart.timeScale().setVisibleLogicalRange(range);
    }
  }, [candles, interval, focusKey, epoch]);

  const bar = hover ?? candles[candles.length - 1];

  return (
    <div className="relative chart-frame">
      <div ref={host} className="h-full w-full" />
      {bar && (
        <div className="pointer-events-none absolute left-2 top-2 flex flex-wrap gap-x-3 gap-y-1 text-xs num text-muted">
          <span>O {fmtPx(bar.open)}</span>
          <span>H {fmtPx(bar.high)}</span>
          <span>L {fmtPx(bar.low)}</span>
          <span className={bar.close >= bar.open ? "text-up" : "text-down"}>C {fmtPx(bar.close)}</span>
          <span>V {fmtQty(bar.volume)}</span>
        </div>
      )}
      {failed && (
        <p className="absolute inset-0 grid place-items-center text-sm text-muted">Chart failed to start.</p>
      )}
      {!failed && candles.length === 0 && (
        <div className="absolute inset-x-8 top-1/2 h-1 overflow-hidden rounded-full bg-surface-2">
          <div className="scanline h-full w-1/3" />
        </div>
      )}
    </div>
  );
}
