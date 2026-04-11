// Purpose: Handles the extraction and upsertion of Graph Nodes from Event Snapshots.
// Prototype Origin: graph-builder.js (upsertNode, _upsertStateNode, _upsertFallbackNode, serializeFingerprint)
// Changes: Adapted to use NodeRepository and StateEngine.

import crypto from 'crypto';
import { DebugLogger } from '../../logger/debug-logger';
import { StateEngine } from '../state-engine';
import { AIREvent, ElementFingerprint, PageSnapshot } from '../../types';
import { IntentDetector } from '../intent-detector';
import { NodeRepository, NodeUpdate } from '../../db/repositories/node.repository';
import { normalizeUrl } from '@air/shared';

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
      const normalizedUrl =
        event.normalizedUrl ||
        snapshot.normalizedUrl ||
        normalizeUrl(resolvedUrl);
      
      const metadata = {
        stateSource: anchors ? 'anchor' : 'html',
        lastInteraction: fingerprint ? { selector: fingerprint.selector, intent: IntentDetector.detectIntent(event) } : null,
      };

      // Phase 1 minimal identity pass: exact match on control signature + normalized URL.
      if (snapshot.controlSignature && normalizedUrl) {
        const matchedByControlSig = this.nodeRepo.findByControlSigAndUrl(snapshot.controlSignature, normalizedUrl);
        if (matchedByControlSig) {
          this.nodeRepo.updateObservation(matchedByControlSig.id, {
            lastObservedAt: event.timestamp
          });
          this.logger.log('BaselineHandler', 'info', 'Reused node via controlSignature (exact controls + normalized URL match)', {
            nodeId: matchedByControlSig.id,
            controlSignature: snapshot.controlSignature,
            url: normalizedUrl
          });
          return matchedByControlSig.id;
        }
      }

      const existing = this.nodeRepo.findByHash('default', canonicalHash);

      if (existing) {
        const updates: NodeUpdate = {
          lastObservedAt: event.timestamp,
          metadata: JSON.stringify(metadata),
          stateSource: anchors ? 'anchor' : 'html',
          anchors: anchors,
          pageUrl: resolvedUrl,
          normalizedUrl,
          controlSignature: snapshot.controlSignature || null,
        };
        if (viewportWidth !== null) updates.viewportWidth = viewportWidth;
        if (viewportHeight !== null) updates.viewportHeight = viewportHeight;
        this.nodeRepo.updateObservation(existing.id, updates);
        this.logger.log('BaselineHandler', 'info', 'Reused node via canonical hash (anchor/html fingerprint fallback)', {
          nodeId: existing.id,
          hash: canonicalHash.substring(0, 8),
          url: normalizedUrl,
        });
        return existing.id;
      }

      this.logger.log('BaselineHandler', 'info', 'New node - no control-signature or canonical-hash match found', {
        controlSignature: snapshot.controlSignature || null,
        hash: canonicalHash.substring(0, 8),
        url: normalizedUrl,
      });

      const nodeId = crypto.randomUUID();
      this.nodeRepo.upsert({
        id: nodeId,
        projectId: 'default',
        canonicalHash,
        pageUrl: resolvedUrl,
        normalizedUrl,
        pageTitle: 'pageTitle' in event ? event.pageTitle : null,
        contextTokens: JSON.stringify(contextTokens),
        snapshotHtml: htmlContent.slice(0, 500000),
        anchors,
        metadata: JSON.stringify(metadata),
        createdAt: event.timestamp,
        lastObservedAt: event.timestamp,
        stateSource: anchors ? 'anchor' : 'html',
        controlSignature: snapshot.controlSignature || null,
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
      const resolvedUrl = event.pageUrl || 'unknown';
      const normalizedUrl = event.normalizedUrl || normalizeUrl(resolvedUrl);

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
        normalizedUrl,
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
        normalizedUrl,
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
