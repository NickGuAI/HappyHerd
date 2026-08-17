$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($args.Count -ne 1) { throw 'usage: prepare-agent-cli-fixtures.ps1 DESTINATION' }
$Destination = [IO.Path]::GetFullPath($args[0])
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
foreach ($Provider in @('claude', 'codex')) {
  $Body = @"
@echo off
if "%~1"=="--version" echo happyherd-e2e $Provider version 1.0.0& exit /b 0
if "%~1"=="--help" echo happyherd-e2e $Provider help& exit /b 0
if "%~1"=="-h" echo happyherd-e2e $Provider help& exit /b 0
echo unexpected happyherd-e2e $Provider invocation 1>&2
exit /b 64
"@
  [IO.File]::WriteAllText((Join-Path $Destination "$Provider.cmd"), $Body, [Text.UTF8Encoding]::new($false))
}
