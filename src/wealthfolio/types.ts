/**
 * Wealthfolio adapter types for the Revolut importer.
 *
 * This module imports `@wealthfolio/addon-sdk` *types* only (no runtime
 * import) for signatures that cross the adapter boundary. The single runtime
 * conversion boundary is `convert-activity.ts`.
 */
import type { AssetResolutionInput } from '@wealthfolio/addon-sdk';

/** Add-on id as declared in `manifest.json`. Used to isolate this add-on's
 * metadata entries from other importers' entries on the same account. */
export const IMPORTER_ID = 'revolut-importer';

/** Add-on version, recorded in metadata for forward-compatibility. */
export const IMPORTER_VERSION = '0.1.0';

/** Source schema version fingerprinted into every activity. */
export const SOURCE_SCHEMA_VERSION = 'revolut-investment-csv:v1';

/** Source type tag recorded in metadata. */
export const SOURCE_TYPE = 'revolut-investment-csv';

/**
 * Metadata schema v1 — non-sensitive provenance only.
 *
 * NEVER store full raw records, balances, filenames, paths, or account
 * statement paths here. Only the fields needed to (a) detect duplicates,
 * (b) reconstruct an instrument mapping, and (c) attribute the activity to
 * this importer.
 */
export interface ActivityMetadataV1 {
  /** Schema version of this metadata object. */
  metadataVersion: 1;
  /** This add-on's manifest id. Used to filter `getAll()` results. */
  importerId: string;
  /** This add-on's version at import time. */
  importerVersion: string;
  /** Pure-core source fingerprint schema version. */
  sourceSchemaVersion: string;
  /** Source statement type tag. */
  sourceType: string;
  /** Idempotency fingerprint (SHA-256 hex) from the pure core. */
  sourceFingerprint: string;
  /** 1-based source row number that produced this activity. */
  sourceRowNumber: number;
  /** Source ticker used to reconstruct a mapping. */
  sourceTicker?: string;
  /** Resolved canonical symbol, when known. */
  resolvedSymbol?: string;
  /** Resolved exchange MIC, when known. */
  resolvedMic?: string;
  /** Resolved market-data provider id, when known. */
  resolvedProviderId?: string;
}

/**
 * A draft plus its computed fingerprint and resolved asset, ready for the
 * adapter flow. The pure core produces drafts and fingerprints; the adapter
 * enriches drafts with resolution before conversion.
 */
export interface PreparedDraft {
  /** Original pure-core draft. */
  draft: import('../domain/activity-draft').ActivityDraft;
  /** Idempotency fingerprint hex (from the pure-core source-row fingerprint). */
  fingerprint: string;
  /** 1-based source row number. */
  sourceRowNumber: number;
  /** Resolved asset resolution input, when a confirmed mapping exists. */
  asset?: AssetResolutionInput;
}

/** A persistence failure reported by Wealthfolio for one draft. */
export interface ImportFailure {
  /** Source CSV row number, when the host returned the corresponding temp id. */
  sourceRowNumber?: number;
  /** Host-provided, actionable validation message. Never contains a raw CSV row. */
  message: string;
}

/** Result of the import flow. */
export interface ImportFlowResult {
  /** Number of rows sent to `saveMany` as creates. */
  attempted: number;
  /** Number of rows reported created by `saveMany` (authoritative). */
  created: number;
  /** Fingerprints that were marked imported (only those in `created`). */
  importedFingerprints: string[];
  /** Fingerprints whose write failed (in `errors` or thrown). */
  failedFingerprints: string[];
  /** Rows skipped as exact duplicates of already-imported activities. */
  skippedDuplicates: number;
  /** Rows blocked from import (host validation errors, UNKNOWN type, or
   * unresolved symbols). */
  blocked: number;
  /** Row-level errors returned by the host bulk-save endpoint. */
  failures: ImportFailure[];
  /** Fatal host error, when `checkImport` or `saveMany` threw. */
  fatal?: string;
}
