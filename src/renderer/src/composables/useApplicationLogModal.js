import { useModal } from './useModal.js'

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
            ? `Screen time: +${e.granted ?? '?'} min extra allowance (total +${e.extraAllowanceAfter} min today)`
            : `Screen time bonus (legacy): −${e.granted ?? '?'} min recorded (now ${e.minutesAfter ?? '--'} min today)`
    case 'screen_time_reset_today':
        return "Screen time: today's usage file cleared"
    case 'quota_reset_today':
        return "App quotas: today's usage file cleared"
    case 'backup_export':
        return `Settings backup exported (${e.file || 'file'})`
    case 'backup_import':
        return `Settings backup imported (${e.file || 'file'})`
    case 'process_whitelist_save':
        return `Quota exemptions saved (on: ${e.enabled ? 'yes' : 'no'}, ${e.allowedIds ?? 0} exempt apps)`
    case 'process_whitelist_redeploy':
        return 'Quota exemptions: quota script re-deployed from disk'
    case 'life_mode_apply':
        return `Family profile applied: ${e.label ?? e.modeKey ?? '?'}`
    case 'kiosk_apply':
        return 'KDE kiosk rules written to /etc/xdg/kdeglobals (session restart triggered)'
    case 'kiosk_strip':
        return 'LiFE kiosk sections removed from kdeglobals (session restart triggered)'
    case 'autostart_enabled':
        return e.reason === 'first_password'
            ? 'Startup: autostart enabled after first password (system login)'
            : 'Startup: autostart enabled (/etc/xdg/autostart)'
    case 'autostart_disabled':
        return 'Startup: autostart disabled (desktop file removed)'
    case 'parent_password_set':
        return 'Parent password was set'
    case 'parent_password_changed':
        return 'Parent password was changed'
    case 'schedule_cron_redeploy':
        return 'Screen time: enforcement cron/script rewritten from schedules.json'
    case 'quota_cron_redeploy':
        return 'App quotas: enforcement cron/script rewritten from disk'
    case 'embedded_enforcement_redeploy':
        return `Packaged app upgrade: screen-time + quota cron scripts redeployed (v${e.version ?? '?'}${e.previous ? `, was v${e.previous}` : ''})`
    case 'webfilter_reapply_mirror':
        return 'Web filter: /etc/hosts block rebuilt from webfilter.json mirror'
    case 'usage_archives_pruned':
        return `Old usage archive files removed (${e.removed ?? 0} files)`
    case 'protections_stop_all':
        return 'Danger zone: all protections stopped (screen time, quotas, blocks, web filter, exemptions; kiosk removed if active)'
    case 'usage_history_wiped_all':
        return `Danger zone: all usage/quota daily logs deleted (${e.removed ?? 0} files)`
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
                const t = escapeHtml(formatActivityTime(e.t))
                const label = escapeHtml(activityLabel(e))
                return `<li class="mb-2 pb-2 border-bottom border-light"><div class="text-muted" style="font-size:11px;">${t}</div><div>${label}</div></li>`
            }).join('')
            : '<li class="text-muted">No entries yet.</li>'
        const html = `<p class="text-muted small mb-2">Parental action log (newest first). File: <code>/etc/life-parental/activity-log.json</code> (last 400 events kept).</p><ul class="list-unstyled mb-0 small" style="max-height:50vh;overflow-y:auto;">${rows}</ul>`
        await inform('Application log', html, { wide: true })
    }

    return { openApplicationLog }
}
