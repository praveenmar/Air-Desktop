#!/usr/bin/env node
/**
 * packages/codegen/bin/air-trace.ts
 *
 * Resolver diagnostics exporter for AIR sessions.
 *
 * Goal:
 * - Export per-step diagnostics showing how snapshot lookup behaved
 *   (exact key hit vs fallback) and what resolver produced.
 *
 * Usage:
 *   npx ts-node packages/codegen/bin/air-trace.ts --list
 *   npx ts-node packages/codegen/bin/air-trace.ts <sessionId>
 *   npx ts-node packages/codegen/bin/air-trace.ts <sessionId> --out air-trace.csv
 *   npx ts-node packages/codegen/bin/air-trace.ts <sessionId> --json
 *   npx ts-node packages/codegen/bin/air-trace.ts <sessionId> --db <path>
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { CodegenService } from '../src/codegen.service.ts';
import { resolveSelectorsForSession } from '../src/selector-resolver.ts';
import type { ResolverConfig, SelectorResolution } from '../src/selector-resolver.ts';
import type { CodegenStep } from '../src/types.ts';

type OutputFormat = 'csv' | 'json';
type IcLookupMode =
  | 'exact_key_match'
  | 'url_fallback'
  | 'event_fallback'
  | 'node_fallback'
  | 'none';

interface ParsedArgs {
  sessionId: string | null;
  dbPath: string | null;
  outPath: string | null;
  listMode: boolean;
  format: OutputFormat;
}

interface SnapshotRow {
  normalizedUrl: string;
  controlSignature: string;
  isStable: 0 | 1;
  capturedAt: number;
  snapshotSizeBytes: number | null;
}

interface SnapshotRecord {
  normalizedUrl: string;
  controlSignature: string;
  isStable: boolean;
  capturedAt: number;
  snapshotSizeBytes: number | null;
}

interface LookupDescriptor {
  lookupMode: IcLookupMode;
  snapshotSizeBytes: number | null;
  icIsStable: boolean | null;
  matchedControlSignature: string | null;
  snapshotRejectedReason: string | null;
}

interface EventRow {
  timestamp: number;
  pageUrl: string | null;
  payload: string | null;
}

interface NodeSnapshotRow {
  id: string;
  snapshotSizeBytes: number | null;
}

interface AuditRow {
  sessionId: string;
  stepNumber: number;
  action: string;
  intent: string;
  originalSelector: string;
  resolvedSelector: string;
  resolvedBy: string;
  snapshotSource: string;
  icLookupMode: IcLookupMode;
  normalizedUrl: string;
  sourceNodeId: string;
  controlSignatureUsed: string;
  controlSignatureMissing: boolean;
  snapshotSizeBytes: number | null;
  icIsStable: boolean | null;
  matchedControlSignature: string | null;
  snapshotRejectedReason: string | null;
  bestScore: number;
  effectiveMatchCount: number;
  warningCodes: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    sessionId: null,
    dbPath: null,
    outPath: null,
    listMode: false,
    format: 'csv',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--list' || arg === '-l') {
      args.listMode = true;
      continue;
    }
    if ((arg === '--db' || arg === '-d') && argv[i + 1]) {
      args.dbPath = argv[++i];
      continue;
    }
    if ((arg === '--out' || arg === '-o') && argv[i + 1]) {
      args.outPath = argv[++i];
      continue;
    }
    if (arg === '--json') {
      args.format = 'json';
      continue;
    }
    if (arg === '--csv') {
      args.format = 'csv';
      continue;
    }
    if (!arg.startsWith('-') && args.sessionId === null) {
      args.sessionId = arg;
    }
  }

  return args;
}

function resolveDbPath(): string {
  if (process.env['AIR_DB_PATH']) return process.env['AIR_DB_PATH'];
  switch (process.platform) {
    case 'win32':
      return path.join(process.env['APPDATA'] || os.homedir(), 'air-desktop', 'air-data.db');
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', 'air-desktop', 'air-data.db');
    default:
      return path.join(os.homedir(), '.config', 'air-desktop', 'air-data.db');
  }
}

function parseNumberEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function resolveResolverConfig(): ResolverConfig {
  const enabledRaw = (process.env['AIR_ENABLE_LLM_SELECTOR_FALLBACK'] || '').toLowerCase();
  return {
    enableLLMFallback: enabledRaw === '1' || enabledRaw === 'true' || enabledRaw === 'yes',
    resolverMinScore: parseNumberEnv('AIR_RESOLVER_MIN_SCORE'),
    maxSnapshotBytesForValidation: parseNumberEnv('AIR_MAX_SNAPSHOT_BYTES'),
    maxSnapshotExcerptChars: parseNumberEnv('AIR_MAX_SNAPSHOT_EXCERPT_CHARS'),
    llmTimeoutMs: parseNumberEnv('AIR_SELECTOR_LLM_TIMEOUT_MS'),
    maxLLMFallbackPerSession: parseNumberEnv('AIR_MAX_LLM_FALLBACK_PER_SESSION'),
  };
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const pathPart = parsed.pathname.replace(/\/$/, '') || '/';
    return `${parsed.origin}${pathPart}`;
  } catch {
    return url;
  }
}

function buildIcKey(normalizedUrl: string, controlSignature?: string | null): string {
  return `${normalizedUrl}|${controlSignature ?? ''}`;
}

function safeJsonParse(value: string | null): any | null {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractNormalizedUrl(payload: any, pageUrl: string | null): string | null {
  const candidates = [
    payload?.interactionContext?.normalizedUrl,
    payload?.pageSnapshot?.normalizedUrl,
    payload?.pageState?.normalizedUrl,
    payload?.normalizedUrl,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  if (typeof pageUrl === 'string' && pageUrl.length > 0) return normalizeUrl(pageUrl);
  return null;
}

function extractSnapshotHtml(payload: any): string | null {
  const candidates = [
    payload?.interactionContext?.html,
    payload?.pageSnapshot?.html,
    payload?.pageState?.html,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return null;
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const raw = String(value);
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function toCsv(rows: AuditRow[]): string {
  const headers: Array<keyof AuditRow> = [
    'sessionId',
    'stepNumber',
    'action',
    'intent',
    'originalSelector',
    'resolvedSelector',
    'resolvedBy',
    'snapshotSource',
    'icLookupMode',
    'normalizedUrl',
    'sourceNodeId',
    'controlSignatureUsed',
    'controlSignatureMissing',
    'snapshotSizeBytes',
    'icIsStable',
    'matchedControlSignature',
    'snapshotRejectedReason',
    'bestScore',
    'effectiveMatchCount',
    'warningCodes',
  ];

  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(key => csvEscape(row[key])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function printSessionList(
  sessions: Array<{ sessionId: string; url: string; startedAt: string; eventCount: number }>
): void {
  if (sessions.length === 0) {
    console.log('\nNo sessions found.\n');
    return;
  }
  console.log(`\nFound ${sessions.length} session(s):\n`);
  for (const session of sessions) {
    console.log(`${session.sessionId}`);
    console.log(`  URL: ${session.url}`);
    console.log(`  Recorded: ${session.startedAt}  Events: ${session.eventCount}`);
  }
  console.log();
}

function fetchSnapshotRows(
  db: Database.Database,
  sessionId: string,
  normalizedUrls: string[]
): SnapshotRow[] {
  if (normalizedUrls.length === 0) return [];
  const placeholders = normalizedUrls.map(() => '?').join(', ');
  return db.prepare(`
    SELECT
      normalized_url AS normalizedUrl,
      control_signature AS controlSignature,
      is_stable AS isStable,
      captured_at AS capturedAt,
      length(snapshot_html) AS snapshotSizeBytes
    FROM interaction_contexts
    WHERE session_id = ?
      AND normalized_url IN (${placeholders})
    ORDER BY normalized_url ASC, control_signature ASC, is_stable DESC, captured_at DESC
  `).all(sessionId, ...normalizedUrls) as SnapshotRow[];
}

function fetchEventRows(db: Database.Database, sessionId: string): EventRow[] {
  return db.prepare(`
    SELECT timestamp, page_url AS pageUrl, payload
    FROM events
    WHERE session_id = ?
    ORDER BY timestamp DESC
  `).all(sessionId) as EventRow[];
}

function fetchNodeSnapshotRows(db: Database.Database, nodeIds: string[]): NodeSnapshotRow[] {
  if (nodeIds.length === 0) return [];
  const placeholders = nodeIds.map(() => '?').join(', ');
  return db.prepare(`
    SELECT id, length(snapshot_html) AS snapshotSizeBytes
    FROM nodes
    WHERE id IN (${placeholders})
  `).all(...nodeIds) as NodeSnapshotRow[];
}

function buildAuditRows(
  sessionId: string,
  steps: CodegenStep[],
  resolutionsByStep: Map<number, SelectorResolution>,
  snapshotRows: SnapshotRow[],
  eventRows: EventRow[],
  nodeRows: NodeSnapshotRow[],
  maxBytes: number
): AuditRow[] {
  const stableByKey = new Map<string, SnapshotRecord>();
  const anyByKey = new Map<string, SnapshotRecord>();
  const stableByUrl = new Map<string, SnapshotRecord>();
  const anyByUrl = new Map<string, SnapshotRecord>();
  const icOversizeByKey = new Map<string, number>();
  const icOversizeByUrl = new Map<string, number>();

  for (const row of snapshotRows) {
    const normalizedUrl = row.normalizedUrl;
    const controlSignature = row.controlSignature ?? '';
    const key = buildIcKey(normalizedUrl, controlSignature);
    const snapshotSizeBytes = row.snapshotSizeBytes ?? null;
    const isOversize = typeof snapshotSizeBytes === 'number' && snapshotSizeBytes > maxBytes;

    if (isOversize) {
      if (!icOversizeByKey.has(key)) icOversizeByKey.set(key, snapshotSizeBytes);
      if (!icOversizeByUrl.has(normalizedUrl)) icOversizeByUrl.set(normalizedUrl, snapshotSizeBytes);
      continue;
    }

    const record: SnapshotRecord = {
      normalizedUrl,
      controlSignature,
      isStable: row.isStable === 1,
      capturedAt: row.capturedAt,
      snapshotSizeBytes,
    };

    if (!anyByKey.has(key)) anyByKey.set(key, record);
    if (record.isStable && !stableByKey.has(key)) stableByKey.set(key, record);

    const existingAny = anyByUrl.get(normalizedUrl);
    if (!existingAny || record.capturedAt > existingAny.capturedAt) {
      anyByUrl.set(normalizedUrl, record);
    }
    if (record.isStable) {
      const existingStable = stableByUrl.get(normalizedUrl);
      if (!existingStable || record.capturedAt > existingStable.capturedAt) {
        stableByUrl.set(normalizedUrl, record);
      }
    }
  }

  const eventByUrl = new Map<string, { snapshotSizeBytes: number | null }>();
  const eventOversizeByUrl = new Map<string, number>();
  const normalizedUrlSet = new Set(steps.map(step => step.normalizedUrl || normalizeUrl(step.pageUrl)).filter(Boolean));

  for (const row of eventRows) {
    const payload = safeJsonParse(row.payload);
    if (!payload) continue;

    const normalizedUrl = extractNormalizedUrl(payload, row.pageUrl);
    if (!normalizedUrl || !normalizedUrlSet.has(normalizedUrl)) continue;
    if (eventByUrl.has(normalizedUrl)) continue;

    const html = extractSnapshotHtml(payload);
    if (!html) continue;

    const snapshotSizeBytes = Buffer.byteLength(html, 'utf8');
    if (snapshotSizeBytes > maxBytes) {
      if (!eventOversizeByUrl.has(normalizedUrl)) eventOversizeByUrl.set(normalizedUrl, snapshotSizeBytes);
      continue;
    }
    eventByUrl.set(normalizedUrl, { snapshotSizeBytes });
  }

  const nodeById = new Map<string, { snapshotSizeBytes: number | null }>();
  const nodeOversizeById = new Map<string, number>();
  for (const row of nodeRows) {
    if (row.snapshotSizeBytes === null) continue;
    if (row.snapshotSizeBytes > maxBytes) {
      nodeOversizeById.set(row.id, row.snapshotSizeBytes);
      continue;
    }
    nodeById.set(row.id, { snapshotSizeBytes: row.snapshotSizeBytes });
  }

  const lookupForStep = (step: CodegenStep): LookupDescriptor => {
    const normalizedUrl = step.normalizedUrl || normalizeUrl(step.pageUrl);
    const controlSignatureUsed = step.controlSignature ?? '';
    const sourceNodeId = step.sourceNodeId ?? '';

    if (normalizedUrl) {
      const key = buildIcKey(normalizedUrl, controlSignatureUsed);
      const exactStable = stableByKey.get(key);
      if (exactStable) {
        return {
          lookupMode: 'exact_key_match',
          snapshotSizeBytes: exactStable.snapshotSizeBytes,
          icIsStable: true,
          matchedControlSignature: exactStable.controlSignature,
          snapshotRejectedReason: null,
        };
      }

      const exactAny = anyByKey.get(key);
      if (exactAny) {
        return {
          lookupMode: 'exact_key_match',
          snapshotSizeBytes: exactAny.snapshotSizeBytes,
          icIsStable: exactAny.isStable,
          matchedControlSignature: exactAny.controlSignature,
          snapshotRejectedReason: null,
        };
      }

      const stableUrl = stableByUrl.get(normalizedUrl);
      if (stableUrl) {
        return {
          lookupMode: 'url_fallback',
          snapshotSizeBytes: stableUrl.snapshotSizeBytes,
          icIsStable: true,
          matchedControlSignature: stableUrl.controlSignature,
          snapshotRejectedReason: null,
        };
      }

      const anyUrl = anyByUrl.get(normalizedUrl);
      if (anyUrl) {
        return {
          lookupMode: 'url_fallback',
          snapshotSizeBytes: anyUrl.snapshotSizeBytes,
          icIsStable: anyUrl.isStable,
          matchedControlSignature: anyUrl.controlSignature,
          snapshotRejectedReason: null,
        };
      }

      const event = eventByUrl.get(normalizedUrl);
      if (event) {
        return {
          lookupMode: 'event_fallback',
          snapshotSizeBytes: event.snapshotSizeBytes,
          icIsStable: null,
          matchedControlSignature: null,
          snapshotRejectedReason: null,
        };
      }
    }

    if (sourceNodeId) {
      const node = nodeById.get(sourceNodeId);
      if (node) {
        return {
          lookupMode: 'node_fallback',
          snapshotSizeBytes: node.snapshotSizeBytes,
          icIsStable: null,
          matchedControlSignature: null,
          snapshotRejectedReason: null,
        };
      }
    }

    let rejection: string | null = null;
    if (normalizedUrl) {
      const key = buildIcKey(normalizedUrl, controlSignatureUsed);
      if (icOversizeByKey.has(key) || icOversizeByUrl.has(normalizedUrl)) {
        rejection = 'ic_too_large';
      } else if (eventOversizeByUrl.has(normalizedUrl)) {
        rejection = 'event_too_large';
      }
    }
    if (!rejection && sourceNodeId && nodeOversizeById.has(sourceNodeId)) {
      rejection = 'node_too_large';
    }

    return {
      lookupMode: 'none',
      snapshotSizeBytes: null,
      icIsStable: null,
      matchedControlSignature: null,
      snapshotRejectedReason: rejection,
    };
  };

  const rows: AuditRow[] = [];
  for (const step of steps) {
    const resolution = resolutionsByStep.get(step.step);
    const lookup = lookupForStep(step);
    const controlSignatureUsed = step.controlSignature ?? '';

    rows.push({
      sessionId,
      stepNumber: step.step,
      action: step.action,
      intent: step.intent,
      originalSelector: step.selector,
      resolvedSelector: resolution?.resolvedSelector ?? step.selector,
      resolvedBy: resolution?.resolverMetadata.resolvedBy ?? 'unresolved',
      snapshotSource: resolution?.resolverMetadata.snapshotSource ?? 'unavailable',
      icLookupMode: lookup.lookupMode,
      normalizedUrl: step.normalizedUrl || normalizeUrl(step.pageUrl),
      sourceNodeId: step.sourceNodeId ?? '',
      controlSignatureUsed,
      controlSignatureMissing: controlSignatureUsed.length === 0,
      snapshotSizeBytes: lookup.snapshotSizeBytes,
      icIsStable: lookup.icIsStable,
      matchedControlSignature: lookup.matchedControlSignature,
      snapshotRejectedReason: lookup.snapshotRejectedReason,
      bestScore: Number((resolution?.resolverMetadata.bestScore ?? 0).toFixed(4)),
      effectiveMatchCount: resolution?.resolverMetadata.effectiveMatchCount ?? 0,
      warningCodes: (resolution?.resolverMetadata.warningCodes ?? []).join('|'),
    });
  }

  return rows;
}

function summarize(rows: AuditRow[]): string {
  const byMode = new Map<IcLookupMode, number>();
  const bySnapshotSource = new Map<string, number>();
  let unresolved = 0;
  let missingSig = 0;
  let rejectedLarge = 0;

  for (const row of rows) {
    byMode.set(row.icLookupMode, (byMode.get(row.icLookupMode) ?? 0) + 1);
    bySnapshotSource.set(row.snapshotSource, (bySnapshotSource.get(row.snapshotSource) ?? 0) + 1);
    if (row.resolvedBy === 'unresolved') unresolved++;
    if (row.controlSignatureMissing) missingSig++;
    if (row.snapshotRejectedReason?.includes('too_large')) rejectedLarge++;
  }

  const modeSummary = Array.from(byMode.entries())
    .map(([mode, count]) => `${mode}:${count}`)
    .join(', ');
  const sourceSummary = Array.from(bySnapshotSource.entries())
    .map(([source, count]) => `${source}:${count}`)
    .join(', ');

  return [
    `Steps: ${rows.length}`,
    `Unresolved: ${unresolved}`,
    `MissingControlSignature: ${missingSig}`,
    `RejectedTooLarge: ${rejectedLarge}`,
    `LookupModes: ${modeSummary || 'none'}`,
    `SnapshotSources: ${sourceSummary || 'none'}`,
  ].join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = args.dbPath ?? resolveDbPath();

  if (!fs.existsSync(dbPath)) {
    console.error(`[ERR] Database not found: ${dbPath}`);
    process.exit(1);
  }

  const service = new CodegenService({ dbPath, minConfidence: 0.0 });

  try {
    if (args.listMode) {
      printSessionList(service.listSessions());
      return;
    }

    let sessionId = args.sessionId;
    if (!sessionId) {
      const sessions = service.listSessions();
      if (sessions.length === 0) {
        console.error('[ERR] No sessions found.');
        process.exit(1);
      }
      sessionId = sessions[0].sessionId;
      console.log(`Using most recent session: ${sessionId}`);
    }

    const session = service.buildSession(sessionId);
    const resolverConfig = resolveResolverConfig();
    const maxBytes = resolverConfig.maxSnapshotBytesForValidation ?? 2_000_000;

    const snapshotCache = await service.loadSnapshots(session, resolverConfig);
    const resolverResult = await resolveSelectorsForSession(
      session,
      snapshotCache,
      {
        ...resolverConfig,
        enableLLMFallback: false,
      },
    );

    const resolutionByStep = new Map<number, SelectorResolution>();
    for (const resolution of resolverResult.resolutions) {
      resolutionByStep.set(resolution.stepNumber, resolution);
    }

    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const normalizedUrls = Array.from(
      new Set(
        session.steps
          .map(step => step.normalizedUrl || normalizeUrl(step.pageUrl))
          .filter((url): url is string => typeof url === 'string' && url.length > 0)
      )
    );
    const sourceNodeIds = Array.from(
      new Set(
        session.steps
          .map(step => step.sourceNodeId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      )
    );

    const snapshotRows = fetchSnapshotRows(db, sessionId, normalizedUrls);
    const eventRows = fetchEventRows(db, sessionId);
    const nodeRows = fetchNodeSnapshotRows(db, sourceNodeIds);
    db.close();

    const auditRows = buildAuditRows(
      sessionId,
      session.steps,
      resolutionByStep,
      snapshotRows,
      eventRows,
      nodeRows,
      maxBytes,
    );

    const extension = args.format === 'json' ? 'json' : 'csv';
    const outPath = args.outPath
      ? path.resolve(args.outPath)
      : path.resolve(process.cwd(), `air-trace-${sessionId}.${extension}`);

    if (args.format === 'json') {
      fs.writeFileSync(outPath, `${JSON.stringify(auditRows, null, 2)}\n`, 'utf8');
    } else {
      fs.writeFileSync(outPath, toCsv(auditRows), 'utf8');
    }

    console.log(`[AIR] Trace audit written: ${outPath}`);
    console.log(summarize(auditRows));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ERR] ${message}`);
    process.exit(1);
  } finally {
    service.close();
  }
}

void main();
