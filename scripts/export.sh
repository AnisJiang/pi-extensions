#!/usr/bin/env bash
# 把本机当前安装的 Pi 插件重新导出到本仓库
#
#   ./scripts/export.sh           按 ~/.pi/agent/settings.json 里的 packages 顺序导出
#   ./scripts/export.sh --prune   额外删除仓库里已不再安装的旧插件目录
#
# 导出内容：每个包的原样文件（剔除 node_modules / .git），外加刷新 packages.json。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
MODULES="$AGENT_DIR/npm/node_modules"
SETTINGS="$AGENT_DIR/settings.json"
PRUNE=0
[ "${1:-}" = "--prune" ] && PRUNE=1

[ -d "$MODULES" ] || { echo "找不到 $MODULES，本机还没装过任何插件？" >&2; exit 1; }
command -v python3 >/dev/null || { echo "需要 python3" >&2; exit 1; }

mapfile -t PKGS < <(
  python3 - "$SETTINGS" "$MODULES" <<'PY'
import json, os, sys
settings, modules = sys.argv[1], sys.argv[2]
names = []
if os.path.isfile(settings):
    try:
        with open(settings, encoding="utf-8") as fh:
            cfg = json.load(fh)
        for item in cfg.get("packages", []):
            name = item[4:] if item.startswith("npm:") else item
            if name.startswith("git:") or name.startswith("file:") or name.startswith("/"):
                continue
            names.append(name)
    except Exception as exc:
        print("读取 settings.json 失败：%s" % exc, file=sys.stderr)
if not names:
    for entry in sorted(os.listdir(modules)):
        path = os.path.join(modules, entry)
        if entry.startswith("."):
            continue
        if entry.startswith("@") and os.path.isdir(path):
            names += ["%s/%s" % (entry, sub) for sub in sorted(os.listdir(path))]
        elif os.path.isdir(path):
            names.append(entry)
seen, out = set(), []
for name in names:
    if name in seen:
        continue
    seen.add(name)
    if os.path.isfile(os.path.join(modules, name, "package.json")):
        out.append(name)
print("\n".join(out))
PY
)

[ "${#PKGS[@]}" -gt 0 ] || { echo "没有解析到可导出的插件。" >&2; exit 1; }

mkdir -p "$ROOT/packages"
for pkg in "${PKGS[@]}"; do
  echo ">>> 导出 $pkg"
  mkdir -p "$ROOT/packages/$pkg"
  cp -a "$MODULES/$pkg/." "$ROOT/packages/$pkg"/
  rm -rf "$ROOT/packages/$pkg/node_modules" "$ROOT/packages/$pkg/.git"
done

python3 - "$ROOT" "$AGENT_DIR" <<'PY'
import json, os, sys

root, agent_dir = sys.argv[1], sys.argv[2]
order = [
    "@lokiyou/pi-web-search",
    "@ff-labs/pi-fff",
    "@juicesharp/rpiv-ask-user-question",
    "@fradser/pi-monitor",
    "@fradser/pi-memory",
    "@narumitw/pi-goal",
    "@narumitw/pi-btw",
    "pi-context-kit",
    "pi-simplify",
    "pi-cc-extensions",
]
found = []
base = os.path.join(root, "packages")
for dirpath, _dirs, files in os.walk(base):
    if "package.json" in files:
        found.append(os.path.relpath(dirpath, base).replace(os.sep, "/"))
found.sort(key=lambda n: (order.index(n) if n in order else 999, n))

plugins = []
for name in found:
    pkgdir = os.path.join(base, name)
    with open(os.path.join(pkgdir, "package.json"), encoding="utf-8") as fh:
        d = json.load(fh)
    repo = d.get("repository") or {}
    if isinstance(repo, dict):
        url, subdir = repo.get("url", "") or "", repo.get("directory")
    else:
        url, subdir = str(repo), None
    url = url[4:] if url.startswith("git+") else url
    url = url[:-4] if url.endswith(".git") else url
    lic = d.get("license", "")
    if isinstance(lic, dict):
        lic = lic.get("type", "")
    files_count = sum(len(fs) for _r, _d, fs in os.walk(pkgdir))
    plugins.append({
        "package": d["name"],
        "version": d["version"],
        "path": "packages/%s" % name,
        "description": d.get("description", ""),
        "license": lic,
        "upstream": url,
        "upstreamDirectory": subdir,
        "entry": (d.get("pi", {}) or {}).get("extensions"),
        "files": files_count,
    })

manifest = {
    "agent": "Pi Coding Agent",
    "sourceNodeModules": os.path.join(agent_dir, "npm/node_modules"),
    "note": "本清单按本机实际安装的依赖导出；packages/ 为第三方包原样备份（已剔除 node_modules），版权归各上游作者所有。",
    "count": len(plugins),
    "plugins": plugins,
}
with open(os.path.join(root, "packages.json"), "w", encoding="utf-8") as fh:
    json.dump(manifest, fh, ensure_ascii=False, indent=2)
    fh.write("\n")
print("packages.json 已刷新：%d 个插件" % len(plugins))
PY

if [ "$PRUNE" -eq 1 ]; then
  python3 - "$ROOT" <<'PY'
import json, os, shutil, sys
root = sys.argv[1]
with open(os.path.join(root, "packages.json"), encoding="utf-8") as fh:
    keep = {p["path"] for p in json.load(fh)["plugins"]}
base = os.path.join(root, "packages")
for dirpath, dirs, files in os.walk(base, topdown=False):
    rel = os.path.relpath(dirpath, root).replace(os.sep, "/")
    if "package.json" in files and rel not in keep:
        print("删除已不存在的插件目录：%s" % rel)
        shutil.rmtree(dirpath)
for scope in os.listdir(base):
    scope_path = os.path.join(base, scope)
    if scope.startswith("@") and os.path.isdir(scope_path) and not os.listdir(scope_path):
        os.rmdir(scope_path)
PY
fi
