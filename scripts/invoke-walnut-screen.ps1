param(
    [ValidateSet("state", "frame", "capture", "capture-base64", "start", "stop", "toggle", "lvgl")]
    [string]$Action = "state",
    [Alias("Host")]
    [string]$HostName = "192.168.1.24",
    [string]$User = "root",
    [string]$Password = "root"
)

$ErrorActionPreference = "Stop"

function Require-Command {
    param([string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found on PATH."
    }
}

Require-Command "sshpass"
Require-Command "ssh"

$commands = @{
    "state" = "walnut screen state"
    "frame" = "sudo -n walnut screen frame"
    "capture" = "sudo -n walnut screen capture"
    "capture-base64" = "sudo -n walnut screen capture --png-base64"
    "start" = "sudo -n walnut screen start"
    "stop" = "sudo -n walnut screen stop"
    "toggle" = "sudo -n walnut screen toggle"
    "lvgl" = "walnut screen lvgl"
}

$remoteCommand = $commands[$Action]
Write-Host ("Running on {0}@{1}: {2}" -f $User, $HostName, $remoteCommand)
Write-Host ""

& sshpass -p $Password ssh `
    -o StrictHostKeyChecking=no `
    -o UserKnownHostsFile=/dev/null `
    -o LogLevel=ERROR `
    "$User@$HostName" `
    $remoteCommand

if ($LASTEXITCODE -ne 0) {
    throw "Remote walnut screen command failed with code $LASTEXITCODE."
}
