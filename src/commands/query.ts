import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as readline from 'readline';
import { writeFileSync } from 'fs';
import { storage } from '../utils/storage.js';
import { BubbleApiClient } from '../services/bubble-api.js';
import { BubbleMetaClient, BubbleDataType, BubbleField } from '../services/bubble-meta.js';
import { renderTable } from '../utils/table-renderer.js';
import {
  createSession,
  buildConstraints,
  paginationInfo,
  applyPageResult,
  resetFilters,
  nextPage,
  prevPage,
  currentCursor,
  QuerySession,
  QueryConstraintType,
} from '../utils/query-session.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Ordered list of supported constraint operators for the interactive menu. */
const CONSTRAINT_OPERATORS: { label: string; value: QueryConstraintType }[] = [
  { label: 'equals', value: 'equals' },
  { label: 'not equal', value: 'not equal' },
  { label: 'text contains', value: 'text contains' },
  { label: 'greater than', value: 'greater than' },
  { label: 'less than', value: 'less than' },
  { label: 'is empty (no value needed)', value: 'is_empty' },
  { label: 'is not empty (no value needed)', value: 'is_not_empty' },
];

// ---------------------------------------------------------------------------
// Readline helper
// ---------------------------------------------------------------------------

/**
 * Wraps `rl.question()` as a Promise so every user interaction is `await`-able.
 * Automatically trims the returned answer.
 */
function promptLine(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Prints a separator line in dim style. */
function separator(): void {
  console.log(chalk.dim('─'.repeat(60)));
}

/** Returns the first field of type `text` in the schema, or undefined. */
function findFirstTextField(type: BubbleDataType): BubbleField | undefined {
  return type.fields.find((f) => f.type === 'text');
}

/**
 * Displays a numbered type selection menu and waits for the user to pick one.
 * Returns the selected `BubbleDataType`, or `null` if the user typed `q` / `quit`.
 */
async function promptTypeSelection(
  rl: readline.Interface,
  types: BubbleDataType[]
): Promise<BubbleDataType | null> {
  separator();
  console.log(chalk.cyan('\n  Select a data type:\n'));
  types.forEach((t, idx) => {
    console.log(`    ${chalk.bold(String(idx + 1))}) ${t.display}`);
  });
  console.log(`\n    ${chalk.dim('q')}${chalk.dim(') Quit')}`);

  const raw = await promptLine(rl, chalk.bold('\n  > '));
  if (raw === 'q' || raw === 'quit' || raw === 'exit') return null;

  const idx = parseInt(raw, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= types.length) {
    console.log(chalk.yellow(`\n  ⚠  Invalid selection. Please enter a number between 1 and ${types.length}.\n`));
    return promptTypeSelection(rl, types);
  }
  return types[idx];
}

/**
 * Displays the filter menu for a selected data type and returns the updated session.
 * Returns `null` if the user chose to change type or quit.
 */
async function promptFilterMenu(
  rl: readline.Interface,
  session: QuerySession,
  schemaType: BubbleDataType
): Promise<QuerySession | null> {
  separator();
  console.log(chalk.cyan(`\n  [${session.dataType}] Quick options:\n`));

  if (session.searchText) {
    console.log(`    ${chalk.dim('Current search:')} ${chalk.yellow(session.searchText)}`);
  }
  if (session.constraint) {
    console.log(
      `    ${chalk.dim('Current constraint:')} ${chalk.yellow(
        `${session.constraint.key} ${session.constraint.constraint_type}${session.constraint.value ? ` "${session.constraint.value}"` : ''}`
      )}`
    );
  }

  console.log(`\n    ${chalk.bold('f')}) Add / change text search`);
  console.log(`    ${chalk.bold('c')}) Add / change field constraint`);
  console.log(`    ${chalk.bold('x')}) Clear all filters`);
  console.log(`    ${chalk.bold('t')}) Change data type`);
  console.log(`    ${chalk.bold('q')}) Quit`);
  console.log(`    ${chalk.dim('Enter')}${chalk.dim(') Fetch records (current filters)')}`);

  const answer = await promptLine(rl, chalk.bold('\n  > '));

  switch (answer) {
    case 'q':
    case 'quit':
    case 'exit':
      return null;

    case 't':
      return { ...session, _changeType: true } as unknown as QuerySession;

    case 'x':
      return resetFilters(session);

    case 'f': {
      const firstTextField = findFirstTextField(schemaType);
      if (!firstTextField) {
        console.log(chalk.yellow(`\n  ⚠  No text fields found on "${session.dataType}". Use constraint instead.\n`));
        return session;
      }
      const searchVal = await promptLine(
        rl,
        chalk.bold(`\n  Search in "${firstTextField.display}": `)
      );
      return { ...session, searchText: searchVal || undefined, currentPage: 1 };
    }

    case 'c':
      return promptConstraintMenu(rl, session, schemaType);

    default:
      // Empty Enter → proceed with current filters
      return session;
  }
}

/**
 * Guides the user through selecting a field + operator + value to add a constraint.
 */
async function promptConstraintMenu(
  rl: readline.Interface,
  session: QuerySession,
  schemaType: BubbleDataType
): Promise<QuerySession> {
  // ── Step 1: choose field ──────────────────────────────────────────────────
  const fields = schemaType.fields;
  console.log(chalk.cyan('\n  Choose a field to filter on:\n'));
  fields.forEach((f, idx) => {
    console.log(`    ${chalk.bold(String(idx + 1))}) ${f.display} ${chalk.dim(`[${f.type}]`)}`);
  });

  const fieldRaw = await promptLine(rl, chalk.bold('\n  Field number > '));
  const fieldIdx = parseInt(fieldRaw, 10) - 1;
  if (isNaN(fieldIdx) || fieldIdx < 0 || fieldIdx >= fields.length) {
    console.log(chalk.yellow('\n  ⚠  Invalid field selection. Constraint not applied.\n'));
    return session;
  }
  const selectedField = fields[fieldIdx];

  // ── Step 2: choose operator ───────────────────────────────────────────────
  console.log(chalk.cyan('\n  Choose an operator:\n'));
  CONSTRAINT_OPERATORS.forEach((op, idx) => {
    console.log(`    ${chalk.bold(String(idx + 1))}) ${op.label}`);
  });

  const opRaw = await promptLine(rl, chalk.bold('\n  Operator number > '));
  const opIdx = parseInt(opRaw, 10) - 1;
  if (isNaN(opIdx) || opIdx < 0 || opIdx >= CONSTRAINT_OPERATORS.length) {
    console.log(chalk.yellow('\n  ⚠  Invalid operator selection. Constraint not applied.\n'));
    return session;
  }
  const selectedOp = CONSTRAINT_OPERATORS[opIdx];

  // ── Step 3: value (skip for is_empty / is_not_empty) ─────────────────────
  let value: string | undefined;
  if (selectedOp.value !== 'is_empty' && selectedOp.value !== 'is_not_empty') {
    value = await promptLine(rl, chalk.bold('  Value > '));
    if (!value) {
      console.log(chalk.yellow('\n  ⚠  Empty value. Constraint not applied.\n'));
      return session;
    }
  }

  return {
    ...session,
    constraint: {
      key: selectedField.id,
      constraint_type: selectedOp.value,
      value,
    },
    currentPage: 1,
  };
}

/**
 * Fetches a single page of records for the current session and renders the table.
 * Returns the updated session with new records + totalRecords.
 */
async function fetchAndDisplay(
  session: QuerySession,
  apiClient: BubbleApiClient,
  schemaType: BubbleDataType
): Promise<QuerySession> {
  const spinner = ora({ text: chalk.cyan('Fetching records…'), color: 'cyan' }).start();

  try {
    const firstTextField = findFirstTextField(schemaType);
    const textFieldId = firstTextField?.id;
    const constraints = buildConstraints(session, textFieldId);
    const cursor = currentCursor(session);

    const response = await apiClient.getDataType<Record<string, unknown>>(
      session.dataType,
      cursor,
      session.pageSize,
      constraints.length > 0 ? constraints : undefined
    );

    const totalRecords = response.count + response.remaining + (cursor);
    const updated = applyPageResult(session, response.results, totalRecords);

    spinner.stop();

    if (response.results.length === 0) {
      console.log(chalk.yellow('\n  No records found for the current filters.\n'));
      return updated;
    }

    // ── Render table ────────────────────────────────────────────────────────
    console.log('\n' + renderTable(response.results));

    // ── Pagination footer ───────────────────────────────────────────────────
    const info = paginationInfo(updated);
    console.log(
      chalk.dim(
        `  Showing ${info.showing} records  |  Page ${info.page} of ${info.totalPages}  |  Total: ${info.total}\n`
      )
    );

    return updated;
  } catch (error: unknown) {
    spinner.fail(chalk.red('Fetch failed'));
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`\n  ❌ ${message}\n`));
    return session;
  }
}

/**
 * Displays the post-results action menu and handles navigation.
 * Returns `'refine' | 'type' | 'quit'` or loops for pagination.
 */
async function promptActionMenu(
  rl: readline.Interface,
  session: QuerySession,
  apiClient: BubbleApiClient,
  schemaType: BubbleDataType
): Promise<{ action: 'refine' | 'type' | 'quit'; session: QuerySession }> {
  const info = paginationInfo(session);

  separator();
  console.log(chalk.cyan('\n  Actions:\n'));

  if (info.page < info.totalPages) console.log(`    ${chalk.bold('n')}) Next page`);
  if (info.page > 1) console.log(`    ${chalk.bold('p')}) Previous page`);
  console.log(`    ${chalk.bold('r')}) Refine / change filters`);
  console.log(`    ${chalk.bold('t')}) Change data type`);
  console.log(`    ${chalk.bold('e')}) Export current page to JSON`);
  console.log(`    ${chalk.bold('q')}) Quit`);

  const answer = await promptLine(rl, chalk.bold('\n  > '));

  switch (answer) {
    case 'n': {
      if (paginationInfo(session).page >= paginationInfo(session).totalPages) {
        console.log(chalk.yellow('\n  ⚠  Already on the last page.\n'));
        return promptActionMenu(rl, session, apiClient, schemaType);
      }
      const s2 = await fetchAndDisplay(nextPage(session), apiClient, schemaType);
      return promptActionMenu(rl, s2, apiClient, schemaType);
    }

    case 'p': {
      if (session.currentPage <= 1) {
        console.log(chalk.yellow('\n  ⚠  Already on the first page.\n'));
        return promptActionMenu(rl, session, apiClient, schemaType);
      }
      const s3 = await fetchAndDisplay(prevPage(session), apiClient, schemaType);
      return promptActionMenu(rl, s3, apiClient, schemaType);
    }

    case 'e': {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `query-export-${session.dataType}-${timestamp}.json`;
      writeFileSync(filename, JSON.stringify(session.records, null, 2), 'utf-8');
      console.log(chalk.green(`\n  ✅ Exported ${session.records.length} record(s) → ${filename}\n`));
      return promptActionMenu(rl, session, apiClient, schemaType);
    }

    case 'r':
      return { action: 'refine', session };

    case 't':
      return { action: 'type', session };

    case 'q':
    case 'quit':
    case 'exit':
      return { action: 'quit', session };

    default:
      console.log(chalk.yellow('\n  ⚠  Unknown action. Please try again.\n'));
      return promptActionMenu(rl, session, apiClient, schemaType);
  }
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

/**
 * Registers the `query` interactive REPL command.
 *
 * Usage:
 *   bubble-io-cli query
 *   bubble-io-cli query --env version-live
 *   bubble-io-cli query --profile staging --page-size 10
 */
export function registerQueryCommand(program: Command): void {
  program
    .command('query')
    .alias('q')
    .description('Interactive REPL — search, filter, and browse Bubble records in the terminal')
    .option('-e, --env <environment>', 'Target environment: version-test or version-live', 'version-test')
    .option('-p, --profile <name>', 'Named credential profile to use')
    .option('--page-size <n>', 'Records per page (default: 20, max: 100)', '20')
    .action(async (options: { env: string; profile?: string; pageSize: string }) => {
      // ── Validate credentials ───────────────────────────────────────────────
      const config = storage.getConfig(options.profile);
      if (!config) {
        console.error(
          chalk.red('\n❌ No credentials configured.\n') +
          chalk.dim('   Run: bubble-io-cli config --app <name> --key <key>\n')
        );
        process.exit(1);
      }

      const pageSize = Math.min(Math.max(parseInt(options.pageSize, 10) || 20, 1), 100);
      const env = options.env;

      // ── Setup readline ─────────────────────────────────────────────────────
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      // Graceful Ctrl+C handler
      rl.on('close', () => {
        console.log(chalk.cyan('\n\n  Goodbye! 👋\n'));
        process.exit(0);
      });

      // ── Fetch schema ───────────────────────────────────────────────────────
      console.log(
        chalk.bold(chalk.cyan('\n🫧  bubble-io-cli Interactive Query\n')) +
        chalk.dim(`   App: ${config.appName}  |  Env: ${env}\n`)
      );

      const metaSpinner = ora({ text: 'Fetching schema…', color: 'cyan' }).start();
      let allTypes: BubbleDataType[];

      try {
        const meta = new BubbleMetaClient(config.appName, config.apiKey, env);
        allTypes = await meta.getDataTypes();
        metaSpinner.succeed(chalk.green(`Found ${allTypes.length} data type(s)`));
      } catch (error: unknown) {
        metaSpinner.fail(chalk.red('Failed to fetch schema'));
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`\n❌ ${message}\n`));
        rl.close();
        process.exit(1);
      }

      if (allTypes.length === 0) {
        console.log(chalk.yellow('\n  ⚠  No data types found in this app.\n'));
        rl.close();
        return;
      }

      const apiClient = new BubbleApiClient(config.appName, config.apiKey, env);

      // ── Main REPL loop ─────────────────────────────────────────────────────
      let selectedType: BubbleDataType | null = null;
      let session: QuerySession | null = null;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        // ── Type selection ──────────────────────────────────────────────────
        if (!selectedType) {
          selectedType = await promptTypeSelection(rl, allTypes);
          if (!selectedType) {
            rl.close();
            break;
          }
          session = createSession(selectedType.display, env, pageSize);
        }

        // ── Filter menu ─────────────────────────────────────────────────────
        const filterResult = await promptFilterMenu(rl, session!, selectedType);

        if (filterResult === null) {
          // User chose Quit
          rl.close();
          break;
        }

        // Detect the "change type" sentinel (user typed 't' in filter menu)
        if ((filterResult as unknown as { _changeType?: boolean })._changeType) {
          selectedType = null;
          session = null;
          continue;
        }

        session = filterResult;

        // ── Fetch & display ─────────────────────────────────────────────────
        session = await fetchAndDisplay(session, apiClient, selectedType);

        // ── Action menu ─────────────────────────────────────────────────────
        const { action, session: updatedSession } = await promptActionMenu(
          rl,
          session,
          apiClient,
          selectedType
        );

        session = updatedSession;

        if (action === 'quit') {
          rl.close();
          break;
        }
        if (action === 'type') {
          selectedType = null;
          session = null;
        }
        // action === 'refine' → loop back to filter menu with current session
      }
    });
}
