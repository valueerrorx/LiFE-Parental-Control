import { confirm } from './composables/useConfirm.js'
import { t } from './i18n.js'

/** Quit flow: simple confirm, no password required. */
export async function quitWithParentConfirm() {
    const ok = await confirm({
        title: t('quit.title'),
        message: t('quit.message'),
        okLabel: t('quit.confirm'),
        cancelLabel: t('quit.cancel')
    })
    if (ok) await window.api.system.quit()
}
