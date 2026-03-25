import fs from 'fs'
import path from 'path'
import { appendActivity } from './activityLog.js'

export function registerProfileIpc(ipcMain, profilesDir, configDir) {
    ipcMain.handle('profile:list', () =>
        fs.readdirSync(profilesDir)
            .filter(f => f.endsWith('.profile') && f !== 'last.profile')
            .map(f => path.basename(f, '.profile'))
    )

    ipcMain.handle('profile:load', (_, name) => {
        const filePath = path.join(profilesDir, name)
        if (!fs.existsSync(filePath)) return null
        const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.includes('::'))
        return lines.map(line => {
            const sep = line.indexOf('::')
            const type = line.slice(0, sep)
            const rest = line.slice(sep + 2)
            if (type === 'url') {
                const hash = rest.lastIndexOf('##')
                if (hash === -1) return { type: 'url', key: rest, allowed: false }
                return { type: 'url', key: rest.slice(0, hash), allowed: rest.slice(hash + 2) === 'True' }
            }
            return { type, key: rest, allowed: false }
        })
    })

    ipcMain.handle('profile:save', (_, name, content) => {
        fs.writeFileSync(path.join(profilesDir, name), content, 'utf8')
        appendActivity(configDir, { action: 'profile_saved', name: String(name || '') })
    })

    ipcMain.handle('profile:delete', (_, name) => {
        const filePath = path.join(profilesDir, name)
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
        appendActivity(configDir, { action: 'profile_deleted', name: String(name || '') })
    })
}
