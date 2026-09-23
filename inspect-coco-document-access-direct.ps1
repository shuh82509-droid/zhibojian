$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$remote = 'fandow-deploy@120.27.143.111'
$remoteDir = '/home/fandow-deploy/fandow-apps/runtime/fd-027340/live-center-workbench'
$sshOptions = @('-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'StrictHostKeyChecking=accept-new')
Write-Host 'Uploading the direct read-only Coco permission inspection. Enter the SSH password.' -ForegroundColor Yellow
& scp @sshOptions (Join-Path $projectRoot 'inspect-coco-document-access-direct.py') "${remote}:$remoteDir/inspect-coco-document-access-direct.py"
if ($LASTEXITCODE -ne 0) { throw 'Direct permission inspection upload failed.' }
Write-Host 'Checking Feishu access directly through Coco. Enter the SSH password.' -ForegroundColor Yellow
& ssh @sshOptions -tt $remote "cd '$remoteDir'; chmod 700 inspect-coco-document-access-direct.py; python3 inspect-coco-document-access-direct.py"
if ($LASTEXITCODE -ne 0) { throw 'Direct permission inspection stopped; copy the output back to Codex.' }
