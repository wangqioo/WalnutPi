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

function Wait-HttpReachable {
    param(
        [string]$Uri,
        [int]$TimeoutSeconds = 20
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            Invoke-WebRequest -Method Get -Uri $Uri -UseBasicParsing | Out-Null
            return
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

function Resolve-WorkspaceReference {
    param(
        [string]$BaseDirectory,
        [string]$Reference
    )

    if ([string]::IsNullOrWhiteSpace($Reference)) {
        return $null
    }

    return [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($BaseDirectory, $Reference))
}

function Assert-WorkspacePath {
    param(
        [string]$WorkspaceRoot,
        [string]$Path
    )

    $workspace = [System.IO.Path]::GetFullPath($WorkspaceRoot)
    $target = [System.IO.Path]::GetFullPath($Path)
    if (-not $target.StartsWith($workspace, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to use path outside screen workspace: $target"
    }
}

function Add-CleanupCandidate {
    param(
        [System.Collections.Generic.HashSet[string]]$Candidates,
        [string]$WorkspaceRoot,
        [string]$Path
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return
    }

    Assert-WorkspacePath $WorkspaceRoot $Path

    $workspace = [System.IO.Path]::GetFullPath($WorkspaceRoot)
    $target = [System.IO.Path]::GetFullPath($Path)
    $relative = [System.IO.Path]::GetRelativePath($workspace, $target)
    $segments = @($relative.Split(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    ) | Where-Object { $_ -ne "" })
    if ($segments.Count -eq 0) {
        return
    }

    $top = $segments[0]
    if (@("outputs", "sources", "apps") -contains $top -and $segments.Count -ge 2) {
        [void]$Candidates.Add([System.IO.Path]::Combine($workspace, $top, $segments[1]))
        return
    }

    if (@("manifests", "plans") -contains $top) {
        [void]$Candidates.Add($target)
    }
}

function Add-ManifestReferenceCleanupCandidates {
    param(
        [System.Collections.Generic.HashSet[string]]$Candidates,
        [string]$WorkspaceRoot,
        [string]$ManifestPath,
        [object]$Manifest
    )

    Add-CleanupCandidate $Candidates $WorkspaceRoot $ManifestPath
    $manifestDir = Split-Path -Parent $ManifestPath
    $output = $Manifest.output
    if ($null -ne $output) {
        Add-CleanupCandidate $Candidates $WorkspaceRoot (Resolve-WorkspaceReference $manifestDir $output.path)
        if ($output.frames -is [array]) {
            foreach ($frame in $output.frames) {
                Add-CleanupCandidate $Candidates $WorkspaceRoot (Resolve-WorkspaceReference $manifestDir $frame.path)
            }
        }
    }

    $provenance = $Manifest.provenance
    if ($null -eq $provenance) {
        return
    }

    Add-CleanupCandidate $Candidates $WorkspaceRoot (Resolve-WorkspaceReference $manifestDir $provenance.plan)
    if ($provenance.sourceAssets -is [array]) {
        foreach ($asset in $provenance.sourceAssets) {
            Add-CleanupCandidate $Candidates $WorkspaceRoot (Resolve-WorkspaceReference $manifestDir $asset.source)
            Add-CleanupCandidate $Candidates $WorkspaceRoot (Resolve-WorkspaceReference $manifestDir $asset.original)
        }
    }

    $widgetApp = $provenance.widgetApp
    if ($null -ne $widgetApp) {
        foreach ($propertyName in @("app", "catalog", "a2uiSurface", "snapshotSource")) {
            Add-CleanupCandidate $Candidates $WorkspaceRoot (Resolve-WorkspaceReference $manifestDir $widgetApp.$propertyName)
        }
    }
}

function Test-ManifestFrameSchema {
    param([object]$Manifest)

    $output = $Manifest.output
    if ($null -eq $output) {
        return $false
    }

    if ($output.type -eq "static") {
        return -not [string]::IsNullOrWhiteSpace($output.rgbaFrameSha256) -and -not [string]::IsNullOrWhiteSpace($output.rgb565FrameSha256)
    }

    if ($output.type -eq "animated") {
        if (-not ($output.frames -is [array]) -or $output.frames.Count -eq 0) {
            return $false
        }
        foreach ($frame in $output.frames) {
            if ([string]::IsNullOrWhiteSpace($frame.rgbaFrameSha256) -or [string]::IsNullOrWhiteSpace($frame.rgb565FrameSha256)) {
                return $false
            }
        }
        return $true
    }

    return $false
}

function Get-DefaultPlaylistFrameSchemaStatus {
    param([string]$RepoRoot)

    $workspaceRoot = Join-Path $RepoRoot "screen"
    $playlistPath = Join-Path $workspaceRoot "playlists/default.json"
    $candidates = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    if (-not (Test-Path -LiteralPath $playlistPath)) {
        return [pscustomobject]@{ Ok = $false; Reason = "default playlist is missing"; CleanupCandidates = @() }
    }

    $playlist = Get-Content -LiteralPath $playlistPath -Raw | ConvertFrom-Json
    $playlistDir = Split-Path -Parent $playlistPath
    $ok = $true
    $reasons = [System.Collections.Generic.List[string]]::new()
    foreach ($item in $playlist.items) {
        $manifestPath = Resolve-WorkspaceReference $playlistDir $item.manifest
        Assert-WorkspacePath $workspaceRoot $manifestPath
        if (-not (Test-Path -LiteralPath $manifestPath)) {
            $ok = $false
            [void]$reasons.Add("referenced manifest is missing: $manifestPath")
            Add-CleanupCandidate $candidates $workspaceRoot $manifestPath
            continue
        }

        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        Add-ManifestReferenceCleanupCandidates $candidates $workspaceRoot $manifestPath $manifest
        if (-not (Test-ManifestFrameSchema $manifest)) {
            $ok = $false
            [void]$reasons.Add("referenced manifest does not satisfy the frame hash schema: $manifestPath")
        }
    }

    return [pscustomobject]@{
        Ok = $ok
        Reason = ($reasons -join "; ")
        CleanupCandidates = @($candidates)
    }
}

function Remove-IgnoredGeneratedArtifacts {
    param(
        [string]$RepoRoot,
        [object[]]$Candidates
    )

    foreach ($candidate in $Candidates) {
        $path = [string]$candidate
        if (-not (Test-Path -LiteralPath $path)) {
            continue
        }

        $relative = [System.IO.Path]::GetRelativePath($RepoRoot, $path)
        & git -C $RepoRoot check-ignore -q -- $relative
        if ($LASTEXITCODE -ne 0) {
            throw "Refusing to remove non-ignored generated artifact: $relative"
        }

        Remove-Item -LiteralPath $path -Recurse -Force
        Write-Host "removed ignored generated artifact: $relative"
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
test -f '$remoteRootLiteral/web-interface/model-terminal-server.ts' && printf 'webApiFileExists: yes\n' || printf 'webApiFileExists: no\n'
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
$playlistPreflight = Get-DefaultPlaylistFrameSchemaStatus $repoRoot
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
    $startInfo.Arguments = "web-interface/model-terminal-server.ts"
    $startInfo.WorkingDirectory = $repoRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    foreach ($entry in $envBlock.GetEnumerator()) {
        $startInfo.EnvironmentVariables[$entry.Key] = $entry.Value
    }

    $server = [System.Diagnostics.Process]::Start($startInfo)

    $baseUri = "http://127.0.0.1:$Port"
    if (-not $playlistPreflight.Ok) {
        Write-Host ""
        Write-Host "Default playlist frame schema preflight failed: $($playlistPreflight.Reason)"
        Write-Host "需要清理重建 ignored generated artifacts"
        Remove-IgnoredGeneratedArtifacts $repoRoot $playlistPreflight.CleanupCandidates
        Wait-HttpReachable "$baseUri/"
        $generated = Invoke-JsonPost "$baseUri/api/screen/workspace/generate" @{
            prompt = "生成一个 WalnutPi 状态终端打印风格小屏，用于 evidence 重建；只做当前 wallpaper default playlist。"
            outputType = "static"
            playlist = "default"
            durationMs = 8000
            loop = $true
        }
        if ($generated.PSObject.Properties.Name -contains "ok" -and -not $generated.ok) {
            throw "Default playlist rebuild failed: $($generated.output)"
        }
        Show-KeyValue "rebuiltScreenId" $generated.screenId
    }

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
