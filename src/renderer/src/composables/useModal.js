import { reactive } from 'vue'

const state = reactive({
    visible: false,
    title: '',
    message: '',
    htmlContent: '',
    hasInput: false,
    inputType: 'text',
    inputLabel: '',
    inputValue: '',
    okLabel: 'OK',
    cancelLabel: 'Cancel',
    hideCancel: false,
    wide: false,
    _resolve: null
})

function _open(opts) {
    return new Promise(resolve => {
        Object.assign(state, {
            visible: true,
            title: opts.title ?? '',
            message: opts.message ?? '',
            htmlContent: opts.html ?? '',
            hasInput: opts.hasInput ?? false,
            inputType: opts.inputType ?? 'text',
            inputLabel: opts.inputLabel ?? '',
            inputValue: '',
            okLabel: opts.ok ?? 'OK',
            cancelLabel: opts.cancel ?? 'Cancel',
            hideCancel: opts.hideCancel ?? false,
            wide: opts.wide ?? false,
            _resolve: resolve
        })
    })
}

export function useModal() {
    function confirm(title, message, { html = '', ok = 'Yes', cancel = 'No' } = {}) {
        return _open({ title, message, html, ok, cancel })
    }

    function prompt(title, inputLabel, { inputType = 'text', ok = 'OK', cancel = 'Cancel' } = {}) {
        return _open({ title, hasInput: true, inputLabel, inputType, ok, cancel })
    }

    function inform(title, html, { ok = 'Close', wide = false } = {}) {
        return _open({ title, html, ok, cancel: 'Cancel', hideCancel: true, wide })
    }

    function _ok() {
        const result = state.hasInput ? (state.inputValue.trim() || null) : true
        state.visible = false
        state._resolve(result)
    }

    function _cancel() {
        state.visible = false
        state._resolve(state.hasInput ? null : false)
    }

    return { state, confirm, prompt, inform, _ok, _cancel }
}
