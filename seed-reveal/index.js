const ui = {
    result: document.getElementById('result'),
    avatar: document.getElementById('avatar'),
    seed: document.getElementById('seed-number'),
    username: document.getElementById('username'),
    userId: document.getElementById('user-id'),
    averageScore: document.getElementById('average-score'),
    percentMax: document.getElementById('percent-max'),
    modGrid: document.getElementById('mod-grid'),
    stinger: document.getElementById('stinger'),
    stingerSeed: document.getElementById('stinger-seed'),
    stingerAvatar: document.getElementById('stinger-avatar'),
    stingerName: document.getElementById('stinger-name')
};

const modMeta = {
    NM: { color: '#8dd7ff', tilt: '-1.5deg' },
    HD: { color: '#ffd46f', tilt: '1.2deg' },
    HR: { color: '#ffb68f', tilt: '-1deg' },
    DT: { color: '#b8a0ff', tilt: '1.4deg' }
};

let players = [];
let slots = [];
let maps = {};
let revealIndex = -1;
let busy = false;
let scoreCounter;

const setScale = () => {
    const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    document.documentElement.style.setProperty('--overlay-scale', scale);
};

const formatScore = value => Number(value).toLocaleString('en-US');

const avatarUrl = player => `https://a.ppy.sh/${player.userId}`;

const expandPlayer = row => ({
    seed: row[0],
    userId: row[1],
    username: row[2],
    percentMaxSum: row[3],
    averageScore: row[4],
    ranks: row[5],
    scores: row[6]
});

const mapName = slot => {
    const entry = Object.values(maps).find(map => map.slot === slot);
    return entry?.name || '';
};

const renderModCards = player => {
    const groups = ['NM', 'HD', 'HR', 'DT'];
    ui.modGrid.replaceChildren(...groups.map((mod, cardIndex) => {
        const card = document.createElement('section');
        card.className = `mod-card mod-${mod.toLowerCase()}`;
        card.style.setProperty('--mod-color', modMeta[mod].color);
        card.style.setProperty('--heading-tilt', modMeta[mod].tilt);
        card.style.setProperty('--card-index', cardIndex);
        const heading = document.createElement('div');
        heading.className = 'mod-heading';
        heading.textContent = mod;
        const rows = document.createElement('div');
        rows.className = 'map-rows';
        const indexes = slots.map((slot, index) => ({ slot, index })).filter(item => item.slot.startsWith(mod));
        rows.replaceChildren(...indexes.map(item => {
            const row = document.createElement('div');
            row.className = 'map-row';
            const slot = document.createElement('div');
            slot.className = 'slot-label';
            slot.textContent = item.slot;
            const performance = document.createElement('div');
            performance.className = 'map-performance';
            const score = document.createElement('div');
            score.className = 'map-score';
            score.textContent = formatScore(player.scores[item.index]);
            const title = document.createElement('div');
            title.className = 'map-title';
            title.textContent = mapName(item.slot);
            performance.append(score, title);
            const seed = document.createElement('div');
            seed.className = 'map-seed';
            seed.textContent = `#${String(player.ranks[item.index]).padStart(2, '0')}`;
            row.append(slot, performance, seed);
            return row;
        }));
        card.append(heading, rows);
        return card;
    }));
};

const showPlayer = player => {
    const image = avatarUrl(player);
    ui.avatar.src = image;
    ui.avatar.alt = player.username;
    ui.seed.textContent = `#${String(player.seed).padStart(2, '0')}`;
    ui.username.textContent = player.username;
    ui.userId.textContent = player.userId;
    ui.percentMax.textContent = player.percentMaxSum.toFixed(3);
    renderModCards(player);
    ui.result.classList.remove('visible');
    ui.result.getBoundingClientRect();
    ui.result.classList.add('visible');
    if (!scoreCounter) {
        scoreCounter = new CountUp(ui.averageScore, 0, player.averageScore, 0, .55, { useEasing: true, useGrouping: true, separator: ',' });
        scoreCounter.start();
    } else scoreCounter.update(player.averageScore);
};

const finishStinger = () => {
    ui.stinger.className = 'stinger';
    busy = false;
};

const revealPlayer = player => {
    if (!player || busy) return;
    busy = true;
    const image = avatarUrl(player);
    ui.stingerSeed.textContent = `#${String(player.seed).padStart(2, '0')}`;
    ui.stingerAvatar.src = image;
    ui.stingerAvatar.alt = player.username;
    ui.stingerName.textContent = player.username;
    ui.stinger.className = 'stinger active';
    setTimeout(() => ui.stinger.classList.add('show-seed'), 330);
    setTimeout(() => ui.stinger.classList.add('show-player'), 760);
    setTimeout(() => showPlayer(player), 1200);
    setTimeout(() => ui.stinger.classList.add('hide-content'), 1230);
    setTimeout(() => ui.stinger.classList.add('departing'), 1400);
    setTimeout(finishStinger, 1860);
};

const step = direction => {
    if (busy || !players.length) return;
    const next = revealIndex + direction;
    if (next < 0 || next >= players.length) return;
    revealIndex = next;
    revealPlayer(players[revealIndex]);
};

const load = async () => {
    const stamp = Date.now();
    const [seedResponse, poolResponse] = await Promise.all([
        fetch(`../qualifier-seeds.json?t=${stamp}`, { cache: 'no-store' }),
        fetch(`../mappools.json?t=${stamp}`, { cache: 'no-store' })
    ]);
    const seedData = await seedResponse.json();
    const poolData = await poolResponse.json();
    slots = seedData.slots;
    maps = poolData.qualifiers.maps;
    players = seedData.players.map(expandPlayer).sort((a, b) => b.seed - a.seed);
    const requestedSeed = Number(new URLSearchParams(location.search).get('seed'));
    if (Number.isFinite(requestedSeed) && requestedSeed > 0) {
        const index = players.findIndex(player => player.seed === requestedSeed);
        if (index >= 0) {
            revealIndex = index;
            showPlayer(players[index]);
        }
    }
};

document.body.addEventListener('click', () => step(1));
window.addEventListener('keydown', event => {
    if (['Space', 'Enter', 'ArrowRight', 'PageDown'].includes(event.code)) {
        event.preventDefault();
        step(1);
    }
    if (['ArrowLeft', 'PageUp'].includes(event.code)) {
        event.preventDefault();
        step(-1);
    }
});
window.addEventListener('resize', setScale);
setScale();
load();
