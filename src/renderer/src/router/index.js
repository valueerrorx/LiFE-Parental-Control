import { createRouter, createWebHashHistory } from 'vue-router'
import routes from './routes.js'

export default createRouter({
    history: createWebHashHistory(),
    routes
})
