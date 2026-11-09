param([string]$Path)
$errs = $null
$null = [System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$null, [ref]$errs)
if ($errs -and $errs.Count -gt 0) {
  "PSVersion: $($PSVersionTable.PSVersion)"
  foreach ($e in $errs) {
    "错误: {0} @ line {1}" -f $e.Message, $e.Extent.StartLineNumber
  }
  exit 1
} else {
  "语法 OK (PSVersion $($PSVersionTable.PSVersion))"
  exit 0
}
