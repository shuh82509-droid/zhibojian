$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$remote = 'fandow-deploy@120.27.143.111'
$runtimeDir = '/home/fandow-deploy/fandow-apps/runtime/fd-027340/live-center-workbench'
$incomingDir = '/home/fandow-deploy/fandow-apps/incoming/fd-027340/live-center-workbench'
$bundleName = "live-center-minimax-$([DateTime]::UtcNow.ToString('yyyyMMddHHmmss')).tar.gz"
$bundlePath = Join-Path $env:TEMP $bundleName
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
  & tar -czf $bundlePath --exclude=runtime/collaboration-center/node_modules --exclude=runtime/collaboration-center/.next --exclude=runtime/collaboration-center/dist --exclude=runtime/collaboration-center/.wrangler Dockerfile server.js container-entrypoint.sh deploy-remote.sh site exports/morning-dashboard exports/recruitment-pool exports/anchor-archives exports/material-center runtime/collaboration-center
  if ($LASTEXITCODE -ne 0) { throw 'Local packaging failed.' }
  Write-Host '[1/4] Preparing server directories. Enter the SSH password.' -ForegroundColor Yellow
  Invoke-TransportRetry -FailureMessage 'Preparing the server upload directory failed after 3 attempts.' -Action { & ssh @sshOptions $remote "mkdir -p '$runtimeDir' '$incomingDir'" }
  Write-Host '[2/4] Uploading the secure MiniMax setup helper. Enter the SSH password.' -ForegroundColor Yellow
  Invoke-TransportRetry -FailureMessage 'MiniMax setup helper upload failed after 3 attempts.' -Action { & scp @sshOptions (Join-Path $projectRoot 'configure-minimax-server.sh') "${remote}:$incomingDir/configure-minimax-server.sh" }
  Write-Host '[3/4] Uploading the application update. Enter the SSH password.' -ForegroundColor Yellow
  Invoke-TransportRetry -FailureMessage 'Application update upload failed after 3 attempts.' -Action { & scp @sshOptions $bundlePath "${remote}:$incomingDir/$bundleName" }
  Write-Host '[4/4] Configuring MiniMax and deploying. Enter SSH/sudo passwords when prompted.' -ForegroundColor Yellow
  $remoteCommand = "set -eu; cd '$runtimeDir'; chmod 700 '$incomingDir/configure-minimax-server.sh'; '$incomingDir/configure-minimax-server.sh'; tar -tzf '$incomingDir/$bundleName' | grep -E '(^/|(^|/)[.][.](/|`$))' && exit 1 || true; tar -xzf '$incomingDir/$bundleName' -C '$runtimeDir'; rm -f '$incomingDir/$bundleName' '$incomingDir/configure-minimax-server.sh'; chmod 700 deploy-remote.sh; ./deploy-remote.sh"
  & ssh @sshOptions -tt $remote $remoteCommand
  if ($LASTEXITCODE -ne 0) { throw 'MiniMax deployment failed; copy the terminal output back to Codex.' }
} finally {
  Pop-Location
  if (Test-Path -LiteralPath $bundlePath) { Remove-Item -LiteralPath $bundlePath -Force }
}
