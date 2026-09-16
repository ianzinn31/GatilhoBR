import json

with open(r'C:\Users\ialve\.gemini\antigravity-ide\scratch\betano_audit_result.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

o0 = data['odds'][0]
for a in o0['ancestors']:
    d = a.get('depth')
    tag = a.get('tag')
    qa = a.get('attrs', {}).get('data-qa')
    cls = a.get('className')
    print(f"d={d} tag={tag} qa={qa} cls={cls}")
    print("  text:", repr(a.get('text')))
    if a.get('html'):
        print("  html:", repr(a.get('html')[:300]))
