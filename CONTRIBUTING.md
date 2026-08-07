# Contributing to bubble-io-cli

Thank you for your interest in contributing! This guide will help you get started.

---

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0
- A Bubble.io account (for manual integration testing)

### Local Setup

```bash
# Fork and clone
git clone https://github.com/alexandrmotologa/bubble-io-cli.git
cd bubble-io-cli

# Install dependencies
npm install

# Run in development mode (no build step required)
npm run dev -- --help

# Run tests
npm test

# Type check
npm run lint
```

---

## Project Architecture

Please read [docs/architecture.md](docs/architecture.md) before contributing. The key rules are:

- **Commands** (`src/commands/`) — UX only: spinners, colors, input validation, exit codes. No business logic.
- **Services** (`src/services/`) — All API communication logic.
- **Utils** (`src/utils/`) — Shared infrastructure: storage, CSV, encryption, notifications, etc.

---

## Adding a New Command

1. Create `src/commands/my-command.ts` with a `registerMyCommand(program: Command): void` export.
2. Add any API logic to `src/services/` or helper logic to `src/utils/`.
3. Import and register `registerMyCommand(program)` in `src/index.ts`.
4. Write unit tests in `tests/my-command.test.ts`.
5. Document the command in `README.md` and add an entry to `CHANGELOG.md`.

---

## Code Style

- **TypeScript strict mode** — no `any`, proper interfaces and generics.
- **Graceful errors** — always catch errors and output clean `chalk.red` messages. Never let the CLI crash with unhandled stack traces.
- **Spinners** — use `ora` for any async operations so the user knows the CLI is working.
- **JSDoc** — add concise JSDoc comments to all exported functions and classes.
- **Exit codes** — `process.exit(1)` on failure, `process.exit(0)` (implicit) on success.

---

## Submitting a Pull Request

1. **Fork** the repository and create a feature branch:
   ```bash
   git checkout -b feat/my-new-feature
   ```

2. **Implement** your changes following the architecture guide above.

3. **Write tests** — all new functionality must include unit tests in `tests/`. Run `npm test` to verify all tests pass.

4. **Commit** using [Conventional Commits](https://www.conventionalcommits.org/):
   ```bash
   git commit -m "feat: add my-new-command"
   git commit -m "fix: handle 429 rate-limit gracefully"
   git commit -m "docs: update README for new command"
   ```

5. **Push** and open a Pull Request against `main`:
   ```bash
   git push origin feat/my-new-feature
   ```

6. Fill in the PR template and describe what your change does and why.

---

## Reporting Bugs

Please [open an issue](https://github.com/alexandrmotologa/bubble-io-cli/issues/new?template=bug_report.md) with:
- The exact command you ran
- The error message or unexpected behavior
- Your Node.js version (`node --version`)
- Your OS

---

## Feature Requests

[Open a feature request](https://github.com/alexandrmotologa/bubble-io-cli/issues/new?template=feature_request.md) — we review all suggestions and discuss them in the issue thread before implementation.

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
