$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$remote = 'fandow-deploy@120.27.143.111'
$runtimeDir = '/home/fandow-deploy/fandow-apps/runtime/fd-027340/live-center-workbench'
$sshOptions = @('-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'StrictHostKeyChecking=accept-new')

Write-Host 'Uploading the corrected runtime deployment script. Enter the SSH password.' -ForegroundColor Cyan
& scp @sshOptions (Join-Path $projectRoot 'deploy-remote.sh') "${remote}:$runtimeDir/deploy-remote.sh"
if ($LASTEXITCODE -ne 0) {
  throw 'Uploading the corrected deployment script failed.'
}

Write-Host 'Continuing with the files and Coco configuration already on the server.' -ForegroundColor Cyan
Write-Host 'Enter the SSH password, then any sudo password requested by the server.' -ForegroundColor Yellow
$remoteCommand = "set -eu; cd '$runtimeDir'; chmod 700 deploy-remote.sh; ./deploy-remote.sh"
& ssh @sshOptions -tt $remote $remoteCommand
if ($LASTEXITCODE -ne 0) {
  throw 'Server deployment resume failed; copy the terminal output back to Codex.'
}
