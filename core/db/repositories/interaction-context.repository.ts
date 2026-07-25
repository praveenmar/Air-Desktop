import crypto from 'crypto';
import { AsyncSQLiteDatabase } from '../sqlite-adapter';

export interface UpsertInteractionContextInput {
  sessionId: string;
  normalizedUrl: string;
  controlSignature?: string | null;
  snapshotHtml: string;
  anchors?: string[] | null;
  isStable?: boolean;
  viewportWidth?: number | null;
  viewportHeight?: number | null;
  capturedAt?: number;
}

export interface UpsertInteractionContextResult {
  isStable: 0 | 1;
  persistenceReason:
    | 'inserted_new_ic'
    | 'stable_replaced_unstable'
    | 'newer_stable_replaced_older'
    | 'skipped_older_or_unstable_ic';
  controlSignatureMissing: boolean;
  controlSignatureReason?: 'control_signature_missing';
}

export class InteractionContextRepository {
  constructor(private db: AsyncSQLiteDatabase) {}

  public async upsert(input: UpsertInteractionContextInput): Promise<UpsertInteractionContextResult> {
    const normalizedControlSignature = input.controlSignature ?? '';
    const requestedIsStable = input.isStable === false ? 0 : 1;
    const capturedAt = input.capturedAt ?? Date.now();
    const controlSignatureMissing = normalizedControlSignature.length === 0;
    const existing = await this.db.prepare(`
      SELECT is_stable AS isStable, captured_at AS capturedAt
      FROM interaction_contexts
      WHERE session_id = ? AND normalized_url = ? AND control_signature = ?
      LIMIT 1
    `).get<{ isStable: number; capturedAt: number }>(
      input.sessionId,
      input.normalizedUrl,
      normalizedControlSignature
    );
    const stmt = this.db.prepare(`
      INSERT INTO interaction_contexts (
        id,
        session_id,
        normalized_url,
        control_signature,
        snapshot_html,
        anchors,
        is_stable,
        viewport_width,
        viewport_height,
        captured_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, normalized_url, control_signature)
      DO UPDATE SET
        snapshot_html = excluded.snapshot_html,
        anchors = excluded.anchors,
        is_stable = excluded.is_stable,
        viewport_width = excluded.viewport_width,
        viewport_height = excluded.viewport_height,
        captured_at = excluded.captured_at
      WHERE
        excluded.is_stable = 1
        AND (
          interaction_contexts.is_stable = 0
          OR excluded.captured_at > interaction_contexts.captured_at
        )
    `);

    const result = await stmt.run(
      crypto.randomUUID(),
      input.sessionId,
      input.normalizedUrl,
      normalizedControlSignature,
      input.snapshotHtml,
      JSON.stringify(input.anchors ?? []),
      requestedIsStable,
      input.viewportWidth ?? null,
      input.viewportHeight ?? null,
      capturedAt
    );

    const persisted = await this.db.prepare(`
      SELECT is_stable AS isStable
      FROM interaction_contexts
      WHERE session_id = ? AND normalized_url = ? AND control_signature = ?
      LIMIT 1
    `).get<{ isStable: number }>(
      input.sessionId,
      input.normalizedUrl,
      normalizedControlSignature
    );

    let persistenceReason: UpsertInteractionContextResult['persistenceReason'] = 'inserted_new_ic';
    if (existing) {
      if (result.changes > 0) {
        if (requestedIsStable === 1 && existing.isStable === 0) {
          persistenceReason = 'stable_replaced_unstable';
        } else if (
          requestedIsStable === 1 &&
          existing.isStable === 1 &&
          capturedAt > existing.capturedAt
        ) {
          persistenceReason = 'newer_stable_replaced_older';
        }
      } else {
        persistenceReason = 'skipped_older_or_unstable_ic';
      }
    }

    return {
      isStable: persisted?.isStable === 0 ? 0 : 1,
      persistenceReason,
      controlSignatureMissing,
      controlSignatureReason: controlSignatureMissing ? 'control_signature_missing' : undefined,
    };
  }
}
