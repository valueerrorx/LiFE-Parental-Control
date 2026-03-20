// Match Python cron scripts: datetime.date.today() / strftime local calendar day (not UTC).

export function localIsoDate(d = new Date()) {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
}

export function localIsoDateDaysAgo(days) {
    const d = new Date()
    d.setDate(d.getDate() - days)
    return localIsoDate(d)
}
