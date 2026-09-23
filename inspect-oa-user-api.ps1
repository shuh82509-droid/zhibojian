$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$remote = 'fandow-deploy@120.27.143.111'
$remoteScript = '/home/fandow-deploy/fandow-apps/runtime/fd-027340/live-center-workbench/inspect-oa-user-api.sh'
$sshOptions = @('-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'StrictHostKeyChecking=accept-new')

Write-Host 'Uploading the read-only OA identity diagnostic. Enter the SSH password.' -ForegroundColor Cyan
& scp @sshOptions (Join-Path $projectRoot 'inspect-oa-user-api.sh') "${remote}:$remoteScript"
if ($LASTEXITCODE -ne 0) { throw 'Uploading the OA diagnostic failed.' }
Write-Host 'Reading identity-related OA API routes. Enter the SSH password.' -ForegroundColor Cyan
& ssh @sshOptions -tt $remote "chmod 700 '$remoteScript'; '$remoteScript'"
if ($LASTEXITCODE -ne 0) { throw 'OA identity diagnostic failed; copy the output back to Codex.' }
