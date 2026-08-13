param(
  [string]$Source = 'C:\Users\Boste\Downloads\LISTA DE PRECIO HELADERIA a4 (1).xls',
  [string]$Output = 'tmp\catalog-import\heladeria-source.json'
)

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false

try {
  $book = $excel.Workbooks.Open($Source, 0, $true)
  $sheet = $book.Worksheets.Item(1)
  $used = $sheet.UsedRange
  $rows = for ($row = $used.Row; $row -lt ($used.Row + $used.Rows.Count); $row++) {
    $cells = foreach ($column in 1, 3, 5, 7) {
      $cell = $sheet.Cells.Item($row, $column)
      [PSCustomObject]@{ value = $cell.Value2; text = [string]$cell.Text }
    }
    [PSCustomObject]@{ row = $row; cells = $cells }
  }
  $payload = [PSCustomObject]@{
    source = $Source
    sheet = [string]$sheet.Name
    used_address = [string]$used.Address()
    rows = $rows
  }
  $absoluteOutput = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Output))
  [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($absoluteOutput)) | Out-Null
  [System.IO.File]::WriteAllText($absoluteOutput, ($payload | ConvertTo-Json -Depth 8), [System.Text.UTF8Encoding]::new($false))
  Write-Output $absoluteOutput
}
finally {
  if ($book) { $book.Close($false) }
  $excel.Quit()
  if ($used) { [Runtime.InteropServices.Marshal]::ReleaseComObject($used) | Out-Null }
  if ($sheet) { [Runtime.InteropServices.Marshal]::ReleaseComObject($sheet) | Out-Null }
  if ($book) { [Runtime.InteropServices.Marshal]::ReleaseComObject($book) | Out-Null }
  [Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
}
