// persist.mjs — 原子写入 + 滚动备份 + 损坏自恢复 + 启动清扫
// 所有 JSON 一律「写临时文件 → rename 原子替换」，进程崩溃/断电不会留下半个文件；
// 每次保存成功后快照到 data/backups/<kind>/ 滚动保留最近 BACKUP_KEEP 份；
// 启动加载发现主文件损坏时，由各 load* 从最新可用备份恢复，不再静默变空。
import path from 'node:path'
import { readdir, writeFile, readFile, mkdir, unlink, rename } from 'node:fs/promises'
import { P } from './env.mjs'

const BACKUP_KEEP = 20

export async function writeJsonAtomic(file, obj) {
  const tmp = `${file}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
  await writeFile(tmp, JSON.stringify(obj))
  await rename(tmp, file)
}

export async function backupJson(kind, obj) {
  try {
    const dir = path.join(P.DATA_DIR, 'backups', kind)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, Date.now() + '.json'), JSON.stringify(obj))
    const all = (await readdir(dir)).filter(f => f.endsWith('.json')).sort()
    for (const f of all.slice(0, Math.max(0, all.length - BACKUP_KEEP))) {
      await unlink(path.join(dir, f)).catch(() => {})
    }
  } catch (e) {
    console.error(`[backup] ${kind} 备份失败：`, e.message)
  }
}

export async function restoreLatestBackup(kind) {
  try {
    const dir = path.join(P.DATA_DIR, 'backups', kind)
    const files = (await readdir(dir)).filter(f => f.endsWith('.json')).sort().reverse()
    for (const f of files) {
      try { return JSON.parse(await readFile(path.join(dir, f), 'utf8')) } catch (e) { /* 试更早一份 */ }
    }
  } catch (e) { /* 无备份 */ }
  return null
}

// 启动时清掉上次崩溃残留的 .tmp 临时文件（此刻没有并发写者）
export async function cleanTmpFiles() {
  for (const dir of [P.DATA_DIR, P.ACCOUNTS_DIR]) {
    for (const f of await readdir(dir).catch(() => [])) {
      if (f.endsWith('.tmp')) await unlink(path.join(dir, f)).catch(() => {})
    }
  }
}
