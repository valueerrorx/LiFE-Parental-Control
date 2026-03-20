import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
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
        activateKiosk: (configText) => ipcRenderer.invoke('system:activateKiosk', configText),
        getKioskStatus: () => ipcRenderer.invoke('system:getKioskStatus'),
        openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
        quit: () => ipcRenderer.invoke('app:quit')
    },
    webFilter: {
        getList: () => ipcRenderer.invoke('webfilter:getList'),
        setList: (entries) => ipcRenderer.invoke('webfilter:setList', entries),
        addCategory: (name) => ipcRenderer.invoke('webfilter:addCategory', name),
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
        redeploy: () => ipcRenderer.invoke('schedules:redeploy')
    },
    lifeMode: {
        list: () => ipcRenderer.invoke('lifeMode:list'),
        apply: (modeKey) => ipcRenderer.invoke('lifeMode:apply', modeKey)
    },
    quota: {
        getList: () => ipcRenderer.invoke('quota:getList'),
        getUsage: () => ipcRenderer.invoke('quota:getUsage'),
        setEntry: (entry) => ipcRenderer.invoke('quota:setEntry', entry),
        removeEntry: (appId) => ipcRenderer.invoke('quota:removeEntry', appId),
        redeploy: () => ipcRenderer.invoke('quota:redeploy')
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
        pruneUsageArchives: () => ipcRenderer.invoke('settings:pruneUsageArchives')
    }
})
