$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$remote = 'fandow-deploy@120.27.143.111'
$runtimeDir = '/home/fandow-deploy/fandow-apps/runtime/fd-027340/live-center-workbench'
$incomingDir = '/home/fandow-deploy/fandow-apps/incoming/fd-027340/live-center-workbench'
$bundleName = "live-center-workbench-$([DateTime]::UtcNow.ToString('yyyyMMddHHmmss')).tar.gz"
$bundlePath = Join-Path $env:TEMP $bundleName
$cocoTemplatePath = Join-Path $projectRoot '.env.coco.template'
$cocoConfigPath = Join-Path $env:TEMP "fd-027340-live-center-workbench-$([Guid]::NewGuid().ToString('N')).env.coco"
$sshOptions = @('-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'StrictHostKeyChecking=accept-new')

function Invoke-TransportRetry {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Action,
    [Parameter(Mandatory = $true)][string]$FailureMessage,
    [int]$Attempts = 3
  )

  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    & $Action
    if ($LASTEXITCODE -eq 0) { return }
    if ($attempt -lt $Attempts) {
      Write-Host "SSH transport was interrupted. Retrying ($($attempt + 1)/$Attempts)..." -ForegroundColor Yellow
      Start-Sleep -Seconds 2
    }
  }
  throw $FailureMessage
}

Push-Location $projectRoot
try {
  Copy-Item -LiteralPath $cocoTemplatePath -Destination $cocoConfigPath -Force
  Write-Host 'A Notepad window will open. Replace PASTE_APP_SECRET_HERE, save, and close Notepad.' -ForegroundColor Cyan
  Start-Process notepad.exe -ArgumentList $cocoConfigPath -Wait

  $cocoLines = Get-Content -LiteralPath $cocoConfigPath
  if ($cocoLines -notcontains 'FEISHU_APP_ID=cli_aafbc3a80eb8dcf4') {
    throw 'Coco App ID is missing or incorrect in the temporary configuration file.'
  }
  $secretLine = $cocoLines | Where-Object { $_ -match '^FEISHU_APP_SECRET=.' } | Select-Object -First 1
  if (-not $secretLine -or $secretLine -eq 'FEISHU_APP_SECRET=PASTE_APP_SECRET_HERE') {
    throw 'Replace PASTE_APP_SECRET_HERE in Notepad, save, and close it.'
  }

  & tar -czf $bundlePath --exclude=.git --exclude=.agents --exclude=.codex --exclude=sources --exclude=.env --exclude=.env.coco --exclude=.env.coco.template --exclude=node_modules --exclude=runtime/data-center/node_modules --exclude=runtime/data-center/.next --exclude=runtime/data-center/dist .
  if ($LASTEXITCODE -ne 0) { throw 'Local packaging failed.' }

  Write-Host '[1/4] Preparing server directories. Enter the SSH password.' -ForegroundColor Yellow
  Invoke-TransportRetry -FailureMessage 'Preparing server directories failed after 3 attempts.' -Action {
    & ssh @sshOptions $remote "mkdir -p '$runtimeDir' '$incomingDir'"
  }

  Write-Host '[2/4] Uploading the Coco configuration. Enter the SSH password.' -ForegroundColor Yellow
  Invoke-TransportRetry -FailureMessage 'Uploading Coco configuration failed after 3 attempts.' -Action {
    & scp @sshOptions $cocoConfigPath "${remote}:$runtimeDir/.env.coco.upload"
  }
  & ssh @sshOptions $remote "umask 077; mv -f '$runtimeDir/.env.coco.upload' '$runtimeDir/.env.coco'; chmod 600 '$runtimeDir/.env.coco'; rm -f '$runtimeDir/.env.coco.swp'"
  if ($LASTEXITCODE -ne 0) { throw 'Installing the Coco configuration on the server failed.' }

  Write-Host '[3/4] Uploading application bundle. Enter the SSH password.' -ForegroundColor Yellow
  Invoke-TransportRetry -FailureMessage 'Application upload failed after 3 attempts.' -Action {
    & scp @sshOptions $bundlePath "${remote}:$incomingDir/$bundleName"
  }

  Write-Host '[4/4] Building and deploying. Enter SSH/sudo passwords when prompted.' -ForegroundColor Yellow
  $remoteCommand = "set -eu; cd '$runtimeDir'; tar -tzf '$incomingDir/$bundleName' | grep -E '(^/|(^|/)\.\.(/|$))' && exit 1 || true; tar -xzf '$incomingDir/$bundleName' -C '$runtimeDir'; rm -f '$incomingDir/$bundleName'; chmod 700 deploy-remote.sh; ./deploy-remote.sh"
  & ssh @sshOptions -tt $remote $remoteCommand
  if ($LASTEXITCODE -ne 0) { throw 'Server deployment failed; copy the terminal output back to Codex.' }
} finally {
  Pop-Location
  if (Test-Path -LiteralPath $bundlePath) { Remove-Item -LiteralPath $bundlePath -Force }
  if (Test-Path -LiteralPath $cocoConfigPath) { Remove-Item -LiteralPath $cocoConfigPath -Force }
}
