import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
    app: {
        deferredHeavyWork: () => ipcRenderer.invoke('app:deferredHeavyWork')
    },
    config: {
        readFiles: () => ipcRenderer.invoke('config:readFiles')
    },
    profile: {
        list: () => ipcRenderer.invoke('profile:list'),
        load: (name) => ipcRenderer.invoke('profile:load', name),
        save: (name, content) => ipcRenderer.invoke('profile:save', name, content),
        delete: (name) => ipcRenderer.invoke('profile:delete', name)
    },
    system: {
        getAppInfo: () => ipcRenderer.invoke('system:getAppInfo'),
        activateKiosk: (payload) => ipcRenderer.invoke('system:activateKiosk', payload),
        getKioskStatus: () => ipcRenderer.invoke('system:getKioskStatus'),
        openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
        showError: (payload) => ipcRenderer.invoke('dialog:showError', payload),
        showConfirm: (opts) => ipcRenderer.invoke('dialog:showConfirm', opts),
        quit: () => ipcRenderer.invoke('app:quit'),
        onQuitFromTray: (cb) => ipcRenderer.on('app:quit-from-tray', cb),
        offQuitFromTray: (cb) => ipcRenderer.removeListener('app:quit-from-tray', cb),
        isWindowObscured: () => ipcRenderer.invoke('window:isObscured'),
        showNativeNotification: (payload) => ipcRenderer.invoke('window:showNativeNotification', payload),
        beginUrgentPresent: () => ipcRenderer.invoke('window:beginUrgentPresent'),
        endUrgentPresent: () => ipcRenderer.invoke('window:endUrgentPresent'),
        showUrgentWarning: (payload) => ipcRenderer.invoke('window:showUrgentWarning', payload)
    },
    webFilter: {
        getList: () => ipcRenderer.invoke('webfilter:getList'),
        setList: (entries) => ipcRenderer.invoke('webfilter:setList', entries),
        setAllowlist: (domains) => ipcRenderer.invoke('webfilter:setAllowlist', domains),
        addCategory: (name) => ipcRenderer.invoke('webfilter:addCategory', name),
        setFeedEnabled: (feedId, enabled) => ipcRenderer.invoke('webfilter:setFeedEnabled', feedId, enabled),
        clearAll: () => ipcRenderer.invoke('webfilter:clearAll'),
        syncFeeds: () => ipcRenderer.invoke('webfilter:syncFeeds'),
        reapplyMirror: () => ipcRenderer.invoke('webfilter:reapplyMirror')
    },
    apps: {
        list: () => ipcRenderer.invoke('apps:list'),
        setBlocked: (appId, blocked) => ipcRenderer.invoke('apps:setBlocked', appId, blocked),
        getBlocked: () => ipcRenderer.invoke('apps:getBlocked')
    },
    schedules: {
        get: () => ipcRenderer.invoke('schedules:get'),
        getUsage: () => ipcRenderer.invoke('schedules:getUsage'),
        getUsageHistory: (maxDays) => ipcRenderer.invoke('schedules:getUsageHistory', maxDays),
        save: (schedule) => ipcRenderer.invoke('schedules:save', schedule),
        redeploy: () => ipcRenderer.invoke('schedules:redeploy'),
        resetTodayUsage: () => ipcRenderer.invoke('schedules:resetTodayUsage'),
        grantBonusMinutes: (payload) => ipcRenderer.invoke('schedules:grantBonusMinutes', payload)
    },
    lifeMode: {
        list: () => ipcRenderer.invoke('lifeMode:list'),
        apply: (modeKey) => ipcRenderer.invoke('lifeMode:apply', modeKey)
    },
    quota: {
        getList: () => ipcRenderer.invoke('quota:getList'),
        getUsage: () => ipcRenderer.invoke('quota:getUsage'),
        getAppMonitorUsage: () => ipcRenderer.invoke('quota:getAppMonitorUsage'),
        resetTodayUsage: () => ipcRenderer.invoke('quota:resetTodayUsage'),
        setEntry: (entry) => ipcRenderer.invoke('quota:setEntry', entry),
        removeEntry: (payload) => ipcRenderer.invoke('quota:removeEntry', typeof payload === 'string' ? { appId: payload } : payload),
        redeploy: () => ipcRenderer.invoke('quota:redeploy'),
        grantAppBonus: (payload) => ipcRenderer.invoke('quota:grantAppBonus', payload)
    },
    activity: {
        list: (limit) => ipcRenderer.invoke('activity:list', limit)
    },
    processWhitelist: {
        get: () => ipcRenderer.invoke('processWhitelist:get'),
        save: (config) => ipcRenderer.invoke('processWhitelist:save', config),
        redeploy: () => ipcRenderer.invoke('processWhitelist:redeploy')
    },
    backup: {
        export: () => ipcRenderer.invoke('backup:export'),
        import: () => ipcRenderer.invoke('backup:import')
    },
    settings: {
        isPasswordSet: () => ipcRenderer.invoke('settings:isPasswordSet'),
        checkPassword: (password) => ipcRenderer.invoke('settings:checkPassword', password),
        setPassword: (password) => ipcRenderer.invoke('settings:setPassword', password),
        changePassword: (oldPass, newPass) => ipcRenderer.invoke('settings:changePassword', oldPass, newPass),
        getConfig: () => ipcRenderer.invoke('settings:getConfig'),
        saveConfig: (cfg) => ipcRenderer.invoke('settings:saveConfig', cfg),
        setAutostart: (enabled) => ipcRenderer.invoke('settings:setAutostart', enabled),
        pruneUsageArchives: () => ipcRenderer.invoke('settings:pruneUsageArchives'),
        stopAllProtections: () => ipcRenderer.invoke('settings:stopAllProtections'),
        deleteAllUsageHistory: () => ipcRenderer.invoke('settings:deleteAllUsageHistory')
    }
})
