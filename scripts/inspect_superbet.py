import re

with open(r'c:\Users\ialve\Downloads\GatilhoBR-Extensao\dashboard-app\dist\assets\index-bBFKOU_L.js', 'r', encoding='utf-8') as f:
    code = f.read()

matches = [m.start() for m in re.finditer(re.escape('superbet'), code)]
print(f"'superbet': {len(matches)} occurrences")
for i, pos in enumerate(matches):
    start = max(0, pos - 150)
    end = min(len(code), pos + 150)
    print(f"\n--- Occurrence {i} at {pos} ---")
    print(code[start:end])
