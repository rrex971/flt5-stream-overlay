(() => {
    const overlay = document.getElementById('overlay')
    if (!overlay) return
    const style = document.createElement('style')
    style.textContent = `.now-playing{position:absolute;z-index:40;right:38px;top:26px;display:none;align-items:center;gap:13px;max-width:700px;color:#fffafc;font:25px/1 Arco,sans-serif;letter-spacing:.5px;text-shadow:0 3px 0 #5f35af}.now-playing.visible{display:flex}.now-playing strong{color:#ffd46f;font-size:38px;line-height:1;white-space:nowrap;text-shadow:0 3px 0 #5f35af}.now-playing span{max-width:590px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`
    document.head.append(style)
    const node = document.createElement('div')
    node.className = 'now-playing'
    node.innerHTML = '<strong>♪</strong><span></span>'
    overlay.append(node)
    const text = node.querySelector('span')
    const update = data => {
        const clients = data?.tourney?.clients || data?.tourney?.ipcClients || []
        const client = clients.find(item => item.beatmap?.title || item.beatmap?.id)
        const beatmap = client?.beatmap || data?.beatmap || data?.menu?.bm || {}
        const artist = beatmap.artist || ''
        const title = beatmap.title || ''
        const version = beatmap.version || beatmap.difficulty || ''
        if (!title && !artist) return
        text.textContent = `${artist ? `${artist} - ` : ''}${title}${version ? ` [${version}]` : ''}`
        node.classList.add('visible')
    }
    try {
        const socket = new ReconnectingWebSocket(`ws://${location.host}/websocket/v2`)
        socket.addEventListener('message', event => {
            try { update(JSON.parse(event.data)) } catch {}
        })
    } catch {}
})()
