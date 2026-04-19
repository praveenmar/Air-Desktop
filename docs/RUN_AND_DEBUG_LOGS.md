# AIR Run + Debug Log Guide (Teammate Onboarding)

This guide helps a new teammate run AIR locally and quickly understand where to check logs when recording or graphing behavior looks wrong.

## 1) Run the app locally

1. Install dependencies:

```bash
npm install
```

2. Start AIR in dev mode:

```bash
npm run dev
```

3. In the AIR window:
- Open `Recording`
- Enter a URL (for example `https://example.com`)
- Click `Record`
- Interact with the opened browser window
- Click `Stop`
- Open `Sessions` and choose `View Graph`

## 2) High-level pipeline (so logs make sense)

Event flow:

`interceptor.js (browser page)`  
-> `EventServer POST /api/events`  
-> `GraphBuilder` + handlers  
-> SQLite tables (`events`, `nodes`, `edges`, `debug_logs`)

Healthy flow usually looks like:

1. Interceptor: `[FLUSH] Sending ...`
2. EventServer: `[EVENT_RECEIVED]`
3. EventServer: `[EVENT_STORED]`
4. EventServer: `[GRAPH_PROCESSED]`
5. EventServer: `[PIPELINE_OK]`
6. GraphBuilder: `Event stage: ...`

## 3) Where to check logs

## A) Terminal running `npm run dev` (main process logs)

Primary place for server/pipeline failures.

Look for:
- `[EventServer] Started { port: ... }`
- `[EventServer] [SCHEMA_FAIL]`
- `[EventServer] [EVENT_DROPPED]`
- `[EventServer] Session mismatch`
- `[EventServer] [GRAPH_PROCESS_FAIL]`
- `[info]/[warn]/[error] [GraphBuilder] ...`
- `[BaselineHandler] ...`
- `[OutcomeHandler] ...`

Important: EventServer logs are console logs; they are not written to `debug_logs`.

## B) Recorded page DevTools console (interceptor logs)

Open DevTools in the recorded browser page and filter by `FLUSH`, `NAV`, `AIR_SEND`.

Key lines:
- `[FLUSH] Sending <type> via <GM transport|fetch>`
- `[FLUSH] Event sent successfully`
- `[FLUSH] Event dropped (HTTP 4xx ...)`
- `[FLUSH] Server rejected ... Retrying`
- `[NAV] Dispatched via GM beacon/sendBeacon`
- `Transport failure ... scheduling retry`

This tells you whether events left the page successfully.

## C) SQLite (`air-data.db`) for persistent debug timeline

DB path is created from `app.getPath('userData') + '/air-data.db'`.
On Windows, check these first:

- `%APPDATA%\air-desktop\air-data.db`
- `%APPDATA%\AIR Desktop\air-data.db`
- `%LOCALAPPDATA%\air-desktop\air-data.db`
- `%LOCALAPPDATA%\AIR Desktop\air-data.db`

Quick PowerShell check:

```powershell
$candidates = @(
  "$env:APPDATA\air-desktop\air-data.db",
  "$env:APPDATA\AIR Desktop\air-data.db",
  "$env:LOCALAPPDATA\air-desktop\air-data.db",
  "$env:LOCALAPPDATA\AIR Desktop\air-data.db"
)
$candidates | Where-Object { Test-Path $_ }
```

## 4) Useful DB queries (copy/paste via Node + node:sqlite)

Set DB path first:

```powershell
$env:AIR_DB_PATH = "C:\Users\<you>\AppData\Roaming\air-desktop\air-data.db"
```

Latest sessions:

```powershell
node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(process.env.AIR_DB_PATH); console.table(db.prepare('SELECT id,status,event_count,started_at,last_event_at FROM sessions ORDER BY started_at DESC LIMIT 10').all());"
```

Latest events:

```powershell
node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(process.env.AIR_DB_PATH); console.table(db.prepare('SELECT id,type,session_id,trace_id,node_id,timestamp FROM events ORDER BY timestamp DESC LIMIT 25').all());"
```

Latest debug logs:

```powershell
node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(process.env.AIR_DB_PATH); console.table(db.prepare('SELECT timestamp,component,level,message,session_id,trace_id FROM debug_logs ORDER BY timestamp DESC LIMIT 50').all());"
```

Debug logs for one session:

```powershell
node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(process.env.AIR_DB_PATH); const sid = process.argv[1]; console.table(db.prepare('SELECT timestamp,component,level,message,trace_id FROM debug_logs WHERE session_id=? ORDER BY timestamp DESC LIMIT 200').all(sid));" "session-<id>"
```

## 5) Component-by-component log meaning

- `SessionManager`
  - `Session created...` = first event for that recording flow
  - `Session already active...` = reusing active pointer

- `BaselineHandler`
  - `Reused node via controlSignature...` = strong Phase-1 match (controls + normalized URL)
  - `Reused node via canonical hash...` = fallback match
  - `New node - no ... match found` = new state node created

- `OutcomeHandler`
  - `Found PENDING ACTION for outcome` = good trace linkage
  - `Edge created: navigation|state_refresh|no_change - <reason>` = why edge type was chosen
  - `Orphaned OUTCOME event...` = missing pending action/trace linkage

- `GraphBuilder`
  - `Event stage: action recorded, pending action registered`
  - `Event stage: outcome processed, edge created or updated`
  - `Event stage: SPA route transition processed as synthetic outcome`
  - `Event stage: no node resolved - event not linked`
  - `Event stage: ignored input heartbeat`

## 6) Fast triage checklist

1. No graph updates:
- Check terminal for `[EVENT_RECEIVED]` then `[GRAPH_PROCESSED]`
- If missing, inspect interceptor `[FLUSH]` logs first

2. Events rejected:
- `[SCHEMA_FAIL]` -> payload/type contract issue
- `[EVENT_DROPPED]` with `session_mismatch` -> stale/wrong session id
- `[EVENT_DROPPED]` with `graph_processing_failed` -> GraphBuilder/handler failure

3. Events stored but wrong node behavior:
- Check `BaselineHandler` decision logs (control signature vs canonical hash vs new node)

4. Wrong edge classification:
- Check `OutcomeHandler` reason in `Edge created: ... - <reason>`

5. CSP/connect-src issues on strict sites:
- Confirm interceptor uses `GM transport` path in `[FLUSH] Sending ... via GM transport`
- If only fetch path is used and blocked, inspect bridge injection path in main process logs

## 7) IPC-based debug fetch (from AIR renderer DevTools)

In AIR app DevTools console:

```js
const sessions = await window.airAPI.session.list(5);
const sid = sessions[0]?.id;
const logs = await window.airAPI.session.getDebugLogs(sid, 200);
console.table(logs.map(l => ({
  time: new Date(l.timestamp).toISOString(),
  component: l.component,
  level: l.level,
  message: l.message,
  traceId: l.traceId
})));
```

This is the easiest way to inspect session-scoped `debug_logs` without running SQL manually.

## 8) Known UI caveat

`RecordingView` currently polls `graph.getRecentEvents`, but that method is not exposed in preload IPC.  
If live event rows look empty, rely on:
- terminal logs
- status bar counters
- `Sessions -> View Graph`
- `session.getDebugLogs(...)` / DB queries above

## 9) Resolver Trace Audit (CSV/JSON)

Use this when you want per-step evidence of how snapshot lookup behaved during generation.

Run (from repo root):

```powershell
npm run trace --workspace @air/codegen -- --list
npm run trace --workspace @air/codegen -- session-<id>
```

Optional output formats:

```powershell
npm run trace --workspace @air/codegen -- session-<id> --json --out air-trace.json
npm run trace --workspace @air/codegen -- session-<id> --csv  --out air-trace.csv
```

Important columns in output:
- `snapshotSource`: resolver-level source (`latest-stable`, `latest`, `unavailable`)
- `icLookupMode`: `exact_key_match | url_fallback | event_fallback | node_fallback | none`
- `controlSignatureUsed`: signature used in IC lookup key
- `controlSignatureMissing`: true when lookup used empty signature
- `snapshotSizeBytes`: size of the selected snapshot payload
- `icIsStable`: IC row stability flag when source is IC
- `snapshotRejectedReason`: shows `*_too_large` when candidates were skipped for size

