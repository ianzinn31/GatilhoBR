with open(r'c:\Users\ialve\Downloads\GatilhoBR-Extensao\dashboard-app\dist\assets\index-bBFKOU_L.js', 'r', encoding='utf-8') as f:
    code = f.read()

import re
for m in re.finditer(r'(function sA\(|const sA\s*=|let sA\s*=|var sA\s*=)', code):
    pos = m.start()
    print("Found sA definition at", pos)
    print(code[pos:pos+1500])
