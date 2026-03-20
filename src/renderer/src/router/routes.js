const routes = [
    {
        path: '/',
        component: () => import('../layouts/MainLayout.vue'),
        children: [
            { path: '', component: () => import('../pages/DashboardPage.vue') },
            { path: 'webfilter', component: () => import('../pages/WebFilterPage.vue') },
            { path: 'apps', component: () => import('../pages/AppControlPage.vue') },
            { path: 'schedules', component: () => import('../pages/SchedulesPage.vue') },
            { path: 'process-whitelist', component: () => import('../pages/ProcessWhitelistPage.vue') },
            { path: 'kiosk', component: () => import('../pages/KioskPage.vue') },
            { path: 'settings', component: () => import('../pages/SettingsPage.vue') }
        ]
    }
]

export default routes
