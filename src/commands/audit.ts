import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { storage } from '../utils/storage.js';
import { BubbleMetaClient } from '../services/bubble-meta.js';
import {
  scanBackupFile,
  scanSchema,
  AuditResult,
  PiiMatch,
  RiskLevel,
} from '../utils/pii-scanner.js';

// ---------------------------------------------------------------------------
// Risk level helpers
// ---------------------------------------------------------------------------

/** Returns a colored label for a risk level. */
function riskLabel(level: RiskLevel): string {
  switch (level) {
    case 'CRITICAL': return chalk.bgRed.white.bold(` CRITICAL `);
    case 'HIGH':     return chalk.red.bold('🟠 HIGH');
    case 'MEDIUM':   return chalk.yellow.bold('🟡 MEDIUM');
  }
}

/** Returns a colored circle prefix for terminal list rendering. */
function riskIcon(level: RiskLevel): string {
  switch (level) {
    case 'CRITICAL': return chalk.red('🔴');
    case 'HIGH':     return chalk.red('🟠');
    case 'MEDIUM':   return chalk.yellow('🟡');
  }
}

const RISK_ORDER: Record<RiskLevel, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 };

/** Returns the numeric index for ordering (lower = more severe). */
function riskSortOrder(level: RiskLevel): number {
  return RISK_ORDER[level];
}

// ---------------------------------------------------------------------------
// Report renderer
// ---------------------------------------------------------------------------

/**
 * Renders a human-readable audit report to the terminal.
 *
 * @param result   - The AuditResult from the scanner.
 * @param minRisk  - Minimum risk level to include in the report.
 */
function renderAuditReport(result: AuditResult, minRisk: RiskLevel): void {
  const minOrder = riskSortOrder(minRisk);
  const filtered = result.findings
    .filter((f) => riskSortOrder(f.riskLevel) <= minOrder)
    .sort((a, b) => riskSortOrder(a.riskLevel) - riskSortOrder(b.riskLevel));

  // ── Header ───────────────────────────────────────────────────────────────
  console.log();
  const title = result.app
    ? chalk.bold.cyan(`🔍 Privacy Audit Report — ${result.app} [${result.env ?? 'unknown'}]`)
    : chalk.bold.cyan(`🔍 Privacy Audit Report — Local File`);
  console.log(title);
  console.log(chalk.dim('━'.repeat(60)));

  // ── Scan meta ────────────────────────────────────────────────────────────
  const sourceLabel = result.source === 'local-file'
    ? chalk.dim('source: local backup file')
    : chalk.dim(`source: remote schema`);
  console.log(
    `  ${sourceLabel}   ` +
    chalk.dim(`scanned: ${result.totalTypes} types · ${result.totalFields} fields`)
  );

  // ── Summary counts ───────────────────────────────────────────────────────
  if (result.summary.total === 0) {
    console.log(chalk.green('\n  ✅ No PII risks detected at the selected threshold.\n'));
    console.log(chalk.dim('  Tip: Run with --min-risk MEDIUM to widen the scan.\n'));
    return;
  }

  const counts: string[] = [];
  if (result.summary.critical > 0) counts.push(chalk.red.bold(`${result.summary.critical} CRITICAL`));
  if (result.summary.high > 0) counts.push(chalk.red(`${result.summary.high} HIGH`));
  if (result.summary.medium > 0) counts.push(chalk.yellow(`${result.summary.medium} MEDIUM`));
  console.log(`  Findings: ${counts.join(chalk.dim(' · '))}`);

  if (filtered.length === 0) {
    console.log(chalk.green(`\n  ✅ No findings at or above ${minRisk} threshold.\n`));
    console.log(chalk.dim(`  Run with --min-risk MEDIUM to see lower-severity findings.\n`));
    return;
  }

  // ── Findings list ────────────────────────────────────────────────────────
  console.log();
  console.log(chalk.dim('  ─'.repeat(30)));

  for (const finding of filtered) {
    renderFinding(finding);
  }

  // ── General recommendations ───────────────────────────────────────────────
  console.log(chalk.dim('  ─'.repeat(30)));
  console.log(chalk.bold('\n  📋 Next Steps:'));
  console.log(`     1. Open ${chalk.cyan('Bubble Editor → Data → Privacy')}`);
  console.log(`     2. For each ${chalk.red.bold('CRITICAL')} finding — set the field to ${chalk.bold('"No one"')} access`);
  console.log(`     3. For each ${chalk.red('HIGH')} finding — restrict to authenticated users or "This User"`);
  console.log(`     4. For ${chalk.yellow('MEDIUM')} findings — review and restrict to explicit roles`);
  console.log(chalk.dim(`     5. Run \`bubble-io-cli schema list --type <TypeName>\` to inspect field definitions\n`));

  // ── Footer ────────────────────────────────────────────────────────────────
  const exitMsg = result.summary.critical > 0
    ? chalk.red.bold(`\n⚠️  ${result.summary.critical} CRITICAL risk(s) detected. Review immediately.\n`)
    : chalk.yellow(`\n⚠️  ${filtered.length} risk(s) detected. Review and update Bubble Privacy Rules.\n`);
  console.log(exitMsg);
}

/** Renders a single PII finding block. */
function renderFinding(finding: PiiMatch): void {
  const icon = riskIcon(finding.riskLevel);
  const level = riskLabel(finding.riskLevel);
  const fieldLabel = chalk.bold(`${finding.typeName}.${finding.fieldName}`);
  const typeLabel = chalk.dim(`[${finding.fieldType}]`);

  console.log(`\n  ${icon} ${level} — ${fieldLabel} ${typeLabel}`);
  console.log(`     ${chalk.dim('⚠')} ${chalk.italic(finding.reason)}`);
  console.log(`     ${chalk.cyan('💡')} ${chalk.dim(finding.recommendation)}`);
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

/**
 * Registers the `audit` command group with its `privacy` sub-command.
 *
 * Usage:
 *   bubble-io-cli audit privacy
 *   bubble-io-cli audit privacy --file ./backup-user-2026.json
 *   bubble-io-cli audit privacy --env version-live
 *   bubble-io-cli audit privacy --type User
 *   bubble-io-cli audit privacy --min-risk HIGH
 *   bubble-io-cli audit privacy --json
 */
export function registerAuditCommand(program: Command): void {
  const audit = program
    .command('audit')
    .description('Security and compliance audit tools for your Bubble app');

  // ── audit privacy ─────────────────────────────────────────────────────────
  audit
    .command('privacy')
    .description('Scan schema or backup file for exposed PII and privacy risks')
    .option('-f, --file <path>', 'Scan a local backup JSON file instead of the remote schema')
    .option('-e, --env <environment>', 'Target Bubble environment (remote schema mode)', 'version-test')
    .option('-p, --profile <name>', 'Profile to use for credentials')
    .option('-t, --type <datatype>', 'Scan only a specific data type (case-insensitive)')
    .option(
      '--min-risk <level>',
      'Minimum risk level to report: MEDIUM | HIGH | CRITICAL',
      'MEDIUM',
    )
    .option('--json', 'Output machine-readable JSON audit report')
    .action(async (options: {
      file?: string;
      env: string;
      profile?: string;
      type?: string;
      minRisk: string;
      json?: boolean;
    }) => {
      const isJsonMode = Boolean(options.json);

      // ── Validate --min-risk ────────────────────────────────────────────────
      const validRiskLevels: RiskLevel[] = ['MEDIUM', 'HIGH', 'CRITICAL'];
      const minRisk = (options.minRisk?.toUpperCase() ?? 'MEDIUM') as RiskLevel;

      if (!validRiskLevels.includes(minRisk)) {
        const msg = `Invalid --min-risk value "${options.minRisk}". Use: MEDIUM, HIGH, or CRITICAL`;
        if (isJsonMode) {
          console.log(JSON.stringify({ success: false, error: msg }));
        } else {
          console.error(chalk.red(`❌ ${msg}`));
        }
        process.exit(1);
      }

      // ── Local file mode ───────────────────────────────────────────────────
      if (options.file) {
        let result: AuditResult;

        try {
          result = scanBackupFile(options.file);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          if (isJsonMode) {
            console.log(JSON.stringify({ success: false, error: message }));
          } else {
            console.error(chalk.red(`\n❌ Failed to read backup file: ${message}\n`));
            console.error(chalk.dim('   → Ensure the file is a valid bubble-io-cli backup JSON.\n'));
          }
          process.exit(1);
        }

        // Apply --type filter if provided
        if (options.type) {
          const lower = options.type.toLowerCase();
          result = {
            ...result,
            findings: result.findings.filter((f) => f.typeName.toLowerCase() === lower),
          };
        }

        if (isJsonMode) {
          console.log(JSON.stringify({ success: true, ...result }, null, 2));
        } else {
          renderAuditReport(result, minRisk);
        }

        // Exit with code 1 if CRITICAL findings exist (useful for CI gates)
        if (result.summary.critical > 0) {
          process.exit(1);
        }
        return;
      }

      // ── Remote schema mode ────────────────────────────────────────────────
      const config = storage.getConfig(options.profile);
      if (!config) {
        const msg = 'No credentials configured. Run: bubble-io-cli config --app <name> --key <key>';
        if (isJsonMode) {
          console.log(JSON.stringify({ success: false, error: msg }));
        } else {
          console.error(chalk.red(`❌ ${msg}`));
        }
        process.exit(1);
      }

      const spinner = isJsonMode
        ? null
        : ora({ text: 'Fetching schema from Bubble Meta API…', color: 'cyan' }).start();

      try {
        const meta = new BubbleMetaClient(config.appName, config.apiKey, options.env);
        let types = await meta.getDataTypes();

        // Apply --type filter before scanning
        if (options.type) {
          const lower = options.type.toLowerCase();
          types = types.filter(
            (t) => t.display.toLowerCase() === lower || t.id.toLowerCase() === lower
          );
          if (types.length === 0) {
            spinner?.fail(chalk.red(`Data type "${options.type}" not found.`));
            process.exit(1);
          }
        }

        spinner?.succeed(chalk.green(`Fetched ${types.length} data type(s) — scanning for PII…`));

        const result = scanSchema(types, config.appName, options.env);

        if (isJsonMode) {
          console.log(JSON.stringify({ success: true, ...result }, null, 2));
        } else {
          renderAuditReport(result, minRisk);
        }

        // Exit with code 1 on CRITICAL findings (CI gate behaviour)
        if (result.summary.critical > 0) {
          process.exit(1);
        }
      } catch (error: unknown) {
        spinner?.fail(chalk.red('Privacy audit failed'));
        const message = error instanceof Error ? error.message : String(error);
        if (isJsonMode) {
          console.log(JSON.stringify({ success: false, error: message }));
        } else {
          console.error(chalk.red(`\n❌ ${message}\n`));
          if (message.includes('403')) {
            console.error(
              chalk.dim('   → Enable the Meta API in your Bubble app: Settings → API → check "Expose schema"\n')
            );
          }
        }
        process.exit(1);
      }
    });
}
