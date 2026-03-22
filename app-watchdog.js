import fs from 'fs';
import { execSync, spawn } from 'child_process';

/**
 * CONFIGURATION
 */
const ALLOWED_APP = 'brave';
const CHECK_INTERVAL_MS = 4000;  // Check alle 4 Sekunden
const MIN_CPU_DELTA = 0.02;      // Schwellenwert für App-Reaktion
const INPUT_WINDOW_SEC = 6;      // Zeitfenster für Hardware-Events

let sessionExpired = true;
let lastInputTimestamp = 0;
let lastTotalJiffies = 0;

/**
 * 1. HARDWARE-MONITORING (Input-Sonde)
 */
const startInputMonitoring = () => {
    const devicesInfo = fs.readFileSync('/proc/bus/input/devices', 'utf8');
    const matches = devicesInfo.match(/Handlers=.*event(\d+)/g) || [];
    const eventIds = matches.map(m => m.match(/\d+/)[0]);

    eventIds.forEach(id => {
        try {
            const proc = spawn('cat', [`/dev/input/event${id}`]);
            proc.stdout.on('data', () => { lastInputTimestamp = Date.now(); });
        } catch (e) {}
    });
    console.log(`[LiFE] Hardware-Wächter aktiv auf ${eventIds.length} Geräten.`);
};

/**
 * 2. CPU-Jiffies (Präzise Lastmessung)
 */
const getAppJiffies = (appName) => {
    try {
        const pids = execSync(`pgrep -f ${appName}`).toString().split('\n').filter(Boolean);
        let total = 0;
        pids.forEach(pid => {
            try {
                const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ');
                total += parseInt(stat[13]) + parseInt(stat[14]);
            } catch (e) {}
        });
        return total;
    } catch (e) { return 0; }
};

/**
 * 3. DER WATCHDOG
 */
const checkStatus = () => {
    const currentJiffies = getAppJiffies(ALLOWED_APP);
    const cpuDelta = currentJiffies - lastTotalJiffies;
    const secondsSinceInput = (Date.now() - lastInputTimestamp) / 1000;

    // Wir konvertieren Delta in einen lesbaren Wert (Jiffies/100 ca. Sekunden)
    const normalizedDelta = cpuDelta / 100;

    if (sessionExpired) {
        // DER KERN: Hardware-Input JA, aber App-Reaktion NEIN -> Manipulation!
        if (secondsSinceInput < INPUT_WINDOW_SEC) {
            if (normalizedDelta < MIN_CPU_DELTA) {
                console.warn(`\n[ALARM] Manipulation erkannt! Input vorhanden, aber ${ALLOWED_APP} idelt (${normalizedDelta.toFixed(3)}s CPU).`);
                // Hier: execSync('loginctl terminate-session self');
            }
        }
        // Hinweis: Wenn secondsSinceInput > INPUT_WINDOW_SEC, passiert nichts (Kind liest oder ist weg).
    }

    lastTotalJiffies = currentJiffies;
};

// Start
startInputMonitoring();
lastTotalJiffies = getAppJiffies(ALLOWED_APP);
setInterval(checkStatus, CHECK_INTERVAL_MS);
