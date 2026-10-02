const params = new URLSearchParams(location.search)
const preview = params.get('preview') === '1'
const overlay = document.getElementById('overlay')
const cards = [...document.querySelectorAll('.winner-card')]
let rendered = ''
let round
let tournamentState
let lastData = {}

function fitOverlay() {
    overlay.style.setProperty('--overlay-scale', Math.min(innerWidth / 1920, innerHeight / 1080))
}

function readLives() {
    return tournamentState.read('lives', {})
}

function playerKey(player) {
    return String(player.id || player.name || '').toLowerCase()
}

function livesRemaining(player, lives) {
    const state = lives[playerKey(player)]
    return Array.isArray(state) ? state.filter(Boolean).length : 2
}

function playerFromClient(client) {
    const user = client.user || client.spectating?.user || {}
    const play = client.play || client.gameplay || {}
    return {
        id: Number(user.id || client.spectating?.userID || 0),
        name: user.name || play.playerName || play.name || '',
        score: Number(play.score || 0)
    }
}

function render(players) {
    const signature = players.map(player => `${player.id}:${player.name}`).join('|')
    if (signature === rendered) return
    rendered = signature
    cards.forEach((card, index) => {
        const player = players[index]
        card.hidden = !player
        if (!player) return
        card.style.setProperty('--tilt', index % 2 ? '1deg' : '-1deg')
        const avatar = card.querySelector('.winner-avatar')
        avatar.src = player.id ? `https://a.ppy.sh/${player.id}` : ''
        avatar.alt = player.name
        card.querySelector('.winner-name').textContent = player.name || 'Player'
        card.classList.remove('visible')
        void card.offsetWidth
        card.classList.add('visible')
    })
}

function update(data) {
    lastData = data
    const clients = data?.tourney?.clients || data?.tourney?.ipcClients || []
    const players = clients.map(playerFromClient).filter(player => player.name)
    if (tournamentState.usePlayers(players)) render([])
    if (round.key === 'grand-finals-1') {
        render(tournamentState.capture(players, readLives()))
        return
    }
    if (!players.length) return
    const lives = readLives()
    const remaining = players.filter(player => livesRemaining(player, lives) > 0)
    const contenders = (remaining.length >= 2 ? remaining : players).sort((a, b) => b.score - a.score)
    render(contenders.slice(0, 2))
}

async function loadPreview() {
    if (round.lobbies.length) {
        render(round.lobbies[0].players.slice(0, round.winners))
        return
    }
    const response = await fetch('../qualifier-seeds.json')
    const data = await response.json()
    const fields = data.fields || []
    const players = (data.players || []).slice(0, round.winners).map(row => Array.isArray(row) ? Object.fromEntries(fields.map((field, index) => [field, row[index]])) : row)
    render(players.map(player => ({ id: Number(player.userId || player.id || 0), name: player.username || player.name || 'Player', score: 0 })))
}

function connect() {
    const socket = new ReconnectingWebSocket(`ws://${location.host}/websocket/v2`)
    socket.addEventListener('message', event => {
        try {
            update(JSON.parse(event.data))
        } catch {}
    })
}

async function init() {
    fitOverlay()
    addEventListener('resize', fitOverlay)
    await FLT5Tournament.load()
    round = FLT5Tournament.select(params, overlay.dataset.round || 'finals')
    tournamentState = FLT5Tournament.createState(round, params)
    document.querySelector('.winner-banner p').textContent = `Advanced to ${round.advancesTo}`
    document.querySelector('.winner-list').setAttribute('aria-label', `${round.name} winners`)
    if (preview) await loadPreview()
    else {
        if (round.key === 'grand-finals-1') render(tournamentState.winners())
        addEventListener('storage', event => {
            if (event.key?.endsWith('-active-lobby')) tournamentState = FLT5Tournament.createState(round, params)
            if (round.key === 'grand-finals-1' && (event.key === tournamentState.key('lives') || event.key === tournamentState.key('winners') || event.key?.endsWith('-active-lobby'))) render(tournamentState.winners())
            else if (event.key === tournamentState.key('lives')) update(lastData)
        })
        connect()
    }
}

init()
