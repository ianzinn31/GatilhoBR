with open(r'c:\Users\ialve\Downloads\GatilhoBR-Extensao\dashboard-app\dist\assets\index-CE0z2sp7.css', 'r', encoding='utf-8') as f:
    css = f.read()

import re
matches = [m.start() for m in re.finditer(r'odds-num', css)]
for pos in matches:
    print("--- odds-num ---")
    print(css[max(0, pos - 150):min(len(css), pos + 150)])

matches2 = [m.start() for m in re.finditer(r'--font-numeric', css)]
for pos in matches2:
    print("--- --font-numeric ---")
    print(css[max(0, pos - 150):min(len(css), pos + 150)])
