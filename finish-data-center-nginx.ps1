$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = 'fandow-deploy@120.27.143.111'
$remote = '/tmp/live-center-module-deploy'
& scp.exe -o StrictHostKeyChecking=accept-new (Join-Path $root 'finish-data-center-nginx.sh') "$target`:$remote/finish-data-center-nginx.sh"
if ($LASTEXITCODE -ne 0) { throw 'Uploading the data center completion helper failed.' }
& ssh.exe -tt -o StrictHostKeyChecking=accept-new $target "bash $remote/finish-data-center-nginx.sh"
if ($LASTEXITCODE -ne 0) { throw 'Data center completion check stopped; copy the terminal output back to Codex.' }
