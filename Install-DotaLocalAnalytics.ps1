$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptRoot

$logDir = Join-Path $scriptRoot "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$installLog = Join-Path $logDir "installer-$stamp.log"
$latestInstallLog = Join-Path $logDir "installer-latest.log"

function Write-Log {
  param([Parameter(Mandatory = $true)][string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -LiteralPath $installLog -Value $line
  Add-Content -LiteralPath $latestInstallLog -Value $line
}

function Fail-Install {
  param([Parameter(Mandatory = $true)][string]$Message)
  Write-Log "ERROR: $Message"
  Write-Host ""
  Write-Host "Install failed. See log: $installLog"
  Read-Host "Press Enter to close"
  exit 1
}

function Get-NodeExe {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCommand) { return $nodeCommand.Source }
  return $null
}

function Get-NodeMajor {
  param([Parameter(Mandatory = $true)][string]$NodeExe)
  $version = & $NodeExe --version
  if ($version -match "v(\d+)") { return [int]$Matches[1] }
  return 0
}

function Get-NpmCmd {
  param([Parameter(Mandatory = $true)][string]$NodeExe)
  $nodeDir = Split-Path -Parent $NodeExe
  $npmCmd = Join-Path $nodeDir "npm.cmd"
  if (Test-Path $npmCmd) { return $npmCmd }
  $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
  if ($npmCommand) { return $npmCommand.Source }
  return $null
}

function Invoke-LoggedCommand {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$ArgumentList,
    [Parameter(Mandatory = $true)][string]$StepName,
    [switch]$AllowFailure
  )

  Write-Log "$StepName..."
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $quotedArgs = ($ArgumentList | ForEach-Object {
      if ($_ -match "\s") { "`"$_`"" } else { $_ }
    }) -join " "
    $command = "`"$FilePath`" $quotedArgs"
    $output = & "$env:SystemRoot\System32\cmd.exe" /c $command 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($output) { Add-Content -LiteralPath $installLog -Value ($output | Out-String) }
  if ($exitCode -ne 0) {
    if ($AllowFailure) {
      Write-Log "$StepName failed with exit code $exitCode, continuing because fallback is allowed."
      return $false
    }
    Fail-Install "$StepName failed with exit code $exitCode."
  }
  return $true
}

Set-Content -LiteralPath $latestInstallLog -Value ""
Write-Log "Starting installer/preflight from $scriptRoot"

$nodeExe = Get-NodeExe
if (-not $nodeExe -or (Get-NodeMajor -NodeExe $nodeExe) -lt 22) {
  Write-Log "Node.js 22+ was not found."
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) {
    Fail-Install "winget was not found. Install Node.js 22 LTS manually, then rerun this installer."
  }

  Write-Host ""
  Write-Host "Node.js 22 LTS is required. The installer can install it with winget."
  $answer = Read-Host "Install Node.js 22 LTS now? Type Y to continue"
  if ($answer -notin @("Y", "y", "YES", "yes")) {
    Fail-Install "Node.js installation was not approved."
  }

  Invoke-LoggedCommand -FilePath $winget.Source -ArgumentList @("install", "OpenJS.NodeJS.22", "--accept-package-agreements", "--accept-source-agreements") -StepName "Installing Node.js 22 LTS"
  $env:Path = "$env:ProgramFiles\nodejs;$env:LOCALAPPDATA\Microsoft\WinGet\Links;$env:Path"
  $nodeExe = Get-NodeExe
}

if (-not $nodeExe) {
  Fail-Install "Node.js is still unavailable after installation."
}

$nodeMajor = Get-NodeMajor -NodeExe $nodeExe
Write-Log "Node: $nodeExe ($nodeMajor)"
if ($nodeMajor -lt 22) {
  Fail-Install "Node.js version is too old. Found major version $nodeMajor, need 22+."
}

$npmCmd = Get-NpmCmd -NodeExe $nodeExe
if (-not $npmCmd) {
  Fail-Install "npm was not found."
}
Write-Log "npm: $npmCmd"

$env:Path = "$(Split-Path -Parent $nodeExe);$env:Path"

$dependencyMarker = Join-Path $scriptRoot "node_modules\.package-lock.json"
$backendEntry = Join-Path $scriptRoot "app\backend\dist\server.js"
$frontendEntry = Join-Path $scriptRoot "app\frontend\dist\index.html"
$hasBuildArtifacts = (Test-Path $backendEntry) -and (Test-Path $frontendEntry)

if (Test-Path $dependencyMarker) {
  Write-Log "Project dependencies already appear to be installed. Skipping npm install."
} else {
  Invoke-LoggedCommand -FilePath $npmCmd -ArgumentList @("install", "--no-audit", "--no-fund") -StepName "Installing project dependencies"
}

$buildOk = Invoke-LoggedCommand -FilePath $npmCmd -ArgumentList @("run", "build") -StepName "Building application" -AllowFailure:$hasBuildArtifacts
if (-not $buildOk -and $hasBuildArtifacts) {
  Write-Log "Existing build artifacts are present, so installer will keep them. See log above for build failure details."
}

Write-Log "Installer completed successfully."
Write-Host ""
Write-Host "Install complete. Use Launch-DotaLocalAnalytics.cmd to start the app."
