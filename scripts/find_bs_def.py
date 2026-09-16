with open(r'c:\Users\ialve\Downloads\GatilhoBR-Extensao\dashboard-app\dist\assets\index-bBFKOU_L.js', 'r', encoding='utf-8') as f:
    code = f.read()

# Let's find "function BS(" or "BS="
import re
for m in re.finditer(r'(function BS\(|const BS\s*=|let BS\s*=|var BS\s*=)', code):
    pos = m.start()
    print("Found BS definition at", pos)
    print(code[pos:pos+500])
