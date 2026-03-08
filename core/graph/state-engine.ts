// Purpose: Deterministic state hashing and context extraction for Graph Nodes.
// Prototype Origin: state-engine.js
// Changes: Converted to strict TypeScript. Mapped snake_case DB fields to camelCase TS interfaces.

import crypto from 'crypto';
import { PageSnapshot, ElementFingerprint, GraphNode } from '../types';

export class StateEngine {
  /**
   * Generates a stable signature for a UI state.
   * Strategy A (Functional): Uses "Anchors" (Inputs, Buttons, URL) - HIGH STABILITY
   * Strategy B (Visual): Uses "Thermonuclear HTML" - FALLBACK
   * * @param input - The PageSnapshot object OR raw HTML string
   */
  public static generateStateSignature(input: PageSnapshot | string | null | undefined): string {
    if (!input) return crypto.randomUUID();

    // ---------------------------------------------------------
    // STRATEGY A: FUNCTIONAL ANCHORS
    // ---------------------------------------------------------
    if (typeof input === 'object' && Array.isArray(input.anchors) && input.anchors.length > 0) {
      // Sort for determinism (just in case)
      const sortedAnchors = [...input.anchors].sort();
      const signatureString = sortedAnchors.join('|');
      return crypto.createHash('sha256').update(signatureString).digest('hex');
    }

    // ---------------------------------------------------------
    // STRATEGY B: THERMONUCLEAR HTML
    // ---------------------------------------------------------
    let sanitized = typeof input === 'string' ? input : (input.html || '');
    if (!sanitized) return crypto.randomUUID();

    // 1. SCOPE NORMALIZATION
    const bodyMatch = sanitized.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch && bodyMatch[1]) {
      sanitized = bodyMatch[1];
    }

    // 2. RUTHLESS CLEANING
    sanitized = sanitized
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gim, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gim, '')
      .replace(/<!--[\s\S]*?-->/gim, '')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gim, '')
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gim, ' [ICON] ')
      .replace(/<\/(img|input|br|hr|meta|link)>/gim, '')
      .replace(/\s\/>/g, '>')
      .replace(/\s([a-zA-Z0-9-]+)=""/g, ' $1') // Boolean attrs
      .replace(/\sdata-v-[\w-]+/g, '')         // Vue
      .replace(/\sdata-reactid="[^"]*"/g, '')  // React
      .replace(/(\.(png|jpg|jpeg|gif|svg|css|js|ico|woff|woff2))\?v=[^"\s>]+/g, '$1')
      .replace(/\d{4} - \d{4}/g, 'DATE-RANGE')
      .replace(/\svalue="[^"]*"/g, '')
      .replace(/<input[^>]*name="_token"[^>]*>/g, '');

    // 3. ATTRIBUTE SORTING
    sanitized = sanitized.replace(/class="([^"]*)"/g, (_, classes: string) => {
      return `class="${classes.split(/\s+/).sort().join(' ')}"`;
    });

    // 4. WHITESPACE NORMALIZATION
    sanitized = sanitized.replace(/\s+/g, ' ').trim();

    return crypto.createHash('sha256').update(sanitized).digest('hex');
  }

  /**
   * Extracts contextual semantic tokens from an element fingerprint.
   */
  public static extractContextTokens(fingerprint: ElementFingerprint | null | undefined): string[] {
    if (!fingerprint) return [];
    
    const tokens: string[] = [];
    
    const add = (v: string | null | undefined): void => {
      if (v != null && String(v).trim()) {
        tokens.push(String(v).toLowerCase().trim());
      }
    };

    add(fingerprint.textExcerpt);
    add(fingerprint.attributes?.['aria-label']);
    add(fingerprint.attributes?.['name']);
    add(fingerprint.attributes?.['role']);
    
    if (fingerprint.context) {
      add(fingerprint.context.parentTag);
      add(fingerprint.context.nearestContainerTag);
    }
    
    if (fingerprint.selectorPriority === 'data-testid' && fingerprint.selector) {
      const match = fingerprint.selector.match(/data-testid="([^"]*)"/);
      if (match && match[1]) add(match[1]);
    }
    
    if (fingerprint.selector && tokens.length === 0) {
      add(fingerprint.selector.slice(0, 80));
    }
    
    return [...new Set(tokens)];
  }

  /**
   * Calculates the Jaccard similarity between two UI state nodes based on their context tokens.
   */
  public static calculateSimilarityScore(node1: GraphNode, node2: GraphNode): number {
    let tokens1: string[] = [];
    let tokens2: string[] = [];

    try {
      tokens1 = JSON.parse(node1.contextTokens || '[]');
      tokens2 = JSON.parse(node2.contextTokens || '[]');
    } catch (e) {
      // Fallback if parsing fails
      tokens1 = [];
      tokens2 = [];
    }

    if (tokens1.length === 0 && tokens2.length === 0) {
      return node1.canonicalHash === node2.canonicalHash ? 1.0 : 0.0;
    }

    const set1 = new Set(tokens1);
    const set2 = new Set(tokens2);
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    if (union.size === 0) return 0.0;
    
    return intersection.size / union.size;
  }
}