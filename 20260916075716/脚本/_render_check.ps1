Add-Type -AssemblyName System.Drawing
$root = 'C:/Users/fzswan/CodeBuddy/20260916075716'
$mapDir = "$root/CandyMapDemo/assets/resources/map"
$out = "$root/_render_check.png"

$t = [System.Drawing.Image]::FromFile("$mapDir/w1_bg_top.png")
$b = [System.Drawing.Image]::FromFile("$mapDir/w1_bg_bottom.png")

$bmp = New-Object System.Drawing.Bitmap(1080, 2880)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.DrawImage($t, 0, 0, 1080, 1440)
$g.DrawImage($b, 0, 1440, 1080, 1440)

$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 0, 255, 80), 3)
$g.DrawLine($pen, 0, 1440, 1080, 1440)

$XY = @(
  @(622,2682), @(628,2334), @(558,2006), @(668,1742), @(616,1424),
  @(696,1112), @(634,816), @(702,526), @(640,246), @(714,60)
)
$cp = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 255, 60, 60), 4)
foreach ($p in $XY) {
  $x = [int]$p[0]
  $y = [int]$p[1]
  $g.DrawLine($cp, $x - 40, $y, $x + 40, $y)
  $g.DrawLine($cp, $x, $y - 40, $x, $y + 40)
}
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose(); $t.Dispose(); $b.Dispose()
Write-Host "saved $out"
