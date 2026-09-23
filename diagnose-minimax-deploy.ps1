$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$remote = 'fandow-deploy@120.27.143.111'
$remoteDir = '/home/fandow-deploy/fandow-apps/runtime/fd-027340/live-center-workbench'
$sshOptions = @('-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'StrictHostKeyChecking=accept-new')
Write-Host 'Uploading the read-only MiniMax diagnostic. Enter the SSH password.' -ForegroundColor Yellow
& scp @sshOptions (Join-Path $projectRoot 'diagnose-minimax-deploy.sh') "${remote}:$remoteDir/diagnose-minimax-deploy.sh"
if ($LASTEXITCODE -ne 0) { throw 'Diagnostic upload failed.' }
Write-Host 'Running the diagnostic. Enter the SSH password and sudo password if requested.' -ForegroundColor Yellow
& ssh @sshOptions -tt $remote "cd '$remoteDir'; chmod 700 diagnose-minimax-deploy.sh; ./diagnose-minimax-deploy.sh"
if ($LASTEXITCODE -ne 0) { throw 'Diagnostic stopped; copy the terminal output back to Codex.' }
