<template>
    <div class="overflow-auto" style="height:100%;">
        <div class="d-flex align-items-start gap-3 p-4 border-bottom" style="background:#F9FAFB;">
            <i class="bi flex-shrink-0 text-muted fs-1" :class="kdeIconToBootstrap(config.groupIcon)" />
            <p class="text-muted mb-0" style="font-size:13px;padding-top:4px;">{{ config.groupDescription }}</p>
        </div>
        <div>
            <label
                v-for="section in config.sections"
                :key="section.key"
                class="pc-list-item d-flex align-items-start gap-3"
                style="cursor:pointer;"
            >
                <input v-model="section.checked" type="checkbox" class="form-check-input mt-1 flex-shrink-0" />
                <div>
                    <div class="item-name">{{ section.name }}</div>
                    <div class="item-sub">{{ section.description }}</div>
                </div>
            </label>
        </div>
    </div>
</template>

<script setup>
defineProps({ config: { type: Object, required: true } })

const kdeIconMap = {
    kdeapp: 'bi-app-indicator', homerun: 'bi-grid-3x3-gap',
    'preferences-desktop-plasma': 'bi-gear', kolourpaint: 'bi-palette', plasmavault: 'bi-folder-lock'
}
const kdeIconToBootstrap = (name) => kdeIconMap[name] ?? 'bi-gear'
</script>
