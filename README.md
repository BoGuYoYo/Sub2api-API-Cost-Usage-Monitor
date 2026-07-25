# Sub2API API Cost Usage Monitor

A lightweight Windows and macOS desktop monitor for Sub2API-compatible services.
<img width="1120" height="601" alt="image" src="https://github.com/user-attachments/assets/6cf91dd7-24d5-454e-9771-ae837dee64a9" />



## Features

- Login and token persistence in the local app storage
- Today and total request and token statistics
- Recent model usage for the last seven days
- Optional desktop floating widget
- System tray hiding and restore
- Configurable service address from the Settings panel

## Development

Install dependencies, then start the Tauri development app:

```text
npm install
npm run tauri dev
```

The service address is intentionally not bundled in this repository. Enter the address of your compatible service in the Settings panel before signing in. Credentials and access tokens stay in the local app storage and are not part of the source tree.

## Build

```text
npm run build
npm run tauri build
```
