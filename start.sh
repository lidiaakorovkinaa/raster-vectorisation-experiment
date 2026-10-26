#!/bin/bash
set -e
cd "$(dirname "$0")"
NODE_BIN="${NODE_BIN:-}"
if [ -z "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node || true)"
fi
if [ -z "$NODE_BIN" ] && [ -x "/Users/lidia/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node" ]; then
  NODE_BIN="/Users/lidia/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node"
fi
if [ -z "$NODE_BIN" ]; then
  echo "Node.js не найден. Укажите NODE_BIN=/path/to/node ./start.sh" >&2
  exit 1
fi
if [ ! -f dist/index.html ]; then
  echo "Сборка клиента не найдена. Сначала выполните ./build.sh" >&2
  exit 1
fi
exec "$NODE_BIN" server/index.js "$@"
