import { ref } from 'vue'

const desktopLoginUsers = ref([])

export async function loadDesktopLoginUsers() {
    try {
        const r = await window.api.system.listDesktopLoginUsers()
        desktopLoginUsers.value = r?.ok && Array.isArray(r.users) ? r.users : []
    } catch {
        desktopLoginUsers.value = []
    }
}

export function useDesktopLoginUsers() {
    return { desktopLoginUsers, loadDesktopLoginUsers }
}
