import { BubbleDataType } from '../services/bubble-meta.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Bubble built-in type display names that appear as field types but are not
 * user-defined data types. Excluded from the entity list by default so the
 * ERD focuses on the app's own domain model.
 */
const BUBBLE_SYSTEM_TYPES = new Set([
  'User',
  'FileObject',
  'GeographicAddress',
  'AppText',
  'Option',
  'PrivacyOption',
]);

/**
 * Mapping from Bubble primitive field types to compact ERD-friendly labels.
 * Any type not in this map is rendered as-is (e.g. relationship type names).
 */
const FIELD_TYPE_LABELS: Record<string, string> = {
  text: 'text',
  number: 'number',
  boolean: 'boolean',
  date: 'date',
  'geographic address': 'geo',
  file: 'file',
  image: 'image',
  option: 'option',
  'list of text': 'text[]',
  'list of number': 'number[]',
  'list of date': 'date[]',
  'list of boolean': 'boolean[]',
  'list of file': 'file[]',
  'list of image': 'image[]',
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Options controlling what is included in the generated ERD. */
export interface ErdOptions {
  /**
   * When `true`, Bubble built-in types (User, FileObject, etc.) are rendered
   * as full entities in the diagram. Default: `false`.
   */
  includeSystemTypes?: boolean;
}

/** Structured representation of a single entity in the ERD. */
export interface ErdEntity {
  /** The safe Mermaid node identifier (spaces and special chars replaced). */
  id: string;
  /** The original display name. */
  label: string;
  /** Primitive (non-relationship) fields. */
  primitiveFields: Array<{ typeLabel: string; fieldName: string }>;
  /** Relationship fields pointing to other entities. */
  relationships: Array<{ targetId: string; targetLabel: string; fieldName: string }>;
}

/** Full result returned by `generateErdData`. */
export interface ErdData {
  entities: ErdEntity[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Converts a display name into a safe Mermaid node identifier by replacing
 * any character that is not alphanumeric or underscore with `_`.
 */
export function sanitizeId(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '_');
}

/**
 * Returns the compact ERD label for a Bubble field type string.
 * Falls back to a sanitized version of the raw type string.
 */
function resolveTypeLabel(fieldType: string): string {
  const lower = fieldType.toLowerCase();
  return FIELD_TYPE_LABELS[lower] ?? sanitizeId(fieldType);
}

/**
 * Determines whether a display name corresponds to a Bubble built-in type.
 */
function isSystemType(display: string): boolean {
  return BUBBLE_SYSTEM_TYPES.has(display);
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Analyses the raw data types and produces structured ERD data (entities and
 * relationships) without generating any string output. Useful for testing.
 *
 * @param types   - All data types fetched from the Bubble Meta API.
 * @param options - Optional ERD generation settings.
 */
export function generateErdData(
  types: BubbleDataType[],
  options: ErdOptions = {},
): ErdData {
  const { includeSystemTypes = false } = options;

  // Build a Set of all known type display names for O(1) relationship lookup
  const allTypeNames = new Set(types.map((t) => t.display));

  // Determine which types become entities (rendered as diagram nodes)
  const entityTypes = includeSystemTypes
    ? types
    : types.filter((t) => !isSystemType(t.display));

  const entities: ErdEntity[] = entityTypes.map((type) => {
    const id = sanitizeId(type.display);
    const primitiveFields: ErdEntity['primitiveFields'] = [];
    const relationships: ErdEntity['relationships'] = [];

    for (const field of type.fields) {
      if (allTypeNames.has(field.type)) {
        // This field points to another data type → it's a relationship
        // Skip system types as relationship targets if the flag is off
        if (!includeSystemTypes && isSystemType(field.type)) continue;

        relationships.push({
          targetId: sanitizeId(field.type),
          targetLabel: field.type,
          fieldName: field.display,
        });
      } else {
        primitiveFields.push({
          typeLabel: resolveTypeLabel(field.type),
          fieldName: sanitizeId(field.display),
        });
      }
    }

    return { id, label: type.display, primitiveFields, relationships };
  });

  return { entities };
}

/**
 * Generates a Mermaid `erDiagram` string from Bubble data types.
 *
 * The output is wrapped in a fenced markdown code block so it renders
 * immediately in GitHub, VS Code, and any standard markdown previewer.
 *
 * @param types   - All data types fetched from the Bubble Meta API.
 * @param options - Optional ERD generation settings.
 */
export function generateErd(
  types: BubbleDataType[],
  options: ErdOptions = {},
): string {
  const { entities } = generateErdData(types, options);

  const lines: string[] = ['```mermaid', 'erDiagram'];

  // ── Entity declarations (with primitive fields) ─────────────────────────
  for (const entity of entities) {
    if (entity.primitiveFields.length === 0) {
      // Entity with no primitive fields — still declare it so it appears
      lines.push(`  ${entity.id} {`);
      lines.push(`  }`);
    } else {
      lines.push(`  ${entity.id} {`);
      for (const f of entity.primitiveFields) {
        lines.push(`    ${f.typeLabel} ${f.fieldName}`);
      }
      lines.push(`  }`);
    }
  }

  // ── Relationship declarations ────────────────────────────────────────────
  const hasRelationships = entities.some((e) => e.relationships.length > 0);
  if (hasRelationships) {
    lines.push('');
    for (const entity of entities) {
      for (const rel of entity.relationships) {
        // One source entity can have zero-or-more references to the target
        lines.push(`  ${entity.id} ||--o{ ${rel.targetId} : "${rel.fieldName}"`);
      }
    }
  }

  lines.push('```');

  return lines.join('\n');
}

/**
 * Wraps the raw Mermaid ERD block in a full markdown document with a heading
 * and metadata footer. Used when writing output to a `.md` file.
 *
 * @param appName   - The Bubble app name (used in the heading).
 * @param env       - The environment that was queried.
 * @param erdBlock  - The raw Mermaid block from `generateErd()`.
 */
export function wrapInMarkdownDocument(
  appName: string,
  env: string,
  erdBlock: string,
): string {
  const timestamp = new Date().toISOString();
  return [
    `# Entity-Relationship Diagram — ${appName}`,
    '',
    `> Generated by **bubble-io-cli** · Environment: \`${env}\` · ${timestamp}`,
    '',
    erdBlock,
    '',
  ].join('\n');
}
