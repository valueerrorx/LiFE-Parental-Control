/* SPDX-License-Identifier: GPL-3.0-or-later; Copyright (c) 2026 Thomas Michael Weissel; Licensed under GPLv3+ (see http://www.gnu.org/licenses/). */
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

// Resolve window icon for BrowserWindow + overlays (tray support removed: no system tray anymore).
const WINDOW_ICON_CANDIDATES = ['tray-64.png', 'tray-24.png', 'dashboard.png']

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

export function resolveWindowIconPath(imagesDir) {
    return firstExistingPath(imagesDir, WINDOW_ICON_CANDIDATES)
}

