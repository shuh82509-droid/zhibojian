#!/bin/sh
set -eu

cd /app/collaboration
npm run start -- --hostname 127.0.0.1 --port 3001 &
collaboration_pid=$!

cd /app
node server.js &
workbench_pid=$!

trap 'kill "$collaboration_pid" "$workbench_pid" 2>/dev/null || true' INT TERM EXIT
wait "$workbench_pid"
