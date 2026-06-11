param(
    [int]$Port = 4210
)

$ErrorActionPreference = "Stop"

function Require-Command {
    param([string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found on PATH."
    }
}

function Invoke-JsonPost {
    param(
        [string]$Uri,
        [hashtable]$Body
    )

    $jsonBody = $Body | ConvertTo-Json -Depth 20 -Compress
    $response = Invoke-WebRequest -Method Post -Uri $Uri -ContentType "application/json" -Body $jsonBody -SkipHttpErrorCheck
    $data = $null
    if ($response.Content) {
        try {
            $data = $response.Content | ConvertFrom-Json
        } catch {
            $data = $null
        }
    }
    [pscustomobject]@{
        StatusCode = [int]$response.StatusCode
        Data = $data
        Raw = $response.Content
    }
}

function Invoke-JsonGet {
    param([string]$Uri)

    $response = Invoke-WebRequest -Method Get -Uri $Uri -SkipHttpErrorCheck
    $data = $null
    if ($response.Content) {
        try {
            $data = $response.Content | ConvertFrom-Json
        } catch {
            $data = $null
        }
    }
    [pscustomobject]@{
        StatusCode = [int]$response.StatusCode
        Data = $data
        Raw = $response.Content
    }
}

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Assert-Status {
    param(
        [object]$Response,
        [int]$Expected,
        [string]$Label
    )

    Assert-True ($Response.StatusCode -eq $Expected) "$Label expected HTTP $Expected but got $($Response.StatusCode): $($Response.Raw)"
}

function Assert-PreDeviceSyncRejection {
    param(
        [object]$Result,
        [string]$Label
    )

    Assert-True ($Result.Data.ok -eq $false) "$Label should fail."
    Assert-True (-not $Result.Data.artifactHash) "$Label unexpectedly has artifactHash."
    Assert-True (-not $Result.Data.deliveryHash) "$Label unexpectedly has deliveryHash."
    Assert-True (-not $Result.Data.screenEvidence) "$Label unexpectedly has screenEvidence."
    Assert-True (-not $Result.Data.screenFrameUrl) "$Label unexpectedly has screenFrameUrl."
}

function Wait-HttpReady {
    param(
        [string]$Uri,
        [int]$TimeoutSeconds = 20
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $response = Invoke-JsonGet $Uri
        if ($response.StatusCode -eq 200 -and $response.Data.ok -ne $false) {
            return $response.Data
        }
        Start-Sleep -Milliseconds 300
    } while ((Get-Date) -lt $deadline)

    throw "Timed out waiting for $Uri"
}

Require-Command "bun"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$tempRoot = Join-Path $repoRoot ("web-interface/data/tmp/screen-api-safety-" + [System.Guid]::NewGuid().ToString("N"))
$recordsDir = Join-Path $tempRoot "records"
$manifestPath = Join-Path $tempRoot "screen-manifest.json"
$server = $null

try {
    New-Item -ItemType Directory -Force -Path $tempRoot, $recordsDir | Out-Null
    Copy-Item -LiteralPath (Join-Path $repoRoot "lvgl_app/screen-manifest.json") -Destination $manifestPath

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = "bun"
    $startInfo.Arguments = "web-interface/model-terminal-server.js"
    $startInfo.WorkingDirectory = $repoRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.EnvironmentVariables["PORT"] = "$Port"
    $startInfo.EnvironmentVariables["OPENAI_API_KEY"] = ""
    $startInfo.EnvironmentVariables["WALNUT_SCREEN_MANIFEST_PATH"] = $manifestPath
    $startInfo.EnvironmentVariables["WALNUT_SCREEN_RECORDS_DIR"] = $recordsDir

    $server = [System.Diagnostics.Process]::Start($startInfo)
    $baseUri = "http://127.0.0.1:$Port"
    $manifest = Wait-HttpReady "$baseUri/api/screen/manifest"
    Assert-True ([string]$manifest.manifestHash -match "^[a-f0-9]{64}$") "Manifest did not include a valid manifestHash."

    $missingHash = Invoke-JsonPost "$baseUri/api/screen/sync" @{}
    Assert-Status $missingHash 400 "missing manifestHash"
    Assert-True ($missingHash.Data.failedStage -eq "manifest") "missing manifestHash should fail at manifest stage."
    Assert-PreDeviceSyncRejection $missingHash "missing manifestHash"

    $malformedHash = Invoke-JsonPost "$baseUri/api/screen/sync" @{ manifestHash = "bad-hash" }
    Assert-Status $malformedHash 400 "malformed manifestHash"
    Assert-True ($malformedHash.Data.failedStage -eq "manifest") "malformed manifestHash should fail at manifest stage."
    Assert-PreDeviceSyncRejection $malformedHash "malformed manifestHash"

    $staleHashValue = "0" * 64
    $staleHash = Invoke-JsonPost "$baseUri/api/screen/sync" @{ manifestHash = $staleHashValue }
    Assert-Status $staleHash 409 "stale manifestHash"
    Assert-True ($staleHash.Data.failedStage -eq "manifest") "stale manifestHash should fail at manifest stage."
    Assert-PreDeviceSyncRejection $staleHash "stale manifestHash"

    $previewSync = Invoke-JsonPost "$baseUri/api/screen/sync?nossh" @{ manifestHash = $manifest.manifestHash }
    Assert-Status $previewSync 403 "nossh sync"
    Assert-True ($previewSync.Data.failedStage -eq "preview") "nossh sync should fail at preview stage."
    Assert-True ($previewSync.Data.mode -eq "preview") "nossh sync should record preview mode."
    Assert-True ($previewSync.Data.output -match "disables SSH, build, delivery, activation") "nossh sync output should document blocked device paths."
    Assert-PreDeviceSyncRejection $previewSync "nossh sync"

    $terminal = Invoke-JsonGet "$baseUri/terminal?nossh"
    Assert-Status $terminal 403 "nossh terminal"
    Assert-True ($terminal.Raw -match "SSH disabled for preview") "nossh terminal should block SSH."

    $action = Invoke-JsonPost "$baseUri/api/action?nossh" @{ action = "status" }
    Assert-Status $action 403 "nossh action"
    Assert-True ($action.Data.failedStage -eq "preview") "nossh action should return preview block."

    $capture = Invoke-JsonGet "$baseUri/api/screen/frame/$($previewSync.Data.buildId)?nossh"
    Assert-Status $capture 403 "nossh capture"
    Assert-True ($capture.Data.failedStage -eq "preview") "nossh capture should return preview block."

    $recordDirs = Get-ChildItem -LiteralPath $recordsDir -Directory
    Assert-True ($recordDirs.Count -ge 4) "Expected sync rejection records to be persisted."

    $previewRecordDir = Join-Path $recordsDir $previewSync.Data.buildId
    $previewRecord = Get-Content -LiteralPath (Join-Path $previewRecordDir "record.json") -Raw | ConvertFrom-Json
    Assert-True (-not $previewRecord.artifactHash) "Preview rejection record unexpectedly has artifactHash."
    Assert-True (-not $previewRecord.deliveryHash) "Preview rejection record unexpectedly has deliveryHash."
    Assert-True (-not $previewRecord.screenEvidence) "Preview rejection record unexpectedly has screenEvidence."

    $recordId = "screen-test-manifest"
    $repairRecordDir = Join-Path $recordsDir $recordId
    New-Item -ItemType Directory -Force -Path $repairRecordDir | Out-Null
    $repairRecord = [ordered]@{
        schema = "walnutpi.screenSyncRecord.v1"
        buildId = $recordId
        ok = $false
        mode = "remote"
        risk = "write-low"
        startedAt = (Get-Date).ToUniversalTime().ToString("o")
        finishedAt = (Get-Date).ToUniversalTime().ToString("o")
        failedStage = "manifest"
        summary = "synthetic manifest failure"
        manifest = $manifest.manifest
        manifestHash = $manifest.manifestHash
        deliveryManifest = $null
        deliveryHash = $null
        artifactHash = $null
        screenEvidence = $null
        command = $null
        commandResults = @{}
        output = "synthetic manifest failure"
        framePng = $null
        webDevicePixelDiff = $null
    }
    $repairRecord | ConvertTo-Json -Depth 50 | Set-Content -LiteralPath (Join-Path $repairRecordDir "record.json") -Encoding UTF8

    $proposal = Invoke-JsonPost "$baseUri/api/screen/repair-proposal?nossh" @{ buildId = $recordId }
    Assert-Status $proposal 200 "repair proposal"
    Assert-True ($proposal.Data.repairProposal.requiresConfirmation -eq $true) "repair proposal should require confirmation."
    Assert-True ($proposal.Data.repairProposal.canApply -eq $true) "synthetic manifest failure should produce a safe local patch proposal."

    $wrongApply = Invoke-JsonPost "$baseUri/api/screen/repair-apply" @{ buildId = $recordId; confirmation = "wrong" }
    Assert-Status $wrongApply 400 "repair apply wrong confirmation"
    Assert-True ($wrongApply.Data.error -eq "confirmation mismatch") "repair apply should reject wrong confirmation."

    $nosshApply = Invoke-JsonPost "$baseUri/api/screen/repair-apply?nossh" @{ buildId = $recordId; confirmation = $proposal.Data.repairProposal.confirmationPhrase }
    Assert-Status $nosshApply 403 "repair apply nossh"

    $successRecordId = "screen-test-success"
    $successRecordDir = Join-Path $recordsDir $successRecordId
    New-Item -ItemType Directory -Force -Path $successRecordDir | Out-Null
    $successRecord = [ordered]@{
        schema = "walnutpi.screenSyncRecord.v1"
        buildId = $successRecordId
        ok = $true
        startedAt = (Get-Date).ToUniversalTime().ToString("o")
        finishedAt = (Get-Date).ToUniversalTime().ToString("o")
        failedStage = $null
        summary = "synthetic success"
        manifest = $manifest.manifest
        manifestHash = $manifest.manifestHash
        artifactHash = "1" * 64
        deliveryHash = "2" * 64
        deliveryManifest = @{ schema = "walnutpi.screenDeliveryManifest.v1" }
        screenEvidence = @{
            visualMatch = "captured"
            frame = @{
                sha256 = "3" * 64
                width = 480
                height = 320
                pixelFormat = "RGB565_LE"
                byteLength = 307200
            }
            pixelEvidence = @{
                schema = "walnutpi.screenPixelEvidence.v1"
                status = "metadata-only"
                claim = "framebuffer-captured-not-pixel-diffed"
                frameHash = "3" * 64
                sampleHash = "4" * 8
                nonzeroRatio = 0.25
            }
        }
        commandResults = @{}
        output = ""
        framePng = $null
        webDevicePixelDiff = $null
    }
    $successRecord | ConvertTo-Json -Depth 50 | Set-Content -LiteralPath (Join-Path $successRecordDir "record.json") -Encoding UTF8

    $pixelDiff = @{
        schema = "walnutpi.webDevicePixelDiff.v2"
        status = "matched"
        claim = "web-dom-preview-compared-to-device-png"
        source = "api-test"
        manifestHash = $manifest.manifestHash
        frameUrl = "/api/screen/records/$successRecordId/frame.png"
        previewHash = "12345678"
        devicePngHash = "87654321"
        width = 480
        height = 320
        comparedPixels = 153600
        differentPixels = 10
        diffRatio = 0.000065
        averageChannelDelta = 0.1
        threshold = 0.02
        limitations = @("synthetic API validation only")
    }
    $pixelResult = Invoke-JsonPost "$baseUri/api/screen/pixel-diff" @{ buildId = $successRecordId; webDevicePixelDiff = $pixelDiff }
    Assert-Status $pixelResult 200 "pixel diff persist"

    $successSummary = Get-Content -LiteralPath (Join-Path $successRecordDir "summary.json") -Raw | ConvertFrom-Json
    Assert-True ($successSummary.artifactHash -eq ("1" * 64)) "summary missing artifactHash."
    Assert-True ($successSummary.deliveryHash -eq ("2" * 64)) "summary missing deliveryHash."
    Assert-True ($successSummary.frameHash -eq ("3" * 64)) "summary missing frameHash."
    Assert-True ($successSummary.pixelEvidenceStatus -eq "metadata-only") "summary missing pixel evidence status."
    Assert-True ($successSummary.webDevicePixelDiffSchema -eq "walnutpi.webDevicePixelDiff.v2") "summary missing pixel diff schema."
    Assert-True ($successSummary.webDevicePixelDiffComparedPixels -eq 153600) "summary missing compared pixel count."

    Write-Host "screen API safety regression passed"
} finally {
    if ($null -ne $server -and -not $server.HasExited) {
        Stop-Process -Id $server.Id -Force
        $server.WaitForExit()
    }
    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force
    }
}
