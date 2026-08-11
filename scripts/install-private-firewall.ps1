class IStreamPrivateFirewallInstaller {
    static [void] Install() {
        $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
        if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
            throw 'Run PowerShell as Administrator to install the IStream private-network firewall rules.'
        }

        [IStreamPrivateFirewallInstaller]::EnsureRule(
            'IStream Discovery (Private LAN)',
            'UDP',
            '47777'
        )
        [IStreamPrivateFirewallInstaller]::EnsureRule(
            'IStream Control (Private LAN)',
            'TCP',
            '47778-47788'
        )
        Write-Host 'IStream inbound rules now allow only the Windows Private profile and LocalSubnet.'
    }

    static [void] EnsureRule([string] $displayName, [string] $protocol, [string] $localPort) {
        $existingRule = Get-NetFirewallRule -DisplayName $displayName -ErrorAction SilentlyContinue
        if ($null -ne $existingRule) {
            Remove-NetFirewallRule -DisplayName $displayName
        }
        New-NetFirewallRule `
            -DisplayName $displayName `
            -Direction Inbound `
            -Action Allow `
            -Profile Private `
            -Protocol $protocol `
            -LocalPort $localPort `
            -RemoteAddress LocalSubnet `
            -EdgeTraversalPolicy Block | Out-Null
    }
}

[IStreamPrivateFirewallInstaller]::Install()
