# CRM App — agent guide

A CRM with **companies**, **contacts**, and a **deals** pipeline, plus an activity
timeline and Clawnify integrations. Preact + Hono + D1.

## Core entities

- `GET/POST/PUT/DELETE /api/contacts` · `/api/companies` · `/api/deals`
- Contacts belong to companies; deals belong to contacts.
- `GET /api/stats` — counts + total pipeline value.

## Activity timeline

Every contact/company/deal has a timeline. Integrations and notes write to it.

- `GET /api/activities?entity_type=contact&entity_id=<id>` — newest first.
- `POST /api/activities` `{ entity_type, entity_id, type, body }` — log a note.

## Integrations (Clawnify connections)

These use the org's Clawnify connections — no keys live in this app. Check what's
wired first: `GET /api/integrations/status` → `{ email, meeting, slack }`.

- **Email a contact** — `POST /api/integrations/email` `{ contact_id, subject, body }`.
  Sends via the org's connected Gmail (`googlesuper`) and logs it on the contact.
- **Schedule a meeting** — `POST /api/integrations/meeting`
  `{ contact_id, summary, start_datetime, timezone, duration_minutes }`.
  Creates a Google Calendar event (`googlecalendar`) with the contact and logs it.
  `start_datetime` is local wall-clock, e.g. `2026-07-16T13:00:00`; `timezone` is
  an IANA zone, e.g. `America/New_York`.
- **Deal-won Slack alert** — when a deal is set to stage `won`, if `SLACK_CHANNEL`
  is set and Slack is connected, the app posts to that channel automatically.

If a capability isn't connected, the endpoint returns an error — tell the user to
connect it in the Clawnify dashboard; don't try to work around it.

## Import contacts (CSV / XLSX)

Users import via the dashboard UI (Contacts → **Import**): upload a CSV/XLSX, map
columns to fields, import. Programmatically: `POST /api/contacts/import`
`{ contacts: [{ first_name, last_name?, email?, phone?, title?, status?, company? }] }`.
Company names are resolved to existing companies or created. Rows without a first
name are skipped. Returns `{ imported, companiesCreated, skipped }`.

## Agent-mode UI

Append `?agent=true` for larger targets and always-visible action buttons.
