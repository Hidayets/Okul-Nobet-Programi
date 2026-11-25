Add-Type -AssemblyName System.Drawing

$size = 512
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

# Arka plan transparan kalır; yalnızca yuvarlak köşeli gövde boyanır.

# Yuvarlak köşeli dikdörtgen yolu (arc'larla)
function New-RoundedPath([int]$px, [int]$py, [int]$pw, [int]$ph, [int]$pr) {
  $d = $pr * 2
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddArc($px, $py, $d, $d, 180, 90)
  $p.AddArc($px + $pw - $d, $py, $d, $d, 270, 90)
  $p.AddArc($px + $pw - $d, $py + $ph - $d, $d, $d, 0, 90)
  $p.AddArc($px, $py + $ph - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

$margin = 26
$radius = 112
$x = $margin
$y = $margin
$w = $size - 2 * $margin
$h = $size - 2 * $margin

$path = New-RoundedPath $x $y $w $h $radius

# Bombeli görünüm: üstten alta renk geçişi (açık indigo → koyu indigo)
$rect = New-Object System.Drawing.Rectangle($x, $y, $w, $h)
$grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  $rect,
  [System.Drawing.Color]::FromArgb(255, 99, 102, 241),
  [System.Drawing.Color]::FromArgb(255, 67, 56, 202),
  [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
$g.FillPath($grad, $path)

# Gövdeye kırp: sonraki ışık/gölge katmanları yuvarlak köşelerin dışına taşmasın
$g.SetClip($path)

# Üstte cam/parlak vurgu → kabarık (bombeli) etki
$glossRect = New-Object System.Drawing.Rectangle($x, $y, $w, [int]($h * 0.5))
$gloss = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  $glossRect,
  [System.Drawing.Color]::FromArgb(130, 255, 255, 255),
  [System.Drawing.Color]::FromArgb(0, 255, 255, 255),
  [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
$g.FillRectangle($gloss, $glossRect)

# Altta hafif iç gölge → hacim
$shadowRect = New-Object System.Drawing.Rectangle($x, [int]($y + $h * 0.7), $w, [int]($h * 0.3))
$shadow = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  $shadowRect,
  [System.Drawing.Color]::FromArgb(0, 0, 0, 0),
  [System.Drawing.Color]::FromArgb(70, 20, 18, 80),
  [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
$g.FillRectangle($shadow, $shadowRect)

$g.ResetClip()

# Dış kenarda açık, iç kenarda koyu bevel → bombeli çerçeve
$edgeOuter = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(110, 255, 255, 255), 5)
$g.DrawPath($edgeOuter, $path)
$innerPath = New-RoundedPath ($x + 7) ($y + 7) ($w - 14) ($h - 14) ($radius - 7)
$edgeInner = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(45, 30, 27, 75), 3)
$g.DrawPath($edgeInner, $innerPath)

# Beyaz "N" (hafif gölgeyle derinlik)
$fontFamily = New-Object System.Drawing.FontFamily("Segoe UI")
$font = New-Object System.Drawing.Font($fontFamily, 300, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$textRect = New-Object System.Drawing.RectangleF($x, $y, $w, $h)
$nShadowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(80, 0, 0, 0))
$nShadowRect = New-Object System.Drawing.RectangleF(($x + 4), ($y + 5), $w, $h)
$g.DrawString("N", $font, $nShadowBrush, $nShadowRect, $sf)
$textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$g.DrawString("N", $font, $textBrush, $textRect, $sf)

# PNG kaydet
$pngPath = Join-Path $PSScriptRoot "..\build\icon.png"
$bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "icon.png olusturuldu: $pngPath"

# ICO olustur
$icoSizes = @(16, 32, 48, 64, 128, 256)
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)

$bw.Write([uint16]0)
$bw.Write([uint16]1)
$bw.Write([uint16]$icoSizes.Count)

$offset = 6 + ($icoSizes.Count * 16)
$imgStreams = @()

foreach ($s in $icoSizes) {
    $resized = New-Object System.Drawing.Bitmap($bmp, $s, $s)
    $pms = New-Object System.IO.MemoryStream
    $resized.Save($pms, [System.Drawing.Imaging.ImageFormat]::Png)
    $imgStreams += $pms

    $sz = if ($s -ge 256) { [byte]0 } else { [byte]$s }
    $bw.Write([byte]$sz)
    $bw.Write([byte]$sz)
    $bw.Write([byte]0)
    $bw.Write([byte]0)
    $bw.Write([uint16]1)
    $bw.Write([uint16]32)
    $bw.Write([uint32]$pms.Length)
    $bw.Write([uint32]$offset)
    $offset += $pms.Length
    $resized.Dispose()
}

foreach ($ims in $imgStreams) {
    $bw.Write($ims.ToArray())
    $ims.Dispose()
}

$icoPath = Join-Path $PSScriptRoot "..\build\icon.ico"
[System.IO.File]::WriteAllBytes($icoPath, $ms.ToArray())
Write-Host "icon.ico olusturuldu: $icoPath"

$bw.Dispose()
$ms.Dispose()
$font.Dispose()
$g.Dispose()
$bmp.Dispose()
