const endpoint = 'https://wybin.xyz/api/v1/tournament-stages/147';

const ui = {
    grid: document.getElementById('match-grid'),
    empty: document.getElementById('empty-state'),
    stage: document.getElementById('stage-name')
};

const accents = ['#ffd46f', '#b8a0ff', '#f598c9', '#8dd7ff', '#ffb68f', '#ffc2e2'];
const tilts = ['-1deg', '.8deg', '-.7deg', '.9deg', '-.8deg', '.7deg'];

let signature = '';
let relativeTimer;

const setScale = () => {
    const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    document.documentElement.style.setProperty('--overlay-scale', scale);
};

const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const requestedStage = () => {
    const params = new URLSearchParams(location.search);
    return {
        id: Number(params.get('stageId')) || 0,
        name: params.get('stage') || 'finals'
    };
};

const findStage = stages => {
    const requested = requestedStage();
    return stages.find(stage => requested.id && stage.id === requested.id)
        || stages.find(stage => normalize(stage.name) === normalize(requested.name))
        || stages.find(stage => normalize(stage.name) === 'finals');
};

const formatDate = timestamp => new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric'
}).format(new Date(timestamp)).toUpperCase();

const matchTimestamp = match => {
    const date = new Date(Number(match.date));
    const [hours, minutes] = String(match.time || '00:00').split(':').map(Number);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hours || 0, minutes || 0);
};

const plural = (value, unit) => `${value} ${unit}${value === 1 ? '' : 'S'}`;

const relativeText = timestamp => {
    const difference = timestamp - Date.now();
    const future = difference > 0;
    const absolute = Math.abs(difference);
    if (absolute < 30000) return 'STARTING NOW';
    const totalMinutes = future ? Math.ceil(absolute / 60000) : Math.floor(absolute / 60000);
    if (totalMinutes < 1) return 'STARTING NOW';
    if (totalMinutes < 60) return future
        ? `${plural(totalMinutes, 'MINUTE')} FROM NOW`
        : `${plural(totalMinutes, 'MINUTE')} AGO`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const duration = minutes ? `${hours}H ${minutes}M` : plural(hours, 'HOUR');
    return future ? `${duration} FROM NOW` : `${duration} AGO`;
};

const updateRelativeTimes = () => {
    document.querySelectorAll('.relative-time').forEach(element => {
        element.textContent = relativeText(Number(element.dataset.timestamp));
    });
    clearTimeout(relativeTimer);
    relativeTimer = setTimeout(updateRelativeTimes, 1000 - Date.now() % 1000 + 5);
};

const playerNames = match => {
    const solo = match.qualifierSoloParticipants || [];
    const teams = match.qualifierTeamParticipants || [];
    const names = solo.map(entry => entry.user?.userOsu?.username || entry.user?.username)
        .concat(teams.map(entry => entry.team?.name || entry.name));
    if (match.playerOne?.user?.username) names.push(match.playerOne.user.username);
    if (match.playerTwo?.user?.username) names.push(match.playerTwo.user.username);
    return names.filter(Boolean);
};

const refereeNames = match => (match.assignedReferees || [])
    .map(entry => entry.user?.userOsu?.username || entry.user?.username)
    .filter(Boolean);

const createMatchCard = (match, index) => {
    const card = document.createElement('article');
    card.className = 'match-card';
    card.style.setProperty('--accent', accents[index % accents.length]);
    card.style.setProperty('--label-tilt', tilts[(index + 2) % tilts.length]);

    const lobby = document.createElement('div');
    lobby.className = 'lobby-sticker';
    lobby.textContent = `LOBBY ${match.label || match.qualifierIdentifier || String.fromCharCode(65 + index)}`;

    const time = document.createElement('div');
    time.className = 'match-time';
    const day = document.createElement('span');
    day.textContent = match.date ? formatDate(match.date) : '—';
    const hour = document.createElement('strong');
    hour.textContent = match.time ? `${match.time} UTC` : '—';
    const relative = document.createElement('div');
    relative.className = 'relative-time';
    relative.dataset.timestamp = matchTimestamp(match);
    relative.textContent = relativeText(Number(relative.dataset.timestamp));
    time.append(day, hour);

    const list = document.createElement('div');
    list.className = 'player-list';
    list.replaceChildren(...playerNames(match).map(name => {
        const player = document.createElement('div');
        player.className = 'player';
        player.textContent = name;
        return player;
    }));

    const footer = document.createElement('div');
    footer.className = 'match-footer';
    const label = document.createElement('span');
    label.textContent = 'REFEREE';
    const referee = document.createElement('strong');
    referee.textContent = refereeNames(match).join(' · ') || '—';
    footer.append(label, referee);

    card.append(lobby, time, list, footer, relative);
    return card;
};

const render = stage => {
    const matches = (stage?.matches || []).filter(match => !match.softDeleted);
    const nextSignature = JSON.stringify(matches.map(match => [match.id, match.date, match.time, playerNames(match), refereeNames(match)]));
    ui.stage.textContent = stage?.name?.toUpperCase() || requestedStage().name.toUpperCase();
    if (nextSignature === signature) return;
    signature = nextSignature;
    ui.grid.replaceChildren(...matches.map(createMatchCard));
    ui.empty.classList.toggle('visible', !matches.length);
    updateRelativeTimes();
};

const load = async () => {
    try {
        const response = await fetch(`${endpoint}?t=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(String(response.status));
        const stages = await response.json();
        render(findStage(stages));
    } catch {
        if (!signature) render({ name: requestedStage().name, matches: [] });
    }
};

window.addEventListener('resize', setScale);
setScale();
load();
setInterval(load, 60000);
