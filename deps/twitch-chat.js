window.FLT5Twitch = (() => {
    const emotes = new Map()
    const rooms = new Set()
    const unescape = value => value.replace(/\\([snr:\\])/g, (_, char) => ({s: ' ', n: '\n', r: '\r', ':': ';', '\\': '\\'}[char]))

    function tags(line) {
        if (!line.startsWith('@')) return {}
        return Object.fromEntries(line.slice(1, line.indexOf(' ')).split(';').map(part => {
            const split = part.indexOf('=')
            return [part.slice(0, split), unescape(part.slice(split + 1))]
        }))
    }

    async function loadEmotes(url) {
        try {
            const response = await fetch(url, {signal: AbortSignal.timeout(6000)})
            if (!response.ok) return
            const data = await response.json()
            for (const emote of data.emote_set?.emotes || data.emotes || []) {
                const host = emote.data?.host
                const file = host?.files?.find(file => file.name === '2x.webp') || host?.files?.find(file => file.name.endsWith('.webp'))
                if (!host?.url || !file) continue
                const base = host.url.startsWith('//') ? `https:${host.url}` : host.url
                if (!base.startsWith('https://cdn.7tv.app/') && !base.startsWith('https://cdn.7tv.io/')) continue
                emotes.set(emote.name, `${base}/${file.name}`)
            }
        } catch {
        }
    }

    function image(url, text) {
        const node = document.createElement('img')
        node.className = 'chat-emote'
        node.src = url
        node.alt = text
        node.title = text
        node.addEventListener('error', () => node.replaceWith(document.createTextNode(text)), {once: true})
        return node
    }

    function fragment(message, metadata = {}) {
        const output = document.createDocumentFragment()
        const characters = Array.from(message)
        const ranges = []
        for (const entry of (metadata.emotes || '').split('/')) {
            const [id, offsets] = entry.split(':')
            if (!id || !offsets) continue
            for (const offset of offsets.split(',')) {
                const [start, end] = offset.split('-').map(Number)
                if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start && end < characters.length) ranges.push({start, end, id})
            }
        }
        const appendText = text => {
            for (const token of text.split(/(\s+)/)) output.append(emotes.has(token) ? image(emotes.get(token), token) : document.createTextNode(token))
        }
        let cursor = 0
        for (const {start, end, id} of ranges.sort((a, b) => a.start - b.start)) {
            if (start < cursor) continue
            appendText(characters.slice(cursor, start).join(''))
            output.append(image(`https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(id)}/default/light/2.0`, characters.slice(start, end + 1).join('')))
            cursor = end + 1
        }
        appendText(characters.slice(cursor).join(''))
        return output
    }

    function connect(channel, onMessage) {
        let socket
        let reconnect
        let stopped = false
        let attempts = 0
        const seen = new Set()
        channel = channel.toLowerCase().replace(/^#/, '')
        loadEmotes('https://7tv.io/v3/emote-sets/global')
        const open = () => {
            if (stopped || !channel) return
            socket = new WebSocket('wss://irc-ws.chat.twitch.tv:443')
            socket.addEventListener('open', () => {
                attempts = 0
                socket.send('CAP REQ :twitch.tv/tags twitch.tv/commands')
                socket.send('PASS SCHMOOPIIE')
                socket.send(`NICK justinfan${Math.floor(10000 + Math.random() * 80000)}`)
                socket.send(`JOIN #${channel}`)
            })
            socket.addEventListener('message', event => {
                for (const line of String(event.data).split('\r\n')) {
                    if (line.startsWith('PING')) {
                        socket.send(line.replace('PING', 'PONG'))
                        continue
                    }
                    const metadata = tags(line)
                    if (metadata['room-id'] && !rooms.has(metadata['room-id'])) {
                        rooms.add(metadata['room-id'])
                        loadEmotes(`https://7tv.io/v3/users/twitch/${encodeURIComponent(metadata['room-id'])}`)
                    }
                    if (!line.includes(' PRIVMSG ') || metadata.id && seen.has(metadata.id)) continue
                    if (metadata.id) {
                        seen.add(metadata.id)
                        if (seen.size > 200) seen.delete(seen.values().next().value)
                    }
                    const start = line.indexOf(' :', line.indexOf(' PRIVMSG '))
                    if (start < 0) continue
                    onMessage(metadata['display-name'] || line.match(/:([^!]+)!/)?.[1] || 'CHAT', line.slice(start + 2), metadata)
                }
            })
            socket.addEventListener('close', () => {
                if (!stopped) reconnect = setTimeout(open, Math.min(30000, 1500 * 2 ** attempts++))
            })
            socket.addEventListener('error', () => socket.close())
        }
        open()
        return {close() {stopped = true; clearTimeout(reconnect); socket?.close()}}
    }

    return {connect, fragment}
})()
