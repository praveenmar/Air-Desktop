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
}

export class InteractionContextRepository {
  constructor(private db: AsyncSQLiteDatabase) {}

  public async upsert(input: UpsertInteractionContextInput): Promise<UpsertInteractionContextResult> {
    const normalizedControlSignature = input.controlSignature ?? '';
    const requestedIsStable = input.isStable === false ? 0 : 1;
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
        AND interaction_contexts.is_stable = 0
    `);

    await stmt.run(
      crypto.randomUUID(),
      input.sessionId,
      input.normalizedUrl,
      normalizedControlSignature,
      input.snapshotHtml,
      JSON.stringify(input.anchors ?? []),
      requestedIsStable,
      input.viewportWidth ?? null,
      input.viewportHeight ?? null,
      input.capturedAt ?? Date.now()
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

    return {
      isStable: persisted?.isStable === 0 ? 0 : 1,
    };
  }
}
