const params = new URLSearchParams(location.search)
const preview = params.get('preview') === '1'
const overlay = document.getElementById('overlay')
const cards = [...document.querySelectorAll('.winner-card')]
let rendered = ''

function fitOverlay() {
    overlay.style.setProperty('--overlay-scale', Math.min(innerWidth / 1920, innerHeight / 1080))
}

function readLives() {
    try {
        return JSON.parse(localStorage.getItem('flt5-gameplay-lives') || '{}')
    } catch {
        return {}
    }
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
        card.style.setProperty('--tilt', index ? '1deg' : '-1deg')
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
    const clients = data?.tourney?.clients || data?.tourney?.ipcClients || []
    const players = clients.map(playerFromClient).filter(player => player.name)
    if (!players.length) return
    const lives = readLives()
    const remaining = players.filter(player => livesRemaining(player, lives) > 0)
    const contenders = (remaining.length >= 2 ? remaining : players).sort((a, b) => b.score - a.score)
    render(contenders.slice(0, 2))
}

async function loadPreview() {
    const response = await fetch('../qualifier-seeds.json')
    const data = await response.json()
    const fields = data.fields || []
    const players = (data.players || []).slice(0, 2).map(row => Array.isArray(row) ? Object.fromEntries(fields.map((field, index) => [field, row[index]])) : row)
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

fitOverlay()
addEventListener('resize', fitOverlay)
if (preview) loadPreview().catch(() => render([{ id: 2, name: 'Winner One' }, { id: 3, name: 'Winner Two' }]))
else connect()
