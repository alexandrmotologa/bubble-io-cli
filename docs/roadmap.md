# Roadmap — bubble-io-cli

This document outlines the planned features and improvements for future versions of `bubble-io-cli`. Items are grouped by milestone. Contributions and feedback are welcome — open an issue to discuss ideas.

---

## ✅ v1.0.0 — Foundation (Shipped)

- [x] `config` command — local credential management (set, show, clear)
- [x] `backup` command — full data export with cursor pagination to JSON
- [x] `generate` command — scaffold plugin-action, api-connector, data-trigger
- [x] Automatic cursor-based pagination for all data types
- [x] `ora` spinners for async feedback
- [x] `chalk` colored output with masked API key display
- [x] Vitest unit tests for core services and utilities
- [x] MIT open-source license

---

## ✅ v1.0.1 — Record Limit (Shipped)

- [x] **`backup --limit <number>` / `-l`** — Optional cap on records fetched per export
  - Smart page-size trimming: `--limit 25` sends `?limit=25` to the API (no over-fetching)
  - `limitedTo` field added to the JSON `meta` envelope for partial exports
  - Spinner text and terminal output adapt to indicate a partial vs. full export
  - Input validation with a clear error message for non-positive values
  - 3 additional unit tests covering cap boundary, page-size trimming, and unlimited mode

---

## ✅ v1.1.0 — Data Enhancements (Current)

- [x] **Restore command** (`bubble-io-cli restore --file backup-user-*.json`) — bulk-upload records back to Bubble via the Data API
- [x] **Diff command** (`bubble-io-cli diff --type Product`) — compare remote data against a local backup and show what changed
- [x] **Backup filtering** — `--constraint` option for server-side filtering (wraps Bubble's `constraints` query parameter)
- [x] **CSV export** — `--format csv` option for spreadsheet-friendly output
- [x] **Incremental backups** — `--since <date>` option tracks `Modified Date` to export only recently changed records

---

## 🔜 v1.2.0 — Workflow Automation

- [ ] **Watch mode** (`bubble-io-cli backup --watch --interval 60`) — continuously back up data at a specified interval
- [ ] **CI/CD integration** — structured JSON output (`--json` flag) and proper exit codes for scripting in GitHub Actions, GitLab CI, etc.
- [ ] **S3 / GCS upload** — `--destination s3://my-bucket/backups` to upload exports directly to cloud storage
- [ ] **Encryption** — optional AES-256 encryption for local backup files with `--encrypt`

---

## 🔜 v1.3.0 — Developer Experience

- [ ] **Interactive mode** (`bubble-io-cli interactive`) — guided TUI wizard for all commands
- [ ] **Shell completions** — auto-generate Bash/Zsh/Fish tab completions
- [ ] **Multi-app profiles** (`bubble-io-cli config --profile staging`) — manage credentials for multiple Bubble apps simultaneously
- [ ] **Plugin system** — allow community-contributed commands via npm packages prefixed with `bubble-io-cli-plugin-*`

---

## 🔮 v2.0.0 — Extended Platform Support

- [ ] **Workflow trigger** (`bubble-io-cli workflow trigger --name "Send Invoice"`) — call Bubble backend workflows via API
- [ ] **App health check** (`bubble-io-cli health`) — check API connectivity, quota usage, and data type existence
- [ ] **Schema introspection** (`bubble-io-cli schema list`) — list all data types and their fields using the Bubble Meta API
- [ ] **Code generation from schema** — auto-generate TypeScript interfaces for all Bubble data types
- [ ] **Deployment helpers** — integrate with Bubble's version management API to promote test to live
- [ ] **Data seeding** (`bubble-io-cli seed --file seed-data.json`) — create records in bulk for testing environments

---

## 💡 Community Ideas (Under Consideration)

- Slack / Discord notification hooks on backup completion
- Visual diff output for schema changes between environments
- Integration with the Bubble Plugin Editor API
- Local mock server to simulate Bubble responses for offline development

---

> 💬 **Have an idea?** [Open a feature request](https://github.com/alexandrmotologa/bubble-io-cli/issues/new?template=feature_request.md) — we'd love to hear from you!
