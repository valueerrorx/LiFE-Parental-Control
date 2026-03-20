// Shared: static domain presets (hand-curated) + HaGeZi-backed quick-add categories (see webFilterHagezi.js)

export const WEB_FILTER_STATIC_CATEGORIES = {
    'Video Streaming': ['youtube.com', 'www.youtube.com', 'twitch.tv', 'www.twitch.tv',
        'netflix.com', 'www.netflix.com', 'primevideo.com', 'www.primevideo.com'],
    Gaming: ['store.steampowered.com', 'epicgames.com', 'www.epicgames.com',
        'roblox.com', 'www.roblox.com', 'minecraft.net', 'www.minecraft.net']
}

// Quick-add label → HaGeZi feed id (bundled + optional online update)
export const CATEGORY_TO_HAGEZI_FEED = {
    'Social Media': 'social',
    'Adult Content': 'nsfw',
    'Fake & Scams': 'fake',
    Gambling: 'gambling',
    'Pop-up Ads': 'popupads',
    'Anti-Piracy': 'anti_piracy'
}

export const WEB_FILTER_QUICK_ADD_ORDER = [
    'Social Media',
    'Video Streaming',
    'Gaming',
    'Adult Content',
    'Fake & Scams',
    'Gambling',
    'Pop-up Ads',
    'Anti-Piracy'
]

const _known = new Set([
    ...Object.keys(WEB_FILTER_STATIC_CATEGORIES),
    ...Object.keys(CATEGORY_TO_HAGEZI_FEED)
])

export function isKnownWebFilterCategory(name) {
    return _known.has(name)
}
