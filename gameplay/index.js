const params = new URLSearchParams(location.search)
const previewMode = params.get('preview') === '1'
const previewPlayerCount = Math.min(10, Math.max(1, Number(params.get('players')) || 8))
const clientLayout = Number(params.get('clients')) === 10 ? 10 : 8
const poolName = params.get('pool') || 'finals'
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
const mapDifficulty = document.getElementById('map-difficulty')
const mapMapper = document.getElementById('map-mapper')
const coverCurrent = document.getElementById('cover-current')
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
let players = new Map()
let lobbyPlayers = []
let lives = loadLives()
let currentBeatmapId = 0
let currentCover = ''
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
    cutouts.replaceChildren(...clientSlots.filter(slot => getComputedStyle(slot).display !== 'none').map(slot => {
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
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        path.setAttribute('fill', 'black')
        path.setAttribute('d', `M${x + tl} ${y}H${x + width - tr}A${tr} ${tr} 0 0 1 ${x + width} ${y + tr}V${y + height - br}A${br} ${br} 0 0 1 ${x + width - br} ${y + height}H${x + bl}A${bl} ${bl} 0 0 1 ${x} ${y + height - bl}V${y + tl}A${tl} ${tl} 0 0 1 ${x + tl} ${y}Z`)
        return path
    }))
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
    try {
        return JSON.parse(localStorage.getItem('flt5-gameplay-lives') || '{}')
    } catch {
        return {}
    }
}

function saveLives() {
    localStorage.setItem('flt5-gameplay-lives', JSON.stringify(lives))
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

function playerFromClient(client, index) {
    const user = client.user || client.spectating?.user || {}
    const play = client.play || client.gameplay || {}
    const mods = play.mods?.name || play.mods?.str || play.mods || ''
    return {
        id: Number(user.id || client.spectating?.userID || 0),
        name: user.name || play.playerName || play.name || '',
        score: Number(play.score || 0),
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
        if (!slot.querySelector('.client-status')) {
            const status = document.createElement('div')
            status.className = 'client-status'
            status.setAttribute('aria-hidden', 'true')
            status.innerHTML = '<b><i></i><em></em><i></i></b>'
            slot.append(status)
            syncClientStatus(slot)
        }
    })
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
    row.innerHTML = `<img class="avatar" alt=""><div class="player-copy"><div class="player-name"></div><div class="player-bottom"><div class="player-score"></div><div class="hearts"></div></div></div>`
    row.querySelector('.avatar').addEventListener('error', event => {
        event.currentTarget.style.opacity = '.24'
    })
    return row
}

function renderLeaderboard(nextPlayers) {
    const validPlayers = nextPlayers.filter(player => player.name).slice(0, 10)
    lobbyPlayers = validPlayers
    const connectedKeys = new Set(validPlayers.map(playerKey))
    validPlayers.forEach(player => {
        const key = playerKey(player)
        if (!players.has(key) || activeLives(player) > 0) players.set(key, {...player})
    })
    const sorted = [...players.values()]
        .filter(player => connectedKeys.has(playerKey(player)))
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
        const score = scoreValue(player)
        const scoreNode = row.querySelector('.player-score')
        if (!row.scoreCounter) {
            row.scoreCounter = new CountUp(scoreNode, 0, score, 0, .28, {useEasing: true, useGrouping: true, separator: ','})
            row.scoreCounter.start()
        } else {
            row.scoreCounter.update(score)
        }
        const hearts = row.querySelector('.hearts')
        hearts.replaceChildren(...lifeState.map((enabled, heartIndex) => {
            const heart = document.createElement('button')
            heart.type = 'button'
            heart.className = `heart${enabled ? '' : ' off'}`
            heart.textContent = '❤'
            heart.setAttribute('aria-label', `${player.name} life ${heartIndex + 1}`)
            heart.addEventListener('click', () => toggleHeart(player, heartIndex))
            return heart
        }))
    })
    updateClientHighlights()
}

function handleRound(playersNow, beatmapId, pointTotal, roundStarted, roundEnded) {
    const snapshot = playersNow.map(player => ({...player}))
    if (roundStarted) {
        roundState = {beatmapId, pointTotal, active: true, resolved: false, snapshot}
        return
    }
    if (!roundState) {
        roundState = {beatmapId, pointTotal, active: snapshot.some(player => player.score > 0), resolved: false, snapshot}
        return
    }
    if (!roundState.resolved && !roundEnded && snapshot.some(player => player.score > 0)) {
        roundState.active = true
        roundState.snapshot = snapshot
    }
    const beatmapChanged = beatmapId && roundState.beatmapId && beatmapId !== roundState.beatmapId
    const pointChanged = Number.isFinite(pointTotal) && Number.isFinite(roundState.pointTotal) && pointTotal !== roundState.pointTotal
    if ((roundEnded || beatmapChanged || pointChanged) && roundState.active && !roundState.resolved) {
        resolveLastPlace(roundState)
        roundState.active = false
        roundState.resolved = true
    }
    if (beatmapChanged) roundState = {beatmapId, pointTotal, active: snapshot.some(player => player.score > 0), resolved: false, snapshot}
    else {
        roundState.beatmapId = beatmapId || roundState.beatmapId
        roundState.pointTotal = Number.isFinite(pointTotal) ? pointTotal : roundState.pointTotal
    }
}

function resolveLastPlace(state) {
    const roundKey = `${state.beatmapId}:${state.pointTotal}`
    if (localStorage.getItem('flt5-gameplay-last-deduction') === roundKey) return
    const eligible = state.snapshot.filter(player => activeLives(player) > 0)
    if (!eligible.length) return
    eligible.sort((a, b) => scoreValue(a) - scoreValue(b))
    if (deductLife(eligible[0])) localStorage.setItem('flt5-gameplay-last-deduction', roundKey)
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

function mapSourceFromPayload(data) {
    const clients = data.tourney?.clients || data.tourney?.ipcClients || []
    const client = clients.find(item => Number(item.beatmap?.id || item.beatmap?.mapid || 0) || item.beatmap?.title)
    if (client?.beatmap) return {source: client, beatmap: client.beatmap}
    return {source: data, beatmap: data.beatmap || data.menu?.bm || {}}
}

function mapDataFromPayload(data) {
    const {source, beatmap} = mapSourceFromPayload(data)
    const id = Number(beatmap.id || beatmap.mapid || 0)
    const pool = mappools[poolName] || mappools.finals || {maps: {}}
    const poolMap = pool.maps?.[String(id)] || {}
    const parsed = parseMapName(poolMap.name)
    const stats = beatmap.stats || beatmap.stats?.memory || data.menu?.bm?.stats || {}
    return {
        id,
        slot: poolMap.slot || 'MAP',
        artist: beatmap.artist || poolMap.artist || parsed?.artist || '—',
        title: beatmap.title || poolMap.title || parsed?.title || '—',
        difficulty: beatmap.version || beatmap.difficulty || poolMap.difficulty || parsed?.difficulty || '—',
        mapper: beatmap.mapper || poolMap.mapper || '—',
        sr: beatmap.stats?.stars?.total || stats.stars || poolMap.sr,
        bpm: beatmap.stats?.bpm?.common || beatmap.bpm || stats.bpm || poolMap.bpm,
        cs: beatmap.stats?.cs?.converted || beatmap.stats?.cs?.original || stats.CS || stats.cs || poolMap.cs,
        ar: beatmap.stats?.ar?.converted || beatmap.stats?.ar?.original || stats.AR || stats.ar || poolMap.ar,
        od: beatmap.stats?.od?.converted || beatmap.stats?.od?.original || stats.OD || stats.od || poolMap.od,
        length: beatmap.time?.mp3Length || beatmap.time?.full || beatmap.time?.lastObject || source.menu?.bm?.time?.full
            ? formatDuration(beatmap.time?.mp3Length || beatmap.time?.full || beatmap.time?.lastObject || source.menu?.bm?.time?.full)
            : poolMap.length,
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
        setText(node, '—')
        return
    }
    const next = Number(value)
    if (!Number.isFinite(next)) {
        setText(node, value)
        return
    }
    node.textContent = decimals ? next.toFixed(decimals).replace(/\.0$/, '') : Math.round(next).toString()
}

function updateMap(data) {
    const map = mapDataFromPayload(data)
    currentBeatmapId = map.id
    mapSlot.className = `panel-sticker map-sticker mod-${map.slot.slice(0, 2).toLowerCase()}`
    setText(mapSlot, map.slot)
    setText(mapArtist, map.artist)
    setText(mapTitle, map.title)
    setText(mapDifficulty, map.difficulty)
    setText(mapMapper, map.mapper)
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
    if (!url) {
        currentCover = ''
        coverCurrent.style.backgroundImage = ''
        mapCover.classList.remove('has-cover')
        return
    }
    if (url === currentCover) return
    currentCover = url
    coverCurrent.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`
    mapCover.classList.add('has-cover')
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
    const wasGameplayActive = gameplayActive
    const nextGameplayActive = isGameplayOngoing(data)
    const roundStarted = !wasGameplayActive && nextGameplayActive
    const roundEnded = wasGameplayActive && !nextGameplayActive
    setGameplayActive(nextGameplayActive)
    renderLeaderboard(nextPlayers)
    renderClientSlots(clients)
    handleRound(nextPlayers, beatmapId, pointTotal, roundStarted, roundEnded)
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
    const [seedResponse] = await Promise.all([fetch('../qualifier-seeds.json')])
    const seedData = await seedResponse.json()
    const rawPlayers = Array.isArray(seedData) ? seedData : seedData.players || Object.values(seedData)
    const fields = seedData.fields || []
    const sourcePlayers = rawPlayers.map(player => Array.isArray(player)
        ? Object.fromEntries(fields.map((field, index) => [field, player[index]]))
        : player)
    const pool = mappools[poolName] || mappools.finals
    const [mapId, poolMap] = Object.entries(pool.maps).find(([, map]) => map.slot === pool.slots[0]) || Object.entries(pool.maps)[0]
    const previewPlayers = sourcePlayers.slice(0, previewPlayerCount).map((player, index) => ({
        id: Number(player.userId || player.user_id || player.id || 0),
        name: player.username || player.name,
        score: 970000 - index * 43811,
        mods: index % 4 === 1 ? 'HD' : index % 4 === 2 ? 'HR' : index % 4 === 3 ? 'DT' : 'NM'
    }))
    renderClientSlots(previewPlayers.map(player => ({user: {id: player.id, name: player.name}, play: {score: player.score}})))
    let phase = 0
    const update = () => {
        const chaser = phase % previewPlayers.length
        const runnerUp = (phase + 1) % previewPlayers.length
        previewPlayers.forEach((player, index) => {
            const steadyGain = 8000 + ((index * 11 + phase * 17) % 6) * 2500
            player.score += index === chaser ? 220000 : index === runnerUp ? 100000 : steadyGain
        })
        renderLeaderboard(previewPlayers)
        phase += 1
    }
    update()
    previewTimer = setInterval(update, 450)
    updateMap({
        beatmap: {
            id: Number(mapId),
            artist: poolMap.artist,
            title: poolMap.title,
            version: poolMap.difficulty,
            mapper: poolMap.mapper,
            stats: {stars: {total: poolMap.sr}, bpm: {common: poolMap.bpm}, cs: {original: poolMap.cs}, ar: {original: poolMap.ar}, od: {original: poolMap.od}}
        }
    })
    renderIngameChat([
        {name: 'BanchoBot', message: 'Match started', team: 'system'},
        {name: previewPlayers[0]?.name || 'PLAYER', message: 'gl everyone!', team: 'player'},
        {name: 'Referee', message: 'Have fun!', team: 'referee'}
    ])
}

async function init() {
    fitOverlay()
    addEventListener('resize', fitOverlay)
    try {
        mappools = await fetch('../mappools.json').then(response => response.json())
    } catch {
        mappools = {}
    }
    document.getElementById('round-name').textContent = (mappools[poolName]?.round || poolName).toUpperCase()
    if (previewMode) await startPreview()
    else connectTosu()
    connectTwitch()
}

init()
