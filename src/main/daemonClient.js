// Electron-side client for the parental-control root daemon Unix socket
import net from 'net'

const SOCKET_PATH = '/run/parental-control.sock'
const RECONNECT_DELAY_MS = 5_000

let socket = null
let buf = ''
let reconnectTimer = null
const listeners = new Map() // event type → [callback, ...]

function emitEvent(type, data) {
    const cbs = listeners.get(type) || []
    for (const cb of cbs) { try { cb(data); } catch { /* ignore handler errors */ } }
    // Wildcard listeners receive every message
    const wildCbs = listeners.get('*') || []
    for (const cb of wildCbs) { try { cb(data); } catch { /* ignore */ } }
}

function onRawLine(line) {
    if (!line) return
    try {
        const msg = JSON.parse(line)
        if (msg && typeof msg.type === 'string') emitEvent(msg.type, msg)
    } catch { /* ignore malformed JSON from daemon */ }
}

function scheduleReconnect() {
    if (reconnectTimer) return
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        connect()
    }, RECONNECT_DELAY_MS)
}

function connect() {
    if (socket) return
    const s = net.createConnection(SOCKET_PATH)

    s.on('connect', () => {
        socket = s
        buf = ''
        emitEvent('connect', {})
    })

    s.on('data', (chunk) => {
        buf += chunk.toString()
        let nl
        while ((nl = buf.indexOf('\n')) !== -1) {
            onRawLine(buf.slice(0, nl).trim())
            buf = buf.slice(nl + 1)
        }
    })

    s.on('error', () => {
        socket = null
        emitEvent('disconnect', {})
        scheduleReconnect()
    })

    s.on('close', () => {
        socket = null
        emitEvent('disconnect', {})
        scheduleReconnect()
    })
}

/** Start connecting to the daemon socket; auto-reconnects on failure. */
export function daemonConnect() {
    connect()
}

/** Register a listener for a specific daemon message type (or '*' for all). Returns an unsubscribe fn. */
export function daemonOn(type, cb) {
    if (!listeners.has(type)) listeners.set(type, [])
    listeners.get(type).push(cb)
    return () => {
        const arr = listeners.get(type) || []
        const idx = arr.indexOf(cb)
        if (idx !== -1) arr.splice(idx, 1)
    }
}

/** Send a JSON command to the daemon. Returns false when not connected. */
export function daemonSend(obj) {
    if (!socket || socket.destroyed) return false
    try { socket.write(JSON.stringify(obj) + '\n'); return true; }
    catch { return false; }
}

/** Send a command and await a matching response type (with timeout). */
export function daemonRequest(cmd, replyType, timeoutMs = 8_000) {
    return new Promise((resolve, reject) => {
        let timer = null
        const unsub = daemonOn(replyType, (msg) => {
            clearTimeout(timer)
            unsub()
            resolve(msg)
        })
        timer = setTimeout(() => {
            unsub()
            reject(new Error(`daemon request '${cmd.type}' timed out`))
        }, timeoutMs)
        if (!daemonSend(cmd)) {
            clearTimeout(timer)
            unsub()
            reject(new Error('daemon not connected'))
        }
    })
}

/** True when the socket is currently connected. */
export function isDaemonConnected() {
    return socket !== null && !socket.destroyed
}
