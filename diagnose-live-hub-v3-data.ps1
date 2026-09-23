$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$remote = 'fandow-deploy@120.27.143.111'
$remoteScript = '/home/fandow-deploy/fandow-apps/incoming/fd-027340/live-hub-optimized/diagnose-live-hub-v3-data.sh'
$sshOptions = @('-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'StrictHostKeyChecking=accept-new')

Write-Host '[1/2] Uploading the candidate data diagnostic. Enter the SSH password.' -ForegroundColor Yellow
& scp @sshOptions (Join-Path $projectRoot 'diagnose-live-hub-v3-data.sh') "${remote}:$remoteScript"
if ($LASTEXITCODE -ne 0) { throw 'Uploading the data diagnostic failed.' }
Write-Host '[2/2] Reading candidate API errors without changing production. Enter the SSH password.' -ForegroundColor Yellow
& ssh @sshOptions -tt $remote "chmod 700 '$remoteScript'; '$remoteScript'"
if ($LASTEXITCODE -ne 0) { throw 'Candidate data diagnostic stopped; copy the first HTTP_STATUS/error block back to Codex.' }
