export const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
export type Interval = (typeof INTERVALS)[number];

export const INTERVAL_LABEL: Record<Interval, string> = {
  "1m": "1-minute",
  "5m": "5-minute",
  "15m": "15-minute",
  "1h": "1-hour",
  "4h": "4-hour",
  "1d": "daily",
};

export type Pair = {
  symbol: string;
  base: string;
  name: string;
};

export const UNIVERSE: Pair[] = [
  { symbol: "BTCUSDT", base: "BTC", name: "Bitcoin" },
  { symbol: "ETHUSDT", base: "ETH", name: "Ethereum" },
  { symbol: "SOLUSDT", base: "SOL", name: "Solana" },
  { symbol: "BNBUSDT", base: "BNB", name: "BNB" },
  { symbol: "XRPUSDT", base: "XRP", name: "XRP" },
  { symbol: "DOGEUSDT", base: "DOGE", name: "Dogecoin" },
  { symbol: "AVAXUSDT", base: "AVAX", name: "Avalanche" },
  { symbol: "LINKUSDT", base: "LINK", name: "Chainlink" },
  { symbol: "ADAUSDT", base: "ADA", name: "Cardano" },
  { symbol: "SUIUSDT", base: "SUI", name: "Sui" },
  { symbol: "TONUSDT", base: "TON", name: "Toncoin" },
  { symbol: "NEARUSDT", base: "NEAR", name: "NEAR" },
];

const SYMBOLS = new Set(UNIVERSE.map((p) => p.symbol));

export function isSymbol(value: string): boolean {
  return SYMBOLS.has(value);
}

export function isInterval(value: string): value is Interval {
  return (INTERVALS as readonly string[]).includes(value);
}

export function pairOf(symbol: string): Pair {
  return UNIVERSE.find((p) => p.symbol === symbol) ?? { symbol, base: symbol.replace(/USDT$/, ""), name: symbol };
}
