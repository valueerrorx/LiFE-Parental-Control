import fs from 'fs'
import path from 'path'
import { nativeImage } from 'electron'

// Resolve .desktop Icon= to data URLs; cheap path order + few themes + cache (apps:list must stay fast).

const ICON_ROOTS = ['/usr/share/icons', '/usr/local/share/icons']
const FLATPAK_ICON_ROOT = '/var/lib/flatpak/exports/share/icons/hicolor'
const SNAP_ICON_DIR = '/var/lib/snapd/desktop/icons'
const MAX_THEMES = 10
const MAX_SVG_BYTES = 512 * 1024
const MAX_STATS_PER_RESOLVE = 280

const PREFERRED_THEME_NAMES = [
    'hicolor',
    'breeze-dark',
    'breeze',
    'Adwaita',
    'Papirus-Dark',
    'Papirus',
    'gnome',
    'elementary',
    'ubuntu-mono-dark'
]

const HICOLOR_SIZES = ['scalable', '512x512', '256x256', '192x192', '128x128', '96x96', '64x64', '48x48', '32x32']
const BREEZE_CONTEXT_SIZES = ['64', '48', '32', '22', '16']
const EXTRA_CONTEXTS = ['preferences', 'categories', 'mimetypes']

let themePathsCache = null
const resolveCache = new Map()
const iconNameCache = new Map()

function listThemeDirs(iconsRoot) {
    if (!fs.existsSync(iconsRoot)) return []
    return fs.readdirSync(iconsRoot, { withFileTypes: true })
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .map(e => path.join(iconsRoot, e.name))
        .filter(p => {
            if (fs.existsSync(path.join(p, 'index.theme'))) return true
            try {
                return fs.readdirSync(p).some(s => /^\d+x\d+$/.test(s) || s === 'scalable' || s === 'symbolic')
            } catch {
                return false
            }
        })
}

function orderedThemePathsAllRoots() {
    if (themePathsCache) return themePathsCache
    const byBase = new Map()
    for (const root of ICON_ROOTS) {
        for (const p of listThemeDirs(root)) byBase.set(path.basename(p), p)
    }
    const out = []
    const seen = new Set()
    const add = (p) => {
        if (p && fs.existsSync(p) && !seen.has(p)) {
            seen.add(p)
            out.push(p)
        }
    }
    if (fs.existsSync(FLATPAK_ICON_ROOT)) add(FLATPAK_ICON_ROOT)
    for (const name of PREFERRED_THEME_NAMES) add(byBase.get(name))
    const rest = [...byBase.values()].sort((a, b) => path.basename(a).localeCompare(path.basename(b)))
    for (const p of rest) add(p)
    themePathsCache = out
    return out
}

function limitedThemes() {
    return orderedThemePathsAllRoots().slice(0, MAX_THEMES)
}

function iconStemVariants(iconBase) {
    const b = iconBase.replace(/\.(png|svg|xpm)$/i, '').trim()
    if (!b) return []
    if (b === b.toLowerCase()) return [b]
    return [b, b.toLowerCase()]
}

function *yieldThemedPaths(stem) {
    const stems = [stem, `${stem}-symbolic`]
    const themes = limitedThemes()
    for (const themePath of themes) {
        for (const s of stems) {
            yield path.join(themePath, `${s}.svg`)
            yield path.join(themePath, `${s}.png`)
        }
        for (const s of stems) {
            for (const sz of HICOLOR_SIZES) {
                const extFirst = sz === 'scalable' ? ['svg', 'png'] : ['png', 'svg']
                for (const ext of extFirst) yield path.join(themePath, sz, 'apps', `${s}.${ext}`)
            }
            for (const n of BREEZE_CONTEXT_SIZES) {
                yield path.join(themePath, 'apps', n, `${s}.png`)
                yield path.join(themePath, 'apps', n, `${s}.svg`)
            }
            yield path.join(themePath, 'apps', 'scalable', `${s}.svg`)
            yield path.join(themePath, 'apps', 'symbolic', `${s}.svg`)
            for (const ctx of EXTRA_CONTEXTS) {
                for (const n of BREEZE_CONTEXT_SIZES) {
                    yield path.join(themePath, ctx, n, `${s}.png`)
                    yield path.join(themePath, ctx, n, `${s}.svg`)
                }
                yield path.join(themePath, ctx, 'scalable', `${s}.svg`)
            }
        }
    }
}

function *yieldPixmaps(name) {
    const n = name.replace(/\.(png|svg|xpm)$/i, '')
    for (const base of ['/usr/share/pixmaps', '/usr/local/share/pixmaps']) {
        yield path.join(base, `${n}.png`)
        yield path.join(base, `${n}.svg`)
        yield path.join(base, `${n}.xpm`)
    }
}

function *yieldSnap(name) {
    if (!fs.existsSync(SNAP_ICON_DIR)) return
    let files = []
    try {
        files = fs.readdirSync(SNAP_ICON_DIR)
    } catch {
        return
    }
    for (const snapStem of iconStemVariants(name)) {
        const lower = snapStem.toLowerCase()
        for (const f of files) {
            if (!f.endsWith('.png')) continue
            const stem = f.slice(0, -4)
            if (stem === snapStem || stem.toLowerCase() === lower || stem.includes(lower) || lower.includes(stem.toLowerCase()))
                yield path.join(SNAP_ICON_DIR, f)
        }
    }
}

function *yieldCandidatesForToken(token, desktopFilePath) {
    if (!token || typeof token !== 'string') return
    const icon = token.trim()
    if (!icon) return

    if (path.isAbsolute(icon)) {
        yield icon
        return
    }

    if (icon.includes('/') && !icon.startsWith('/'))
        yield path.join(path.dirname(desktopFilePath), icon)

    if (/\.(png|svg|xpm)$/i.test(icon)) {
        yield path.join('/usr/share/pixmaps', icon)
        yield path.join('/usr/local/share/pixmaps', icon)
    }

    const name = icon.replace(/\.(png|svg|xpm)$/i, '')
    yield* yieldPixmaps(name)
    for (const stem of iconStemVariants(name)) yield* yieldThemedPaths(stem)
    yield* yieldSnap(name)
}

function pathToIconDataUrl(absPath) {
    try {
        if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) return null
        const lower = absPath.toLowerCase()
        if (lower.endsWith('.svg')) {
            const st = fs.statSync(absPath)
            if (st.size > MAX_SVG_BYTES) return null
            const buf = fs.readFileSync(absPath)
            return `data:image/svg+xml;base64,${buf.toString('base64')}`
        }
        const img = nativeImage.createFromPath(absPath)
        if (img.isEmpty()) return null
        let m = img
        const sz = img.getSize()
        if (sz.width > 64 || sz.height > 64) m = img.resize({ width: 64, height: 64, quality: 'better' })
        return m.toDataURL({ scaleFactor: 1 })
    } catch {
        return null
    }
}

function cacheKey(iconRaw, desktopFilePath, fallbackNames) {
    return [iconRaw ?? '', desktopFilePath ?? '', ...(fallbackNames || [])].join('\x1e')
}

/**
 * @param {string} iconRaw - Icon= from .desktop (may be empty).
 * @param {string} desktopFilePath - absolute path to .desktop file.
 * @param {string[]} [fallbackNames] - extra keys to try (e.g. desktop stem, process name).
 */
export function desktopIconToDataUrl(iconRaw, desktopFilePath, fallbackNames = []) {
    const key = cacheKey(iconRaw, desktopFilePath, fallbackNames)
    if (resolveCache.has(key)) return resolveCache.get(key)

    const trimmedIcon = iconRaw?.trim() ?? ''
    const shareableIconKey =
        trimmedIcon && !trimmedIcon.includes('/') && !path.isAbsolute(trimmedIcon)
            ? trimmedIcon.toLowerCase()
            : null
    if (shareableIconKey && iconNameCache.has(shareableIconKey)) {
        const hit = iconNameCache.get(shareableIconKey)
        resolveCache.set(key, hit)
        return hit
    }

    const tokens = []
    if (trimmedIcon) tokens.push(trimmedIcon)
    for (const f of fallbackNames) if (f && String(f).trim()) tokens.push(String(f).trim())

    const triedPaths = new Set()
    let stats = 0
    let result = null
    let budgetExceeded = false

    outer: for (const token of tokens) {
        for (const p of yieldCandidatesForToken(token, desktopFilePath)) {
            if (!p || triedPaths.has(p)) continue
            triedPaths.add(p)
            if (++stats > MAX_STATS_PER_RESOLVE) {
                budgetExceeded = true
                break outer
            }
            const dataUrl = pathToIconDataUrl(p)
            if (dataUrl) {
                result = dataUrl
                break outer
            }
        }
    }

    if (!budgetExceeded) {
        resolveCache.set(key, result)
        if (shareableIconKey) iconNameCache.set(shareableIconKey, result)
    }
    return result
}
