# API layout

`api.php` is the stable front controller used by the browser. It starts the session, loads shared helpers, requires authentication for private actions, and dispatches route modules.

- `api/helpers.php` — shared data-store, document-storage, permissions, and notification helpers.
- `api/routes/auth.php` — login, session lookup, and logout.
- `api/routes/notifications.php` — list, mark read, and delete notifications.
- `api/routes/attendance.php` — dated attendance entries and attendance totals.
- `api/routes/account.php` — password changes.
- `api/routes/data.php` — roster, section, and profile reads and saves.
- `api/routes/documents.php` — requirement uploads, reads, and deletion.

Each route file defines a handler function. `api.php` passes the action and request method to every handler, and passes the authenticated account to private handlers. Keep every route behind the front controller; do not request route files directly.