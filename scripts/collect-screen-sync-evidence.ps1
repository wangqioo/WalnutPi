param(
    [Alias("Host")]
    [string]$HostName = "192.168.1.24",
    [string]$User = "root",
    [string]$Password = "root",
    [string]$RemoteProjectRoot = "/home/pi/projects/WalnutPi",
    [string]$RemoteBuildUser = "pi",
    [switch]$Sync,
    [int]$Port = 4183
)

$ErrorActionPreference = "Stop"

function Require-Command {
    param([string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found on PATH."
    }
}

function Invoke-Remote {
    param(
        [string]$Label,
        [string]$Command
    )

    Write-Host ""
    Write-Host "== $Label =="
    & sshpass -p $Password ssh `
        -o StrictHostKeyChecking=no `
        -o UserKnownHostsFile=/dev/null `
        -o LogLevel=ERROR `
        "$User@$HostName" `
        $Command

    if ($LASTEXITCODE -ne 0) {
        throw "Remote command failed: $Label"
    }
}

function Invoke-JsonPost {
    param(
        [string]$Uri,
        [hashtable]$Body
    )

    $jsonBody = $Body | ConvertTo-Json -Depth 8 -Compress
    Invoke-RestMethod -Method Post -Uri $Uri -ContentType "application/json" -Body $jsonBody
}

function Wait-HttpReady {
    param(
        [string]$Uri,
        [int]$TimeoutSeconds = 20
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            return Invoke-RestMethod -Method Get -Uri $Uri
        } catch {
            Start-Sleep -Milliseconds 400
        }
    } while ((Get-Date) -lt $deadline)

    throw "Timed out waiting for $Uri"
}

function Show-KeyValue {
    param(
        [string]$Name,
        [object]$Value
    )

    if ($null -ne $Value -and "$Value" -ne "") {
        Write-Host ("{0}: {1}" -f $Name, $Value)
    }
}

Require-Command "sshpass"
Require-Command "ssh"

$remoteRootLiteral = $RemoteProjectRoot.Replace("'", "'\''")

Invoke-Remote "Host and project root" @"
set -eu
printf 'hostname: '; hostname
printf 'whoami: '; whoami
printf 'pwd: '; pwd
printf 'remoteProjectRoot: %s\n' '$remoteRootLiteral'
test -d '$remoteRootLiteral' && printf 'projectRootExists: yes\n' || printf 'projectRootExists: no\n'
test -f '$remoteRootLiteral/web-interface/model-terminal-server.js' && printf 'webApiFileExists: yes\n' || printf 'webApiFileExists: no\n'
"@

Invoke-Remote "Walnut screen state" "walnut screen state"
Invoke-Remote "Framebuffer frame" "sudo -n walnut screen frame"
Invoke-Remote "Framebuffer capture metadata" "sudo -n walnut screen capture"

Invoke-Remote "Build artifacts and ownership" @"
set -eu
cd '$remoteRootLiteral'
if [ -x build/lvgl_app/walnut-lvgl-screen ]; then
  sha256sum build/lvgl_app/walnut-lvgl-screen
else
  printf 'artifact: missing build/lvgl_app/walnut-lvgl-screen\n'
fi
if [ -d build/lvgl_app ]; then
  printf '\n-- build/lvgl_app ownership --\n'
  ls -ld build build/lvgl_app
  find build/lvgl_app -maxdepth 1 -printf '%M %u:%g %p\n' 2>/dev/null | head -n 40
else
  printf 'build/lvgl_app: missing\n'
fi
"@

if (-not $Sync) {
    Write-Host ""
    Write-Host "Read-only evidence collection complete. Re-run with -Sync to exercise the Web API sync path."
    exit 0
}

Require-Command "bun"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$server = $null

try {
    Write-Host ""
    Write-Host "== Temporary Web API sync =="
    $envBlock = @{
        PORT = "$Port"
        SSH_HOST = $HostName
        SSH_USER = $User
        SSH_PASSWORD = $Password
        WALNUT_REMOTE_PROJECT_ROOT = $RemoteProjectRoot
        WALNUT_REMOTE_BUILD_USER = $RemoteBuildUser
    }

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = "bun"
    $startInfo.Arguments = "web-interface/model-terminal-server.js"
    $startInfo.WorkingDirectory = $repoRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    foreach ($entry in $envBlock.GetEnumerator()) {
        $startInfo.EnvironmentVariables[$entry.Key] = $entry.Value
    }

    $server = [System.Diagnostics.Process]::Start($startInfo)

    $baseUri = "http://127.0.0.1:$Port"
    $playlist = Wait-HttpReady "$baseUri/api/screen/workspace/playlist"
    Show-KeyValue "playlistHash" $playlist.playlistHash

    $syncResult = Invoke-JsonPost "$baseUri/api/screen/workspace/sync" @{
        playlistHash = $playlist.playlistHash
        evidenceMode = "full"
    }
    Show-KeyValue "ok" $syncResult.ok
    Show-KeyValue "buildId" $syncResult.buildId
    Show-KeyValue "failedStage" $syncResult.failedStage
    Show-KeyValue "summary" $syncResult.summary
    Show-KeyValue "artifactHash" $syncResult.artifactHash
    Show-KeyValue "deliveryHash" $syncResult.deliveryHash
    Show-KeyValue "visualMatch" $syncResult.screenEvidence.visualMatch
    Show-KeyValue "frameSha256" $syncResult.screenEvidence.frame.sha256
    Show-KeyValue "screenFrameUrl" $syncResult.screenFrameUrl
    Show-KeyValue "frameUrl" $syncResult.frameUrl

    if ($syncResult.PSObject.Properties.Name -contains "ok" -and -not $syncResult.ok) {
        $stage = if ($syncResult.failedStage) { $syncResult.failedStage } else { "unknown" }
        $summary = if ($syncResult.summary) { $syncResult.summary } else { "Screen sync API returned ok=false." }
        throw "Screen sync failed at stage '$stage': $summary"
    }
} finally {
    if ($null -ne $server -and -not $server.HasExited) {
        Stop-Process -Id $server.Id -Force
        $server.WaitForExit()
        Write-Host ""
        Write-Host "Stopped temporary Web API server on port $Port."
    }
}
