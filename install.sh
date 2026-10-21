#!/usr/bin/env bash
# 从本仓库恢复 Pi 插件
#
#   ./install.sh            用仓库里备份的源码安装（离线可用）
#   ./install.sh --npm      按锁定版本从 npm 安装（需要联网）
#   ./install.sh --dry-run  只打印将要执行的命令，不真正安装
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="local"
DRY=0

usage() {
  sed -n '2,7p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

for arg in "$@"; do
  case "$arg" in
    --npm) MODE="npm" ;;
    --local) MODE="local" ;;
    --dry-run) DRY=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数：$arg（试试 --help）" >&2; exit 1 ;;
  esac
done

if ! command -v pi >/dev/null 2>&1; then
  echo "找不到 pi 命令，请先安装 Pi Coding Agent。" >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "需要 python3 读取 packages.json（只用来解析清单，不装包）。" >&2
  exit 1
fi

mapfile -t ENTRIES < <(
  python3 - "$ROOT/packages.json" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as fh:
    data = json.load(fh)
for p in data["plugins"]:
    print("%s\t%s" % (p["package"], p["version"]))
PY
)

if [ "${#ENTRIES[@]}" -eq 0 ]; then
  echo "packages.json 里没有插件记录。" >&2
  exit 1
fi

echo "安装模式：$MODE    共 ${#ENTRIES[@]} 个插件"
echo

failed=()
for entry in "${ENTRIES[@]}"; do
  pkg="${entry%%$'\t'*}"
  ver="${entry##*$'\t'}"
  if [ "$MODE" = "npm" ]; then
    target="npm:${pkg}@${ver}"
  else
    target="$ROOT/packages/$pkg"
    if [ ! -f "$target/package.json" ]; then
      echo "跳过 $pkg：备份目录缺失 $target" >&2
      failed+=("$pkg")
      continue
    fi
  fi

  if [ "$DRY" -eq 1 ]; then
    echo "[dry-run] pi install $target"
    continue
  fi

  echo ">>> pi install $target"
  if ! pi install "$target"; then
    echo "!!! 安装失败：$pkg" >&2
    failed+=("$pkg")
  fi
done

echo
if [ "${#failed[@]}" -gt 0 ]; then
  echo "以下插件安装失败，请手动检查：" >&2
  printf '  - %s\n' "${failed[@]}" >&2
  exit 1
fi

if [ "$DRY" -eq 0 ]; then
  echo "全部完成。回到 Pi 里执行 /reload 让插件生效。"
else
  echo "（dry-run，没有实际改动）"
fi
