$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$Launcher = $args[0]
$Port = [int]$args[1]
if (-not $Launcher -or -not $Port) { throw 'usage: test-installed-happyherd-e2e.ps1 LAUNCHER ISSUER_PORT' }
$InstallRoot = [IO.Path]::GetFullPath((Join-Path (Split-Path $Launcher -Parent) '.'))
$Installation = Get-Content -Raw -LiteralPath (Join-Path $InstallRoot 'installation.json') | ConvertFrom-Json
$OwnerSid = [string]$Installation.ownerSid
$OwnerHome = [string]$Installation.ownerHome
$ServiceName = [string]$Installation.serviceName
$Fixture = Join-Path ([IO.Path]::GetTempPath()) ("happyherd-issuer-e2e-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Fixture | Out-Null
$Issuer = "http://127.0.0.1:$Port"
$Server = $null
$SpyScriptPath = $null
$SpawnMarker = Join-Path $env:SystemRoot ("Temp\happyherd-detached-e2e-" + [Guid]::NewGuid().ToString('N'))
try {
  & node (Join-Path $Root 'server\packages\happyherd-cli\scripts\create-e2e-issuer-fixture.mjs') --output $Fixture --issuer $Issuer | Out-Null
  $Log = Join-Path $Fixture 'issuer.log'
  $Server = Start-Process -FilePath node -ArgumentList @((Join-Path $Root 'server\packages\happyherd-cli\scripts\run-e2e-issuer.mjs'), '--fixture', (Join-Path $Fixture 'fixture.json')) -RedirectStandardOutput $Log -RedirectStandardError (Join-Path $Fixture 'issuer.err') -PassThru
  $IssuerReady = $false
  for ($Attempt = 0; $Attempt -lt 50; $Attempt += 1) {
    $LogText = ''
    if (Test-Path -LiteralPath $Log -PathType Leaf) {
      $LogCandidate = Get-Content -Raw -LiteralPath $Log -ErrorAction SilentlyContinue
      if ($null -ne $LogCandidate) { $LogText = [string]$LogCandidate }
    }
    if ($LogText -and $LogText.Contains("issuer-ready $Issuer")) { $IssuerReady = $true; break }
    if ($Server.HasExited) { break }
    Start-Sleep -Milliseconds 100
  }
  if (-not $IssuerReady) { throw 'issuer fixture did not start' }
  if ($env:HAPPYHERD_E2E_SPY_USER -and $env:HAPPYHERD_E2E_SPY_PASSWORD) {
    $ClientConfig = Join-Path $InstallRoot 'client\broker.json'
    $SpyPayload = [ordered]@{ config = $ClientConfig; launcher = $Launcher; issuer = $Issuer } | ConvertTo-Json -Compress
    $SpyPayloadBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($SpyPayload))
    $SpyBody = @'
$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__PAYLOAD__'))|ConvertFrom-Json
$read=$false;$doctor=$false;$tool=$false
try{[void][IO.File]::ReadAllText([string]$p.config);$read=$true}catch{}
try{& ([string]$p.launcher) doctor *> $null;$doctor=$LASTEXITCODE -eq 0}catch{}
try{& ([string]$p.launcher) run-tool --issuer ([string]$p.issuer) --skill generic-guide --script scripts/check.py *> $null;$tool=$LASTEXITCODE -eq 0}catch{}
if($read-or$doctor-or$tool){exit 9}
exit 0
'@.Replace('__PAYLOAD__', $SpyPayloadBase64)
    $SpyScriptPath = Join-Path $env:SystemRoot ("Temp\happyherd-spy-probe-" + [Guid]::NewGuid().ToString('N') + '.ps1')
    [IO.File]::WriteAllText($SpyScriptPath, $SpyBody, [Text.UTF8Encoding]::new($false))
    $SpySid = ([Security.Principal.NTAccount]::new($env:HAPPYHERD_E2E_SPY_USER)).Translate([Security.Principal.SecurityIdentifier]).Value
    & "$env:SystemRoot\System32\icacls.exe" $SpyScriptPath /grant:r "*${SpySid}:(RX)" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'could not grant the independent local spy read access to its probe' }
    $SpyPassword = ConvertTo-SecureString $env:HAPPYHERD_E2E_SPY_PASSWORD -AsPlainText -Force
    $SpyCredential = [Management.Automation.PSCredential]::new($env:HAPPYHERD_E2E_SPY_USER, $SpyPassword)
    $SpyProcess = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Credential $SpyCredential -Wait -PassThru -ArgumentList @('-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $SpyScriptPath)
    if ($SpyProcess.ExitCode -ne 0) { throw 'another local user read the broker capability or authenticated to the broker' }
  } else { throw 'native Windows E2E did not provide an independent local spy identity' }
  $Connect = & $Launcher connect $Issuer --no-open | Out-String
  if (-not $Connect.Contains('Approved scopes: guide.read') -or $Connect.Contains('happyherd-e2e-broker-only-token-value')) { throw 'connect output failed its contract' }
  $Install = & $Launcher install-skills --issuer $Issuer | Out-String
  if (-not $Install.Contains('Installed generic-e2e-skill-bundle@1.0.0')) { throw 'Skill install failed' }
  if (-not (Test-Path (Join-Path $OwnerHome '.claude\skills\generic-guide\SKILL.md')) -or -not (Test-Path (Join-Path $OwnerHome '.codex\skills\generic-guide\SKILL.md'))) { throw 'provider Skill copies are missing' }
  $ClaudeLaunch = & $Launcher launch claude --help | Out-String
  if (-not $ClaudeLaunch.Contains('happy - Claude Code On the Go') -or -not $ClaudeLaunch.Contains('happyherd-e2e claude help')) { throw 'maintained Claude runtime did not launch the controlled CLI' }
  $CodexLaunch = & $Launcher launch codex --help | Out-String
  if (-not $CodexLaunch.Contains('happyherd-e2e codex help')) { throw 'maintained Codex runtime did not launch the controlled CLI' }
  $Tool = & $Launcher run-tool --issuer $Issuer --skill generic-guide --script scripts/check.py | Out-String
  if (-not $Tool.Contains('"result": "verified-e2e"') -or -not $Tool.Contains('"toolCredentialCount": 0') -or $Tool.Contains('happyherd-e2e-broker-only-token-value')) { throw 'verified tool failed, reached a credential vault, or exposed its token' }
  if (Test-Path -LiteralPath $SpawnMarker) { throw 'detached-process marker already exists' }
  $Spawn = & $Launcher run-tool --issuer $Issuer --skill generic-guide --script scripts/spawn.py -- $SpawnMarker | Out-String
  Start-Sleep -Seconds 3
  if (-not $Spawn.Contains('"spawnDenied": true') -or (Test-Path -LiteralPath $SpawnMarker)) { throw 'detached tool descendant was created or survived its isolated launcher' }

  Restart-Service -Name $ServiceName -Force
  $Ready = $false
  for ($Attempt = 0; $Attempt -lt 50; $Attempt += 1) { & $Launcher doctor *> $null; if ($LASTEXITCODE -eq 0) { $Ready = $true; break }; Start-Sleep -Milliseconds 200 }
  if (-not $Ready) { throw 'broker did not recover after a native service restart' }
  $AfterRestart = & $Launcher run-tool --issuer $Issuer --skill generic-guide --script scripts/check.py | Out-String
  if (-not $AfterRestart.Contains('"result": "verified-e2e"')) { throw 'Credential Manager value did not survive service restart' }

  $NodeRuntime = Join-Path $InstallRoot 'native\node.exe'
  $KeyringModule = Join-Path $InstallRoot 'runtime\node_modules\@napi-rs\keyring'
  if ($env:HAPPYHERD_E2E_TARGET_USER -and $env:HAPPYHERD_E2E_TARGET_PASSWORD) {
    $OwnerScript = Join-Path $OwnerHome 'happyherd-e2e-owner-check.ps1'
    $OwnerOutput = Join-Path $OwnerHome 'happyherd-e2e-owner-check.json'
    $OwnerBody = @'
$ErrorActionPreference='Stop'
$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($args[0]))|ConvertFrom-Json
$managed=Join-Path $p.claude 'generic-guide'
$result=[ordered]@{write=$false;rename=$false;delete=$false;unrelated=$false;credentialDenied=$false}
try{Set-Content -LiteralPath (Join-Path $managed 'SKILL.md') -Value 'tamper' -ErrorAction Stop;$result.write=$true}catch{}
try{Rename-Item -LiteralPath $managed -NewName 'generic-guide-renamed' -ErrorAction Stop;$result.rename=$true}catch{}
try{Remove-Item -LiteralPath $managed -Recurse -Force -ErrorAction Stop;$result.delete=$true}catch{}
$own=Join-Path $p.claude 'employee-owned-e2e'
try{New-Item -ItemType Directory -Path $own -ErrorAction Stop|Out-Null;Set-Content -LiteralPath (Join-Path $own 'SKILL.md') -Value 'employee';Remove-Item -LiteralPath $own -Recurse -Force;$result.unrelated=$true}catch{}
& $p.node -e 'const k=require(process.argv[1]);try{process.exit(k.findCredentials("dev.happyherd.issuer.v1").length===0?0:9)}catch{process.exit(0)}' $p.keyring
$result.credentialDenied=$LASTEXITCODE -eq 0
[IO.File]::WriteAllText($p.output,(ConvertTo-Json $result -Compress),[Text.UTF8Encoding]::new($false))
'@
    [IO.File]::WriteAllText($OwnerScript, $OwnerBody, [Text.UTF8Encoding]::new($false))
    $Payload = [ordered]@{ claude = (Join-Path $OwnerHome '.claude\skills'); node = $NodeRuntime; keyring = $KeyringModule; output = $OwnerOutput } | ConvertTo-Json -Compress
    $PayloadBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Payload))
    $SecurePassword = ConvertTo-SecureString $env:HAPPYHERD_E2E_TARGET_PASSWORD -AsPlainText -Force
    $Credential = [Management.Automation.PSCredential]::new($env:HAPPYHERD_E2E_TARGET_USER, $SecurePassword)
    $OwnerProcess = Start-Process -FilePath (Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)) 'System32\WindowsPowerShell\v1.0\powershell.exe') -Credential $Credential -Wait -PassThru -ArgumentList @('-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $OwnerScript, $PayloadBase64)
    if ($OwnerProcess.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $OwnerOutput)) { throw 'target employee hostile-owner probe did not complete' }
    $OwnerResult = Get-Content -Raw -LiteralPath $OwnerOutput | ConvertFrom-Json
    if ($OwnerResult.write -or $OwnerResult.rename -or $OwnerResult.delete -or -not $OwnerResult.unrelated -or -not $OwnerResult.credentialDenied) { throw 'target employee could mutate a managed Skill, could not manage an unrelated Skill, or could read broker credentials' }
    Remove-Item -LiteralPath $OwnerScript, $OwnerOutput -Force
  } else {
    & $NodeRuntime -e 'const k=require(process.argv[1]);try{if(k.findCredentials("dev.happyherd.issuer.v1").length!==0)process.exit(9)}catch{}' $KeyringModule
    if ($LASTEXITCODE -ne 0) { throw 'owner process could read the service identity credential store' }
  }

  $Disconnect = & $Launcher disconnect --all | Out-String
  if (-not $Disconnect.Contains('Removed 1 local issuer credential')) { throw 'deleteAll did not remove the connected issuer' }
  & $Launcher run-tool --issuer $Issuer --skill generic-guide --script scripts/check.py *> $null
  if ($LASTEXITCODE -eq 0) { throw 'tool execution succeeded after deleteAll removed the OS-store credential' }
  $Reconnect = & $Launcher connect $Issuer --no-open | Out-String
  if (-not $Reconnect.Contains('Approved scopes: guide.read')) { throw 'could not restore a live credential for native uninstall verification' }
  Write-Host 'installed-happyherd-e2e: ok'
} finally {
  if ($Server -and -not $Server.HasExited) { Stop-Process -Id $Server.Id -Force -ErrorAction SilentlyContinue }
  if ($SpyScriptPath -and (Test-Path -LiteralPath $SpyScriptPath)) { Remove-Item -LiteralPath $SpyScriptPath -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $SpawnMarker) { Remove-Item -LiteralPath $SpawnMarker -Force -ErrorAction SilentlyContinue }
  if (Test-Path $Fixture) { Remove-Item -LiteralPath $Fixture -Recurse -Force }
}
