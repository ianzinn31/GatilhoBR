with open(r'c:\Users\ialve\Downloads\GatilhoBR-Extensao\dashboard-app\dist\assets\index-bBFKOU_L.js', 'r', encoding='utf-8') as f:
    code = f.read()

import re
# Search for odds abertas or atualizado agora mesmo
for m in re.finditer(r'odds abertas', code):
    pos = m.start()
    print("Found 'odds abertas' at", pos)
    print(code[max(0, pos - 400):min(len(code), pos + 1200)])
