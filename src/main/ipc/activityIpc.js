import { readActivityLog } from './activityLog.js'

export function registerActivityIpc(ipcMain, configDir) {
    ipcMain.handle('activity:list', (_, rawLimit) => {
        try {
            const limit = Math.min(200, Math.max(1, Number(rawLimit) || 40))
            return { entries: readActivityLog(configDir, limit) }
        } catch (e) {
            return { entries: [], error: e.message }
        }
    })
}
