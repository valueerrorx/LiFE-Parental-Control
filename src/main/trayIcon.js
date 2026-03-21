import fs from 'fs'
import path from 'path'
import { app, nativeImage } from 'electron'

// Tray: small PNGs only. Window chrome: same first, then dashboard.png — never pc.png (large decode on main thread).
const TRAY_ONLY_PNGS = ['tray-64.png', 'tray-24.png']
const WINDOW_EXTRA_PNGS = ['dashboard.png']
const FALLBACK_TRAY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l1G8WQAAAABJRU5ErkJggg==',
    'base64'
)

function orderedPaths(imagesDir, filename) {
    const list = [path.join(imagesDir, filename)]
    if (app.isPackaged && process.resourcesPath) {
        list.push(path.join(process.resourcesPath, 'images', filename))
    }
    if (!app.isPackaged) {
        list.push(path.join(process.cwd(), 'images', filename))
    }
    return [...new Set(list)]
}

function firstExistingPath(imagesDir, filenames) {
    for (const filename of filenames) {
        for (const p of orderedPaths(imagesDir, filename)) {
            if (fs.existsSync(p)) return p
        }
    }
    return null
}

export function resolveTrayIconPath(imagesDir) {
    return firstExistingPath(imagesDir, TRAY_ONLY_PNGS)
}

export function resolveWindowIconPath(imagesDir) {
    const small = firstExistingPath(imagesDir, TRAY_ONLY_PNGS)
    if (small) return small
    return firstExistingPath(imagesDir, WINDOW_EXTRA_PNGS)
}

function normalizeTraySize(img) {
    const { width, height } = img.getSize()
    if (width <= 0 || height <= 0) return img
    const maxDim = Math.max(width, height)
    const target = 24
    if (maxDim === target) return img
    const scale = target / maxDim
    return img.resize({
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale))
    })
}

export function loadTrayNativeImage(imagesDir) {
    for (const filename of TRAY_ONLY_PNGS) {
        for (const iconPath of orderedPaths(imagesDir, filename)) {
            try {
                if (!fs.existsSync(iconPath)) continue
                const buf = fs.readFileSync(iconPath)
                let img = nativeImage.createFromBuffer(buf)
                if (img.isEmpty()) img = nativeImage.createFromPath(iconPath)
                if (img.isEmpty()) continue
                return normalizeTraySize(img)
            } catch {
                /* try next path */
            }
        }
    }
    console.warn('[LiFE Parental Control] Tray: no small PNG in images/; using embedded fallback')
    return normalizeTraySize(nativeImage.createFromBuffer(FALLBACK_TRAY_PNG))
}
