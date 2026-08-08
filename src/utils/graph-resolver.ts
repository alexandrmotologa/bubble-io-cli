/**
 * Graph Resolver — Dependency Analysis & Topological Sort Engine
 *
 * Responsible for:
 *  1. Parsing a relational seed document into a node graph
 *  2. Detecting `@ref` cross-references between records across all types
 *  3. Performing a topological sort (Kahn's Algorithm) to determine the safe
 *     creation order (parents before children, N-levels deep)
 *  4. Detecting circular dependencies and separating them into deferred
 *     "patch" operations so we can resolve owl-and-egg scenarios automatically
 */

/** A single record within the relational seed document */
export interface RelationalRecord {
  /** Optional temporary reference alias used to link records together */
  _ref?: string;
  /** All other Bubble field values (may contain `@alias` strings) */
  [key: string]: unknown;
}

/** The full relational seed document — a dictionary of type → records */
export type RelationalSeedDoc = Record<string, RelationalRecord[]>;

// ── Internal graph node ───────────────────────────────────────────────────────

/** Represents a single record node in the dependency graph */
export interface GraphNode {
  /** e.g. 'Product' */
  typeName: string;
  /** Original index within the type array */
  index: number;
  /** The `_ref` alias (e.g. '@prod_macbook'), if defined */
  ref: string | null;
  /** The record data (without _ref) */
  data: Record<string, unknown>;
  /**
   * Set of `@ref` aliases this record directly depends on.
   * Collected by recursively scanning all string values and arrays.
   */
  deps: Set<string>;
}

/** A field that must be set after the record is created (circular / deferred) */
export interface DeferredPatch {
  /** The ref of the record to PATCH */
  targetRef: string;
  /** Field name to set */
  field: string;
  /** The @ref value(s) to resolve and write */
  value: unknown;
}

/** Result of the graph resolution process */
export interface ResolvedGraph {
  /** Records in safe creation order (topologically sorted) */
  sortedNodes: GraphNode[];
  /**
   * Patch operations to execute AFTER all records are created.
   * Used for circular dependency resolution only.
   */
  deferredPatches: DeferredPatch[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Recursively collect all `@ref` strings from a value tree.
 * Handles primitives, arrays, and nested objects.
 */
function collectRefs(value: unknown): Set<string> {
  const refs = new Set<string>();
  if (typeof value === 'string' && value.startsWith('@')) {
    refs.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      for (const r of collectRefs(item)) refs.add(r);
    }
  } else if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      for (const r of collectRefs(v)) refs.add(r);
    }
  }
  return refs;
}

// ── Main resolution function ──────────────────────────────────────────────────

/**
 * Resolves a RelationalSeedDoc into a topologically sorted list of nodes
 * and a list of deferred patches for circular dependencies.
 *
 * @param doc - The parsed relational seed document
 * @returns   - `sortedNodes` in safe creation order + `deferredPatches`
 * @throws    - If a `_ref` alias is defined more than once across the document
 */
export function resolveGraph(doc: RelationalSeedDoc): ResolvedGraph {
  const nodes: GraphNode[] = [];
  const refToNode = new Map<string, GraphNode>();

  // ── Step 1: Build all nodes ──────────────────────────────────────────────
  for (const [typeName, records] of Object.entries(doc)) {
    for (let i = 0; i < records.length; i++) {
      const { _ref, ...rest } = records[i];
      const ref = typeof _ref === 'string' ? _ref : null;

      const node: GraphNode = {
        typeName,
        index: i,
        ref,
        data: rest,
        deps: collectRefs(rest),
      };
      nodes.push(node);

      if (ref !== null) {
        if (refToNode.has(ref)) {
          throw new Error(
            `Duplicate _ref alias "${ref}" found in type "${typeName}". ` +
            `Each _ref must be unique across the entire seed document.`
          );
        }
        refToNode.set(ref, node);
      }
    }
  }

  // ── Step 2: Validate all @deps actually resolve to a known _ref ──────────
  for (const node of nodes) {
    for (const dep of node.deps) {
      if (!refToNode.has(dep)) {
        throw new Error(
          `Record ${node.ref ?? `#${node.index + 1}`} in "${node.typeName}" ` +
          `references unknown alias "${dep}". ` +
          `Make sure the _ref is defined in the seed document.`
        );
      }
    }
  }

  // ── Step 3: Detect circular dependencies ─────────────────────────────────
  // A circular dependency exists when A depends on B and B depends on A.
  // Strategy: detect the cycle, remove one direction (pick the field to defer),
  // and add it to deferredPatches to be resolved via PATCH after both are created.
  const deferredPatches: DeferredPatch[] = [];
  const circularPairs = new Set<string>(); // 'refA|refB' string to avoid double-processing

  for (const node of nodes) {
    if (!node.ref) continue;
    for (const dep of node.deps) {
      const depNode = refToNode.get(dep)!;
      if (!depNode.ref) continue;

      const pairKey = [node.ref, depNode.ref].sort().join('|');
      if (circularPairs.has(pairKey)) continue;

      // Check if depNode also depends on node (mutual dependency = circle)
      if (depNode.deps.has(node.ref)) {
        circularPairs.add(pairKey);

        // Pick which direction to defer: defer the one from alphabetically-later node
        // to make the resolution deterministic regardless of document order
        const [deferrer, keeper] =
          node.ref < depNode.ref ? [depNode, node] : [node, depNode];

        // Find all fields in deferrer's data that reference keeper.ref
        for (const [field, val] of Object.entries(deferrer.data)) {
          if (containsRef(val, keeper.ref!)) {
            deferredPatches.push({
              targetRef: deferrer.ref!,
              field,
              value: val,
            });
            // Remove the circular field from deferrer's data so it can be
            // created without referencing the not-yet-existing keeper
            delete deferrer.data[field];
            deferrer.deps.delete(keeper.ref!);
          }
        }
      }
    }
  }

  // ── Step 4: Topological sort (Kahn's Algorithm) ───────────────────────────
  // in-degree = number of unresolved dependencies for each node
  const inDegree = new Map<GraphNode, number>();
  const adjList = new Map<GraphNode, GraphNode[]>(); // dep → nodes that need it

  for (const node of nodes) inDegree.set(node, 0);
  for (const node of nodes) adjList.set(node, []);

  for (const node of nodes) {
    for (const dep of node.deps) {
      const depNode = refToNode.get(dep)!;
      inDegree.set(node, (inDegree.get(node) ?? 0) + 1);
      adjList.get(depNode)!.push(node);
    }
  }

  // Queue starts with all nodes that have no dependencies
  const queue: GraphNode[] = [];
  for (const [node, deg] of inDegree) {
    if (deg === 0) queue.push(node);
  }

  const sortedNodes: GraphNode[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sortedNodes.push(current);

    for (const dependent of adjList.get(current) ?? []) {
      const newDeg = (inDegree.get(dependent) ?? 1) - 1;
      inDegree.set(dependent, newDeg);
      if (newDeg === 0) queue.push(dependent);
    }
  }

  if (sortedNodes.length !== nodes.length) {
    // This should not happen after circular dependency removal above,
    // but we guard anyway for undetected multi-party cycles
    throw new Error(
      'Could not fully resolve the dependency graph. ' +
      'There may be a multi-way circular dependency that could not be automatically broken. ' +
      'Please review your _ref dependencies.'
    );
  }

  return { sortedNodes, deferredPatches };
}

// ── Ref substitution ──────────────────────────────────────────────────────────

/**
 * Check if a value (string, array, or nested object) contains a specific @ref.
 */
function containsRef(value: unknown, ref: string): boolean {
  if (typeof value === 'string') return value === ref;
  if (Array.isArray(value)) return value.some((v) => containsRef(v, ref));
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((v) => containsRef(v, ref));
  }
  return false;
}

/**
 * Recursively replace all `@ref` strings in a value tree with their
 * actual Bubble IDs from the provided id map.
 *
 * @param value  - Any value (string, array, nested object)
 * @param idMap  - Map from @ref alias → actual Bubble _id
 * @returns      - The value with all known aliases substituted
 */
export function substituteRefs(value: unknown, idMap: Map<string, string>): unknown {
  if (typeof value === 'string') {
    return value.startsWith('@') ? (idMap.get(value) ?? value) : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => substituteRefs(item, idMap));
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = substituteRefs(v, idMap);
    }
    return result;
  }
  return value;
}
