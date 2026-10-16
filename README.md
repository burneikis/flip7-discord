# Flip 7: With a Vengeance - Discord Activity

Private, for-our-own-group implementation of *Flip 7: With a Vengeance*
(The Op / USAopoly). Not for distribution.

## Quick start

```bash
npm install
npm run dev        # server :3001 (dev mode) + Vite client :5173
```

Then open one of:

| URL | What |
|---|---|
| http://localhost:5173/dev.html | **Test harness**: 3 players side by side in one tab (`?players=1..6&room=x`) |
| http://localhost:5173/?room=test | Single player view. Open more tabs/browsers with the same `room` to add players |
| http://localhost:5173/?room=test&name=Bob&pid=bob | Fixed identity (handy for multiple tabs in the same browser) |

In the lobby, the host can **Add bot** to fill seats, so you can play solo.
Friends on your LAN/Tailscale can join via `http://<your-ip>:5173/?room=test`.

### Dev-mode tools
- **DEV next card** (top bar): put any card on top of the deck to test
  specific situations (Unlucky 7, Swap, Flip Four...).
- `BOT_DELAY_MS=300 npm run dev` speeds bots up.

### Tests

```bash
npm test           # rules engine: every special card, FAQ rulings, 40 bot-only games
npm run typecheck
```

### Production-style run

```bash
npm run build && npm start     # one port (3001) serves client + websocket
```

## Layout

```
src/shared/cards.ts     deck composition (DECK_COUNTS), card helpers
src/shared/scoring.ts   bust / Flip 7 / score calculation
src/shared/engine.ts    server-authoritative rules engine (task queue + prompts)
src/shared/bot.ts       heuristic bot (also plays for disconnected players after 15s)
src/server/index.ts     HTTP + WebSocket rooms
src/client/             React UI; identity.ts is where the Discord SDK will plug in
dev.html                multi-player test harness
```

## Rules decisions

From the rulebook plus the official FAQ (theop.games/pages/flip-7-wav-faqs):
- Action/Modifier cards are given to any non-busted player (including stayed
  players); the receiver must use an Action if any valid target exists,
  otherwise it is discarded.
- Swap and Steal can bust players (both at once with a Swap).
- Unlucky 7 discards everything else, even an existing 7, and also triggers
  when gained by Steal/Swap. Lucky 13 allows exactly one other 13.
- Flip Four: stop on a bust/Flip 7; Actions/Modifiers flipped are resolved in
  order afterwards; a bust discards them. A target who had stayed remains stayed.
- Just One More: take one card (resolve it if it's an Action), then stay.
- Holding the Zero: you can't choose to stay.
- Brutal mode: negative round scores, Modifiers may hit busted players,
  Flip 7 may take 15 from another player instead of +15.

## Next: Discord

Not done yet. Plan: Embedded App SDK in `src/client/identity.ts`
(Discord user id/name, `instanceId` as room), OAuth token exchange endpoint on
the server, cloudflared tunnel + URL mapping in the Developer Portal.
