window.FLT5Tournament = (() => {
    const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const playerKey = player => String(player.id || player.name || '').toLowerCase()
    let config

    async function load() {
        if (!config) {
            const response = await fetch('../rounds.json', {cache: 'no-store'})
            if (!response.ok) throw new Error(String(response.status))
            config = await response.json()
        }
        return config
    }

    function select(params, fallback = config.default) {
        const requested = params.get('stage') || params.get('round') || (params.get('pool') === 'finals' ? 'finals' : fallback)
        const key = Object.keys(config.rounds).find(key => normalize(key) === normalize(requested))
            || Object.keys(config.rounds).find(key => normalize(config.rounds[key].pool) === normalize(requested))
            || fallback
        return {key, ...config.rounds[key]}
    }

    function createState(round, params) {
        const preview = params.get('preview') === '1'
        const prefix = `flt5-${round.key}${preview ? '-preview' : ''}`
        const forced = params.get('lobby')
        const lobbyKey = value => {
            const known = round.lobbies.find(lobby => normalize(lobby.label) === normalize(value) || String(lobby.id) === String(value))
            return known ? String(known.id) : normalize(value)
        }
        let lobby = forced ? lobbyKey(forced) : localStorage.getItem(`${prefix}-active-lobby`) || ''

        function key(kind) {
            if (round.key === 'finals' && !preview && ['lives', 'last-deduction'].includes(kind)) return `flt5-gameplay-${kind}`
            return `${prefix}-${kind}:${lobby || 'pending'}`
        }

        function read(kind, fallback) {
            try {
                return JSON.parse(localStorage.getItem(key(kind)) || 'null') ?? fallback
            } catch {
                return fallback
            }
        }

        function write(kind, value) {
            const serialized = JSON.stringify(value)
            if (localStorage.getItem(key(kind)) !== serialized) localStorage.setItem(key(kind), serialized)
        }

        function usePlayers(players) {
            if (forced) return false
            const candidates = round.lobbies.map(entry => ({
                entry,
                count: players.filter(player => entry.players.some(known => player.id && Number(known.id) === Number(player.id) || normalize(known.name) === normalize(player.name))).length
            })).sort((a, b) => b.count - a.count)
            if (!candidates[0]?.count) return false
            const next = String(candidates[0].entry.id)
            if (next === lobby) return false
            lobby = next
            localStorage.setItem(`${prefix}-active-lobby`, lobby)
            return true
        }

        function winners() {
            const saved = read('winners', [])
            return Array.isArray(saved) && saved.length === round.winners ? saved : []
        }

        function capture(players, lives) {
            const saved = winners()
            if (saved.length) return saved
            const unique = [...new Map(players.filter(player => player.name).map(player => [playerKey(player), player])).values()]
            if (unique.length > round.winners) write('started', true)
            const remaining = unique.filter(player => {
                const state = lives[playerKey(player)]
                return !Array.isArray(state) || state.some(Boolean)
            })
            if (remaining.length !== round.winners) return []
            if (!read('started', false) && !Object.values(lives).some(state => Array.isArray(state) && !state.some(Boolean))) return []
            const result = remaining.map(player => ({id: Number(player.id || 0), name: player.name}))
            write('winners', result)
            return result
        }

        function reset() {
            for (const kind of ['lives', 'eliminated', 'winners', 'last-deduction', 'started']) localStorage.removeItem(key(kind))
            write('reset', Date.now())
        }

        return {key, read, write, usePlayers, winners, capture, reset}
    }

    return {load, select, createState, playerKey}
})()
