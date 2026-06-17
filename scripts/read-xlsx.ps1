$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$path = 'C:\Users\jospreng\Downloads\Emmie Travel.xlsx'
$zip = [System.IO.Compression.ZipFile]::OpenRead($path)

function Read-Entry($name) {
    $e = $zip.Entries | Where-Object { $_.FullName -eq $name }
    $sr = New-Object System.IO.StreamReader($e.Open())
    $t = $sr.ReadToEnd()
    $sr.Close()
    return $t
}

# Shared strings
$ss = [xml](Read-Entry 'xl/sharedStrings.xml')
$strings = @()
foreach ($si in $ss.sst.si) {
    if ($si.t -is [string]) { $strings += $si.t }
    elseif ($si.t.'#text') { $strings += $si.t.'#text' }
    else {
        # rich text runs
        $buf = ''
        foreach ($r in $si.r) { $buf += $r.t.'#text' + $r.t }
        $strings += $buf
    }
}

function Dump-Sheet($sheetFile) {
    $sx = [xml](Read-Entry $sheetFile)
    foreach ($row in $sx.worksheet.sheetData.row) {
        $cells = @()
        foreach ($c in $row.c) {
            $ref = $c.r
            $val = $c.v
            if ($c.t -eq 's' -and $val -ne $null) { $val = $strings[[int]$val] }
            if ($c.t -eq 'inlineStr') { $val = $c.is.t }
            $cells += "$ref=$val"
        }
        Write-Output ("ROW " + $row.r + ": " + ($cells -join ' | '))
    }
}

Write-Output "===== SHEET1 ====="
Dump-Sheet 'xl/worksheets/sheet1.xml'
Write-Output ""
Write-Output "===== SHEET2 ====="
Dump-Sheet 'xl/worksheets/sheet2.xml'

$zip.Dispose()
