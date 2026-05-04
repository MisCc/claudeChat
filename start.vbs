Set WshShell = CreateObject("WScript.Shell")
scriptDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = scriptDir

' Add node.js and npm global modules to PATH
nodePath = "D:\software\nodejs"
npmPath = WshShell.ExpandEnvironmentStrings("%APPDATA%") & "\npm"
oldPath = WshShell.ExpandEnvironmentStrings("%PATH%")
WshShell.Environment("Process")("PATH") = nodePath & ";" & npmPath & ";" & oldPath

' Show console window so user can enter params and see QR code
WshShell.Run "cmd /k node server.js", 1, False
