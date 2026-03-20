// Minimal Electron main as desktop user: StatusNotifier talks to the real session D-Bus from here.
import { app, Tray, Menu } from 'electron'
import fs from 'fs'
import net from 'net'
import path from 'path'

const iconPath = process.env.LIFE_TRAY_ICON_PATH
const port = Number(process.env.LIFE_TRAY_PORT)
const token = process.env.LIFE_TRAY_TOKEN || ''

function send(cmd) {
    const c = net.createConnection({ port, host: '127.0.0.1' }, () => {
        c.write(token + ':' + cmd + '\n')
        c.end()
    })
    c.on('error', () => { /* root parent may have exited */ })
}

app.whenReady().then(() => {
    app.setPath('userData', path.join(app.getPath('temp'), `life-parental-tray-${process.getuid()}`))
    if (!iconPath || !fs.existsSync(iconPath) || !Number.isFinite(port)) {
        console.error('[LiFE tray helper] invalid LIFE_TRAY_ICON_PATH / LIFE_TRAY_PORT')
        app.quit()
        return
    }
    const tray = new Tray(iconPath)
    tray.setToolTip('LiFE Parental Control')
    tray.on('click', () => send('show'))
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Show window', click: () => send('show') },
        { type: 'separator' },
        { label: 'Quit…', click: () => send('quit') }
    ]))
})
