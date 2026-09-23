$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$remote = 'fandow-deploy@120.27.143.111'
$runtimeDir = '/home/fandow-deploy/fandow-apps/runtime/fd-027340/live-center-workbench'
$moduleDir = '/home/fandow-deploy/fandow-apps/incoming/fd-027340/live-hub-optimized'
$bundleName = "live-hub-optimized-$([DateTime]::UtcNow.ToString('yyyyMMddHHmmss')).tar.gz"
$mainBundle = Join-Path $env:TEMP $bundleName
$dataBundle = Join-Path $env:TEMP 'fd-027340-data-center-optimized.tar.gz'
$dispatchBundle = Join-Path $env:TEMP 'fd-027340-dispatch-center-optimized.tar.gz'
$sshOptions = @('-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'StrictHostKeyChecking=accept-new')

function Invoke-TransportRetry {
  param([Parameter(Mandatory = $true)][scriptblock]$Action,[Parameter(Mandatory = $true)][string]$FailureMessage,[int]$Attempts = 3)
  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    & $Action
    if ($LASTEXITCODE -eq 0) { return }
    if ($attempt -lt $Attempts) { Write-Host "SSH transport was interrupted. Retrying ($($attempt + 1)/$Attempts)..." -ForegroundColor Yellow; Start-Sleep -Seconds 2 }
  }
  throw $FailureMessage
}

Push-Location $projectRoot
try {
  & tar -czf $mainBundle --exclude=runtime/collaboration-center/node_modules --exclude=runtime/collaboration-center/.next --exclude=runtime/collaboration-center/dist --exclude=runtime/collaboration-center/.wrangler Dockerfile server.js calendar-user-reader.mjs calendar-auth-http.mjs frame-policy.mjs lifecycle-engine.mjs container-entrypoint.sh deploy-remote.sh site exports/morning-dashboard exports/recruitment-pool exports/anchor-archives exports/material-center runtime/collaboration-center
  if ($LASTEXITCODE -ne 0) { throw 'Packaging main workbench failed.' }
  & tar -czf $dataBundle --exclude=node_modules --exclude=.next --exclude=dist --exclude=.wrangler --exclude=.env -C (Join-Path $projectRoot 'runtime') data-center
  if ($LASTEXITCODE -ne 0) { throw 'Packaging data center failed.' }
  & tar -czf $dispatchBundle --exclude=node_modules --exclude=dist --exclude=.wrangler --exclude=.env -C (Join-Path $projectRoot 'runtime') dispatch-center
  if ($LASTEXITCODE -ne 0) { throw 'Packaging dispatch center failed.' }

  Write-Host '[1/3] Preparing the server upload directory. Enter the SSH password.' -ForegroundColor Yellow
  Invoke-TransportRetry -FailureMessage 'Preparing the server upload directory failed after 3 attempts.' -Action { & ssh @sshOptions $remote "mkdir -p '$runtimeDir' '$moduleDir'" }

  Write-Host '[2/3] Uploading the single release bundle. Enter the SSH password when prompted.' -ForegroundColor Yellow
  Invoke-TransportRetry -FailureMessage 'Uploading the main workbench bundle failed.' -Action { & scp @sshOptions $mainBundle "${remote}:$moduleDir/main.tar.gz" }
  Invoke-TransportRetry -FailureMessage 'Uploading the data center bundle failed.' -Action { & scp @sshOptions $dataBundle "${remote}:$moduleDir/data-center.tar.gz" }
  Invoke-TransportRetry -FailureMessage 'Uploading the dispatch center bundle failed.' -Action { & scp @sshOptions $dispatchBundle "${remote}:$moduleDir/dispatch-center.tar.gz" }
  Invoke-TransportRetry -FailureMessage 'Uploading the deployment helper failed.' -Action { & scp @sshOptions (Join-Path $projectRoot 'update-live-data-modules.sh') "${remote}:$moduleDir/update-live-data-modules.sh" }

  Write-Host '[3/3] Rebuilding all three Docker containers. Enter the SSH password and sudo password when prompted.' -ForegroundColor Yellow
  $remoteCommand = "set -eu; cd '$runtimeDir'; test -s .env.coco; test -s .env.minimax; tar -tzf '$moduleDir/main.tar.gz' | grep -E '(^/|(^|/)[.][.](/|$))' && exit 1 || true; tar -xzf '$moduleDir/main.tar.gz' -C '$runtimeDir'; rm -f '$moduleDir/main.tar.gz'; chmod 700 deploy-remote.sh '$moduleDir/update-live-data-modules.sh'; ./deploy-remote.sh; '$moduleDir/update-live-data-modules.sh' '$moduleDir/data-center.tar.gz' '$moduleDir/dispatch-center.tar.gz'; rm -f '$moduleDir/data-center.tar.gz' '$moduleDir/dispatch-center.tar.gz' '$moduleDir/update-live-data-modules.sh'; echo 'LIVE_HUB_OPTIMIZED_DEPLOYMENT=passed'"
  & ssh @sshOptions -tt $remote $remoteCommand
  if ($LASTEXITCODE -ne 0) { throw 'Unified deployment stopped; copy the terminal output back to Codex.' }
} finally {
  Pop-Location
  @($mainBundle,$dataBundle,$dispatchBundle) | ForEach-Object { if (Test-Path -LiteralPath $_) { Remove-Item -LiteralPath $_ -Force } }
}
