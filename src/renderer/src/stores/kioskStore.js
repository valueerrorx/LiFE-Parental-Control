import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useKioskStore = defineStore('kiosk', () => {
    const configFiles = ref([])
    const profiles = ref([])
    const loadedProfile = ref('last.profile')
    const urlItems = ref([])
    const statusMessage = ref('')

    async function init() {
        try {
            const data = await window.api.config.readFiles()
            configFiles.value = data.map(f => ({ ...f, sections: f.sections.map(s => ({ ...s, checked: false })) }))
            await refreshProfiles()
            await loadProfile('last.profile')
        } catch (err) {
            statusMessage.value = `Failed to load configuration: ${err.message}`
        }
    }

    async function refreshProfiles() {
        profiles.value = await window.api.profile.list()
    }

    async function loadProfile(name) {
        const entries = await window.api.profile.load(name)
        if (!entries) { statusMessage.value = 'Profile file missing'; return }
        unloadProfile()
        for (const entry of entries) {
            if (entry.type === 'url') {
                urlItems.value.push({ path: entry.key, allowed: entry.allowed })
            } else {
                for (const cfg of configFiles.value)
                    for (const section of cfg.sections)
                        if (section.type === entry.type && section.key === entry.key) section.checked = true
            }
        }
        loadedProfile.value = name
        statusMessage.value = `${name} loaded`
    }

    function unloadProfile() {
        for (const cfg of configFiles.value) for (const s of cfg.sections) s.checked = false
        urlItems.value = []
        statusMessage.value = 'Restrictions cleared'
    }

    async function saveProfile(name) {
        const profileName = name ?? loadedProfile.value
        const lines = []
        for (const cfg of configFiles.value)
            for (const s of cfg.sections)
                if (s.checked && (s.type === 'actionrestriction' || s.type === 'module'))
                    lines.push(`${s.type}::${s.key}`)
        for (const item of urlItems.value)
            lines.push(`url::${item.path}##${item.allowed ? 'True' : 'False'}`)
        await window.api.profile.save(profileName, lines.join('\n'))
        loadedProfile.value = profileName
        statusMessage.value = `Saved to ${profileName}`
        await refreshProfiles()
    }

    async function deleteProfile(nameWithExt) {
        await window.api.profile.delete(nameWithExt)
        await refreshProfiles()
        statusMessage.value = 'Profile deleted'
    }

    function addUrl(path, allowed = false) { urlItems.value.push({ path, allowed }) }
    function removeUrl(index) { urlItems.value.splice(index, 1) }

    function buildPlasmaConfig() {
        const actions = [], modules = []
        for (const cfg of configFiles.value)
            for (const s of cfg.sections) {
                if (!s.checked) continue
                if (s.type === 'actionrestriction') actions.push(s.key)
                else if (s.type === 'module') modules.push(s.key)
            }
        let text = ''
        if (actions.length) { text += '\n[KDE Action Restrictions][$i]\n'; for (const k of actions) text += `${k} = false\n` }
        if (modules.length) { text += '\n[KDE Control Module Restrictions][$i]\n'; for (const k of modules) text += `${k} = false\n` }
        if (urlItems.value.length) {
            text += '\n[KDE URL Restrictions][$i]\n'
            text += `rule_count=${urlItems.value.length * 2}\n`
            let i = 1
            for (const { path, allowed } of urlItems.value) {
                text += `rule_${i}=open,,,,file,,${path},${allowed ? 'true' : 'false'}\n`; i++
                text += `rule_${i}=list,,,,file,,${path},${allowed ? 'true' : 'false'}\n`; i++
            }
        }
        return text
    }

    async function prepareActivation() {
        await saveProfile(loadedProfile.value)
        return buildPlasmaConfig()
    }

    return {
        configFiles, profiles, loadedProfile, urlItems, statusMessage,
        init, refreshProfiles, loadProfile, unloadProfile,
        saveProfile, deleteProfile, addUrl, removeUrl,
        buildPlasmaConfig, prepareActivation
    }
})
