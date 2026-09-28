param([switch]$FinalLocalQaPassed)
$ErrorActionPreference='Stop'
if(-not $FinalLocalQaPassed){throw 'Final local 495 QA confirmation is required before upload/run.'}
$qaCandidate='H:\codex输出\直播五环节工作流-20260923\calendar-reviewtext-exact-20260928\candidate-2042'
$qaRecipe=Join-Path $qaCandidate 'run-isolated-qa.sh'
$qaRecipeText=Get-Content -LiteralPath $qaRecipe -Raw
$qaPinsBlock=[regex]::Match($qaRecipeText,"(?s)pins='(.*?)'").Groups[1].Value
if($qaPinsBlock -match '__FINAL_' -or -not $qaPinsBlock){throw 'Recipe is not frozen.'}
$qaPins=@($qaPinsBlock -split '\r?\n')
if($qaPins.Count -ne 16){throw 'Exactly 7 source + 8 tests + SOURCE-PINS are required.'}
$qaFiles=@()
foreach($qaPin in $qaPins){
  if($qaPin -notmatch '^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$'){throw 'Invalid explicit QA file pin.'}
  $qaExpected=$Matches[1];$qaFileName=$Matches[2]
  $qaFilePath=Join-Path $qaCandidate $qaFileName
  if((Get-FileHash -Algorithm SHA256 -LiteralPath $qaFilePath).Hash.ToLowerInvariant() -ne $qaExpected){throw "QA SHA mismatch: $qaFileName"}
  $qaFiles+=@($qaFilePath)
}
if(@($qaFiles | Select-Object -Unique).Count -ne 16){throw 'Duplicate QA file pin.'}
$qaRecipeSha=(Get-FileHash -Algorithm SHA256 -LiteralPath $qaRecipe).Hash.ToLowerInvariant()
Write-Output "LOCAL_QA_PIN_COUNT=16; RECIPE_SHA=$qaRecipeSha"
$qaSshArgs=@('-o','BatchMode=yes','-o','ConnectTimeout=10','-i','C:\Users\202606\.ssh\id_ed25519_brand-marketing')
$qaHost='brand-marketing@114.55.65.246'
$qaCreate='qa=$(mktemp -d /home/brand-marketing/fandow-apps/fd-026222/runtime/calendar-reviewtext-20260928.XXXXXX); chmod 755 "$qa"; printf "%s\n" "$qa"'
$qaRemote=(& ssh.exe @qaSshArgs $qaHost $qaCreate | Out-String).Trim()
if($LASTEXITCODE -ne 0 -or $qaRemote -notmatch '^/home/brand-marketing/fandow-apps/fd-026222/runtime/calendar-reviewtext-20260928\.[A-Za-z0-9]{6}$'){throw 'Unique isolated QA directory creation failed.'}
Write-Output "ISOLATED_QA_DIRECTORY=$qaRemote"
& scp.exe @qaSshArgs @qaFiles $qaRecipe "${qaHost}:$qaRemote/"
if($LASTEXITCODE -ne 0){throw 'Isolated QA upload failed; no test run.'}
$qaRun=('printf ''{1}  {0}/run-isolated-qa.sh\n'' | sha256sum --strict -c - && chmod 644 ''{0}''/* && tr -d "\r" < ''{0}/run-isolated-qa.sh'' | bash -s -- ''{0}''' -f $qaRemote,$qaRecipeSha)
& ssh.exe @qaSshArgs $qaHost $qaRun
$qaExit=$LASTEXITCODE
Write-Output "LAUNCHER_TEST_EXIT_CODE=$qaExit"
exit $qaExit
