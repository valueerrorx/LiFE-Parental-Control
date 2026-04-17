/* SPDX-License-Identifier: GPL-3.0-or-later; Copyright (c) 2026 Thomas Michael Weissel; Licensed under GPLv3+ (see http://www.gnu.org/licenses/). */
import { analyzeLockdownState, executeLockdown } from '../LockdownService.js'
import { patchDefaultJson, readDefaultJson } from '../defaultProfileStore.js'
import { appendActivity } from './activityLog.js'

export function registerLockdownIpc(ipcMain, configDir) {

    /** Check whether the wizard has already been completed. */
    ipcMain.handle('lockdown:isFinished', () => {
        try {
            const cfg = readDefaultJson(configDir)
            return cfg?.finishedLockdownWizard === true
        } catch {
            return false
        }
    })

    /** Analyse the current system state for the given target user. */
    ipcMain.handle('lockdown:analyze', async (_, targetUser) => {
        if (typeof targetUser !== 'string' || !targetUser.trim()) {
            return { ok: false, error: 'Invalid target user' }
        }
        try {
            const findings = await analyzeLockdownState(targetUser.trim())
            return { ok: true, findings }
        } catch (e) {
            return { ok: false, error: e.message || String(e) }
        }
    })

    /** Execute the lockdown script via pkexec and mark wizard complete on success. */
    ipcMain.handle('lockdown:execute', async (_, { targetUser, adminUser, adminPw, allowInstall, allowUpdate, protectGrub, restrictAppImages }) => {
        if (!targetUser || !adminUser || !adminPw) {
            return { ok: false, error: 'Missing required parameters' }
        }
        const result = await executeLockdown(targetUser, adminUser, adminPw, { allowInstall, allowUpdate, protectGrub, restrictAppImages })
        if (result.ok) {
            // Persist wizard-finished flag to config
            patchDefaultJson(configDir, (d) => {
                d.finishedLockdownWizard = true
                return d
            })
            appendActivity(configDir, {
                action: 'lockdown_wizard_completed',
                targetUser,
                adminUser,
            })
        }
        return result
    })

    /** Persist finishedLockdownWizard=true (wizard was shown once); idempotent — no duplicate activity if already true. */
    ipcMain.handle('lockdown:markFinished', (_, skipped = false) => {
        try {
            const cfg = readDefaultJson(configDir)
            if (cfg?.finishedLockdownWizard === true) return { ok: true }
        } catch {
            /* proceed to patch */
        }
        patchDefaultJson(configDir, (d) => {
            d.finishedLockdownWizard = true
            return d
        })
        appendActivity(configDir, { action: skipped ? 'lockdown_wizard_skipped' : 'lockdown_wizard_finished' })
        return { ok: true }
    })
}
