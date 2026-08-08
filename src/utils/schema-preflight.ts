/**
 * Schema Pre-Flight Checker
 *
 * Validates a relational seed document against the live Bubble.io schema
 * BEFORE any API creation calls are made. Catches:
 *
 *  1. Missing Types     — type in seed doesn't exist in Bubble
 *  2. Missing Fields    — field in seed doesn't exist on that Bubble type
 *  3. Type Mismatches   — field exists but the Bubble field type doesn't match
 *                         the inferred type from the seed value, including:
 *                         - @ref string  → must be a Thing link to the correct type
 *                         - [@ref, …]    → must be a list of <Thing>
 *                         - JS number    → must be "number"
 *                         - JS boolean   → must be "boolean"
 *                         - plain string → must be a text-like field
 */

import type { BubbleDataType, BubbleField } from '../services/bubble-meta.js';
import type { RelationalSeedDoc } from './graph-resolver.js';

// ── Public types ──────────────────────────────────────────────────────────────

export type IssueSeverity = 'error' | 'warning';

export interface SchemaIssue {
  severity: IssueSeverity;
  /** The data type name in the seed document (e.g. "Product") */
  typeName: string;
  /** The field name within that type (undefined for type-level issues) */
  fieldName?: string;
  /** Human-readable description */
  message: string;
  /** What the seed value implies the type should be */
  inferredType?: string;
  /** What Bubble actually has */
  actualType?: string;
}

export interface SchemaPreflightResult {
  /** True only if there are zero error-severity issues */
  ok: boolean;
  issues: SchemaIssue[];
  /** Number of data types scanned */
  checkedTypes: number;
  /** Number of fields scanned across all types */
  checkedFields: number;
}

// ── Bubble primitive types that are text-compatible ───────────────────────────

/** Field types in Bubble that can hold a plain string value */
const TEXT_COMPATIBLE_TYPES = new Set([
  'text',
  'date',
  'file',
  'image',
  'geographic address',
  'option',
]);

/** Bubble list-of-primitive types (not relational) */
const LIST_PRIMITIVE_TYPES = new Set([
  'list of text',
  'list of number',
  'list of date',
  'list of boolean',
  'list of file',
  'list of image',
]);

// ── Main checker ──────────────────────────────────────────────────────────────

/**
 * Run the schema pre-flight check.
 *
 * @param doc         - The parsed relational seed document to validate.
 * @param bubbleTypes - The live schema fetched from the Bubble Meta API.
 * @returns           A result object with all detected issues.
 */
export function runSchemaPreflight(
  doc: RelationalSeedDoc,
  bubbleTypes: BubbleDataType[]
): SchemaPreflightResult {
  const issues: SchemaIssue[] = [];
  let checkedFields = 0;

  // ── Build lookup indexes ────────────────────────────────────────────────────

  /**
   * Primary type index: display name (lowercased) → BubbleDataType
   * Allows case-insensitive lookup by name as written in the seed.
   */
  const typeIndex = new Map<string, BubbleDataType>();
  for (const bt of bubbleTypes) {
    typeIndex.set(bt.display.toLowerCase(), bt);
  }

  /**
   * Field index per type: typeDisplayLower → fieldDisplayLower → BubbleField
   */
  const fieldIndex = new Map<string, Map<string, BubbleField>>();
  for (const bt of bubbleTypes) {
    const fMap = new Map<string, BubbleField>();
    for (const f of bt.fields) {
      fMap.set(f.display.toLowerCase(), f);
    }
    fieldIndex.set(bt.display.toLowerCase(), fMap);
  }

  /**
   * Ref-to-type map: "@cat_1" → "Category"
   * Built by scanning all _ref definitions in the seed document.
   * Used to resolve what type a @ref alias refers to.
   */
  const refToTypeName = new Map<string, string>();
  for (const [typeName, records] of Object.entries(doc)) {
    for (const record of records) {
      if (typeof record._ref === 'string') {
        refToTypeName.set(record._ref, typeName);
      }
    }
  }

  // ── Validate each type in the seed ─────────────────────────────────────────

  const seedTypeNames = Object.keys(doc);

  for (const typeName of seedTypeNames) {
    const typeKey = typeName.toLowerCase();
    const bubbleType = typeIndex.get(typeKey);

    // ── 1. Check: Type exists in Bubble ──────────────────────────────────────
    if (!bubbleType) {
      issues.push({
        severity: 'error',
        typeName,
        message:
          `Type "${typeName}" does not exist in your Bubble app. ` +
          `Create it in: Bubble Editor → Data → Data Types.`,
      });
      // Cannot validate fields if the type itself is missing; skip to next type.
      continue;
    }

    const fMap = fieldIndex.get(typeKey)!;
    const records = doc[typeName];

    // Collect the unique set of field names actually used across all records of this type
    const usedFieldNames = new Set<string>();
    for (const record of records) {
      for (const key of Object.keys(record)) {
        if (key !== '_ref') usedFieldNames.add(key);
      }
    }

    // ── 2. Check: Fields exist + type inference ───────────────────────────────
    for (const fieldName of usedFieldNames) {
      checkedFields++;
      const fieldKey = fieldName.toLowerCase();
      const bubbleField = fMap.get(fieldKey);

      if (!bubbleField) {
        // Field does not exist in Bubble at all
        const inferredType = inferFieldTypeFromSeedValues(doc, typeName, fieldName, refToTypeName);
        issues.push({
          severity: 'error',
          typeName,
          fieldName,
          inferredType,
          message:
            `Field "${fieldName}" does not exist on type "${typeName}" in Bubble. ` +
            (inferredType ? `Expected Bubble field type: "${inferredType}".` : ''),
        });
      } else {
        // Field exists — check if the value type is compatible
        const mismatch = checkTypeMismatch(doc, typeName, fieldName, bubbleField, refToTypeName);
        if (mismatch) {
          issues.push(mismatch);
        }
      }
    }
  }

  return {
    ok: issues.every((i) => i.severity !== 'error'),
    issues,
    checkedTypes: seedTypeNames.length,
    checkedFields,
  };
}

// ── Type inference helpers ────────────────────────────────────────────────────

/**
 * Infer the expected Bubble field type from all values of a field
 * across every record of a given type in the seed document.
 *
 * Returns a human-readable string like "number", "text", "Product",
 * or "list of Size".
 */
function inferFieldTypeFromSeedValues(
  doc: RelationalSeedDoc,
  typeName: string,
  fieldName: string,
  refToTypeName: Map<string, string>
): string | undefined {
  for (const record of doc[typeName]) {
    const value = record[fieldName];
    if (value === undefined || value === null) continue;
    return inferSingleValue(value, refToTypeName);
  }
  return undefined;
}

/**
 * Infer the expected Bubble field type from a single seed value.
 */
function inferSingleValue(
  value: unknown,
  refToTypeName: Map<string, string>
): string | undefined {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';

  if (typeof value === 'string') {
    if (value.startsWith('@')) {
      // It's a @ref → resolve to the type it belongs to
      return refToTypeName.get(value) ?? 'Thing';
    }
    return 'text';
  }

  if (Array.isArray(value) && value.length > 0) {
    const first = value[0];
    if (typeof first === 'string' && first.startsWith('@')) {
      const referencedType = refToTypeName.get(first) ?? 'Thing';
      return `list of ${referencedType}`;
    }
    if (typeof first === 'number') return 'list of number';
    if (typeof first === 'boolean') return 'list of boolean';
    return 'list of text';
  }

  return undefined;
}

/**
 * Check whether a seed field value is compatible with the actual Bubble field type.
 *
 * Returns a SchemaIssue (warning-severity) if there is a mismatch, or null if OK.
 */
function checkTypeMismatch(
  doc: RelationalSeedDoc,
  typeName: string,
  fieldName: string,
  bubbleField: BubbleField,
  refToTypeName: Map<string, string>
): SchemaIssue | null {
  const bubbleType = bubbleField.type.toLowerCase().trim();

  // Scan all records to find the first non-null value for this field
  let firstValue: unknown = undefined;
  for (const record of doc[typeName]) {
    const v = record[fieldName];
    if (v !== undefined && v !== null) {
      firstValue = v;
      break;
    }
  }
  if (firstValue === undefined) return null;

  const inferred = inferSingleValue(firstValue, refToTypeName);
  if (!inferred) return null;

  const inferredLower = inferred.toLowerCase();

  // ── Case 1: Seed value is a @ref → expects "Thing" link to a specific type ─
  if (typeof firstValue === 'string' && firstValue.startsWith('@')) {
    const expectedTypeName = refToTypeName.get(firstValue);
    if (expectedTypeName && bubbleType !== expectedTypeName.toLowerCase()) {
      return {
        severity: 'warning',
        typeName,
        fieldName,
        inferredType: expectedTypeName,
        actualType: bubbleField.type,
        message:
          `Field "${fieldName}" on type "${typeName}": ` +
          `seed value is a @ref pointing to "${expectedTypeName}", ` +
          `but Bubble field type is "${bubbleField.type}". ` +
          `Expected Bubble field type: "${expectedTypeName}" (Thing link).`,
      };
    }
    return null;
  }

  // ── Case 2: Seed value is an array of @refs → expects "list of <Type>" ─────
  if (Array.isArray(firstValue) && firstValue.length > 0) {
    const first = firstValue[0];
    if (typeof first === 'string' && first.startsWith('@')) {
      const expectedTypeName = refToTypeName.get(first);
      if (expectedTypeName) {
        const expectedBubble = `list of ${expectedTypeName}`.toLowerCase();
        if (bubbleType !== expectedBubble) {
          return {
            severity: 'warning',
            typeName,
            fieldName,
            inferredType: `list of ${expectedTypeName}`,
            actualType: bubbleField.type,
            message:
              `Field "${fieldName}" on type "${typeName}": ` +
              `seed value is a list of @refs pointing to "${expectedTypeName}", ` +
              `but Bubble field type is "${bubbleField.type}". ` +
              `Expected Bubble field type: "list of ${expectedTypeName}".`,
          };
        }
      }
    }
    return null;
  }

  // ── Case 3: JS number → Bubble field should be "number" ──────────────────
  if (typeof firstValue === 'number') {
    if (bubbleType !== 'number') {
      return {
        severity: 'warning',
        typeName,
        fieldName,
        inferredType: 'number',
        actualType: bubbleField.type,
        message:
          `Field "${fieldName}" on type "${typeName}": ` +
          `seed value is a number (${firstValue}), ` +
          `but Bubble field type is "${bubbleField.type}". ` +
          `Expected Bubble field type: "number".`,
      };
    }
    return null;
  }

  // ── Case 4: JS boolean → Bubble field should be "boolean" ────────────────
  if (typeof firstValue === 'boolean') {
    if (bubbleType !== 'boolean') {
      return {
        severity: 'warning',
        typeName,
        fieldName,
        inferredType: 'boolean',
        actualType: bubbleField.type,
        message:
          `Field "${fieldName}" on type "${typeName}": ` +
          `seed value is a boolean (${firstValue}), ` +
          `but Bubble field type is "${bubbleField.type}". ` +
          `Expected Bubble field type: "boolean".`,
      };
    }
    return null;
  }

  // ── Case 5: Plain string → Bubble field should be text-compatible ─────────
  if (typeof firstValue === 'string' && !firstValue.startsWith('@')) {
    if (!TEXT_COMPATIBLE_TYPES.has(bubbleType) && !LIST_PRIMITIVE_TYPES.has(bubbleType)) {
      return {
        severity: 'warning',
        typeName,
        fieldName,
        inferredType: 'text',
        actualType: bubbleField.type,
        message:
          `Field "${fieldName}" on type "${typeName}": ` +
          `seed value is a plain string, ` +
          `but Bubble field type is "${bubbleField.type}" which may not be text-compatible.`,
      };
    }
  }

  return null;
}

// ── Display helpers ───────────────────────────────────────────────────────────

/**
 * Format a pre-flight result for terminal output.
 * Returns the full formatted string (caller handles console.log/error).
 */
export function formatPreflightReport(result: SchemaPreflightResult): string {
  const lines: string[] = [];

  const errors = result.issues.filter((i) => i.severity === 'error');
  const warnings = result.issues.filter((i) => i.severity === 'warning');

  const statusLabel = result.ok
    ? (warnings.length > 0 ? `⚠ ${warnings.length} warning(s)` : '✅ All clear')
    : `❌ ${errors.length} error(s)${warnings.length > 0 ? `, ${warnings.length} warning(s)` : ''}`;

  lines.push('');
  lines.push(`   Checked:  ${result.checkedTypes} type(s), ${result.checkedFields} field(s)`);
  lines.push(`   Status:   ${statusLabel}`);

  if (result.issues.length > 0) {
    lines.push('');
    for (const issue of result.issues) {
      const prefix = issue.severity === 'error' ? '   ❌' : '   ⚠';
      const loc = issue.fieldName
        ? `[${issue.severity === 'error' ? 'Missing Field' : 'Type Mismatch'}]  ${issue.typeName}.${issue.fieldName}`
        : `[Missing Type]   "${issue.typeName}"`;
      lines.push(`${prefix} ${loc}`);
      lines.push(`      → ${issue.message}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
