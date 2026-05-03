$ws = New-Object -ComObject WScript.Shell
$desktop = [System.IO.Path]::Combine($env:USERPROFILE, 'Desktop')
$s = $ws.CreateShortcut([System.IO.Path]::Combine($desktop, 'Claude Chat.lnk'))
$s.TargetPath = 'D:\workspace\agentapp\start.vbs'
$s.WorkingDirectory = 'D:\workspace\agentapp'
$s.IconLocation = 'D:\workspace\agentapp\claude-chat.ico,0'
$s.Description = 'Claude Chat - LAN Relay'
$s.Save()
Write-Host 'Shortcut created on Desktop: Claude Chat.lnk'
