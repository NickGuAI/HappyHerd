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

# A normal Windows npm install exposes claude.cmd beside node_modules. Happy
# resolves that shim to the package's JavaScript entrypoint before launching it.
$ClaudePackage = Join-Path $Destination 'node_modules\@anthropic-ai\claude-code'
New-Item -ItemType Directory -Force -Path $ClaudePackage | Out-Null
$ClaudeBody = @'
'use strict';
const argument = process.argv[2] || '';
if (argument === '--version') console.log('happyherd-e2e claude version 1.0.0');
else if (argument === '--help' || argument === '-h') console.log('happyherd-e2e claude help');
else { console.error('unexpected happyherd-e2e claude invocation'); process.exitCode = 64; }
'@
[IO.File]::WriteAllText((Join-Path $ClaudePackage 'cli.js'), $ClaudeBody, [Text.UTF8Encoding]::new($false))
$ClaudePackageJson = '{"name":"@anthropic-ai/claude-code","version":"1.0.0","bin":{"claude":"cli.js"}}'
[IO.File]::WriteAllText((Join-Path $ClaudePackage 'package.json'), $ClaudePackageJson, [Text.UTF8Encoding]::new($false))
