import re

with open(r'c:\Users\ialve\Downloads\GatilhoBR-Extensao\dashboard-app\dist\assets\index-bBFKOU_L.js', 'r', encoding='utf-8') as f:
    code = f.read()

print("File size:", len(code))

# Search for occurrences of house names or trigger actions
for word in ['postMessage', 'EXECUTE', 'SELECT', 'superbet', 'betmgm', 'TRIGGER', 'DIRECT_ORDER']:
    matches = [m.start() for m in re.finditer(re.escape(word), code)]
    print(f"'{word}': {len(matches)} occurrences")
    for pos in matches[:5]:
        start = max(0, pos - 100)
        end = min(len(code), pos + 100)
        print("  Snippet:", repr(code[start:end]))
