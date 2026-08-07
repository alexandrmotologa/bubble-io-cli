import { BubbleConstraint } from '../services/bubble-api.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Bubble constraint operators exposed to the query REPL. */
export type QueryConstraintType = Extract<
  BubbleConstraint['constraint_type'],
  | 'equals'
  | 'not equal'
  | 'text contains'
  | 'greater than'
  | 'less than'
  | 'is_empty'
  | 'is_not_empty'
>;

/** A single active field constraint set by the user during the session. */
export interface ActiveConstraint {
  /** The Bubble field ID (e.g. `'name'`). */
  key: string;
  /** The constraint operator. */
  constraint_type: QueryConstraintType;
  /** The comparison value (omitted for `is_empty` / `is_not_empty`). */
  value?: string;
}

/** Full state of an interactive query session. Immutable — all updates return new objects. */
export interface QuerySession {
  /** The Bubble data type currently being queried (display name). */
  dataType: string;
  /** The Bubble environment (`version-test` or `version-live`). */
  env: string;
  /** Number of records to fetch per page. */
  pageSize: number;
  /** Current page number (1-indexed). */
  currentPage: number;
  /** Total number of records matching the current filters (last known). */
  totalRecords: number;
  /** Records returned for the current page. */
  records: Record<string, unknown>[];
  /**
   * Quick text search string entered by the user.
   * Translated to a `text contains` constraint on the first text field.
   */
  searchText?: string;
  /** A single structured field constraint set by the user. */
  constraint?: ActiveConstraint;
}

/** Derived pagination metadata for display purposes. */
export interface PaginationInfo {
  /** Current page number (1-indexed). */
  page: number;
  /** Total number of pages based on `totalRecords` and `pageSize`. */
  totalPages: number;
  /** Number of records on the current page. */
  showing: number;
  /** Total records matching the current filter. */
  total: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates a fresh query session with default values.
 *
 * @param dataType - Display name of the Bubble data type to query.
 * @param env      - Target Bubble environment.
 * @param pageSize - Records per page (defaults to 20).
 */
export function createSession(
  dataType: string,
  env: string,
  pageSize: number = 20
): QuerySession {
  return {
    dataType,
    env,
    pageSize,
    currentPage: 1,
    totalRecords: 0,
    records: [],
    searchText: undefined,
    constraint: undefined,
  };
}

/**
 * Converts the active session filters to an array of `BubbleConstraint` objects
 * ready to pass to `BubbleApiClient.getDataType()`.
 *
 * @param session        - The current query session.
 * @param textFieldId    - The Bubble field ID to use for `searchText` (the first text field).
 *                         When omitted, text search is silently ignored.
 */
export function buildConstraints(
  session: QuerySession,
  textFieldId?: string
): BubbleConstraint[] {
  const constraints: BubbleConstraint[] = [];

  // Text search → `text contains` on the designated text field
  if (session.searchText && textFieldId) {
    constraints.push({
      key: textFieldId,
      constraint_type: 'text contains',
      value: session.searchText,
    });
  }

  // Structured constraint
  if (session.constraint) {
    const c: BubbleConstraint = {
      key: session.constraint.key,
      constraint_type: session.constraint.constraint_type,
    };
    if (session.constraint.value !== undefined) {
      c.value = session.constraint.value;
    }
    constraints.push(c);
  }

  return constraints;
}

/**
 * Derives pagination display metadata from the current session state.
 *
 * @param session - The current query session.
 */
export function paginationInfo(session: QuerySession): PaginationInfo {
  const totalPages = session.totalRecords === 0
    ? 1
    : Math.ceil(session.totalRecords / session.pageSize);

  return {
    page: session.currentPage,
    totalPages,
    showing: session.records.length,
    total: session.totalRecords,
  };
}

/**
 * Returns a new session updated with the results of a successful API fetch.
 * Does NOT mutate the input session.
 *
 * @param session      - The current session (not mutated).
 * @param records      - Records returned for this page.
 * @param totalRecords - Total matching records (from the API `count` + `remaining` sum or similar).
 */
export function applyPageResult(
  session: QuerySession,
  records: Record<string, unknown>[],
  totalRecords: number
): QuerySession {
  return {
    ...session,
    records,
    totalRecords,
  };
}

/**
 * Returns a new session with all filters cleared and page reset to 1.
 * Does NOT mutate the input session.
 *
 * @param session - The current session (not mutated).
 */
export function resetFilters(session: QuerySession): QuerySession {
  return {
    ...session,
    searchText: undefined,
    constraint: undefined,
    currentPage: 1,
    records: [],
    totalRecords: 0,
  };
}

/**
 * Returns a new session with the page number incremented by 1, clamped to totalPages.
 */
export function nextPage(session: QuerySession): QuerySession {
  const { totalPages } = paginationInfo(session);
  return {
    ...session,
    currentPage: Math.min(session.currentPage + 1, totalPages),
  };
}

/**
 * Returns a new session with the page number decremented by 1, clamped to 1.
 */
export function prevPage(session: QuerySession): QuerySession {
  return {
    ...session,
    currentPage: Math.max(session.currentPage - 1, 1),
  };
}

/**
 * Calculates the API cursor offset for the current page.
 * Bubble uses 0-based cursor offsets.
 */
export function currentCursor(session: QuerySession): number {
  return (session.currentPage - 1) * session.pageSize;
}
