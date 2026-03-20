import fs from 'fs'
import path from 'path'
import { redeployQuotaFromDisk } from './quotaIpc.js'
import { redeployScheduleCron } from './schedulesIpc.js'
import { removeLegacyProcessKillCronArtifacts } from './processWhitelistIpc.js'
import { appendActivity } from './activityLog.js'

const VERSION_MARKER = '.embedded-enforcement-version'

// Re-deploy screen-time + quota cron Python when packaged `app.getVersion()` changes (template fixes ship with the binary).
export function syncEmbeddedEnforcementIfNeeded(configDir, appVersion) {
    if (!appVersion || typeof appVersion !== 'string') return
    const markerPath = path.join(configDir, VERSION_MARKER)
    let previous = ''
    try {
        previous = fs.readFileSync(markerPath, 'utf8').trim()
    } catch {
        previous = ''
    }
    if (previous === appVersion) return
    removeLegacyProcessKillCronArtifacts()
    redeployScheduleCron(configDir)
    redeployQuotaFromDisk(configDir)
    try {
        fs.writeFileSync(markerPath, `${appVersion}\n`, 'utf8')
    } catch {
        // Marker missing: next start will redeploy again (rare permission edge case).
    }
    appendActivity(configDir, {
        action: 'embedded_enforcement_redeploy',
        version: appVersion,
        previous: previous.length > 0 ? previous : undefined
    })
}
