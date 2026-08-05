# Feature: Check-in Bot

## Requirements

While the Bilibili listener is running, when a viewer sends exactly `签到`, the system shall record that viewer by `uid` in a dedicated check-in database.
While the check-in bot is enabled, when a viewer checks in for the first time on the current China date, the system shall reply to that viewer with the accumulated signed-in day count and one blessing.
While the check-in bot is enabled, when the same `uid` checks in again on the same China date, the system shall reply that they have already checked in today and include one blessing.

## Architecture

- Frontend: add a second switch beside the existing random-song auto-reply switch, both sharing the row width evenly.
- Backend: add `checkin-data.db`, a `checkin_users` table, `checkin-store`, `checkin-blessings`, and a `checkin-service` that exposes one danmaku-facing method.
- Security: keep settings writes behind the existing `/api/settings` whitelist and session token; clean input before persistence; use parameterized SQLite statements.

## Implementation Plan

- Add `enableCheckinBot` to the settings defaults.
- Add a dedicated check-in database and schema.
- Add store/service modules with tests for first check-in, repeat check-in, next-day count increment, and disabled setting.
- Wire check-in results into the Bilibili message callback and send replies through the existing danmaku sender.
- Update admin UI and CSS so the two switches split the row width.
