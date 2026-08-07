# AGENT BEHAVIORAL & CODING RULES FOR BUBBLE-IO-CLI

1. **TypeScript Strictness:** Always write strict TypeScript code. Never use `any` unless absolutely necessary; use proper interfaces, types, and generic typing.
2. **Modular Architecture:** Keep a strict separation of concerns. Do not mix API logic with Commander action handlers. Place network requests in services, local storage logic in utils, and command definitions in commands.
3. **Graceful Error Handling:** Never let the CLI crash with unhandled stack traces. Catch all errors (network drops, invalid auth keys, missing files) and output clean, colored, user-friendly messages using `chalk.red`.
4. **Defensive CLI UX:** Use `ora` spinners for any asynchronous actions (like fetching data from Bubble) so the user knows the terminal is working.
5. **Clean Code & Git Hygiene:** Write clean, self-documenting code with concise JSDoc comments for public methods.

## Technical Competencies & Patterns
- **Node.js CLI Development:** Standard command creation with `commander`, handling arguments, options, and process exit codes (`process.exit`).
- **REST API Integration & Axios:** Extended Axios instances with custom headers, error interceptors, and cursor-based pagination logic.
- **Modern Build Tools:** Fast NPM packaging using `tsup` (CommonJS / ESM output) and `tsx` for development execution.
- **Local Storage Management:** Managing user configuration files safely via `configstore` or native `fs/promises`.
