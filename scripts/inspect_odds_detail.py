import json

with open(r'C:\Users\ialve\.gemini\antigravity-ide\scratch\betano_audit_result.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

for i in range(min(5, len(data['odds']))):
    o = data['odds'][i]
    btn = o.get('button', {})
    print(f"\n==================== ODD {i} ====================")
    print("Button text:", repr(btn.get("text")))
    print("Button HTML:", btn.get("html"))
    for a in o.get('ancestors', []):
        print(f"\n--- Ancestor depth {a.get('depth')} tag={a.get('tag')} attrs={a.get('attrs')} cls={a.get('className')} ---")
        print("Text:", repr(a.get("text")))
        if a.get('html'):
            print("HTML:", a.get("html")[:500])
