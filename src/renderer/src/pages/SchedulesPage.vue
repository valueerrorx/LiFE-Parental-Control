<template>
    <div class="pc-page-header d-flex align-items-start justify-content-between">
        <div>
            <h1>Screen Time</h1>
            <p>Set daily limits and allowed usage hours via system cron</p>
        </div>
        <div class="d-flex gap-2 pt-1">
            <span class="status-badge" :class="schedule.enabled ? 'active' : 'inactive'">
                <i class="bi bi-circle-fill" style="font-size:7px;" />
                {{ schedule.enabled ? 'Active' : 'Disabled' }}
            </span>
            <button class="btn-pc-primary" @click="onSave" :disabled="saving">
                <i class="bi bi-floppy me-1" />{{ saving ? 'Saving…' : 'Save' }}
            </button>
        </div>
    </div>

    <div class="pc-content" v-if="schedule">
        <!-- Master toggle -->
        <div class="pc-card mb-3">
            <div class="pc-card-body d-flex align-items-center justify-content-between">
                <div>
                    <div class="fw-semibold">Enable Screen Time Controls</div>
                    <div class="text-muted" style="font-size:12px;">Activates time enforcement via a system cron job at <code>/etc/cron.d/life-parental</code></div>
                </div>
                <label class="pc-toggle">
                    <input type="checkbox" v-model="schedule.enabled" />
                    <span class="slider" />
                </label>
            </div>
        </div>

        <div class="pc-card mb-3">
            <div class="pc-card-header"><h6>Profile presets</h6></div>
            <div class="pc-card-body">
                <p class="text-muted mb-2" style="font-size:12px;">School / Leisure templates (Screen Time only). Adjust and click <strong>Save</strong>.</p>
                <div class="d-flex flex-wrap gap-2">
                    <button type="button" class="btn-pc-outline" @click="applyPreset('school')">
                        <i class="bi bi-mortarboard me-1" />School week
                    </button>
                    <button type="button" class="btn-pc-outline" @click="applyPreset('leisure')">
                        <i class="bi bi-brightness-high me-1" />Leisure
                    </button>
                </div>
            </div>
        </div>

        <div :class="{ 'opacity-50 pe-none': !schedule.enabled }">
            <!-- Daily time limit -->
            <div class="pc-card mb-3">
                <div class="pc-card-header">
                    <h6>Daily Time Limit</h6>
                    <label class="pc-toggle">
                        <input type="checkbox" v-model="schedule.dailyLimitEnabled" />
                        <span class="slider" />
                    </label>
                </div>
                <div class="pc-card-body" v-if="schedule.dailyLimitEnabled">
                    <div class="d-flex align-items-center gap-3 mb-3">
                        <label class="text-muted small" style="white-space:nowrap;">Max daily usage:</label>
                        <input v-model.number="schedule.dailyLimitMinutes" type="number" min="15" max="720" step="15"
                               class="pc-input" style="width:90px;" />
                        <span class="text-muted small">minutes</span>
                        <span class="text-muted small">({{ Math.floor(schedule.dailyLimitMinutes / 60) }}h {{ schedule.dailyLimitMinutes % 60 }}m)</span>
                    </div>
                    <!-- Today's usage progress -->
                    <div class="usage-bar-wrap">
                        <div class="d-flex justify-content-between mb-1">
                            <span class="text-muted small">Today's usage</span>
                            <span class="small fw-semibold" :style="usageColor">
                                {{ todayMinutes }}m / {{ schedule.dailyLimitMinutes }}m
                            </span>
                        </div>
                        <div class="usage-bar-track">
                            <div class="usage-bar-fill" :style="{ width: usagePercent + '%', background: usageBarColor }" />
                        </div>
                    </div>
                </div>
            </div>

            <!-- Allowed hours -->
            <div class="pc-card mb-3">
                <div class="pc-card-header">
                    <h6>Allowed Hours</h6>
                    <label class="pc-toggle">
                        <input type="checkbox" v-model="schedule.allowedHoursEnabled" />
                        <span class="slider" />
                    </label>
                </div>
                <div class="pc-card-body" v-if="schedule.allowedHoursEnabled">
                    <div class="d-flex align-items-center gap-3 mb-3">
                        <label class="text-muted small" style="white-space:nowrap;">From:</label>
                        <input v-model="schedule.allowedHoursStart" type="time" class="pc-input" style="width:130px;" />
                        <label class="text-muted small" style="white-space:nowrap;">To:</label>
                        <input v-model="schedule.allowedHoursEnd" type="time" class="pc-input" style="width:130px;" />
                    </div>
                    <div>
                        <label class="text-muted small d-block mb-2">Active on days:</label>
                        <div class="d-flex gap-2 flex-wrap">
                            <label v-for="(day, idx) in DAYS" :key="idx" class="day-pill">
                                <input type="checkbox" :value="idx + 1" v-model="schedule.allowedDays" />
                                <span>{{ day }}</span>
                            </label>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <p v-if="saveMsg" class="mt-2" :class="saveError ? 'text-danger' : 'text-success'">
            <i class="bi me-1" :class="saveError ? 'bi-exclamation-circle' : 'bi-check-circle'" />
            {{ saveMsg }}
        </p>
    </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const schedule = reactive({
    enabled: false, dailyLimitEnabled: false, dailyLimitMinutes: 120,
    allowedHoursEnabled: false, allowedHoursStart: '07:00', allowedHoursEnd: '22:00',
    allowedDays: [1, 2, 3, 4, 5, 6, 7]
})
const saving    = ref(false)
const saveMsg   = ref('')
const saveError = ref(false)
const todayMinutes = ref(0)

const usagePercent  = computed(() => Math.min(100, Math.round((todayMinutes.value / (schedule.dailyLimitMinutes || 120)) * 100)))
const usageBarColor = computed(() => usagePercent.value >= 100 ? '#C62828' : usagePercent.value >= 80 ? '#E65100' : '#1565C0')
const usageColor    = computed(() => ({ color: usageBarColor.value }))

onMounted(async () => {
    const [saved, usage] = await Promise.all([window.api.schedules.get(), window.api.schedules.getUsage()])
    if (saved) Object.assign(schedule, saved)
    if (usage) todayMinutes.value = usage.minutes ?? 0
})

function applyPreset(kind) {
    if (kind === 'school') {
        Object.assign(schedule, {
            enabled: true,
            dailyLimitEnabled: true,
            dailyLimitMinutes: 90,
            allowedHoursEnabled: true,
            allowedHoursStart: '16:00',
            allowedHoursEnd: '20:00',
            allowedDays: [1, 2, 3, 4, 5]
        })
    } else if (kind === 'leisure') {
        Object.assign(schedule, {
            enabled: true,
            dailyLimitEnabled: true,
            dailyLimitMinutes: 180,
            allowedHoursEnabled: true,
            allowedHoursStart: '09:00',
            allowedHoursEnd: '21:00',
            allowedDays: [1, 2, 3, 4, 5, 6, 7]
        })
    }
    saveMsg.value = 'Preset applied — click Save to apply on the system'
    saveError.value = false
    setTimeout(() => { saveMsg.value = '' }, 5000)
}

async function onSave() {
    saving.value = true
    const result = await window.api.schedules.save({ ...schedule })
    saving.value = false
    if (result?.error) { saveMsg.value = `Error: ${result.error}`; saveError.value = true }
    else { saveMsg.value = 'Screen time settings saved'; saveError.value = false }
    setTimeout(() => { saveMsg.value = '' }, 4000)
}
</script>

<style scoped>
.usage-bar-wrap {
    padding-top: 4px;
}
.usage-bar-track {
    height: 8px;
    background: #E0E0E0;
    border-radius: 4px;
    overflow: hidden;
}
.usage-bar-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.3s, background 0.3s;
}

.day-pill {
    display: inline-flex;
    align-items: center;
    cursor: pointer;

    input { display: none; }
    span {
        display: inline-block;
        padding: 5px 14px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: 600;
        border: 1px solid #E0E0E0;
        color: #616161;
        background: #fff;
        transition: all 0.15s;
        user-select: none;
    }
    input:checked ~ span {
        background: var(--pc-primary);
        color: #fff;
        border-color: var(--pc-primary);
    }
}
</style>
