// env.mjs — 路径注册表：server.mjs 启动时 configurePaths 一次，各模块经 P 取用。
// 之所以集中：lib 模块彼此独立、无循环依赖，路径是它们唯一的共享前置条件。
export const P = {}

export function configurePaths(p) {
  for (const k of Object.keys(p)) P[k] = p[k]
}
