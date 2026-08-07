import { BubbleDataType, BubbleField } from '../services/bubble-meta.js';

/**
 * A single change detected in the schema diff.
 */
export type SchemaChangeSeverity = 'added' | 'removed' | 'changed';

export interface FieldChange {
  field: string;
  severity: SchemaChangeSeverity;
  before?: string; // field type in env A
  after?: string;  // field type in env B
}

export interface TypeChange {
  type: string;
  severity: SchemaChangeSeverity;
  fieldChanges?: FieldChange[];
}

export interface SchemaDiffResult {
  envA: string;
  envB: string;
  /** Data types present in B but not in A */
  addedTypes: string[];
  /** Data types present in A but not in B */
  removedTypes: string[];
  /** Data types present in both, but with field-level differences */
  modifiedTypes: TypeChange[];
  /** True when the schemas are identical */
  identical: boolean;
}

/**
 * Computes a structural diff between two Bubble schema snapshots.
 *
 * @param typesA  - Array of BubbleDataType from environment A
 * @param typesB  - Array of BubbleDataType from environment B
 * @param envA    - Display label for environment A
 * @param envB    - Display label for environment B
 */
export function diffSchemas(
  typesA: BubbleDataType[],
  typesB: BubbleDataType[],
  envA: string,
  envB: string
): SchemaDiffResult {
  const mapA = new Map<string, BubbleDataType>(typesA.map((t) => [t.id, t]));
  const mapB = new Map<string, BubbleDataType>(typesB.map((t) => [t.id, t]));

  const allIds = new Set([...mapA.keys(), ...mapB.keys()]);

  const addedTypes: string[] = [];
  const removedTypes: string[] = [];
  const modifiedTypes: TypeChange[] = [];

  for (const id of allIds) {
    const typeA = mapA.get(id);
    const typeB = mapB.get(id);

    if (!typeA) {
      addedTypes.push(mapB.get(id)!.display);
      continue;
    }
    if (!typeB) {
      removedTypes.push(typeA.display);
      continue;
    }

    // Both sides have this type — diff fields
    const fieldChanges = diffFields(typeA.fields, typeB.fields);
    if (fieldChanges.length > 0) {
      modifiedTypes.push({ type: typeA.display, severity: 'changed', fieldChanges });
    }
  }

  return {
    envA,
    envB,
    addedTypes,
    removedTypes,
    modifiedTypes,
    identical: addedTypes.length === 0 && removedTypes.length === 0 && modifiedTypes.length === 0,
  };
}

/**
 * Computes field-level differences between two sets of fields.
 */
function diffFields(fieldsA: BubbleField[], fieldsB: BubbleField[]): FieldChange[] {
  const mapA = new Map<string, BubbleField>(fieldsA.map((f) => [f.id, f]));
  const mapB = new Map<string, BubbleField>(fieldsB.map((f) => [f.id, f]));
  const allIds = new Set([...mapA.keys(), ...mapB.keys()]);
  const changes: FieldChange[] = [];

  for (const id of allIds) {
    const fa = mapA.get(id);
    const fb = mapB.get(id);

    if (!fa) {
      changes.push({ field: fb!.display, severity: 'added', after: fb!.type });
    } else if (!fb) {
      changes.push({ field: fa.display, severity: 'removed', before: fa.type });
    } else if (fa.type !== fb.type) {
      changes.push({ field: fa.display, severity: 'changed', before: fa.type, after: fb.type });
    }
  }

  return changes;
}
