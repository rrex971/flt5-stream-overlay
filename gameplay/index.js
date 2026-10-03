const params = new URLSearchParams(location.search)
const previewMode = params.get('preview') === '1'
const previewPlayerCount = Math.min(10, Math.max(1, Number(params.get('players')) || 8))
const clientLayout = Number(params.get('clients')) === 10 ? 10 : 8
let poolName = params.get('pool') || 'grand-finals'
const twitchChannel = (params.get('channel') || 'raybean_osu').toLowerCase().replace(/^#/, '')
const overlay = document.getElementById('overlay')
const leaderboardPanel = document.querySelector('.leaderboard-panel')
const leaderboard = document.getElementById('leaderboard')
const ingameChat = document.getElementById('ingame-chat')
const ingameEmpty = document.getElementById('ingame-empty')
const twitchChat = document.getElementById('twitch-chat')
const twitchEmpty = document.getElementById('twitch-empty')
const mapSlot = document.getElementById('map-slot')
const mapArtist = document.getElementById('map-artist')
const mapTitle = document.getElementById('map-title')
const mapTitleTrack = mapTitle.querySelector('.map-title-track')
const mapTitleCopies = [...mapTitleTrack.querySelectorAll('span')]
const mapDifficulty = document.getElementById('map-difficulty')
const mapMapper = document.getElementById('map-mapper')
const coverCurrent = document.getElementById('cover-current')
const coverLayers = [...document.querySelectorAll('.cover-layer')]
const mapCopy = document.querySelector('.map-copy')
const setMapBadge = FLT5Pool.createBadge(document.getElementById('map-badge'))
const numberNodes = {
    sr: document.getElementById('map-sr'),
    bpm: document.getElementById('map-bpm'),
    cs: document.getElementById('map-cs'),
    ar: document.getElementById('map-ar'),
    od: document.getElementById('map-od')
}
const mapLength = document.getElementById('map-length')
const clientSlots = [...document.querySelectorAll('.client-slot')]

overlay.classList.toggle('layout-10', clientLayout === 10)

let mappools = {}
let tournamentRound
let tournamentState
let players = new Map()
let lobbyPlayers = []
let lives = loadLives()
let currentBeatmapId = 0
let currentCover = ''
let pendingCover = ''
let coverRequest = 0
let activeCover = 0
let mapCopySignature = ''
let mapCopyRequest = 0
let roundState = null
let gameplayActive = false
let lastChatSignature = ''
let lastChatMessages = []
let previewTimer = null
let websocket = null
let twitchSocket = null

function fitOverlay() {
    const scale = Math.min(innerWidth / 1920, innerHeight / 1080)
    overlay.style.setProperty('--overlay-scale', scale)
    syncClientCutouts()
}

function syncClientCutouts() {
    const cutouts = document.getElementById('client-cutouts')
    const visibleSlots = clientSlots.filter(slot => getComputedStyle(slot).display !== 'none')
    const activeKeys = new Set(visibleSlots.map(slot => slot.dataset.client))
    cutouts.querySelectorAll('.client-cutout').forEach(path => {
        if (!activeKeys.has(path.dataset.client)) path.remove()
    })
    visibleSlots.forEach(slot => {
        const style = getComputedStyle(slot)
        const x = slot.offsetLeft
        const y = slot.offsetTop
        const width = slot.offsetWidth
        const height = slot.offsetHeight
        const tl = parseFloat(style.borderTopLeftRadius)
        const tr = parseFloat(style.borderTopRightRadius)
        const br = parseFloat(style.borderBottomRightRadius)
        const bl = parseFloat(style.borderBottomLeftRadius)
        syncClientStatus(slot, style)
        let path = cutouts.querySelector(`[data-client="${CSS.escape(slot.dataset.client)}"]`)
        if (!path) {
            path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
            path.classList.add('client-cutout')
            path.dataset.client = slot.dataset.client
            path.setAttribute('fill', 'black')
            cutouts.append(path)
        }
        path.setAttribute('fill', 'black')
        path.setAttribute('d', `M${x + tl} ${y}H${x + width - tr}A${tr} ${tr} 0 0 1 ${x + width} ${y + tr}V${y + height - br}A${br} ${br} 0 0 1 ${x + width - br} ${y + height}H${x + bl}A${bl} ${bl} 0 0 1 ${x} ${y + height - bl}V${y + tl}A${tl} ${tl} 0 0 1 ${x + tl} ${y}Z`)
        path.style.opacity = slot.classList.contains('empty') ? '0' : '1'
    })
}

function syncClientStatus(slot, style = getComputedStyle(slot)) {
    const status = slot.querySelector('.client-status')
    if (!status) return
    const width = slot.offsetWidth
    const right = parseFloat(style.borderBottomRightRadius)
    const left = parseFloat(style.borderBottomLeftRadius)
    const inset = Math.max(left, right)
    const path = depth => `path('M0 ${inset - left}V${inset + depth - left}A${left} ${left} 0 0 0 ${left} ${inset + depth}H${width - right}A${right} ${right} 0 0 0 ${width} ${inset + depth - right}V${inset - right}A${right} ${right} 0 0 1 ${width - right} ${inset}H${left}A${left} ${left} 0 0 1 0 ${inset - left}Z')`
    status.style.setProperty('--status-inset', `${inset}px`)
    status.style.setProperty('--status-closed', path(0))
    status.style.setProperty('--status-open', path(22))
}

function loadLives() {
    return tournamentState?.read('lives', {}) || {}
}

function loadEliminated() {
    const saved = tournamentState.read('eliminated', [])
    return new Map((Array.isArray(saved) ? saved : []).map(player => [playerKey(player), player]))
}

function resetLobby() {
    tournamentState.reset()
    lives = {}
    players = new Map()
    roundState = null
    renderLeaderboard(lobbyPlayers)
}

function saveLives() {
    tournamentState.write('lives', lives)
    if (tournamentRound.key === 'grand-finals-1' && !previewMode) tournamentState.capture(lobbyPlayers, lives)
}

function playerKey(player) {
    return String(player.id || player.name || '').toLowerCase()
}

function ensureLives(player) {
    const key = playerKey(player)
    if (!Array.isArray(lives[key]) || lives[key].length !== 2) lives[key] = [true, true]
    return lives[key]
}

function activeLives(player) {
    return ensureLives(player).filter(Boolean).length
}

function toggleHeart(player, index) {
    const state = ensureLives(player)
    if (state[index]) {
        for (let i = index; i < state.length; i += 1) state[i] = false
    } else {
        for (let i = 0; i <= index; i += 1) state[i] = true
    }
    saveLives()
    renderLeaderboard(lobbyPlayers)
}

function deductLife(player) {
    const state = ensureLives(player)
    for (let i = state.length - 1; i >= 0; i -= 1) {
        if (!state[i]) continue
        state[i] = false
        saveLives()
        return true
    }
    return false
}

function scoreValue(player) {
    const mods = String(player.mods || '').toUpperCase()
    return Math.round(Number(player.score || 0) * (mods.includes('EZ') ? 1.75 : 1))
}

function formatScore(value) {
    return Math.round(Number(value) || 0).toLocaleString('en-US')
}

function scoreGrade(rank) {
    const value = String(rank?.current ?? (typeof rank === 'string' ? rank : '')).trim().toUpperCase()
    if (value === 'X') return 'SS'
    if (value === 'XH') return 'SSH'
    return /^(SSH|SS|SH|S|A|B|C|D|F)$/.test(value) ? value : ''
}

function playerFromClient(client, index) {
    const user = client.user || client.spectating?.user || {}
    const play = client.play || client.gameplay || {}
    const mods = play.mods?.name || play.mods?.str || play.mods || ''
    return {
        id: Number(user.id || client.spectating?.userID || 0),
        name: user.name || play.playerName || play.name || '',
        score: Number(play.score || 0),
        accuracy: Number(play.accuracy ?? play.acc ?? 0),
        grade: scoreGrade(play.rank),
        misses: Number(play.hits?.['0'] ?? play.hits?.miss ?? play.hits?.misses ?? 0),
        mods: Array.isArray(mods) ? mods.join('') : String(mods || '')
    }
}

function renderClientSlots(clients) {
    clientSlots.forEach((slot, index) => {
        const player = clients[index] ? playerFromClient(clients[index], index) : null
        const name = player?.name || ''
        slot.dataset.player = name ? playerKey(player) : ''
        slot.classList.toggle('empty', !name)
        const label = slot.querySelector('span')
        label.textContent = name
        label.dataset.name = name
        let misses = slot.querySelector('.client-misses')
        if (!misses) {
            misses = document.createElement('div')
            misses.className = 'client-misses'
            slot.append(misses)
        }
        const missCount = player?.misses || 0
        if (!misses.counter) {
            misses.counter = new CountUp(misses, 0, missCount, 0, .2, {useEasing: true, useGrouping: false, suffix: 'x'})
            misses.counter.start()
        } else {
            misses.counter.update(missCount)
        }
        misses.classList.toggle('visible', Boolean(name && missCount > 0))
        if (!slot.querySelector('.client-status')) {
            const status = document.createElement('div')
            status.className = 'client-status'
            status.setAttribute('aria-hidden', 'true')
            status.innerHTML = '<b><i></i><em></em><i></i></b>'
            slot.append(status)
            syncClientStatus(slot)
        }
    })
    syncClientCutouts()
    updateClientHighlights()
}

function isGameplayOngoing(data) {
    const ipcState = data.tourney?.ipcState ?? data.tourney?.manager?.ipcState
    if (ipcState !== undefined && ipcState !== null) return Number(ipcState) === 3
    const state = data.state?.number ?? data.menu?.state
    return Number(state) === 2
}

function setGameplayActive(active) {
    gameplayActive = active
    overlay.classList.toggle('is-playing', active)
}

function updateClientHighlights() {
    const connected = new Set(lobbyPlayers.map(playerKey))
    const eligible = [...players.values()].filter(player => connected.has(playerKey(player)) && activeLives(player) > 0)
    const show = gameplayActive && eligible.length > 1 && eligible.some(player => scoreValue(player) > 0)
    const leader = show ? playerKey(eligible[0]) : ''
    const risk = show ? playerKey(eligible[eligible.length - 1]) : ''
    clientSlots.forEach(slot => {
        const key = slot.dataset.player
        const role = key && key === leader ? 'leader' : key && key === risk ? 'risk' : ''
        const status = slot.querySelector('.client-status b')
        slot.classList.toggle('leader', role === 'leader')
        slot.classList.toggle('at-risk', role === 'risk')
        if (role && status) {
            status.querySelector('em').textContent = role === 'leader' ? 'LEADER' : 'AT RISK'
            status.querySelectorAll('i').forEach(icon => {
                icon.textContent = role === 'leader' ? '★' : '⚠'
            })
        }
    })
}

function createPlayerRow(player) {
    const key = playerKey(player)
    const row = document.createElement('div')
    row.className = 'player-row'
    row.dataset.key = key
    row.innerHTML = `<img class="avatar" alt=""><div class="panel-sticker player-grade" hidden><span></span></div><div class="player-copy"><div class="player-head"><div class="player-name"></div><div class="player-accuracy"></div></div><div class="player-bottom"><div class="player-score"></div><div class="hearts"></div></div></div>`
    row.querySelector('.avatar').addEventListener('error', event => {
        event.currentTarget.style.opacity = '.24'
    })
    return row
}

function renderScoreGaps(sorted, rowHeight, rowGap) {
    const count = Math.max(0, sorted.length - 1)
    leaderboard.querySelectorAll('.score-gap').forEach((gap, index) => {
        if (index >= count) gap.remove()
    })
    for (let index = 0; index < count; index += 1) {
        let gap = leaderboard.querySelector(`.score-gap[data-gap="${index}"]`)
        if (!gap) {
            gap = document.createElement('div')
            gap.className = 'score-gap'
            gap.dataset.gap = String(index)
            gap.innerHTML = '<span>▲</span><strong></strong>'
            leaderboard.append(gap)
        }
        const retained = sorted[index].retained || sorted[index + 1].retained
        gap.style.display = retained ? 'none' : ''
        if (retained) continue
        const value = Math.abs(scoreValue(sorted[index]) - scoreValue(sorted[index + 1]))
        gap.style.setProperty('--gap-y', `${(index + 1) * (rowHeight + rowGap) - rowGap / 2}px`)
        const valueNode = gap.querySelector('strong')
        if (!gap.counter) {
            gap.counter = new CountUp(valueNode, 0, value, 0, .2, {useEasing: true, useGrouping: true, separator: ','})
            gap.counter.start()
        } else {
            gap.counter.update(value)
        }
    }
}

function renderHearts(row, player, lifeState) {
    const hearts = row.querySelector('.hearts')
    while (hearts.children.length < lifeState.length) {
        const heart = document.createElement('button')
        const heartIndex = hearts.children.length
        heart.type = 'button'
        heart.className = 'heart'
        heart.textContent = '❤'
        heart.addEventListener('click', () => {
            const current = players.get(row.dataset.key)
            if (current) toggleHeart(current, heartIndex)
        })
        hearts.append(heart)
    }
    while (hearts.children.length > lifeState.length) hearts.lastElementChild.remove()
    ;[...hearts.children].forEach((heart, heartIndex) => {
        heart.classList.toggle('off', !lifeState[heartIndex])
        heart.setAttribute('aria-label', `${player.name} life ${heartIndex + 1}`)
    })
}

function renderLeaderboard(nextPlayers) {
    const validPlayers = nextPlayers.filter(player => player.name).slice(0, 10)
    if (tournamentState.usePlayers(validPlayers)) {
        players = loadEliminated()
        lives = loadLives()
        roundState = null
    }
    lobbyPlayers = validPlayers
    const connectedKeys = new Set(validPlayers.map(playerKey))
    validPlayers.forEach(player => {
        const key = playerKey(player)
        if (!players.has(key) || activeLives(player) > 0) players.set(key, {...player})
    })
    const sorted = [...players.values()]
        .filter(player => connectedKeys.has(playerKey(player)) || activeLives(player) === 0)
        .map(player => ({...player, retained: !connectedKeys.has(playerKey(player))}))
        .sort((a, b) => Number(activeLives(a) === 0) - Number(activeLives(b) === 0) || scoreValue(b) - scoreValue(a) || a.name.localeCompare(b.name))
    const expanded = sorted.length > 8
    const rowGap = 5
    const standingsHeight = expanded ? 864 : 675
    const rowHeight = expanded ? (standingsHeight - rowGap * (sorted.length - 1)) / sorted.length : 80
    const rowStep = rowHeight + rowGap
    leaderboardPanel.classList.toggle('expanded', expanded)
    players = new Map(sorted.map(player => [playerKey(player), player]))
    const liveKeys = new Set(sorted.map(playerKey))
    leaderboard.querySelectorAll('.player-row').forEach(row => {
        if (!liveKeys.has(row.dataset.key)) row.remove()
    })
    sorted.forEach((player, index) => {
        const key = playerKey(player)
        let row = leaderboard.querySelector(`[data-key="${CSS.escape(key)}"]`)
        if (!row) {
            row = createPlayerRow(player)
            leaderboard.append(row)
        }
        const lifeState = ensureLives(player)
        row.style.setProperty('--row-y', `${index * rowStep}px`)
        row.style.setProperty('--row-height', `${rowHeight}px`)
        row.dataset.rank = String(index + 1)
        row.classList.toggle('last-place', activeLives(player) > 0 && !sorted.slice(index + 1).some(next => activeLives(next) > 0))
        row.classList.toggle('eliminated', !lifeState.some(Boolean))
        const avatar = row.querySelector('.avatar')
        const avatarUrl = player.id ? `https://a.ppy.sh/${player.id}` : ''
        if (avatar.dataset.src !== avatarUrl) {
            avatar.dataset.src = avatarUrl
            avatar.src = avatarUrl
            avatar.style.opacity = ''
        }
        row.querySelector('.player-name').textContent = player.name
        const grade = player.retained ? '' : scoreGrade(player.grade)
        const gradeSticker = row.querySelector('.player-grade')
        gradeSticker.hidden = !grade
        gradeSticker.dataset.grade = grade
        gradeSticker.querySelector('span').textContent = grade
        gradeSticker.setAttribute('aria-label', `${player.name} score grade ${grade}`)
        const accuracy = Math.max(0, Math.min(100, Number(player.accuracy) || 0))
        if (player.retained) {
            if (row.accuracyCounter) row.accuracyCounter.reset()
            row.accuracyCounter = null
            row.querySelector('.player-accuracy').textContent = 'N/A'
        } else if (!row.accuracyCounter) {
            row.accuracyCounter = new CountUp(row.querySelector('.player-accuracy'), 0, accuracy, 2, .28, {useEasing: true, useGrouping: false, suffix: '%'})
            row.accuracyCounter.start()
        } else {
            row.accuracyCounter.update(accuracy)
        }
        const score = scoreValue(player)
        const scoreNode = row.querySelector('.player-score')
        if (player.retained) {
            if (row.scoreCounter) row.scoreCounter.reset()
            row.scoreCounter = null
            scoreNode.textContent = 'N/A'
        } else if (!row.scoreCounter) {
            row.scoreCounter = new CountUp(scoreNode, 0, score, 0, .28, {useEasing: true, useGrouping: true, separator: ','})
            row.scoreCounter.start()
        } else {
            row.scoreCounter.update(score)
        }
        renderHearts(row, player, lifeState)
    })
    renderScoreGaps(sorted, rowHeight, rowGap)
    updateClientHighlights()
    tournamentState.write('eliminated', sorted.filter(player => activeLives(player) === 0).map(({retained, ...player}) => player))
    if (tournamentRound.key === 'grand-finals-1' && !previewMode) tournamentState.capture(validPlayers, lives)
}

function handleRound(playersNow, beatmapId, pointTotal, playing) {
    const snapshot = playersNow.map(player => ({...player}))
    if (!roundState) {
        roundState = {beatmapId, pointTotal, active: playing && snapshot.some(player => player.score > 0), resolved: false, snapshot}
        return
    }
    const pointChanged = Number.isFinite(pointTotal) && Number.isFinite(roundState.pointTotal) && pointTotal !== roundState.pointTotal
    if (pointChanged) {
        if (roundState.active && !roundState.resolved) resolveLastPlace(roundState)
        roundState = {beatmapId, pointTotal, active: false, resolved: false, snapshot}
        return
    }
    const beatmapChanged = beatmapId && roundState.beatmapId && beatmapId !== roundState.beatmapId
    if (beatmapChanged) {
        roundState = {beatmapId, pointTotal, active: playing && snapshot.some(player => player.score > 0), resolved: false, snapshot}
        return
    }
    if (playing && snapshot.some(player => player.score > 0)) {
        roundState.active = true
        roundState.snapshot = snapshot
    }
    roundState.beatmapId = beatmapId || roundState.beatmapId
    roundState.pointTotal = Number.isFinite(pointTotal) ? pointTotal : roundState.pointTotal
}

function resolveLastPlace(state) {
    const roundKey = `${state.beatmapId}:${state.pointTotal}`
    if (localStorage.getItem(tournamentState.key('last-deduction')) === roundKey) return
    const eligible = state.snapshot.filter(player => activeLives(player) > 0)
    if (!eligible.length) return
    eligible.sort((a, b) => scoreValue(a) - scoreValue(b))
    if (deductLife(eligible[0])) localStorage.setItem(tournamentState.key('last-deduction'), roundKey)
}

function parseMapName(name) {
    const match = String(name || '').match(/^(.*?)\s+-\s+(.*?)\s+\[(.*)]$/)
    return match ? {artist: match[1], title: match[2], difficulty: match[3]} : null
}

function setText(node, value) {
    const next = value === undefined || value === null || value === '' ? '—' : String(value)
    if (node.textContent === next) return
    node.textContent = next
}

function setMapTitle(value) {
    const next = value === undefined || value === null || value === '' ? '—' : String(value)
    if (mapTitleCopies[0].textContent === next) return
    mapTitle.classList.remove('scrolling')
    mapTitle.style.removeProperty('--title-distance')
    mapTitle.style.removeProperty('--title-duration')
    mapTitleTrack.style.transform = 'translateX(0)'
    mapTitleCopies.forEach(copy => { copy.textContent = next })
    requestAnimationFrame(() => {
        const titleWidth = mapTitleCopies[0].scrollWidth
        if (titleWidth <= mapTitle.clientWidth) return
        const distance = titleWidth + 48
        mapTitle.style.setProperty('--title-distance', `${distance}px`)
        mapTitle.style.setProperty('--title-duration', `${Math.max(7, distance / 42)}s`)
        mapTitle.classList.add('scrolling')
    })
}

function mapSourceFromPayload(data) {
    const clients = data.tourney?.clients || data.tourney?.ipcClients || []
    const client = clients.find(item => Number(item.beatmap?.id || item.beatmap?.mapid || 0) || item.beatmap?.title)
    if (client?.beatmap) return {source: client, beatmap: client.beatmap}
    return {source: data, beatmap: data.beatmap || data.menu?.bm || {}}
}

function mapDataFromPayload(data) {
    const {source, beatmap} = mapSourceFromPayload(data)
    const id = Number(beatmap.id || beatmap.mapid || 0)
    const pool = FLT5Pool.find(mappools, poolName)
    const poolMap = FLT5Pool.resolve(pool, beatmap)
    const poolMatched = Boolean(poolMap.slot)
    const parsed = parseMapName(poolMap.name)
    const stats = beatmap.stats || beatmap.stats?.memory || data.menu?.bm?.stats || {}
    return {
        id,
        slot: poolMap.slot || 'MAP',
        badge: poolMap.badge,
        artist: poolMap.artist || parsed?.artist || beatmap.artist || '—',
        title: poolMap.title || parsed?.title || beatmap.title || '—',
        difficulty: poolMap.difficulty || parsed?.difficulty || beatmap.version || beatmap.difficulty || '—',
        mapper: beatmap.mapper || poolMap.mapper || '—',
        sr: poolMatched ? poolMap.sr : beatmap.stats?.stars?.total || stats.stars,
        bpm: poolMatched ? poolMap.bpm : beatmap.stats?.bpm?.common || beatmap.bpm || stats.bpm,
        cs: poolMatched ? poolMap.cs : beatmap.stats?.cs?.converted || beatmap.stats?.cs?.original || stats.CS || stats.cs,
        ar: poolMatched ? poolMap.ar : beatmap.stats?.ar?.converted || beatmap.stats?.ar?.original || stats.AR || stats.ar,
        od: poolMatched ? poolMap.od : beatmap.stats?.od?.converted || beatmap.stats?.od?.original || stats.OD || stats.od,
        length: poolMatched ? poolMap.length : beatmap.time?.mp3Length || beatmap.time?.full || beatmap.time?.lastObject || source.menu?.bm?.time?.full
            ? formatDuration(beatmap.time?.mp3Length || beatmap.time?.full || beatmap.time?.lastObject || source.menu?.bm?.time?.full)
            : undefined,
        cover: mapCoverPath(source, beatmap, poolMap)
    }
}

function formatDuration(milliseconds) {
    const total = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000))
    if (!total) return '—'
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function mapCoverPath(data, beatmap, poolMap) {
    const direct = data.directPath?.beatmapBackground || beatmap.directPath?.beatmapBackground || data.menu?.bm?.path?.background
    if (direct) return `/files/beatmap/${encodeURIComponent(direct)}`
    const folder = data.folders?.beatmap || beatmap.folders?.beatmap
    const file = data.files?.background || beatmap.files?.background
    if (folder && file) return `/Songs/${encodeURIComponent(folder).replace(/%2F/gi, '/')}/${encodeURIComponent(file)}`
    const setId = beatmap.set?.id || beatmap.setId || beatmap.beatmapsetId || poolMap.beatmapsetId
    return setId ? `https://assets.ppy.sh/beatmaps/${setId}/covers/cover.jpg` : ''
}

function displayNumber(node, value, decimals = 1) {
    if (value === undefined || value === null || value === '') {
        node.counter?.reset()
        node.counter = null
        setText(node, '—')
        return
    }
    const next = Number(value)
    if (!Number.isFinite(next)) {
        node.counter?.reset()
        node.counter = null
        setText(node, value)
        return
    }
    if (!node.counter) {
        node.counter = new CountUp(node, next, next, decimals, .35, {useEasing: true, useGrouping: false, formattingFn: value => decimals ? Number(value.toFixed(decimals)).toString() : Math.round(value).toString()})
        node.counter.start()
    } else {
        node.counter.update(next)
    }
}

function setMapCopy(map) {
    const signature = [map.artist, map.title, map.difficulty, map.mapper].join('\u0000')
    if (signature === mapCopySignature) return
    const firstEntry = !mapCopySignature
    mapCopySignature = signature
    const request = ++mapCopyRequest
    const apply = () => {
        setText(mapArtist, map.artist)
        setMapTitle(map.title)
        setText(mapDifficulty, map.difficulty)
        setText(mapMapper, map.mapper)
    }
    mapCopy.classList.remove('text-entering')
    if (firstEntry || matchMedia('(prefers-reduced-motion: reduce)').matches) {
        apply()
        mapCopy.classList.add('text-entering')
        setTimeout(() => {
            if (request === mapCopyRequest) mapCopy.classList.remove('text-entering')
        }, 210)
        return
    }
    mapCopy.classList.add('text-leaving')
    setTimeout(() => {
        if (request !== mapCopyRequest) return
        apply()
        mapCopy.classList.remove('text-leaving')
        void mapCopy.offsetWidth
        mapCopy.classList.add('text-entering')
        setTimeout(() => {
            if (request === mapCopyRequest) mapCopy.classList.remove('text-entering')
        }, 210)
    }, 110)
}

function updateMap(data) {
    const map = mapDataFromPayload(data)
    currentBeatmapId = map.id
    mapSlot.className = `panel-sticker map-sticker mod-${map.slot.slice(0, 2).toLowerCase()}`
    setText(mapSlot, map.slot)
    setMapBadge(map.badge)
    setMapCopy(map)
    displayNumber(numberNodes.sr, map.sr, 2)
    displayNumber(numberNodes.bpm, map.bpm, 0)
    displayNumber(numberNodes.cs, map.cs)
    displayNumber(numberNodes.ar, map.ar)
    displayNumber(numberNodes.od, map.od)
    setText(mapLength, map.length)
    updateCover(map.cover)
}

function updateCover(url) {
    const mapCover = coverCurrent.parentElement
    if (url === pendingCover) return
    if (url === currentCover) {
        if (pendingCover) {
            coverRequest += 1
            pendingCover = ''
        }
        return
    }
    const request = ++coverRequest
    if (!url) {
        currentCover = ''
        pendingCover = ''
        coverLayers.forEach(layer => layer.classList.remove('active'))
        mapCover.classList.remove('has-cover')
        setTimeout(() => {
            if (request === coverRequest) coverLayers.forEach(layer => { layer.style.backgroundImage = '' })
        }, 520)
        return
    }
    pendingCover = url
    const image = new Image()
    image.onload = () => {
        if (request !== coverRequest) return
        const nextCover = activeCover === 0 ? 1 : 0
        const incoming = coverLayers[nextCover]
        const outgoing = coverLayers[activeCover]
        incoming.classList.remove('active')
        incoming.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`
        void incoming.offsetWidth
        outgoing.classList.remove('active')
        incoming.classList.add('active')
        activeCover = nextCover
        currentCover = url
        pendingCover = ''
        mapCover.classList.add('has-cover')
        setTimeout(() => {
            if (request === coverRequest) outgoing.style.backgroundImage = ''
        }, 520)
    }
    image.onerror = () => {
        if (request === coverRequest) pendingCover = ''
    }
    image.src = url
}

function chatMessageFromEntry(entry) {
    return {
        name: entry.name || entry.username || entry.user?.name || 'PLAYER',
        message: entry.message || entry.messageBody || entry.content || '',
        team: String(entry.team || entry.type || '').toLowerCase()
    }
}

function renderIngameChat(entries) {
    const messages = (entries || []).map(chatMessageFromEntry).filter(entry => entry.message).slice(-11)
    const signature = JSON.stringify(messages)
    if (signature === lastChatSignature) return
    lastChatSignature = signature
    const keys = messages.map(message => JSON.stringify(message))
    let retained = Math.min(lastChatMessages.length, keys.length)
    while (retained && !lastChatMessages.slice(-retained).every((key, index) => key === keys[index])) retained -= 1
    updateChatFeed(ingameChat, () => {
        while (ingameChat.children.length > retained) ingameChat.firstElementChild.remove()
        messages.slice(retained).forEach(message => {
            const row = document.createElement('div')
            const lowerName = message.name.toLowerCase()
            row.className = `chat-message${lowerName === 'banchobot' ? ' bancho' : message.team.includes('ref') || message.team.includes('system') ? ' ref' : ''}`
            const name = document.createElement('strong')
            name.textContent = message.name
            row.append(name, document.createTextNode(message.message))
            row.classList.add('entering')
            ingameChat.append(row)
        })
    })
    lastChatMessages = keys
    ingameEmpty.classList.toggle('hidden', messages.length > 0)
}

function updateChatFeed(feed, update) {
    const anchor = feed.lastElementChild
    const oldTop = anchor?.getBoundingClientRect().top
    feed.getAnimations().forEach(animation => animation.cancel())
    update()
    if (!anchor || anchor.parentElement !== feed || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const scale = overlay.getBoundingClientRect().width / overlay.offsetWidth
    const shift = (oldTop - anchor.getBoundingClientRect().top) / scale
    if (Math.abs(shift) < .5) return
    feed.animate([{transform: `translateY(${shift}px)`}, {transform: 'translateY(0)'}], {
        duration: 180,
        easing: 'cubic-bezier(.16, 1, .3, 1)'
    })
}

function updateFromTosu(data) {
    const clients = data.tourney?.clients || data.tourney?.ipcClients || []
    const nextPlayers = clients.map(playerFromClient).filter(player => player.name)
    const {beatmap} = mapSourceFromPayload(data)
    const beatmapId = Number(beatmap.id || beatmap.mapid || 0)
    const points = data.tourney?.points || {}
    const pointTotal = Number(points.left || 0) + Number(points.right || 0)
    const nextGameplayActive = isGameplayOngoing(data)
    setGameplayActive(nextGameplayActive)
    renderLeaderboard(nextPlayers)
    renderClientSlots(clients)
    handleRound(nextPlayers, beatmapId, pointTotal, nextGameplayActive)
    updateMap(data)
    renderIngameChat(data.tourney?.chat || data.tourney?.manager?.chat || [])
}

function connectTosu() {
    websocket = new ReconnectingWebSocket(`ws://${location.host}/websocket/v2`)
    websocket.onmessage = event => {
        try {
            updateFromTosu(JSON.parse(event.data))
        } catch {
        }
    }
    websocket.onclose = () => {
        setGameplayActive(false)
        updateClientHighlights()
    }
}

function appendTwitchMessage(name, message, tags = {}) {
    const row = document.createElement('div')
    row.className = 'chat-message twitch entering'
    const label = document.createElement('strong')
    label.textContent = name
    row.append(label, FLT5Twitch.fragment(message, tags))
    updateChatFeed(twitchChat, () => {
        twitchChat.append(row)
        while (twitchChat.children.length > 14) twitchChat.firstElementChild.remove()
    })
    twitchEmpty.classList.add('hidden')
}

function connectTwitch() {
    if (!twitchChannel) return
    twitchSocket = FLT5Twitch.connect(twitchChannel, appendTwitchMessage)
}

async function startPreview() {
    setGameplayActive(params.get('playing') !== '0')
    const seedData = await fetch('../qualifier-seeds.json').then(response => response.json())
    const rawPlayers = Array.isArray(seedData) ? seedData : seedData.players || Object.values(seedData)
    const fields = seedData.fields || []
    const sourcePlayers = rawPlayers.map(player => Array.isArray(player)
        ? Object.fromEntries(fields.map((field, index) => [field, player[index]]))
        : player)
    const pool = FLT5Pool.find(mappools, poolName)
    const previewAccuracies = [100, 99.18, 96.84, 92.67, 98.62, 95.78, 90.96, 87.43, 83.5, 94.3]
    const previewGrade = player => player.accuracy === 100 && !player.misses ? 'SS'
        : player.accuracy >= 98 ? 'S'
        : player.accuracy >= 94 ? 'A'
        : player.accuracy >= 90 ? 'B'
        : player.accuracy >= 85 ? 'C' : 'D'
    const previewPlayers = sourcePlayers.slice(0, previewPlayerCount).map((player, index) => ({
        id: Number(player.userId || player.user_id || player.id || 0),
        name: player.username || player.name,
        score: 970000 - index * 43811,
        accuracy: previewAccuracies[index],
        misses: index % 4,
        mods: ''
    }))
    previewPlayers.forEach(player => { player.grade = previewGrade(player) })
    tournamentState.usePlayers(previewPlayers)
    lives = loadLives()
    const eliminatedCount = Math.min(2, Math.max(0, previewPlayers.length - 4))
    previewPlayers.forEach((player, index) => {
        lives[playerKey(player)] = index >= previewPlayers.length - eliminatedCount ? [false, false] : [true, true]
    })
    saveLives()
    renderLeaderboard(previewPlayers)
    let phase = 0
    const update = () => {
        const eligible = previewPlayers.filter(player => activeLives(player) > 0)
        const chaser = phase % eligible.length
        const runnerUp = (phase + 1) % eligible.length
        eligible.forEach((player, index) => {
            const steadyGain = 8000 + ((index * 11 + phase * 17) % 6) * 2500
            player.score += index === chaser ? 220000 : index === runnerUp ? 100000 : steadyGain
            player.accuracy = Math.max(80, Math.min(100, player.accuracy + (index === chaser ? .07 : -.02)))
            if (phase && phase % 9 === index % 9) player.misses += 1
            player.grade = previewGrade(player)
        })
        const connected = eliminatedCount ? previewPlayers.slice(0, -1) : previewPlayers
        renderLeaderboard(connected)
        renderClientSlots(connected.map(player => ({user: {id: player.id, name: player.name}, play: {score: player.score, accuracy: player.accuracy, rank: {current: player.grade}, hits: {'0': player.misses}}})))
        phase += 1
    }
    update()
    previewTimer = setInterval(update, 450)
    const mapCycle = ['NM1', 'NM2', 'NM3', 'HD2', 'HR2', 'DT2', 'TB']
        .map(slot => Object.entries(pool.maps).find(([, map]) => map.slot === slot))
        .filter(Boolean)
    let mapIndex = 0
    const showMap = () => {
        const [mapId, map] = mapCycle[mapIndex % mapCycle.length]
        updateMap({
            beatmap: {
                id: Number(mapId),
                artist: map.badge === 'edit' ? 'Various Artists' : map.artist,
                title: map.badge === 'edit' ? 'FLT5 Grand Finals Edits Pack' : map.title,
                version: map.badge === 'edit' ? `${map.slot} - ${map.title} [${map.difficulty}]` : map.difficulty,
                mapper: map.mapper,
                set: {id: map.beatmapsetId},
                stats: {stars: {total: map.sr}, bpm: {common: map.bpm}, cs: {original: map.cs}, ar: {original: map.ar}, od: {original: map.od}}
            }
        })
        mapIndex += 1
    }
    showMap()
    setInterval(showMap, 6000)
    const messages = [
        {name: 'BanchoBot', message: 'Match started', team: 'system'},
        {name: previewPlayers[0].name, message: 'gl everyone!', team: 'player'},
        {name: 'Referee', message: 'Have fun!', team: 'referee'}
    ]
    renderIngameChat(messages)
    const ingameSamples = ['That was close!', 'Next map is ready.', 'Good luck on this one!', 'Still in the running.', 'Nice play!']
    const twitchSamples = ['This lobby is so close!', 'That lead keeps changing', 'Great map pick', 'Good luck everyone!', 'What a finish!']
    let messageIndex = 0
    const showMessages = () => {
        const player = previewPlayers[messageIndex % previewPlayers.length]
        messages.push({name: player.name, message: ingameSamples[messageIndex % ingameSamples.length], team: 'player'})
        if (messages.length > 20) messages.shift()
        renderIngameChat(messages)
        appendTwitchMessage(['raybean_osu', 'fruitloops_fan', 'stream_viewer'][messageIndex % 3], twitchSamples[messageIndex % twitchSamples.length])
        messageIndex += 1
    }
    showMessages()
    setInterval(showMessages, 2100)
}

async function init() {
    fitOverlay()
    addEventListener('resize', fitOverlay)
    await FLT5Tournament.load()
    tournamentRound = FLT5Tournament.select(params)
    tournamentState = FLT5Tournament.createState(tournamentRound, params)
    lives = loadLives()
    players = loadEliminated()
    if (!params.has('pool')) poolName = tournamentRound.pool
    try {
        mappools = await fetch('../mappools.json').then(response => response.json())
    } catch {
        mappools = {}
    }
    const roundName = document.getElementById('round-name')
    roundName.textContent = tournamentRound.name
    roundName.parentElement.classList.toggle('long-round', roundName.textContent.length > 10)
    roundName.parentElement.addEventListener('click', resetLobby)
    addEventListener('storage', event => {
        if (event.key !== tournamentState.key('lives') && event.key !== tournamentState.key('reset')) return
        lives = loadLives()
        if (event.key === tournamentState.key('reset')) {
            players = loadEliminated()
            roundState = null
        }
        renderLeaderboard(lobbyPlayers)
    })
    if (previewMode) await startPreview()
    else connectTosu()
    if (!previewMode) connectTwitch()
}

init()
