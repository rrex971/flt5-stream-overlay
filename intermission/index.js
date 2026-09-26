const params = new URLSearchParams(location.search)
const mode = ['starting', 'ending', 'technical'].includes(params.get('mode')) ? params.get('mode') : 'starting'
const overlay = document.getElementById('overlay')
const background = document.getElementById('background')
const timerCard = document.getElementById('timer-card')
const countdown = document.getElementById('countdown')
const feed = document.getElementById('twitch-chat')
let deadline = 0
let duration = 0
let paused = null
let finished = ''

function fitOverlay() {
    overlay.style.setProperty('--overlay-scale', Math.min(innerWidth / 1920, innerHeight / 1080))
}

function updateTimer() {
    if (timerCard.hidden) return
    const seconds = Math.max(0, Math.ceil((paused ?? deadline - Date.now()) / 1000))
    timerCard.classList.toggle('finished', seconds === 0)
    countdown.textContent = seconds ? `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}` : finished
}

function appendMessage(name, message, tags = {}) {
    const anchor = feed.lastElementChild
    const previousTop = anchor?.getBoundingClientRect().top
    feed.getAnimations().forEach(animation => animation.cancel())
    const row = document.createElement('div')
    row.className = 'chat-message entering'
    const label = document.createElement('strong')
    label.textContent = name
    row.append(label, FLT5Twitch.fragment(message, tags))
    feed.append(row)
    while (feed.children.length > 30) feed.firstElementChild.remove()
    if (!anchor?.isConnected || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const scale = overlay.getBoundingClientRect().width / overlay.offsetWidth
    const shift = (previousTop - anchor.getBoundingClientRect().top) / scale
    feed.animate([{transform: `translateY(${shift}px)`}, {transform: 'translateY(0)'}], {duration: 180, easing: 'cubic-bezier(.16, 1, .3, 1)'})
}

async function init() {
    let config = {}
    try {
        const response = await fetch('config.json', {cache: 'no-store'})
        config = await response.json()
    } catch {
    }
    const settings = config[mode] || {}
    document.title = `FLT5 ${mode === 'technical' ? 'Technical Difficulties' : `${mode[0].toUpperCase()}${mode.slice(1)} Soon`}`
    overlay.classList.add(`mode-${mode}`)
    background.src = `../assets/${mode === 'technical' ? 'background' : `${mode}-soon`}.webm`
    background.play().catch(() => {})
    document.querySelector('.technical-copy').hidden = mode !== 'technical'
    const minutes = Math.max(0, Number(params.get('minutes') ?? settings.minutes ?? (mode === 'technical' ? 0 : 10)))
    duration = Number.isFinite(minutes) ? minutes * 60000 : 0
    const until = Date.parse(params.get('until') || '')
    deadline = Number.isFinite(until) ? until : Date.now() + duration
    finished = settings.finished || 'BACK SHORTLY'
    document.getElementById('timer-label').textContent = settings.label || 'BACK IN'
    timerCard.hidden = mode === 'ending' || params.get('timer') === '0' || !duration && !Number.isFinite(until)
    updateTimer()
    setInterval(updateTimer, 100)
    FLT5Twitch.connect(params.get('channel') || config.channel || 'raybean_osu', appendMessage)
    if (params.get('preview') === '1') {
        appendMessage('raybean_osu', 'Thanks for tuning in!')
        appendMessage('Nelys', 'Kappa', {emotes: '25:0-4'})
    }
}

window.addEventListener('resize', fitOverlay)
window.addEventListener('keydown', event => {
    if (timerCard.hidden) return
    if (event.code === 'KeyR') {
        paused = null
        deadline = Date.now() + duration
    } else if (event.code === 'Space') {
        event.preventDefault()
        if (paused === null) paused = Math.max(0, deadline - Date.now())
        else {deadline = Date.now() + paused; paused = null}
    } else if (event.key === '+' || event.key === '=') {
        if (paused === null) deadline += 60000
        else paused += 60000
    } else if (event.key === '-') {
        if (paused === null) deadline -= 60000
        else paused = Math.max(0, paused - 60000)
    }
    updateTimer()
})
fitOverlay()
init()
