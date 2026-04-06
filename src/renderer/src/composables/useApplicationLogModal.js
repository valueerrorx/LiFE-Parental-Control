import { useModal } from './useModal.js'
import { t } from '../i18n.js'

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

function formatActivityTime(iso) {
    try {
        return new Date(iso).toLocaleString()
    } catch {
        return iso || '—'
    }
}

function activityLabel(e) {
    switch (e.action) {
    case 'screen_time_bonus':
        return e.extraAllowanceAfter != null
            ? t('activityLog.screenTimeBonus', { granted: e.granted ?? '?', total: e.extraAllowanceAfter })
            : t('activityLog.screenTimeBonusLegacy', { granted: e.granted ?? '?', after: e.minutesAfter ?? '--' })
    case 'screen_time_reset_today':
        return t('activityLog.screenTimeReset')
    case 'quota_reset_today':
        return t('activityLog.quotaReset')
    case 'backup_export':
        return t('activityLog.backupExport', { file: e.file || 'file' })
    case 'backup_import':
        return t('activityLog.backupImport', { file: e.file || 'file' })
    case 'process_whitelist_save':
        return t('activityLog.processWhitelistSave', {
            enabled: e.enabled ? t('activityLog.yes') : t('activityLog.no'),
            count: e.allowedIds ?? 0
        })
    case 'process_whitelist_redeploy':
        return t('activityLog.processWhitelistRedeploy')
    case 'kiosk_apply':
        return t('activityLog.kioskApply')
    case 'kiosk_strip':
        return t('activityLog.kioskStrip')
    case 'parent_password_set':
        return t('activityLog.parentPasswordSet')
    case 'parent_password_changed':
        return t('activityLog.parentPasswordChanged')
    case 'schedule_cron_redeploy':
        return t('activityLog.scheduleCronRedeploy')
    case 'quota_cron_redeploy':
        return t('activityLog.quotaCronRedeploy')
    case 'embedded_enforcement_redeploy': {
        const prev = e.previous ? t('activityLog.previousVersion', { version: e.previous }) : ''
        return t('activityLog.embeddedEnforcementRedeploy', { version: e.version ?? '?', previous: prev })
    }
    case 'webfilter_reapply_mirror':
        return t('activityLog.webfilterReapply')
    case 'usage_archives_pruned':
        return t('activityLog.usageArchivesPruned', { count: e.removed ?? 0 })
    case 'protections_stop_all':
        return t('activityLog.protectionsStopAll')
    case 'usage_history_wiped_all':
        return t('activityLog.usageHistoryWiped', { count: e.removed ?? 0 })
    default:
        return typeof e.action === 'string' ? e.action : JSON.stringify(e)
    }
}

export function useApplicationLogModal() {
    const { inform } = useModal()

    async function openApplicationLog() {
        const r = await window.api.activity.list(200)
        const entries = Array.isArray(r?.entries) ? r.entries : []
        const rows = entries.length
            ? entries.map((e) => {
                const time = escapeHtml(formatActivityTime(e.t))
                const label = escapeHtml(activityLabel(e))
                return `<li class="mb-2 pb-2 border-bottom border-light"><div class="text-muted" style="font-size:11px;">${time}</div><div>${label}</div></li>`
            }).join('')
            : `<li class="text-muted">${t('activityLog.noEntries')}</li>`
        const html = `<p class="text-muted small mb-2">${t('activityLog.desc')}</p><ul class="list-unstyled mb-0 small" style="max-height:50vh;overflow-y:auto;">${rows}</ul>`
        await inform(t('activityLog.title'), html, { wide: true })
    }

    return { openApplicationLog }
}
