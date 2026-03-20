<template>
    <div class="pc-layout">
        <AppSidebar />
        <main class="pc-main">
            <router-view />
        </main>
    </div>
    <AppModal />
</template>

<script setup>
import { onMounted } from 'vue'
import AppSidebar from '../components/AppSidebar.vue'
import AppModal from '../components/AppModal.vue'
import { useAppStore } from '../stores/appStore.js'

const store = useAppStore()

onMounted(() => {
    void store.refreshProtectionsState()
})
</script>
