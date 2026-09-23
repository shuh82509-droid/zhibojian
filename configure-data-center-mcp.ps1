$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$remote = 'fandow-deploy@120.27.143.111'
$remoteDir = '/home/fandow-deploy/fandow-apps/runtime/fd-027340/data-center'
$sshOptions = @('-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'StrictHostKeyChecking=accept-new')
$credentialPath = Join-Path $env:TEMP "fd-027340-data-center-$([Guid]::NewGuid().ToString('N')).env"
$remoteCredential = "$remoteDir/.env.mcp.upload"

try {
  Set-Content -LiteralPath $credentialPath -Encoding ascii -NoNewline -Value 'FANDOW_DATA_MCP_TOKEN=PASTE_MCP_TOKEN_HERE'
  Write-Host 'A Notepad window will open. Replace PASTE_MCP_TOKEN_HERE, save, and close Notepad.' -ForegroundColor Cyan
  Start-Process notepad.exe -ArgumentList $credentialPath -Wait
  $lines = Get-Content -LiteralPath $credentialPath
  $tokenLine = $lines | Where-Object { $_ -match '^FANDOW_DATA_MCP_TOKEN=.' } | Select-Object -First 1
  if (-not $tokenLine -or $tokenLine -eq 'FANDOW_DATA_MCP_TOKEN=PASTE_MCP_TOKEN_HERE') {
    throw 'Replace the MCP Token placeholder, save, and close Notepad.'
  }
  if (($lines | Where-Object { $_ -match '^FANDOW_DATA_MCP_TOKEN=' }).Count -ne 1) {
    throw 'The configuration must contain exactly one FANDOW_DATA_MCP_TOKEN line.'
  }

  Write-Host '[1/3] Preparing the server directory. Enter the SSH password.' -ForegroundColor Yellow
  & ssh @sshOptions $remote "mkdir -p '$remoteDir'"
  if ($LASTEXITCODE -ne 0) { throw 'Preparing the server directory failed.' }

  Write-Host '[2/3] Uploading the protected runtime configuration and helper. Enter the SSH password when prompted.' -ForegroundColor Yellow
  & scp @sshOptions $credentialPath "${remote}:$remoteCredential"
  if ($LASTEXITCODE -ne 0) { throw 'Uploading the MCP configuration failed.' }
  & scp @sshOptions (Join-Path $root 'configure-data-center-mcp.sh') "${remote}:$remoteDir/configure-data-center-mcp.sh"
  if ($LASTEXITCODE -ne 0) { throw 'Uploading the configuration helper failed.' }

  Write-Host '[3/3] Switching the data center to live MCP mode. Enter SSH/sudo passwords when prompted.' -ForegroundColor Yellow
  & ssh @sshOptions -tt $remote "chmod 700 '$remoteDir/configure-data-center-mcp.sh'; '$remoteDir/configure-data-center-mcp.sh' '$remoteCredential'"
  if ($LASTEXITCODE -ne 0) { throw 'Live MCP configuration failed; copy the terminal output back to Codex.' }
} finally {
  if (Test-Path -LiteralPath $credentialPath) { Remove-Item -LiteralPath $credentialPath -Force }
}
