#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

claude_dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

if [ ! -d "$claude_dir/projects" ]; then
  echo "warning: $claude_dir/projects doesn't exist. Run Claude Code once on this machine, or set CLAUDE_DIR in .env." >&2
fi

# Docker would otherwise create this folder as root on Linux, and Claude Code couldn't write to it.
mkdir -p "$claude_dir/sessions"

if [ -f .env ]; then
  echo ".env already exists, leaving it unchanged."
else
  cat > .env <<EOF
NEBULA_PORT=7878
CLAUDE_DIR=$claude_dir
UID=$(id -u)
GID=$(id -g)
EOF
  echo "Wrote .env (Claude folder: $claude_dir, user: $(id -u):$(id -g))."
fi

port=$(sed -n 's/^NEBULA_PORT=//p' .env)
echo "Next: docker compose up -d --build, then open http://localhost:${port:-7878}"
