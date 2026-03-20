<template>
    <div class="item-icon" :class="{ 'item-icon--photo': !!iconDataUrl }" :style="extraStyle || undefined">
        <img v-if="iconDataUrl" class="item-icon-img" :src="iconDataUrl" alt="" draggable="false" />
        <i v-else class="bi bi-box-seam" aria-hidden="true" />
    </div>
</template>

<script setup>
defineProps({
    iconDataUrl: { type: String, default: '' },
    extraStyle: { type: String, default: '' }
})
</script>
