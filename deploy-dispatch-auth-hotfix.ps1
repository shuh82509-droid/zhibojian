param([ValidateSet('candidate-only','production')][string]$Mode = 'candidate-only')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddHHmmss')
$bundle = Join-Path $env:TEMP "fd-027340-dispatch-auth-$stamp.tar.gz"
$remote = 'fandow-deploy@120.27.143.111'
$incoming = '/home/fandow-deploy/fandow-apps/incoming/fd-027340/live-hub-optimized'
$remoteBundle = "$incoming/dispatch-auth-$stamp.tar.gz"
$remoteScript = "$incoming/deploy-dispatch-parser-safe.sh"
$identityFile = Join-Path $env:USERPROFILE '.ssh\codex-fandow-deploy-ed25519'
$sshOptions = @('-i', $identityFile, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', '-o', 'StrictHostKeyChecking=accept-new')

Push-Location $projectRoot
try {
  & node --test 'runtime\dispatch-center\schedule-api-server.test.js' 'runtime\dispatch-center\single-level-shell.test.js' 'runtime\dispatch-center\planning-workbench.test.js'
  if ($LASTEXITCODE -ne 0) { throw 'Dispatch tests failed.' }
  & tar -czf $bundle -C runtime dispatch-center
  if ($LASTEXITCODE -ne 0) { throw 'Dispatch packaging failed.' }
  & scp @sshOptions $bundle "${remote}:$remoteBundle"
  if ($LASTEXITCODE -ne 0) { throw 'Dispatch upload failed.' }
  & scp @sshOptions (Join-Path $projectRoot 'deploy-dispatch-parser-safe.sh') "${remote}:$remoteScript"
  if ($LASTEXITCODE -ne 0) { throw 'Dispatch helper upload failed.' }
  $remoteCommand = "chmod 700 '$remoteScript'; '$remoteScript' '$remoteBundle' '2026-09-02' '1' '2026-09-02' '$Mode'"
  & ssh @sshOptions -tt $remote $remoteCommand
  if ($LASTEXITCODE -ne 0) { throw "Dispatch $Mode gate failed." }
} finally {
  Pop-Location
  if (Test-Path -LiteralPath $bundle) { Remove-Item -LiteralPath $bundle -Force }
}
