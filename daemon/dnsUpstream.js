/* SPDX-License-Identifier: GPL-3.0-or-later; Copyright (c) 2026 Thomas Michael Weissel; Licensed under GPLv3+ (see http://www.gnu.org/licenses/). */
'use strict';

const fs = require('fs');
const { execFileSync, spawnSync } = require('child_process');

const RESOLV_CONF = '/etc/resolv.conf';
const NM_RESOLV_CONF = '/run/NetworkManager/resolv.conf';

const DNS4EU = {
    dns4eu_protective: '86.54.11.1',
    dns4eu_child: '86.54.11.12',
    dns4eu_ads: '86.54.11.13',
    dns4eu_child_ads: '86.54.11.11',
};

function isUsableDns(ip) {
    if (typeof ip !== 'string') return false;
    const s = ip.trim();
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) {
        const parts = s.split('.').map(n => Number(n));
        if (parts.some(n => n > 255)) return false;
        if (parts[0] === 127 || s === '0.0.0.0') return false;
        return true;
    }
    if (s.includes(':') && !s.includes('%') && s !== '::' && s !== '::1') return true;
    return false;
}

function dnsmasqServerDirective(ip) {
    return ip.includes(':') ? `server=[${ip}]` : `server=${ip}`;
}

function nameserversInText(text) {
    const out = [];
    for (const line of String(text || '').split('\n')) {
        const m = line.match(/^nameserver\s+(\S+)/);
        if (m && isUsableDns(m[1])) out.push(m[1].trim());
    }
    return out;
}

function defaultRouteDev(family) {
    try {
        const args = family === 6 ? ['-6', 'route', 'show', 'default'] : ['-4', 'route', 'show', 'default'];
        const out = execFileSync('ip', args, { timeout: 3000, encoding: 'utf8' });
        const m = out.match(/\bdev\s+(\S+)/);
        return m ? m[1] : null;
    } catch {
        return null;
    }
}

function dnsFromDevice(dev, key) {
    if (!dev) return [];
    try {
        const out = execFileSync('nmcli', ['-g', key, 'dev', 'show', dev], { timeout: 5000, encoding: 'utf8' });
        return String(out).split('\n').map(s => s.trim()).filter(isUsableDns);
    } catch {
        return [];
    }
}

// DNS of the interface that owns the default route. Ignores 127.0.0.0/8 and other devices.
function resolveLiveDhcpDns() {
    const v4 = dnsFromDevice(defaultRouteDev(4), 'IP4.DNS');
    if (v4.length) return v4[0];
    const v6 = dnsFromDevice(defaultRouteDev(6), 'IP6.DNS');
    if (v6.length) return v6[0];
    try {
        const fromNm = nameserversInText(fs.readFileSync(NM_RESOLV_CONF, 'utf8'));
        if (fromNm.length) return fromNm[0];
    } catch { /* NM resolv not written yet */ }
    return null;
}

// Real DNS query over UDP. A TCP connect on port 53 is not a DNS answer.
function probeDnsUdpSync(ip) {
    if (!isUsableDns(ip)) return false;
    const script = [
        "const dgram=require('dgram');",
        "const ip=process.argv[1];",
        "const sock=dgram.createSocket(ip.includes(':')?'udp6':'udp4');",
        "const header=Buffer.alloc(12);",
        "header.writeUInt16BE(0x4c46,0);",
        "header.writeUInt16BE(0x0100,2);",
        "header.writeUInt16BE(1,4);",
        "const q=Buffer.concat([header,Buffer.from([7]),Buffer.from('example'),Buffer.from([3]),Buffer.from('com'),Buffer.from([0,0,1,0,1])]);",
        "const t=setTimeout(()=>{try{sock.close()}catch(e){}process.exit(1)},1000);",
        "sock.on('error',()=>{clearTimeout(t);try{sock.close()}catch(e){}process.exit(1)});",
        "sock.on('message',(msg)=>{clearTimeout(t);try{sock.close()}catch(e){}process.exit(msg.length>=12&&msg.readUInt16BE(0)===0x4c46?0:1)});",
        "sock.send(q,53,ip);",
    ].join('');
    try {
        const r = spawnSync(process.execPath, ['-e', script, ip], { timeout: 2500 });
        return r.status === 0;
    } catch {
        return false;
    }
}

function chooseUpstream(dnsMode) {
    const live = resolveLiveDhcpDns();
    if (dnsMode === 'dhcp') {
        return live ? { upstream: live, source: 'dhcp' } : null;
    }
    const eu = DNS4EU[dnsMode] || DNS4EU.dns4eu_protective;
    if (probeDnsUdpSync(eu)) return { upstream: eu, source: 'dns4eu' };
    if (live) return { upstream: live, source: 'dhcp-fallback' };
    return null;
}

function dnsmasqIsActive() {
    try {
        const out = execFileSync('systemctl', ['is-active', 'dnsmasq.service'], { timeout: 3000, encoding: 'utf8' });
        return String(out).trim() === 'active';
    } catch {
        return false;
    }
}

// systemctl's client timeout does not kill a dnsmasq that ignored SIGTERM.
function restartDnsmasq(log) {
    try {
        execFileSync('systemctl', ['restart', 'dnsmasq.service'], { timeout: 15000 });
    } catch (e) {
        log && log.warn && log.warn('dns: dnsmasq restart failed, killing stuck process: ' + e.message);
        try { execFileSync('killall', ['-9', 'dnsmasq'], { timeout: 5000 }); } catch { /* already gone */ }
        try { execFileSync('systemctl', ['reset-failed', 'dnsmasq.service'], { timeout: 5000 }); } catch { /* ignore */ }
        try { execFileSync('systemctl', ['start', 'dnsmasq.service'], { timeout: 15000 }); } catch (e2) {
            log && log.warn && log.warn('dns: dnsmasq start failed: ' + e2.message);
            return false;
        }
    }
    return dnsmasqIsActive();
}

function stopDnsmasq(log) {
    try { execFileSync('systemctl', ['stop', 'dnsmasq.service'], { timeout: 8000 }); } catch (e) {
        log && log.warn && log.warn('dns: dnsmasq stop failed: ' + e.message);
    }
    try { execFileSync('killall', ['-9', 'dnsmasq'], { timeout: 5000 }); } catch { /* not running */ }
    try { execFileSync('systemctl', ['reset-failed', 'dnsmasq.service'], { timeout: 5000 }); } catch { /* ignore */ }
}

function unlockResolvConf() {
    try { execFileSync('chattr', ['-i', RESOLV_CONF], { timeout: 3000 }); } catch { /* not immutable */ }
}

function pointResolvAtLocalDnsmasq(log) {
    unlockResolvConf();
    try {
        if (fs.lstatSync(RESOLV_CONF).isSymbolicLink()) fs.unlinkSync(RESOLV_CONF);
    } catch { /* absent */ }
    fs.writeFileSync(RESOLV_CONF, 'nameserver 127.0.0.1\n', 'utf8');
    try { fs.chmodSync(RESOLV_CONF, 0o644); } catch { /* ignore */ }
    try { execFileSync('chattr', ['+i', RESOLV_CONF], { timeout: 3000 }); } catch (e) {
        log && log.warn && log.warn('dns: chattr +i failed: ' + e.message);
    }
}

function readDnsmasqUpstream() {
    try {
        const text = fs.readFileSync('/etc/dnsmasq.conf', 'utf8');
        const m = text.match(/^server=(?:\[([^\]]+)\]|(\S+))/m);
        return (m && (m[1] || m[2])) || null;
    } catch {
        return null;
    }
}

function resolvPointsAtLocal() {
    try {
        return /^nameserver\s+127\.0\.0\.1\s*$/m.test(fs.readFileSync(RESOLV_CONF, 'utf8'));
    } catch {
        return false;
    }
}

// True when the running upstream no longer matches this network. Does not flip back to dns4eu on its own.
function upstreamDrifted(dnsMode) {
    if (!resolvPointsAtLocal()) return true;
    const configured = readDnsmasqUpstream();
    if (!isUsableDns(configured)) return true;
    const live = resolveLiveDhcpDns();
    if (dnsMode === 'dhcp') return !!(live && live !== configured);
    const eu = DNS4EU[dnsMode] || DNS4EU.dns4eu_protective;
    if (configured === eu && live) return !probeDnsUdpSync(eu);
    return false;
}

function releaseResolvToNetworkManager(log) {
    unlockResolvConf();
    let nmOk = false;
    try {
        nmOk = nameserversInText(fs.readFileSync(NM_RESOLV_CONF, 'utf8')).length > 0;
    } catch { /* ignore */ }
    const live = nmOk ? null : resolveLiveDhcpDns();
    if (!nmOk && !live) {
        log && log.warn && log.warn('dns: no network DNS to restore');
        return false;
    }
    try { fs.unlinkSync(RESOLV_CONF); } catch { /* absent */ }
    if (nmOk) {
        fs.symlinkSync(NM_RESOLV_CONF, RESOLV_CONF);
        log && log.info && log.info('dns: resolv.conf returned to NetworkManager');
        return true;
    }
    fs.writeFileSync(RESOLV_CONF, `nameserver ${live}\n`, 'utf8');
    try { fs.chmodSync(RESOLV_CONF, 0o644); } catch { /* ignore */ }
    log && log.info && log.info('dns: resolv.conf set to network DNS ' + live);
    return true;
}

module.exports = {
    DNS4EU,
    isUsableDns,
    dnsmasqServerDirective,
    resolveLiveDhcpDns,
    probeDnsUdpSync,
    chooseUpstream,
    restartDnsmasq,
    stopDnsmasq,
    readDnsmasqUpstream,
    resolvPointsAtLocal,
    upstreamDrifted,
    pointResolvAtLocalDnsmasq,
    releaseResolvToNetworkManager,
};
