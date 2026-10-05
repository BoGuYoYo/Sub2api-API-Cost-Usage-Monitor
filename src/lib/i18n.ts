/**
 * Tiny dependency-free i18n layer.
 *
 * `t()` is typed against the dictionary below, so a missing or misspelled key
 * fails the TypeScript build instead of showing a blank label at runtime, and
 * every entry must carry both languages.
 *
 * The chosen language lives in `localStorage` and is picked from the system
 * language on first launch. Components subscribe through `useI18n()`; plain
 * modules (API/session errors) can call `t()` directly.
 */

export type Locale = "en" | "zh";

const LOCALE_STORAGE_KEY = "sub2api_locale";

const MESSAGES = {
  // ---------------------------------------------------------------- sidebar
  "nav.menu": { en: "Menu", zh: "菜单" },
  "nav.dashboard": { en: "Dashboard", zh: "概览" },
  "nav.totalUsage": { en: "Total Usage", zh: "总用量" },
  "nav.language": { en: "Language", zh: "语言" },
  "nav.languageHint": { en: "Switch language", zh: "切换语言" },

  // -------------------------------------------------------------- title bar
  "title.appName": { en: "API MONITOR", zh: "API MONITOR" },
  "title.settings": { en: "Settings", zh: "设置" },
  "title.openSettings": { en: "Open settings", zh: "打开设置" },
  "title.hide": { en: "Hide to system tray", zh: "隐藏到系统托盘" },
  "title.close": { en: "Close", zh: "关闭" },
  "title.closeWindow": { en: "Close window", zh: "关闭窗口" },

  // ---------------------------------------------------------- error boundary
  "error.title": { en: "API Monitor needs to reload", zh: "API Monitor 需要重新加载" },
  "error.fallback": {
    en: "An unexpected display error occurred.",
    zh: "界面出现了意外错误。",
  },
  "error.reload": { en: "Reload", zh: "重新加载" },

  // -------------------------------------------------------------- dashboard
  "dashboard.title": { en: "Dashboard", zh: "概览" },
  "dashboard.updatedAt": { en: "Updated {time}", zh: "更新于 {time}" },
  "dashboard.switchAccount": { en: "Switch account", zh: "切换账户" },
  "dashboard.noAccount": { en: "No account selected", zh: "未选择账户" },
  "dashboard.widget": { en: "Desktop Widget", zh: "桌面悬浮窗" },
  "dashboard.openWidget": { en: "Open desktop widget", zh: "打开桌面悬浮窗" },
  "dashboard.openWidgetFailed": {
    en: "Unable to open the desktop widget.",
    zh: "无法打开桌面悬浮窗。",
  },
  "dashboard.refresh": { en: "Refresh dashboard", zh: "刷新概览" },
  "dashboard.welcome": { en: "Welcome", zh: "欢迎" },
  "dashboard.emptyHint": {
    en: "Add a Sub2API relay account to start monitoring token usage.",
    zh: "添加一个 Sub2API 中转站账户，即可开始监控 token 用量。",
  },
  "dashboard.goToTotalUsage": { en: "Go to Total Usage", zh: "前往总用量" },
  "dashboard.todaySpend": { en: "Today's Spend", zh: "今日费用" },
  "dashboard.todayTokens": { en: "Today's Tokens", zh: "今日 Tokens" },
  "dashboard.totalTokens": { en: "Total Tokens", zh: "Tokens 总量" },
  "dashboard.todayRequests": { en: "Today's Requests", zh: "今日请求" },
  "dashboard.localHistory": {
    en: "Local history · relay reports {value}",
    zh: "本地累计 · 中转站当前上报 {value}",
  },
  "dashboard.loadFailed": {
    en: "Unable to load usage from the relay.",
    zh: "无法从中转站读取用量数据。",
  },
  "dashboard.resetNotice": {
    en: "The relay cleared its usage data on {date}. Local totals were kept and continue from there.",
    zh: "中转站在 {date} 清除了用量数据，本地累计已保留，并从这里继续增长。",
  },
  "dashboard.recentUsage": { en: "Recent Model Usage", zh: "最近模型用量" },
  "dashboard.last7Days": { en: "Last 7 days", zh: "最近 7 天" },
  "dashboard.noRecentUsage": {
    en: "No model usage in the last 7 days.",
    zh: "最近 7 天没有模型用量记录。",
  },
  "dashboard.noRecentUsageHint": {
    en: "Records will appear after your next API request.",
    zh: "发出下一次 API 请求后就会显示记录。",
  },
  "dashboard.loadingRecent": {
    en: "Loading recent model usage",
    zh: "正在加载最近模型用量",
  },
  "dashboard.unknownModel": { en: "Unknown model", zh: "未知模型" },
  "dashboard.unknownTime": { en: "Unknown time", zh: "时间未知" },

  // ------------------------------------------------------------ total usage
  "usage.title": { en: "Total Usage", zh: "总用量" },
  "usage.summary": {
    en: "Updated {time} · {accounts} account(s) · {enabled} enabled · {passwords} with automatic sign-in",
    zh: "更新于 {time} · {accounts} 个账户 · {enabled} 个已启用 · {passwords} 个已开启自动登录",
  },
  "usage.addAccount": { en: "Add Account", zh: "添加账户" },
  "usage.refresh": { en: "Refresh total usage", zh: "刷新总用量" },
  "usage.backup": { en: "Backup", zh: "备份" },
  "usage.backupTitle": {
    en: "Download a JSON backup of accounts and local usage history",
    zh: "下载包含账户与本地用量历史的 JSON 备份",
  },
  "usage.restore": { en: "Restore", zh: "恢复" },
  "usage.restoreTitle": {
    en: "Restore accounts and usage history from a backup file",
    zh: "从备份文件恢复账户与用量历史",
  },
  "usage.backupDone": {
    en: "Backup downloaded and copied to the clipboard (accounts + local usage history).",
    zh: "备份已下载并复制到剪贴板（账户 + 本地用量历史）。",
  },
  "usage.backupDoneNoClipboard": {
    en: "Backup downloaded. Clipboard copy is unavailable in this window.",
    zh: "备份已下载。当前窗口不支持复制到剪贴板。",
  },
  "usage.noDataYet": {
    en: "{count} enabled account(s) have no saved data yet.",
    zh: "{count} 个已启用账户还没有本地数据。",
  },
  "usage.offlineCount": {
    en: "{count} account(s) are offline — showing the locally saved totals.",
    zh: "{count} 个账户处于离线状态 —— 正在显示本地保存的总量。",
  },
  "usage.autoSignedIn": {
    en: "Signed in again automatically: {names}.",
    zh: "已自动重新登录：{names}。",
  },
  "usage.autoSignedInOne": {
    en: "Signed in again automatically for {name}.",
    zh: "已为 {name} 自动重新登录。",
  },
  "usage.sessionRefreshed": {
    en: "Session refreshed with the refresh token: {names}.",
    zh: "已用 refresh token 自动续期：{names}。",
  },
  "usage.resetNotice": {
    en: "The relay cleared its usage data for {list}. Local history was kept and keeps growing from the new relay numbers.",
    zh: "中转站清除了 {list} 的用量数据。本地历史已保留，并将从中转站的新数值继续增长。",
  },
  "usage.accountsTotalTokens": { en: "ACCOUNTS TOTAL TOKENS", zh: "账户 Tokens 总量" },
  "usage.accountsTotalTokensHint": {
    en: "Local accumulated history · relay reports {value} tokens",
    zh: "本地累计历史 · 中转站当前上报 {value} tokens",
  },
  "usage.totalRequests": { en: "Total Requests", zh: "总请求数" },
  "usage.totalRequestsHint": {
    en: "Local accumulated · relay reports {value}",
    zh: "本地累计 · 中转站当前上报 {value}",
  },
  "usage.totalCost": { en: "Total Cost", zh: "总费用" },
  "usage.totalCostHint": {
    en: "Local accumulated · relay reports {value}",
    zh: "本地累计 · 中转站当前上报 {value}",
  },
  "usage.activeAccounts": { en: "Active Accounts", zh: "启用中的账户" },
  "usage.activeAccountsHint": {
    en: "{accounts} configured · {offline} offline",
    zh: "共配置 {accounts} 个 · {offline} 个离线",
  },
  "usage.chartTitle": { en: "Token usage · last 7 days", zh: "Token 用量 · 最近 7 天" },
  "usage.chartTooltip": {
    en: "{date}: {value} tokens",
    zh: "{date}：{value} tokens",
  },
  "usage.accountsTitle": { en: "Accounts", zh: "账户" },
  "usage.noAccounts": { en: "No accounts configured", zh: "还没有配置账户" },
  "usage.noAccountsHint": {
    en: "Add a Sub2API relay account to start tracking its token usage",
    zh: "添加一个 Sub2API 中转站账户，开始跟踪它的 token 用量",
  },
  "usage.statusOffline": { en: "Offline (saved)", zh: "离线（显示本地）" },
  "usage.statusError": { en: "Error", zh: "错误" },
  "usage.statusEnabled": { en: "Enabled", zh: "已启用" },
  "usage.statusDisabled": { en: "Disabled", zh: "已停用" },
  "usage.badgeAutoSignIn": { en: "Auto sign-in", zh: "自动登录" },
  "usage.badgePasswordSaved": { en: "Password saved", zh: "已保存密码" },
  "usage.badgeSignedInAutomatically": {
    en: "Signed in automatically",
    zh: "已自动登录",
  },
  "usage.badgeRelayCleared": {
    en: "Relay data cleared · local history kept",
    zh: "中转站数据已清空 · 本地历史已保留",
  },
  "usage.badgePasswordUnavailable": {
    en: "Password unavailable on this device",
    zh: "本机无法读取保存的密码",
  },
  "usage.autoSignInOnTitle": {
    en: "Automatic sign-in is on (password stored on this device{lastUsed})",
    zh: "自动登录已开启（密码保存在本机{lastUsed}）",
  },
  "usage.autoSignInLastUsed": { en: ", last used {time}", zh: "，上次使用：{time}" },
  "usage.passwordSavedTitle": {
    en: "Password stored but automatic sign-in is off",
    zh: "密码已保存，但自动登录处于关闭状态",
  },
  "usage.passwordUnavailableTitle": {
    en: "A password is stored for this account, but it was saved with another installation key (for example after clearing the app data). Enter it again to re-enable automatic sign-in.",
    zh: "该账户保存过密码，但它是用另一台机器的密钥加密的（例如清空过应用数据后）。重新输入一次密码即可恢复自动登录。",
  },
  "usage.resetChipTitle": {
    en: "The relay reported lower totals on {time}. Local history was kept.",
    zh: "中转站在 {time} 上报了更低的总量，本地历史已保留。",
  },
  "usage.noSavedData": { en: "No saved data", zh: "暂无本地数据" },
  "usage.tokensValue": { en: "{value} tokens", zh: "{value} tokens" },
  "usage.requestsAndCost": {
    en: "{requests} requests · {cost}",
    zh: "{requests} 次请求 · {cost}",
  },
  "usage.relayReports": {
    en: "relay reports {tokens} tokens · {requests} requests · {cost}",
    zh: "中转站上报 {tokens} tokens · {requests} 次请求 · {cost}",
  },
  "usage.notIncluded": { en: "Not included", zh: "未纳入统计" },
  "usage.switchTo": { en: "Switch to this account", zh: "切换到此账户" },
  "usage.keyWithPassword": {
    en: "Sign in again with the saved password (or turn it off)",
    zh: "用保存的密码重新登录（或关闭）",
  },
  "usage.keyWithoutPassword": {
    en: "Sign in again (refresh an expired token)",
    zh: "重新登录（刷新过期的令牌）",
  },
  "usage.autoSignInOnClick": {
    en: "Automatic sign-in is on — click to forget the password",
    zh: "自动登录已开启 —— 点击可忘记密码",
  },
  "usage.rememberPasswordTitle": {
    en: "Remember this password so the account can sign itself back in",
    zh: "记住该密码，让账户可以自动重新登录",
  },
  "usage.disableAccount": { en: "Disable account", zh: "停用账户" },
  "usage.enableAccount": { en: "Enable account", zh: "启用账户" },
  "usage.deleteAccount": { en: "Delete account", zh: "删除账户" },
  "usage.deleteConfirm": {
    en: "Delete account \"{name}\"?\nThe remote Sub2API account is not affected. Its locally stored usage history stays in place.",
    zh: "确定删除账户“{name}”吗？\n远端 Sub2API 账户不受影响，本地保存的用量历史也会保留。",
  },
  "usage.forgetConfirm": {
    en: "Forget the saved password for \"{name}\" and turn automatic sign-in off?",
    zh: "要忘记“{name}”保存的密码并关闭自动登录吗？",
  },
  "usage.autoSignInDisabled": {
    en: "Automatic sign-in disabled for {name}.",
    zh: "已为 {name} 关闭自动登录。",
  },
  "usage.localHistoryNote": {
    en: "Totals are accumulated on this machine from every relay reading, so clearing or resetting usage data on the relay no longer erases them. Passwords saved for automatic sign-in stay in this app's local storage. Use Backup to keep a JSON copy of accounts and history outside the app.",
    zh: "总量是在本机根据每一次中转站读数累加出来的，所以中转站清空或重置数据都不会再抹掉它们。用于自动登录的密码保存在本应用的本地存储中。建议用“备份”把账户和历史导出成 JSON 保存在应用之外。",
  },
  "usage.restoreSummary": {
    en: "Restored {added} new account(s) · {updated} merged · {snapshots} usage snapshot(s) merged",
    zh: "已恢复 {added} 个新账户 · 合并 {updated} 个 · 合并 {snapshots} 份用量快照",
  },
  "usage.restorePasswords": {
    en: "{count} saved password(s) usable",
    zh: "{count} 个保存的密码可用",
  },
  "usage.restorePasswordsUnavailable": {
    en: "{count} saved password(s) need to be entered again on this device",
    zh: "{count} 个保存的密码需要在本机重新输入",
  },
  "usage.switchFailed": { en: "Unable to switch account.", zh: "无法切换账户。" },
  "usage.settingFailed": { en: "Unable to change the setting.", zh: "无法修改该设置。" },
  "usage.backupFailed": { en: "Unable to create a backup.", zh: "无法创建备份。" },
  "usage.restoreFailed": { en: "Unable to restore that backup.", zh: "无法恢复该备份。" },
  "usage.addFailed": { en: "Unable to add this account.", zh: "无法添加该账户。" },
  "usage.reloginFailed": { en: "Unable to sign in again.", zh: "无法重新登录。" },
  "usage.closeDialog": { en: "Close", zh: "关闭" },
  "usage.closeAddDialog": { en: "Close add account dialog", zh: "关闭添加账户对话框" },
  "usage.closeReloginDialog": { en: "Close re-login dialog", zh: "关闭重新登录对话框" },
  "usage.cancel": { en: "Cancel", zh: "取消" },
  "usage.signingIn": { en: "Signing in...", zh: "正在登录…" },

  // -------------------------------------------------------- add account form
  "add.title": { en: "Add Sub2API Account", zh: "添加 Sub2API 账户" },
  "add.description": {
    en: "Enter the relay URL and the account credentials to track its token usage.",
    zh: "填写中转站地址和账户凭据，即可跟踪它的 token 用量。",
  },
  "add.displayName": { en: "Display Name", zh: "显示名称" },
  "add.displayNamePlaceholder": { en: "My primary relay", zh: "我的主力中转站" },
  "add.relayUrl": { en: "Sub2API Relay URL", zh: "Sub2API 中转站地址" },
  "add.relayUrlHint": {
    en: "The site URL or its /api/v1 endpoint. Each account can use a different relay.",
    zh: "填站点地址或它的 /api/v1 接口地址。每个账户可以使用不同的中转站。",
  },
  "add.username": { en: "Sub2API Username / Email", zh: "Sub2API 用户名 / 邮箱" },
  "add.password": { en: "Password", zh: "密码" },
  "add.passwordHint": {
    en: "Used to sign in. With “Remember password”, it is stored obfuscated on this machine only, so an expired session can be renewed automatically.",
    zh: "用于登录。勾选“记住密码”后，密码会经过混淆只保存在本机，会话过期时可以自动续期。",
  },
  "add.rememberPassword": {
    en: "Remember password and sign in automatically when the session expires",
    zh: "记住密码，会话过期时自动登录",
  },
  "add.includeInTotals": {
    en: "Include this account in total usage",
    zh: "将此账户计入总用量",
  },
  "add.submit": { en: "Sign In & Add", zh: "登录并添加" },

  // ------------------------------------------------------------ relogin form
  "relogin.titleEnable": { en: "Enable automatic sign-in", zh: "开启自动登录" },
  "relogin.titleSignIn": { en: "Sign in again", zh: "重新登录" },
  "relogin.enableDescription": {
    en: "Confirm the password for {name} ({username}). It is stored obfuscated on this machine and used to renew the session whenever it expires.",
    zh: "请确认 {name}（{username}）的密码。密码会经过混淆保存在本机，用于在会话过期时自动续期。",
  },
  "relogin.signInDescription": {
    en: "Token expired for {name} ({username}). Re-enter the password to refresh the session.",
    zh: "{name}（{username}）的令牌已过期。请重新输入密码以刷新会话。",
  },
  "relogin.remember": {
    en: "Remember the password so this account signs itself in next time",
    zh: "记住密码，下次让该账户自动登录",
  },
  "relogin.submitEnable": { en: "Save & Sign In", zh: "保存并登录" },
  "relogin.submitSignIn": { en: "Sign In", zh: "登录" },
  "relogin.emptyPassword": { en: "Enter the account password.", zh: "请输入账户密码。" },

  // ----------------------------------------------------------- floating widget
  "widget.snapshot": { en: "Today's snapshot", zh: "今日快照" },
  "widget.spend": { en: "Spend", zh: "费用" },
  "widget.tokens": { en: "Tokens", zh: "Tokens" },
  "widget.alwaysOnTop": { en: "Always on top", zh: "始终置顶" },
  "widget.desktopOnly": { en: "Desktop only", zh: "仅桌面显示" },
  "widget.enableAlwaysOnTop": { en: "Enable always on top", zh: "开启始终置顶" },
  "widget.disableAlwaysOnTop": { en: "Disable always on top", zh: "关闭始终置顶" },

  // --------------------------------------------------------- session / api errors
  "error.accountNoLongerExists": { en: "Account no longer exists.", zh: "该账户已不存在。" },
  "error.noSavedSession": {
    en: "This account has no saved session.",
    zh: "该账户没有已保存的会话。",
  },
  "error.sessionUpdateFailed": {
    en: "Unable to update the account session.",
    zh: "无法更新该账户的会话。",
  },
  "error.secretStoreFailed": {
    en: "Unable to store the password on this device.",
    zh: "无法在本机保存该密码。",
  },
  "error.passwordRequiredForAuto": {
    en: "Enter the account password to enable automatic sign-in.",
    zh: "请输入账户密码以开启自动登录。",
  },
  "error.enterAccountName": { en: "Enter an account name.", zh: "请输入显示名称。" },
  "error.enterUsername": {
    en: "Enter the Sub2API username or email.",
    zh: "请输入 Sub2API 用户名或邮箱。",
  },
  "error.enterPassword": { en: "Enter the account password.", zh: "请输入账户密码。" },
  "error.noSavedPassword": {
    en: "No saved password for {name}; sign in again manually.",
    zh: "{name} 没有保存的密码，请手动重新登录。",
  },
  "error.autoSignInFailed": {
    en: "Automatic sign-in failed for {name}. Check the relay URL, the username/password, or sign in again manually.",
    zh: "{name} 自动登录失败。请检查中转站地址、用户名/密码，或手动重新登录。",
  },
  "error.sessionExpiredHelp": {
    en: "Session expired for {name}. Open the key icon on its row and sign in again, or turn on \"Remember password\" to let it sign in automatically next time.",
    zh: "{name} 的会话已过期。点击它那一行的钥匙图标重新登录，或开启“记住密码”让下次自动登录。",
  },
  "error.enterSiteUrl": { en: "Enter a Sub2API website URL.", zh: "请输入 Sub2API 站点地址。" },
  "error.onlyHttp": {
    en: "Only HTTP and HTTPS URLs are supported.",
    zh: "仅支持 HTTP 和 HTTPS 地址。",
  },
  "error.invalidUrl": { en: "Invalid URL.", zh: "地址无效。" },
  "error.connectFailed": {
    en: "Unable to connect to the server ({reason})",
    zh: "无法连接到服务器（{reason}）",
  },
  "error.serverRequestFailed": {
    en: "Server request failed (HTTP {status})",
    zh: "请求失败（HTTP {status}）",
  },
  "error.serverReturnedError": {
    en: "The server returned an error.",
    zh: "服务器返回了一个错误。",
  },
  "error.sessionExpired": {
    en: "Session expired. Please log in again.",
    zh: "会话已过期，请重新登录。",
  },
  "error.noCompatibleEndpoint": {
    en: "No compatible server endpoint was found.",
    zh: "没有找到兼容的服务器接口。",
  },
  "error.loginNoToken": {
    en: "Login response did not include access_token.",
    zh: "登录响应中没有 access_token。",
  },
  "error.refreshNoToken": {
    en: "Refresh response did not include access_token.",
    zh: "刷新响应中没有 access_token。",
  },
  "error.sessionChangedWhileRefreshing": {
    en: "Session changed while refreshing.",
    zh: "刷新过程中会话已变更。",
  },
  "error.respondedWith": {
    en: "{url} responded with HTTP {status}.",
    zh: "{url} 返回 HTTP {status}。",
  },
  "error.authenticatedOk": {
    en: "{url} authenticated successfully.",
    zh: "{url} 认证成功。",
  },
  "backup.invalidJson": { en: "That is not valid JSON.", zh: "这不是有效的 JSON。" },
  "backup.notABackup": {
    en: "That file does not contain a backup.",
    zh: "该文件不包含备份数据。",
  },
  "backup.empty": {
    en: "That backup has no accounts or usage data.",
    zh: "该备份里没有账户或用量数据。",
  },
} as const;

export type MessageKey = keyof typeof MESSAGES;

/**
 * Read-only view of the dictionary for tooling (`npm run verify:i18n`);
 * the app itself goes through `t()`.
 */
export function getDictionary(): Readonly<
  Record<MessageKey, { readonly en: string; readonly zh: string }>
> {
  return MESSAGES;
}

const listeners = new Set<() => void>();

function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === "en" || stored === "zh") return stored;
  } catch {
    // Storage unavailable: fall back to the system language.
  }
  const languages =
    typeof navigator !== "undefined" && Array.isArray(navigator.languages)
      ? navigator.languages
      : typeof navigator !== "undefined" && navigator.language
        ? [navigator.language]
        : [];
  for (const language of languages) {
    const normalized = String(language).toLowerCase();
    if (normalized.startsWith("zh")) return "zh";
    if (normalized.startsWith("en")) return "en";
  }
  return "en";
}

let currentLocale: Locale = detectLocale();

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  if (locale === currentLocale) return;
  currentLocale = locale;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Keep the in-memory choice even when storage is unavailable.
  }
  for (const listener of listeners) listener();
}

export function subscribeToLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const LOCALES: ReadonlyArray<{ id: Locale; label: string }> = [
  { id: "en", label: "English" },
  { id: "zh", label: "中文" },
];

/** Translate a key, replacing `{placeholder}` tokens with the given values. */
export function t(
  key: MessageKey,
  params?: Record<string, string | number>
): string {
  const entry = MESSAGES[key] as { en: string; zh: string };
  let text = entry[currentLocale] ?? entry.en;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}
