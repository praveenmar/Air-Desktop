// Purpose: Heuristics for determining user intent from raw events.
// Prototype Origin: graph-builder.js (detectIntent, getRawIntent)
// Changes: Converted to a strict utility class.

import { AIREvent } from '../types';

export class IntentDetector {
  /**
   * Derives a standardized intent string from an event fingerprint.
   */
  public static detectIntent(event: AIREvent): string {
    if (!('fingerprint' in event) || !event.fingerprint) {
      return `generic_${event.type}`;
    }
    
    const fp = event.fingerprint;
    const text = (fp.textExcerpt || fp.attributes?.['aria-label'] || '').trim().toLowerCase();
    
    if (text) {
      return `interact_${text.slice(0, 20).replace(/\s+/g, '_')}`;
    }
    
    return `generic_${event.type}`;
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