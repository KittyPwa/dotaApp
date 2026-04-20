param(
  [switch]$NoWait
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptRoot

$logDir = Join-Path $scriptRoot "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$launchLog = Join-Path $logDir "launcher-$stamp.log"
$backendOutLog = Join-Path $logDir "backend-$stamp.out.log"
$backendErrLog = Join-Path $logDir "backend-$stamp.err.log"
$latestLaunchLog = Join-Path $logDir "launcher-latest.log"
$latestBackendOutLog = Join-Path $logDir "backend-latest.out.log"
$latestBackendErrLog = Join-Path $logDir "backend-latest.err.log"

function Write-Log {
  param([Parameter(Mandatory = $true)][string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -LiteralPath $launchLog -Value $line
  Add-Content -LiteralPath $latestLaunchLog -Value $line
}

function Fail-Launch {
  param([Parameter(Mandatory = $true)][string]$Message)
  Write-Log "ERROR: $Message"
  Write-Host ""
  Write-Host "Launch failed. See logs:"
  Write-Host "  $launchLog"
  Write-Host "  $backendOutLog"
  Write-Host "  $backendErrLog"
  Write-Host ""
  if (-not $NoWait) {
    Read-Host "Press Enter to close"
  }
  exit 1
}

function Get-NodeExe {
  $localNode = Get-Command node -ErrorAction SilentlyContinue
  if ($localNode) { return $localNode.Source }

  $wingetNodeRoots = @(
    "$env:LOCALAPPDATA\Microsoft\WinGet\Packages",
    "$env:ProgramFiles\nodejs"
  )

  foreach ($root in $wingetNodeRoots) {
    if (-not (Test-Path $root)) { continue }
    $candidate = Get-ChildItem -Path $root -Filter node.exe -Recurse -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if ($candidate) { return $candidate.FullName }
  }

  return $null
}

function Get-NpmCmd {
  param([Parameter(Mandatory = $true)][string]$NodeExe)
  $nodeDir = Split-Path -Parent $NodeExe
  $localNpm = Join-Path $nodeDir "npm.cmd"
  if (Test-Path $localNpm) { return $localNpm }

  $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
  if ($npmCommand) { return $npmCommand.Source }

  return $null
}

function Get-NodeMajor {
  param([Parameter(Mandatory = $true)][string]$NodeExe)
  $version = & $NodeExe --version
  if ($version -match "v(\d+)") { return [int]$Matches[1] }
  return 0
}

function Invoke-LoggedCommand {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$ArgumentList,
    [Parameter(Mandatory = $true)][string]$StepName
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
  if ($output) { Add-Content -LiteralPath $launchLog -Value ($output | Out-String) }
  if ($exitCode -ne 0) {
    Fail-Launch "$StepName failed with exit code $exitCode."
  }
}

function Test-Health {
  param([int]$TimeoutSeconds = 2)
  try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:3344/api/health" -Method Get -TimeoutSec $TimeoutSeconds
    return ($response.ok -eq $true -and $response.services.database -eq $true)
  } catch {
    return $false
  }
}

function Test-Frontend {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:3344/" -UseBasicParsing -TimeoutSec 3
    return ($response.StatusCode -eq 200 -and $response.Content -match 'id="root"')
  } catch {
    return $false
  }
}

function Open-AppBrowser {
  param([Parameter(Mandatory = $true)][string]$Url)
  try {
    $openInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $openInfo.FileName = "$env:SystemRoot\System32\cmd.exe"
    $openInfo.Arguments = "/c start `"`" `"$Url`""
    $openInfo.WorkingDirectory = $scriptRoot
    $openInfo.UseShellExecute = $false
    $openInfo.CreateNoWindow = $true
    [System.Diagnostics.Process]::Start($openInfo) | Out-Null
    Write-Log "Browser launch requested."
  } catch {
    Write-Log "Browser launch failed: $($_.Exception.Message)"
    Write-Host "Open this URL manually: $Url"
  }
}

function Get-PortOwnerPid {
  $line = netstat -ano | Select-String "127.0.0.1:3344" | Select-Object -First 1
  if (-not $line) { return $null }
  return [int](($line.ToString() -split "\s+")[-1])
}

function Stop-PortOwner {
  param([Parameter(Mandatory = $true)][int]$ProcessId)
  Write-Log "Stopping existing process on port 3344 (PID $ProcessId) to enforce a single backend instance."
  Stop-Process -Id $ProcessId -Force
  $deadline = (Get-Date).AddSeconds(10)
  while ((Get-Date) -lt $deadline) {
    if (-not (Get-PortOwnerPid)) { return }
    Start-Sleep -Milliseconds 300
  }
  Fail-Launch "Could not free port 3344 after stopping PID $ProcessId."
}

function Wait-WithStatus {
  param(
    [Parameter(Mandatory = $true)]$BackendProcess,
    [Parameter(Mandatory = $true)][string]$Url
  )
  if ($NoWait) {
    Write-Log "NoWait mode enabled; launcher verification completed without holding the console open."
    return
  }

  Write-Host ""
  Write-Host "Dota Local Analytics is running."
  Write-Host "Open: $Url"
  Write-Host "Logs: $logDir"
  Write-Host ""
  Write-Host "Keep this window open while using the app."
  Write-Host "Press Enter in this window to stop the backend and close the launcher."

  while ($true) {
    if ($Host.UI.RawUI.KeyAvailable) {
      $key = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
      if ($key.VirtualKeyCode -eq 13) { break }
    }

    if ($BackendProcess.HasExited) {
      Write-Log "Backend process exited unexpectedly with code $($BackendProcess.ExitCode)."
      break
    }

    Start-Sleep -Milliseconds 500
  }

  if (-not $BackendProcess.HasExited) {
    Write-Log "Stopping backend PID $($BackendProcess.Id)."
    Stop-Process -Id $BackendProcess.Id -Force
  }
}

Set-Content -LiteralPath $latestLaunchLog -Value ""
Write-Log "Starting Dota Local Analytics launcher from $scriptRoot"

$nodeExe = Get-NodeExe
if (-not $nodeExe) {
  Fail-Launch "Node.js was not found. Run Install-DotaLocalAnalytics.cmd first."
}

$nodeMajor = Get-NodeMajor -NodeExe $nodeExe
Write-Log "Found Node: $nodeExe ($nodeMajor)"
if ($nodeMajor -lt 22) {
  Fail-Launch "Node.js 22 or newer is required. Run Install-DotaLocalAnalytics.cmd first."
}

$npmCmd = Get-NpmCmd -NodeExe $nodeExe
if (-not $npmCmd) {
  Fail-Launch "npm was not found beside Node.js. Run Install-DotaLocalAnalytics.cmd first."
}
Write-Log "Found npm: $npmCmd"

$env:Path = "$(Split-Path -Parent $nodeExe);$env:Path"

if (-not (Test-Path (Join-Path $scriptRoot "node_modules"))) {
  Invoke-LoggedCommand -FilePath $npmCmd -ArgumentList @("install") -StepName "Installing dependencies"
}

$backendEntry = Join-Path $scriptRoot "app\backend\dist\server.js"
$frontendEntry = Join-Path $scriptRoot "app\frontend\dist\index.html"
if (-not (Test-Path $backendEntry) -or -not (Test-Path $frontendEntry)) {
  Invoke-LoggedCommand -FilePath $npmCmd -ArgumentList @("run", "build") -StepName "Building application"
}

$existingPid = Get-PortOwnerPid
if ($existingPid) {
  Write-Log "Port 3344 is already in use by PID $existingPid."
  Stop-PortOwner -ProcessId $existingPid
}

$dataDir = Join-Path $env:TEMP "DotaLocalAnalyticsData"
$databasePath = Join-Path $dataDir "dota-analytics.sqlite"
$legacyDataDir = Join-Path $env:LOCALAPPDATA "DotaLocalAnalytics"
$legacyDatabasePath = Join-Path $legacyDataDir "dota-analytics.sqlite"
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

if (-not (Test-Path $databasePath) -and (Test-Path $legacyDatabasePath)) {
  Write-Log "Copying existing database from $legacyDatabasePath to $databasePath"
  Copy-Item -LiteralPath $legacyDatabasePath -Destination $databasePath -Force
  foreach ($suffix in @("-wal", "-shm")) {
    $legacySidecar = "$legacyDatabasePath$suffix"
    if (Test-Path $legacySidecar) {
      Copy-Item -LiteralPath $legacySidecar -Destination "$databasePath$suffix" -Force
    }
  }
}

try {
  $writeProbe = Join-Path $dataDir "write-test.tmp"
  Set-Content -LiteralPath $writeProbe -Value "ok" -ErrorAction Stop
  Remove-Item -LiteralPath $writeProbe -Force -ErrorAction Stop
  Write-Log "Database directory writable: yes ($dataDir)"
} catch {
  Fail-Launch "Database directory is not writable: $dataDir. $($_.Exception.Message)"
}

Write-Log "Starting backend. Backend stdout: $backendOutLog"
Write-Log "Starting backend. Backend stderr: $backendErrLog"

$backendCommand = "set `"NODE_ENV=production`"&&set `"OPEN_BROWSER=false`"&&set `"DATABASE_PATH=$databasePath`"&&`"$nodeExe`" app/backend/dist/server.js >> `"$backendOutLog`" 2>> `"$backendErrLog`""
$processInfo = [System.Diagnostics.ProcessStartInfo]::new()
$processInfo.FileName = "$env:SystemRoot\System32\cmd.exe"
$processInfo.Arguments = "/c $backendCommand"
$processInfo.WorkingDirectory = $scriptRoot
$processInfo.UseShellExecute = $false
$processInfo.CreateNoWindow = $true
$process = [System.Diagnostics.Process]::Start($processInfo)

Write-Log "Backend process started with PID $($process.Id)."

$deadline = (Get-Date).AddSeconds(60)
$healthOk = $false
while ((Get-Date) -lt $deadline) {
  if ($process.HasExited) {
    Copy-Item -LiteralPath $backendOutLog -Destination $latestBackendOutLog -Force -ErrorAction SilentlyContinue
    Copy-Item -LiteralPath $backendErrLog -Destination $latestBackendErrLog -Force -ErrorAction SilentlyContinue
    $stderr = if (Test-Path $backendErrLog) { Get-Content $backendErrLog -Raw } else { "" }
    Fail-Launch "Backend exited before becoming healthy. STDERR: $stderr"
  }

  if (Test-Health -TimeoutSeconds 3) {
    $healthOk = $true
    break
  }

  Start-Sleep -Milliseconds 800
}

if (-not $healthOk) {
  Fail-Launch "Backend did not become healthy within 60 seconds."
}

if (-not (Test-Frontend)) {
  Fail-Launch "Frontend route did not serve a valid app shell."
}

Copy-Item -LiteralPath $backendOutLog -Destination $latestBackendOutLog -Force -ErrorAction SilentlyContinue
Copy-Item -LiteralPath $backendErrLog -Destination $latestBackendErrLog -Force -ErrorAction SilentlyContinue

Write-Log "Backend healthy: yes"
Write-Log "Database healthy: yes"
Write-Log "Frontend reachable: yes"
Write-Log "Opening http://127.0.0.1:3344/"
Open-AppBrowser -Url "http://127.0.0.1:3344/"
Wait-WithStatus -BackendProcess $process -Url "http://127.0.0.1:3344/"
