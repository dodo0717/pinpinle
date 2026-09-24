# 美术素材切图脚本（零依赖，用 .NET System.Drawing）
# 用法：powershell -ExecutionPolicy Bypass -File tools/slice-art.ps1
# 产物直接写进 assets/resources/，只拷 PNG，.meta 交给 Cocos 编辑器生成
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$src  = 'c:/Users/fzswan/CodeBuddy/20260916075716/map-slices'
$root = 'c:/Users/fzswan/CodeBuddy/20260916075716/CandyMapDemo/assets/resources'

function Save-Png($bmp, $path) {
  $dir = Split-Path $path -Parent
  if (!(Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "  -> $(Split-Path $path -Leaf)"
}

function Resize-Img($img, $w, $h) {
  $b = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($b)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($img, (New-Object System.Drawing.Rectangle(0, 0, $w, $h)))
  $g.Dispose()
  return $b
}

function Crop-Img($img, $x, $y, $w, $h) {
  $b = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($b)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($img,
    (New-Object System.Drawing.Rectangle(0, 0, $w, $h)),
    (New-Object System.Drawing.Rectangle($x, $y, $w, $h)),
    [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  return $b
}

Write-Host '1) 世界1 底图 1440x3840 -> 1080x2880 -> 切 2 段 1080x1440'
$bg  = [System.Drawing.Image]::FromFile("$src/W1_奶油果园_选关地图_新v4_1440x3840.png")
$bg2 = Resize-Img $bg 1080 2880
$bg.Dispose()
Save-Png (Crop-Img $bg2 0 0    1080 1440) "$root/map/w1_bg_top.png"     # y 0~1440    L6~L10
Save-Png (Crop-Img $bg2 0 1440 1080 1440) "$root/map/w1_bg_bottom.png"   # y 1440~2880 L1~L5
# 旧 3 段中的中段已不再使用
if (Test-Path "$root/map/w1_bg_mid.png") { Remove-Item "$root/map/w1_bg_mid.png" }
$bg2.Dispose()

Write-Host '2) 底部导航 1080x248 -> 切 4 块 270x248（中心 x = -405/-135/135/405）'
$tb = [System.Drawing.Image]::FromFile("$root/ui/home_tabbar_bg.png")
for ($i = 0; $i -lt 4; $i++) { Save-Png (Crop-Img $tb ($i * 270) 0 270 248) "$root/ui/home_tabbar_$i.png" }
$tb.Dispose()

Write-Host '3) 难度切换 454x103 -> 切左右两半 227x103（中心 x = -421.5 / -194.5）'
$df = [System.Drawing.Image]::FromFile("$root/ui/home_difficulty_switch.png")
Save-Png (Crop-Img $df 0   0 227 103) "$root/ui/home_difficulty_normal.png"
Save-Png (Crop-Img $df 227 0 227 103) "$root/ui/home_difficulty_hard.png"
$df.Dispose()

Write-Host 'done.'
