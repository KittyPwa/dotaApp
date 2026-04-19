$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptRoot

$runDir = Join-Path $scriptRoot ".run"
New-Item -ItemType Directory -Force -Path $runDir | Out-Null

$backendLog = Join-Path $runDir "backend.out.log"
$backendErrLog = Join-Path $runDir "backend.err.log"

function Get-NodeExe {
  $wingetNode = "C:\Users\clepl\AppData\Local\Microsoft\WinGet\Packages\OpenJS.NodeJS.22_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v22.22.2-win-x64\node.exe"
  if (Test-Path $wingetNode) {
    return $wingetNode
  }

  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCommand) {
    return $nodeCommand.Source
  }

  throw "Node.js was not found. Install Node 22 LTS first."
}

function Get-NpmCmd {
  param(
    [Parameter(Mandatory = $true)]
    [string]$NodeExe
  )

  $nodeDir = Split-Path -Parent $NodeExe
  $npmCmd = Join-Path $nodeDir "npm.cmd"
  if (Test-Path $npmCmd) {
    return $npmCmd
  }

  $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
  if ($npmCommand) {
    return $npmCommand.Source
  }

  throw "npm was not found."
}

function Wait-ForHealth {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Url,
    [int]$TimeoutSeconds = 45
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 3
      if ($response.ok -eq $true) {
        return $true
      }
    } catch {
      Start-Sleep -Milliseconds 800
    }
  }

  return $false
}

$nodeExe = Get-NodeExe
$npmCmd = Get-NpmCmd -NodeExe $nodeExe
$appUrl = "http://127.0.0.1:3344/"
$healthUrl = "http://127.0.0.1:3344/api/health"
$backendEntry = Join-Path $scriptRoot "app\backend\dist\server.js"
$frontendEntry = Join-Path $scriptRoot "app\frontend\dist\index.html"

if (-not (Test-Path $backendEntry) -or -not (Test-Path $frontendEntry)) {
  Write-Host "Build artifacts not found. Building the app..."
  & $npmCmd run build
  if ($LASTEXITCODE -ne 0) {
    throw "Build failed."
  }
}

$existingListener = netstat -ano | Select-String "127.0.0.1:3344"
if ($existingListener) {
  $listenerPid = [int](($existingListener -split "\s+")[-1])
  Write-Host "App already appears to be running on port 3344 (PID $listenerPid). Opening homepage..."
  Start-Process $appUrl
  exit 0
}

Remove-Item -LiteralPath $backendLog, $backendErrLog -ErrorAction SilentlyContinue

$previousPath = $env:Path
$env:Path = "$(Split-Path -Parent $nodeExe);$previousPath"
$env:NODE_ENV = "production"
$env:OPEN_BROWSER = "false"

$process = Start-Process `
  -FilePath $nodeExe `
  -ArgumentList "app/backend/dist/server.js" `
  -WorkingDirectory $scriptRoot `
  -RedirectStandardOutput $backendLog `
  -RedirectStandardError $backendErrLog `
  -PassThru

if (-not (Wait-ForHealth -Url $healthUrl)) {
  $stderr = if (Test-Path $backendErrLog) { Get-Content $backendErrLog -Raw } else { "" }
  $stdout = if (Test-Path $backendLog) { Get-Content $backendLog -Raw } else { "" }
  throw "The local app did not become ready in time.`n`nSTDOUT:`n$stdout`n`nSTDERR:`n$stderr"
}

Write-Host "Dota Local Analytics is running at $appUrl"
Start-Process $appUrl
