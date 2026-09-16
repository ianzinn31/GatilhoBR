import sys

with open(r'c:\Users\ialve\Downloads\GatilhoBR-Extensao\background.js', 'r', encoding='utf-8', errors='ignore') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if 'marketHouseKey' in line or 'detectSiteFromUrl' in line:
        start = max(0, i - 5)
        end = min(len(lines), i + 15)
        print(f"\n--- Line {i+1} ---")
        for j in range(start, end):
            sys.stdout.buffer.write(f"{j+1}: {lines[j]}".encode('utf-8'))
