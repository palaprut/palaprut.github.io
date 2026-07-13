$allWords = @()

$files = Get-ChildItem ".\vocabulary\*.json" | Sort-Object Name

foreach ($file in $files) {

    $content = Get-Content $file.FullName -Raw -Encoding UTF8

    $json = $content | ConvertFrom-Json

    if ($json.words) {
        $allWords += $json.words
    }
}

$result = @{
    version = 2
    source = "Oxford 3000"
    level = "Mixed"
    totalWords = $allWords.Count
    metadata = @{
        created = (Get-Date -Format "yyyy-MM-dd")
        language = "en"
        description = "Merged vocabulary file"
    }
    words = $allWords
}

$jsonText = $result | ConvertTo-Json -Depth 100

[System.IO.File]::WriteAllText(
    ".\words.json",
    $jsonText,
    [System.Text.UTF8Encoding]::new($false)
)

Write-Host "Done! Total words:" $allWords.Count