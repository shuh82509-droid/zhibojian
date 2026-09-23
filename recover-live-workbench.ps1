$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$remote = 'fandow-deploy@120.27.143.111'
$remoteFile = '/home/fandow-deploy/fandow-apps/runtime/fd-027340/live-center-workbench/recover-live-workbench.sh'
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

Write-Host '[1/2] Uploading the recovery diagnostic. Enter the SSH password.' -ForegroundColor Yellow
Invoke-TransportRetry -FailureMessage 'Uploading the recovery diagnostic failed after 3 attempts.' -Action {
  & scp @sshOptions (Join-Path $root 'recover-live-workbench.sh') "${remote}:$remoteFile"
}

Write-Host '[2/2] Checking and recovering the workbench. Enter SSH/sudo passwords when prompted.' -ForegroundColor Yellow
Invoke-TransportRetry -FailureMessage 'Workbench recovery stopped after 3 attempts; copy the terminal output back to Codex.' -Action {
  & ssh @sshOptions -tt $remote "chmod 700 '$remoteFile'; '$remoteFile'"
}
