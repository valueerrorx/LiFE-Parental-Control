import fs from 'fs'
import path from 'path'
import { app } from 'electron'

const DESKTOP_BASENAME = 'life-parental-control.desktop'
const DESKTOP_FILENAME = DESKTOP_BASENAME
const ICON_BASENAME = 'life-parental-control.png'
const ICON_THEME_NAME = 'life-parental-control'
const ICON_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024]

function ensureDirSync(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true })
}

function isFileSync(filePath) {
    try {
        return fs.existsSync(filePath)
    } catch {
        return false
    }
}

export function ensureGnomeDesktopAndIconsOnStart({ imagesDir, appImagePath }) {
    if (!process.env.APPIMAGE) return
    if (!appImagePath) return
    if (!imagesDir) return

    const mountRoot = path.join(imagesDir, '..', '..')
    const homeDir = app.getPath('home')

    const desktopDir = path.join(homeDir, '.local', 'share', 'applications')
    const desktopDestPath = path.join(desktopDir, DESKTOP_FILENAME)

    const hasAtLeastOneIconSize =
        ICON_SIZES.some(s => isFileSync(path.join(homeDir, '.local', 'share', 'icons', 'hicolor', `${s}x${s}`, 'apps', ICON_BASENAME)))

    const desktopExists = isFileSync(desktopDestPath)
    if (desktopExists && hasAtLeastOneIconSize) return

    ensureDirSync(desktopDir)

    const desktopContent =
        `[Desktop Entry]\n` +
        `Name=LiFE Parental Control\n` +
        `Exec=${JSON.stringify(appImagePath)} --no-sandbox %U\n` +
        `Terminal=false\n` +
        `Type=Application\n` +
        `Icon=${ICON_THEME_NAME}\n` +
        `StartupWMClass=${ICON_THEME_NAME}\n` +
        `X-GNOME-WMClass=${ICON_THEME_NAME}\n` +
        `Categories=System;\n`

    fs.writeFileSync(desktopDestPath, desktopContent, { encoding: 'utf8', mode: 0o644 })

    for (const size of ICON_SIZES) {
        const srcIconPath = path.join(mountRoot, 'usr', 'share', 'icons', 'hicolor', `${size}x${size}`, 'apps', ICON_BASENAME)
        const destIconDir = path.join(homeDir, '.local', 'share', 'icons', 'hicolor', `${size}x${size}`, 'apps')
        const destIconPath = path.join(destIconDir, ICON_BASENAME)
        if (!fs.existsSync(srcIconPath)) continue
        ensureDirSync(destIconDir)
        fs.copyFileSync(srcIconPath, destIconPath)
    }

    console.error('[LiFE] GNOME integration installed:', { desktopDestPath })
}

