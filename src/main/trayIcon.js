import fs from 'fs'
import path from 'path'
import { app, nativeImage } from 'electron'

// Match working Electron trays: `new Tray(absolutePathToSmallPng)`; see images/tray-24.png (regenerate from pc.png if branding changes).
const TRAY_PNG = 'tray-64.png'
const WINDOW_ICON_PNG = 'pc.png'
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

export function resolveTrayIconPath(imagesDir) {
    for (const filename of [TRAY_PNG, WINDOW_ICON_PNG]) {
        for (const p of orderedPaths(imagesDir, filename)) {
            if (fs.existsSync(p)) return p
        }
    }
    return null
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
    for (const filename of [TRAY_PNG, WINDOW_ICON_PNG]) {
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
    console.warn('[LiFE Parental Control] Tray: no PNG in images/; using embedded fallback')
    return normalizeTraySize(nativeImage.createFromBuffer(FALLBACK_TRAY_PNG))
}
