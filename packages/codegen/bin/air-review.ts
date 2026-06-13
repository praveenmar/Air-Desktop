#!/usr/bin/env node
/**
 * packages/codegen/bin/air-review.ts
 *
 * CLI entry point for: npx air review [sessionId] [options]
 *
 * Usage:
 *   npx air review                          # reviews the most recent session
 *   npx air review <sessionId>              # reviews a specific session
 *   npx air review --list                   # lists all available sessions
 *   npx air review <sessionId> --db <path>  # custom DB path
 *
 * The DB path is resolved automatically from the platform default if --db
 * is not supplied:
 *   Windows : %APPDATA%/air-desktop/air-data.db
 *   macOS   : ~/Library/Application Support/air-desktop/air-data.db
 *   Linux   : ~/.config/air-desktop/air-data.db
 */

import * as path from 'path';
import * as os from 'os';
import { CodegenService } from '../src/index';
import { FlowReviewService } from '../src/flow-review.service';
import { FlowReviewFormatter } from '../src/flow-review.formatter';
import { getDatabasePath } from '../../../core/utils/air-home';

// ─────────────────────────────────────────────────────────────────────────────
// ARG PARSING  (no external dependency — keeps the CLI zero-dep)
// ─────────────────────────────────────────────────────────────────────────────

interface ParsedArgs {
  sessionId: string | null;
  dbPath:    string | null;
  listMode:  boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  // argv = process.argv.slice(2) at call site
  const args: ParsedArgs = { sessionId: null, dbPath: null, listMode: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--list' || arg === '-l') {
      args.listMode = true;
    } else if ((arg === '--db' || arg === '-d') && argv[i + 1]) {
      args.dbPath = argv[++i];
    } else if (!arg.startsWith('-')) {
      // First positional argument is the sessionId
      if (args.sessionId === null) args.sessionId = arg;
    }
  }

  return args;
}

// ─────────────────────────────────────────────────────────────────────────────
// DB PATH RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────

// DB PATH RESOLUTION is now handled by core/utils/air-home

// ─────────────────────────────────────────────────────────────────────────────
// LIST MODE
// ─────────────────────────────────────────────────────────────────────────────

function printSessionList(
  sessions: Array<{ sessionId: string; url: string; startedAt: string; eventCount: number }>,
): void {
  if (sessions.length === 0) {
    console.log('\n  No sessions found. Record a flow first with the AIR desktop app.\n');
    return;
  }

  console.log(`\n  Found ${sessions.length} session(s):\n`);
  sessions.forEach((s, i) => {
    const idx    = String(i + 1).padStart(2, ' ');
    const events = String(s.eventCount).padStart(4, ' ');
    console.log(`  [${idx}]  ${s.sessionId}`);
    console.log(`         URL    : ${s.url}`);
    console.log(`         Recorded: ${s.startedAt}   Events: ${events}`);
    console.log();
  });
  console.log(`  Tip: npx air review <sessionId>\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

function main(): void {
  const args   = parseArgs(process.argv.slice(2));
  const dbPath = args.dbPath ?? getDatabasePath();

  // Verify the DB file is reachable before doing any work
  const fs = require('fs') as typeof import('fs');
  if (!fs.existsSync(dbPath)) {
    console.error(`\n  [ERR] Database not found at: ${dbPath}`);
    console.error(`\n  Start the AIR desktop app and record a session first.`);
    console.error(`  Or supply a custom path: npx air review --db /path/to/air-data.db\n`);
    process.exit(1);
  }

  const service = new CodegenService({ dbPath, minConfidence: 0.0 });

  try {
    // ── LIST MODE ─────────────────────────────────────────────────────────
    if (args.listMode) {
      const sessions = service.listSessions();
      printSessionList(sessions);
      return;
    }

    // ── RESOLVE SESSION ID ────────────────────────────────────────────────
    let targetSessionId = args.sessionId;

    if (!targetSessionId) {
      const sessions = service.listSessions();
      if (sessions.length === 0) {
        console.error('\n  [ERR] No sessions found. Record a flow first.\n');
        process.exit(1);
      }
      // Default: most recent session (listSessions returns newest first)
      targetSessionId = sessions[0].sessionId;
      console.log(`\n  No session ID supplied — reviewing most recent session.`);
      console.log(`  Session: ${targetSessionId}\n`);
    }

    // ── BUILD SESSION TIMELINE ────────────────────────────────────────────
    const session = service.buildSession(targetSessionId);

    // ── BUILD FLOW REVIEW ─────────────────────────────────────────────────
    const review = FlowReviewService.build(session);

    // ── PRINT ─────────────────────────────────────────────────────────────
    console.log(FlowReviewFormatter.formatForConsole(review));

    // Exit code reflects warning severity so CI scripts can react
    const hasError = review.warnings.some(w => w.severity === 'error');
    process.exit(hasError ? 1 : 0);

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n  [ERR] ${message}\n`);
    process.exit(1);
  } finally {
    service.close();
  }
}

main();