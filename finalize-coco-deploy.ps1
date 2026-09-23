$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$remote = 'fandow-deploy@120.27.143.111'
$runtimeDir = '/home/fandow-deploy/fandow-apps/runtime/fd-027340/live-center-workbench'
$sshOptions = @('-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'StrictHostKeyChecking=accept-new')

Write-Host 'Uploading the final verification script. Enter the SSH password.' -ForegroundColor Cyan
& scp @sshOptions (Join-Path $projectRoot 'finalize-coco-deploy.sh') "${remote}:$runtimeDir/finalize-coco-deploy.sh"
if ($LASTEXITCODE -ne 0) { throw 'Uploading the final verification script failed.' }

Write-Host 'Running final container, Coco, Nginx, route, and record checks.' -ForegroundColor Cyan
Write-Host 'Enter the SSH password, then the sudo password if requested.' -ForegroundColor Yellow
& ssh @sshOptions -tt $remote "cd '$runtimeDir'; chmod 700 finalize-coco-deploy.sh; ./finalize-coco-deploy.sh"
if ($LASTEXITCODE -ne 0) { throw 'Final deployment verification failed; copy the terminal output back to Codex.' }
