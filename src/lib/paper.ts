import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Interval } from "@/lib/universe";
import { pairOf } from "@/lib/universe";
import type { Bias } from "@/lib/ta";

export type Side = "long" | "short";
export type FillReason = "manual" | "auto" | "stop" | "target" | "flip" | "flatten";

export type Position = {
  symbol: string;
  side: Side;
  qty: number;
  entry: number;
  margin: number;
  stop: number;
  target: number;
  openedAt: number;
  source: "manual" | "auto";
};

export type Fill = {
  id: string;
  ts: number;
  symbol: string;
  side: Side;
  action: "open" | "close";
  qty: number;
  price: number;
  fee: number;
  pnl: number | null;
  reason: FillReason;
};

export type SetupIn = {
  symbol: string;
  bias: Bias;
  confidence: number;
  entry: number;
  stop: number;
  target: number;
  rr: number;
};

type Data = {
  cash: number;
  positions: Position[];
  fills: Fill[];
  curve: { t: number; equity: number }[];
  autopilot: boolean;
  riskPct: 0.5 | 1 | 2;
  dayKey: string;
  dayStartEquity: number;
  prices: Record<string, number>;
  cooldowns: Record<string, number>;
  startedAt: number;
  symbol: string;
  interval: Interval;
  hydrated: boolean;
};

type Store = Data & {
  setHydrated: () => void;
  setFocus: (symbol: string, interval: Interval) => void;
  setAutopilot: (on: boolean) => void;
  setRisk: (riskPct: 0.5 | 1 | 2) => void;
  reset: () => void;
  mark: (prices: Record<string, number>) => string[];
  arm: (setups: SetupIn[]) => string[];
  manual: (symbol: string, side: Side, plan?: { stopDist: number; rewardDist: number }) => { ok: boolean; message: string };
  flatten: (symbol?: string) => string[];
};

const START = 100_000;
const FEE = 0.0004;
const SLIP = 0.0002;
const COOLDOWN = 55_000;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function equityOf(s: Pick<Data, "cash" | "positions" | "prices">): number {
  let eq = s.cash;
  for (const p of s.positions) {
    const px = s.prices[p.symbol] ?? p.entry;
    const dir = p.side === "long" ? 1 : -1;
    eq += p.margin + (px - p.entry) * p.qty * dir;
  }
  return eq;
}

export function unrealized(s: Pick<Data, "positions" | "prices">): number {
  let pnl = 0;
  for (const p of s.positions) {
    const px = s.prices[p.symbol] ?? p.entry;
    const dir = p.side === "long" ? 1 : -1;
    pnl += (px - p.entry) * p.qty * dir;
  }
  return pnl;
}

function fresh(): Data {
  const now = Date.now();
  return {
    cash: START,
    positions: [],
    fills: [],
    curve: [{ t: now, equity: START }],
    autopilot: false,
    riskPct: 1,
    dayKey: today(),
    dayStartEquity: START,
    prices: {},
    cooldowns: {},
    startedAt: now,
    symbol: "BTCUSDT",
    interval: "15m",
    hydrated: false,
  };
}

function pushFill(s: Data, fill: Fill): Data {
  return { ...s, fills: [fill, ...s.fills].slice(0, 180) };
}

function withCurve(s: Data, now: number): Data {
  const equity = equityOf(s);
  const last = s.curve[s.curve.length - 1];
  if (last && now - last.t < 20_000 && Math.abs(equity - last.equity) / Math.max(1, last.equity) < 0.0004) {
    return s;
  }
  return { ...s, curve: [...s.curve, { t: now, equity }].slice(-360) };
}

function closeAt(s: Data, symbol: string, reason: FillReason, now: number): { state: Data; message: string | null } {
  const pos = s.positions.find((p) => p.symbol === symbol);
  if (!pos) return { state: s, message: null };
  const px = s.prices[symbol] ?? pos.entry;
  const fillPx = pos.side === "long" ? px * (1 - SLIP) : px * (1 + SLIP);
  const dir = pos.side === "long" ? 1 : -1;
  const pnl = (fillPx - pos.entry) * pos.qty * dir;
  const fee = pos.qty * fillPx * FEE;
  const next: Data = {
    ...s,
    cash: s.cash + pos.margin + pnl - fee,
    positions: s.positions.filter((p) => p.symbol !== symbol),
  };
  const named = pairOf(symbol).base;
  const verb = reason === "stop" ? "Stopped" : reason === "target" ? "Target hit" : reason === "flip" ? "Flipped out" : "Flat";
  const message = `${verb} ${named} ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}`;
  return {
    state: pushFill(next, {
      id: uid(),
      ts: now,
      symbol,
      side: pos.side,
      action: "close",
      qty: pos.qty,
      price: fillPx,
      fee,
      pnl: pnl - fee,
      reason,
    }),
    message,
  };
}

function openAt(
  s: Data,
  input: {
    symbol: string;
    side: Side;
    price: number;
    stopDist: number;
    rewardDist: number;
    source: "manual" | "auto";
    reason: FillReason;
    now: number;
  },
): { state: Data; message: string | null; ok: boolean } {
  if (s.positions.some((p) => p.symbol === input.symbol)) {
    return { state: s, message: "Already in this market", ok: false };
  }
  const fillPx = input.side === "long" ? input.price * (1 + SLIP) : input.price * (1 - SLIP);
  const equity = equityOf(s);
  const riskUsd = equity * (s.riskPct / 100);
  let qty = riskUsd / Math.max(input.stopDist, fillPx * 0.004);
  let notional = qty * fillPx;
  const cap = Math.min(s.cash * 0.98, equity * 0.22);
  if (notional > cap) {
    qty = cap / fillPx;
    notional = qty * fillPx;
  }
  const fee = notional * FEE;
  if (!Number.isFinite(qty) || qty <= 0 || notional + fee > s.cash || notional < 25) {
    return { state: s, message: "Not enough cash for that risk", ok: false };
  }
  const stop = input.side === "long" ? fillPx - input.stopDist : fillPx + input.stopDist;
  const target = input.side === "long" ? fillPx + input.rewardDist : fillPx - input.rewardDist;
  const pos: Position = {
    symbol: input.symbol,
    side: input.side,
    qty,
    entry: fillPx,
    margin: notional,
    stop,
    target,
    openedAt: input.now,
    source: input.source,
  };
  const next: Data = {
    ...s,
    cash: s.cash - notional - fee,
    positions: [...s.positions, pos],
    cooldowns: { ...s.cooldowns, [input.symbol]: input.now },
  };
  const named = pairOf(input.symbol).base;
  const message = `${input.source === "auto" ? "Auto" : "Paper"} ${input.side} ${named} · ${qty.toFixed(4)} @ ${fillPx.toFixed(2)}`;
  return {
    ok: true,
    message,
    state: pushFill(next, {
      id: uid(),
      ts: input.now,
      symbol: input.symbol,
      side: input.side,
      action: "open",
      qty,
      price: fillPx,
      fee,
      pnl: null,
      reason: input.reason,
    }),
  };
}

export const useBook = create<Store>()(
  persist(
    (set, get) => ({
      ...fresh(),
      setHydrated: () => {
        const day = today();
        set((s) => {
          if (s.dayKey === day) return { hydrated: true };
          return { hydrated: true, dayKey: day, dayStartEquity: equityOf(s) };
        });
      },
      setFocus: (symbol, interval) => set({ symbol, interval }),
      setAutopilot: (autopilot) => set({ autopilot }),
      setRisk: (riskPct) => set({ riskPct }),
      reset: () => set({ ...fresh(), hydrated: true }),
      mark: (prices) => {
        const now = Date.now();
        let s: Data = { ...get(), prices: { ...get().prices, ...prices } };
        const messages: string[] = [];
        for (const pos of [...s.positions]) {
          const px = s.prices[pos.symbol];
          if (px == null) continue;
          const hitStop = pos.side === "long" ? px <= pos.stop : px >= pos.stop;
          const hitTarget = pos.side === "long" ? px >= pos.target : px <= pos.target;
          if (!hitStop && !hitTarget) continue;
          const closed = closeAt(s, pos.symbol, hitStop ? "stop" : "target", now);
          s = closed.state;
          if (closed.message) messages.push(closed.message);
        }
        s = withCurve(s, now);
        set(s);
        return messages;
      },
      arm: (setups) => {
        if (!get().autopilot) return [];
        const now = Date.now();
        let s: Data = { ...get() };
        const messages: string[] = [];
        for (const setup of setups) {
          if (setup.bias !== "long" && setup.bias !== "short") continue;
          const px = s.prices[setup.symbol] ?? setup.entry;
          const pos = s.positions.find((p) => p.symbol === setup.symbol);
          if (pos && pos.side !== setup.bias && setup.confidence >= 72) {
            const closed = closeAt(s, setup.symbol, "flip", now);
            s = closed.state;
            if (closed.message) messages.push(closed.message);
          }
          if (s.positions.some((p) => p.symbol === setup.symbol)) continue;
          if (setup.confidence < 64 || setup.rr < 1.6) continue;
          const last = s.cooldowns[setup.symbol] ?? 0;
          if (now - last < COOLDOWN) continue;
          const stopDist = Math.max(Math.abs(setup.entry - setup.stop), px * 0.004);
          const rewardDist = Math.max(Math.abs(setup.target - setup.entry), stopDist * 2.2);
          const opened = openAt(s, {
            symbol: setup.symbol,
            side: setup.bias,
            price: px,
            stopDist,
            rewardDist,
            source: "auto",
            reason: "auto",
            now,
          });
          s = opened.state;
          if (opened.ok && opened.message) messages.push(opened.message);
        }
        s = withCurve(s, now);
        set(s);
        return messages;
      },
      manual: (symbol, side, plan?: { stopDist: number; rewardDist: number }) => {
        const now = Date.now();
        const s0 = get();
        const px = s0.prices[symbol];
        if (px == null) return { ok: false, message: "Waiting for a live price" };
        let s: Data = s0;
        const notes: string[] = [];
        const existing = s.positions.find((p) => p.symbol === symbol);
        if (existing && existing.side !== side) {
          const closed = closeAt(s, symbol, "flip", now);
          s = closed.state;
          if (closed.message) notes.push(closed.message);
        }
        if (s.positions.some((p) => p.symbol === symbol)) {
          set(withCurve(s, now));
          return { ok: false, message: "Already positioned on this side" };
        }
        const stopDist = plan?.stopDist && plan.stopDist > 0 ? plan.stopDist : px * 0.012;
        const rewardDist = plan?.rewardDist && plan.rewardDist > 0 ? plan.rewardDist : stopDist * 2.2;
        const opened = openAt(s, {
          symbol,
          side,
          price: px,
          stopDist,
          rewardDist,
          source: "manual",
          reason: "manual",
          now,
        });
        set(withCurve(opened.state, now));
        if (opened.message) notes.push(opened.message);
        return { ok: opened.ok, message: notes.join(" · ") || "Could not open" };
      },
      flatten: (symbol) => {
        const now = Date.now();
        let s: Data = { ...get() };
        const messages: string[] = [];
        const targets = symbol ? s.positions.filter((p) => p.symbol === symbol) : [...s.positions];
        for (const pos of targets) {
          const closed = closeAt(s, pos.symbol, "flatten", now);
          s = closed.state;
          if (closed.message) messages.push(closed.message);
        }
        set(withCurve(s, now));
        return messages;
      },
    }),
    {
      name: "aurion-book",
      partialize: (s) => ({
        cash: s.cash,
        positions: s.positions,
        fills: s.fills,
        curve: s.curve,
        autopilot: s.autopilot,
        riskPct: s.riskPct,
        dayKey: s.dayKey,
        dayStartEquity: s.dayStartEquity,
        cooldowns: s.cooldowns,
        startedAt: s.startedAt,
        symbol: s.symbol,
        interval: s.interval,
      }),
      skipHydration: true,
      onRehydrateStorage: () => (state) => {
        state?.setHydrated();
      },
    },
  ),
);
