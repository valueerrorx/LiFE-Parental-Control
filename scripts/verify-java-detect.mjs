#!/usr/bin/env node
/**
 * Fixture check for daemon/javaGameDetect.js (Java game classification). --live: classify running processes read-only.
 * Output never contains cmdlines (Minecraft passes access tokens on the command line).
 */
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { classifyJavaGame, javaMarkersForEntry, javaJarMarkerFromExec, matchJavaProcess } = require('../daemon/javaGameDetect.js')

const UID_MIN = 1000
const KID = 1001
const TOKEN = 'FAKE-TOKEN-0000' // fake value, never a real token
const MC_LIBS = '-cp /home/kid/.minecraft/libraries/fake.jar:/home/kid/.minecraft/versions/1.20.4/1.20.4.jar'
const NO_JVM = () => '7f00-7f01 r-xp 0 00:00 0 /usr/lib/libc.so.6'
const JVM_MAPS = () => '7f00-7f01 r-xp 0 00:00 0 /opt/mcjvm/lib/server/libjvm.so'

// expect: profile id or null
const FIXTURES = [
    { label: 'Firefox', comm: 'firefox', exe: 'firefox', cmd: '/usr/lib/firefox/firefox', expect: null },
    { label: 'Chromium renderer', comm: 'chromium', exe: 'chromium', cmd: '/usr/lib/chromium/chromium --type=renderer --lang=de', expect: null },
    { label: 'Chrome', comm: 'chrome', exe: 'chrome', cmd: '/opt/google/chrome/chrome', expect: null },
    { label: 'Brave wrapper (bash)', comm: 'brave-browser', exe: 'bash', cmd: '/bin/bash /usr/bin/brave-browser', expect: null },
    { label: 'Brave binary', comm: 'brave', exe: 'brave', cmd: '/opt/brave.com/brave/brave', expect: null },
    { label: 'Electron code', comm: 'code', exe: 'code', cmd: '/usr/share/code/code --unity-launch', expect: null },
    { label: 'Electron discord', comm: 'discord', exe: 'Discord', cmd: '/opt/discord/Discord', expect: null },
    { label: 'Flatpak bwrap', comm: 'bwrap', exe: 'bwrap', cmd: 'bwrap --args 40 -- prismlauncher', expect: null },
    { label: 'flatpak-session-helper', comm: 'flatpak-session', exe: 'flatpak-session-helper', cmd: '/usr/libexec/flatpak-session-helper', expect: null },
    { label: 'Flatpak app', comm: 'prismlauncher', exe: 'prismlauncher', cmd: 'prismlauncher', expect: null },
    { label: 'Snap app', comm: 'spotify', exe: 'spotify', cmd: '/snap/spotify/80/usr/share/spotify/spotify', expect: null },
    { label: 'AppImage runtime (Prism launcher)', comm: 'PrismLauncher-L', exe: 'PrismLauncher-Linux-x86_64.AppImage', cmd: '/home/kid/Apps/PrismLauncher-Linux-x86_64.AppImage', expect: null },
    { label: 'Steam', comm: 'steam', exe: 'steam', cmd: '/home/kid/.local/share/Steam/ubuntu12_32/steam -srt-logger-opened', expect: null },
    { label: 'steamwebhelper', comm: 'steamwebhelper', exe: 'steamwebhelper', cmd: './steamwebhelper -lang=german', expect: null },
    { label: 'Wine game', comm: 'wine64-preloade', exe: 'wine64-preloader', cmd: 'C:\\Games\\game.exe', expect: null },
    { label: 'python3 app', comm: 'python3', exe: 'python3.12', cmd: '/usr/bin/python3 /usr/bin/someapp', expect: null },
    { label: 'LibreOffice Writer', comm: 'soffice.bin', exe: 'soffice.bin', cmd: '/usr/lib/libreoffice/program/soffice.bin --writer', expect: null },
    { label: 'IntelliJ (JVM)', comm: 'java', exe: 'java', cmd: '/opt/idea/jbr/bin/java -Xmx2g -classpath /opt/idea/lib/app.jar com.intellij.idea.Main', expect: null },
    { label: 'JDownloader (-jar)', comm: 'java', exe: 'java', cmd: '/usr/bin/java -Xmx1g -jar /opt/jd2/JDownloader.jar', expect: null },
    { label: 'Gradle daemon', comm: 'java', exe: 'java', cmd: `/usr/bin/java -Xmx2g ${MC_LIBS} org.gradle.launcher.daemon.bootstrap.GradleDaemon 8.5`, expect: null },
    { label: 'MC vanilla server nogui', comm: 'java', exe: 'java', cmd: '/usr/bin/java -Xmx2G -Xms1G -jar minecraft_server.1.20.4.jar nogui', expect: null },
    { label: 'MC server.jar nogui', comm: 'java', exe: 'java', cmd: 'java -Xmx4G -jar server.jar nogui', expect: null },
    { label: 'Forge server unix_args', comm: 'java', exe: 'java', cmd: 'java @user_jvm_args.txt @libraries/net/minecraftforge/forge/1.20.1-47.2.0/unix_args.txt nogui', expect: null },
    { label: 'Forge server expanded (bootstraplauncher)', comm: 'java', exe: 'java', cmd: 'java -cp libraries/fake.jar cpw.mods.bootstraplauncher.BootstrapLauncher --launchTarget forgeserver nogui', expect: null },
    { label: 'Fabric server launcher jar', comm: 'java', exe: 'java', cmd: 'java -Xmx2G -jar fabric-server-launch.jar nogui', expect: null },
    { label: 'Fabric server KnotServer', comm: 'java', exe: 'java', cmd: 'java -cp libraries/fake.jar net.fabricmc.loader.impl.launch.knot.KnotServer nogui', expect: null },
    { label: 'Native Minecraft launcher', comm: 'minecraft-launc', exe: 'minecraft-launcher', cmd: '/opt/minecraft-launcher/minecraft-launcher', expect: null },
    { label: 'grep with marker', comm: 'grep', exe: 'grep', cmd: 'grep -r net.minecraft.client.main.Main /tmp', maps: NO_JVM, expect: null },
    { label: 'Editor with marker', comm: 'vim', exe: 'vim', cmd: 'vim notes-org.prismlauncher.EntryPoint.txt', maps: NO_JVM, expect: null },
    { label: 'Script with --accessToken (no JVM)', comm: 'python3', exe: 'python3', cmd: `python3 tool.py --accessToken ${TOKEN}`, maps: NO_JVM, expect: null },
    { label: 'MC client as root', uid: 0, comm: 'java', exe: 'java', cmd: `java ${MC_LIBS} net.minecraft.client.main.Main --accessToken ${TOKEN}`, expect: null },
    { label: 'MC client as system uid', uid: 999, comm: 'java', exe: 'java', cmd: `java ${MC_LIBS} net.minecraft.client.main.Main`, expect: null },
    { label: 'Zombie (empty cmdline)', comm: 'java', exe: '', cmd: '', expect: null },
    { label: 'MC official vanilla', comm: 'java', exe: 'java', cmd: `/home/kid/.minecraft/runtime/java-runtime-gamma/linux/java-runtime-gamma/bin/java -Xmx2G -Dminecraft.launcher.brand=minecraft-launcher -Dminecraft.launcher.version=2.9.17 ${MC_LIBS} net.minecraft.client.main.Main --username Kid --version 1.20.4 --gameDir /home/kid/.minecraft --assetIndex 12 --uuid 00000000 --accessToken ${TOKEN} --userType msa`, expect: 'minecraft' },
    { label: 'MC official Fabric', comm: 'java', exe: 'java', cmd: `java -Dminecraft.launcher.brand=minecraft-launcher ${MC_LIBS} net.fabricmc.loader.impl.launch.knot.KnotClient --username Kid --assetIndex 12 --accessToken ${TOKEN}`, expect: 'minecraft' },
    { label: 'Fabric client without brand', comm: 'java', exe: 'java', cmd: `java ${MC_LIBS} net.fabricmc.loader.impl.launch.knot.KnotClient --gameDir /home/kid/mc`, expect: 'minecraft' },
    { label: 'Forge client (bootstraplauncher + assetIndex)', comm: 'java', exe: 'java', cmd: `java ${MC_LIBS} cpw.mods.bootstraplauncher.BootstrapLauncher --launchTarget forgeclient --assetIndex 5 --accessToken ${TOKEN}`, expect: 'minecraft' },
    { label: 'Prism deb (stdin main class)', comm: 'java', exe: 'java', cmd: '/usr/lib/jvm/java-17-openjdk/bin/java -Xms512m -Xmx4096m -Duser.language=en -cp /usr/share/prismlauncher/NewLaunch.jar org.prismlauncher.EntryPoint', expect: 'minecraft' },
    { label: 'Prism Flatpak', comm: 'java', exe: 'java', cmd: '/app/jdk/17/jvm/openjdk-17/bin/java -Xmx4096m -cp /app/share/PrismLauncher/NewLaunch.jar org.prismlauncher.EntryPoint', expect: 'minecraft' },
    { label: 'MultiMC', comm: 'java', exe: 'java', cmd: 'java -Xmx2g -jar /home/kid/MultiMC/bin/jars/NewLaunch.jar org.multimc.EntryPoint', expect: 'minecraft' },
    { label: 'PolyMC', comm: 'java', exe: 'java', cmd: 'java -cp /usr/share/polymc/NewLaunch.jar org.polymc.EntryPoint', expect: 'minecraft' },
    { label: 'LaunchWrapper (old Forge client)', comm: 'java', exe: 'java', cmd: `java ${MC_LIBS} net.minecraft.launchwrapper.Launch --tweakClass net.minecraftforge.fml.common.launcher.FMLTweaker`, expect: 'minecraft' },
    { label: 'Symlinked java (comm = link name)', comm: 'mc-java', exe: 'java', cmd: 'mc-java -cp NewLaunch.jar org.prismlauncher.EntryPoint', expect: 'minecraft' },
    { label: 'Copied java binary (libjvm in maps)', comm: 'mcjvm', exe: 'mcjvm', cmd: `/opt/mcjvm/bin/mcjvm ${MC_LIBS} net.minecraft.client.main.Main`, maps: JVM_MAPS, expect: 'minecraft' },
    { label: 'Deleted JRE after upgrade (exe "java (deleted)")', comm: 'java', exe: 'java (deleted)', cmd: 'java -cp NewLaunch.jar org.prismlauncher.EntryPoint', expect: 'minecraft' }
]

const ENTRY_IDS = [
    { id: 'javagame:minecraft', expect: true },
    { id: 'javagame:unknown', expect: false },
    { id: 'org.prismlauncher.PrismLauncher.desktop', expect: false },
    { id: 'appimage:0123456789abcdef', expect: false },
    { id: '', expect: false },
    { id: 'jdownloader.desktop', row: { javaMarkers: ['/opt/jd2/JDownloader.jar'] }, expect: true },
    { id: 'javagame:unknown', row: { javaMarkers: ['/x.jar'] }, expect: false }
]

// Exec=java -jar entries: absolute JAR path marker or '' (entry stays dropped as before)
const JAR_EXECS = [
    { exec: 'java -jar /opt/jd2/JDownloader.jar', expect: '/opt/jd2/jdownloader.jar' },
    { exec: '/usr/lib/jvm/java-17/bin/java -Xmx1g -jar "/opt/tool/Tool.jar" %f', expect: '/opt/tool/tool.jar' },
    { exec: 'env JAVA_HOME=/opt/jdk java -jar /opt/tool/Tool.jar %U', expect: '/opt/tool/tool.jar' },
    { exec: 'java -jar tool.jar', expect: '' },
    { exec: 'java -cp /opt/x.jar com.example.Main', expect: '' },
    { exec: 'sh -c "java -jar /opt/x.jar"', expect: '' },
    { exec: 'prismlauncher', expect: '' }
]

// JAR marker against processes: JVM with that jar hits; other JVMs and non-JVMs do not
const JAR_PROCS = [
    { label: 'JDownloader JVM', comm: 'java', exe: 'java', cmd: '/usr/bin/java -Xmx1g -jar /opt/jd2/JDownloader.jar', expect: true },
    { label: 'other JVM', comm: 'java', exe: 'java', cmd: '/usr/bin/java -jar /opt/other/Other.jar', expect: false },
    { label: 'editor on the jar', comm: 'vim', exe: 'vim', cmd: 'vim /opt/jd2/JDownloader.jar', expect: false }
]

function runFixtures() {
    let fails = 0
    for (const f of FIXTURES) {
        const proc = {
            uid: f.uid ?? KID,
            comm: f.comm,
            exeBase: f.exe,
            cmdlineLower: f.cmd.toLowerCase(),
            readMaps: f.maps || NO_JVM
        }
        const r = classifyJavaGame(proc, UID_MIN)
        const got = r ? r.profileId : null
        const ok = got === f.expect
        if (!ok) fails++
        console.log(`${ok ? 'ok  ' : 'FAIL'} ${f.label}: ${got ?? '-'}${r ? ` (${r.marker})` : ''}`)
    }
    for (const e of ENTRY_IDS) {
        const got = !!javaMarkersForEntry(e.id, e.row)
        const ok = got === e.expect
        if (!ok) fails++
        console.log(`${ok ? 'ok  ' : 'FAIL'} javaMarkersForEntry(${JSON.stringify(e.id)}${e.row ? ', row' : ''}): ${got}`)
    }
    for (const j of JAR_EXECS) {
        const got = javaJarMarkerFromExec(j.exec)
        const ok = got === j.expect
        if (!ok) fails++
        console.log(`${ok ? 'ok  ' : 'FAIL'} javaJarMarkerFromExec(${JSON.stringify(j.exec)}): ${got || '-'}`)
    }
    const jdMarkers = javaMarkersForEntry('jdownloader.desktop', { javaMarkers: ['/opt/jd2/JDownloader.jar'] })
    for (const f of JAR_PROCS) {
        const got = !!matchJavaProcess({ uid: KID, comm: f.comm, exeBase: f.exe, cmdlineLower: f.cmd.toLowerCase(), readMaps: NO_JVM }, jdMarkers, UID_MIN)
        const ok = got === f.expect
        if (!ok) fails++
        console.log(`${ok ? 'ok  ' : 'FAIL'} jar marker: ${f.label}: ${got}`)
    }
    return fails
}

function readUidMin() {
    try {
        const m = fs.readFileSync('/etc/login.defs', 'utf8').match(/^\s*UID_MIN\s+(\d+)/m)
        const n = m ? Number(m[1]) : NaN
        if (Number.isFinite(n) && n >= 100) return n
    } catch { /* ignore */ }
    return 1000
}

// Read-only: lists JVM processes and marker hits; prints pid, comm, profile, marker only.
function runLive() {
    const uidMin = readUidMin()
    let jvms = 0
    let hits = 0
    for (const pid of fs.readdirSync('/proc').filter((f) => /^\d+$/.test(f))) {
        let uid, comm, cmd
        try {
            uid = Number(fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/^Uid:\s+(\d+)/m)?.[1])
            comm = fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim().toLowerCase()
            cmd = fs.readFileSync(`/proc/${pid}/cmdline`).toString('utf8').replace(/\0/g, ' ').trim().toLowerCase()
        } catch { continue }
        let exeBase = ''
        try { exeBase = path.basename(fs.readlinkSync(`/proc/${pid}/exe`)) } catch { /* other user */ }
        const r = classifyJavaGame({ uid, comm, exeBase, cmdlineLower: cmd, readMaps: () => fs.readFileSync(`/proc/${pid}/maps`, 'utf8') }, uidMin)
        const isJvm = comm === 'java' || exeBase === 'java'
        if (!isJvm && !r) continue
        if (isJvm) jvms++
        if (r) hits++
        console.log(`pid=${pid} uid=${uid} comm=${comm} profile=${r ? r.profileId : '-'} marker=${r ? r.marker : '-'}`)
    }
    console.log(`live: ${jvms} java process(es), ${hits} classified (UID_MIN=${uidMin})`)
}

const fails = runFixtures()
if (process.argv.includes('--live')) runLive()
if (fails) {
    console.error(`verify-java-detect: ${fails} failure(s)`)
    process.exit(1)
}
console.log(`verify-java-detect: ok (${FIXTURES.length + ENTRY_IDS.length + JAR_EXECS.length + JAR_PROCS.length} checks)`)
