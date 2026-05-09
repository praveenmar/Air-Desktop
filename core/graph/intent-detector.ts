// core/graph/intent-detector.ts
import { AIREvent } from '../types';
import { ElementFingerprint } from '../types/fingerprint';

export class IntentDetector {
  /**
   * Derives a standardized, semantic intent string from an event.
   */
  public static detectIntent(event: AIREvent): string {
    const fallback = `generic_${event.type}`;

    // --- Event-Specific Payload Parsing ---
    if (event.type === 'spa-route-change' && 'navigation' in event) {
      const nav = (event as any).navigation;
      if (nav?.to) {
        // Extract the last meaningful part of the path (e.g., /dashboard -> dashboard)
        const pathSegment = new URL(nav.to, 'http://dummy.com').pathname.split('/').filter(Boolean).pop() || 'page';
        return `navigate_to_${this.cleanString(pathSegment)}`;
      }
    }

    if (event.type === 'scroll' && 'scroll' in event) {
      const scroll = (event as any).scroll;
      if (scroll?.direction) {
        return `scroll_${scroll.direction}`;
      }
    }

    if ((event.type === 'custom-select' || event.type === 'custom-menu-select') && 'selection' in event) {
      const selection = (event as any).selection;
      if (selection?.label) {
        return `select_${this.cleanString(selection.label)}`;
      }
    }

    if (event.type === 'custom-control-open' && 'fingerprint' in event && event.fingerprint) {
      const context = this.extractContext(event.fingerprint);
      if (context) {
        return `open_${context}`;
      }
    }

    // --- Standard Fingerprint Parsing ---
    if (!('fingerprint' in event) || !event.fingerprint) {
      return fallback;
    }

    const context = this.extractContext(event.fingerprint);
    if (!context) return fallback;

    // Map the event type to a readable verb
    switch (event.type) {
      case 'click':
        return `click_${context}`;
      case 'input':
        return `type_${context}`;
      case 'submit':
        return `submit_${context}`;
      case 'hover':
        return `hover_${context}`;
      default:
        return `interact_${context}`;
    }
  }

  /**
   * Extracts the most meaningful semantic label from a fingerprint.
   */
  private static extractContext(fp: ElementFingerprint): string | null {
    let rawText: string | null | undefined = undefined;

    // Extract data-testid directly from the selector
    if (fp.selector && fp.selector.includes('data-testid=')) {
      const match = fp.selector.match(/data-testid=["']([^"']+)["']/);
      if (match && match[1]) {
        rawText = match[1];
      }
    }

    // Priority queue for the best semantic meaning.
    // Key names must match exactly what the interceptor's extractAttributes() stores.
    if (!rawText) {
      rawText = 
        fp.attributes?.['ariaLabel'] ||
        fp.attributes?.['name'] ||
        fp.attributes?.['placeholder'] ||
        fp.textExcerpt;
    }

    if (!rawText || typeof rawText !== 'string') {
      return null;
    }

    return this.cleanString(rawText);
  }

  /**
   * Helper to format strings into clean snake_case intents
   */
  private static cleanString(raw: string): string {
    return raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 30);
  }

  /**
   * Extracts the raw, unformatted text that triggered the intent.
   */
  public static getRawIntent(event: AIREvent): string | null {
    if (!('fingerprint' in event) || !event.fingerprint) {
      return null;
    }
    return event.fingerprint.textExcerpt || null;
  }
}
