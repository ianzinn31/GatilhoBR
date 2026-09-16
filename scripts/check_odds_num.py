with open(r'c:\Users\ialve\Downloads\GatilhoBR-Extensao\dashboard-app\dist\assets\index-CE0z2sp7.css', 'r', encoding='utf-8') as f:
    css = f.read()

pos = css.find('odds-num')
if pos != -1:
    print("Found odds-num in index-CE0z2sp7.css at", pos)
    print(css[max(0, pos - 100):min(len(css), pos + 200)])
else:
    print("odds-num NOT in index-CE0z2sp7.css")

with open(r'c:\Users\ialve\Downloads\GatilhoBR-Extensao\dashboard.css', 'r', encoding='utf-8') as f:
    css2 = f.read()

pos2 = css2.find('odds-num')
if pos2 != -1:
    print("Found odds-num in dashboard.css at", pos2)
    print(css2[max(0, pos2 - 100):min(len(css2), pos2 + 200)])
else:
    print("odds-num NOT in dashboard.css")
