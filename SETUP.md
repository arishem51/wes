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
