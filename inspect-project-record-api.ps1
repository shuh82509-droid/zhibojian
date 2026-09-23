$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$remote = 'fandow-deploy@120.27.143.111'
$remoteScript = '/home/fandow-deploy/fandow-apps/runtime/fd-027340/live-center-workbench/inspect-project-record-api.sh'
$sshOptions = @('-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'StrictHostKeyChecking=accept-new')

Write-Host 'Uploading the read-only project-record diagnostic. Enter the SSH password.' -ForegroundColor Cyan
& scp @sshOptions (Join-Path $projectRoot 'inspect-project-record-api.sh') "${remote}:$remoteScript"
if ($LASTEXITCODE -ne 0) { throw 'Uploading the diagnostic failed.' }

Write-Host 'Reading the local project-record API schema and matching records.' -ForegroundColor Cyan
& ssh @sshOptions -tt $remote "chmod 700 '$remoteScript'; '$remoteScript'"
if ($LASTEXITCODE -ne 0) { throw 'Project-record diagnostic failed; copy the terminal output back to Codex.' }
