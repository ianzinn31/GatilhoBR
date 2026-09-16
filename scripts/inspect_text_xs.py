with open(r'c:\Users\ialve\Downloads\GatilhoBR-Extensao\dashboard-app\dist\assets\index-CE0z2sp7.css', 'r', encoding='utf-8') as f:
    css = f.read()

import re
for term in ['.text-xs', 'h-9', 'button']:
    for m in re.finditer(re.escape(term), css):
        pos = m.start()
        print(f"--- {term} at {pos} ---")
        print(css[max(0, pos - 80):min(len(css), pos + 120)])
