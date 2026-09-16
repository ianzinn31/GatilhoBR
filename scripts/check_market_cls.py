import json

with open(r'C:\Users\ialve\.gemini\antigravity-ide\scratch\betano_audit_result.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

for i, o in enumerate(data['odds']):
    for a in o.get('ancestors', []):
        cls = a.get('className', '')
        if 'market' in cls.lower() or 'accordion' in cls.lower():
            print(f"Odd {i} ancestor depth {a.get('depth')} has class: {cls}")
