$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$remote = 'fandow-deploy@120.27.143.111'
$incoming = '/home/fandow-deploy/fandow-apps/incoming/fd-027340/live-hub-optimized'
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddHHmmss')
$bundle = Join-Path $env:TEMP "fd-027340-live-hub-v3-resume-$stamp.tar.gz"
$remoteBundle = "$incoming/live-hub-v3-resume-$stamp.tar.gz"
$remoteScript = "$incoming/deploy-live-hub-v3.sh"
$sshOptions = @('-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'StrictHostKeyChecking=accept-new')

function Invoke-TransportRetry {
  param([Parameter(Mandatory = $true)][scriptblock]$Action,[Parameter(Mandatory = $true)][string]$FailureMessage,[int]$Attempts = 3)
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
  Write-Host '[1/3] Rebuilding the corrected business and collaboration candidates.' -ForegroundColor Yellow
  Push-Location (Join-Path $projectRoot 'runtime\collaboration-center')
  try { & npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw 'Collaboration build failed.' } } finally { Pop-Location }
  Push-Location (Join-Path $projectRoot 'runtime\data-center')
  try { & npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw 'Business dashboard build failed.' } } finally { Pop-Location }
  & node --test (Join-Path $projectRoot 'runtime\collaboration-center\tests\violation-parser.test.ts')
  if ($LASTEXITCODE -ne 0) { throw 'Violation parser tests failed.' }
  & tar -czf $bundle Dockerfile.live-hub-v3-main Dockerfile.live-hub-v3-data site exports/recruitment-pool exports/anchor-archives runtime/collaboration-center/dist runtime/data-center/dist
  if ($LASTEXITCODE -ne 0) { throw 'Packaging the corrected V3 candidate failed.' }

  Write-Host '[2/3] Uploading the corrected candidate. Enter the SSH password.' -ForegroundColor Yellow
  Invoke-TransportRetry -FailureMessage 'Uploading the corrected V3 bundle failed after 3 attempts.' -Action { & scp @sshOptions $bundle "${remote}:$remoteBundle" }
  Invoke-TransportRetry -FailureMessage 'Uploading the corrected deployment helper failed after 3 attempts.' -Action { & scp @sshOptions (Join-Path $projectRoot 'deploy-live-hub-v3.sh') "${remote}:$remoteScript" }

  Write-Host '[3/3] Testing all corrected APIs before switching the main and business containers.' -ForegroundColor Yellow
  & ssh @sshOptions -tt $remote "chmod 700 '$remoteScript'; '$remoteScript' '$remoteBundle' '2026-08-18'"
  if ($LASTEXITCODE -ne 0) { throw 'Corrected V3 candidate verification stopped. Copy the first CANDIDATE_* failure back to Codex.' }
} finally {
  Pop-Location
  if (Test-Path -LiteralPath $bundle) { Remove-Item -LiteralPath $bundle -Force }
}
