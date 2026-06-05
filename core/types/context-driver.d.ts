import { z } from 'zod';
/** Seek methods - how the user located the element */
export declare const SeekMethodSchema: z.ZodEnum<["scroll", "search", "filter", "history", "direct"]>;
export type SeekMethod = z.infer<typeof SeekMethodSchema>;
/** Metadata describing the seek action (e.g., scroll distance, search term) */
export declare const SeekStrategySchema: z.ZodObject<{
    method: z.ZodDefault<z.ZodEnum<["scroll", "search", "filter", "history", "direct"]>>;
    metadata: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    method: "filter" | "scroll" | "search" | "history" | "direct";
    metadata: Record<string, unknown>;
}, {
    method?: "filter" | "scroll" | "search" | "history" | "direct" | undefined;
    metadata?: Record<string, unknown> | undefined;
}>;
export type SeekStrategy = z.infer<typeof SeekStrategySchema>;
/** PRD's Context Driver for state differentiation */
export declare const ContextDriverSchema: z.ZodObject<{
    text: z.ZodDefault<z.ZodString>;
    score: z.ZodDefault<z.ZodNumber>;
    position: z.ZodDefault<z.ZodString>;
    semanticWeight: z.ZodDefault<z.ZodNumber>;
    historyWeight: z.ZodDefault<z.ZodNumber>;
    positionWeight: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    text: string;
    score: number;
    position: string;
    semanticWeight: number;
    historyWeight: number;
    positionWeight: number;
}, {
    text?: string | undefined;
    score?: number | undefined;
    position?: string | undefined;
    semanticWeight?: number | undefined;
    historyWeight?: number | undefined;
    positionWeight?: number | undefined;
}>;
export type ContextDriver = z.infer<typeof ContextDriverSchema>;
