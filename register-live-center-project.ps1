$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$remote = 'fandow-deploy@120.27.143.111'
$remoteScript = '/home/fandow-deploy/fandow-apps/runtime/fd-027340/live-center-workbench/register-live-center-project.py'
$sshOptions = @('-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'StrictHostKeyChecking=accept-new')

Write-Host 'Uploading the scoped project registration helper. Enter the SSH password.' -ForegroundColor Cyan
& scp @sshOptions (Join-Path $projectRoot 'register-live-center-project.py') "${remote}:$remoteScript"
if ($LASTEXITCODE -ne 0) { throw 'Uploading the project registration helper failed.' }

Write-Host 'Resolving the unique Feishu user through Coco and registering the deployed project.' -ForegroundColor Cyan
Write-Host 'Enter the SSH password.' -ForegroundColor Yellow
& ssh @sshOptions -tt $remote "chmod 700 '$remoteScript'; python3 '$remoteScript'"
if ($LASTEXITCODE -ne 0) { throw 'Project registration failed; copy the terminal output back to Codex.' }
