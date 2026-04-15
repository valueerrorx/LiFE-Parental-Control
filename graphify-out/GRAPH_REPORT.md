# Graph Report - .  (2026-04-15)

## Corpus Check
- 71 files · ~484,924 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 369 nodes · 543 edges · 91 communities detected
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 8 edges (avg confidence: 0.76)
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
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
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
1. `tickScreenTime()` - 30 edges
2. `handleClientCommand()` - 20 edges
3. `tickAppQuotas()` - 19 edges
4. `applyFromDefault()` - 15 edges
5. `localIsoDate()` - 13 edges
6. `getDefaultConfig()` - 12 edges
7. `Append Activity Log Entry` - 12 edges
8. `normalizeLinuxUser()` - 11 edges
9. `notifyOrSpawn()` - 11 edges
10. `iptSync()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `ProfilesTab Vue Component` --references--> `KDE Kiosk Restriction Module`  [INFERRED]
  src/renderer/src/components/kiosk/ProfilesTab.vue → README.md
- `Per-User Quota Storage Key Pattern` --conceptually_related_to--> `Quota Exemptions / Whitelisted Apps`  [INFERRED]
  src/shared/quotaUsageKey.js → README.md
- `runWarningMode (warningModeMain)` --calls--> `initWarningWindow (warningWindow)`  [EXTRACTED]
  src/main/warningModeMain.js → src/main/warningWindow.js
- `runWarningMode (warningModeMain)` --implements--> `Warning Mode (--warning-mode= process flag)`  [EXTRACTED]
  src/main/warningModeMain.js → src/main/index.js
- `Register Quota IPC Handler` --calls--> `Append Activity Log Entry`  [EXTRACTED]
  src/main/ipc/quotaIpc.js → src/main/ipc/activityLog.js

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
Cohesion: 0.06
Nodes (85): allowedHoursOverrideOptionHHMMs(), allowedHoursPostLogoutOverrideEndHHMM(), anyUserRunningProcess(), appendActivityDaemon(), broadcast(), broadcastWarn(), buildNotifySendEnvPairs(), buildWarningWindowEnvPairs() (+77 more)

### Community 1 - "Community 1"
Cohesion: 0.1
Nodes (40): applyDesktopOverride(), applyDnsmasq(), applyFromDefault(), buildApparmorProfile(), buildWebBlockedDomains(), chainExists(), createDefaultSync(), deleteChain() (+32 more)

### Community 2 - "Community 2"
Cohesion: 0.09
Nodes (27): Register Activity IPC Handler, Append Activity Log Entry, Read Activity Log, Register App Blocker IPC Handler, Replace Blocked Desktop IDs, Register Backup IPC Handler, Sync Embedded Enforcement If Needed, Local ISO Date (+19 more)

### Community 3 - "Community 3"
Cohesion: 0.11
Nodes (9): daemonDesktopOverride(), daemonRemoveDnsmasq(), daemonServiceControl(), daemonSyncAppArmorAsync(), daemonWriteConfigAsync(), daemonWriteDnsmasq(), daemonWriteHosts(), daemonWriteKiosk() (+1 more)

### Community 4 - "Community 4"
Cohesion: 0.15
Nodes (19): AppControlPage Vue Component, AppListItemIcon Vue Component, AppModal Vue Component, AppSidebar Vue Component, DashboardPage Vue Component, KioskPage Vue Component, LockdownWizard Vue Component, MainLayout Vue Component (+11 more)

### Community 5 - "Community 5"
Cohesion: 0.3
Nodes (11): assertAllowedUrl(), dohIpsUrl(), domainsForEnabledFeeds(), extractListVersion(), feedUrl(), getFeedsMetaForUi(), loadFeedFileText(), parseDnsmasqDomains() (+3 more)

### Community 6 - "Community 6"
Cohesion: 0.3
Nodes (8): buildCombinedEntries(), normalizeAllowlist(), persistWebfilterAndHosts(), persistWebFilterEntries(), readWebFilterConfig(), readWebfilterFromConfig(), reapplyWebFilter(), writeHostsSectionAsync()

### Community 7 - "Community 7"
Cohesion: 0.27
Nodes (11): Warning Mode (--warning-mode= process flag), Electron App Entry (index.js), Warning Mode Detection (index.js --warning-mode), makeLogoutEnforcementHtml (lockscreenWindow), runLockscreen (lockscreenWindow), runWarningMode (warningModeMain), WARNING_PANEL_CSS (warningPanelTheme), initWarningWindow (warningWindow) (+3 more)

### Community 8 - "Community 8"
Cohesion: 0.24
Nodes (4): emptyUsage(), normalizePeriod(), readSchedule(), readUsage()

### Community 9 - "Community 9"
Cohesion: 0.39
Nodes (7): atomicWriteJson(), buildFromRaw(), defaultJsonPath(), normalizeSchedule(), patchDefaultJson(), readDefaultJson(), readJsonSafe()

### Community 10 - "Community 10"
Cohesion: 0.4
Nodes (5): buildAndWriteAppCatalog(), execLineToFullPath(), execLineToProcessName(), parseDesktopFile(), readAllDesktopApps()

### Community 11 - "Community 11"
Cohesion: 0.4
Nodes (0): 

### Community 12 - "Community 12"
Cohesion: 0.5
Nodes (0): 

### Community 13 - "Community 13"
Cohesion: 0.67
Nodes (4): Quota Exemptions / Whitelisted Apps, Per-User Quota Storage Key Pattern, Quota Usage Key Shared Utility, Screen Time Usage Shared Utility

### Community 14 - "Community 14"
Cohesion: 0.67
Nodes (3): daemonOn (daemonClient), daemonRequest (daemonClient), daemonSend (daemonClient)

### Community 15 - "Community 15"
Cohesion: 0.67
Nodes (3): analyzeLockdownState (LockdownService), executeLockdown (LockdownService), log/warn/error exports (logger)

### Community 16 - "Community 16"
Cohesion: 1.0
Nodes (2): getAppImagePathIfAny(), readAppImagePathFromProcCmdline()

### Community 17 - "Community 17"
Cohesion: 0.67
Nodes (3): Read Kiosk Lockdown Summary, Read Plasma Layout Lock Active, Summarize KDE Globals Kiosk

### Community 18 - "Community 18"
Cohesion: 0.67
Nodes (3): Global t() Translation Function, Quit With Parent Confirm, Confirm Dialog (SweetAlert2)

### Community 19 - "Community 19"
Cohesion: 0.67
Nodes (3): KDE Kiosk Restriction Module, Kiosk Profile Management (load/save/delete), ProfilesTab Vue Component

### Community 20 - "Community 20"
Cohesion: 1.0
Nodes (2): getActiveGraphicalSessions (graphicalSessionDetect), parseLoginctlSession (graphicalSessionDetect)

### Community 21 - "Community 21"
Cohesion: 1.0
Nodes (2): Read All Desktop Apps, Sync AppArmor Profile

### Community 22 - "Community 22"
Cohesion: 1.0
Nodes (2): i18n Module (vue-i18n), Renderer Entry Point

### Community 23 - "Community 23"
Cohesion: 1.0
Nodes (2): Session Auto-Lock Idle Duration Settings, Lock Idle Minutes Shared Constant

### Community 24 - "Community 24"
Cohesion: 1.0
Nodes (1): initLogger (src/main/logger)

### Community 25 - "Community 25"
Cohesion: 1.0
Nodes (1): attachRendererLogging (logger)

### Community 26 - "Community 26"
Cohesion: 1.0
Nodes (1): listDesktopLoginUsers (linuxLoginUsers)

### Community 27 - "Community 27"
Cohesion: 1.0
Nodes (1): readDesktopSessionEnvForUid (desktopSessionEnviron)

### Community 28 - "Community 28"
Cohesion: 1.0
Nodes (1): isSessionGnomeShell (desktopSessionEnviron)

### Community 29 - "Community 29"
Cohesion: 1.0
Nodes (1): daemonConnect (daemonClient)

### Community 30 - "Community 30"
Cohesion: 1.0
Nodes (1): isDaemonConnected (daemonClient)

### Community 31 - "Community 31"
Cohesion: 1.0
Nodes (1): Main BrowserWindow (index.js)

### Community 32 - "Community 32"
Cohesion: 1.0
Nodes (1): registerSettingsDangerIpc (settingsDangerIpc)

### Community 33 - "Community 33"
Cohesion: 1.0
Nodes (1): desktopIconToDataUrl (desktopIconResolve)

### Community 34 - "Community 34"
Cohesion: 1.0
Nodes (1): Read Monitor Catalog Entries

### Community 35 - "Community 35"
Cohesion: 1.0
Nodes (1): Write App Monitor Usage

### Community 36 - "Community 36"
Cohesion: 1.0
Nodes (1): Normalize Quota Entry

### Community 37 - "Community 37"
Cohesion: 1.0
Nodes (1): Load Quota Exempt App IDs

### Community 38 - "Community 38"
Cohesion: 1.0
Nodes (1): Exec Line To Process Name

### Community 39 - "Community 39"
Cohesion: 1.0
Nodes (1): Register Config IPC Handler

### Community 40 - "Community 40"
Cohesion: 1.0
Nodes (1): Assert Parental Cron Install Dirs

### Community 41 - "Community 41"
Cohesion: 1.0
Nodes (1): Web Filter Static Categories

### Community 42 - "Community 42"
Cohesion: 1.0
Nodes (1): Category To HaGeZi Feed Mapping

### Community 43 - "Community 43"
Cohesion: 1.0
Nodes (1): Web Filter Quick Add Order

### Community 44 - "Community 44"
Cohesion: 1.0
Nodes (1): Is Known Web Filter Category

### Community 45 - "Community 45"
Cohesion: 1.0
Nodes (0): 

### Community 46 - "Community 46"
Cohesion: 1.0
Nodes (1): Set Locale

### Community 47 - "Community 47"
Cohesion: 1.0
Nodes (0): 

### Community 48 - "Community 48"
Cohesion: 1.0
Nodes (0): 

### Community 49 - "Community 49"
Cohesion: 1.0
Nodes (0): 

### Community 50 - "Community 50"
Cohesion: 1.0
Nodes (0): 

### Community 51 - "Community 51"
Cohesion: 1.0
Nodes (1): LiFE Parental Control README

### Community 52 - "Community 52"
Cohesion: 1.0
Nodes (1): CLAUDE Project Instructions

### Community 53 - "Community 53"
Cohesion: 1.0
Nodes (1): DNS Security via dnsmasq Documentation

### Community 54 - "Community 54"
Cohesion: 1.0
Nodes (1): HaGeZi Fake/Scam DNS Blocklist

### Community 55 - "Community 55"
Cohesion: 1.0
Nodes (1): HaGeZi NSFW DNS Blocklist

### Community 56 - "Community 56"
Cohesion: 1.0
Nodes (1): HaGeZi Pop-Up Ads DNS Blocklist

### Community 57 - "Community 57"
Cohesion: 1.0
Nodes (1): HaGeZi Social Networks DNS Blocklist

### Community 58 - "Community 58"
Cohesion: 1.0
Nodes (1): HaGeZi Gambling DNS Blocklist

### Community 59 - "Community 59"
Cohesion: 1.0
Nodes (1): HaGeZi Anti-Piracy DNS Blocklist

### Community 60 - "Community 60"
Cohesion: 1.0
Nodes (1): Screenshot: Quota Exemptions UI

### Community 61 - "Community 61"
Cohesion: 1.0
Nodes (1): Screenshot: KDE Kiosk System Settings

### Community 62 - "Community 62"
Cohesion: 1.0
Nodes (1): Screenshot: Lockdown Wizard

### Community 63 - "Community 63"
Cohesion: 1.0
Nodes (1): Screenshot: KDE Kiosk Profiles Tab

### Community 64 - "Community 64"
Cohesion: 1.0
Nodes (1): dnsmasq DNS Security Chain

### Community 65 - "Community 65"
Cohesion: 1.0
Nodes (1): DoH Canary Domain Blocking

### Community 66 - "Community 66"
Cohesion: 1.0
Nodes (1): DNS4EU Family-Safe Upstream Resolver

### Community 67 - "Community 67"
Cohesion: 1.0
Nodes (1): Lockdown Wizard First-Run Setup

### Community 68 - "Community 68"
Cohesion: 1.0
Nodes (1): HaGeZi DNS Blocklist Category System

### Community 69 - "Community 69"
Cohesion: 1.0
Nodes (1): Web Filter Module

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
- **98 isolated node(s):** `initLogger (src/main/logger)`, `attachRendererLogging (logger)`, `listDesktopLoginUsers (linuxLoginUsers)`, `getActiveGraphicalSessions (graphicalSessionDetect)`, `parseLoginctlSession (graphicalSessionDetect)` (+93 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 20`** (2 nodes): `getActiveGraphicalSessions (graphicalSessionDetect)`, `parseLoginctlSession (graphicalSessionDetect)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 21`** (2 nodes): `Read All Desktop Apps`, `Sync AppArmor Profile`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 22`** (2 nodes): `i18n Module (vue-i18n)`, `Renderer Entry Point`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 23`** (2 nodes): `Session Auto-Lock Idle Duration Settings`, `Lock Idle Minutes Shared Constant`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 24`** (1 nodes): `initLogger (src/main/logger)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (1 nodes): `attachRendererLogging (logger)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (1 nodes): `listDesktopLoginUsers (linuxLoginUsers)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (1 nodes): `readDesktopSessionEnvForUid (desktopSessionEnviron)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (1 nodes): `isSessionGnomeShell (desktopSessionEnviron)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (1 nodes): `daemonConnect (daemonClient)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (1 nodes): `isDaemonConnected (daemonClient)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (1 nodes): `Main BrowserWindow (index.js)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (1 nodes): `registerSettingsDangerIpc (settingsDangerIpc)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (1 nodes): `desktopIconToDataUrl (desktopIconResolve)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (1 nodes): `Read Monitor Catalog Entries`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (1 nodes): `Write App Monitor Usage`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (1 nodes): `Normalize Quota Entry`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (1 nodes): `Load Quota Exempt App IDs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (1 nodes): `Exec Line To Process Name`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (1 nodes): `Register Config IPC Handler`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (1 nodes): `Assert Parental Cron Install Dirs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (1 nodes): `Web Filter Static Categories`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (1 nodes): `Category To HaGeZi Feed Mapping`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (1 nodes): `Web Filter Quick Add Order`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (1 nodes): `Is Known Web Filter Category`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (1 nodes): `App.vue`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (1 nodes): `Set Locale`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (1 nodes): `appStore.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (1 nodes): `WebFilterPage.vue`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (1 nodes): `SettingsPage.vue`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (1 nodes): `index.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (1 nodes): `LiFE Parental Control README`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (1 nodes): `CLAUDE Project Instructions`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (1 nodes): `DNS Security via dnsmasq Documentation`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (1 nodes): `HaGeZi Fake/Scam DNS Blocklist`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (1 nodes): `HaGeZi NSFW DNS Blocklist`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (1 nodes): `HaGeZi Pop-Up Ads DNS Blocklist`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (1 nodes): `HaGeZi Social Networks DNS Blocklist`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 58`** (1 nodes): `HaGeZi Gambling DNS Blocklist`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (1 nodes): `HaGeZi Anti-Piracy DNS Blocklist`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (1 nodes): `Screenshot: Quota Exemptions UI`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 61`** (1 nodes): `Screenshot: KDE Kiosk System Settings`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 62`** (1 nodes): `Screenshot: Lockdown Wizard`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (1 nodes): `Screenshot: KDE Kiosk Profiles Tab`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (1 nodes): `dnsmasq DNS Security Chain`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 65`** (1 nodes): `DoH Canary Domain Blocking`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (1 nodes): `DNS4EU Family-Safe Upstream Resolver`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 67`** (1 nodes): `Lockdown Wizard First-Run Setup`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 68`** (1 nodes): `HaGeZi DNS Blocklist Category System`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 69`** (1 nodes): `Web Filter Module`
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

- **What connects `initLogger (src/main/logger)`, `attachRendererLogging (logger)`, `listDesktopLoginUsers (linuxLoginUsers)` to the rest of the system?**
  _98 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.11 - nodes in this community are weakly interconnected._