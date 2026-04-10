/* SPDX-License-Identifier: GPL-3.0-or-later; Copyright (c) 2026 Thomas Michael Weissel; Licensed under GPLv3+ (see http://www.gnu.org/licenses/). */
// Typed wrappers for privileged daemon IPC commands.
// The daemon runs as root; the frontend uses these to perform system writes without root.
import { daemonRequest, daemonSend, isDaemonConnected } from './daemonClient.js'

function logErr(cmd, err) {
    console.error(`[LiFE daemon/${cmd}]`, err)
}

/** Register this frontend's executable path with the daemon (for warning-window spawning). Fire-and-forget. */
export function daemonRegisterClient(execPath) {
    console.log(`[LiFE daemon/register-client] execPath=${execPath}`)
    daemonSend({ type: 'register-client', execPath })
}

/**
 * Write /etc/life-parental/default.json via daemon (atomic, world-readable).
 * Fire-and-forget variant — returns immediately, logs errors.
 */
export function daemonWriteConfigAsync(jsonString) {
    if (!isDaemonConnected()) { logErr('write-config', 'daemon not connected'); return }
    daemonRequest({ type: 'write-config', content: jsonString }, 'write-config-result', 15_000)
        .then(r => { if (!r.ok) logErr('write-config', r.error) })
        .catch(e => logErr('write-config', e.message))
}

/** Write /etc/hosts LiFE section + flush DNS. Awaitable. */
export async function daemonWriteHosts(entries) {
    if (!isDaemonConnected()) { logErr('write-hosts', 'daemon not connected'); return { ok: false, error: 'daemon not connected' } }
    try { return await daemonRequest({ type: 'write-hosts', entries }, 'write-hosts-result', 60_000) }
    catch (e) { logErr('write-hosts', e.message); return { ok: false, error: e.message } }
}

/**
 * Write /etc/dnsmasq.conf with blocked domains, write /etc/resolv.conf → 127.0.0.1,
 * protect resolv.conf with chattr +i, restart dnsmasq. Awaitable.
 * @param {Array<{domain:string,enabled:boolean}>} entries
 * @param {string} [dnsMode='dns4eu_protective']  dns4eu_protective|dns4eu_child|dns4eu_ads|dns4eu_child_ads|dhcp
 */
export async function daemonWriteDnsmasq(entries, dnsMode = 'dns4eu_protective', dhcpFallbackDns = null) {
    if (!isDaemonConnected()) { logErr('write-dnsmasq', 'daemon not connected'); return { ok: false, error: 'daemon not connected' } }
    try { return await daemonRequest({ type: 'write-dnsmasq', entries, dnsMode, dhcpFallbackDns }, 'write-dnsmasq-result', 60_000) }
    catch (e) { logErr('write-dnsmasq', e.message); return { ok: false, error: e.message } }
}

/** Remove LiFE dnsmasq filter config and restore resolv.conf to direct upstream. Awaitable. */
export async function daemonRemoveDnsmasq() {
    if (!isDaemonConnected()) { logErr('remove-dnsmasq', 'daemon not connected'); return { ok: false, error: 'daemon not connected' } }
    try { return await daemonRequest({ type: 'remove-dnsmasq' }, 'remove-dnsmasq-result', 30_000) }
    catch (e) { logErr('remove-dnsmasq', e.message); return { ok: false, error: e.message } }
}

/** Query the DHCP-assigned DNS server IP from the daemon. Awaitable. Returns { ok, ip } */
export async function daemonGetDhcpDns() {
    if (!isDaemonConnected()) return { ok: false, ip: null }
    try { return await daemonRequest({ type: 'get-dhcp-dns' }, 'get-dhcp-dns-result', 10_000) }
    catch (e) { return { ok: false, ip: null } }
}

/** Write + reload AppArmor profile. Fire-and-forget. */
export function daemonSyncAppArmorAsync(profileContent) {
    if (!isDaemonConnected()) { logErr('sync-apparmor', 'daemon not connected'); return }
    daemonRequest({ type: 'sync-apparmor', profileContent }, 'sync-apparmor-result', 15_000)
        .then(r => { if (!r.ok) logErr('sync-apparmor', r.error) })
        .catch(e => logErr('sync-apparmor', e.message))
}

/** Write/delete .desktop override files + update-desktop-database. Awaitable. */
export async function daemonDesktopOverride(toWrite, toDelete) {
    if (!isDaemonConnected()) { logErr('desktop-override', 'daemon not connected'); return { ok: false, error: 'daemon not connected' } }
    try { return await daemonRequest({ type: 'desktop-override', write: toWrite, delete: toDelete }, 'desktop-override-result', 15_000) }
    catch (e) { logErr('desktop-override', e.message); return { ok: false, error: e.message } }
}

/** Write /etc/xdg/kdeglobals and optionally /etc/xdg/plasma-appletsrc. Awaitable. */
export async function daemonWriteKiosk(kdeglobalsContent, plasmaAppletsrcContent) {
    if (!isDaemonConnected()) { logErr('write-kiosk', 'daemon not connected'); return { ok: false, error: 'daemon not connected' } }
    try { return await daemonRequest({ type: 'write-kiosk', kdeglobalsContent, plasmaAppletsrcContent }, 'write-kiosk-result', 15_000) }
    catch (e) { logErr('write-kiosk', e.message); return { ok: false, error: e.message } }
}

/** Write /etc/life-parental/app-monitor-catalog.json. Fire-and-forget. */
export function daemonWriteAppCatalogAsync(content) {
    if (!isDaemonConnected()) { logErr('write-app-catalog', 'daemon not connected'); return }
    daemonRequest({ type: 'write-app-catalog', content }, 'write-app-catalog-result', 15_000)
        .then(r => { if (!r.ok) logErr('write-app-catalog', r.error) })
        .catch(e => logErr('write-app-catalog', e.message))
}

/** systemctl action on parental-control.service. Awaitable. */
export async function daemonServiceControl(action) {
    if (!isDaemonConnected()) { logErr('service-control', 'daemon not connected'); return { ok: false, error: 'Daemon nicht verbunden.' } }
    try {
        console.log(`[LiFE daemon/service-control] sending action=${action}`)
        const r = await daemonRequest({ type: 'service-control', action }, 'service-control-result', 15_000)
        if (r.ok) console.log(`[LiFE daemon/service-control] ok action=${action}`)
        else logErr('service-control', `action=${action} error=${r.error}`)
        return r
    }
    catch (e) { logErr('service-control', e.message); return { ok: false, error: e.message } }
}

/** Delete today's usage file (screen time reset). Awaitable. */
export async function daemonResetTodayUsage() {
    if (!isDaemonConnected()) return { ok: false, error: 'Daemon nicht verbunden.' }
    try { return await daemonRequest({ type: 'reset-today-usage' }, 'reset-today-usage-result', 10_000) }
    catch (e) { return { ok: false, error: e.message } }
}

/** Delete today's quota-usage file (app quota reset). Awaitable. */
export async function daemonResetTodayQuotaUsage() {
    if (!isDaemonConnected()) return { ok: false, error: 'Daemon nicht verbunden.' }
    try { return await daemonRequest({ type: 'reset-today-quota-usage' }, 'reset-today-quota-usage-result', 10_000) }
    catch (e) { return { ok: false, error: e.message } }
}

/** Delete old usage/quota/app-usage archive files. Awaitable. */
export async function daemonPruneArchives() {
    if (!isDaemonConnected()) return { ok: false, error: 'Daemon nicht verbunden.' }
    try { return await daemonRequest({ type: 'prune-archives' }, 'prune-archives-result', 15_000) }
    catch (e) { return { ok: false, error: e.message } }
}

/** Delete ALL usage/quota-usage/app-usage JSON files (full history wipe). Awaitable. */
export async function daemonWipeUsageHistory() {
    if (!isDaemonConnected()) return { ok: false, error: 'Daemon nicht verbunden.' }
    try { return await daemonRequest({ type: 'wipe-usage-history' }, 'wipe-usage-history-result', 15_000) }
    catch (e) { return { ok: false, error: e.message } }
}

/** Append a single entry to the activity log ring-buffer. Fire-and-forget. */
export function daemonAppendActivity(entry) {
    if (!isDaemonConnected()) return
    daemonSend({ type: 'append-activity', entry })
}

/** Write downloaded hagezi feed files + meta to blocklists cache dir. Awaitable. */
export async function daemonWriteHageziCache(files, meta) {
    if (!isDaemonConnected()) return { ok: false, error: 'Daemon nicht verbunden.' }
    try { return await daemonRequest({ type: 'write-hagezi-cache', files, meta }, 'write-hagezi-cache-result', 120_000) }
    catch (e) { return { ok: false, error: e.message } }
}

/** Check whether a parent password has been set. Awaitable. */
export async function daemonAuthIsSet() {
    if (!isDaemonConnected()) return { ok: false, error: 'Daemon nicht verbunden.' }
    try { return await daemonRequest({ type: 'auth:is-set' }, 'auth:is-set-result', 8_000) }
    catch (e) { return { ok: false, error: e.message } }
}

/** Verify the parent password (daemon does the hash comparison). Awaitable. */
export async function daemonAuthCheck(password) {
    if (!isDaemonConnected()) return { ok: false, error: 'Daemon nicht verbunden.' }
    try { return await daemonRequest({ type: 'auth:check', password }, 'auth:check-result', 8_000) }
    catch (e) { return { ok: false, error: e.message } }
}

/** Set the parent password (daemon hashes and stores in auth.json 600). Awaitable. */
export async function daemonAuthSet(password) {
    if (!isDaemonConnected()) return { ok: false, error: 'Daemon nicht verbunden.' }
    try { return await daemonRequest({ type: 'auth:set', password }, 'auth:set-result', 8_000) }
    catch (e) { return { ok: false, error: e.message } }
}

/** Change the parent password (daemon verifies old, stores new). Awaitable. */
export async function daemonAuthChange(oldPassword, newPassword) {
    if (!isDaemonConnected()) return { ok: false, error: 'Daemon nicht verbunden.' }
    try { return await daemonRequest({ type: 'auth:change', oldPassword, newPassword }, 'auth:change-result', 8_000) }
    catch (e) { return { ok: false, error: e.message } }
}

