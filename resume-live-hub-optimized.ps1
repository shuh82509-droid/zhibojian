$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$remote = 'fandow-deploy@120.27.143.111'
$runtimeDir = '/home/fandow-deploy/fandow-apps/runtime/fd-027340/live-center-workbench'
$moduleDir = '/home/fandow-deploy/fandow-apps/incoming/fd-027340/live-hub-optimized'
$sshOptions = @('-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'StrictHostKeyChecking=accept-new')

Write-Host '[1/2] Uploading the non-blocking deployment verifier. Enter the SSH password.' -ForegroundColor Yellow
& scp @sshOptions (Join-Path $projectRoot 'deploy-remote.sh') "${remote}:$runtimeDir/deploy-remote.sh"
if ($LASTEXITCODE -ne 0) { throw 'Uploading the deployment verifier failed.' }

Write-Host '[2/2] Completing the already-uploaded release. Enter SSH/sudo passwords when prompted.' -ForegroundColor Yellow
$remoteCommand = "set -eu; cd '$runtimeDir'; test -s .env.coco; test -s .env.minimax; test -s '$moduleDir/data-center.tar.gz'; test -s '$moduleDir/dispatch-center.tar.gz'; test -s '$moduleDir/update-live-data-modules.sh'; chmod 700 deploy-remote.sh '$moduleDir/update-live-data-modules.sh'; ./deploy-remote.sh; '$moduleDir/update-live-data-modules.sh' '$moduleDir/data-center.tar.gz' '$moduleDir/dispatch-center.tar.gz'; rm -f '$moduleDir/data-center.tar.gz' '$moduleDir/dispatch-center.tar.gz' '$moduleDir/update-live-data-modules.sh'; echo 'LIVE_HUB_OPTIMIZED_DEPLOYMENT=passed'"
& ssh @sshOptions -tt $remote $remoteCommand
if ($LASTEXITCODE -ne 0) { throw 'Release resume stopped; copy the terminal output back to Codex.' }
