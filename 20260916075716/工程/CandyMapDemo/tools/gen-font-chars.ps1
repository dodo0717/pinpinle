<#
.SYNOPSIS
   生成字体子集化所需的字符清单 tools/font-chars.txt。

.DESCRIPTION
   HarmonyOS Sans SC 的 Medium / Bold 两个 ttf 共 15.63 MB，微信小游戏主包（4 MB）装不下。
   子集化（pyftsubset）只需要把游戏里**真正会显示**的字留下即可：实测约 1190 个非 ASCII 字符，
   子集后的 ttf 预计几百 KB。

   扫描范围：assets/scripts/**/*.ts（玩法 / 界面 / 场景 的全部文案）+ assets/resources/layout/*.json
   只收 >= U+2000 的字符（中文标点、CJK、符号、emoji）；ASCII 一律保留，
   由 pyftsubset 的 --unicodes=U+0020-007E 参数单独指定（数字、比分、"x1.5" 等都会用到）。

   详见 docs/小游戏包体方案.md。

.EXAMPLE
   powershell -ExecutionPolicy Bypass -File tools/gen-font-chars.ps1
#>

$ErrorActionPreference = 'Stop'

$Root  = Split-Path -Parent $PSScriptRoot
$Files = @()
$Files += Get-ChildItem (Join-Path $Root 'assets/scripts')            -Recurse -File -Filter '*.ts'   -ErrorAction SilentlyContinue
$Files += Get-ChildItem (Join-Path $Root 'assets/resources/layout')   -Recurse -File -Filter '*.json' -ErrorAction SilentlyContinue

$Set = @{}
foreach ($f in $Files) {
  $text = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8)
  foreach ($ch in $text.ToCharArray()) {
    $cp = [int]$ch
    if ($cp -ge 0x2000 -and $cp -ne 0xFEFF) { $Set[[string]$ch] = $true }
  }
}

$Chars = $Set.Keys | Sort-Object
$Out   = Join-Path $Root 'tools/font-chars.txt'
[System.IO.File]::WriteAllText($Out, ($Chars -join ''), (New-Object System.Text.UTF8Encoding($false)))

Write-Host ('扫描 {0} 个文件 → 非 ASCII 字符 {1} 个' -f $Files.Count, $Chars.Count)
Write-Host ('输出: {0}' -f $Out)
