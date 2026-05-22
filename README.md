# quelora-enterprise

**Enterprise backend modules for the [Quelora](https://github.com/Quelora) platform.**

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](./LICENSE)

The optional `@quelora/enterprise` package. When present, it extends the
Quelora APIs with advanced capabilities; when absent, every API degrades
cleanly to **Community Edition**.

## Modules

| Module | Capability |
|--------|-----------|
| `surveys` | Polls and feedback forms |
| `gamification` | Points, badges, levels, quests, leaderboards |
| `advertising` | Campaigns, placements, advertiser accounts |
| `network` | Real-time transport — Server-Sent Events + chat |
| `resilience` | Offline fallback and P2P sync (ed25519, peer scoring) |
| `push` | Web Push activity delivery |
| `liveMode` | Live broadcast threads |

## Activation

Modules are loaded at runtime via `featureLoader('@quelora/enterprise')` and
enabled **per client** through `Client.enterpriseModules`. Every enterprise
call site in the core APIs is guarded with optional chaining, so a missing or
disabled module never breaks the platform.

## Requirements

- Node.js 20+ · MongoDB 4.4+ · Redis 6+

## Architecture

Depends on [`@quelora/common`](https://github.com/Quelora/quelora-common).
Consumed by [`quelora-public-api`](https://github.com/Quelora/quelora-public-api)
and [`quelora-dashboard-api`](https://github.com/Quelora/quelora-dashboard-api).
The matching client-side modules live in
[`quelora-widget-enterprise`](https://github.com/Quelora/quelora-widget-enterprise).

## License

[AGPL-3.0-only](./LICENSE) — Copyright (C) 2026 Germán Zelaya.

Part of the **[Quelora](https://github.com/Quelora)** project.
