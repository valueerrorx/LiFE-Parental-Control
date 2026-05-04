import Swal from 'sweetalert2'
import { t } from '../i18n.js'

/**
 * @param {() => Promise<void>} onSave
 * @param {'navigate' | 'quit'} context
 * @returns {Promise<boolean>} true = proceed (saved or discarded); false = stay (cancel or save failed)
 */
export async function promptUnsavedChanges(onSave, context = 'navigate') {
    const key = context === 'quit' ? 'unsavedGuard.quit' : 'unsavedGuard.navigate'
    const result = await Swal.fire({
        title: t('unsavedGuard.title'),
        text: t(`${key}.message`),
        icon: 'warning',
        showDenyButton: true,
        showCancelButton: true,
        confirmButtonText: t(`${key}.save`),
        denyButtonText: t('unsavedGuard.discard'),
        cancelButtonText: t('common.cancel'),
        confirmButtonColor: '#1565C0',
        denyButtonColor: '#757575',
        cancelButtonColor: '#9e9e9e',
        focusCancel: true,
        customClass: { popup: 'life-swal-popup' }
    })

    if (result.isConfirmed) {
        try {
            await onSave()
            return true
        } catch {
            return false
        }
    }
    if (result.isDenied) return true
    return false
}
