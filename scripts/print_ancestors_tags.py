import json

with open(r'C:\Users\ialve\.gemini\antigravity-ide\scratch\betano_audit_result.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

for i in [0, 1, 2]:
    o = data['odds'][i]
    print(f"\nODD {i}")
    for a in o.get('ancestors', []):
        attrs = a.get('attrs', {})
        print(f"  d={a.get('depth')} tag={a.get('tag')} attrs={attrs} cls={a.get('className')[:40]}")
        print("    text:", repr(a.get('text')[:80]))
