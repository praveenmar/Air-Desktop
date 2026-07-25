Air VS Code extension scaffold
=================================

Files created as placeholders:

- `src/extension.ts` — extension activation entry (paste Implementation doc here).
- `src/utils/interceptor-loader.ts` — placeholder for shared interceptor loader logic.
- `src/utils/db-path.ts` — helper to determine safe DB path.

Guidance:

- Paste the content from "Implementation of VS code extension details" into `src/extension.ts`.
- Implement actual interceptor loading logic in `interceptor-loader.ts` using `app.isPackaged`
  (Electron) or `process.resourcesPath`. For non-Electron runtimes allow `AIR_INTERCEPTOR_PATH`.
- Use `getDefaultDbPath()` as a safe fallback; prefer `AIR_DB_PATH` env override in CI.
