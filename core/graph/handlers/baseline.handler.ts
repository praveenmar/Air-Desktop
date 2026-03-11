// Purpose: Handles the extraction and upsertion of Graph Nodes from Event Snapshots.
// Prototype Origin: graph-builder.js (upsertNode, _upsertStateNode, _upsertFallbackNode, serializeFingerprint)
// Changes: Adapted to use NodeRepository and StateEngine.

import crypto from 'crypto';
import { DebugLogger } from '../../logger/debug-logger';
import { StateEngine } from '../state-engine';
import { AIREvent, ElementFingerprint, PageSnapshot } from '../../types';
import { IntentDetector } from '../intent-detector';
import { NodeRepository, NodeUpdate } from '../../db/repositories/node.repository';

export class BaselineHandler {
  constructor(
    private nodeRepo: NodeRepository,
    private logger: DebugLogger,
    private stateEngine: typeof StateEngine
  ) {}

  public upsertNode(event: AIREvent): string | null {
    // 1. Get the Snapshot Object
    let snapshot: PageSnapshot | undefined;
    if ('pageState' in event && event.pageState) {
      snapshot = event.pageState as PageSnapshot;
    } else if ('pageSnapshot' in event && (event as any).pageSnapshot) {
      snapshot = (event as any).pageSnapshot as PageSnapshot;
    }
    
    // 2. If valid snapshot exists (HTML or Anchors), use State Node logic
    if (snapshot && (snapshot.html || (snapshot.anchors && snapshot.anchors.length > 0))) {
      return this.upsertStateNode(event, snapshot);
    }
    
    // 3. Fallback
    return this.upsertFallbackNode(event);
  }

  private upsertStateNode(event: AIREvent, snapshot: PageSnapshot): string | null {
    try {
      const canonicalHash = this.stateEngine.generateStateSignature(snapshot);
      
      const fingerprint = 'fingerprint' in event ? event.fingerprint : null;
      const contextTokens = fingerprint ? this.stateEngine.extractContextTokens(fingerprint) : [];
      const anchors = snapshot.anchors ? JSON.stringify(snapshot.anchors) : null;
      const htmlContent = snapshot.html || '';
      
      // Determine viewport safely
      let viewportWidth: number | null = null;
      let viewportHeight: number | null = null;
      if ('viewport' in event && event.viewport) {
        viewportWidth = event.viewport.width;
        viewportHeight = event.viewport.height;
      } else if (snapshot.viewport) {
        viewportWidth = snapshot.viewport.width;
        viewportHeight = snapshot.viewport.height;
      }

      const resolvedUrl = event.pageUrl || snapshot.url || 'unknown';
      
      const metadata = {
        stateSource: anchors ? 'anchor' : 'html',
        lastInteraction: fingerprint ? { selector: fingerprint.selector, intent: IntentDetector.detectIntent(event) } : null,
      };

      const existing = this.nodeRepo.findByHash('default', canonicalHash);

     if (existing) {
        const updates: NodeUpdate = {
          lastObservedAt: event.timestamp,
          metadata: JSON.stringify(metadata),
          stateSource: anchors ? 'anchor' : 'html',
          anchors: anchors,
          pageUrl: resolvedUrl,
        };
        if (viewportWidth !== null) updates.viewportWidth = viewportWidth;
        if (viewportHeight !== null) updates.viewportHeight = viewportHeight;
        this.nodeRepo.updateObservation(existing.id, updates);
        return existing.id;
      }

      const nodeId = crypto.randomUUID();
      this.nodeRepo.upsert({
        id: nodeId,
        projectId: 'default',
        canonicalHash,
        pageUrl: resolvedUrl,
        pageTitle: 'pageTitle' in event ? event.pageTitle : null,
        contextTokens: JSON.stringify(contextTokens),
        snapshotHtml: htmlContent.slice(0, 500000),
        anchors,
        metadata: JSON.stringify(metadata),
        createdAt: event.timestamp,
        lastObservedAt: event.timestamp,
        stateSource: anchors ? 'anchor' : 'html',
        viewportWidth,
        viewportHeight
      });
      
      this.logger.log('BaselineHandler', 'info', 'Created state node', { 
        nodeId, 
        hash: canonicalHash.substring(0, 8) + '...', 
        strategy: anchors ? 'Anchor' : 'HTML' 
      });
      
      return nodeId;
    } catch (error) {
      this.logger.log('BaselineHandler', 'error', 'Failed to upsert state node', { error: (error as Error).message });
      return null;
    }
  }

  private upsertFallbackNode(event: AIREvent): string | null {
    try {
      const fingerprint = 'fingerprint' in event ? event.fingerprint : null;
      const snapshotHtml = this.serializeFingerprint(fingerprint);
      const canonicalHash = this.stateEngine.generateStateSignature(snapshotHtml);
      const contextTokens = this.stateEngine.extractContextTokens(fingerprint);
      
      const metadata = { stateSource: 'fingerprint' };
      const existing = this.nodeRepo.findByHash('default', canonicalHash);

      let viewportWidth: number | null = null;
      let viewportHeight: number | null = null;
      
      if ('viewport' in event && event.viewport) {
        viewportWidth = event.viewport.width;
        viewportHeight = event.viewport.height;
      }
      
      if (existing) {
      const updates: NodeUpdate = {
        lastObservedAt: event.timestamp,
        metadata: JSON.stringify(metadata),
        stateSource: 'fingerprint',
        pageUrl: event.pageUrl || null,  // always update pageUrl (even if null)
      };
        if (viewportWidth !== null) updates.viewportWidth = viewportWidth;
        if (viewportHeight !== null) updates.viewportHeight = viewportHeight;
        this.nodeRepo.updateObservation(existing.id, updates);
      return existing.id;
      }
      const nodeId = crypto.randomUUID();

      this.nodeRepo.upsert({
        id: nodeId,
        projectId: 'default',
        canonicalHash,
        pageUrl: event.pageUrl || null,
        contextTokens: JSON.stringify(contextTokens),
        snapshotHtml,
        anchors: null,
        metadata: JSON.stringify(metadata),
        createdAt: event.timestamp,
        lastObservedAt: event.timestamp,
        stateSource: 'fingerprint',
        viewportWidth,
        viewportHeight
      });
      
      return nodeId;
    } catch (error) {
      this.logger.log('BaselineHandler', 'error', 'Failed to upsert fallback node', { error: (error as Error).message });
      return null;
    }
  }

  public serializeFingerprint(fingerprint: ElementFingerprint | null | undefined): string {
    if (!fingerprint) return '<div></div>';
    return `
      <element selector="${fingerprint.selector || ''}">
        <text>${fingerprint.textExcerpt || ''}</text>
        <context parent="${fingerprint.context?.parentTag || ''}" container="${fingerprint.context?.nearestContainerTag || ''}"/>
        <attributes hash="${fingerprint.attributesHash || ''}"/>
      </element>
    `.trim();
  }
}