# Graph Report - LiFE-Parental-Control  (2026-04-30)

## Corpus Check
- 75 files · ~484,390 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 500 nodes · 861 edges · 59 communities detected
- Extraction: 85% EXTRACTED · 15% INFERRED · 0% AMBIGUOUS · INFERRED: 126 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 90|Community 90]]

## God Nodes (most connected - your core abstractions)
1. `tickScreenTime()` - 33 edges
2. `isDaemonConnected()` - 23 edges
3. `daemonRequest()` - 22 edges
4. `handleClientCommand()` - 22 edges
5. `tickAppQuotas()` - 21 edges
6. `localIsoDate()` - 19 edges
7. `readDefaultJson()` - 16 edges
8. `applyFromDefault()` - 15 edges
9. `notifyOrSpawn()` - 14 edges
10. `getDefaultConfig()` - 12 edges

## Surprising Connections (you probably didn't know these)
- `writeUsage()` --calls--> `localIsoDate()`  [INFERRED]
  src/main/ipc/schedulesIpc.js → daemon/parental-control-daemon.js
- `writeQuotaUsageState()` --calls--> `localIsoDate()`  [INFERRED]
  src/main/ipc/quotaIpc.js → daemon/parental-control-daemon.js
- `readAppMonitorUsage()` --calls--> `localIsoDate()`  [INFERRED]
  src/main/ipc/quotaIpc.js → daemon/parental-control-daemon.js
- `writeAppMonitorUsage()` --calls--> `localIsoDate()`  [INFERRED]
  src/main/ipc/quotaIpc.js → daemon/parental-control-daemon.js
- `listGraphicalUsers()` --calls--> `getActiveGraphicalSessions()`  [INFERRED]
  src/main/ipc/systemIpc.js → daemon/parental-control-daemon.js

## Hyperedges (group relationships)
- **Daemon Enforcement Pipeline** — daemon_tickLoop, defaultSync_applyFromDefault, defaultSync_applyDesktopOverride, defaultSync_syncAppArmor, defaultSync_applyDnsmasq, defaultSync_writeHostsBlockedDomains [INFERRED 0.85]
- **Warning Mode Display Flow** — index_warningModeDetect, warningModeMain_runWarningMode, warningWindow_showWarningWindow, lockscreenWindow_runLockscreen, warningPanelTheme_WARNING_PANEL_CSS [EXTRACTED 1.00]
- **Daemon IPC Bridge (frontend ↔ daemon)** — daemonClient_daemonConnect, daemonClient_daemonRequest, daemonClient_daemonSend, daemonClient_daemonOn, daemonPrivilegedOps_daemonWriteConfigAsync, daemonPrivilegedOps_daemonServiceControl, concept_daemonSocket [EXTRACTED 1.00]
- **default.json write chain (frontend → daemon → disk)** — defaultProfileStore_patchDefaultJson, daemonPrivilegedOps_daemonWriteConfigAsync, daemonClient_daemonRequest, concept_defaultJson [EXTRACTED 1.00]
- **IPC Registration Hub (registerHeavyIpc)** — registerHeavyIpc_registerHeavyIpc, schedulesIpc_registerSchedulesIpc, settingsIpc_registerSettingsIpc, settingsDangerIpc_registerSettingsDangerIpc [EXTRACTED 1.00]
- **IPC Handlers That Log Activity** — quotaIpc_registerQuotaIpc, appBlockerIpc_registerAppBlockerIpc, profileIpc_registerProfileIpc, systemIpc_registerSystemIpc, processWhitelistIpc_registerProcessWhitelistIpc, backupIpc_registerBackupIpc, webFilterIpc_registerWebFilterIpc, lockdownIpc_registerLockdownIpc, activityLog_appendActivity [INFERRED 0.95]
- **Quota & Usage Daily File Management** — quotaIpc_readQuotaUsageState, quotaIpc_writeQuotaUsageState, quotaIpc_readAppMonitorUsage, quotaIpc_writeAppMonitorUsage, usageArchivePrune_pruneUsageArchives, localCalendarDay_localIsoDate, localCalendarDay_localIsoDateDaysAgo [INFERRED 0.90]
- **Web Filter Subsystem (hosts + dnsmasq + HaGeZi)** — webFilterIpc_registerWebFilterIpc, webFilterIpc_persistWebFilterEntries, webFilterIpc_reapplyWebFilter, webFilterIpc_runStartupHageziSync, webFilterHagezi_syncHageziFeeds, webFilterHagezi_domainsForEnabledFeeds, webFilterCategories_CATEGORY_TO_HAGEZI_FEED, webFilterCategories_WEB_FILTER_STATIC_CATEGORIES, webFilterCategories_isKnownWebFilterCategory [INFERRED 0.92]
- **Renderer Bootstrap (Vue app setup)** — rendererMain_main, App_vue, i18n_i18n, useConfirm_confirm, parentQuit_quitWithParentConfirm [EXTRACTED 1.00]
- **Backup/Restore Orchestration** — backupIpc_registerBackupIpc, quotaIpc_readQuotaEntries, quotaIpc_replaceQuotaEntries, appBlockerIpc_replaceBlockedDesktopIds, webFilterIpc_persistWebFilterEntries, processWhitelistIpc_readProcessWhitelistConfig, processWhitelistIpc_replaceProcessWhitelistFromBackup [EXTRACTED 1.00]
- **Embedded Enforcement Redeploy on Version Change** — embeddedEnforcementSync_syncEmbeddedEnforcementIfNeeded, quotaIpc_redeployQuotaFromDisk, processWhitelistIpc_removeLegacyProcessKillCronArtifacts, activityLog_appendActivity [EXTRACTED 1.00]
- **Pages sharing appStore state** — DashboardPage_DashboardPage, SchedulesPage_SchedulesPage, WebFilterPage_WebFilterPage, AppControlPage_AppControlPage, KioskPage_KioskPage, ProcessWhitelistPage_ProcessWhitelistPage, AppSidebar_AppSidebar, MainLayout_MainLayout [EXTRACTED 1.00]
- **Pages using useUnsavedGuard pattern** — SchedulesPage_SchedulesPage, WebFilterPage_WebFilterPage, AppControlPage_AppControlPage, ProcessWhitelistPage_ProcessWhitelistPage [EXTRACTED 1.00]
- **Modal singleton pattern (useModal + AppModal)** — useModal_useModal, AppModal_AppModal, useApplicationLogModal_useApplicationLogModal, KioskPage_KioskPage [EXTRACTED 1.00]
- **Router layout/page tree** — routerIndex_router, routes_routes, MainLayout_MainLayout, DashboardPage_DashboardPage, WebFilterPage_WebFilterPage, AppControlPage_AppControlPage, SchedulesPage_SchedulesPage, ProcessWhitelistPage_ProcessWhitelistPage, KioskPage_KioskPage, SettingsPage_SettingsPage [EXTRACTED 1.00]
- **Kiosk tab sub-components** — KioskPage_KioskPage, UrlRestrictionsTab_UrlRestrictionsTab, RestrictionTab_RestrictionTab, kioskStore_useKioskStore [EXTRACTED 1.00]
- **Desktop login users consumers** — useDesktopLoginUsers_useDesktopLoginUsers, SchedulesPage_SchedulesPage, AppControlPage_AppControlPage [EXTRACTED 1.00]
- **HaGeZi DNS Blocklist Category Packs** — hagezi_fake, hagezi_nsfw, hagezi_popupads, hagezi_social, hagezi_gambling, hagezi_antipiracy [EXTRACTED 1.00]
- **Linux User Normalization Shared Pattern** — shared_quotausagekey, shared_screentimeusage [EXTRACTED 1.00]
- **Preload IPC Namespace Group (all API namespaces)** — preload_index, concept_profile_management, concept_webfilter, concept_quota_exemptions, concept_kde_kiosk, concept_session_autolock, concept_lockdown_wizard [EXTRACTED 0.95]
- **dnsmasq DNS Security Chain Components** — concept_dnsmasq_security_chain, concept_doh_canary_blocking, concept_dns4eu_upstream [EXTRACTED 1.00]
- **LiFE Parental Control Application Icon Set** — pc_png_app_logo, pc_svg_app_logo, icon_16, icon_32, icon_48, icon_64, icon_128, icon_256, icon_512, tray_24_icon [INFERRED 0.95]
- **LiFE Parental Control UI Feature Screenshots** — dashboard_screenshot, screentime_screenshot, webfilter_screenshot, appcontrol_screenshot, settings_screenshot [EXTRACTED 1.00]

## Communities

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (102): allowedHoursOverrideOptionHHMMs(), allowedHoursPostLogoutOverrideEndHHMM(), anyUserRunningProcess(), anyWhitelistedMonitorCatalogAppRunning(), appendActivityDaemon(), broadcast(), broadcastWarn(), buildAndWriteAppCatalog() (+94 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (54): readBlockedFromDisk(), readScheduleFromDisk(), registerBackupIpc(), syncEmbeddedEnforcementIfNeeded(), localIsoDate(), localIsoDateDaysAgo(), readConfig(), readProcessWhitelistConfig() (+46 more)

### Community 2 - "Community 2"
Cohesion: 0.1
Nodes (40): applyDesktopOverride(), applyDnsmasq(), applyFromDefault(), buildApparmorProfile(), buildWebBlockedDomains(), chainExists(), createDefaultSync(), deleteChain() (+32 more)

### Community 3 - "Community 3"
Cohesion: 0.09
Nodes (22): registerActivityIpc(), registerAppBlockerIpc(), registerLockdownIpc(), registerQuotaIpc(), registerSettingsDangerIpc(), buildCombinedEntries(), normalizeAllowlist(), persistWebfilterAndHosts() (+14 more)

### Community 4 - "Community 4"
Cohesion: 0.2
Nodes (27): daemonSend(), isDaemonConnected(), daemonAppendActivity(), daemonAuthChange(), daemonAuthCheck(), daemonAuthIsSet(), daemonAuthSet(), daemonClearTodayOverrides() (+19 more)

### Community 5 - "Community 5"
Cohesion: 0.19
Nodes (20): applyDesktopOverride(), buildApparmorProfile(), desktopExecResolvedPathMissing(), desktopIdStem(), desktopIdTailStem(), execLineToFullPath(), execLineToProcessName(), getAppCatalog() (+12 more)

### Community 6 - "Community 6"
Cohesion: 0.18
Nodes (12): connectToDaemon(), makeLogoutEnforcementHtml(), runLockscreen(), connectToDaemon(), runWarningMode(), escapeForInlineScriptJson(), initWarningWindow(), makeHtml() (+4 more)

### Community 7 - "Community 7"
Cohesion: 0.13
Nodes (6): activityLabel(), useApplicationLogModal(), confirm(), useModal(), t(), quitWithParentConfirm()

### Community 8 - "Community 8"
Cohesion: 0.19
Nodes (8): appendActivity(), listGraphicalUsers(), persistKioskConfigText(), readKioskLockdownSummary(), readPlasmaLayoutLockActive(), restartKdeSession(), stripLiFEKioskSections(), summarizeKdeglobalsKiosk()

### Community 9 - "Community 9"
Cohesion: 0.26
Nodes (10): analyzeLockdownState(), executeLockdown(), grubHashPassword(), run(), error(), initLogger(), log(), openStream() (+2 more)

### Community 10 - "Community 10"
Cohesion: 0.3
Nodes (11): assertAllowedUrl(), dohIpsUrl(), domainsForEnabledFeeds(), extractListVersion(), feedUrl(), getFeedsMetaForUi(), loadFeedFileText(), parseDnsmasqDomains() (+3 more)

### Community 11 - "Community 11"
Cohesion: 0.33
Nodes (5): findDesktopPidForUid(), parseEnvNullBuffer(), pickKeysFromMaps(), readDesktopSessionEnvForUid(), readRunuserEnv()

### Community 12 - "Community 12"
Cohesion: 0.39
Nodes (6): cacheKey(), desktopIconToDataUrl(), limitedThemes(), listThemeDirs(), orderedThemePathsAllRoots(), pathToIconDataUrl()

### Community 15 - "Community 15"
Cohesion: 0.83
Nodes (3): getActiveGraphicalSessions(), parseLoginctlSession(), userHasDesktopEnvironment()

### Community 16 - "Community 16"
Cohesion: 0.83
Nodes (3): ensureDirSync(), ensureGnomeDesktopAndIconsOnStart(), isFileSync()

### Community 18 - "Community 18"
Cohesion: 1.0
Nodes (2): getAppImagePathIfAny(), readAppImagePathFromProcCmdline()

### Community 19 - "Community 19"
Cohesion: 1.0
Nodes (2): listDesktopLoginUsers(), readUidMin()

### Community 49 - "Community 49"
Cohesion: 1.0
Nodes (1): LiFE Parental Control README

### Community 50 - "Community 50"
Cohesion: 1.0
Nodes (1): CLAUDE Project Instructions

### Community 51 - "Community 51"
Cohesion: 1.0
Nodes (1): DNS Security via dnsmasq Documentation

### Community 52 - "Community 52"
Cohesion: 1.0
Nodes (1): HaGeZi Fake/Scam DNS Blocklist

### Community 53 - "Community 53"
Cohesion: 1.0
Nodes (1): HaGeZi NSFW DNS Blocklist

### Community 54 - "Community 54"
Cohesion: 1.0
Nodes (1): HaGeZi Pop-Up Ads DNS Blocklist

### Community 55 - "Community 55"
Cohesion: 1.0
Nodes (1): HaGeZi Social Networks DNS Blocklist

### Community 56 - "Community 56"
Cohesion: 1.0
Nodes (1): HaGeZi Gambling DNS Blocklist

### Community 57 - "Community 57"
Cohesion: 1.0
Nodes (1): HaGeZi Anti-Piracy DNS Blocklist

### Community 58 - "Community 58"
Cohesion: 1.0
Nodes (1): Screenshot: Quota Exemptions UI

### Community 59 - "Community 59"
Cohesion: 1.0
Nodes (1): Screenshot: KDE Kiosk System Settings

### Community 60 - "Community 60"
Cohesion: 1.0
Nodes (1): Screenshot: Lockdown Wizard

### Community 61 - "Community 61"
Cohesion: 1.0
Nodes (1): Screenshot: KDE Kiosk Profiles Tab

### Community 62 - "Community 62"
Cohesion: 1.0
Nodes (1): dnsmasq DNS Security Chain

### Community 63 - "Community 63"
Cohesion: 1.0
Nodes (1): DoH Canary Domain Blocking

### Community 64 - "Community 64"
Cohesion: 1.0
Nodes (1): DNS4EU Family-Safe Upstream Resolver

### Community 65 - "Community 65"
Cohesion: 1.0
Nodes (1): Lockdown Wizard First-Run Setup

### Community 66 - "Community 66"
Cohesion: 1.0
Nodes (1): HaGeZi DNS Blocklist Category System

### Community 67 - "Community 67"
Cohesion: 1.0
Nodes (1): Web Filter Module

### Community 68 - "Community 68"
Cohesion: 1.0
Nodes (1): Quota Exemptions / Whitelisted Apps

### Community 69 - "Community 69"
Cohesion: 1.0
Nodes (1): KDE Kiosk Restriction Module

### Community 70 - "Community 70"
Cohesion: 1.0
Nodes (1): LiFE Parental Control App Logo (PNG)

### Community 71 - "Community 71"
Cohesion: 1.0
Nodes (1): LiFE Parental Control App Logo (SVG)

### Community 72 - "Community 72"
Cohesion: 1.0
Nodes (1): System Tray Icon 24px

### Community 73 - "Community 73"
Cohesion: 1.0
Nodes (1): Dashboard UI Screenshot

### Community 74 - "Community 74"
Cohesion: 1.0
Nodes (1): Bildschirmzeit (Screen Time) UI Screenshot

### Community 75 - "Community 75"
Cohesion: 1.0
Nodes (1): Einstellungen (Settings) UI Screenshot

### Community 76 - "Community 76"
Cohesion: 1.0
Nodes (1): Web-Filter UI Screenshot

### Community 77 - "Community 77"
Cohesion: 1.0
Nodes (1): App-Kontrolle (App Control) UI Screenshot

### Community 78 - "Community 78"
Cohesion: 1.0
Nodes (1): Application Icon 16x16

### Community 79 - "Community 79"
Cohesion: 1.0
Nodes (1): Application Icon 32x32

### Community 80 - "Community 80"
Cohesion: 1.0
Nodes (1): Application Icon 48x48

### Community 81 - "Community 81"
Cohesion: 1.0
Nodes (1): Application Icon 64x64

### Community 82 - "Community 82"
Cohesion: 1.0
Nodes (1): Application Icon 128x128

### Community 83 - "Community 83"
Cohesion: 1.0
Nodes (1): Application Icon 256x256

### Community 84 - "Community 84"
Cohesion: 1.0
Nodes (1): Application Icon 512x512

### Community 85 - "Community 85"
Cohesion: 1.0
Nodes (1): Shield + Child Protection Visual Concept

### Community 86 - "Community 86"
Cohesion: 1.0
Nodes (1): Dashboard Overview UI Pattern

### Community 87 - "Community 87"
Cohesion: 1.0
Nodes (1): Screen Time Control UI Pattern

### Community 88 - "Community 88"
Cohesion: 1.0
Nodes (1): Web Filter UI Pattern

### Community 89 - "Community 89"
Cohesion: 1.0
Nodes (1): App Control UI Pattern

### Community 90 - "Community 90"
Cohesion: 1.0
Nodes (1): Settings / Daemon Management UI Pattern

## Knowledge Gaps
- **42 isolated node(s):** `LiFE Parental Control README`, `CLAUDE Project Instructions`, `DNS Security via dnsmasq Documentation`, `HaGeZi Fake/Scam DNS Blocklist`, `HaGeZi NSFW DNS Blocklist` (+37 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 18`** (3 nodes): `getAppImagePathIfAny()`, `readAppImagePathFromProcCmdline()`, `appImageResolve.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 19`** (3 nodes): `listDesktopLoginUsers()`, `readUidMin()`, `linuxLoginUsers.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (1 nodes): `LiFE Parental Control README`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (1 nodes): `CLAUDE Project Instructions`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (1 nodes): `DNS Security via dnsmasq Documentation`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (1 nodes): `HaGeZi Fake/Scam DNS Blocklist`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (1 nodes): `HaGeZi NSFW DNS Blocklist`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (1 nodes): `HaGeZi Pop-Up Ads DNS Blocklist`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (1 nodes): `HaGeZi Social Networks DNS Blocklist`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (1 nodes): `HaGeZi Gambling DNS Blocklist`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (1 nodes): `HaGeZi Anti-Piracy DNS Blocklist`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 58`** (1 nodes): `Screenshot: Quota Exemptions UI`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (1 nodes): `Screenshot: KDE Kiosk System Settings`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (1 nodes): `Screenshot: Lockdown Wizard`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 61`** (1 nodes): `Screenshot: KDE Kiosk Profiles Tab`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 62`** (1 nodes): `dnsmasq DNS Security Chain`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (1 nodes): `DoH Canary Domain Blocking`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (1 nodes): `DNS4EU Family-Safe Upstream Resolver`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 65`** (1 nodes): `Lockdown Wizard First-Run Setup`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (1 nodes): `HaGeZi DNS Blocklist Category System`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 67`** (1 nodes): `Web Filter Module`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 68`** (1 nodes): `Quota Exemptions / Whitelisted Apps`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 69`** (1 nodes): `KDE Kiosk Restriction Module`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (1 nodes): `LiFE Parental Control App Logo (PNG)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 71`** (1 nodes): `LiFE Parental Control App Logo (SVG)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 72`** (1 nodes): `System Tray Icon 24px`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 73`** (1 nodes): `Dashboard UI Screenshot`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 74`** (1 nodes): `Bildschirmzeit (Screen Time) UI Screenshot`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 75`** (1 nodes): `Einstellungen (Settings) UI Screenshot`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 76`** (1 nodes): `Web-Filter UI Screenshot`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 77`** (1 nodes): `App-Kontrolle (App Control) UI Screenshot`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 78`** (1 nodes): `Application Icon 16x16`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 79`** (1 nodes): `Application Icon 32x32`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 80`** (1 nodes): `Application Icon 48x48`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 81`** (1 nodes): `Application Icon 64x64`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 82`** (1 nodes): `Application Icon 128x128`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 83`** (1 nodes): `Application Icon 256x256`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 84`** (1 nodes): `Application Icon 512x512`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 85`** (1 nodes): `Shield + Child Protection Visual Concept`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 86`** (1 nodes): `Dashboard Overview UI Pattern`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 87`** (1 nodes): `Screen Time Control UI Pattern`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 88`** (1 nodes): `Web Filter UI Pattern`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 89`** (1 nodes): `App Control UI Pattern`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 90`** (1 nodes): `Settings / Daemon Management UI Pattern`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `localIsoDate()` connect `Community 0` to `Community 1`?**
  _High betweenness centrality (0.139) - this node is a cross-community bridge._
- **Why does `registerHeavyIpc()` connect `Community 3` to `Community 1`, `Community 2`?**
  _High betweenness centrality (0.097) - this node is a cross-community bridge._
- **Why does `persistSchedule()` connect `Community 1` to `Community 4`?**
  _High betweenness centrality (0.070) - this node is a cross-community bridge._
- **Are the 22 inferred relationships involving `isDaemonConnected()` (e.g. with `daemonWriteConfigAsync()` and `daemonWriteHosts()`) actually correct?**
  _`isDaemonConnected()` has 22 INFERRED edges - model-reasoned connections that need verification._
- **Are the 21 inferred relationships involving `daemonRequest()` (e.g. with `daemonWriteConfigAsync()` and `daemonWriteHosts()`) actually correct?**
  _`daemonRequest()` has 21 INFERRED edges - model-reasoned connections that need verification._
- **What connects `LiFE Parental Control README`, `CLAUDE Project Instructions`, `DNS Security via dnsmasq Documentation` to the rest of the system?**
  _42 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._