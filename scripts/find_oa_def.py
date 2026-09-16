with open(r'c:\Users\ialve\Downloads\GatilhoBR-Extensao\dashboard-app\dist\assets\index-bBFKOU_L.js', 'r', encoding='utf-8') as f:
    code = f.read()

import re
for m in re.finditer(r'(function oA\(|const oA\s*=|let oA\s*=|var oA\s*=)', code):
    pos = m.start()
    print("Found oA definition at", pos)
    print(code[pos:pos+1500])
