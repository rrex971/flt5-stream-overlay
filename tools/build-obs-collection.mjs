import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const originalPath = process.argv[2] || 'C:/Users/rohit/Downloads/FLT5.json'
const outputPath = path.join(root, 'obs', 'FLT5-portable.json')
const original = JSON.parse(fs.readFileSync(originalPath, 'utf8'))
const captureTemplate = original.sources.find(source => source.id === 'game_capture')
const browserTemplate = original.sources.find(source => source.id === 'browser_source')
const sceneTemplate = original.sources.find(source => source.id === 'scene')
const stingerPath = path.join(root, 'obs', 'flt5-stinger.webm').replaceAll('\\', '/')
const streamkitUrl = 'https://streamkit.discord.com/overlay/voice/996440757525291078/1001575456178458724?icon=true&online=true&logo=white&text_color=%23ffffff&text_size=14&text_outline_color=%23000000&text_outline_size=0&text_shadow_color=%23000000&text_shadow_size=0&bg_color=%231e2124&bg_opacity=0.95&bg_shadow_color=%23000000&bg_shadow_size=0&invite_code=&limit_speaking=false&small_avatars=false&hide_names=false&fade_chat=0&streamer_avatar_first=false'
const css = `*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;background:transparent!important;overflow:hidden!important}body{font-family:"Arial Rounded MT Bold","Trebuchet MS",sans-serif;color:#5f35af}ul[class*="Voice_voiceStates"]{display:flex!important;width:100%;height:100%;margin:0!important;padding:61px 8px 8px!important;align-items:flex-end!important;justify-content:center!important;gap:14px!important;list-style:none}li[class*="Voice_voiceState"]{display:flex!important;flex:0 1 112px!important;min-width:0!important;height:92px!important;margin:0!important;padding:0!important;align-items:center!important;flex-direction:column!important;justify-content:flex-end!important;gap:6px!important;border:0!important;background:transparent!important;box-shadow:none!important;transform:none!important;transition:transform 150ms cubic-bezier(.16,1,.3,1)!important}li[class*="Voice_voiceState"]:has(img[class*="Voice_avatarSpeaking"]){transform:translateY(-2px)!important}img[class*="Voice_avatar"]{position:static!important;width:52px!important;height:52px!important;margin:0!important;border:0!important;border-radius:12px 8px 13px 9px!important;box-shadow:0 3px 0 #de629f!important;object-fit:cover}img[class*="Voice_avatarSpeaking"]{border:0!important;box-shadow:0 0 0 4px #ed70ae,0 3px 0 4px #de629f!important}div[class*="Voice_user"]{position:static!important;width:100%!important;min-width:0!important;padding:0!important}span[class*="Voice_name"]{display:block!important;position:static!important;width:100%!important;margin:0!important;padding:0!important;overflow:hidden!important;color:#5f35af!important;font:14px/1 "Arial Rounded MT Bold","Trebuchet MS",sans-serif!important;font-weight:800!important;text-align:center!important;text-overflow:ellipsis!important;white-space:nowrap!important;background:transparent!important}svg[class*="Voice_logo"],div[class*="Voice_logo"]{display:none!important}`

fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(path.join(root, 'obs', 'discord-casters.css'), css)

const clone = value => JSON.parse(JSON.stringify(value))
const uuid = () => crypto.randomUUID()

function capture(index) {
    const source = clone(captureTemplate)
    source.name = `Tournament Client ${index}`
    source.uuid = uuid()
    source.settings.window = ` Tournament Client ${index}:WindowsForms10.Window.2b.app.0.1ca0192_r7_ad1:osu!.exe`
    source.hotkeys = {
        'libobs.mute': [],
        'libobs.unmute': [],
        'libobs.push-to-mute': [],
        'libobs.push-to-talk': [],
        hotkey_start: [],
        hotkey_stop: []
    }
    return source
}

function browser(name, url, width = 1920, height = 1080, customCss = '') {
    const source = clone(browserTemplate)
    source.name = name
    source.uuid = uuid()
    source.settings = { url, width, height, reroute_audio: false, shutdown: false }
    if (customCss) source.settings.css = customCss
    return source
}

function item(source, id, x, y, width = 0, height = 0, visible = true) {
    const bounded = width > 0 && height > 0
    return {
        name: source.name,
        source_uuid: source.uuid,
        visible,
        locked: true,
        rot: 0,
        scale_ref: { x: 1920, y: 1080 },
        align: 5,
        bounds_type: bounded ? 1 : 0,
        bounds_align: 0,
        bounds_crop: false,
        crop_left: 0,
        crop_top: 0,
        crop_right: 0,
        crop_bottom: 0,
        id,
        group_item_backup: false,
        pos: { x, y },
        pos_rel: { x: (x - 960) / 540, y: (y - 540) / 540 },
        scale: { x: 1, y: 1 },
        scale_rel: { x: 1, y: 1 },
        bounds: { x: bounded ? width : 0, y: bounded ? height : 0 },
        bounds_rel: { x: bounded ? width / 540 : 0, y: bounded ? height / 540 : 0 },
        scale_filter: bounded ? 'bicubic' : 'disable',
        blend_method: 'default',
        blend_type: 'normal',
        show_transition: { duration: 0 },
        hide_transition: { duration: 0 },
        private_settings: {}
    }
}

function scene(name, orderedSources) {
    const source = clone(sceneTemplate)
    source.name = name
    source.uuid = uuid()
    source.settings = {
        custom_size: false,
        id_counter: orderedSources.length,
        items: orderedSources
    }
    source.hotkeys = { 'OBSBasic.SelectScene': [] }
    for (const sourceItem of orderedSources) {
        source.hotkeys[`libobs.show_scene_item.${sourceItem.id}`] = []
        source.hotkeys[`libobs.hide_scene_item.${sourceItem.id}`] = []
    }
    return source
}

const clients = Array.from({ length: 10 }, (_, index) => capture(index))
const gameplay8 = browser('FLT5 Gameplay Overlay - 8', 'http://127.0.0.1:24050/flt5-stream-overlay/gameplay/?clients=8')
const gameplay10 = browser('FLT5 Gameplay Overlay - 10', 'http://127.0.0.1:24050/flt5-stream-overlay/gameplay/?clients=10')
const casters = browser('FLT5 Discord Casters', streamkitUrl, 286, 180, css)
const pool = browser('FLT5 Pool Showcase Overlay', 'http://127.0.0.1:24050/flt5-stream-overlay/pool-showcase/')
const seed = browser('FLT5 Seed Reveal Overlay', 'http://127.0.0.1:24050/flt5-stream-overlay/seed-reveal/')
const schedule = browser('FLT5 Schedule Overlay', 'http://127.0.0.1:24050/flt5-stream-overlay/schedule/?stage=finals')
const holdingCasters = browser('FLT5 Holding Casters', streamkitUrl, 390, 294, `${css}ul[class*="Voice_voiceStates"]{padding:48px 10px 14px!important;align-items:center!important;gap:12px!important}li[class*="Voice_voiceState"]{height:116px!important}img[class*="Voice_avatar"]{width:68px!important;height:68px!important}span[class*="Voice_name"]{font-size:18px!important;line-height:1.15!important}`)
const starting = browser('FLT5 Starting Soon Overlay', 'http://127.0.0.1:24050/flt5-stream-overlay/intermission/?mode=starting')
const ending = browser('FLT5 Ending Soon Overlay', 'http://127.0.0.1:24050/flt5-stream-overlay/intermission/?mode=ending')
const technical = browser('FLT5 Technical Difficulties Overlay', 'http://127.0.0.1:24050/flt5-stream-overlay/intermission/?mode=technical')
const finalsWinners = browser('FLT5 Finals Winners Overlay', 'http://127.0.0.1:24050/flt5-stream-overlay/finals-winners/')
for (const source of [starting, ending, technical, finalsWinners]) source.settings.shutdown = true

const grid8 = [
    [19, 153, 381, 286], [416, 153, 381, 286], [813, 153, 381, 286], [1210, 153, 381, 286],
    [19, 465, 381, 286], [416, 465, 381, 286], [813, 465, 381, 286], [1210, 465, 381, 286]
]
const grid10 = [
    [19, 188, 300, 225], [334, 188, 300, 225], [649, 188, 300, 225], [964, 188, 300, 225], [1279, 188, 300, 225],
    [19, 490, 300, 225], [334, 490, 300, 225], [649, 490, 300, 225], [964, 490, 300, 225], [1279, 490, 300, 225]
]

const scene8 = scene('Gameplay - 8 Players', [
    ...grid8.map(([x, y, width, height], index) => item(clients[index], index + 1, x, y, width, height)),
    item(gameplay8, 9, 0, 0),
    item(casters, 10, 1610, 844)
])
const scene10 = scene('Gameplay - 10 Players', [
    ...grid10.map(([x, y, width, height], index) => item(clients[index], index + 1, x, y, width, height)),
    item(gameplay10, 11, 0, 0)
])
const poolScene = scene('Pool Showcase', [
    item(clients[0], 1, 28, 144, 1408, 792),
    item(pool, 2, 0, 0)
])
const seedScene = scene('Seed Reveal', [item(seed, 1, 0, 0)])
const scheduleScene = scene('Schedule', [item(schedule, 1, 0, 0)])
const startingScene = scene('Starting Soon', [item(starting, 1, 0, 0), item(holdingCasters, 2, 1500, 720)])
const endingScene = scene('Ending Soon', [item(ending, 1, 0, 0), item(holdingCasters, 2, 1500, 720)])
const technicalScene = scene('Technical Difficulties', [item(technical, 1, 0, 0), item(holdingCasters, 2, 1500, 720)])
const finalsWinnersScene = scene('Finals Winners', [item(finalsWinners, 1, 0, 0)])
const scenes = [scene8, scene10, poolScene, seedScene, scheduleScene, startingScene, endingScene, technicalScene, finalsWinnersScene]

const collection = clone(original)
collection.name = 'FLT5 Portable'
delete collection.DesktopAudioDevice1
delete collection.AuxAudioDevice1
collection.groups = []
collection.scene_order = scenes.map(source => ({ name: source.name }))
collection.current_scene = scene8.name
collection.current_program_scene = scene8.name
collection.current_transition = 'FLT5 Stinger'
collection.transition_duration = 1400
collection.transitions = [{
    name: 'FLT5 Stinger',
    id: 'obs_stinger_transition',
    settings: { path: stingerPath, transition_point: 700 }
}]
collection.quick_transitions = [
    { name: 'Cut', duration: 300, hotkeys: [], id: 1, fade_to_black: false },
    { name: 'Fade', duration: 300, hotkeys: [], id: 2, fade_to_black: false },
    { name: 'FLT5 Stinger', duration: 1400, hotkeys: [], id: 3, fade_to_black: false }
]
collection.saved_projectors = []
collection.preview_locked = true
collection.sources = [...clients, gameplay8, gameplay10, casters, pool, seed, schedule, holdingCasters, starting, ending, technical, finalsWinners, ...scenes]

fs.writeFileSync(outputPath, `${JSON.stringify(collection, null, 2)}\n`)
console.log(outputPath)
