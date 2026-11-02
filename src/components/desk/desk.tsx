import { useEffect, useMemo, useState } from "react";
import * as Switch from "@radix-ui/react-switch";
import * as Tabs from "@radix-ui/react-tabs";
import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { toast } from "sonner";
import { Crosshair, RotateCcw, Sparkles } from "lucide-react";
import { briefSetup } from "@/lib/brief";
import { fmtCompact, fmtPct, fmtPx, fmtQty, fmtTime, fmtUsd, toneClass } from "@/lib/format";
import { equityOf, unrealized, useBook, type Side } from "@/lib/paper";
import { buildSignal, type Signal } from "@/lib/ta";
import { INTERVALS, pairOf, type Interval } from "@/lib/universe";
import { ChartPane } from "@/components/desk/chart-pane";
import { useClock, useDepth, useKlines, useScan, useTickers, useTypewriter, type ScanRow, type Ticker } from "@/components/desk/hooks";

export function Desk() {
  const symbol = useBook((s) => s.symbol);
  const interval = useBook((s) => s.interval);
  const autopilot = useBook((s) => s.autopilot);
  const riskPct = useBook((s) => s.riskPct);
  const cash = useBook((s) => s.cash);
  const positions = useBook((s) => s.positions);
  const fills = useBook((s) => s.fills);
  const curve = useBook((s) => s.curve);
  const dayStart = useBook((s) => s.dayStartEquity);
  const prices = useBook((s) => s.prices);
  const hydrated = useBook((s) => s.hydrated);

  const tickersQ = useTickers();
  const klinesQ = useKlines(symbol, interval);
  const scanQ = useScan(interval);
  const [tab, setTab] = useState("book");
  const depthQ = useDepth(symbol, tab === "book" || tab === "tape");
  const clock = useClock();
  const [confirmReset, setConfirmReset] = useState(false);
  const [note, setNote] = useState("");
  const [noteErr, setNoteErr] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);

  const tickers = tickersQ.data?.tickers ?? [];
  const ticker = tickers.find((t) => t.symbol === symbol);
  const candles = klinesQ.data?.candles ?? [];
  const signal = useMemo(() => (candles.length ? buildSignal(candles, interval) : null), [candles, interval]);
  const typed = useTypewriter(signal?.summary ?? "Reading the live tape…");
  const pair = pairOf(symbol);
  const equity = equityOf({ cash, positions, prices });
  const upnl = unrealized({ positions, prices });
  const day = equity - dayStart;
  const focusPos = positions.find((p) => p.symbol === symbol);

  useEffect(() => {
    void useBook.persist.rehydrate();
  }, []);

  useEffect(() => {
    if (!tickers.length) return;
    const map: Record<string, number> = {};
    for (const t of tickers) map[t.symbol] = t.last;
    for (const message of useBook.getState().mark(map)) toast(message);
  }, [tickersQ.data?.asOf, tickers.length]);

  useEffect(() => {
    if (!hydrated) return;
    const setups = [...(scanQ.data?.rows ?? [])];
    if (signal) {
      const focus = {
        symbol,
        bias: signal.bias,
        confidence: signal.confidence,
        entry: signal.entry,
        stop: signal.stop,
        target: signal.target,
        rr: signal.rr,
      };
      const idx = setups.findIndex((row) => row.symbol === symbol);
      const current = idx >= 0 ? setups[idx] : undefined;
      if (idx >= 0 && current) setups[idx] = { ...current, ...focus };
      else setups.push({ ...focus, regime: signal.regime, rsi: signal.rsi });
    }
    for (const message of useBook.getState().arm(setups)) toast(message);
  }, [hydrated, scanQ.data, signal, symbol]);

  useEffect(() => {
    setNote("");
    setNoteErr("");
  }, [symbol, interval, signal?.bias]);

  function pick(next: string) {
    useBook.getState().setFocus(next, interval);
  }

  function setIntervalFrame(next: Interval) {
    useBook.getState().setFocus(symbol, next);
  }

  function trade(side: Side) {
    const plan =
      signal && (signal.bias === side || signal.bias === "flat")
        ? { stopDist: Math.abs(signal.entry - signal.stop), rewardDist: Math.abs(signal.target - signal.entry) }
        : signal
          ? { stopDist: Math.abs(signal.entry - signal.stop), rewardDist: Math.abs(signal.target - signal.entry) }
          : undefined;
    const res = useBook.getState().manual(symbol, side, plan);
    toast(res.message);
  }

  async function askGrok() {
    if (!signal || !ticker || noteBusy) return;
    setNoteBusy(true);
    setNoteErr("");
    try {
      const res = await briefSetup({
        data: {
          symbol,
          interval,
          bias: signal.bias,
          confidence: signal.confidence,
          regime: signal.regime,
          price: ticker.last,
          stop: signal.stop,
          target: signal.target,
          rsi: Number(signal.rsi.toFixed(1)),
          volRatio: Number(signal.volRatio.toFixed(2)),
          reasons: signal.reasons,
        },
      });
      if (!res.ok) setNoteErr(res.error);
      else setNote(res.text);
    } catch (error) {
      setNoteErr(error instanceof Error ? error.message : "Grok note failed");
    } finally {
      setNoteBusy(false);
    }
  }

  const spreadBps =
    ticker && ticker.bid > 0 && ticker.ask > 0 ? ((ticker.ask - ticker.bid) / ((ticker.ask + ticker.bid) / 2)) * 10000 : 0;
  const range =
    ticker && ticker.high > ticker.low ? ((ticker.last - ticker.low) / (ticker.high - ticker.low)) * 100 : 50;

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="border-b border-line bg-bg-raised/90">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-3 px-3 py-3 lg:flex-row lg:items-center lg:justify-between lg:px-4">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg border border-line-strong bg-surface text-gold">
              <Crosshair className="size-4" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-semibold tracking-wide">AURION</h1>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-xs text-up">
                  <span className="live-dot" />
                  Live
                </span>
              </div>
              <p className="text-xs text-faint">Paper desk · Binance spot · 1x isolated</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[36rem]">
            <Stat label="Equity" value={fmtUsd(equity)} />
            <Stat label="Day" value={fmtUsd(day)} tone={day} />
            <Stat label="Open P&L" value={fmtUsd(upnl)} tone={upnl} />
            <Stat label="Cash" value={fmtUsd(cash)} hint={clock || "UTC"} />
          </div>
        </div>
      </header>

      <div className="overflow-hidden border-b border-line bg-bg">
        {tickers.length === 0 ? (
          <p className="px-4 py-2 text-xs text-faint">Connecting the Binance tape…</p>
        ) : (
          <div className="marquee gap-6 py-2">
            {[...tickers, ...tickers].map((t, i) => (
              <button
                key={`${t.symbol}-${i}`}
                className="flex items-baseline gap-2 text-xs"
                onClick={() => pick(t.symbol)}
              >
                <span className="font-semibold">{pairOf(t.symbol).base}</span>
                <span className="num text-fg">{fmtPx(t.last)}</span>
                <span className={`num ${toneClass(t.changePct)}`}>{fmtPct(t.changePct)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {tickersQ.isError && (
        <p className="mx-auto max-w-[1600px] px-4 py-2 text-sm text-down">
          Market feed unavailable.{" "}
          <button className="underline" onClick={() => void tickersQ.refetch()}>
            Retry
          </button>
        </p>
      )}

      <main className="desk-grid mx-auto flex max-w-[1600px] flex-col gap-3 p-3 lg:p-4">
        <aside className="order-3 flex min-w-0 flex-col gap-3 lg:order-none lg:row-span-2">
          <section className="panel p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-faint">Markets</h2>
              <span className="text-xs text-faint">{tickers.length || "—"}</span>
            </div>
            <div className="flex gap-2 overflow-x-auto desk-scroll pb-1 lg:flex-col lg:overflow-visible">
              {(tickers.length ? tickers : UNIVERSE_PLACEHOLDERS).map((t) => {
                const meta = pairOf(t.symbol);
                const on = t.symbol === symbol;
                return (
                  <button
                    key={t.symbol}
                    onClick={() => pick(t.symbol)}
                    className={`panel min-w-40 shrink-0 px-3 py-2 text-left lg:min-w-0 lg:w-full ${on ? "panel-on" : ""}`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold">{meta.base}</span>
                      <span className={`num text-xs ${toneClass(t.changePct)}`}>{fmtPct(t.changePct)}</span>
                    </div>
                    <div className="mt-0.5 flex items-baseline justify-between gap-2">
                      <span className="text-xs text-faint">{meta.name}</span>
                      <span className="num text-sm">{t.last ? fmtPx(t.last) : "—"}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
          <Radar rows={scanQ.data?.rows ?? []} symbol={symbol} loading={scanQ.isLoading} onPick={pick} />
        </aside>

        <section className="panel order-1 min-w-0 overflow-hidden lg:order-none">
          <div className="flex flex-col gap-3 border-b border-line p-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <h2 className="text-xl font-semibold">{pair.base}</h2>
                <span className="text-sm text-muted">{pair.name}</span>
                <span className="text-xs uppercase tracking-wider text-faint">{signal?.regime ?? "…"}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-end gap-3">
                <FlashPrice value={ticker?.last ?? signal?.entry ?? 0} />
                {ticker && (
                  <span className={`num pb-1 text-sm ${toneClass(ticker.changePct)}`}>
                    {fmtPct(ticker.changePct)} · {fmtUsd(ticker.change)}
                  </span>
                )}
              </div>
              {ticker && (
                <div className="mt-2 max-w-xs">
                  <div className="meter h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <span className="block h-full rounded-full bg-gold" style={{ width: `${Math.max(2, Math.min(100, range))}%` }} />
                  </div>
                  <div className="mt-1 flex justify-between text-xs num text-faint">
                    <span>L {fmtPx(ticker.low)}</span>
                    <span>24h range</span>
                    <span>H {fmtPx(ticker.high)}</span>
                  </div>
                </div>
              )}
            </div>
            <div className="flex flex-col items-start gap-2 sm:items-end">
              <div className="flex flex-wrap gap-1.5">
                {INTERVALS.map((item) => (
                  <button
                    key={item}
                    className={item === interval ? "chip chip-on" : "chip"}
                    onClick={() => setIntervalFrame(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
              {ticker && (
                <p className="text-xs num text-faint">
                  Vol {fmtCompact(ticker.quoteVolume)} · spread {spreadBps.toFixed(1)} bps
                </p>
              )}
            </div>
          </div>
          {klinesQ.isError ? (
            <p className="p-6 text-sm text-down">
              Candles failed to load.{" "}
              <button className="underline" onClick={() => void klinesQ.refetch()}>
                Retry
              </button>
            </p>
          ) : (
            <ChartPane candles={candles} interval={interval} focusKey={`${symbol}:${interval}`} />
          )}
          <div className="flex gap-4 border-t border-line px-3 py-2 text-xs text-faint">
            <Legend swatch="bg-gold" label="EMA 9" />
            <Legend swatch="bg-fg" label="EMA 21" />
            <Legend swatch="bg-faint" label="EMA 55" />
            <span className="ml-auto hidden sm:inline">Arrows mark confluence flips</span>
          </div>
        </section>

        <section className="order-2 flex min-w-0 flex-col gap-3 lg:order-none">
          <SignalCard signal={signal} typed={typed} price={ticker?.last} />
          <div className="panel p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-faint">Execution</h2>
                <p className="mt-1 text-xs text-muted">Risk {riskPct}% of equity to the stop · fees 4 bps</p>
              </div>
              <div className="flex gap-1">
                {([0.5, 1, 2] as const).map((n) => (
                  <button
                    key={n}
                    className={riskPct === n ? "chip chip-on" : "chip"}
                    onClick={() => useBook.getState().setRisk(n)}
                  >
                    {n}%
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn btn-long" onClick={() => trade("long")}>
                Long {pair.base}
              </button>
              <button className="btn btn-short" onClick={() => trade("short")}>
                Short {pair.base}
              </button>
            </div>
            <button
              className="btn mt-2 w-full"
              disabled={!focusPos && positions.length === 0}
              onClick={() => {
                for (const message of useBook.getState().flatten(focusPos ? symbol : undefined)) toast(message);
              }}
            >
              {focusPos ? `Flatten ${pair.base}` : "Flatten book"}
            </button>
            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-line bg-bg-raised px-3 py-2">
              <div>
                <p className="text-sm font-semibold">Autopilot</p>
                <p className="text-xs text-faint">Arms at 64+ confidence and 2.2R. Flips only above 72.</p>
              </div>
              <Switch.Root
                className="switch"
                checked={autopilot}
                onCheckedChange={(on) => useBook.getState().setAutopilot(on)}
                aria-label="Toggle autopilot"
              >
                <Switch.Thumb className="switch-thumb" />
              </Switch.Root>
            </div>
          </div>
          {focusPos && <PositionCard symbol={symbol} />}
          <div className="panel p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-faint">Grok desk note</h2>
                <p className="mt-1 text-xs text-muted">One read of this setup. Nothing is sent until you ask.</p>
              </div>
              <button className="btn btn-gold" disabled={!signal || noteBusy} onClick={() => void askGrok()}>
                <Sparkles className="size-4" />
                {noteBusy ? "Reading…" : "Ask Grok"}
              </button>
            </div>
            {note && <p className="rise mt-3 text-sm leading-relaxed text-fg">{note}</p>}
            {noteErr && <p className="mt-3 text-sm text-down">{noteErr}</p>}
          </div>
          <div className="flex items-center justify-between gap-2 px-1">
            <p className="text-xs leading-relaxed text-faint">
              Paper only. Not financial advice. Signals are a transparent confluence score on live candles.
            </p>
            {confirmReset ? (
              <button
                className="btn btn-short shrink-0"
                onClick={() => {
                  useBook.getState().reset();
                  setConfirmReset(false);
                  toast("Book reset to $100,000");
                }}
              >
                Confirm
              </button>
            ) : (
              <button className="btn shrink-0" onClick={() => setConfirmReset(true)}>
                <RotateCcw className="size-4" />
                Reset
              </button>
            )}
          </div>
        </section>

        <section className="panel order-4 min-w-0 p-3 lg:order-none lg:col-span-2">
          <Tabs.Root value={tab} onValueChange={setTab}>
            <Tabs.List className="mb-3 flex gap-1.5 overflow-x-auto desk-scroll">
              {[
                ["book", "Book"],
                ["tape", "Tape"],
                ["journal", "Journal"],
                ["stats", "Stats"],
              ].map(([id, label]) => (
                <Tabs.Trigger key={id} value={id} className={tab === id ? "chip chip-on" : "chip"}>
                  {label}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            <Tabs.Content value="book">
              <BookView
                bids={depthQ.data?.bids ?? []}
                asks={depthQ.data?.asks ?? []}
                loading={depthQ.isLoading}
                error={depthQ.isError}
              />
            </Tabs.Content>
            <Tabs.Content value="tape">
              <TapeView rows={depthQ.data?.tape ?? []} loading={depthQ.isLoading} />
            </Tabs.Content>
            <Tabs.Content value="journal">
              <Journal fills={fills} />
            </Tabs.Content>
            <Tabs.Content value="stats">
              <Stats fills={fills} curve={curve} equity={equity} positions={positions.length} cash={cash} />
            </Tabs.Content>
          </Tabs.Root>
        </section>
      </main>
    </div>
  );
}

const UNIVERSE_PLACEHOLDERS: Ticker[] = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "DOGEUSDT",
].map((symbol) => ({
  symbol,
  last: 0,
  change: 0,
  changePct: 0,
  high: 0,
  low: 0,
  volume: 0,
  quoteVolume: 0,
  bid: 0,
  ask: 0,
}));

function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: number; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <p className="text-xs uppercase tracking-wider text-faint">{label}</p>
      <p className={`num text-sm font-medium ${tone == null ? "text-fg" : toneClass(tone)}`}>{value}</p>
      {hint && <p className="text-xs text-faint">{hint}</p>}
    </div>
  );
}

function FlashPrice({ value }: { value: number }) {
  const [dir, setDir] = useState<"up" | "down" | null>(null);
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    if (value > prev) setDir("up");
    else if (value < prev) setDir("down");
  }
  useEffect(() => {
    if (!dir) return;
    const id = window.setTimeout(() => setDir(null), 550);
    return () => window.clearTimeout(id);
  }, [dir, value]);

  return (
    <span className={`num rounded-md px-1 text-3xl font-semibold ${dir === "up" ? "flash-up" : dir === "down" ? "flash-down" : ""}`}>
      {value ? fmtPx(value) : "—"}
    </span>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-0.5 w-4 ${swatch}`} />
      {label}
    </span>
  );
}

function Radar({
  rows,
  symbol,
  loading,
  onPick,
}: {
  rows: ScanRow[];
  symbol: string;
  loading: boolean;
  onPick: (symbol: string) => void;
}) {
  const ranked = [...rows].sort((a, b) => {
    const af = a.bias === "flat" ? 0 : 1;
    const bf = b.bias === "flat" ? 0 : 1;
    if (af !== bf) return bf - af;
    return b.confidence - a.confidence;
  });
  return (
    <section className="panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-faint">Confluence radar</h2>
        {loading && <span className="text-xs text-gold">Scanning</span>}
      </div>
      {ranked.length === 0 ? (
        <div className="space-y-2">
          <div className="skel h-8" />
          <div className="skel h-8" />
          <div className="skel h-8" />
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-2 lg:grid-cols-1">
          {ranked.map((row, i) => (
            <li key={row.symbol} className="rise" style={{ animationDelay: `${i * 30}ms` }}>
              <button
                onClick={() => onPick(row.symbol)}
                className={`flex w-full items-center justify-between gap-2 rounded-md border border-line px-2 py-2 text-left ${
                  row.symbol === symbol ? "panel-on" : "bg-bg-raised"
                }`}
              >
                <span className="font-semibold">{pairOf(row.symbol).base}</span>
                <span className={`text-xs font-semibold uppercase ${row.bias === "long" ? "text-up" : row.bias === "short" ? "text-down" : "text-faint"}`}>
                  {row.bias}
                </span>
                <span className="num text-xs text-gold">{row.confidence}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SignalCard({ signal, typed, price }: { signal: Signal | null; typed: string; price?: number }) {
  const bias = signal?.bias ?? "flat";
  const tone = bias === "long" ? "text-up" : bias === "short" ? "text-down" : "text-muted";
  const conf = signal?.confidence ?? 0;
  return (
    <section className="panel p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-faint">Engine</p>
          <p className={`mt-1 text-3xl font-semibold uppercase ${tone}`}>{bias === "flat" ? "Stand aside" : bias}</p>
          <p className="mt-1 text-xs text-muted">{signal ? `${signal.regime} · RSI ${signal.rsi.toFixed(0)} · vol ${signal.volRatio.toFixed(2)}×` : "Waiting for candles"}</p>
        </div>
        <Ring value={conf} />
      </div>
      <p className="mt-3 min-h-16 text-sm leading-relaxed text-fg">{typed}</p>
      {signal && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {signal.reasons.map((reason) => (
            <li key={reason} className="rounded-full border border-line px-2 py-1 text-xs text-muted">
              {reason}
            </li>
          ))}
        </ul>
      )}
      {signal && (
        <dl className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
          <Level k="Stop" v={fmtPx(signal.stop)} className="text-down" />
          <Level k="Entry" v={fmtPx(price ?? signal.entry)} className="text-fg" />
          <Level k="Target" v={fmtPx(signal.target)} className="text-up" />
          <Level k="Stretch" v={fmtPx(signal.target2)} className="text-gold" />
        </dl>
      )}
    </section>
  );
}

function Level({ k, v, className }: { k: string; v: string; className: string }) {
  return (
    <div className="rounded-md bg-bg-raised px-1 py-2">
      <dt className="text-xs uppercase tracking-wider text-faint">{k}</dt>
      <dd className={`num mt-1 text-xs font-medium ${className}`}>{v}</dd>
    </div>
  );
}

function Ring({ value }: { value: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(100, value)) / 100);
  return (
    <svg viewBox="0 0 72 72" className="size-16 shrink-0" aria-label={`Confidence ${value}`}>
      <circle cx="36" cy="36" r={r} fill="none" stroke="var(--color-line)" strokeWidth="5" />
      <circle
        cx="36"
        cy="36"
        r={r}
        fill="none"
        stroke="var(--color-gold)"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={off}
        transform="rotate(-90 36 36)"
      />
      <text x="36" y="40" textAnchor="middle" fill="currentColor" fontSize="14" fontFamily="IBM Plex Mono, monospace">
        {value}
      </text>
    </svg>
  );
}

function PositionCard({ symbol }: { symbol: string }) {
  const pos = useBook((s) => s.positions.find((p) => p.symbol === symbol));
  const px = useBook((s) => s.prices[symbol]);
  if (!pos || px == null) return null;
  const dir = pos.side === "long" ? 1 : -1;
  const pnl = (px - pos.entry) * pos.qty * dir;
  return (
    <section className="panel p-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-faint">Open {pos.side}</h2>
        <span className={`num text-sm font-medium ${toneClass(pnl)}`}>{fmtUsd(pnl)}</span>
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-faint">Qty</dt>
          <dd className="num">{fmtQty(pos.qty)}</dd>
        </div>
        <div>
          <dt className="text-faint">Entry</dt>
          <dd className="num">{fmtPx(pos.entry)}</dd>
        </div>
        <div>
          <dt className="text-faint">Mark</dt>
          <dd className="num">{fmtPx(px)}</dd>
        </div>
        <div>
          <dt className="text-faint">Stop</dt>
          <dd className="num text-down">{fmtPx(pos.stop)}</dd>
        </div>
        <div>
          <dt className="text-faint">Target</dt>
          <dd className="num text-up">{fmtPx(pos.target)}</dd>
        </div>
        <div>
          <dt className="text-faint">Margin</dt>
          <dd className="num">{fmtUsd(pos.margin, 0)}</dd>
        </div>
      </dl>
    </section>
  );
}

function BookView({
  bids,
  asks,
  loading,
  error,
}: {
  bids: { price: number; qty: number }[];
  asks: { price: number; qty: number }[];
  loading: boolean;
  error: boolean;
}) {
  if (error) return <p className="text-sm text-down">Order book unavailable.</p>;
  if (loading && bids.length === 0) return <div className="skel h-40" />;
  const max = Math.max(1, ...bids.map((r) => r.qty), ...asks.map((r) => r.qty));
  const bestAsk = asks[0]?.price ?? 0;
  const bestBid = bids[0]?.price ?? 0;
  const mid = bestAsk && bestBid ? (bestAsk + bestBid) / 2 : 0;
  const bps = mid ? ((bestAsk - bestBid) / mid) * 10000 : 0;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <BookSide title="Bids" rows={bids} max={max} up />
      <div>
        <div className="mb-1 flex items-center justify-between text-xs text-faint">
          <span>Asks</span>
          <span className="num">spread {bps.toFixed(2)} bps</span>
        </div>
        <BookSide title="" rows={[...asks].reverse()} max={max} up={false} />
      </div>
    </div>
  );
}

function BookSide({
  title,
  rows,
  max,
  up,
}: {
  title: string;
  rows: { price: number; qty: number }[];
  max: number;
  up: boolean;
}) {
  return (
    <div>
      {title && <p className="mb-1 text-xs text-faint">{title}</p>}
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.price} className="relative overflow-hidden rounded-sm">
            <span
              className={`absolute inset-y-0 ${up ? "right-0 bg-up-dim" : "left-0 bg-down-dim"}`}
              style={{ width: `${(row.qty / max) * 100}%` }}
            />
            <span className="relative flex justify-between px-2 py-1 text-xs num">
              <span className={up ? "text-up" : "text-down"}>{fmtPx(row.price)}</span>
              <span className="text-muted">{fmtQty(row.qty)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TapeView({
  rows,
  loading,
}: {
  rows: { id: number; price: number; qty: number; time: number; sell: boolean }[];
  loading: boolean;
}) {
  if (loading && rows.length === 0) return <div className="skel h-40" />;
  const max = Math.max(1, ...rows.map((r) => r.qty));
  return (
    <ul className="max-h-72 space-y-1 overflow-auto desk-scroll">
      {rows.map((row) => (
        <li key={row.id} className="rise grid grid-cols-[4.5rem_1fr_auto] items-center gap-2 text-xs num">
          <span className="text-faint">{fmtTime(row.time)}</span>
          <span className="relative h-5">
            <span
              className={`absolute inset-y-0 left-0 rounded-sm ${row.sell ? "bg-down-dim" : "bg-up-dim"}`}
              style={{ width: `${Math.max(6, (row.qty / max) * 100)}%` }}
            />
          </span>
          <span className={row.sell ? "text-down" : "text-up"}>
            {fmtPx(row.price)} · {fmtQty(row.qty)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Journal({ fills }: { fills: import("@/lib/paper").Fill[] }) {
  const closed = fills.filter((f) => f.action === "close");
  if (closed.length === 0) {
    return <p className="text-sm text-muted">No closed paper trades yet. Take a side, or arm the pilot.</p>;
  }
  return (
    <ul className="max-h-72 space-y-2 overflow-auto desk-scroll">
      {closed.map((fill) => (
        <li key={fill.id} className="grid grid-cols-[4.5rem_3rem_1fr_auto] items-baseline gap-2 text-sm">
          <span className="num text-xs text-faint">{fmtTime(fill.ts)}</span>
          <span className="font-semibold">{pairOf(fill.symbol).base}</span>
          <span className="text-xs uppercase text-muted">
            {fill.side} · {fill.reason}
          </span>
          <span className={`num ${toneClass(fill.pnl ?? 0)}`}>{fmtUsd(fill.pnl ?? 0)}</span>
        </li>
      ))}
    </ul>
  );
}

function Stats({
  fills,
  curve,
  equity,
  positions,
  cash,
}: {
  fills: import("@/lib/paper").Fill[];
  curve: { t: number; equity: number }[];
  equity: number;
  positions: number;
  cash: number;
}) {
  const closed = fills.filter((f) => f.action === "close" && f.pnl != null);
  const wins = closed.filter((f) => (f.pnl ?? 0) > 0);
  const losses = closed.filter((f) => (f.pnl ?? 0) < 0);
  const grossWin = wins.reduce((a, f) => a + (f.pnl ?? 0), 0);
  const grossLoss = Math.abs(losses.reduce((a, f) => a + (f.pnl ?? 0), 0));
  const pf = grossLoss === 0 ? (grossWin > 0 ? Infinity : 0) : grossWin / grossLoss;
  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
  const expectancy = closed.length ? closed.reduce((a, f) => a + (f.pnl ?? 0), 0) / closed.length : 0;
  let peak = curve[0]?.equity ?? equity;
  let maxDd = 0;
  for (const point of curve) {
    peak = Math.max(peak, point.equity);
    maxDd = Math.max(maxDd, peak > 0 ? (peak - point.equity) / peak : 0);
  }
  const exposure = equity > 0 ? ((equity - cash) / equity) * 100 : 0;
  return (
    <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={curve}>
            <YAxis hide domain={["auto", "auto"]} />
            <Tooltip
              formatter={(value) => fmtUsd(Number(value))}
              labelFormatter={(label) => fmtTime(Number(label))}
              contentStyle={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-line)",
                borderRadius: 12,
                color: "var(--color-fg)",
              }}
            />
            <Area dataKey="equity" stroke="var(--color-gold)" fill="var(--color-gold)" fillOpacity={0.16} strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <dl className="grid grid-cols-2 gap-2">
        <Stat label="Win rate" value={closed.length ? `${winRate.toFixed(0)}%` : "—"} />
        <Stat label="Profit factor" value={closed.length ? (pf === Infinity ? "∞" : pf.toFixed(2)) : "—"} />
        <Stat label="Expectancy" value={closed.length ? fmtUsd(expectancy) : "—"} tone={expectancy} />
        <Stat label="Max DD" value={`${(maxDd * 100).toFixed(1)}%`} tone={maxDd > 0 ? -1 : 0} />
        <Stat label="Trades" value={String(closed.length)} />
        <Stat label="Exposure" value={`${exposure.toFixed(0)}% · ${positions} open`} />
      </dl>
    </div>
  );
}
