# @gamercury/bantam-sdk

Browser TypeScript client for [Bantam](https://bantam.trugraph.io) — optional login, queued run submit, leaderboards, feature flags, economy (wallet, shop, IAP), and player deletion.

```bash
npm install @gamercury/bantam-sdk
```

```ts
import { BantamClient, BrowserStorage } from "@gamercury/bantam-sdk";

const bantam = new BantamClient({
  baseUrl: "https://bantam-api.trugraph.io",
  gameId: "my-game",
  storage: new BrowserStorage(),
});

const result = await bantam.optionalLogin(() => getServerAuthCode());
await bantam.queueBest({
  gameId: "my-game",
  adapterId: "generic:high_score",
  runId: crypto.randomUUID(),
  payload: { high_score: 42 },
  candidates: [{ boardId: "high_score", periodKey: "all_time", value: 42, direction: "higher" }],
});

const flags = await bantam.getFlags();
if (await bantam.isEnabled("daily_challenge")) enableDailyMode();

const { balances } = await bantam.getWallet();
await bantam.purchaseItem("life_pack", crypto.randomUUID());
```

Publish workflow (maintainers): see [SDK publish](https://bantam.trugraph.io/sdk/). Do not publish the server package `@gamercury/bantam`.

This package is MIT (`LICENSE`). The Bantam server is AGPL-3.0-or-later; embedding this client does not license your game under the AGPL.
