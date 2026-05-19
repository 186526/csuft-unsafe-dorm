$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$npm = 'C:\Program Files\nodejs\npm.cmd'
$scheduledLog = Join-Path $repo 'scheduled-task.log'

Set-Location $repo

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom

if (Test-Path -LiteralPath $scheduledLog) {
    $existingContent = Get-Content -LiteralPath $scheduledLog -Raw
    [System.IO.File]::WriteAllText($scheduledLog, $existingContent, $utf8NoBom)
}

$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = $npm
$startInfo.Arguments = 'run script:schedule-runner'
$startInfo.WorkingDirectory = $repo
$startInfo.UseShellExecute = $false
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
$startInfo.StandardOutputEncoding = $utf8NoBom
$startInfo.StandardErrorEncoding = $utf8NoBom

$process = New-Object System.Diagnostics.Process
$process.StartInfo = $startInfo

$writer = New-Object System.IO.StreamWriter($scheduledLog, $true, $utf8NoBom)

try {
    $null = $process.Start()

    while (-not $process.StandardOutput.EndOfStream) {
        $line = $process.StandardOutput.ReadLine()
        $writer.WriteLine($line)
    }

    while (-not $process.StandardError.EndOfStream) {
        $line = $process.StandardError.ReadLine()
        $writer.WriteLine($line)
    }

    $process.WaitForExit()
    exit $process.ExitCode
}
finally {
    $writer.Dispose()
    $process.Dispose()
}
