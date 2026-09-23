$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$remote = 'fandow-deploy@120.27.143.111'
$remoteDir = '/home/fandow-deploy/fandow-apps/runtime/fd-027340/live-center-workbench'
$sshOptions = @('-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'StrictHostKeyChecking=accept-new')
Write-Host 'Uploading the read-only Coco document permission inspection. Enter the SSH password.' -ForegroundColor Yellow
& scp @sshOptions (Join-Path $projectRoot 'inspect-coco-document-access.sh') "${remote}:$remoteDir/inspect-coco-document-access.sh"
if ($LASTEXITCODE -ne 0) { throw 'Permission inspection upload failed.' }
Write-Host 'Checking each document access. Enter the SSH password.' -ForegroundColor Yellow
& ssh @sshOptions -tt $remote "cd '$remoteDir'; chmod 700 inspect-coco-document-access.sh; ./inspect-coco-document-access.sh"
if ($LASTEXITCODE -ne 0) { throw 'Permission inspection stopped; copy its output back to Codex.' }
