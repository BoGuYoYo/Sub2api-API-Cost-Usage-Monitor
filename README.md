# Sub2API API Usage Monitor

A lightweight Windows and macOS desktop monitor for Sub2API-compatible relay services.

## Features

- **No login gate** — launch straight into the Dashboard
- **Multi-account**: add any number of Sub2API relay accounts (relay URL + username + password)
- **Free account switching** from the Dashboard without re-entering credentials
- **Total Usage page**:
  - **ACCOUNTS TOTAL TOKENS** card summing each enabled account's server-side `total_tokens` (the same all-time Total Tokens shown on each account's Dashboard)
  - Per-account breakdowns (all-time tokens, requests, cost)
  - 7-day token usage chart
- **Offline usage history**: each account's usage is saved locally, so totals survive relay outages
- **Re-login on expiry**: sign back in with the password when a token expires, without re-adding the account
- Automatic access token refresh with session renewal
- Today and total request and token statistics
- Recent model usage for the last seven days
- Optional desktop floating widget
- System tray hiding and restore

## Multi-account setup

1. Open the **Total Usage** page and click **Add Account**.
2. Enter a display name, the **Sub2API relay URL**, and the account's **username/email + password**.
3. The password is used only once to sign in and is never stored. The account's session token is saved so you can switch back later without signing in again.
4. From the **Dashboard**, use the account switcher in the top-right corner to freely switch between saved accounts.
5. Use the power button to include or exclude an account from the **Total Usage** totals.
6. When an account's token expires, press the **key** icon on its row in Total Usage and re-enter the password to refresh the session.
7. Delete an account at any time (the remote Sub2API account is not affected).

The **Total Usage** page shows **ACCOUNTS TOTAL TOKENS** — the sum of each enabled account's all-time total tokens as reported by the relay (`/usage/dashboard/stats`), matching the Total Tokens number on each account's own Dashboard. Totals are persisted locally on every successful sync; when a relay is unreachable, the last saved numbers are still shown and the account is flagged as offline. The 7-day chart below reflects recent usage records.

Account sessions and usage history are stored locally (`sub2api_accounts_v3` / `sub2api_usage_snapshots_v1`); credentials never leave the app and are not part of the source tree.

## Development

Install dependencies, then start the Tauri development app:

```text
npm install
npm run tauri dev
```

The service address is intentionally not bundled in this repository; each account carries its own relay URL.

## Build

```text
npm run build
npm run tauri build
```
