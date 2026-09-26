import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = process.argv[2]
if (!target) throw new Error('Provide the existing OBS collection path')
const current = JSON.parse(fs.readFileSync(target, 'utf8'))
const generated = JSON.parse(fs.readFileSync(path.join(root, 'obs', 'FLT5-portable.json'), 'utf8'))
const names = new Set(['FLT5 Holding Casters', 'FLT5 Starting Soon Overlay', 'FLT5 Ending Soon Overlay', 'FLT5 Technical Difficulties Overlay', 'FLT5 Finals Winners Overlay', 'Starting Soon', 'Ending Soon', 'Technical Difficulties', 'Finals Winners'])
const additions = generated.sources.filter(source => names.has(source.name))
const uuids = new Map(additions.map(source => [source.uuid, current.sources.find(existing => existing.name === source.name)?.uuid || source.uuid]))
for (const source of additions) {
    source.uuid = uuids.get(source.uuid)
    for (const item of source.settings.items || []) item.source_uuid = uuids.get(item.source_uuid) || item.source_uuid
    const index = current.sources.findIndex(existing => existing.name === source.name)
    if (index >= 0) current.sources[index] = source
    else current.sources.push(source)
    if (source.id === 'scene' && !current.scene_order.some(scene => scene.name === source.name)) current.scene_order.push({name: source.name})
}
fs.copyFileSync(target, `${target}.before-holding-scenes.bak`)
fs.writeFileSync(target, `${JSON.stringify(current, null, 2)}\n`)
console.log(`Updated ${target}; preserved existing scenes and source configuration`)
