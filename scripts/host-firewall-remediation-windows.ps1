<#
.SYNOPSIS
    Enable Windows Defender Firewall on all profiles (Domain, Private, Public)
    to remediate RBR-106 (Drata "Host firewall enabled" failure).

.DESCRIPTION
    Drata reports 17 Windows devices failing the "Host firewall enabled"
    control (A.8.1 endpoint protection, ISO 27001:2022). This script:

      * Enables Windows Defender Firewall on all three profiles
      * Sets inbound default to block, outbound default to allow (Microsoft default)
      * Enables dropped-packet and successful-connection logging
      * Writes a structured result record to data\evidence\ for Drata traceability
      * Returns a typed exit code so MDM runners can detect failure

    Idempotent: safe to run multiple times. Existing allow rules are preserved.

.PARAMETER EvidenceDir
    Where to write the JSON result file. Defaults to .\data\evidence.

.PARAMETER SkipLogging
    Skip enabling firewall logging. Useful when an alternative log pipeline
    (e.g. Windows Event Forwarding) is already in place.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\host-firewall-remediation-windows.ps1

.NOTES
    Must be run elevated (Administrator). The script will self-elevate when
    launched from a non-elevated PowerShell session.
#>

[CmdletBinding()]
param(
    [string]$EvidenceDir = "data\evidence",
    [switch]$SkipLogging
)

$ErrorActionPreference = "Stop"
$ScriptName = "host-firewall-remediation-windows"

function Write-ScriptLog {
    param([string]$Message)
    Write-Host "[$ScriptName] $Message"
}

function Test-Administrator {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $pr = New-Object Security.Principal.WindowsPrincipal($id)
    return $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-FirewallProfileState {
    $profiles = @("Domain", "Private", "Public")
    $state = @{}
    foreach ($p in $profiles) {
        $line = (netsh advfirewall show $p profile state) | Select-String "State"
        $state[$p] = if ($line -match "ON")  { "on" }
                     elseif ($line -match "OFF") { "off" }
                     else { "unknown" }
    }
    return $state
}

function Set-FirewallProfile {
    param([string]$Profile)
    $out = netsh advfirewall set $Profile state on 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "netsh failed to enable $Profile profile (exit $LASTEXITCODE): $out"
    }
}

function Set-FirewallDefaults {
    netsh advfirewall set allprofiles inboundpolicy blockinbound,allowinboundifsecured 2>&1 | Out-Null
    netsh advfirewall set allprofiles outboundpolicy allow 2>&1 | Out-Null
}

function Set-FirewallLogging {
    if ($SkipLogging) { return }
    netsh advfirewall set allprofiles logging droppedconnections enable 2>&1 | Out-Null
    netsh advfirewall set allprofiles logging allowedconnections enable 2>&1 | Out-Null
    netsh advfirewall set allprofiles logging filename "%SYSTEMROOT%\System32\LogFiles\Firewall\pfirewall.log" 2>&1 | Out-Null
    netsh advfirewall set allprofiles logging maxfilesize 16384 2>&1 | Out-Null
}

function Write-EvidenceRecord {
    param(
        [hashtable]$Before,
        [hashtable]$After,
        [bool]$Changed,
        [int]$ExitCode
    )
    if (-not (Test-Path $EvidenceDir)) {
        New-Item -ItemType Directory -Path $EvidenceDir -Force | Out-Null
    }
    $hostname = $env:COMPUTERNAME
    $utc = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
    $stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    $path = Join-Path $EvidenceDir "host-firewall-windows-$hostname-$utc.json"

    $compliant = ($After.Domain -eq "on") -and ($After.Private -eq "on") -and ($After.Public -eq "on")
    $payload = [ordered]@{
        script        = $ScriptName
        host          = $hostname
        completedAt   = $stamp
        ranAsAdmin    = $true
        before        = $Before
        after         = $After
        changed       = $Changed
        compliant     = $compliant
        exitCode      = $ExitCode
    }
    $payload | ConvertTo-Json -Depth 4 | Set-Content -Path $path -Encoding UTF8
    Write-ScriptLog "wrote evidence: $path"
    return $path
}

# --- Self-elevation --------------------------------------------------------
if (-not (Test-Administrator)) {
    Write-ScriptLog "not elevated — relaunching as Administrator"
    $argsList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"")
    if ($EvidenceDir -ne "data\evidence") { $argsList += @("-EvidenceDir", "`"$EvidenceDir`"") }
    if ($SkipLogging) { $argsList += @("-SkipLogging") }
    Start-Process -FilePath "powershell" -ArgumentList $argsList -Verb RunAs -Wait
    exit $LASTEXITCODE
}

# --- Main ------------------------------------------------------------------
try {
    Write-ScriptLog "collecting pre-remediation firewall state"
    $before = Get-FirewallProfileState
    Write-ScriptLog ("before  Domain={0} Private={1} Public={2}" -f $before.Domain, $before.Private, $before.Public)

    $changed = $false
    foreach ($p in @("Domain", "Private", "Public")) {
        if ($before[$p] -ne "on") {
            Write-ScriptLog "enabling $p profile"
            Set-FirewallProfile -Profile $p
            $changed = $true
        } else {
            Write-ScriptLog "$p profile already on — no change"
        }
    }

    Write-ScriptLog "enforcing default policies (inbound blockifnotmatch, outbound allow)"
    Set-FirewallDefaults

    if (-not $SkipLogging) {
        Write-ScriptLog "enabling firewall logging (dropped + allowed connections)"
        Set-FirewallLogging
    }

    $after = Get-FirewallProfileState
    Write-ScriptLog ("after   Domain={0} Private={1} Public={2}" -f $after.Domain, $after.Private, $after.Public)

    $allOn = ($after.Domain -eq "on") -and ($after.Private -eq "on") -and ($after.Public -eq "on")
    if (-not $allOn) {
        Write-EvidenceRecord -Before $before -After $after -Changed $changed -ExitCode 3
        Write-ScriptLog "ERROR: not all profiles are ON after remediation"
        exit 3
    }

    Write-EvidenceRecord -Before $before -After $after -Changed $changed -ExitCode 0
    if ($changed) {
        Write-ScriptLog "DONE — firewall enabled on all profiles; agent will report within 24h"
    } else {
        Write-ScriptLog "DONE — firewall was already enabled (no change applied)"
    }
    exit 0
}
catch {
    Write-ScriptLog "FATAL: $($_.Exception.Message)"
    exit 4
}
