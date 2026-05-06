/* SPDX-License-Identifier: GPL-3.0-or-later; Copyright (c) 2026 Thomas Michael Weissel; Licensed under GPLv3+ (see http://www.gnu.org/licenses/). */
'use strict';
// Linux SO_PEERCRED via helper python3 (same process fd duplicated to child stdio index 3).
const { spawnSync } = require('child_process');

const PY = `import socket, struct, sys
SOL_SOCKET = socket.SOL_SOCKET
try:
    SO_PEERCRED = socket.SO_PEERCRED
except AttributeError:
    SO_PEERCRED = 17
try:
    s = socket.socket(fileno=3)
    cred = s.getsockopt(SOL_SOCKET, SO_PEERCRED, 256)
    pid, uid, gid = struct.unpack('iii', cred[:12])
    print(uid)
except Exception:
    sys.exit(1)`;

function getUnixPeerUid(client) {
    if (process.platform !== 'linux') return null;
    if (!client || !client._handle || typeof client._handle.fd !== 'number') return null;
    const fd = client._handle.fd;
    const py = process.env.LIFE_PEERCRED_PYTHON || '/usr/bin/python3';
    const r = spawnSync(py, ['-c', PY], {
        stdio: ['ignore', 'pipe', 'pipe', fd],
        encoding: 'utf8',
        timeout: 3000,
        env: process.env
    });
    if (r.error || r.status !== 0) return null;
    const uid = parseInt(String(r.stdout || '').trim(), 10);
    return Number.isFinite(uid) ? uid : null;
}

module.exports = { getUnixPeerUid };
