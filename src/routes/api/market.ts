import { createFileRoute } from "@tanstack/react-router";
import { buildSignal, parseKlines } from "@/lib/ta";
import { INTERVALS, UNIVERSE, isInterval, isSymbol } from "@/lib/universe";

const ORIGIN = "https://data-api.binance.vision";

const mem = new Map<string, { at: number; body: string }>();

async function pull(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return res.json();
}

function cached(key: string, ttl: number, load: () => Promise<unknown>): Promise<unknown> {
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at < ttl) return Promise.resolve(JSON.parse(hit.body) as unknown);
  return load().then((body) => {
    mem.set(key, { at: Date.now(), body: JSON.stringify(body) });
    return body;
  });
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export const Route = createFileRoute("/api/market")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const kind = url.searchParams.get("kind") ?? "tickers";
        try {
          if (kind === "tickers") {
            const body = await cached("tickers", 5000, async () => {
              const symbols = encodeURIComponent(JSON.stringify(UNIVERSE.map((p) => p.symbol)));
              const raw = await pull(`${ORIGIN}/api/v3/ticker/24hr?symbols=${symbols}`);
              if (!Array.isArray(raw)) throw new Error("bad ticker payload");
              const tickers = raw.map((row) => {
                const t = row as Record<string, unknown>;
                return {
                  symbol: String(t.symbol ?? ""),
                  last: num(t.lastPrice),
                  change: num(t.priceChange),
                  changePct: num(t.priceChangePercent),
                  high: num(t.highPrice),
                  low: num(t.lowPrice),
                  volume: num(t.volume),
                  quoteVolume: num(t.quoteVolume),
                  bid: num(t.bidPrice),
                  ask: num(t.askPrice),
                };
              });
              return { asOf: Date.now(), tickers };
            });
            return Response.json(body);
          }

          if (kind === "klines") {
            const symbol = url.searchParams.get("symbol") ?? "";
            const interval = url.searchParams.get("interval") ?? "15m";
            if (!isSymbol(symbol) || !isInterval(interval)) {
              return Response.json({ error: "Unknown market" }, { status: 400 });
            }
            const body = await cached(`klines:${symbol}:${interval}`, 8000, async () => {
              const raw = await pull(`${ORIGIN}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=220`);
              return { asOf: Date.now(), symbol, interval, candles: parseKlines(raw) };
            });
            return Response.json(body);
          }

          if (kind === "depth") {
            const symbol = url.searchParams.get("symbol") ?? "";
            if (!isSymbol(symbol)) return Response.json({ error: "Unknown market" }, { status: 400 });
            const body = await cached(`depth:${symbol}`, 3000, async () => {
              const [depth, trades] = await Promise.all([
                pull(`${ORIGIN}/api/v3/depth?symbol=${symbol}&limit=18`),
                pull(`${ORIGIN}/api/v3/trades?symbol=${symbol}&limit=28`),
              ]);
              const d = depth as { bids?: [string, string][]; asks?: [string, string][] };
              const bids = (d.bids ?? []).slice(0, 12).map(([p, q]) => ({ price: num(p), qty: num(q) }));
              const asks = (d.asks ?? []).slice(0, 12).map(([p, q]) => ({ price: num(p), qty: num(q) }));
              const tape = (Array.isArray(trades) ? trades : []).map((row) => {
                const t = row as Record<string, unknown>;
                return {
                  id: num(t.id),
                  price: num(t.price),
                  qty: num(t.qty),
                  time: num(t.time),
                  sell: Boolean(t.isBuyerMaker),
                };
              });
              return { asOf: Date.now(), bids, asks, tape: tape.reverse() };
            });
            return Response.json(body);
          }

          if (kind === "scan") {
            const interval = url.searchParams.get("interval") ?? "15m";
            if (!isInterval(interval)) return Response.json({ error: "Unknown interval" }, { status: 400 });
            const body = await cached(`scan:${interval}`, 20000, async () => {
              const rows = await Promise.all(
                UNIVERSE.map(async (pair) => {
                  try {
                    const raw = await pull(
                      `${ORIGIN}/api/v3/klines?symbol=${pair.symbol}&interval=${interval}&limit=160`,
                    );
                    const candles = parseKlines(raw);
                    const signal = buildSignal(candles, interval);
                    if (!signal) return null;
                    return {
                      symbol: pair.symbol,
                      bias: signal.bias,
                      confidence: signal.confidence,
                      entry: signal.entry,
                      stop: signal.stop,
                      target: signal.target,
                      rr: signal.rr,
                      regime: signal.regime,
                      rsi: signal.rsi,
                    };
                  } catch {
                    return null;
                  }
                }),
              );
              return { asOf: Date.now(), interval, rows: rows.filter((r) => r != null) };
            });
            return Response.json(body);
          }

          return Response.json({ error: "Unknown kind", intervals: INTERVALS }, { status: 400 });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Feed failed";
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },
  },
});
