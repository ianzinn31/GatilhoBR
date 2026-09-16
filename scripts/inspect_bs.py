with open(r'c:\Users\ialve\Downloads\GatilhoBR-Extensao\dashboard-app\dist\assets\index-bBFKOU_L.js', 'r', encoding='utf-8') as f:
    code = f.read()

pos = code.find('SELECT_ODDS_ACTION')
if pos != -1:
    print("Found SELECT_ODDS_ACTION at:", pos)
    start = max(0, pos - 500)
    end = min(len(code), pos + 500)
    print(code[start:end])
else:
    print("Not found")
