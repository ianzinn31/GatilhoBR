import re, sys

with open(r'c:\Users\ialve\Downloads\GatilhoBR-Extensao\background.js', 'r', encoding='utf-8', errors='ignore') as f:
    code = f.read()

# Find occurrences where houses are listed or branched
patterns = [
    r'(?:betfair|betnacional|betmgm|bet365|betano)[^;\n\r]{0,80}(?:betfair|betnacional|betmgm|bet365|betano)',
]

for p in patterns:
    for m in re.finditer(p, code, re.IGNORECASE):
        start = max(0, m.start() - 40)
        end = min(len(code), m.end() + 40)
        snippet = code[start:end].replace('\n', ' ')
        if 'betano' not in snippet.lower():
            print(f"MISSING BETANO at pos {m.start()}: {snippet[:120]}")
