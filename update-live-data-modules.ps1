$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$remote = 'fandow-deploy@120.27.143.111'
$remoteDir = '/home/fandow-deploy/fandow-apps/incoming/fd-027340/module-api-fix'
$sshOptions = @('-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'StrictHostKeyChecking=accept-new')
$dataArchive = Join-Path $env:TEMP 'fd-027340-data-center-api-fix.tar.gz'
$dispatchArchive = Join-Path $env:TEMP 'fd-027340-dispatch-center-api-fix.tar.gz'

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

try {
  & tar -czf $dataArchive --exclude=node_modules --exclude=.next --exclude=dist --exclude=.wrangler --exclude=.env -C (Join-Path $root 'runtime') data-center
  if ($LASTEXITCODE -ne 0) { throw 'Packaging data center failed.' }
  & tar -czf $dispatchArchive --exclude=node_modules --exclude=dist --exclude=.wrangler --exclude=.env -C (Join-Path $root 'runtime') dispatch-center
  if ($LASTEXITCODE -ne 0) { throw 'Packaging dispatch center failed.' }

  Write-Host '[1/3] Preparing the server upload directory. Enter the SSH password.' -ForegroundColor Yellow
  Invoke-TransportRetry -FailureMessage 'Preparing the server upload directory failed after 3 attempts.' -Action {
    & ssh @sshOptions $remote "mkdir -p '$remoteDir'"
  }

  Write-Host '[2/3] Uploading both module updates. Enter the SSH password when prompted.' -ForegroundColor Yellow
  Invoke-TransportRetry -FailureMessage 'Uploading data center failed after 3 attempts.' -Action {
    & scp @sshOptions $dataArchive "${remote}:$remoteDir/data-center.tar.gz"
  }
  Invoke-TransportRetry -FailureMessage 'Uploading dispatch center failed after 3 attempts.' -Action {
    & scp @sshOptions $dispatchArchive "${remote}:$remoteDir/dispatch-center.tar.gz"
  }
  Invoke-TransportRetry -FailureMessage 'Uploading update helper failed after 3 attempts.' -Action {
    & scp @sshOptions (Join-Path $root 'update-live-data-modules.sh') "${remote}:$remoteDir/update-live-data-modules.sh"
  }

  Write-Host '[3/3] Rebuilding the two module containers. Enter SSH/sudo passwords when prompted.' -ForegroundColor Yellow
  & ssh @sshOptions -tt $remote "chmod 700 '$remoteDir/update-live-data-modules.sh'; '$remoteDir/update-live-data-modules.sh' '$remoteDir/data-center.tar.gz' '$remoteDir/dispatch-center.tar.gz'"
  if ($LASTEXITCODE -ne 0) { throw 'Module API update stopped; copy the terminal output back to Codex.' }
} finally {
  if (Test-Path -LiteralPath $dataArchive) { Remove-Item -LiteralPath $dataArchive -Force }
  if (Test-Path -LiteralPath $dispatchArchive) { Remove-Item -LiteralPath $dispatchArchive -Force }
}
