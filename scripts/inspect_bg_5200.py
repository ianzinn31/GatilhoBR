with open(r'c:\Users\ialve\Downloads\GatilhoBR-Extensao\background.js', 'r', encoding='utf-8', errors='ignore') as f:
    lines = f.readlines()

for j in range(5200, 5240):
    print(f"{j+1}: {repr(lines[j])}")
