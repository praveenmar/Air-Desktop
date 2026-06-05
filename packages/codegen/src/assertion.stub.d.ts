/**
 * packages/codegen/src/assertion.stub.ts
 *
 * Stub for Phase 2: user-defined assertion capture in the interceptor.
 *
 * TODAY: returns empty array. The interceptor has no mechanism yet for
 * the user to mark elements as assertion targets during recording.
 *
 * FUTURE (Phase 2): When the interceptor gains right-click → "Assert this"
 * or a keyboard shortcut to mark elements, those assertions will be stored
 * in a dedicated `user_assertions` table in the DB. This stub will be
 * replaced with a real DB query without changing any downstream types or
 * MCP tool signatures — the CodegenSession.userAssertions field already
 * exists and is part of the semantic timeline contract.
 *
 * The self-healing loop will prioritize user-defined assertions over
 * AI-derived ones, since the user explicitly declared what matters.
 */
import { UserDefinedAssertion } from './types';
/**
 * Returns user-defined assertions for a session.
 *
 * @param sessionId - The session to look up assertions for
 * @param _db       - Database instance (unused until Phase 2)
 * @returns Empty array until Phase 2 ships
 */
export declare function getUserDefinedAssertions(sessionId: string, _db: unknown): UserDefinedAssertion[];
/**
 * Checks whether the user_assertions table exists in the DB.
 * Used by codegen.service.ts to skip the query entirely in Phase 1.
 */
export declare function hasUserAssertionSupport(_db: unknown): boolean;
