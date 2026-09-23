$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = 'fandow-deploy@120.27.143.111'
$remote = '/tmp/live-center-module-deploy'
& scp.exe -o StrictHostKeyChecking=accept-new (Join-Path $root 'verify-data-center-snapshot.sh') "$target`:$remote/verify-data-center-snapshot.sh"
if ($LASTEXITCODE -ne 0) { throw 'Uploading the data-center verification helper failed.' }
& ssh.exe -tt -o StrictHostKeyChecking=accept-new $target "bash $remote/verify-data-center-snapshot.sh"
if ($LASTEXITCODE -ne 0) { throw 'Data-center verification stopped; copy the terminal output back to Codex.' }
