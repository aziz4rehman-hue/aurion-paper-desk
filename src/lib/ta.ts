import { INTERVAL_LABEL, type Interval } from "@/lib/universe";

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type Bias = "long" | "short" | "flat";

export type Signal = {
  bias: Bias;
  confidence: number;
  entry: number;
  stop: number;
  target: number;
  target2: number;
  rr: number;
  rsi: number;
  atr: number;
  ema9: number;
  ema21: number;
  ema55: number;
  macdHist: number;
  volRatio: number;
  regime: string;
  reasons: string[];
  summary: string;
};

export type Setup = {
  symbol: string;
  bias: Bias;
  confidence: number;
  entry: number;
  stop: number;
  target: number;
  rr: number;
  regime: string;
};

export function parseKlines(raw: unknown): Candle[] {
  if (!Array.isArray(raw)) return [];
  const out: Candle[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const time = Math.floor(Number(row[0]) / 1000);
    const open = Number(row[1]);
    const high = Number(row[2]);
    const low = Number(row[3]);
    const close = Number(row[4]);
    const volume = Number(row[5]);
    if (![time, open, high, low, close, volume].every(Number.isFinite)) continue;
    out.push({ time, open, high, low, close, volume });
  }
  return out;
}

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0] ?? 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] ?? prev;
    prev = i === 0 ? v : v * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = (closes[i] ?? 0) - (closes[i - 1] ?? 0);
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgG = gain / period;
  let avgL = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = (closes[i] ?? 0) - (closes[i - 1] ?? 0);
    avgG = (avgG * (period - 1) + (d > 0 ? d : 0)) / period;
    avgL = (avgL * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

function atr(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    if (!c || !prev) continue;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close)));
  }
  if (trs.length === 0) return 0;
  const p = Math.min(period, trs.length);
  let avg = 0;
  for (let i = 0; i < p; i++) avg += trs[i] ?? 0;
  avg /= p;
  for (let i = p; i < trs.length; i++) avg = (avg * (p - 1) + (trs[i] ?? 0)) / p;
  return avg;
}

function macdHist(closes: number[]): { hist: number; rising: boolean } {
  const fast = ema(closes, 12);
  const slow = ema(closes, 26);
  const macd = fast.map((v, i) => v - (slow[i] ?? v));
  const signal = ema(macd, 9);
  const hist = macd.map((v, i) => v - (signal[i] ?? v));
  const last = hist[hist.length - 1] ?? 0;
  const prev = hist[hist.length - 2] ?? last;
  return { hist: last, rising: last > prev };
}

export function emaLine(candles: Candle[], period: number): { time: number; value: number }[] {
  const values = ema(
    candles.map((c) => c.close),
    period,
  );
  return candles.slice(period).map((c, i) => ({
    time: c.time,
    value: values[i + period] ?? c.close,
  }));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function buildSignal(candles: Candle[], interval: Interval): Signal | null {
  if (candles.length < 60) return null;
  const closes = candles.map((c) => c.close);
  const e9 = ema(closes, 9);
  const e21 = ema(closes, 21);
  const e55 = ema(closes, 55);
  const last = candles[candles.length - 1];
  if (!last) return null;
  const ema9 = e9[e9.length - 1] ?? last.close;
  const ema21 = e21[e21.length - 1] ?? last.close;
  const ema55 = e55[e55.length - 1] ?? last.close;
  const rsiNow = rsi(closes);
  const atrNow = Math.max(atr(candles), last.close * 0.0015);
  const macd = macdHist(closes);
  const vols = candles.slice(-21, -1).map((c) => c.volume);
  const avgVol = vols.reduce((a, b) => a + b, 0) / Math.max(1, vols.length);
  const volRatio = avgVol > 0 ? last.volume / avgVol : 1;

  const recent = candles.slice(-10, -2);
  const prior = candles.slice(-22, -10);
  const recentLo = Math.min(...recent.map((c) => c.low));
  const priorLo = Math.min(...prior.map((c) => c.low));
  const recentHi = Math.max(...recent.map((c) => c.high));
  const priorHi = Math.max(...prior.map((c) => c.high));
  const higherLow = recentLo > priorLo;
  const lowerHigh = recentHi < priorHi;

  const shelf = candles.slice(-22, -2);
  const swingLo = Math.min(...shelf.map((c) => c.low));
  const swingHi = Math.max(...shelf.map((c) => c.high));

  let longScore = 0;
  let shortScore = 0;
  const longWhy: string[] = [];
  const shortWhy: string[] = [];

  if (ema9 > ema21 && ema21 > ema55) {
    longScore += 3;
    longWhy.push("EMA stack is aligned up");
  }
  if (ema9 < ema21 && ema21 < ema55) {
    shortScore += 3;
    shortWhy.push("EMA stack is aligned down");
  }
  if (last.close > ema21) longScore += 1;
  if (last.close < ema21) shortScore += 1;

  if (rsiNow >= 48 && rsiNow <= 68) {
    longScore += 2;
    longWhy.push(`RSI ${rsiNow.toFixed(0)} is mid-range, not stretched`);
  } else if (rsiNow >= 32 && rsiNow <= 52) {
    shortScore += 2;
    shortWhy.push(`RSI ${rsiNow.toFixed(0)} has room lower`);
  }
  if (rsiNow > 74) longScore -= 2;
  if (rsiNow < 26) shortScore -= 2;

  if (macd.hist > 0 && macd.rising) {
    longScore += 2;
    longWhy.push("MACD histogram is positive and expanding");
  } else if (macd.hist < 0 && !macd.rising) {
    shortScore += 2;
    shortWhy.push("MACD histogram is negative and expanding");
  } else if (macd.hist > 0) longScore += 1;
  else if (macd.hist < 0) shortScore += 1;

  if (volRatio > 1.15 && last.close >= last.open) {
    longScore += 1;
    longWhy.push(`Volume is ${volRatio.toFixed(1)}× its 20-bar average on an up candle`);
  }
  if (volRatio > 1.15 && last.close < last.open) {
    shortScore += 1;
    shortWhy.push(`Volume is ${volRatio.toFixed(1)}× average on a down candle`);
  }

  if (higherLow) {
    longScore += 1;
    longWhy.push("Structure printed a higher low");
  }
  if (lowerHigh) {
    shortScore += 1;
    shortWhy.push("Structure printed a lower high");
  }

  const pullbackLong = last.close >= ema21 && last.close - ema21 < atrNow * 0.35;
  const pullbackShort = last.close <= ema21 && ema21 - last.close < atrNow * 0.35;
  if (pullbackLong) {
    longScore += 1;
    longWhy.push("Price is pulling back into the 21 EMA");
  }
  if (pullbackShort) {
    shortScore += 1;
    shortWhy.push("Price is pulling back into the 21 EMA");
  }

  const diff = longScore - shortScore;
  let bias: Bias = "flat";
  if (longScore >= 6 && diff >= 3) bias = "long";
  else if (shortScore >= 6 && diff <= -3) bias = "short";

  const entry = last.close;
  let stop = bias === "short" ? Math.max(swingHi, entry + atrNow * 1.35) : Math.min(swingLo, entry - atrNow * 1.35);
  if (bias !== "short" && entry - stop < atrNow * 0.6) stop = entry - atrNow * 1.35;
  if (bias === "short" && stop - entry < atrNow * 0.6) stop = entry + atrNow * 1.35;
  const risk = Math.max(Math.abs(entry - stop), atrNow * 0.6);
  stop = bias === "short" ? entry + risk : entry - risk;
  const target = bias === "short" ? entry - risk * 2.2 : entry + risk * 2.2;
  const target2 = bias === "short" ? entry - risk * 3.4 : entry + risk * 3.4;
  const rr = 2.2;

  const spread = Math.abs(ema9 - ema55) / last.close;
  const regime =
    atrNow / last.close > 0.018 ? "Wide range" : spread < 0.004 ? "Balance" : bias === "flat" ? "Chop" : "Trend";

  const mag = Math.abs(diff);
  const confidence =
    bias === "flat"
      ? clamp(Math.round(42 + (4 - mag) * 8), 36, 78)
      : clamp(Math.round(52 + mag * 6 + Math.min(longScore, shortScore === 0 ? longScore : Math.max(longScore, shortScore))), 58, 94);

  const why = (bias === "short" ? shortWhy : bias === "long" ? longWhy : [...longWhy, ...shortWhy]).slice(0, 4);
  const frame = INTERVAL_LABEL[interval];
  const sideWord = bias === "long" ? "long" : bias === "short" ? "short" : "flat";
  const summary =
    bias === "flat"
      ? `${frame} tape is a ${regime.toLowerCase()} regime. Confluence is split, so the engine stands aside instead of forcing a side. Wait for the EMA stack and MACD to agree before sizing.`
      : `${frame} read is ${sideWord} in a ${regime.toLowerCase()} regime. ${why.slice(0, 2).join(". ")}. The idea is wrong on a close through the protective shelf.`;

  const reasons = why.length
    ? why
    : ["No single factor is dominant", regime === "Chop" ? "Range conditions" : "Mixed momentum"];

  return {
    bias,
    confidence,
    entry,
    stop,
    target,
    target2,
    rr,
    rsi: rsiNow,
    atr: atrNow,
    ema9,
    ema21,
    ema55,
    macdHist: macd.hist,
    volRatio,
    regime,
    reasons,
    summary,
  };
}

export function flipMarkers(candles: Candle[], interval: Interval): { time: number; bias: Bias }[] {
  const out: { time: number; bias: Bias }[] = [];
  let prev: Bias = "flat";
  for (let i = 80; i <= candles.length; i += 6) {
    const slice = candles.slice(0, i);
    const sig = buildSignal(slice, interval);
    const bar = slice[slice.length - 1];
    if (!sig || !bar) continue;
    if (sig.bias !== "flat" && sig.bias !== prev) {
      out.push({ time: bar.time, bias: sig.bias });
      prev = sig.bias;
    } else if (sig.bias === "flat") {
      prev = "flat";
    }
  }
  return out.slice(-7);
}
