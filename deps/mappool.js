window.FLT5Pool = (() => {
    const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    const entry = value => typeof value === 'string' ? {slot: value} : value && typeof value === 'object' ? {...value} : {}

    function find(pools, name) {
        const requested = normalize(name).replace(/ /g, '')
        const key = Object.keys(pools).find(key => normalize(key).replace(/ /g, '') === requested)
        return pools[key] || {round: '', slots: [], maps: {}, custom: {}}
    }

    function resolve(pool, beatmap) {
        const id = String(beatmap.id ?? beatmap.mapid ?? '')
        const difficulty = normalize(beatmap.version || beatmap.difficulty)
        const title = normalize(beatmap.title)
        const contains = (value, keyword) => {
            const fragment = normalize(keyword)
            return fragment && ` ${value} `.includes(` ${fragment} `)
        }
        if (pool.maps?.[id]) return entry(pool.maps[id])
        for (const value of Object.values(pool.maps || {})) {
            const candidate = entry(value)
            if (candidate.keywords?.some(keyword => contains(candidate.matchField === 'difficulty' ? difficulty : `${title} ${difficulty}`, keyword))) return candidate
        }
        for (const [fragment, value] of Object.entries(pool.custom || {})) {
            if (contains(title, fragment) || contains(difficulty, fragment)) return entry(value)
        }
        return {}
    }

    function createBadge(element) {
        let type = ''
        let request = 0
        let animation
        return async value => {
            const nextType = ['edit', 'custom'].includes(value) ? value : ''
            if (nextType === type) return
            type = nextType
            const current = ++request
            animation?.cancel()
            const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
            if (!element.hidden && !reduced) {
                animation = element.animate([
                    {transform: 'perspective(450px) rotate(-4deg) rotateY(0)', opacity: 1},
                    {transform: 'perspective(450px) translate(14px, -12px) rotate(-13deg) rotateY(-65deg)', opacity: 0}
                ], {duration: 170, easing: 'cubic-bezier(.16, 1, .3, 1)', fill: 'forwards'})
                try { await animation.finished } catch {}
                if (current !== request) return
            }
            element.hidden = !nextType
            animation?.cancel()
            if (!nextType) return
            element.dataset.type = nextType
            element.querySelector('span').textContent = nextType.toUpperCase()
            if (reduced) return
            animation = element.animate([
                {transform: 'perspective(450px) translate(14px, -10px) rotate(9deg) rotateY(-50deg) scale(.94)', opacity: 0},
                {transform: 'perspective(450px) rotate(-4deg) rotateY(0) scale(1)', opacity: 1}
            ], {duration: 280, easing: 'cubic-bezier(.16, 1, .3, 1)'})
        }
    }

    return {find, resolve, createBadge}
})()
