$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$remote = 'fandow-deploy@120.27.143.111'
$remoteFile = '/home/fandow-deploy/fandow-apps/runtime/fd-027340/dispatch-center/recover-dispatch-center.sh'
$sshOptions = @('-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'StrictHostKeyChecking=accept-new')

Write-Host '[1/2] Uploading the dispatch recovery helper. Enter the SSH password.' -ForegroundColor Yellow
& scp @sshOptions (Join-Path $root 'recover-dispatch-center.sh') "${remote}:$remoteFile"
if ($LASTEXITCODE -ne 0) { throw 'Uploading the dispatch recovery helper failed.' }

Write-Host '[2/2] Restoring the dispatch container and MCP configuration. Enter SSH/sudo passwords when prompted.' -ForegroundColor Yellow
& ssh @sshOptions -tt $remote "chmod 700 '$remoteFile'; '$remoteFile'"
if ($LASTEXITCODE -ne 0) { throw 'Dispatch recovery stopped; copy the terminal output back to Codex.' }
