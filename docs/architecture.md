# Architecture — bubble-io-cli

This document describes the internal structure, design decisions, and command flow of `bubble-io-cli`.

---

## Overview

`bubble-io-cli` is a modular Node.js CLI built with TypeScript and Commander. It follows a strict **three-layer architecture** to ensure clean separation of concerns and long-term maintainability.

```
┌─────────────────────────────────────────────────────┐
│                  CLI Layer (User-facing)             │
│   src/index.ts  ──►  src/commands/*.ts              │
│   Commander routing, spinners (ora), colors (chalk) │
└─────────────────────────────┬───────────────────────┘
                              │ calls
┌─────────────────────────────▼───────────────────────┐
│                  Service Layer (Business Logic)      │
│   src/services/bubble-api.ts                        │
│   Axios HTTP client, pagination, error normalisation │
└─────────────────────────────┬───────────────────────┘
                              │ reads/writes
┌─────────────────────────────▼───────────────────────┐
│                  Utility Layer (Infrastructure)      │
│   src/utils/storage.ts                              │
│   Configstore, fs/promises, JSON serialisation      │
└─────────────────────────────────────────────────────┘
```

---

## Layer 1: CLI Layer — `src/commands/`

Each file in `src/commands/` maps to a single CLI sub-command and is responsible for:

- Declaring Commander options and their descriptions
- Validating user input
- Starting/stopping `ora` spinners
- Formatting output with `chalk`
- Calling into the **Service Layer** or **Utility Layer**
- Setting correct `process.exit` codes on failure

### Command Flow: `bubble-io-cli backup --type Product`

```
User Terminal
    │
    ▼
src/index.ts               ← Commander parses argv
    │
    ▼
src/commands/backup.ts     ← Reads config from storage.getConfig()
    │                        Validates env option
    │                        Starts ora spinner
    ▼
src/services/bubble-api.ts ← Builds AxiosInstance with auth headers
    │                        Calls GET /<type>?cursor=0&limit=100
    │                        Follows remaining pages (cursor pagination)
    │
    ▼
src/commands/backup.ts     ← Stops spinner, builds JSON payload
    │
    ▼
src/utils/storage.ts       ← Writes backup-<type>-<timestamp>.json to disk
    │
    ▼
User Terminal              ← ✅ Success message with file path and record count
```

---

## Layer 2: Service Layer — `src/services/`

### `BubbleApiClient` (`bubble-api.ts`)

The core HTTP client for the [Bubble Data API](https://manual.bubble.io/core-resources/api/the-bubble-api).

| Method | Description |
|---|---|
| `getDataType(type, cursor, limit)` | Fetch a single page of records |
| `getAllRecords(type)` | Fetch **all** records across all pages (cursor loop) |
| `ping(type)` | Connectivity check — returns `true` if API is reachable |

**Pagination logic:**

Bubble's API uses cursor-based pagination via the `cursor` and `remaining` fields:

```
GET /Product?cursor=0&limit=100
→ { results: [...100 items], remaining: 342 }

GET /Product?cursor=100&limit=100
→ { results: [...100 items], remaining: 242 }

... (continues until remaining === 0)
```

**Error interceptor:**

The Axios instance includes a `response` interceptor that maps HTTP status codes to human-readable messages:

| Status | User-facing message |
|---|---|
| `401` | `Authentication failed: Check your API key.` |
| `404` | `Data type not found: Verify the type name and environment.` |
| Other | `Bubble API error [<status>]: <detail>` |

---

## Layer 3: Utility Layer — `src/utils/`

### `StorageManager` (`storage.ts`)

Wraps [Configstore](https://github.com/yeoman/configstore) to provide a typed API for reading and writing CLI configuration.

| Method | Description |
|---|---|
| `saveConfig(config)` | Persist `appName` and `apiKey` to OS user config dir |
| `getConfig()` | Return stored config or `null` if not configured |
| `isConfigured()` | Boolean check for whether credentials exist |
| `clearConfig()` | Wipe all stored values |
| `saveJsonFile(path, data)` | Write arbitrary JSON to disk (creates dirs if needed) |
| `readJsonFile<T>(path)` | Read and parse JSON from disk |

Config is stored in the OS-standard user config location (e.g. `~/.config/bubble-io-cli/config.json` on Linux/macOS, `%APPDATA%\bubble-io-cli\config.json` on Windows).

---

## Build System

| Tool | Purpose |
|---|---|
| `tsup` | Bundles `src/index.ts` → `dist/index.js` (CommonJS + `.d.ts`) |
| `tsx` | Executes TypeScript directly during development (no build step) |
| `vitest` | Unit testing with fast HMR-aware test runner |
| `tsc --noEmit` | Type checking without emitting files |

### Build output

```
dist/
├── index.js       # CommonJS bundle (referenced by bin in package.json)
└── index.d.ts     # TypeScript declarations
```

---

## Adding a New Command

1. Create `src/commands/my-command.ts` with a `registerMyCommand(program: Command): void` export.
2. Add business logic to a new service in `src/services/` or utility in `src/utils/`.
3. Import and call `registerMyCommand(program)` in `src/index.ts`.
4. Write unit tests in `tests/my-command.test.ts`.
