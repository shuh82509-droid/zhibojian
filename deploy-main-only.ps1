$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$remote = 'fandow-deploy@120.27.143.111'
$incoming = '/home/fandow-deploy/fandow-apps/incoming/fd-027340/live-hub-optimized'
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddHHmmss')
$targetDate = [DateTime]::Now.ToString('yyyy-MM-dd')
$bundle = Join-Path $env:TEMP "fd-027340-live-hub-main-$stamp.tar.gz"
$remoteBundle = "$incoming/live-hub-main-$stamp.tar.gz"
$remoteScript = "$incoming/deploy-live-hub-v3.sh"
$identityFile = Join-Path $env:USERPROFILE '.ssh\codex-fandow-deploy-ed25519'
$sshOptions = @('-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'StrictHostKeyChecking=accept-new')
if (Test-Path -LiteralPath $identityFile) {
  $sshOptions += @('-i', $identityFile, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes')
}

Push-Location $projectRoot
try {
  & tar -czf $bundle Dockerfile.live-hub-v3-main Dockerfile.live-hub-v3-data server.js calendar-user-reader.mjs calendar-auth-http.mjs frame-policy.mjs lifecycle-engine.mjs container-entrypoint.sh site exports/recruitment-pool exports/anchor-archives exports/material-center runtime/collaboration-center/dist runtime/data-center/dist
  if ($LASTEXITCODE -ne 0) { throw 'Packaging the main candidate failed.' }
  & ssh @sshOptions $remote "mkdir -p '$incoming'"
  if ($LASTEXITCODE -ne 0) { throw 'Preparing the remote incoming directory failed.' }
  & scp @sshOptions $bundle "${remote}:$remoteBundle"
  if ($LASTEXITCODE -ne 0) { throw 'Uploading the main candidate failed.' }
  & scp @sshOptions (Join-Path $projectRoot 'deploy-live-hub-v3.sh') "${remote}:$remoteScript"
  if ($LASTEXITCODE -ne 0) { throw 'Uploading the main deployment helper failed.' }
  & ssh @sshOptions -tt $remote "'$remoteScript' '$remoteBundle' '$targetDate'"
  if ($LASTEXITCODE -ne 0) { throw 'Main candidate verification or production deployment failed.' }
} finally {
  Pop-Location
  if (Test-Path -LiteralPath $bundle) { Remove-Item -LiteralPath $bundle -Force }
}
