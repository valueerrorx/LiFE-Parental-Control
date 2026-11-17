/* SPDX-License-Identifier: GPL-3.0-or-later; Copyright (c) 2026 Thomas Michael Weissel; Licensed under GPLv3+ (see http://www.gnu.org/licenses/). */
'use strict';
// Pure Java process classification (no I/O): profiles + marker/JVM checks; the daemon supplies /proc data.

const JAVA_GAME_ID_PREFIX = 'javagame:';

// Markers are lowercase substrings of the space-joined /proc cmdline; one hit is enough. Client-only (servers must not match).
const JAVA_GAME_PROFILES = [
    {
        id: 'minecraft',
        appId: 'javagame:minecraft',
        appName: 'Minecraft (Java Edition)',
        processName: 'minecraft-java',
        markersAny: [
            '-dminecraft.launcher.brand=',
            'net.minecraft.client.main.main',
            'net.minecraft.launchwrapper.launch',
            'org.prismlauncher.entrypoint',
            'org.multimc.entrypoint',
            'org.polymc.entrypoint',
            '--assetindex',
            '--accesstoken',
            'net.fabricmc.loader.impl.launch.knot.knotclient'
        ]
    }
];

function javaGameProfileForAppId(appId) {
    const id = String(appId || '').trim();
    if (!id.startsWith(JAVA_GAME_ID_PREFIX)) return null;
    return JAVA_GAME_PROFILES.find((p) => p.appId === id) || null;
}

// Marker list for a Java entry, or null when the entry is not handled by the Java branch.
function javaMarkersForEntry(appId) {
    const p = javaGameProfileForAppId(appId);
    return p ? p.markersAny : null;
}

// proc: { uid, comm, exeBase, cmdlineLower, readMaps? }. Returns the hit marker or ''.
// Hit = child uid range AND marker in cmdline AND JVM (comm/exe "java" or libjvm.so mapped; maps read only after a marker hit).
function matchJavaProcess(proc, markers, uidMin) {
    if (!proc || !Array.isArray(markers) || !markers.length) return '';
    const uid = Number(proc.uid);
    if (!Number.isFinite(uid) || uid < uidMin || uid >= 65534) return '';
    const cmd = String(proc.cmdlineLower || '');
    if (!cmd) return '';
    const marker = markers.find((m) => m && cmd.includes(m));
    if (!marker) return '';
    if (String(proc.comm || '').toLowerCase() === 'java' || String(proc.exeBase || '').toLowerCase() === 'java') return marker;
    let maps = '';
    try { maps = typeof proc.readMaps === 'function' ? String(proc.readMaps() || '') : ''; } catch { maps = ''; }
    return maps.includes('/libjvm.so') ? marker : '';
}

// First matching profile for a process: { profileId, appId, marker } or null.
function classifyJavaGame(proc, uidMin) {
    for (const p of JAVA_GAME_PROFILES) {
        const marker = matchJavaProcess(proc, p.markersAny, uidMin);
        if (marker) return { profileId: p.id, appId: p.appId, marker };
    }
    return null;
}

module.exports = {
    JAVA_GAME_ID_PREFIX,
    JAVA_GAME_PROFILES,
    javaGameProfileForAppId,
    javaMarkersForEntry,
    matchJavaProcess,
    classifyJavaGame
};
