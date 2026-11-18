$ErrorActionPreference = 'Stop'
$page = '98abe017-b762-4723-99c4-5cecdf05065e'
$out = Join-Path $PSScriptRoot '../reports/screenshots'
New-Item -ItemType Directory -Path $out -Force | Out-Null
$pages = @('demo.html','agendar.html?demo','conta.html?demo','barbeiro.html?demo','planos.html','admin.html?demo=atendente')
$results = @()
foreach ($route in $pages) {
  $name = ($route -split '[.?]')[0]
  $nav = orca goto --page $page --url "http://127.0.0.1:8765/$route" --json | ConvertFrom-Json
  if (!$nav.ok) { throw ($nav | ConvertTo-Json -Depth 10) }
  foreach ($size in @(@{name='desktop';width=1366;height=900},@{name='mobile';width=390;height=844})) {
    $view = orca viewport --page $page --width $size.width --height $size.height --json | ConvertFrom-Json
    $scroll = orca eval --page $page --expression 'window.scrollTo(0,0)' --json | ConvertFrom-Json
    $data = orca eval --page $page --expression "JSON.stringify({title:document.title,url:location.href,width:innerWidth,contentWidth:document.documentElement.scrollWidth,text:document.body.innerText})" --json | ConvertFrom-Json
    $shot = orca screenshot --page $page --json | ConvertFrom-Json
    if (!$shot.ok) { throw ($shot | ConvertTo-Json -Depth 10) }
    $target = Join-Path $out ($name+'-'+$size.name+'.png')
    Copy-Item -LiteralPath $shot.result.path -Destination $target
    $results += @{page=$route;size=$size.name;data=($data.result.result | ConvertFrom-Json);screenshot=$target}
    $results | ConvertTo-Json -Depth 10 | Set-Content -Encoding utf8 (Join-Path $out '../visual-audit.json')
    Write-Output "$name $($size.name) captured"
  }
}
