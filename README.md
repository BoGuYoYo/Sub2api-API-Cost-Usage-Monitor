# Sub2API API Usage Monitor

A lightweight Windows and macOS desktop monitor for Sub2API-compatible relay services.

## Install

Grab a package from the [latest release](https://github.com/BoGuYoYo/Sub2api-API-Cost-Usage-Monitor/releases/latest):

| Asset | Use |
| --- | --- |
| `API-Monitor-*-x64-setup.exe` | Recommended — NSIS installer, adds Start menu entries and an uninstaller |
| `API-Monitor-*-x64.msi` | MSI package for scripted installs |
| `API-Monitor-*-portable-x64.zip` | Unzip and run `API Monitor.exe`, nothing to install |

Windows needs the WebView2 runtime, which ships with Windows 10/11.

## Features

- **English and 中文 UI** — switch with the language selector at the bottom of the sidebar; the
  choice is remembered and the first launch follows your system language
- **No login gate** — launch straight into the Dashboard
- **Multi-account**: add any number of Sub2API relay accounts (relay URL + username + password)
- **Free account switching** from the Dashboard without re-entering credentials
- **Total Usage page**:
  - **ACCOUNTS TOTAL TOKENS** card summing each enabled account's locally accumulated tokens
  - Per-account breakdowns (local totals plus what the relay reports right now)
  - 7-day token usage chart
- **Local usage history**: totals are accumulated on this machine from every relay reading, so a relay that clears or rotates its usage data can no longer erase them
- **Automatic re-login**: store the password per account and an expired session is renewed by itself (refresh token first, then the saved password)
- **Backup / restore**: export the account list and the local usage history to a JSON file, and merge it back at any time
- Automatic access token refresh with session renewal
- Today and total request and token statistics
- Recent model usage for the last seven days
- Optional desktop floating widget
- System tray hiding and restore

## Multi-account setup

1. Open the **Total Usage** page and click **Add Account**.
2. Enter a display name, the **Sub2API relay URL**, and the account's **username/email + password**.
3. Leave **Remember password** checked to let the account sign itself back in when the relay expires its session. The password is stored obfuscated in this app's local storage and is only ever sent to that account's own relay URL; clear the checkbox to keep it out of the app entirely.
4. From the **Dashboard**, use the account switcher in the top-right corner to freely switch between saved accounts.
5. Use the power button to include or exclude an account from the **Total Usage** totals.
6. Use the **shield** button on an account row to turn automatic sign-in on (it asks for the password once and verifies it) or off again (which erases the stored password).
7. Use the **key** button to sign in again by hand when a token expired and no password is stored.
8. Delete an account at any time (the remote Sub2API account is not affected, and its local history stays in place).

## Where the numbers come from

The relay is used as an **event source**, never as the source of truth for history.
On every successful sync the app compares the relay's all-time counters with the values it
saw last time and adds only the positive difference to a local total:

```text
local.total += max(0, relay.total - lastSeenRelayTotal)
```

Because the local total only ever grows:

- a relay that **clears, rotates, or resets its usage database** no longer wipes your totals;
- usage recorded while the app was closed is still picked up on the next sync (the difference is simply larger);
- a brand new account seeds its local total from the relay's all-time numbers, so usage from before the app was installed is counted too.

When the relay does report a drop, the app keeps the local total, re-bases on the new
(lower) number, and records the event: the account row shows a
**“Relay data cleared · local history kept”** chip and the page explains when it happened.
Per-day records used by the 7-day chart are merged with a monotonic maximum for the same reason.

`ACCOUNTS TOTAL TOKENS` is the sum of the local totals. Each account row also shows
`relay reports …`, i.e. the raw counters as the relay currently returns them.

## Backup and restore

The **Backup** button on the Total Usage page downloads a JSON file with the account list
(including saved sessions and obfuscated passwords) and the whole local usage history; the
same JSON is copied to the clipboard. **Restore** reads such a file back:

- accounts are merged by id, keeping the newer record and never dropping a saved password;
- local totals are merged with a per-field maximum, so restoring an older file can never
  shrink the totals you already have;
- the relay baseline follows the *newest* reading rather than the largest one, so restoring
  a file from before a relay reset does not swallow the usage that came after it.

Restoring on a fresh installation also adopts the encryption key stored in the backup, so
saved passwords keep working there. On a machine that already has its own accounts, the
existing key is kept and any password that cannot be read is reported so it can be entered again.

## Recovering history from an older install

Builds before this one overwrote their snapshot with whatever the relay reported, so a relay
wipe could destroy numbers the app had already seen. Those older values are still in the
WebView2 LevelDB write-ahead log, and `scripts/recover-from-leveldb.ps1` can dig them out:

```text
pwsh -File scripts\recover-from-leveldb.ps1 -DryRun   # report only
pwsh -File scripts\recover-from-leveldb.ps1           # write a restorable backup
```

It keeps the largest value ever observed per account as the local total, uses the newest relay
reading as the diff baseline and writes a backup JSON (default: your Downloads folder) that the
**Restore** button accepts. Close the app before running it so the log is complete.

## Development

Install dependencies, then start the Tauri development app:

```text
npm install
npm run tauri dev
```

The local history and backup logic has a runnable check suite (Node 22+):

```text
npm run verify:history
```

It asserts, among other things, that a relay wipe can never shrink the locally kept totals.
`npm run check:backup -- <file.json>` feeds a backup file through the app's own import code and
prints the totals the app would end up with. `npm run verify:i18n` checks the translation
dictionary (both languages present, matching `{placeholders}`, no unused keys).

The service address is intentionally not bundled in this repository; each account carries its own relay URL.

## Build

```text
npm run build
npm run tauri build
```

## Releasing

Bump `version` in `src-tauri/tauri.conf.json`, build, then publish the bundles
(NSIS installer, MSI and a portable zip) as a GitHub release:

```text
pwsh -File scripts\publish-release.ps1 -NotesFile release-notes.md
```

The script reads the version from the Tauri config, authenticates with the credential git
already uses for github.com, and skips assets that were uploaded before, so it is safe to
re-run.

## Local storage keys

| Key | Contents |
| --- | --- |
| `sub2api_accounts_v3` | Accounts: relay URL, username, session tokens, obfuscated password |
| `sub2api_usage_snapshots_v3` | Local accumulated totals, relay baseline, reset history, per-day usage |
| `sub2api_device_key` | Per-installation key used to obfuscate saved passwords |
| `sub2api_locale` | UI language (`en` / `zh`), written when you switch it |

Snapshots written by older versions (`sub2api_usage_snapshots_v2` / `_v1`) are migrated
automatically on first read; the older totals become the starting point of the local history.

## Passwords and privacy

Saved passwords are XOR-obfuscated with a random per-installation key plus an integrity
checksum before they are written to local storage, so a casual look at the app's data
directory does not reveal them. This is **obfuscation, not strong encryption** — the key
lives in the same store, so anyone with full access to that directory can recover the
secret. Prefer a password you do not use anywhere else, or clear **Remember password**
and sign in by hand when a session expires.
