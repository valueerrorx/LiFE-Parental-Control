#!/usr/bin/env node
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const REPO_OWNER = 'valueerrorx'
const REPO_NAME = 'LiFE-Parental-Control'
const ZSYNC_PATTERN = 'LiFE_Parental_Control-*.AppImage.zsync'
const UPDATE_INFO = `gh-releases-zsync|${REPO_OWNER}|${REPO_NAME}|latest|${ZSYNC_PATTERN}`
const UPD_INFO_SIZE = 256

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(rootDir, 'dist')
const version = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')).version

function updInfoOffset(appImagePath) {
    const out = execFileSync('readelf', ['-S', appImagePath], { encoding: 'utf8' })
    const match = out.match(/\.upd_info\s+\S+\s+\S+\s+([0-9a-f]+)/i)
    if (!match) throw new Error(`no .upd_info section in ${appImagePath}`)
    return parseInt(match[1], 16)
}

function embedUpdateInfo(appImagePath) {
    const offset = updInfoOffset(appImagePath)
    const info = Buffer.from(`${UPDATE_INFO}\0`, 'utf8')
    if (info.length > UPD_INFO_SIZE) throw new Error('update info too long for .upd_info section')

    const fd = fs.openSync(appImagePath, 'r+')
    try {
        const current = Buffer.alloc(UPD_INFO_SIZE)
        fs.readSync(fd, current, 0, UPD_INFO_SIZE, offset)
        const empty = current.every((b) => b === 0)
        const same = current.subarray(0, info.length).equals(info)
            && current.subarray(info.length).every((b) => b === 0)
        if (!empty && !same) throw new Error(`.upd_info already contains foreign data in ${appImagePath}`)
        fs.writeSync(fd, info, 0, info.length, offset)
        if (info.length < UPD_INFO_SIZE) {
            fs.writeSync(fd, Buffer.alloc(UPD_INFO_SIZE - info.length), 0, UPD_INFO_SIZE - info.length, offset + info.length)
        }
    } finally {
        fs.closeSync(fd)
    }
}

function findZsyncMake() {
    for (const cmd of ['zsyncmake', 'zsyncmake2']) {
        try {
            execFileSync(cmd, ['--version'], { stdio: 'ignore' })
            return cmd
        } catch {
            // try next
        }
    }
    return null
}

function makeZsync(appImagePath, zsyncMake) {
    const fileName = path.basename(appImagePath)
    const url = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/v${version}/${fileName}`
    const zsyncPath = `${appImagePath}.zsync`
    execFileSync(zsyncMake, ['-u', url, fileName], { cwd: distDir, stdio: 'pipe' })
    if (!fs.existsSync(zsyncPath)) throw new Error(`zsync file not created: ${zsyncPath}`)
}

const appImages = fs.existsSync(distDir)
    ? fs.readdirSync(distDir).filter((name) => name.endsWith('.AppImage'))
    : []

if (appImages.length === 0) {
    console.log('[embed-appimage-update-info] no AppImage in dist/, skipping')
    process.exit(0)
}

const zsyncMake = findZsyncMake()
if (!zsyncMake && process.env.CI) throw new Error('zsyncmake not found (required in CI)')

for (const name of appImages) {
    const appImagePath = path.join(distDir, name)
    embedUpdateInfo(appImagePath)
    console.log(`[embed-appimage-update-info] embedded update info in ${name}`)
    if (zsyncMake) {
        makeZsync(appImagePath, zsyncMake)
        console.log(`[embed-appimage-update-info] created ${name}.zsync`)
    } else {
        console.warn(`[embed-appimage-update-info] zsyncmake missing, skipped ${name}.zsync`)
    }
}
