import fs from 'fs'
import path from 'path'

/** argv[0] is often the binary inside /tmp/.mount_* — scan full cmdline for the real *.AppImage path. */
function readAppImagePathFromProcCmdline() {
    if (process.platform !== 'linux') return ''
    try {
        const buf = fs.readFileSync('/proc/self/cmdline')
        let i = 0
        while (i < buf.length) {
            let j = buf.indexOf(0, i)
            if (j === -1) j = buf.length
            if (j > i) {
                const p = buf.subarray(i, j).toString('utf8')
                if (/\.AppImage$/i.test(p)) {
                    const full = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p)
                    if (fs.existsSync(full)) return full
                }
            }
            i = j + 1
        }
    } catch {
        /* ignore */
    }
    return ''
}

/** Real .AppImage path when running from AppImage (env, argv, or unset). */
export function getAppImagePathIfAny() {
    if (process.env.APPIMAGE) {
        try {
            if (fs.existsSync(process.env.APPIMAGE)) return process.env.APPIMAGE
        } catch {
            /* ignore */
        }
    }
    const a0 = process.argv[0]
    if (a0 && /\.AppImage$/i.test(a0)) {
        const full = path.isAbsolute(a0) ? a0 : path.resolve(process.cwd(), a0)
        try {
            if (fs.existsSync(full)) return full
        } catch {
            /* ignore */
        }
    }
    const fromProc = readAppImagePathFromProcCmdline()
    if (fromProc) return fromProc
    return ''
}

/** Prefer on-disk AppImage path; execPath under /tmp/.mount_* is wrong for pkexec/spawn. */
export function resolveElevatedExecutablePath() {
    const ap = getAppImagePathIfAny()
    if (ap) return ap
    const a0 = process.argv[0]
    if (a0 && /\.AppImage$/i.test(a0)) {
        const full = path.isAbsolute(a0) ? a0 : path.resolve(process.cwd(), a0)
        try {
            if (fs.existsSync(full)) return full
        } catch {
            /* ignore */
        }
    }
    return process.execPath
}
