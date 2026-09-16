with open(r'c:\Users\ialve\Downloads\GatilhoBR-Extensao\dashboard-app\dist\assets\index-bBFKOU_L.js', 'r', encoding='utf-8') as f:
    code = f.read()

pos = code.find('function xy(')
if pos != -1:
    print(code[pos:pos+300])
else:
    print("function xy not found")
