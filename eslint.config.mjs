import pluginVue from 'eslint-plugin-vue'
import js from '@eslint/js'

export default [
    js.configs.recommended,
    ...pluginVue.configs['flat/essential'],
    {
        rules: {
            'vue/multi-word-component-names': 'off',
            'indent': ['error', 4],
            'vue/html-indent': ['error', 4],
            'vue/script-indent': ['error', 4, { baseIndent: 0 }]
        }
    },
    {
        files: ['src/main/**/*.js', 'src/preload/**/*.js'],
        languageOptions: {
            globals: {
                __dirname: 'readonly',
                process: 'readonly'
            }
        }
    },
    {
        files: ['src/renderer/**/*.js', 'src/renderer/**/*.vue'],
        languageOptions: {
            globals: {
                window: 'readonly',
                CustomEvent: 'readonly',
                alert: 'readonly',
                confirm: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly'
            }
        }
    }
]
