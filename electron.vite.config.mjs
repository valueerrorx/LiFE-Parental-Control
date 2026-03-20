import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
    main: {
        build: {
            rollupOptions: {
                input: {
                    index: resolve('src/main/index.js'),
                    trayHelperMain: resolve('src/main/trayHelperMain.js')
                },
                output: {
                    entryFileNames: '[name].js'
                }
            }
        },
        resolve: {
            alias: {
                '@shared': resolve('src/shared')
            }
        },
        plugins: [externalizeDepsPlugin()]
    },
    preload: {
        plugins: [externalizeDepsPlugin()]
    },
    renderer: {
        plugins: [vue()],
        resolve: {
            alias: {
                '@shared': resolve('src/shared'),
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
