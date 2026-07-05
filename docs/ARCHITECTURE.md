# Architecture

## Layers

```
UI (React + React Router + Tailwind)
        ↓
Pages (Dashboard, DirectMigration, Export, Import, Mapping, Explorer, Logs, Settings)
        ↓
Components (AppShell, Sidebar, Topbar, UI primitives, ServerCard)
        ↓
Stores (Zustand: serverStore, migrationStore, mappingStore, logStore)
        ↓
Services (fhirClient, scanner, downloader, mapper, bundleBuilder, uploader, reporter, migrationOrchestrator)
        ↓
FHIR HTTP (native fetch → FHIR server)
```

## Principles

- UI never calls `fetch` directly — all HTTP goes through `services/fhirClient.ts`
- Business logic lives in `services/` — pure TypeScript, no React
- State lives in Zustand stores — services read/write stores directly
- Types are strict — no `any`, all interfaces explicit

## Source Layout

```
src/
├── types/          # FHIR, server, mapping, migration types
├── store/          # Zustand stores (persisted where appropriate)
├── services/       # Pure business logic modules
├── components/
│   ├── layout/     # AppShell, Sidebar, Topbar
│   ├── ui/         # Button, Badge, Card, Input, Modal, ProgressBar, StatusDot
│   └── server/     # ServerCard
└── pages/          # One file per route
```

## HTTP

- Uses native browser `fetch` API (works in Tauri webview)
- `X-Tenant-Id` header added when `tenantId` is configured
- `Authorization: Bearer <token>` added when `auth.token` is configured
- No auth headers are sent if not configured
