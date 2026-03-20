import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHashHistory } from 'vue-router'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap-icons/font/bootstrap-icons.css'
import './css/app.scss'
import App from './App.vue'
import routes from './router/routes.js'

const router = createRouter({
    history: createWebHashHistory(),
    routes
})

createApp(App)
    .use(createPinia())
    .use(router)
    .mount('#app')
