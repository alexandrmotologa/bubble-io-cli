import { describe, it, expect } from 'vitest';
import {
  PII_PATTERNS,
  scanTypes,
  scanSchema,
  scanBackupFile,
  AuditResult,
  PiiMatch,
} from '../src/utils/pii-scanner.js';
import type { BubbleDataType } from '../src/services/bubble-meta.js';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

function makeType(name: string, fields: { display: string; type?: string }[]): BubbleDataType {
  return {
    id: name.toLowerCase(),
    display: name,
    fields: fields.map((f) => ({ id: f.display.toLowerCase(), display: f.display, type: f.type ?? 'text' })),
  };
}

const emptyType = makeType('Empty', []);

const safeType = makeType('Product', [
  { display: 'title' },
  { display: 'description' },
  { display: 'price', type: 'number' },
  { display: 'status' },
  { display: 'created_at', type: 'date' },
]);

const criticalType = makeType('User', [
  { display: 'password_hash' },
  { display: 'api_token' },
]);

const highType = makeType('Customer', [
  { display: 'email' },
  { display: 'phone_number' },
  { display: 'date_of_birth', type: 'date' },
]);

const mixedType = makeType('Employee', [
  { display: 'full_name' },
  { display: 'salary', type: 'number' },
  { display: 'social_security_number' },
  { display: 'gps_location' },
  { display: 'department' },
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findFinding(result: AuditResult, fieldName: string): PiiMatch | undefined {
  return result.findings.find((f) => f.fieldName === fieldName);
}

// ---------------------------------------------------------------------------
// 1. PII_PATTERNS shape validation
// ---------------------------------------------------------------------------

describe('PII_PATTERNS', () => {
  it('should export a non-empty patterns array', () => {
    expect(Array.isArray(PII_PATTERNS)).toBe(true);
    expect(PII_PATTERNS.length).toBeGreaterThan(0);
  });

  it('should have valid risk levels on every pattern', () => {
    const valid = new Set(['CRITICAL', 'HIGH', 'MEDIUM']);
    for (const p of PII_PATTERNS) {
      expect(valid.has(p.riskLevel)).toBe(true);
    }
  });

  it('should have non-empty keywords on every pattern', () => {
    for (const p of PII_PATTERNS) {
      expect(p.keywords.length).toBeGreaterThan(0);
    }
  });

  it('CRITICAL patterns should appear before HIGH/MEDIUM in the list', () => {
    const levels = PII_PATTERNS.map((p) => p.riskLevel);
    const firstHigh = levels.indexOf('HIGH');
    const lastCritical = levels.lastIndexOf('CRITICAL');
    expect(lastCritical).toBeLessThan(firstHigh);
  });
});

// ---------------------------------------------------------------------------
// 2. scanTypes — empty schema
// ---------------------------------------------------------------------------

describe('scanTypes — empty schema', () => {
  it('should return zero findings for an empty type list', () => {
    const result = scanTypes([], 'remote-schema');
    expect(result.findings).toHaveLength(0);
    expect(result.totalTypes).toBe(0);
    expect(result.totalFields).toBe(0);
    expect(result.summary.total).toBe(0);
  });

  it('should return zero findings for a type with no fields', () => {
    const result = scanTypes([emptyType], 'remote-schema');
    expect(result.findings).toHaveLength(0);
    expect(result.totalFields).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. scanTypes — safe fields (no false positives)
// ---------------------------------------------------------------------------

describe('scanTypes — no false positives', () => {
  it('should NOT flag safe business fields', () => {
    const result = scanTypes([safeType], 'remote-schema');
    expect(result.findings).toHaveLength(0);
  });

  it('should NOT flag generic terms: id, name, title, count, status, type', () => {
    const genericType = makeType('Generic', [
      { display: 'id' },
      { display: 'name' },
      { display: 'title' },
      { display: 'count' },
      { display: 'status' },
      { display: 'type' },
    ]);
    const result = scanTypes([genericType], 'remote-schema');
    expect(result.findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. CRITICAL detections
// ---------------------------------------------------------------------------

describe('scanTypes — CRITICAL findings', () => {
  it('should flag "password_hash" as CRITICAL', () => {
    const result = scanTypes([criticalType], 'remote-schema');
    const finding = findFinding(result, 'password_hash');
    expect(finding).toBeDefined();
    expect(finding?.riskLevel).toBe('CRITICAL');
  });

  it('should flag "api_token" as CRITICAL', () => {
    const result = scanTypes([criticalType], 'remote-schema');
    const finding = findFinding(result, 'api_token');
    expect(finding).toBeDefined();
    expect(finding?.riskLevel).toBe('CRITICAL');
  });

  it('should flag "secret" as CRITICAL', () => {
    const t = makeType('Config', [{ display: 'secret' }]);
    const result = scanTypes([t], 'remote-schema');
    expect(result.findings[0]?.riskLevel).toBe('CRITICAL');
  });

  it('should flag "credit_card_number" as CRITICAL', () => {
    const t = makeType('Payment', [{ display: 'credit_card_number' }]);
    const result = scanTypes([t], 'remote-schema');
    expect(result.findings[0]?.riskLevel).toBe('CRITICAL');
  });

  it('should flag "ssn" as CRITICAL', () => {
    const t = makeType('Person', [{ display: 'ssn' }]);
    const result = scanTypes([t], 'remote-schema');
    expect(result.findings[0]?.riskLevel).toBe('CRITICAL');
  });

  it('should flag "social_security_number" as CRITICAL', () => {
    const t = makeType('Person', [{ display: 'social_security_number' }]);
    const result = scanTypes([t], 'remote-schema');
    expect(result.findings[0]?.riskLevel).toBe('CRITICAL');
  });
});

// ---------------------------------------------------------------------------
// 5. HIGH detections
// ---------------------------------------------------------------------------

describe('scanTypes — HIGH findings', () => {
  it('should flag "email" as HIGH', () => {
    const result = scanTypes([highType], 'remote-schema');
    const finding = findFinding(result, 'email');
    expect(finding?.riskLevel).toBe('HIGH');
  });

  it('should flag "phone_number" as HIGH', () => {
    const result = scanTypes([highType], 'remote-schema');
    const finding = findFinding(result, 'phone_number');
    expect(finding?.riskLevel).toBe('HIGH');
  });

  it('should flag "date_of_birth" as HIGH', () => {
    const result = scanTypes([highType], 'remote-schema');
    const finding = findFinding(result, 'date_of_birth');
    expect(finding?.riskLevel).toBe('HIGH');
  });

  it('should flag "passport_number" as HIGH', () => {
    const t = makeType('KYC', [{ display: 'passport_number' }]);
    const result = scanTypes([t], 'remote-schema');
    expect(result.findings[0]?.riskLevel).toBe('HIGH');
  });

  it('should flag "medical_diagnosis" as HIGH', () => {
    const t = makeType('HealthRecord', [{ display: 'medical_diagnosis' }]);
    const result = scanTypes([t], 'remote-schema');
    expect(result.findings[0]?.riskLevel).toBe('HIGH');
  });

  it('should flag "biometric_data" as HIGH', () => {
    const t = makeType('Security', [{ display: 'biometric_data' }]);
    const result = scanTypes([t], 'remote-schema');
    expect(result.findings[0]?.riskLevel).toBe('HIGH');
  });
});

// ---------------------------------------------------------------------------
// 6. MEDIUM detections
// ---------------------------------------------------------------------------

describe('scanTypes — MEDIUM findings', () => {
  it('should flag "gps_location" as MEDIUM', () => {
    const result = scanTypes([mixedType], 'remote-schema');
    const finding = findFinding(result, 'gps_location');
    expect(finding?.riskLevel).toBe('MEDIUM');
  });

  it('should flag "full_name" as MEDIUM', () => {
    const result = scanTypes([mixedType], 'remote-schema');
    const finding = findFinding(result, 'full_name');
    expect(finding?.riskLevel).toBe('MEDIUM');
  });

  it('should flag "salary" as MEDIUM', () => {
    const result = scanTypes([mixedType], 'remote-schema');
    const finding = findFinding(result, 'salary');
    expect(finding?.riskLevel).toBe('MEDIUM');
  });

  it('should flag "latitude" as MEDIUM', () => {
    const t = makeType('Geo', [{ display: 'latitude' }, { display: 'longitude' }]);
    const result = scanTypes([t], 'remote-schema');
    expect(result.findings).toHaveLength(2);
    result.findings.forEach((f) => expect(f.riskLevel).toBe('MEDIUM'));
  });
});

// ---------------------------------------------------------------------------
// 7. Case-insensitivity
// ---------------------------------------------------------------------------

describe('scanTypes — case-insensitive matching', () => {
  it('should match PASSWORD (uppercase)', () => {
    const t = makeType('User', [{ display: 'PASSWORD' }]);
    const result = scanTypes([t], 'remote-schema');
    expect(result.findings[0]?.riskLevel).toBe('CRITICAL');
  });

  it('should match Email (mixed case)', () => {
    const t = makeType('Contact', [{ display: 'Email' }]);
    const result = scanTypes([t], 'remote-schema');
    expect(result.findings[0]?.riskLevel).toBe('HIGH');
  });

  it('should match user_Email_Address (compound mixed)', () => {
    const t = makeType('Account', [{ display: 'user_Email_Address' }]);
    const result = scanTypes([t], 'remote-schema');
    expect(result.findings[0]?.riskLevel).toBe('HIGH');
  });
});

// ---------------------------------------------------------------------------
// 8. Compound field names (partial substring match)
// ---------------------------------------------------------------------------

describe('scanTypes — compound field name matching', () => {
  it('should match "user_password" (prefix compound)', () => {
    const t = makeType('Auth', [{ display: 'user_password' }]);
    const result = scanTypes([t], 'remote-schema');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.riskLevel).toBe('CRITICAL');
  });

  it('should match "customer_email_address" (infix)', () => {
    const t = makeType('CRM', [{ display: 'customer_email_address' }]);
    const result = scanTypes([t], 'remote-schema');
    expect(result.findings[0]?.riskLevel).toBe('HIGH');
  });

  it('should match "reset_token_value" (postfix)', () => {
    const t = makeType('Auth', [{ display: 'reset_token_value' }]);
    const result = scanTypes([t], 'remote-schema');
    expect(result.findings[0]?.riskLevel).toBe('CRITICAL');
  });
});

// ---------------------------------------------------------------------------
// 9. First-match-wins (no duplicate findings per field)
// ---------------------------------------------------------------------------

describe('scanTypes — first-match-wins', () => {
  it('should produce exactly one finding per field even if multiple patterns could match', () => {
    // "password_token" could match both "password" and "token" patterns
    const t = makeType('Auth', [{ display: 'password_token' }]);
    const result = scanTypes([t], 'remote-schema');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.riskLevel).toBe('CRITICAL');
  });
});

// ---------------------------------------------------------------------------
// 10. Multi-type attribution
// ---------------------------------------------------------------------------

describe('scanTypes — multi-type attribution', () => {
  it('should attribute findings to the correct type', () => {
    const result = scanTypes([criticalType, highType, safeType], 'remote-schema');

    const userFindings = result.findings.filter((f) => f.typeName === 'User');
    const customerFindings = result.findings.filter((f) => f.typeName === 'Customer');
    const productFindings = result.findings.filter((f) => f.typeName === 'Product');

    expect(userFindings.length).toBe(2);
    expect(customerFindings.length).toBe(3);
    expect(productFindings.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 11. AuditResult metadata
// ---------------------------------------------------------------------------

describe('scanTypes — AuditResult metadata', () => {
  it('should include app and env in the result', () => {
    const result = scanTypes([highType], 'remote-schema', 'my-app', 'version-live');
    expect(result.app).toBe('my-app');
    expect(result.env).toBe('version-live');
    expect(result.source).toBe('remote-schema');
  });

  it('should set scannedAt to a valid ISO 8601 timestamp', () => {
    const result = scanTypes([emptyType], 'remote-schema');
    expect(() => new Date(result.scannedAt)).not.toThrow();
    expect(new Date(result.scannedAt).toISOString()).toBe(result.scannedAt);
  });

  it('should count summary correctly', () => {
    const result = scanTypes([criticalType, highType, mixedType], 'remote-schema');
    expect(result.summary.critical).toBe(result.findings.filter((f) => f.riskLevel === 'CRITICAL').length);
    expect(result.summary.high).toBe(result.findings.filter((f) => f.riskLevel === 'HIGH').length);
    expect(result.summary.medium).toBe(result.findings.filter((f) => f.riskLevel === 'MEDIUM').length);
    expect(result.summary.total).toBe(result.findings.length);
  });
});

// ---------------------------------------------------------------------------
// 12. scanSchema convenience wrapper
// ---------------------------------------------------------------------------

describe('scanSchema', () => {
  it('should return source: remote-schema', () => {
    const result = scanSchema([emptyType], 'myapp', 'version-test');
    expect(result.source).toBe('remote-schema');
    expect(result.app).toBe('myapp');
    expect(result.env).toBe('version-test');
  });
});

// ---------------------------------------------------------------------------
// 13. scanBackupFile
// ---------------------------------------------------------------------------

describe('scanBackupFile', () => {
  const tmpFile = join(process.cwd(), 'test-backup-pii-tmp.json');

  it('should parse a valid backup file and detect PII fields', () => {
    const backup = {
      meta: { type: 'User', app: 'test-app', env: 'version-test' },
      data: [
        {
          _id: 'abc123',
          email: 'alice@example.com',
          password_hash: '$2b$...',
          full_name: 'Alice Smith',
          title: 'Manager',
        },
      ],
    };
    writeFileSync(tmpFile, JSON.stringify(backup), 'utf-8');

    const result = scanBackupFile(tmpFile);
    expect(result.source).toBe('local-file');
    expect(result.app).toBe('test-app');
    expect(result.env).toBe('version-test');
    expect(result.findings.length).toBeGreaterThan(0);

    const hasEmail = result.findings.some((f) => f.fieldName === 'email');
    const hasPassword = result.findings.some((f) => f.fieldName === 'password_hash');
    expect(hasEmail).toBe(true);
    expect(hasPassword).toBe(true);

    unlinkSync(tmpFile);
  });

  it('should return zero findings for a backup with only safe fields', () => {
    const backup = {
      meta: { type: 'Product' },
      data: [{ _id: 'p1', title: 'Widget', price: 9.99, status: 'active' }],
    };
    writeFileSync(tmpFile, JSON.stringify(backup), 'utf-8');

    const result = scanBackupFile(tmpFile);
    expect(result.findings).toHaveLength(0);

    unlinkSync(tmpFile);
  });

  it('should handle empty data array without crashing', () => {
    const backup = { meta: { type: 'Empty' }, data: [] };
    writeFileSync(tmpFile, JSON.stringify(backup), 'utf-8');

    const result = scanBackupFile(tmpFile);
    expect(result.totalFields).toBe(0);
    expect(result.findings).toHaveLength(0);

    unlinkSync(tmpFile);
  });

  it('should throw when the file does not exist', () => {
    expect(() => scanBackupFile('/nonexistent/path/backup.json')).toThrow();
  });
});
