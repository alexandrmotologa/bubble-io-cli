/**
 * Relational Seeder — Sequential Execution Engine
 *
 * Orchestrates the full import lifecycle for a relational seed document:
 *  1. Resolves the dependency graph (delegates to graph-resolver)
 *  2. Creates records in safe topological order via the Bubble API
 *  3. Maintains an in-memory @ref → Bubble _id mapping
 *  4. Substitutes @ref aliases with real IDs before each API call
 *  5. Executes deferred PATCH operations for circular dependencies
 */

import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import {
  resolveGraph,
  substituteRefs,
  type RelationalSeedDoc,
} from './graph-resolver.js';

import { BubbleApiClient } from '../services/bubble-api.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RelationalSeedOptions {
  /** Parsed relational seed document */
  doc: RelationalSeedDoc;
  /** Authenticated Bubble API client */
  client: BubbleApiClient;
  /** Whether to skip all API calls (validation + plan preview only) */
  dryRun?: boolean;
  /** Suppress progress output (used in --json mode) */
  silent?: boolean;
  /** If true, deletes all created records in reverse order if any creation or patch fails */
  rollbackOnError?: boolean;
}

export interface RelationalSeedResult {
  success: boolean;
  totalCreated: number;
  totalPatched: number;
  /** Per-type counts for summary display */
  byType: Record<string, number>;
  /** Map of @ref alias → real Bubble _id */
  idMap: Record<string, string>;
  errors: string[];
  /** Whether rollback was executed */
  rolledBack?: boolean;
  /** Total records deleted during rollback */
  totalRolledBack?: number;
}

// ── Seeder ────────────────────────────────────────────────────────────────────

/**
 * Execute a full relational seed import.
 *
 * This function is the single entry-point for relational seeding.
 * It handles graph resolution, sequential creation, ref substitution,
 * and deferred circular-dependency patching.
 */
export async function runRelationalSeed(
  opts: RelationalSeedOptions
): Promise<RelationalSeedResult> {
  const { doc, client, dryRun = false, silent = false, rollbackOnError = false } = opts;

  const log = (msg: string) => { if (!silent) console.log(msg); };
  const err = (msg: string) => { if (!silent) console.error(msg); };

  // ── Step 1: Resolve the dependency graph ────────────────────────────────
  let resolvedGraph;
  try {
    resolvedGraph = resolveGraph(doc);
  } catch (e) {
    throw new Error(
      `Graph resolution failed: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  const { sortedNodes, deferredPatches } = resolvedGraph;

  // Count totals for display
  const totalNodes = sortedNodes.length;
  const totalPatches = deferredPatches.length;
  const typeSet = new Set(sortedNodes.map((n) => n.typeName));

  // ── Step 2: Print plan ───────────────────────────────────────────────────
  log(chalk.cyan('\n📋 Relational Seed Plan\n'));
  log(`   ${chalk.bold('Types:      ')} ${chalk.cyan([...typeSet].join(' → '))}`);
  log(`   ${chalk.bold('Records:    ')} ${chalk.cyan(String(totalNodes))}`);
  if (totalPatches > 0) {
    log(`   ${chalk.bold('Patches:    ')} ${chalk.yellow(String(totalPatches))} ${chalk.dim('(circular dependency resolution)')}`);
  }
  if (rollbackOnError) {
    log(`   ${chalk.bold('Rollback:   ')} ${chalk.yellow('enabled (atomic cleanup on failure)')}`);
  }
  log('');

  if (dryRun) {
    log(chalk.yellow('🧪 Dry run mode — no API calls will be made.\n'));
    log(chalk.bold('   Creation order:'));
    sortedNodes.forEach((node, i) => {
      const refLabel = node.ref ? chalk.dim(` (${node.ref})`) : '';
      log(`   ${chalk.dim(String(i + 1).padStart(3, ' '))}. [${node.typeName}]${refLabel}`);
    });
    if (totalPatches > 0) {
      log(chalk.bold('\n   Deferred patches (circular refs):'));
      deferredPatches.forEach((p) => {
        log(`       PATCH ${p.targetRef}.${p.field} = ${JSON.stringify(p.value)}`);
      });
    }
    log(chalk.green('\n✅ Dry run complete — re-run without --dry-run to seed.\n'));
    return {
      success: true,
      totalCreated: 0,
      totalPatched: 0,
      byType: {},
      idMap: {},
      errors: [],
    };
  }

  // ── Step 3: Execute creation in topological order ────────────────────────
  const idMap = new Map<string, string>(); // @ref → bubble _id
  const createdRecords: Array<{ typeName: string; id: string; ref?: string }> = [];
  const byType: Record<string, number> = {};
  const errors: string[] = [];
  let totalCreated = 0;

  let spinner: Ora | null = null;
  if (!silent) {
    spinner = ora({ text: 'Starting relational import…', color: 'cyan' }).start();
  }

  for (let i = 0; i < sortedNodes.length; i++) {
    const node = sortedNodes[i];
    const label = node.ref
      ? `${node.typeName} ${chalk.dim(node.ref)}`
      : `${node.typeName} #${i + 1}`;

    if (spinner) {
      spinner.text = `[${i + 1}/${totalNodes}] Creating ${chalk.bold(label)}…`;
    }

    // Substitute all @ref placeholders with real Bubble IDs
    const resolvedData = substituteRefs(node.data, idMap) as Record<string, unknown>;

    // Strip Bubble read-only fields if accidentally included
    const { _id, 'Created Date': _cd, 'Modified Date': _md, ...safeData } = resolvedData as Record<string, unknown> & { _id?: string };
    void _id; void _cd; void _md;

    try {
      const result = await client.createRecord(node.typeName, safeData);
      totalCreated++;
      byType[node.typeName] = (byType[node.typeName] ?? 0) + 1;
      createdRecords.push({ typeName: node.typeName, id: result.id, ref: node.ref });

      // Store the Bubble _id under this node's alias for future ref substitution
      if (node.ref) {
        idMap.set(node.ref, result.id);
      }
    } catch (e) {
      const msg = `Failed to create ${label}: ${e instanceof Error ? e.message : String(e)}`;
      errors.push(msg);

      if (rollbackOnError) {
        spinner?.fail(chalk.red(`✗ ${msg} (aborting for rollback)`));
        break;
      }

      if (spinner) {
        spinner.warn(chalk.yellow(`⚠ ${msg}`));
        // Re-start spinner for remaining records
        spinner = ora({ text: `Continuing… (${i + 1}/${totalNodes})`, color: 'cyan' }).start();
      } else {
        err(chalk.red(`  ✗ ${msg}`));
      }
    }
  }

  if (errors.length === 0) {
    spinner?.succeed(chalk.green(`Created ${totalCreated} records across ${typeSet.size} type(s)`));
  } else if (!rollbackOnError) {
    spinner?.warn(chalk.yellow(`Created ${totalCreated}/${totalNodes} records (${errors.length} failed)`));
  }

  // ── Step 4: Execute deferred patches (circular dependency resolution) ────
  let totalPatched = 0;
  if (deferredPatches.length > 0 && errors.length === 0) {
    log('');
    const patchSpinner = silent
      ? null
      : ora({ text: `Resolving ${totalPatches} circular link(s) via PATCH…`, color: 'yellow' }).start();

    for (const patch of deferredPatches) {
      const targetId = idMap.get(patch.targetRef);
      if (!targetId) {
        const msg = `Cannot patch ${patch.targetRef}.${patch.field}: record was not created (missing from idMap)`;
        errors.push(msg);
        if (rollbackOnError) break;
        continue;
      }

      // Resolve the patch value (may also contain @refs)
      const resolvedValue = substituteRefs(patch.value, idMap);

      // Find the type for this ref
      const targetNode = resolvedGraph.sortedNodes.find((n) => n.ref === patch.targetRef);
      if (!targetNode) continue;

      try {
        await client.updateRecord(targetNode.typeName, targetId, {
          [patch.field]: resolvedValue,
        });
        totalPatched++;
      } catch (e) {
        const msg = `Failed to patch ${patch.targetRef}.${patch.field}: ${e instanceof Error ? e.message : String(e)}`;
        errors.push(msg);
        if (rollbackOnError) {
          patchSpinner?.fail(chalk.red(`✗ ${msg} (aborting for rollback)`));
          break;
        }
      }
    }

    if (errors.filter((e) => e.includes('patch')).length === 0) {
      patchSpinner?.succeed(chalk.green(`Resolved ${totalPatched} circular link(s)`));
    } else if (!rollbackOnError) {
      patchSpinner?.warn(chalk.yellow(`Patched ${totalPatched}/${totalPatches} links (some failed)`));
    }
  }

  // ── Step 5: Rollback if error occurred and rollbackOnError is true ────────
  let rolledBack = false;
  let totalRolledBack = 0;

  if (rollbackOnError && errors.length > 0 && createdRecords.length > 0) {
    log('');
    const rollbackSpinner = silent
      ? null
      : ora({ text: `Rolling back ${createdRecords.length} created record(s) in reverse order…`, color: 'red' }).start();

    for (let r = createdRecords.length - 1; r >= 0; r--) {
      const rec = createdRecords[r];
      try {
        await client.deleteRecord(rec.typeName, rec.id);
        totalRolledBack++;
      } catch (e) {
        const msg = `Failed to delete ${rec.typeName} ${rec.id} during rollback: ${e instanceof Error ? e.message : String(e)}`;
        errors.push(msg);
      }
    }

    rolledBack = true;
    if (totalRolledBack === createdRecords.length) {
      rollbackSpinner?.succeed(chalk.green(`Rollback complete: Cleaned up all ${totalRolledBack} created record(s).`));
    } else {
      rollbackSpinner?.warn(chalk.yellow(`Rollback partial: Deleted ${totalRolledBack}/${createdRecords.length} record(s).`));
    }
  }

  // ── Step 6: Return result ────────────────────────────────────────────────
  return {
    success: errors.length === 0,
    totalCreated,
    totalPatched,
    byType,
    idMap: Object.fromEntries(idMap),
    errors,
    rolledBack,
    totalRolledBack,
  };
}

// ── Format helpers ────────────────────────────────────────────────────────────

/**
 * Detect whether a parsed JSON value is a relational seed document
 * (a plain object whose values are all arrays of objects) vs. the
 * legacy single-type seed format ({ type, records }).
 */
export function isRelationalDoc(parsed: unknown): parsed is RelationalSeedDoc {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const obj = parsed as Record<string, unknown>;
  // Relational doc: every value is an array of objects
  // Legacy doc: has a 'records' key that is an array
  if ('records' in obj) return false;
  return Object.values(obj).every(
    (v) => Array.isArray(v) && (v as unknown[]).every((item) => typeof item === 'object' && item !== null)
  );
}

/**
 * Print a formatted summary table after a successful relational seed.
 */
export function printRelationalSummary(result: RelationalSeedResult): void {
  if (result.rolledBack) {
    console.log(chalk.yellow('\n⚠ Relational seed aborted with errors. Rollback executed!\n'));
    console.log(`   ${chalk.bold('Records deleted: ')} ${chalk.red(String(result.totalRolledBack ?? 0))}`);
  } else {
    console.log(chalk.green('\n✅ Relational seed complete!\n'));
    console.log(`   ${chalk.bold('Records created: ')} ${chalk.green(String(result.totalCreated))}`);
  }

  if (result.totalPatched > 0) {
    console.log(`   ${chalk.bold('Circular links:  ')} ${chalk.yellow(String(result.totalPatched))} resolved`);
  }
  if (Object.keys(result.byType).length > 0 && !result.rolledBack) {
    console.log(`\n   ${chalk.bold('Breakdown by type:')}`);
    for (const [type, count] of Object.entries(result.byType)) {
      console.log(`     ${chalk.cyan('·')} ${chalk.bold(type)}: ${chalk.green(String(count))} record(s)`);
    }
  }
  if (result.errors.length > 0) {
    console.log(`\n   ${chalk.bold('Errors:')} ${chalk.red(String(result.errors.length))}`);
    result.errors.slice(0, 10).forEach((e) => console.error(chalk.dim(`   ⚠ ${e}`)));
  }
  console.log('');
}
