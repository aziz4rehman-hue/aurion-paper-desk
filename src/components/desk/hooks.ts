import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiUrl } from "@/lib/api-url";
import type { Candle, Bias } from "@/lib/ta";
import type { Interval } from "@/lib/universe";

export type Ticker = {
  symbol: string;
  last: number;
  change: number;
  changePct: number;
  high: number;
  low: number;
  volume: number;
  quoteVolume: number;
  bid: number;
  ask: number;
};

export type ScanRow = {
  symbol: string;
  bias: Bias;
  confidence: number;
  entry: number;
  stop: number;
  target: number;
  rr: number;
  regime: string;
  rsi: number;
};

export type DepthBook = {
  bids: { price: number; qty: number }[];
  asks: { price: number; qty: number }[];
  tape: { id: number; price: number; qty: number; time: number; sell: boolean }[];
};

function useLive() {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(true), []);
  return on;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path));
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error || "Market feed unavailable");
  return body;
}

export function useTickers() {
  const on = useLive();
  return useQuery({
    queryKey: ["tickers"],
    enabled: on,
    refetchInterval: 6000,
    queryFn: () => getJson<{ tickers: Ticker[]; asOf: number }>("/api/market?kind=tickers"),
  });
}

export function useKlines(symbol: string, interval: Interval) {
  const on = useLive();
  return useQuery({
    queryKey: ["klines", symbol, interval],
    enabled: on,
    refetchInterval: interval === "1m" ? 8000 : 15000,
    queryFn: () =>
      getJson<{ candles: Candle[] }>(`/api/market?kind=klines&symbol=${symbol}&interval=${interval}`),
  });
}

export function useScan(interval: Interval) {
  const on = useLive();
  return useQuery({
    queryKey: ["scan", interval],
    enabled: on,
    refetchInterval: 25000,
    queryFn: () => getJson<{ rows: ScanRow[]; asOf: number }>(`/api/market?kind=scan&interval=${interval}`),
  });
}

export function useDepth(symbol: string, enabled: boolean) {
  const on = useLive();
  return useQuery({
    queryKey: ["depth", symbol],
    enabled: on && enabled,
    refetchInterval: 4000,
    queryFn: () => getJson<DepthBook>(`/api/market?kind=depth&symbol=${symbol}`),
  });
}

export function useTypewriter(text: string): string {
  const [out, setOut] = useState(text);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setOut(text);
      return;
    }
    let i = 0;
    setOut("");
    const id = window.setInterval(() => {
      i += 3;
      setOut(text.slice(0, i));
      if (i >= text.length) window.clearInterval(id);
    }, 16);
    return () => window.clearInterval(id);
  }, [text]);
  return out;
}

export function useClock(): string {
  const [label, setLabel] = useState("");
  useEffect(() => {
    const tick = () =>
      setLabel(
        new Date().toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
          timeZone: "UTC",
        }) + " UTC",
      );
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return label;
}
