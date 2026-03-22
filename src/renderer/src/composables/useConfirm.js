import Swal from 'sweetalert2'

/** Shows an in-renderer confirm dialog — no system dialog, no focus loss. */
export async function confirm({ title, message, okLabel = 'OK', cancelLabel = 'Cancel', danger = false } = {}) {
    const result = await Swal.fire({
        title,
        text: message,
        icon: danger ? 'warning' : 'question',
        showCancelButton: true,
        confirmButtonText: okLabel,
        cancelButtonText: cancelLabel,
        confirmButtonColor: danger ? '#d32f2f' : '#1565C0',
        cancelButtonColor: '#757575',
        focusCancel: true,
        customClass: { popup: 'life-swal-popup' }
    })
    return result.isConfirmed
}
