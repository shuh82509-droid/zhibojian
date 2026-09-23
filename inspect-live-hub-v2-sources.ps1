$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$remote = 'fandow-deploy@120.27.143.111'
$remoteScript = "/tmp/fd-027340-live-hub-v2-source-inspection-$([Guid]::NewGuid().ToString('N')).py"
$sshOptions = @('-o','ConnectTimeout=30','-o','ConnectionAttempts=3','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=4','-o','StrictHostKeyChecking=accept-new')

function Invoke-UploadRetry {
  param([scriptblock]$Action,[string]$FailureMessage,[int]$Attempts=3)
  for($attempt=1;$attempt -le $Attempts;$attempt++){
    & $Action
    if($LASTEXITCODE -eq 0){return}
    if($attempt -lt $Attempts){Write-Host "SSH transport interrupted. Retrying upload ($($attempt+1)/$Attempts)..." -ForegroundColor Yellow; Start-Sleep -Seconds 2}
  }
  throw $FailureMessage
}

Write-Host '[1/2] Uploading the read-only schema inspection. Enter the SSH password.' -ForegroundColor Yellow
Invoke-UploadRetry -FailureMessage 'Uploading the schema inspection failed after 3 attempts.' -Action {
  & scp @sshOptions (Join-Path $projectRoot 'inspect-live-hub-v2-sources.py') "${remote}:$remoteScript"
}
Write-Host '[2/2] Reading only headers and a small tail sample. Enter the SSH password.' -ForegroundColor Yellow
& ssh @sshOptions -tt $remote "set -a; . /home/fandow-deploy/fandow-apps/runtime/fd-027340/live-center-workbench/.env.coco; set +a; python3 '$remoteScript'"
if($LASTEXITCODE -ne 0){throw 'Source schema inspection failed. Copy the last error back to Codex.'}
