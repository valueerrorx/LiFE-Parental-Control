<template>
    <Teleport to="body">
        <div v-if="state.visible" class="pc-modal-overlay" @mousedown.self="_cancel">
            <div class="pc-modal" :class="{ 'pc-modal-wide': state.wide }">
                <div class="pc-modal-header">
                    <span class="fw-semibold">{{ state.title }}</span>
                    <button class="pc-modal-close" @click="_cancel">
                        <i class="bi bi-x-lg" />
                    </button>
                </div>
                <div class="pc-modal-body">
                    <div v-if="state.htmlContent" v-html="state.htmlContent" />
                    <template v-else>{{ state.message }}</template>
                    <div v-if="state.hasInput" class="mt-3">
                        <label class="form-label small text-muted">{{ state.inputLabel }}</label>
                        <input
                            ref="inputEl"
                            v-model="state.inputValue"
                            :type="state.inputType"
                            class="pc-input"
                            @keyup.enter="_ok"
                        />
                    </div>
                </div>
                <div class="pc-modal-footer">
                    <button v-if="!state.hideCancel" type="button" class="btn-pc-outline" @click="_cancel">{{ state.cancelLabel }}</button>
                    <button type="button" class="btn-pc-primary" @click="_ok">{{ state.okLabel }}</button>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'
import { useModal } from '../composables/useModal.js'

const { state, _ok, _cancel } = useModal()
const inputEl = ref(null)

watch(() => state.visible, async (v) => {
    if (v && state.hasInput) { await nextTick(); inputEl.value?.focus() }
})
</script>

<style scoped>
.pc-modal-overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.45);
    display: flex; align-items: center; justify-content: center;
    z-index: 9999;
}
.pc-modal {
    background: #fff;
    border-radius: 10px;
    width: 460px;
    max-width: 92vw;
    box-shadow: 0 12px 40px rgba(0,0,0,0.2);
    overflow: hidden;
}
.pc-modal-wide {
    width: 620px;
}
.pc-modal-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid #E0E0E0;
    font-size: 15px;
}
.pc-modal-close {
    background: none; border: none; cursor: pointer; color: #757575; padding: 2px 6px;
    &:hover { color: #212121; }
}
.pc-modal-body {
    padding: 20px;
    font-size: 13.5px;
    line-height: 1.6;
    max-height: 60vh;
    overflow-y: auto;
}
.pc-modal-footer {
    display: flex; gap: 10px; justify-content: flex-end;
    padding: 14px 20px;
    border-top: 1px solid #E0E0E0;
}
</style>
