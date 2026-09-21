const socketUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/websocket/v2`;
const slotColors = {
    NM: '#ffd46f',
    HD: '#b8a0ff',
    HR: '#ffb68f',
    DT: '#8dd7ff',
    TB: '#b59aff'
};

const ui = {
    round: document.getElementById('round'),
    slot: document.getElementById('slot'),
    slotSticker: document.getElementById('slot-sticker'),
    cover: document.getElementById('cover'),
    coverImages: [...document.querySelectorAll('.cover-image')],
    mapCopy: document.querySelector('.map-copy'),
    artist: document.getElementById('artist'),
    title: document.getElementById('title'),
    difficulty: document.getElementById('difficulty'),
    mapper: document.getElementById('mapper'),
    replayer: document.getElementById('replayer'),
    length: document.getElementById('length'),
    nav: document.getElementById('pool-nav')
};

let config = { round: '', slots: [], custom: {} };
let activeSlot = '';
let renderedSlots = '';
let activeCover = 0;
let coverUrl = '';
let coverRequest = 0;
let mapCopyRequest = 0;
let mapCopySignature = '';

const compactNumber = value => Number.isFinite(Number(value)) ? Number(Number(value).toFixed(2)).toString() : '0';
const readNumber = (...values) => {
    for (const value of values) {
        const number = Number(value);
        if (Number.isFinite(number)) return number;
    }
    return NaN;
};

const formatTime = milliseconds => {
    const seconds = Math.max(0, Math.round(milliseconds / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

const counters = {};
const counterOptions = {
    sr: { useEasing: true, useGrouping: false },
    cs: { useEasing: true, useGrouping: false, formattingFn: compactNumber },
    ar: { useEasing: true, useGrouping: false, formattingFn: compactNumber },
    od: { useEasing: true, useGrouping: false, formattingFn: compactNumber },
    hp: { useEasing: true, useGrouping: false, formattingFn: compactNumber },
    bpm: { useEasing: true, useGrouping: false, formattingFn: compactNumber }
};

const setScale = () => {
    const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    document.documentElement.style.setProperty('--overlay-scale', scale);
};

const normalizeEntry = value => {
    if (typeof value === 'string') return { slot: value };
    if (value && typeof value === 'object') return value;
    return {};
};

const resolveEntry = data => {
    const id = String(data.beatmap?.id ?? '');
    if (config.maps?.[id]) return normalizeEntry(config.maps[id]);
    const searchable = `${data.beatmap?.artist ?? ''} ${data.beatmap?.title ?? ''} ${data.beatmap?.version ?? ''}`.toLowerCase();
    for (const [fragment, value] of Object.entries(config.custom || {})) {
        if (searchable.includes(fragment.toLowerCase())) return normalizeEntry(value);
    }
    return {};
};

const colorForSlot = slot => slotColors[String(slot).slice(0, 2).toUpperCase()] || '#f598c9';

const syncSlotClasses = () => {
    for (const chip of ui.nav.querySelectorAll('.slot-chip')) {
        chip.classList.toggle('active', chip.dataset.slot === activeSlot);
    }
};

const renderSlots = () => {
    const slots = Array.isArray(config.slots) ? config.slots : [];
    const signature = slots.join('|');
    if (signature !== renderedSlots) {
        renderedSlots = signature;
        ui.nav.replaceChildren(...slots.map((slot, index) => {
            const chip = document.createElement('span');
            chip.className = 'slot-chip';
            chip.dataset.slot = slot;
            chip.textContent = slot;
            chip.style.setProperty('--slot-color', colorForSlot(slot));
            chip.style.setProperty('--tilt', `${[-2, 1.2, -1, 1.8, -.8][index % 5]}deg`);
            return chip;
        }));
        requestAnimationFrame(syncSlotClasses);
        return;
    }
    syncSlotClasses();
};

const setTitle = value => {
    if (ui.title.textContent === value) return;
    ui.title.classList.remove('overflow-animate');
    ui.title.style.removeProperty('--scroll-distance');
    ui.title.textContent = value;
    requestAnimationFrame(() => {
        const distance = ui.title.scrollWidth - ui.title.clientWidth;
        if (distance <= 0) return;
        ui.title.style.setProperty('--scroll-distance', `-${distance + 14}px`);
        ui.title.classList.add('overflow-animate');
    });
};

const setActiveSlot = slot => {
    const nextSlot = slot || '';
    const changed = nextSlot !== activeSlot;
    activeSlot = nextSlot;
    ui.slot.textContent = activeSlot;
    ui.slotSticker.style.setProperty('--slot-color', colorForSlot(activeSlot));
    renderSlots();
    if (!changed) return;
    ui.slotSticker.classList.add('changing');
    requestAnimationFrame(() => requestAnimationFrame(() => ui.slotSticker.classList.remove('changing')));
};

const updateCounter = (name, value) => {
    if (!Number.isFinite(value)) {
        if (counters[name]) cancelAnimationFrame(counters[name].rAF);
        counters[name] = null;
        document.getElementById(name).textContent = '';
        return;
    }
    if (!counters[name]) {
        counters[name] = new CountUp(name, value, value, 2, .45, counterOptions[name]);
        return;
    }
    counters[name].update(value);
};

const backgroundUrl = data => {
    const direct = data.directPath?.beatmapBackground;
    if (direct) return `/files/beatmap/${encodeURIComponent(direct)}`;
    const folder = data.folders?.beatmap;
    const file = data.files?.background;
    if (folder && file) return `/Songs/${encodeURIComponent(folder).replace(/%2F/gi, '/')}/${encodeURIComponent(file)}`;
    return '';
};

const setCoverBackground = url => {
    const nextUrl = url || '';
    if (nextUrl === coverUrl) return;
    const request = ++coverRequest;
    if (!nextUrl) {
        coverUrl = '';
        ui.coverImages.forEach(layer => layer.classList.remove('active'));
        setTimeout(() => {
            if (request !== coverRequest) return;
            ui.coverImages.forEach(layer => layer.style.backgroundImage = 'none');
        }, 520);
        return;
    }
    const image = new Image();
    image.onload = () => {
        if (request !== coverRequest) return;
        const nextCover = activeCover === 0 ? 1 : 0;
        const incoming = ui.coverImages[nextCover];
        const outgoing = ui.coverImages[activeCover];
        incoming.classList.remove('active');
        incoming.style.backgroundImage = `url("${nextUrl.replace(/"/g, '%22')}")`;
        incoming.getBoundingClientRect();
        outgoing.classList.remove('active');
        incoming.classList.add('active');
        activeCover = nextCover;
        coverUrl = nextUrl;
        setTimeout(() => {
            if (request !== coverRequest) return;
            outgoing.style.backgroundImage = 'none';
        }, 520);
    };
    image.src = nextUrl;
};

const setMapCopy = values => {
    const signature = values.join('\u0000');
    if (signature === mapCopySignature) return;
    const firstEntry = !mapCopySignature;
    mapCopySignature = signature;
    const request = ++mapCopyRequest;
    const apply = () => {
        ui.artist.textContent = values[0];
        setTitle(values[1]);
        ui.difficulty.textContent = values[2] ? `[${values[2]}]` : '';
        ui.mapper.textContent = values[3];
        ui.replayer.textContent = values[4];
    };
    if (firstEntry) {
        apply();
        ui.mapCopy.classList.add('text-entering');
        setTimeout(() => ui.mapCopy.classList.remove('text-entering'), 210);
        return;
    }
    ui.mapCopy.classList.remove('text-entering');
    ui.mapCopy.classList.add('text-leaving');
    setTimeout(() => {
        if (request !== mapCopyRequest) return;
        apply();
        ui.mapCopy.classList.remove('text-leaving');
        ui.mapCopy.getBoundingClientRect();
        ui.mapCopy.classList.add('text-entering');
        setTimeout(() => {
            if (request === mapCopyRequest) ui.mapCopy.classList.remove('text-entering');
        }, 210);
    }, 90);
};

const displayLength = (entry, beatmap) => {
    if (typeof entry.length === 'string' && /^\d{1,2}:\d{2}$/.test(entry.length)) return entry.length.padStart(5, '0');
    const firstObject = readNumber(beatmap.time?.firstObject);
    const lastObject = readNumber(entry.length, beatmap.time?.lastObject, beatmap.time?.mp3Length);
    if (!Number.isFinite(lastObject)) return '';
    return formatTime(Math.max(0, lastObject - (Number.isFinite(firstObject) ? firstObject : 0)));
};

const applyEntry = (entry, beatmap = {}, data = {}) => {
    setActiveSlot(entry.slot || activeSlot);
    setMapCopy([
        entry.artist || beatmap.artist || '',
        entry.title || beatmap.title || '',
        entry.difficulty || beatmap.version || '',
        entry.mapper || beatmap.mapper || '',
        entry.replayer || data.play?.playerName || '—'
    ]);
    const bg = entry.background || backgroundUrl(data);
    setCoverBackground(bg);
    const stats = beatmap.stats || {};
    updateCounter('sr', readNumber(entry.sr, stats.stars?.total));
    updateCounter('cs', readNumber(entry.cs, stats.cs?.converted, stats.cs?.original, stats.cs));
    updateCounter('ar', readNumber(entry.ar, stats.ar?.converted, stats.ar?.original, stats.ar));
    updateCounter('od', readNumber(entry.od, stats.od?.converted, stats.od?.original, stats.od));
    updateCounter('hp', readNumber(entry.hp, stats.hp?.converted, stats.hp?.original, stats.hp));
    updateCounter('bpm', readNumber(entry.bpm, stats.bpm?.common, stats.bpm?.max, stats.bpm));
    ui.length.textContent = displayLength(entry, beatmap);
};

const applyData = data => {
    if (!data?.beatmap || (!data.beatmap.id && !data.beatmap.title)) return;
    const entry = resolveEntry(data);
    if (!entry.slot) entry.slot = 'MAP';
    applyEntry(entry, data.beatmap, data);
};

const applyPreview = () => {
    const firstSlot = config.slots?.[0];
    if (!firstSlot) return;
    const preview = Object.entries(config.maps || {}).find(([, value]) => normalizeEntry(value).slot === firstSlot);
    if (preview) applyEntry(normalizeEntry(preview[1]));
};

const loadConfig = async () => {
    try {
        const response = await fetch(`../mappools.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(String(response.status));
        const pools = await response.json();
        const params = new URLSearchParams(location.search);
        config = pools[params.get('pool') || 'finals'] || { round: '', slots: [], maps: {}, custom: {} };
    } catch {
        config = { round: '', slots: [], maps: {}, custom: {} };
    }
    const params = new URLSearchParams(location.search);
    ui.round.textContent = params.get('round') || config.round || '';
    renderSlots();
    applyPreview();
};

const connect = () => {
    const socket = new ReconnectingWebSocket(socketUrl);
    socket.onopen = async () => {
        try {
            const response = await fetch('/json/v2', { cache: 'no-store' });
            if (response.ok) applyData(await response.json());
        } catch {}
    };
    socket.onmessage = event => {
        try {
            applyData(JSON.parse(event.data));
        } catch {}
    };
};

window.addEventListener('resize', setScale);
setScale();
loadConfig().then(connect);
