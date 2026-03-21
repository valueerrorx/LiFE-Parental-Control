import fs from 'fs'
import path from 'path'

function parseIni(content) {
    const sections = {}
    let current = null
    for (const rawLine of content.split('\n')) {
        const line = rawLine.trim()
        if (!line || line[0] === ';' || line[0] === '#') continue
        if (line[0] === '[' && line.at(-1) === ']') {
            current = line.slice(1, -1).trim()
            sections[current] = {}
        } else if (current) {
            const eq = line.indexOf('=')
            if (eq > 0) sections[current][line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
        }
    }
    return sections
}

export function registerConfigIpc(ipcMain, kioskDir) {
    ipcMain.handle('config:readFiles', () => {
        const files = fs.readdirSync(kioskDir).filter(f => f.endsWith('.kiosk')).sort()
        return files.map(filename => {
            const parsed = parseIni(fs.readFileSync(path.join(kioskDir, filename), 'utf8'))
            const group = parsed.Group ?? {}
            const stripHtml = (str) => (str ?? '').replace(/<[^>]*>/g, '')
            const sections = Object.entries(parsed)
                .filter(([name, s]) => name !== 'Group' && (s.Type === 'actionrestriction' || s.Type === 'module' || s.Type === 'resource' || s.Type === 'plasmaLayoutLock'))
                .map(([, s]) => ({ type: s.Type, key: s.Key, name: s.Name, description: stripHtml(s.Description) }))
            return {
                filename,
                groupName: group.Name ?? filename.replace('.kiosk', ''),
                groupIcon: group.Icon ?? 'kdeapp',
                groupDescription: group.Description ?? '',
                sections
            }
        })
    })
}
