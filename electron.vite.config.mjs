import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
    // src/main/index.js and src/preload/index.js are auto-detected by electron-vite
    main: {
        plugins: [externalizeDepsPlugin()]
    },
    preload: {
        plugins: [externalizeDepsPlugin()]
    },
    renderer: {
        plugins: [vue()],
        resolve: {
            alias: {
                '@': resolve('src/renderer/src'),
                composables: resolve('src/renderer/src/composables'),
                components: resolve('src/renderer/src/components'),
                stores: resolve('src/renderer/src/stores'),
                pages: resolve('src/renderer/src/pages'),
                layouts: resolve('src/renderer/src/layouts')
            }
        }
    }
})
