import { BubbleDataType } from '../services/bubble-meta.js';
import { readFileSync } from 'fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Severity level for a detected PII field. */
export type RiskLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM';

/** A single PII detection finding for one field. */
export interface PiiMatch {
  /** Bubble data type name (e.g. "User"). */
  typeName: string;
  /** Field name as defined in Bubble (e.g. "password_hash"). */
  fieldName: string;
  /** Bubble field type (e.g. "text", "number"). */
  fieldType: string;
  /** Detected risk level. */
  riskLevel: RiskLevel;
  /** Human-readable explanation of why this field is flagged. */
  reason: string;
  /** Recommended Bubble Privacy Rule action. */
  recommendation: string;
}

/** Complete result of a privacy audit scan. */
export interface AuditResult {
  /** Whether data came from a local file or remote schema. */
  source: 'local-file' | 'remote-schema';
  /** Bubble app name (if available). */
  app?: string;
  /** Bubble environment (if available). */
  env?: string;
  /** ISO 8601 timestamp when the scan was performed. */
  scannedAt: string;
  /** Total number of data types scanned. */
  totalTypes: number;
  /** Total number of fields scanned. */
  totalFields: number;
  /** All detected PII findings. */
  findings: PiiMatch[];
  /** Counts per risk level. */
  summary: {
    critical: number;
    high: number;
    medium: number;
    total: number;
  };
}

/** Internal pattern definition for the PII scanner. */
export interface PiiPattern {
  /** Display name of the category (e.g. "Credentials"). */
  category: string;
  /** Keywords to match against normalized field names. */
  keywords: string[];
  /** Risk level assigned when this pattern matches. */
  riskLevel: RiskLevel;
  /** Template for the reason string (receives the matched keyword). */
  reason: (keyword: string) => string;
  /** Recommended Bubble Privacy Rule action. */
  recommendation: string;
}

// ---------------------------------------------------------------------------
// Pattern Dictionary
// ---------------------------------------------------------------------------

/**
 * Ordered list of PII detection patterns.
 * Each pattern is checked against normalized field names (lowercase, no separators).
 * Patterns are evaluated top-to-bottom; the first match wins per field.
 */
export const PII_PATTERNS: PiiPattern[] = [
  // ── CRITICAL: Credentials ──────────────────────────────────────────────
  {
    category: 'Credentials',
    keywords: [
      'password', 'passwd', 'pwd', 'secret', 'token',
      'apikey', 'api_key', 'privatekey', 'private_key',
      'authtoken', 'auth_token', 'accesstoken', 'access_token',
      'refreshtoken', 'refresh_token', 'sessiontoken', 'session_token',
    ],
    riskLevel: 'CRITICAL',
    reason: (kw) => `Field name matches credential pattern ("${kw}"). Exposing this field risks account takeover.`,
    recommendation:
      'In Bubble Privacy Rules: set this field to "No one" access. Never expose credentials via the Data API. Consider hashing instead of storing plaintext.',
  },
  // ── CRITICAL: Financial / Payment ──────────────────────────────────────
  {
    category: 'Financial',
    keywords: [
      'creditcard', 'credit_card', 'cardnumber', 'card_number', 'cardnum',
      'cvv', 'cvc', 'ssn', 'socialsecurity', 'social_security',
      'bankaccount', 'bank_account', 'iban', 'routingnumber', 'routing_number',
      'taxid', 'tax_id', 'ein', 'vatid', 'vat_id',
    ],
    riskLevel: 'CRITICAL',
    reason: (kw) => `Field name matches financial/identity pattern ("${kw}"). Exposure risk: financial fraud or identity theft.`,
    recommendation:
      'In Bubble Privacy Rules: restrict to "No one" or only the record owner. Consider tokenising payment data via a PCI-compliant provider (e.g. Stripe) rather than storing it.',
  },
  // ── HIGH: Government / Official IDs ────────────────────────────────────
  {
    category: 'Government ID',
    keywords: [
      'passport', 'nationalid', 'national_id', 'driverlicense', 'driver_license',
      'driverslicense', 'idnumber', 'id_number', 'sinnumber', 'sin_number', 'nin',
    ],
    riskLevel: 'HIGH',
    reason: (kw) => `Field name matches government/official ID pattern ("${kw}"). Identity fraud risk if exposed.`,
    recommendation:
      'In Bubble Privacy Rules: restrict to "This User" only. Avoid storing full ID numbers — use only what is legally required.',
  },
  // ── HIGH: Biometric Data ────────────────────────────────────────────────
  {
    category: 'Biometric',
    keywords: [
      'fingerprint', 'faceid', 'face_id', 'biometric', 'retina',
      'iris', 'voiceprint', 'dna',
    ],
    riskLevel: 'HIGH',
    reason: (kw) => `Field name matches biometric data pattern ("${kw}"). Biometric data is irreplaceable and heavily regulated.`,
    recommendation:
      'In Bubble Privacy Rules: restrict to "This User" only. Biometric data falls under GDPR Article 9 — obtain explicit consent and document processing.',
  },
  // ── HIGH: Contact PII ───────────────────────────────────────────────────
  {
    category: 'Contact PII',
    keywords: [
      'email', 'phone', 'mobile', 'cellphone', 'cell_phone',
      'phonenumber', 'phone_number', 'address', 'streetaddress', 'street_address',
      'zipcode', 'zip_code', 'postalcode', 'postal_code', 'postcode',
      'dateofbirth', 'date_of_birth', 'dob', 'birthdate', 'birth_date', 'birthday',
    ],
    riskLevel: 'HIGH',
    reason: (kw) => `Field name matches personal contact information ("${kw}"). PII exposure risk.`,
    recommendation:
      'In Bubble Privacy Rules: restrict to "This User" and explicitly granted roles only. Do not expose contact info to unauthenticated users.',
  },
  // ── HIGH: Medical / Health ──────────────────────────────────────────────
  {
    category: 'Medical',
    keywords: [
      'diagnosis', 'medical', 'health', 'insurance', 'prescription',
      'patient', 'symptom', 'condition', 'medication', 'hipaa',
      'mentalhealth', 'mental_health',
    ],
    riskLevel: 'HIGH',
    reason: (kw) => `Field name matches medical/health data pattern ("${kw}"). HIPAA-sensitive data requires strict access control.`,
    recommendation:
      'In Bubble Privacy Rules: restrict to authorized medical staff roles only. Ensure HIPAA / GDPR compliance — log all access.',
  },
  // ── MEDIUM: Geolocation ─────────────────────────────────────────────────
  {
    category: 'Geolocation',
    keywords: [
      'gps', 'latitude', 'longitude', 'coordinates', 'geolocation',
      'location', 'latlng', 'lat_lng', 'lat', 'lng',
    ],
    riskLevel: 'MEDIUM',
    reason: (kw) => `Field name matches precise location pattern ("${kw}"). Location tracking may expose user movements.`,
    recommendation:
      'In Bubble Privacy Rules: restrict to "This User" only. Avoid storing high-precision coordinates; consider rounding to city/region level.',
  },
  // ── MEDIUM: General PII / Demographics ─────────────────────────────────
  {
    category: 'Demographics',
    keywords: [
      'firstname', 'first_name', 'lastname', 'last_name', 'fullname', 'full_name',
      'gender', 'race', 'ethnicity', 'religion', 'nationality',
      'salary', 'income', 'wage',
    ],
    riskLevel: 'MEDIUM',
    reason: (kw) => `Field name matches personal demographic data ("${kw}"). Demographic PII can enable discrimination or profiling.`,
    recommendation:
      'In Bubble Privacy Rules: restrict to "This User" and authenticated roles. Avoid exposing demographic fields in public-facing APIs.',
  },
];

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Normalizes a field name for pattern matching:
 * - lowercase
 * - removes underscores, hyphens, and spaces (so `api_key`, `apiKey`, `api-key` all match `apikey`)
 */
function normalize(name: string): string {
  return name.toLowerCase().replace(/[_\-\s]/g, '');
}

// ---------------------------------------------------------------------------
// Core Scanner
// ---------------------------------------------------------------------------

/**
 * Scans a list of Bubble data types and returns all PII findings.
 *
 * @param types      - Data types from the Bubble Meta API (or reconstructed from backup).
 * @param source     - Whether data came from a local file or remote API.
 * @param app        - Optional Bubble app name for the audit result metadata.
 * @param env        - Optional Bubble environment for the audit result metadata.
 */
export function scanTypes(
  types: BubbleDataType[],
  source: 'local-file' | 'remote-schema',
  app?: string,
  env?: string,
): AuditResult {
  const findings: PiiMatch[] = [];
  let totalFields = 0;

  for (const type of types) {
    for (const field of type.fields) {
      totalFields++;

      const normalizedName = normalize(field.display);

      // Check each pattern — first match wins (highest risk first)
      for (const pattern of PII_PATTERNS) {
        const matchedKeyword = pattern.keywords.find((kw) =>
          normalizedName.includes(normalize(kw))
        );

        if (matchedKeyword) {
          findings.push({
            typeName: type.display,
            fieldName: field.display,
            fieldType: field.type,
            riskLevel: pattern.riskLevel,
            reason: pattern.reason(matchedKeyword),
            recommendation: pattern.recommendation,
          });
          break; // First-match wins — avoid duplicate findings for one field
        }
      }
    }
  }

  const critical = findings.filter((f) => f.riskLevel === 'CRITICAL').length;
  const high = findings.filter((f) => f.riskLevel === 'HIGH').length;
  const medium = findings.filter((f) => f.riskLevel === 'MEDIUM').length;

  return {
    source,
    app,
    env,
    scannedAt: new Date().toISOString(),
    totalTypes: types.length,
    totalFields,
    findings,
    summary: {
      critical,
      high,
      medium,
      total: findings.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Backup File Parser
// ---------------------------------------------------------------------------

/**
 * Shape of a bubble-io-cli backup JSON envelope.
 * We only need enough to reconstruct field names and type name.
 */
interface BackupEnvelope {
  meta?: {
    type?: string;
    app?: string;
    env?: string;
  };
  data?: Record<string, unknown>[];
}

/**
 * Scans a local backup JSON file produced by `bubble-io-cli backup`.
 * Reconstructs a minimal BubbleDataType list from the backup envelope
 * and field names found in the first data record.
 *
 * @param filePath - Absolute or relative path to the backup JSON file.
 */
export function scanBackupFile(filePath: string): AuditResult {
  const raw = readFileSync(filePath, 'utf-8');
  const envelope = JSON.parse(raw) as BackupEnvelope;

  const typeName = envelope.meta?.type ?? 'Unknown';
  const app = envelope.meta?.app;
  const env = envelope.meta?.env;
  const records = envelope.data ?? [];

  // Build a union of all field names across all records to maximise coverage
  const fieldNameSet = new Set<string>();
  for (const record of records) {
    for (const key of Object.keys(record)) {
      fieldNameSet.add(key);
    }
  }

  // Reconstruct a minimal BubbleDataType for the scanner
  const reconstructedType: BubbleDataType = {
    id: typeName.toLowerCase(),
    display: typeName,
    fields: Array.from(fieldNameSet).map((name) => ({
      id: name,
      display: name,
      type: 'unknown', // field type is not stored in backup data
    })),
  };

  return scanTypes([reconstructedType], 'local-file', app, env);
}

// ---------------------------------------------------------------------------
// Schema Scanner (remote)
// ---------------------------------------------------------------------------

/**
 * Scans a live Bubble schema (from the Meta API) for PII risks.
 *
 * @param types - Data types fetched from BubbleMetaClient.getDataTypes().
 * @param app   - Bubble app name (for audit metadata).
 * @param env   - Bubble environment (for audit metadata).
 */
export function scanSchema(
  types: BubbleDataType[],
  app?: string,
  env?: string,
): AuditResult {
  return scanTypes(types, 'remote-schema', app, env);
}
