with open(r'c:\Users\ialve\Downloads\GatilhoBR-Extensao\dashboard-app\dist\assets\index-bBFKOU_L.js', 'r', encoding='utf-8') as f:
    code = f.read()

# Let's search for table rendering or targetName
import re
for m in re.finditer(r'targetName', code):
    pos = m.start()
    print("Found targetName at", pos)
    print(code[max(0, pos - 150):min(len(code), pos + 150)])
