import { onBeforeRouteLeave } from 'vue-router'
import Swal from 'sweetalert2'
import { t } from '../i18n.js'

/**
 * Call this inside a page's <script setup> to show a "You have unsaved changes"
 * modal when the user navigates away while isDirty is true.
 *
 * @param {import('vue').ComputedRef<boolean>} isDirty
 * @param {() => Promise<void>} onSave  - the page's existing save function
 */
export function useUnsavedGuard(isDirty, onSave) {
    onBeforeRouteLeave(async () => {
        if (!isDirty.value) return true

        const result = await Swal.fire({
            title: t('unsavedGuard.title'),
            text: t('unsavedGuard.message'),
            icon: 'warning',
            showDenyButton: true,
            showCancelButton: true,
            confirmButtonText: t('unsavedGuard.save'),
            denyButtonText: t('unsavedGuard.discard'),
            cancelButtonText: t('common.cancel'),
            confirmButtonColor: '#1565C0',
            denyButtonColor: '#757575',
            cancelButtonColor: '#9e9e9e',
            focusCancel: true,
            customClass: { popup: 'life-swal-popup' }
        })

        if (result.isConfirmed) {
            await onSave()
            return true
        } else if (result.isDenied) {
            return true
        } else {
            return false
        }
    })
}
