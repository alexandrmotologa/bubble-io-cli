# Architecture — bubble-io-cli

This document describes the internal structure, design decisions, and command flow of `bubble-io-cli`.

---

## Overview

`bubble-io-cli` is a modular Node.js CLI built with TypeScript and Commander. It follows a strict **three-layer architecture** to ensure clean separation of concerns and long-term maintainability.

```
┌─────────────────────────────────────────────────────────────────┐
│                    CLI Layer (User-facing)                       │
│   src/index.ts  ──►  src/commands/*.ts                          │
│   Commander routing, spinners (ora), colors (chalk)             │
└─────────────────────────────┬───────────────────────────────────┘
                              │ calls
┌─────────────────────────────▼───────────────────────────────────┐
│                    Service Layer (Business Logic)                │
│   src/services/bubble-api.ts      — Data API (CRUD + pages)     │
│   src/services/bubble-meta.ts     — Meta API (schema)           │
│   src/services/bubble-plugin.ts   — Plugin Editor API           │
└─────────────────────────────┬───────────────────────────────────┘
                              │ reads/writes
┌─────────────────────────────▼───────────────────────────────────┐
│                    Utility Layer (Infrastructure)                │
│   src/utils/storage.ts        — Config + multi-profile          │
│   src/utils/csv.ts            — CSV serialization               │
│   src/utils/encryption.ts     — AES-256-GCM                     │
│   src/utils/cloud-upload.ts   — S3 + GCS adapters               │
│   src/utils/notifications.ts  — Slack + Discord webhooks        │
│   src/utils/schema-diff.ts    — Schema diffing engine           │
│   src/utils/schema-erd.ts     — ERD generation engine           │
│   src/utils/type-generator.ts — TypeScript interface generator  │
│   src/utils/table-renderer.ts — cli-table3 table renderer       │
│   src/utils/query-session.ts  — REPL session state machine      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Layer 1: CLI Layer — `src/commands/`

Each file in `src/commands/` maps to one CLI sub-command (or sub-command group) and is responsible for:

- Declaring Commander options and their descriptions
- Validating user input (early exit with `process.exit(1)` and a clear message)
- Starting/stopping `ora` spinners
- Formatting output with `chalk`
- Delegating to the **Service Layer** or **Utility Layer**
- Setting correct `process.exit` codes on failure

### Command inventory

| Command file | Sub-commands | Depends on |
|---|---|---|
| `config.ts` | `config` | `storage.ts` |
| `backup.ts` | `backup` | `bubble-api.ts`, `csv.ts`, `encryption.ts`, `cloud-upload.ts`, `notifications.ts` |
| `restore.ts` | `restore` | `bubble-api.ts` |
| `diff.ts` | `diff` | `bubble-api.ts` |
| `health.ts` | `health` | `bubble-api.ts` |
| `schema.ts` | `schema list`, `schema diff`, `schema erd` | `bubble-meta.ts`, `schema-diff.ts`, `schema-erd.ts` |
| `workflow.ts` | `workflow trigger` | `bubble-api.ts` |
| `seed.ts` | `seed` | `bubble-api.ts` |
| `mock.ts` | `mock` | `express` |
| `plugin.ts` | `plugin list`, `plugin get`, `plugin deploy` | `bubble-plugin.ts` |
| `generate.ts` | `generate` (templates), `generate types` | `bubble-meta.ts`, `type-generator.ts` |
| `query.ts` | `query` | `bubble-api.ts`, `bubble-meta.ts`, `table-renderer.ts`, `query-session.ts` |
| `completions.ts` | `completions` | — |

---

### Command Flow: `bubble-io-cli backup --type Product`

```
User Terminal
    │
    ▼
src/index.ts               ← Commander parses argv
    │
    ▼
src/commands/backup.ts     ← Reads config via storage.getConfig()
    │                        Validates --env, --format, --limit
    │                        Starts ora spinner
    ▼
src/services/bubble-api.ts ← Builds AxiosInstance with Bearer auth
    │                        Calls GET /obj/<type>?cursor=0&limit=100
    │                        Loops cursor until remaining === 0
    │
    ▼
src/commands/backup.ts     ← Stops spinner, serializes JSON/CSV
    │                        Optionally: encrypts, uploads to cloud
    │                        Optionally: sends Slack/Discord notification
    ▼
File system                ← backup-<type>-<timestamp>.json written
    │
    ▼
User Terminal              ← ✅ Success message: file, records, env, format
```

---

### Command Flow: `bubble-io-cli diff --file backup.json` (full fetch)

```
User Terminal
    │
    ▼
src/commands/diff.ts     ← Reads backup JSON + validates config
    │                        Starts ora spinner
    ▼
src/services/bubble-api.ts ← getAllRecords(type, limit?)
    │                          Paginates cursor until remaining === 0
    │                          (optional --limit caps the loop)
    ▼
src/commands/diff.ts     ← Builds localMap and remoteMap keyed by _id
    │                        added   = remoteMap − localMap
    │                        removed = localMap  − remoteMap
    │                        modified = intersection with differing fields
    ▼
User Terminal             ← Color-coded diff report (green/red/yellow)
```

### Command Flow: `bubble-io-cli diff --file backup.json --local-only` (smart fetch)

```
User Terminal
    │
    ▼
src/commands/diff.ts     ← Reads backup JSON, extracts all _id values
    │                        Chunks IDs into groups of 50
    ▼
src/services/bubble-api.ts ← getAllRecords(type, undefined, [{ key: '_id',
    │                            constraint_type: 'in', value: [id1...id50] }])
    │                          Repeated for each chunk — only matched records
    ▼
src/commands/diff.ts     ← Builds maps (no "added" check — full remote not fetched)
    │                        removed  = localMap − remoteMap (record deleted from Bubble)
    │                        modified = intersection with differing fields
    ▼
User Terminal             ← Color-coded diff report (red/yellow only)
```

> **Performance:** For a 10-record backup against a 50 000-record table, `--local-only`
> completes in ~3 s and makes 1 API call instead of ~500 paginated requests.

### Command Flow: `bubble-io-cli schema diff`

```
User Terminal
    │
    ▼
src/commands/schema.ts     ← Resolves credentials via storage.getConfig()
    │                        Validates --env-a, --env-b
    │
    ├──► src/services/bubble-meta.ts ← GET /meta/types (env A)
    ├──► src/services/bubble-meta.ts ← GET /meta/types (env B)  [parallel]
    │
    ▼
src/utils/schema-diff.ts   ← diffSchemas(typesA, typesB) → SchemaDiffResult
    │
    ▼
src/commands/schema.ts     ← Renders color-coded diff to terminal
    │                        (green=added, red=removed, yellow=changed)
    ▼
User Terminal              ← Summary: N type(s) differ
```

---

### Command Flow: `bubble-io-cli mock --file backup.json`

```
User Terminal
    │
    ▼
src/commands/mock.ts       ← Reads and validates backup JSON file(s)
    │                        Loads records into in-memory MockStore
    │
    ▼
Express HTTP Server         ← Listens on --port (default 3333)
    │
    ├── GET  /api/1.1/obj/:type           → paginated results (cursor + limit)
    ├── GET  /api/1.1/obj/:type/:id       → single record
    ├── POST /api/1.1/obj/:type           → create (in-memory)
    ├── PATCH /api/1.1/obj/:type/:id      → update (in-memory)
    ├── DELETE /api/1.1/obj/:type/:id     → delete (in-memory)
    └── GET  /health                      → status + type counts
    │
    ▼
SIGINT (Ctrl+C)            ← Graceful shutdown
```

---

### Command Flow: `bubble-io-cli generate types --output ./bubble-types.d.ts`

```
User Terminal
    │
    ▼
src/commands/generate.ts  ← Reads config via storage.getConfig()
    │                        Validates --type filter (if provided)
    │                        Starts ora spinner
    ▼
src/services/bubble-meta.ts ← GET /meta/types (fetches all data type definitions)
    │
    ▼
src/utils/type-generator.ts ← bubbleTypeToTs() resolves each field type
    │                          generateInterface() builds one interface block
    │                          generateTypeFile() assembles the full .d.ts content
    │
    ▼
src/commands/generate.ts  ← Writes content to --output file (or prints to stdout)
    │
    ▼
File system               ← bubble-types.d.ts written
    │
    ▼
User Terminal             ← ✅ Generated N interface(s) → ./bubble-types.d.ts
```

---

### Command Flow: `bubble-io-cli query`

```
User Terminal
    │
    ▼
src/commands/query.ts     ← Reads config via storage.getConfig()
    │                        Creates readline.Interface on stdin/stdout
    ▼
src/services/bubble-meta.ts ← GET /meta/types (schema for type menu + field list)
    │
    ▼
src/commands/query.ts     ← Displays numbered type selection menu
    │                        [REPL LOOP]
    │  ┌─ promptFilterMenu() → text search / constraint / clear / change type
    │  │
    │  ▼
src/services/bubble-api.ts ← GET /obj/<type>?cursor=<offset>&limit=<pageSize>
    │                          (with optional constraints parameter)
    │
    ▼
src/utils/query-session.ts ← applyPageResult() updates session immutably
    │                         paginationInfo() derives page/totalPages/showing
    │
    ▼
src/utils/table-renderer.ts ← buildTableHeaders() derives column order
    │                          renderTable() renders cli-table3 table
    │
    ▼
User Terminal              ← Table printed, action menu shown (n/p/r/t/e/q)
    │  └─ Loop or exit based on user action
    ▼
  exit / Ctrl+C            ← rl.close() → "Goodbye!" → process.exit(0)
```

---

## Layer 2: Service Layer — `src/services/`

### `BubbleApiClient` (`bubble-api.ts`)

Core HTTP client for the [Bubble Data API](https://manual.bubble.io/core-resources/api/the-bubble-api).

| Method | Description |
|---|---|
| `getDataType(type, cursor, limit)` | Fetch a single page of records |
| `getAllRecords(type, maxRecords?, constraints?)` | Fetch all records with cursor loop; optional cap via `maxRecords`, optional server-side filter via `constraints` |
| `createRecord(type, data)` | Create a new record via POST |
| `updateRecord(type, id, data)` | Update a record via PATCH |
| `deleteRecord(type, id)` | Delete a record via DELETE |
| `triggerWorkflow(name, data)` | POST to `/wf/<name>` to call a backend workflow |
| `ping(type)` | Connectivity check — returns `true` if API is reachable |

**Pagination logic:**

```
GET /obj/Product?cursor=0&limit=100
→ { results: [...100 items], remaining: 342 }

GET /obj/Product?cursor=100&limit=100
→ { results: [...100 items], remaining: 242 }

... (continues until remaining === 0)
```

**Error interceptor mapping:**

| Status | User-facing message |
|---|---|
| `401` | `Authentication failed: Check your API key.` |
| `404` | `Data type not found: Verify the type name and environment.` |
| Other | `Bubble API error [<status>]: <detail>` |

---

### `BubbleMetaClient` (`bubble-meta.ts`)

Client for the [Bubble Meta API](https://manual.bubble.io/core-resources/api/the-bubble-api#the-meta-endpoint) — provides schema introspection.

| Method | Description |
|---|---|
| `getDataTypes()` | Returns all `BubbleDataType[]` with field definitions |

> Requires the Meta API to be enabled in Bubble: Settings → API → "Expose schema"

---

### `BubblePluginClient` (`bubble-plugin.ts`)

Client for the Bubble Plugin Editor API.

| Method | Description |
|---|---|
| `listPlugins()` | List all plugins for the app |
| `getPlugin(id)` | Get a full plugin definition by ID |
| `deployPlugin(definition, id?)` | Create (POST) or update (PATCH) a plugin |

> Requires `BUBBLE_PLUGIN_TOKEN` environment variable.

---

## Layer 3: Utility Layer — `src/utils/`

### `StorageManager` (`storage.ts`)

Wraps [Configstore](https://github.com/yeoman/configstore) with a typed API for credentials and multi-profile management.

| Method | Description |
|---|---|
| `saveConfig(config, profile?)` | Persist `appName` and `apiKey` for a profile |
| `getConfig(profile?)` | Return stored config or `null` |
| `clearConfig(profile?)` | Clear a specific profile |
| `clearAll()` | Wipe all profiles |
| `listProfiles()` | Return all profile names and metadata |
| `getActiveProfile()` | Return the name of the currently active profile |
| `setActiveProfile(name)` | Set the active profile |

Config is stored in the OS-standard user config location (`~/.config/bubble-io-cli/` on Linux/macOS, `%APPDATA%\bubble-io-cli\` on Windows).

---

### `csv.ts`

| Function | Description |
|---|---|
| `flattenRecord(record)` | Flatten a nested Bubble record to a flat key-value object |
| `jsonToCsv(records)` | Serialize a records array to a CSV string |

---

### `encryption.ts`

AES-256-GCM encryption/decryption using Node.js built-in `crypto`. No external dependencies.

| Function | Description |
|---|---|
| `encrypt(data, passphrase)` | Encrypt a string; returns base64 envelope with IV + auth tag |
| `decrypt(encrypted, passphrase)` | Decrypt an envelope from `encrypt()` |

---

### `cloud-upload.ts`

Lazy-loaded adapters for cloud storage — SDKs are imported only when the feature is used, keeping install size lean for users who don't need cloud upload.

| Function | Description |
|---|---|
| `uploadToCloud(filePath, destination)` | Upload `filePath` to `s3://` or `gs://` destination |

---

### `notifications.ts`

Webhook dispatcher for backup completion notifications. Uses Node.js built-in `https`/`http` — zero extra dependencies.

| Function | Description |
|---|---|
| `sendSlackNotification(url, payload)` | POST to a Slack Incoming Webhook (Block Kit format) |
| `sendDiscordNotification(url, payload)` | POST to a Discord Webhook (Embed with color status) |
| `dispatchNotifications(hooks, payload)` | Send to all configured webhooks, collect errors |

---

### `schema-diff.ts`

Pure TypeScript diffing engine. No external dependencies.

| Function | Description |
|---|---|
| `diffSchemas(typesA, typesB, envA, envB)` | Produce a `SchemaDiffResult` with added/removed types and field-level changes |

---

### `schema-erd.ts`

Pure TypeScript generator for Mermaid.js ER diagrams. No external dependencies.

| Function | Description |
|---|---|
| `generateErd(types, options)` | Generate a complete Mermaid.js `erDiagram` code block with relationships |
| `generateErdData(types, options)` | Extracts pure relationship data (for testing) |

---

### `type-generator.ts`

Pure TypeScript generator for `.d.ts` interface files. No external dependencies, zero side-effects.

| Export | Description |
|---|---|
| `BUBBLE_TYPE_MAP` | Record mapping Bubble primitive types to TypeScript equivalents |
| `bubbleTypeToTs(fieldType, knownTypes)` | Resolve a single Bubble field type to its TypeScript string |
| `generateInterface(type, knownTypes)` | Generate one `export interface` block with system + user fields |
| `generateTypeFile(types, options)` | Generate the full `.d.ts` file content (header + helper types + interfaces) |

---


### `table-renderer.ts`

Pure terminal table renderer built on `cli-table3`. No I/O, fully deterministic and testable.

| Export | Description |
|---|---|
| `formatCellValue(value)` | Safely stringify any Bubble field value (null, arrays, objects, primitives) |
| `truncateCell(value, maxWidth?)` | Truncate a string with ellipsis when it exceeds `maxWidth` (default: 30) |
| `buildTableHeaders(records, maxColumns?)` | Derive ordered column names: `_id` first, user fields middle, date fields last |
| `renderTable(records, options?)` | Render a bordered `cli-table3` table as a ready-to-print string |

Column priority order: `_id` → user-defined fields (schema order) → `Creation Date` → `Modified Date`.

---

### `query-session.ts`

Immutable REPL session state machine. Every function returns a new session object — nothing is mutated.

| Export | Description |
|---|---|
| `createSession(dataType, env, pageSize?)` | Initialise a fresh session with defaults (page 1, no filters) |
| `buildConstraints(session, textFieldId?)` | Convert session filters to `BubbleConstraint[]` for the API |
| `paginationInfo(session)` | Derive `{ page, totalPages, showing, total }` for display |
| `applyPageResult(session, records, total)` | Return a new session with updated records + totalRecords |
| `resetFilters(session)` | Return a new session with all filters cleared and page reset to 1 |
| `nextPage(session)` | Increment page, clamped to `totalPages` |
| `prevPage(session)` | Decrement page, clamped to 1 |
| `currentCursor(session)` | Calculate the 0-based API cursor offset for the current page |

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
├── index.js       # CommonJS bundle (~112 KB, referenced by bin)
└── index.d.ts     # TypeScript declarations
```

---

## Adding a New Command

1. Create `src/commands/my-command.ts` with a `registerMyCommand(program: Command): void` export.
2. Add business logic to a new service in `src/services/` or utility in `src/utils/`.
3. Import and call `registerMyCommand(program)` in `src/index.ts`.
4. Write unit tests in `tests/my-command.test.ts`.
5. Document the new command in `README.md` and `CHANGELOG.md`.
