# SWES — Full System Setup Guide

## Prerequisites

| Tool | Version |
|---|---|
| JDK | 17+ |
| Node.js | 18+ |
| pnpm | 8+ |

> Gradle Wrapper is bundled in `opentcs-integration-FMS/` — no global Gradle install needed.

---

## 1. OpenTCS — Kernel & Operations Desk

```bash
cd opentcs-integration-FMS
```

Start the **Kernel** (terminal 1):

```bash
./gradlew opentcs-FMS-kernel:run
```

Start the **Operations Desk** (terminal 2):

```bash
./gradlew opentcs-FMS-operationsdesk:run
```

> On Windows, use `gradlew.bat` instead of `./gradlew`.

---

## 2. WES Backend (NestJS)

```bash
cd wes
pnpm install
pnpm start:dev
```

---

## 3. WES Frontend (React + Vite)

```bash
cd wes-client
pnpm install
pnpm dev
```

---

## 4. Operating console — `wes-new-client-v2` (optional)

The redesigned operating screen (shadcn/Tailwind). Talks to the `wes` backend under
`/api/operating/*` via the Vite dev proxy, so it needs `wes` (§2) + the kernel (§1) running.

```bash
cd wes-new-client-v2
pnpm install
pnpm dev          # http://localhost:5174
```

- `.env`: `VITE_API_BASE_URL=/api`. The proxy targets `http://localhost:3001` — override with
  `VITE_API_TARGET` if `wes` runs on a different port (`wes/.env` `PORT`).
- Sign in with a `wes` account; the access token is stored like `wes-client`
  (`localStorage['wes.accessToken']`) and `wes` also sets a `wes_access` cookie so the SSE
  streams authenticate.
- All zone/store/cargo/dispatch logic is decided by `wes` — this is a UI layer only.
  See `wes/report/INTEGRATION-wes-new-client-v2.md`.
