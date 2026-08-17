[CmdletBinding()]
param(
  [string]$ExpectedScriptSha256 = '',
  [string]$ExpectedReceiptSha256 = '',
  [switch]$Elevated
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Fail([string]$Message) { throw "happyherd uninstaller: $Message" }
function Full-Path([string]$Path) { return [IO.Path]::GetFullPath($Path) }
function Sid-Key([string]$Sid) {
  $Bytes = [Text.Encoding]::UTF8.GetBytes($Sid)
  $Hasher = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($Hasher.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant().Substring(0, 20) }
  finally { $Hasher.Dispose(); [Array]::Clear($Bytes, 0, $Bytes.Length) }
}
function Safe-Leaf([string]$Path, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { Fail "$Label is missing" }
  if (((Get-Item -Force -LiteralPath $Path).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Fail "$Label is a reparse point" }
}
function Assert-BootstrapAcl([string]$Path, [bool]$Directory) {
  if ($Directory) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { Fail "protected directory is missing: $Path" }
  } else { Safe-Leaf $Path 'protected bootstrap file' }
  $Acl = Get-Acl -LiteralPath $Path
  if (-not $Acl.AreAccessRulesProtected -or $Acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne 'S-1-5-18') { Fail "protected bootstrap path is not LocalSystem-owned: $Path" }
  $Mutating = [Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Modify -bor [Security.AccessControl.FileSystemRights]::FullControl -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
  foreach ($Rule in $Acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($Rule.IsInherited -or ($Rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and ($Rule.FileSystemRights -band $Mutating) -and $Rule.IdentityReference.Value -notin @('S-1-5-18', 'S-1-5-32-544'))) { Fail "protected bootstrap path is writable by an untrusted identity: $Path" }
  }
}
function Load-Receipt([string]$Path) {
  Safe-Leaf $Path 'protected installation receipt'
  try { return Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json } catch { Fail 'protected installation receipt is invalid JSON' }
}

$InstallDir = Full-Path $PSScriptRoot
$ReceiptPath = Join-Path $InstallDir 'installation.json'
$Receipt = Load-Receipt $ReceiptPath
if ($Receipt.schemaVersion -ne 1 -or $Receipt.product -ne 'HappyHerd' -or $Receipt.ownerSid -notmatch '^S-1-\d+(?:-\d+){2,15}$') { Fail 'protected installation receipt identity is invalid' }
try { $OwnerSidObject = [Security.Principal.SecurityIdentifier]::new([string]$Receipt.ownerSid) } catch { Fail 'protected employee SID is invalid' }
$OwnerSid = $OwnerSidObject.Value
$OwnerKey = Sid-Key $OwnerSid
if ($Receipt.ownerKey -ne $OwnerKey -or (Split-Path $InstallDir -Leaf) -ne $OwnerKey) { Fail 'installation path is not bound to the protected employee SID' }

$WindowsDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)
$ProgramFilesRoot = Full-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles))
$ProgramDataRoot = Full-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::CommonApplicationData))
$PowerShellExe = Join-Path $WindowsDirectory 'System32\WindowsPowerShell\v1.0\powershell.exe'
$ScExe = Join-Path $WindowsDirectory 'System32\sc.exe'
foreach ($FixedTool in @($PowerShellExe, $ScExe)) { Safe-Leaf $FixedTool 'protected Windows tool' }
$ExpectedInstallDir = Join-Path $ProgramFilesRoot "HappyHerd\$OwnerKey"
if (-not [StringComparer]::OrdinalIgnoreCase.Equals($InstallDir, $ExpectedInstallDir)) { Fail 'uninstaller is not running from the protected installation root' }

$Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$Principal = [Security.Principal.WindowsPrincipal]::new($Identity)
$IsAdministrator = $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $IsAdministrator) {
  if ($Elevated) { Fail 'elevation did not produce an administrator process' }
  if ($Identity.User.Value -ne $OwnerSid) { Fail 'run this installed uninstaller from the employee account that owns the installation' }
  $ScriptSha = (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $ReceiptSha = (Get-FileHash -LiteralPath $ReceiptPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $Payload = [ordered]@{ script = (Full-Path $PSCommandPath); scriptSha = $ScriptSha; receiptSha = $ReceiptSha } | ConvertTo-Json -Compress
  $PayloadBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Payload))
  $Bootstrap = '$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(''' + $PayloadBase64 + '''))|ConvertFrom-Json;& $p.script -ExpectedScriptSha256 $p.scriptSha -ExpectedReceiptSha256 $p.receiptSha -Elevated'
  $EncodedBootstrap = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Bootstrap))
  $Process = Start-Process -FilePath $PowerShellExe -Verb RunAs -Wait -PassThru -ArgumentList @('-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $EncodedBootstrap)
  exit $Process.ExitCode
}
if (-not $IsAdministrator) { Fail 'administrator approval is required' }
if ($ExpectedScriptSha256) {
  if ($ExpectedScriptSha256 -notmatch '^[0-9a-f]{64}$' -or $ExpectedReceiptSha256 -notmatch '^[0-9a-f]{64}$') { Fail 'captured uninstall digests are invalid' }
  if ((Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedScriptSha256) { Fail 'uninstaller changed between employee launch and administrator approval' }
  if ((Get-FileHash -LiteralPath $ReceiptPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedReceiptSha256) { Fail 'installation receipt changed between employee launch and administrator approval' }
  $Receipt = Load-Receipt $ReceiptPath
}
if ((Get-Acl -LiteralPath $ReceiptPath).GetOwner([Security.Principal.SecurityIdentifier]).Value -ne 'S-1-5-18') { Fail 'installation receipt is not owned by LocalSystem' }

$OwnerHome = Full-Path ([string]$Receipt.ownerHome)
$OwnerLocalAppData = Full-Path ([string]$Receipt.ownerLocalAppData)
$StateRoot = Full-Path ([string]$Receipt.stateRoot)
$ServiceName = [string]$Receipt.serviceName
$ToolUser = [string]$Receipt.toolUser
$ServiceIdentity = "NT SERVICE\$ServiceName"
$ExpectedStateRoot = Join-Path $ProgramDataRoot "HappyHerd\Broker\$OwnerKey"
$ExpectedServiceName = "HappyHerdBroker-$OwnerKey"
$ExpectedToolUser = "HHd-$($OwnerKey.Substring(0, 16))"
$ClaudeSkills = Join-Path $OwnerHome '.claude\skills'
$CodexSkills = Join-Path $OwnerHome '.codex\skills'
if (-not [StringComparer]::OrdinalIgnoreCase.Equals($StateRoot, $ExpectedStateRoot) -or $ServiceName -ne $ExpectedServiceName -or $ToolUser -ne $ExpectedToolUser) { Fail 'installation receipt names are not derived from the protected employee SID' }
if ($Receipt.providerRoots.claude -ne $ClaudeSkills -or $Receipt.providerRoots.codex -ne $CodexSkills) { Fail 'installation receipt provider roots are invalid' }
$ServiceSid = [string]$Receipt.serviceSid
$ToolSid = [string]$Receipt.toolSid
if ($ServiceSid -notmatch '^S-1-5-80-(?:\d+-){4}\d+$' -or $ToolSid -notmatch '^S-1-5-21-(?:\d+-){3}\d+$' -or $Receipt.toolGroupSid -ne 'S-1-5-32-545') { Fail 'installation receipt OS identities are invalid' }
try { $ResolvedServiceSid = ([Security.Principal.NTAccount]::new($ServiceIdentity)).Translate([Security.Principal.SecurityIdentifier]).Value } catch { Fail 'broker service SID cannot be resolved' }
if ($ResolvedServiceSid -ne $ServiceSid) { Fail 'broker service SID does not match the protected installation receipt' }
$ProfileKey = "Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$OwnerSid"
if (-not (Test-Path -LiteralPath $ProfileKey)) { Fail 'target employee profile registration is missing' }
$RegisteredHome = Full-Path ([Environment]::ExpandEnvironmentVariables((Get-ItemPropertyValue -LiteralPath $ProfileKey -Name ProfileImagePath)))
if (-not [StringComparer]::OrdinalIgnoreCase.Equals($OwnerHome.TrimEnd('\'), $RegisteredHome.TrimEnd('\'))) { Fail 'installation receipt employee profile is stale' }

$ReleaseReceiptPath = Join-Path $InstallDir 'release.json'
Safe-Leaf $ReleaseReceiptPath 'release receipt'
$NodeRuntime = Join-Path $InstallDir 'native\node.exe'
$Launcher = Join-Path $InstallDir 'happyherd.cmd'
$ManagedRemoval = Join-Path $InstallDir 'service\happyherd-uninstall-managed.mjs'
$TrustVerifier = Join-Path $InstallDir 'service\happyherd-acl-check.exe'
$BrokerHost = Join-Path $InstallDir 'service\happyherd-broker-service.exe'
$ToolLauncher = Join-Path $InstallDir 'service\happyherd-tool-launcher.exe'
$ServiceConfig = Join-Path $StateRoot 'broker-service.json'
$ProviderAclReceipt = Join-Path $StateRoot 'provider-acls.json'
$ToolConfig = Join-Path $StateRoot 'tool-launcher.conf'
$ClientConfig = Join-Path $InstallDir 'client\broker.json'
foreach ($Path in @($NodeRuntime, $Launcher, $ManagedRemoval, $TrustVerifier, $BrokerHost, $ToolLauncher, $ServiceConfig, $ProviderAclReceipt, $ToolConfig, $ClientConfig)) { Safe-Leaf $Path 'required uninstall evidence' }

Assert-BootstrapAcl $InstallDir $true
Assert-BootstrapAcl $TrustVerifier $false
Assert-BootstrapAcl $ReceiptPath $false
Assert-BootstrapAcl $ReleaseReceiptPath $false
& $TrustVerifier `
  --directory $InstallDir `
  --directory-writer $StateRoot $ServiceSid `
  --file $ReceiptPath `
  --file $ReleaseReceiptPath `
  --file $NodeRuntime `
  --file $Launcher `
  --file $ManagedRemoval `
  --file $TrustVerifier `
  --file $BrokerHost `
  --file $ToolLauncher `
  --file $ServiceConfig `
  --file $ProviderAclReceipt `
  --file $ToolConfig `
  --client-file $ClientConfig $OwnerSid
if ($LASTEXITCODE -ne 0) { Fail 'native ACL verification rejected the installation; no uninstall mutation was attempted' }
$ReleaseReceipt = Get-Content -Raw -LiteralPath $ReleaseReceiptPath | ConvertFrom-Json
if ($ReleaseReceipt.schemaVersion -ne 1 -or $ReleaseReceipt.product -ne 'HappyHerd' -or $ReleaseReceipt.target -ne 'win32-x64' -or $ReleaseReceipt.nodeRuntime -ne 'native/node.exe' -or $ReleaseReceipt.trustVerifier -ne 'service/happyherd-acl-check.exe') { Fail 'release receipt is not an owned Windows HappyHerd installation' }

$ToolMarker = "HappyHerd tool $OwnerKey"
$ToolAccount = Get-LocalUser -Name $ToolUser -ErrorAction SilentlyContinue
if (-not $ToolAccount -or $ToolAccount.Description -ne $ToolMarker) { Fail 'isolated tool account is missing or not owned by this installation' }
if ($ToolAccount.Sid.Value -ne $ToolSid -or -not $ToolAccount.Enabled) { Fail 'isolated tool account identity does not match the protected installation receipt' }
$ToolGroupSids = @()
foreach ($Group in @(Get-LocalGroup)) {
  $Members = @(Get-LocalGroupMember -SID $Group.Sid -ErrorAction SilentlyContinue)
  $MemberSids = @($Members | ForEach-Object { $_.SID.Value })
  if ($MemberSids -contains $ToolSid) { $ToolGroupSids += $Group.Sid.Value }
}
if (@($ToolGroupSids).Count -ne 1 -or $ToolGroupSids[0] -ne 'S-1-5-32-545') { Fail 'isolated tool account group memberships are not exact' }
if ($null -eq (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) { Fail 'broker service is missing; repair the installation before uninstalling' }

$UserEnvironmentKey = "Registry::HKEY_USERS\$OwnerSid\Environment"
if (-not (Test-Path -LiteralPath $UserEnvironmentKey)) { Fail 'target employee registry hive is not loaded; no uninstall mutation was attempted' }
$UserPath = ''
try { $UserPath = [string](Get-ItemPropertyValue -LiteralPath $UserEnvironmentKey -Name Path -ErrorAction Stop) } catch { $UserPath = '' }

try { $AclReceipt = Get-Content -Raw -LiteralPath $ProviderAclReceipt | ConvertFrom-Json } catch { Fail 'provider ACL receipt is invalid; no uninstall mutation was attempted' }
if ($AclReceipt.schemaVersion -ne 1 -or $AclReceipt.product -ne 'HappyHerd' -or $AclReceipt.ownerSid -ne $OwnerSid -or @($AclReceipt.records).Count -ne 4) { Fail 'provider ACL receipt identity is invalid; no uninstall mutation was attempted' }
$ExpectedAclPaths = @((Join-Path $OwnerHome '.claude'), $ClaudeSkills, (Join-Path $OwnerHome '.codex'), $CodexSkills)
$Records = @($AclReceipt.records)
for ($Index = 0; $Index -lt 4; $Index += 1) {
  if ($Records[$Index].path -ne $ExpectedAclPaths[$Index] -or $Records[$Index].existed -isnot [bool] -or ($Records[$Index].existed -and -not $Records[$Index].sddl)) { Fail 'provider ACL receipt path is invalid; no uninstall mutation was attempted' }
  if ($Records[$Index].existed) {
    try { $CheckSecurity = [Security.AccessControl.DirectorySecurity]::new(); $CheckSecurity.SetSecurityDescriptorSddlForm([string]$Records[$Index].sddl) } catch { Fail 'provider ACL receipt contains an invalid security descriptor' }
  }
}

$PreviousNativeFlag = $env:HAPPYHERD_NATIVE_INSTALLATION
$env:HAPPYHERD_NATIVE_INSTALLATION = '1'
try { $PreflightJson = & $NodeRuntime $ManagedRemoval --preflight $ServiceConfig | Out-String }
finally { $env:HAPPYHERD_NATIVE_INSTALLATION = $PreviousNativeFlag }
if ($LASTEXITCODE -ne 0) { Fail 'managed Skill preflight failed; no uninstall mutation was attempted' }
try { $Preflight = $PreflightJson | ConvertFrom-Json } catch { Fail 'managed Skill preflight returned invalid output' }
if ($Preflight.schemaVersion -ne 1 -or $null -eq $Preflight.verified -or $null -eq $Preflight.preserved -or @($Preflight.preserved).Count -ne 0) {
  foreach ($Entry in @($Preflight.preserved)) { Write-Warning "preserved ambiguous Skill $($Entry.path): $($Entry.reason)" }
  Fail 'one or more managed Skills are ambiguous; no uninstall mutation was attempted'
}

# Credentials must be purged by the still-running broker identity. If the
# service or its OS vault is unavailable, preserve everything for repair.
Start-Service -Name $ServiceName -ErrorAction SilentlyContinue
$DisconnectOutput = & $Launcher disconnect --all | Out-String
if ($LASTEXITCODE -ne 0 -or -not $DisconnectOutput.Contains('from the OS secret store')) { Fail 'OS-store credentials could not be verified and removed; installation was preserved' }
Write-Host $DisconnectOutput.Trim()

# Remove only byte-for-byte verified managed provider copies. Any ambiguity is
# fail-closed so the protected registry and bundle evidence remain available.
$PreviousNativeFlag = $env:HAPPYHERD_NATIVE_INSTALLATION
$env:HAPPYHERD_NATIVE_INSTALLATION = '1'
try { $RemovalJson = & $NodeRuntime $ManagedRemoval --apply $ServiceConfig | Out-String }
finally { $env:HAPPYHERD_NATIVE_INSTALLATION = $PreviousNativeFlag }
if ($LASTEXITCODE -ne 0) { Fail 'managed Skill removal verifier failed; installation was preserved' }
try { $Removal = $RemovalJson | ConvertFrom-Json } catch { Fail 'managed Skill removal verifier returned invalid output' }
if ($Removal.schemaVersion -ne 1 -or $null -eq $Removal.removed -or $null -eq $Removal.preserved) { Fail 'managed Skill removal report is invalid' }
if (@($Removal.preserved).Count -ne 0) {
  foreach ($Entry in @($Removal.preserved)) { Write-Warning "preserved ambiguous Skill $($Entry.path): $($Entry.reason)" }
  Fail 'one or more managed Skills were modified; protected evidence and installation were preserved'
}

Stop-Service -Name $ServiceName -Force

for ($Index = $Records.Count - 1; $Index -ge 0; $Index -= 1) {
  $Record = $Records[$Index]
  if (-not (Test-Path -LiteralPath $Record.path -PathType Container)) { continue }
  if ($Record.existed) {
    $Security = [Security.AccessControl.DirectorySecurity]::new()
    $Security.SetSecurityDescriptorSddlForm([string]$Record.sddl)
    Set-Acl -LiteralPath ([string]$Record.path) -AclObject $Security
  } elseif (@(Get-ChildItem -Force -LiteralPath $Record.path).Count -eq 0) {
    Remove-Item -LiteralPath $Record.path -Force
  } else {
    # The directory was created by HappyHerd but now contains unrelated user
    # content. Preserve it and return ordinary ownership/control to the user.
    $Security = [Security.AccessControl.DirectorySecurity]::new()
    $Security.SetOwner($OwnerSidObject)
    $Flags = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
    foreach ($Sid in @('S-1-5-18', 'S-1-5-32-544', $OwnerSid)) {
      $Security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($Sid), [Security.AccessControl.FileSystemRights]::FullControl, $Flags, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
    }
    $Security.SetAccessRuleProtection($true, $false)
    Set-Acl -LiteralPath ([string]$Record.path) -AclObject $Security
  }
}

& $ScExe delete $ServiceName | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'broker service could not be deleted' }
Remove-LocalUser -Name $ToolUser

$InstallPathToken = $InstallDir.Trim().TrimEnd('\')
$NextPath = (@($UserPath -split ';' | Where-Object { $_ -and -not [StringComparer]::OrdinalIgnoreCase.Equals($_.Trim().TrimEnd('\'), $InstallPathToken) }) -join ';')
Set-ItemProperty -LiteralPath $UserEnvironmentKey -Name Path -Value $NextPath

Remove-Item -LiteralPath $StateRoot -Recurse -Force
Remove-Item -LiteralPath $InstallDir -Recurse -Force
foreach ($Parent in @((Split-Path $StateRoot -Parent), (Split-Path $InstallDir -Parent))) {
  if ((Test-Path -LiteralPath $Parent -PathType Container) -and @(Get-ChildItem -Force -LiteralPath $Parent).Count -eq 0) { Remove-Item -LiteralPath $Parent -Force }
}
Write-Host 'Removed HappyHerd, its broker service, managed Skill copies, isolated tool identity, and OS credential vault.'
