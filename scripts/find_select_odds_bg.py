with open(r'c:\Users\ialve\Downloads\GatilhoBR-Extensao\background.js', 'r', encoding='utf-8', errors='ignore') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if 'SELECT_ODDS_ACTION' in line or 'SELECT_ODDS' in line:
        print(f"\n--- Line {i+1} ---")
        start = max(0, i - 15)
        end = min(len(lines), i + 25)
        for j in range(start, end):
            print(f"{j+1}: {lines[j]}", end="")
