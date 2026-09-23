#!/usr/bin/env bash
set -euo pipefail

container="${1:-fd-027340-live-center-workbench}"
docker exec -i "$container" node - <<'NODE'
const endpoint = 'http://127.0.0.1:3000/fd-027340/live-center-workbench/api/feishu/resource?url=https%3A%2F%2Finternal-api-lark-file.feishu.cn%2Fdownload%2Fmessages%2Finvalid-regression%2Fkeys%2Finvalid-regression';
const response = await fetch(endpoint);
const body = await response.text();
const result = {status: response.status, structured: body.includes('"ok":false')};
console.log(JSON.stringify(result));
if (response.status !== 502 || !result.structured) process.exit(22);
NODE
docker exec "$container" node -e "fetch('http://127.0.0.1:3000/healthz').then(response=>{if(response.status!==200)process.exit(23)}).catch(()=>process.exit(24))"
echo 'FEISHU_RESOURCE_ERROR_BOUNDARY=passed'
