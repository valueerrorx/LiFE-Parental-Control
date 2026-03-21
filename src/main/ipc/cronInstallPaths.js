import fs from 'fs'

// Ensures paths used for deployed root cron scripts exist (ENOENT from writeFileSync is unreadable otherwise).
export function assertParentalCronInstallDirs() {
    const checks = [
        ['/usr/local/bin', 'sudo mkdir -p /usr/local/bin'],
        ['/etc/cron.d', 'ensure this directory exists (packaged with cronie or systemd-cron) and enable the runner (e.g. cronie.service or cron.target)']
    ]
    for (const [dir, fixHint] of checks) {
        try {
            const st = fs.statSync(dir)
            if (!st.isDirectory()) throw new Error(`${dir} is not a directory`)
        } catch (e) {
            if (e && e.code === 'ENOENT') {
                throw new Error(`Cannot install cron job: ${dir} is missing. ${fixHint}.`, { cause: e })
            }
            throw e
        }
    }
}
