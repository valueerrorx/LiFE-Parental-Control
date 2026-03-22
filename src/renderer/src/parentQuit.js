import { confirm } from './composables/useConfirm.js'

/** Quit flow: simple confirm, no password required. */
export async function quitWithParentPassword() {
    const ok = await confirm({
        title: 'Quit LiFE Parental Control',
        message: 'Application beenden?',
        okLabel: 'Beenden',
        cancelLabel: 'Abbrechen'
    })
    if (ok) await window.api.system.quit()
}
