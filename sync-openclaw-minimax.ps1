$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = 'C:\Users\Administrator\AppData\Roaming\FanDo\openclaw\openclaw.json'
$remote = 'fandow-deploy@120.27.143.111'
$runtimeDir = '/home/fandow-deploy/fandow-apps/runtime/fd-027340/live-center-workbench'
$incomingDir = '/home/fandow-deploy/fandow-apps/incoming/fd-027340/live-center-workbench'
$remoteConfig = 'fd-027340-minimax-provider.env'
$localConfig = Join-Path $env:TEMP "fd-027340-minimax-$([guid]::NewGuid().ToString('N')).env"
$sshOptions = @('-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'StrictHostKeyChecking=accept-new')

try {
  if (-not (Test-Path -LiteralPath $configPath)) { throw 'The local OpenClaw configuration file was not found.' }
  $config = Get-Content -LiteralPath $configPath -Raw -Encoding utf8 | ConvertFrom-Json
  $provider = $config.models.providers.minimax
  if (-not $provider -or -not $provider.apiKey -or -not $provider.baseUrl) { throw 'The local OpenClaw MiniMax provider is incomplete.' }
  $model = if (($provider.models | ForEach-Object { $_.id }) -contains 'MiniMax-M2.7-highspeed') { 'MiniMax-M2.7-highspeed' } else { $provider.models[0].id }
  $timeout = if ($provider.timeoutSeconds) { [int]$provider.timeoutSeconds } else { 1800 }
  $content = @(
    "MINIMAX_API_KEY=$($provider.apiKey)",
    "MINIMAX_BASE_URL=$($provider.baseUrl.TrimEnd('/'))",
    "MINIMAX_MODEL=$model",
    "MINIMAX_TIMEOUT_SECONDS=$timeout",
    'INTELLIGENCE_REFRESH_MINUTES=15'
  ) -join "`n"
  [System.IO.File]::WriteAllText($localConfig, "$content`n", [System.Text.UTF8Encoding]::new($false))

  Write-Host '[1/3] Preparing the server upload directory. Enter the SSH password.' -ForegroundColor Yellow
  & ssh @sshOptions $remote "mkdir -p '$runtimeDir' '$incomingDir'"
  if ($LASTEXITCODE -ne 0) { throw 'Preparing the server upload directory failed.' }
  Write-Host '[2/3] Uploading the current OpenClaw MiniMax provider privately. Enter the SSH password.' -ForegroundColor Yellow
  & scp @sshOptions $localConfig "${remote}:$incomingDir/$remoteConfig"
  if ($LASTEXITCODE -ne 0) { throw 'MiniMax provider upload failed.' }
  & scp @sshOptions (Join-Path $projectRoot 'probe-minimax-gateway.sh') "${remote}:$runtimeDir/probe-minimax-gateway.sh"
  if ($LASTEXITCODE -ne 0) { throw 'Gateway probe upload failed.' }
  Write-Host '[3/3] Activating the private server configuration and testing the gateway. Enter the SSH password.' -ForegroundColor Yellow
  & ssh @sshOptions -tt $remote "set -eu; install -m 600 '$incomingDir/$remoteConfig' '$runtimeDir/.env.minimax'; rm -f '$incomingDir/$remoteConfig'; cd '$runtimeDir'; chmod 700 probe-minimax-gateway.sh; ./probe-minimax-gateway.sh"
  if ($LASTEXITCODE -ne 0) { throw 'MiniMax provider sync or compatibility probe failed; copy the output back to Codex.' }
} finally {
  if (Test-Path -LiteralPath $localConfig) { Remove-Item -LiteralPath $localConfig -Force }
}
