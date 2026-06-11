param(
    [string]$BaseUri = "http://127.0.0.1:4173",
    [switch]$PreviewOnly
)

$ErrorActionPreference = "Stop"

function Join-ApiUri {
    param(
        [string]$Base,
        [string]$Path,
        [switch]$NoSsh
    )

    $uri = $Base.TrimEnd("/") + $Path
    if ($NoSsh) {
        return $uri + "?nossh"
    }
    return $uri
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

$manifestUri = Join-ApiUri -Base $BaseUri -Path "/api/screen/manifest"
$syncUri = Join-ApiUri -Base $BaseUri -Path "/api/screen/sync" -NoSsh:$PreviewOnly

Write-Host ("Reading manifest: {0}" -f $manifestUri)
$manifest = Invoke-RestMethod -Method Get -Uri $manifestUri

if (-not $manifest.manifestHash) {
    throw "Manifest response did not include manifestHash."
}

Write-Host ("Syncing screen:    {0}" -f $syncUri)
$body = @{ manifestHash = $manifest.manifestHash } | ConvertTo-Json -Depth 8 -Compress
$syncResult = Invoke-RestMethod -Method Post -Uri $syncUri -ContentType "application/json" -Body $body

Show-KeyValue "manifestHash" $manifest.manifestHash
Show-KeyValue "buildId" $syncResult.buildId
Show-KeyValue "artifactHash" $syncResult.artifactHash
Show-KeyValue "deliveryHash" $syncResult.deliveryHash
Show-KeyValue "visualMatch" $syncResult.screenEvidence.visualMatch
Show-KeyValue "frameSha256" $syncResult.screenEvidence.frame.sha256
Show-KeyValue "screenFrameUrl" $syncResult.screenFrameUrl
Show-KeyValue "frameUrl" $syncResult.frameUrl
