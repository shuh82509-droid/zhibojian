$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = 'fandow-deploy@120.27.143.111'
$remote = '/tmp/live-center-module-deploy'
& ssh.exe -tt -o StrictHostKeyChecking=accept-new $target "mkdir -p $remote"
if ($LASTEXITCODE -ne 0) { throw 'Preparing the server upload directory failed.' }
& scp.exe -o StrictHostKeyChecking=accept-new (Join-Path $root 'inspect-live-data-availability.sh') "$target`:$remote/inspect-live-data-availability.sh"
if ($LASTEXITCODE -ne 0) { throw 'Uploading the availability-check helper failed.' }
& ssh.exe -tt -o StrictHostKeyChecking=accept-new $target "bash $remote/inspect-live-data-availability.sh"
if ($LASTEXITCODE -ne 0) { throw 'Availability check stopped; copy the terminal output back to Codex.' }
