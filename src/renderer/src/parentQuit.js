/**
 * Quit flow: require parent password when set; otherwise confirm once.
 * @param {(title: string, message: string, opts?: object) => Promise<string|null>} promptFn from useModal().prompt
 */
export async function quitWithParentPassword(promptFn) {
    const hasPw = await window.api.settings.isPasswordSet()
    if (!hasPw) {
        const ok = await window.api.system.showConfirm({
            title: 'Quit LiFE Parental Control',
            message: 'Quit the application?',
            okLabel: 'Quit',
            cancelLabel: 'Cancel'
        })
        if (ok) await window.api.system.quit()
        return
    }
    const pw = await promptFn(
        'Quit application',
        'Parent password',
        { inputType: 'password', ok: 'Quit', cancel: 'Cancel' }
    )
    if (!pw) return
    const matches = await window.api.settings.checkPassword(pw)
    if (!matches) {
        await window.api.system.showError({ title: 'LiFE Parental Control', message: 'Incorrect password.' })
        return
    }
    await window.api.system.quit()
}
