$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$remote = 'fandow-deploy@120.27.143.111'
$remoteDir = '/home/fandow-deploy/fandow-apps/runtime/fd-027340/live-center-workbench'
$sshOptions = @('-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'StrictHostKeyChecking=accept-new')
Write-Host 'Uploading the MiniMax gateway compatibility probe. Enter the SSH password.' -ForegroundColor Yellow
& scp @sshOptions (Join-Path $projectRoot 'probe-minimax-gateway.sh') "${remote}:$remoteDir/probe-minimax-gateway.sh"
if ($LASTEXITCODE -ne 0) { throw 'Gateway probe upload failed.' }
Write-Host 'Probing the configured gateway. Enter the SSH password.' -ForegroundColor Yellow
& ssh @sshOptions -tt $remote "cd '$remoteDir'; chmod 700 probe-minimax-gateway.sh; ./probe-minimax-gateway.sh"
if ($LASTEXITCODE -ne 0) { throw 'Gateway probe stopped; copy its output back to Codex.' }
