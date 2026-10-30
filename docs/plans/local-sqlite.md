# Linemap local SQLite plan

## Outcome

Persist workspace and chat data in an ignored local SQLite database. Preserve
projects, diagrams, versions, notes, links, chat history, CLI sessions, and the
active diagram across restarts. Existing JSON files remain available as backups.

## Model and implementation

- Project -> diagrams -> versions; project -> notes and diagram links.
- Project -> chat threads -> messages; workspace -> optional active diagram.
- Foreign keys enforce project ownership, cascade owned records on deletion,
  and clear optional references where history should survive.
- Store Excalidraw scenes and structured message content as JSON. Preserve shape
  tags and notes inside Excalidraw customData for portable exports.
- SQLite is authoritative for workspace reads. Keep mutable chat objects only
  while a run is active; persist thread metadata and messages together.
- Use built-in bun:sqlite and node:sqlite behind a small shared SQL interface.
  Node requires >=22.13.0; retain Bun >=1.3.0. No ORM or database service.
- Default to .local/linemap.db; preserve EXCALIDRAW_DATA_DIR for custom locations.
  Ignore .local/, database files, WAL/SHM files, and new legacy data files.
- Import the default data/ tree, or the custom data directory, exactly once in
  one transaction. Reject malformed or inconsistent input with a source path;
  never silently skip records or mark a failed import complete. Preserve IDs,
  order, sessions and content. Do not modify the source JSON or git index.
- Keep run logs/exports under the local project directory. Avoid deleting source
  JSON when deleting an imported project or diagram.
- Present the product as Linemap in documentation and runtime messages. Keep
  Excalidraw library/tool identifiers and existing CLI/MCP aliases compatible.

## Execution

- [x] Add schema, runtime drivers, migrations, and transactional legacy import.
- [x] Replace workspace and chat persistence; wire startup and shutdown.
- [x] Update ignored paths, runtime requirements, branding and storage docs.
- [x] Verify import retry/idempotency, rollback, ownership constraints, deletion,
      restart persistence, and chat sessions with synthetic temporary workspaces.
- [x] Run type checks, builds, Bun and Node suites, and browser regression checks.

## Acceptance

The database and generated local files are ignored by git. Tests only use temp
directories. Existing user data and uncommitted edits remain intact. No commit
or push is part of this task. The old server was stopped before switching storage. The running server on
http://127.0.0.1:3100 now uses .local/linemap.db.

## Completed verification

- Build, TypeScript checks, full Bun server suites, Node server suites, and all
  19 Chromium browser tests passed.
- Nine focused SQLite checks passed on Bun 1.4.2 and Node 22.23.4 / 24.22.1.
- Browser checks used a fresh port after the interrupted run left tabs behind.
  An isolated baseline run also passed all 19 browser checks.
- The final stopped JSON workspace was backed up under .local/backups/ before
  the live server restarted. All 10 source JSON hashes remain unchanged.
- The live import contains 3 projects, 3 diagrams, 1 version and 1 note. Every
  imported diagram scene matches its source, and the active diagram is retained.
- SQLite integrity_check is ok and foreign_key_check has no violations.
- git check-ignore confirms the database and WAL/SHM paths are excluded.
- Existing tracked data/ edits remain user-owned and unstaged. No commit or push.

## Sources checked

- https://bun.sh/docs/runtime/sqlite
- https://nodejs.org/api/sqlite.html
- https://www.sqlite.org/foreignkeys.html
- https://www.sqlite.org/transactional.html
