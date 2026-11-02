# Aurion

Live crypto paper desk. Binance spot prices, candlesticks, a confluence engine, order book, and a simulated 1x book that stays in the browser.

This is not a broker and not financial advice. Nothing here sends a real order.

## Run

```bash
npm install
npm run dev
```

Open the local dev URL. Pick a market, switch timeframe, and use Long / Short for a paper fill. Autopilot only arms when confidence is at least 64 and the target is 2.2R. Ask Grok writes one desk note for the setup on screen.
