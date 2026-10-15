#!/usr/bin/env bash
# 课程信息板一键部署：本地构建 → 打包 → scp → 远程解压 → 重启 systemd 用户服务 → 验证
#
# 用法:
#   bash deploy.sh                 全量：前端 dist + 入口 server.mjs + 后端 backend/server.mjs
#   bash deploy.sh --frontend-only 只发前端 dist（静态服务现读文件，无需重启、零中断）
#   bash deploy.sh --backend-only  只发后端 backend/server.mjs（重启 classinfo-backend）
#   bash deploy.sh --help          显示本帮助
#
# 可用环境变量覆盖目标（默认即生产板）:
#   DEPLOY_HOST=ahgs-lan      SSH 主机（~/.ssh/config 里的别名）
#   DEPLOY_DIR=classinfo-board  远程应用目录（位于 ~ 下）
#   DEPLOY_WEB=5173           远程 web 端口（验证用）
#
# 红线：本脚本永不触碰服务器上的 backend/data/（那是唯一权威数据）。
# 后端必须保持零依赖约定：引了 npm 包此流程即失效，需先在远程装依赖。

set -euo pipefail
cd "$(dirname "$0")"

HOST="${DEPLOY_HOST:-ahgs-lan}"
REMOTE_DIR="${DEPLOY_DIR:-classinfo-board}"
WEB_PORT="${DEPLOY_WEB:-5173}"
MODE="full"
case "${1:-}" in
  --frontend-only) MODE="fe" ;;
  --backend-only)  MODE="be" ;;
  --help|-h) grep '^# ' "$0" | sed 's/^# //'; exit 0 ;;
  "") ;;
  *) echo "未知参数: $1（支持 --frontend-only / --backend-only / --help）"; exit 1 ;;
esac

echo "==> [1/4] 本地构建（npm run build）"
npm run build >/dev/null
[ -f dist/index.html ] || { echo "✗ 构建产物缺失 dist/index.html"; exit 1; }

echo "==> [2/4] 打包"
TARBALL="$(mktemp /tmp/cb-deploy-XXXXXX.tar.gz)"
trap 'rm -f "$TARBALL"' EXIT
case "$MODE" in
  fe)    tar -czf "$TARBALL" dist;                             PARTS="前端 dist" ;;
  be)    tar -czf "$TARBALL" backend/server.mjs;               PARTS="后端 backend/server.mjs" ;;
  full)  tar -czf "$TARBALL" dist server.mjs backend/server.mjs; PARTS="dist + server.mjs + backend/server.mjs" ;;
esac
echo "    内容: $PARTS（$(du -h "$TARBALL" | cut -f1)）"

echo "==> [3/4] 上传到 $HOST 并应用（~/$REMOTE_DIR）"
scp -q "$TARBALL" "$HOST:/tmp/cb-deploy.tar.gz"

# 服务端动作：fe 只换文件不重启；be/full 重启 backend（full 再重启 web）
ssh "$HOST" MODE="$MODE" REMOTE_DIR="$REMOTE_DIR" bash -s <<'REMOTE'
set -euo pipefail
APP="$HOME/$REMOTE_DIR"
[ -f "$APP/backend/server.mjs" ] || { echo "✗ 远程目录异常：$APP 不是部署目录"; exit 1; }
if [ "$MODE" != "be" ]; then
  rm -rf "$APP/dist"   # 先删再解压，避免旧 hash 资源堆积
fi
tar -xzf /tmp/cb-deploy.tar.gz -C "$APP"
if [ "$MODE" = "be" ]; then
  systemctl --user restart classinfo-backend
elif [ "$MODE" = "full" ]; then
  systemctl --user restart classinfo-backend
  sleep 1
  systemctl --user restart classinfo-web
fi
rm -f /tmp/cb-deploy.tar.gz
REMOTE

echo "==> [4/4] 验证（服务器本机自检）"
sleep 2
RESULT=$(ssh "$HOST" "curl -s -m 5 -o /dev/null -w '%{http_code} ' http://127.0.0.1:${WEB_PORT}/ && curl -s -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:${WEB_PORT}/api/session")
CODE_HTML=${RESULT%% *}
CODE_API=${RESULT##* }
if [ "$CODE_HTML" = "200" ] && [ "$CODE_API" = "401" ]; then
  LAN_IP=$(ssh "$HOST" 'hostname -I' | awk '{print $1}')
  echo "✓ 部署完成：页面 $CODE_HTML，API 代理 $CODE_API"
  echo "  访问: http://${LAN_IP}:${WEB_PORT}"
else
  echo "✗ 验证未通过：页面 $CODE_HTML（期待 200），API $CODE_API（期待 401）"
  echo "  排查: ssh $HOST -- journalctl --user -u classinfo-backend -n 20 -o cat"
  exit 1
fi
