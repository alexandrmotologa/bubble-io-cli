import { describe, it, expect } from 'vitest';
import {
  createSession,
  buildConstraints,
  paginationInfo,
  applyPageResult,
  resetFilters,
  nextPage,
  prevPage,
  currentCursor,
} from '../src/utils/query-session.js';
import type { QuerySession } from '../src/utils/query-session.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseSession: QuerySession = createSession('Product', 'version-test', 20);

const sessionWithData: QuerySession = {
  ...baseSession,
  totalRecords: 55,
  records: Array.from({ length: 20 }, (_, i) => ({ _id: `id${i}` })),
};

// ---------------------------------------------------------------------------
// createSession
// ---------------------------------------------------------------------------

describe('createSession', () => {
  it('sets the correct dataType', () => {
    const s = createSession('Order', 'version-test');
    expect(s.dataType).toBe('Order');
  });

  it('sets the correct env', () => {
    const s = createSession('Order', 'version-live');
    expect(s.env).toBe('version-live');
  });

  it('starts on page 1', () => {
    expect(baseSession.currentPage).toBe(1);
  });

  it('starts with zero totalRecords', () => {
    expect(baseSession.totalRecords).toBe(0);
  });

  it('starts with empty records array', () => {
    expect(baseSession.records).toEqual([]);
  });

  it('starts with no searchText filter', () => {
    expect(baseSession.searchText).toBeUndefined();
  });

  it('starts with no constraint filter', () => {
    expect(baseSession.constraint).toBeUndefined();
  });

  it('uses the provided pageSize', () => {
    const s = createSession('User', 'version-test', 10);
    expect(s.pageSize).toBe(10);
  });

  it('defaults pageSize to 20', () => {
    const s = createSession('User', 'version-test');
    expect(s.pageSize).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// buildConstraints
// ---------------------------------------------------------------------------

describe('buildConstraints', () => {
  it('returns empty array when no filters are set', () => {
    expect(buildConstraints(baseSession)).toEqual([]);
  });

  it('returns empty array when searchText is set but no textFieldId given', () => {
    const s: QuerySession = { ...baseSession, searchText: 'hello' };
    expect(buildConstraints(s, undefined)).toEqual([]);
  });

  it('returns a text contains constraint when searchText and textFieldId are set', () => {
    const s: QuerySession = { ...baseSession, searchText: 'widget' };
    const result = buildConstraints(s, 'name');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      key: 'name',
      constraint_type: 'text contains',
      value: 'widget',
    });
  });

  it('returns a field constraint when constraint is set (with value)', () => {
    const s: QuerySession = {
      ...baseSession,
      constraint: { key: 'price', constraint_type: 'greater than', value: '10' },
    };
    const result = buildConstraints(s);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ key: 'price', constraint_type: 'greater than', value: '10' });
  });

  it('returns a constraint without value for is_empty / is_not_empty', () => {
    const s: QuerySession = {
      ...baseSession,
      constraint: { key: 'email', constraint_type: 'is_empty' },
    };
    const result = buildConstraints(s);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBeUndefined();
  });

  it('returns both constraints when searchText and constraint are set', () => {
    const s: QuerySession = {
      ...baseSession,
      searchText: 'foo',
      constraint: { key: 'status', constraint_type: 'equals', value: 'active' },
    };
    const result = buildConstraints(s, 'name');
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// paginationInfo
// ---------------------------------------------------------------------------

describe('paginationInfo', () => {
  it('returns page 1 of 1 when totalRecords is 0', () => {
    const info = paginationInfo(baseSession);
    expect(info.page).toBe(1);
    expect(info.totalPages).toBe(1);
  });

  it('calculates total pages correctly', () => {
    const info = paginationInfo(sessionWithData); // 55 records, pageSize 20
    expect(info.totalPages).toBe(3); // ceil(55/20) = 3
  });

  it('reports showing as the length of current records', () => {
    const info = paginationInfo(sessionWithData);
    expect(info.showing).toBe(20);
  });

  it('reports correct total', () => {
    const info = paginationInfo(sessionWithData);
    expect(info.total).toBe(55);
  });

  it('handles last page correctly (partial page)', () => {
    const lastPageSession: QuerySession = {
      ...sessionWithData,
      currentPage: 3,
      records: Array.from({ length: 15 }, (_, i) => ({ _id: `id${i}` })),
    };
    const info = paginationInfo(lastPageSession);
    expect(info.showing).toBe(15);
    expect(info.totalPages).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// applyPageResult
// ---------------------------------------------------------------------------

describe('applyPageResult', () => {
  it('updates records on the session', () => {
    const newRecords = [{ _id: 'x1' }, { _id: 'x2' }];
    const updated = applyPageResult(baseSession, newRecords, 2);
    expect(updated.records).toEqual(newRecords);
  });

  it('updates totalRecords on the session', () => {
    const updated = applyPageResult(baseSession, [], 100);
    expect(updated.totalRecords).toBe(100);
  });

  it('does NOT mutate the original session (immutable)', () => {
    const original = { ...baseSession };
    applyPageResult(baseSession, [{ _id: 'z' }], 42);
    expect(baseSession.records).toEqual(original.records);
    expect(baseSession.totalRecords).toBe(original.totalRecords);
  });
});

// ---------------------------------------------------------------------------
// resetFilters
// ---------------------------------------------------------------------------

describe('resetFilters', () => {
  const dirtySession: QuerySession = {
    ...sessionWithData,
    searchText: 'test',
    constraint: { key: 'name', constraint_type: 'equals', value: 'foo' },
    currentPage: 3,
  };

  it('clears searchText', () => {
    expect(resetFilters(dirtySession).searchText).toBeUndefined();
  });

  it('clears constraint', () => {
    expect(resetFilters(dirtySession).constraint).toBeUndefined();
  });

  it('resets currentPage to 1', () => {
    expect(resetFilters(dirtySession).currentPage).toBe(1);
  });

  it('does NOT mutate the original session', () => {
    resetFilters(dirtySession);
    expect(dirtySession.searchText).toBe('test');
    expect(dirtySession.currentPage).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// nextPage / prevPage
// ---------------------------------------------------------------------------

describe('nextPage', () => {
  it('increments currentPage by 1', () => {
    const updated = nextPage(sessionWithData);
    expect(updated.currentPage).toBe(2);
  });

  it('does not exceed totalPages', () => {
    const lastPage: QuerySession = { ...sessionWithData, currentPage: 3 };
    const updated = nextPage(lastPage);
    expect(updated.currentPage).toBe(3); // clamped
  });
});

describe('prevPage', () => {
  it('decrements currentPage by 1', () => {
    const page2: QuerySession = { ...sessionWithData, currentPage: 2 };
    expect(prevPage(page2).currentPage).toBe(1);
  });

  it('does not go below page 1', () => {
    expect(prevPage(baseSession).currentPage).toBe(1); // clamped
  });
});

// ---------------------------------------------------------------------------
// currentCursor
// ---------------------------------------------------------------------------

describe('currentCursor', () => {
  it('returns 0 for page 1', () => {
    expect(currentCursor(baseSession)).toBe(0);
  });

  it('returns pageSize for page 2', () => {
    const page2: QuerySession = { ...baseSession, currentPage: 2, pageSize: 20 };
    expect(currentCursor(page2)).toBe(20);
  });

  it('returns correct offset for arbitrary page', () => {
    const page5: QuerySession = { ...baseSession, currentPage: 5, pageSize: 10 };
    expect(currentCursor(page5)).toBe(40);
  });
});
