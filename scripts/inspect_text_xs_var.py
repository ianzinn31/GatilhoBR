with open(r'c:\Users\ialve\Downloads\GatilhoBR-Extensao\dashboard-app\dist\assets\index-CE0z2sp7.css', 'r', encoding='utf-8') as f:
    css = f.read()

import re
matches = [m.start() for m in re.finditer(r'--text-xs', css)]
for pos in matches:
    print(css[max(0, pos - 50):min(len(css), pos + 150)])
