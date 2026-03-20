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
import AppSidebar from '../components/AppSidebar.vue'
import AppModal from '../components/AppModal.vue'
</script>
