import sys

with open(r'c:\Users\ialve\Downloads\GatilhoBR-Extensao\background.js', 'r', encoding='utf-8', errors='ignore') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if 'function detectSiteFromUrl' in line or 'function marketHouseKey' in line or 'function dynamicBindHouseKey' in line:
        start = max(0, i - 2)
        end = min(len(lines), i + 25)
        print(f"\n--- Line {i+1} ---")
        for j in range(start, end):
            sys.stdout.buffer.write(f"{j+1}: {lines[j]}".encode('utf-8'))
