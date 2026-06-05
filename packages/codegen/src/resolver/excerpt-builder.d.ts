import type { CodegenStep } from '../types';
export declare function redactSnapshot(html: string): string;
export declare function serializeSnapshotExcerpt(snapshot: Document, step: CodegenStep, maxChars: number): {
    excerpt: string;
    mode: 'target-selector' | 'seed-element' | 'document-fallback';
    metrics: {
        excerptBuildTotalMs: number;
        pruneMs: number;
        redactMs: number;
        finalExcerptChars: number;
    };
};
