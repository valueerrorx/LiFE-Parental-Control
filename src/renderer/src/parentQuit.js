import { confirm } from './composables/useConfirm.js'
import { getActiveUnsavedQuitGuard } from './composables/unsavedQuitRegistry.js'
import { promptUnsavedChanges } from './composables/unsavedPrompt.js'
import { t } from './i18n.js'

/** Quit flow: same unsaved guard as route leave when the dashboard page is dirty; otherwise a simple confirm. */
export async function quitWithParentConfirm() {
    const g = getActiveUnsavedQuitGuard()
    if (g?.isDirty.value) {
        const proceed = await promptUnsavedChanges(g.onSave, 'quit')
        if (!proceed) return
        await window.api.system.quit()
        return
    }
    const ok = await confirm({
        title: t('quit.title'),
        message: t('quit.message'),
        okLabel: t('quit.confirm'),
        cancelLabel: t('quit.cancel')
    })
    if (ok) await window.api.system.quit()
}
