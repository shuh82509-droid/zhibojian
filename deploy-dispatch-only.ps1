$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$remote = 'fandow-deploy@120.27.143.111'
$incoming = '/home/fandow-deploy/fandow-apps/incoming/fd-027340/live-hub-optimized'
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddHHmmss')
$targetDate = [DateTime]::Now.ToString('yyyy-MM-dd')
$bundle = Join-Path $env:TEMP "fd-027340-dispatch-$stamp.tar.gz"
$remoteBundle = "$incoming/dispatch-$stamp.tar.gz"
$remoteScript = "$incoming/deploy-dispatch-parser-safe.sh"
$identityFile = Join-Path $env:USERPROFILE '.ssh\codex-fandow-deploy-ed25519'
$sshOptions = @('-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'StrictHostKeyChecking=accept-new')
if (Test-Path -LiteralPath $identityFile) {
  $sshOptions += @('-i', $identityFile, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes')
}

try {
  & tar -czf $bundle --exclude=node_modules --exclude=dist --exclude=.wrangler -C (Join-Path $projectRoot 'runtime') dispatch-center
  if ($LASTEXITCODE -ne 0) { throw 'Packaging the dispatch candidate failed.' }
  & ssh @sshOptions $remote "mkdir -p '$incoming'"
  if ($LASTEXITCODE -ne 0) { throw 'Preparing the remote incoming directory failed.' }
  & scp @sshOptions $bundle "${remote}:$remoteBundle"
  if ($LASTEXITCODE -ne 0) { throw 'Uploading the dispatch candidate failed.' }
  & scp @sshOptions (Join-Path $projectRoot 'deploy-dispatch-parser-safe.sh') "${remote}:$remoteScript"
  if ($LASTEXITCODE -ne 0) { throw 'Uploading the dispatch deployment helper failed.' }
  & ssh @sshOptions -tt $remote "bash '$remoteScript' '$remoteBundle' '$targetDate' '0'"
  if ($LASTEXITCODE -ne 0) { throw 'Dispatch candidate verification or production deployment failed.' }
} finally {
  if (Test-Path -LiteralPath $bundle) { Remove-Item -LiteralPath $bundle -Force }
}
