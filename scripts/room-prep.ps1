# Measures the room photo once: wall mask (R back, G left, B right, objects in front cut out) and clean wall light.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/room-prep.ps1 -dir src/assets/exp   (needs room.jpg there)
# Camera model and object outlines are for this one photo (Unsplash); a new photo needs new numbers. ASCII only.
param($dir)
$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $PSScriptRoot 'RoomPrep.cs') -ReferencedAssemblies System.Drawing
function P([double[]]$a) { [void][RoomPrep]::Polys.Add($a) }
# sofa (back wall side)
P @(648,1010, 648,892, 656,881, 668,877, 730,876, 733,850, 745,845, 766,843, 769,821, 777,815, 1025,815, 1032,819, 1040,812, 1550,812, 1557,821, 1716,843, 1709,868, 1701,889, 1736,892, 1746,900, 1750,915, 1752,1010)
# floor lamp shades
P @(1672,583, 1691,583, 1699,649, 1653,649)
P @(1757,690, 1776,690, 1789,747, 1738,747)
[void][RoomPrep]::Rects.Add([double[]]@(1039,454,1339,754))           # artwork
foreach ($c in @(@(1062,125,71), @(1153,186,74), @(1133,318,79), @(1266,271,77))) { [void][RoomPrep]::Circles.Add([double[]]$c) }
foreach ($s in @(@(1686,584,1706,592,3), @(1705.5,588,1705.5,1000,3.5), @(1772,689,1796,697,3), @(1795,694,1795,1045,3.5))) { [void][RoomPrep]::Segs.Add([double[]]$s) }
[RoomPrep]::Run((Join-Path $dir 'room.jpg'), (Join-Path $dir 'room-mask.png'), (Join-Path $dir 'room-clean.jpg'))
