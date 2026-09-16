with open(r'c:\Users\ialve\Downloads\GatilhoBR-Extensao\background.js', 'r', encoding='utf-8', errors='ignore') as f:
    bg = f.read()

print("background.js size:", len(bg))
for term in ['SELECT_ODDS_ACTION', 'REQUEST_MARKETS', 'onConnect', 'select_odds', 'SELECT_ODDS', 'betano']:
    cnt = bg.count(term)
    print(f"'{term}': {cnt} occurrences")
