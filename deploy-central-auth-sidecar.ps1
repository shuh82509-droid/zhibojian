$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$remote = 'fandow-deploy@120.27.143.111'
$incoming = '/home/fandow-deploy/fandow-apps/incoming/fd-027340/live-hub-optimized'
$identityFile = Join-Path $env:USERPROFILE '.ssh\codex-fandow-deploy-ed25519'
$sshOptions = @('-i', $identityFile, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12', '-o', 'StrictHostKeyChecking=accept-new')
$remoteSource = "$incoming/central-auth-sidecar.py"
$remoteNginx = "$incoming/central-auth-sidecar.nginx.conf"
$remoteScript = "$incoming/deploy-central-auth-sidecar.sh"

& ssh @sshOptions $remote "mkdir -p '$incoming'"
if ($LASTEXITCODE -ne 0) { throw 'Preparing the scoped upload directory failed.' }
& scp @sshOptions (Join-Path $projectRoot 'central-auth-sidecar.py') "${remote}:$remoteSource"
if ($LASTEXITCODE -ne 0) { throw 'Uploading the central auth source failed.' }
& scp @sshOptions (Join-Path $projectRoot 'central-auth-sidecar.nginx.conf') "${remote}:$remoteNginx"
if ($LASTEXITCODE -ne 0) { throw 'Uploading the scoped Nginx config failed.' }
& scp @sshOptions (Join-Path $projectRoot 'deploy-central-auth-sidecar.sh') "${remote}:$remoteScript"
if ($LASTEXITCODE -ne 0) { throw 'Uploading the central auth deployment helper failed.' }
& ssh @sshOptions -tt $remote "chmod 700 '$remoteScript'; '$remoteScript' '$remoteSource' '$remoteNginx'"
if ($LASTEXITCODE -ne 0) { throw 'Central auth sidecar deployment failed.' }
