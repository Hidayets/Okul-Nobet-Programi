param()
Add-Type -AssemblyName System.Drawing

$OutIco = Join-Path (Split-Path $PSScriptRoot -Parent) 'build\icon.ico'

# Uygulamanın sidebar logosuyla birebir aynı "N" ikonu:
# dairesel mavi gradient (135deg #4a9eff -> #2c7be5 -> #1a5bb8), beyaz kalın Georgia "N".
$S = 512
$bmp = New-Object System.Drawing.Bitmap $S, $S
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.Clear([System.Drawing.Color]::Transparent)

# Gradient: sol üstten sağ alta (135 derece hissi)
$gradRect = New-Object System.Drawing.Rectangle 0, 0, $S, $S
$c1 = [System.Drawing.ColorTranslator]::FromHtml('#4a9eff')
$c2 = [System.Drawing.ColorTranslator]::FromHtml('#2c7be5')
$c3 = [System.Drawing.ColorTranslator]::FromHtml('#1a5bb8')
$blend = New-Object System.Drawing.Drawing2D.ColorBlend 3
$blend.Colors = @($c1, $c2, $c3)
$blend.Positions = @(0.0, 0.5, 1.0)
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $gradRect, $c1, $c3, ([System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal)
$brush.InterpolationColors = $blend

# Daire (kenarlarda hafif pay bırak)
$inset = [int]($S * 0.02)
$circRect = New-Object System.Drawing.Rectangle $inset, $inset, ($S - 2 * $inset), ($S - 2 * $inset)
$g.FillEllipse($brush, $circRect)

# Beyaz "N" harfi (Georgia, bold, ortalanmış)
$font = New-Object System.Drawing.Font('Georgia', [float]($S * 0.42), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = [System.Drawing.StringAlignment]::Center
$fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
$textRect = New-Object System.Drawing.RectangleF 0, (-$S * 0.015), $S, $S
$whiteBrush = [System.Drawing.Brushes]::White
$g.DrawString('N', $font, $whiteBrush, $textRect, $fmt)

$g.Dispose()

# ICO kapsayıcı: tek 256x256 PNG girdisi
$bmp256 = New-Object System.Drawing.Bitmap 256, 256
$g2 = [System.Drawing.Graphics]::FromImage($bmp256)
$g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g2.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g2.DrawImage($bmp, 0, 0, 256, 256)
$g2.Dispose()

$ms = New-Object System.IO.MemoryStream
$bmp256.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$png = $ms.ToArray()

$ico = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ico)
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]1)
$bw.Write([byte]0); $bw.Write([byte]0)          # 256 -> 0
$bw.Write([byte]0); $bw.Write([byte]0)
$bw.Write([UInt16]1); $bw.Write([UInt16]32)
$bw.Write([UInt32]$png.Length)
$bw.Write([UInt32]22)
$bw.Write($png)
$bw.Flush()

[System.IO.File]::WriteAllBytes($OutIco, $ico.ToArray())
$bmp.Dispose(); $bmp256.Dispose()
Write-Host ("OK: {0} ({1} bytes)" -f $OutIco, (Get-Item $OutIco).Length)
