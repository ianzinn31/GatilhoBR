import json

with open(r'C:\Users\ialve\.gemini\antigravity-ide\scratch\betano_audit_result.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

print("URL:", data.get("url"))
print("Title:", data.get("title"))
odds = data.get("odds", [])
print("Total odds:", len(odds))

for i, o in enumerate(odds):
    btn = o.get("button", {})
    ancestors = o.get("ancestors", [])
    print(f"\n--- ODD {i}: {btn.get('text')} (selnid={btn.get('attrs', {}).get('data-selnid')}) ---")
    for a in ancestors:
        attrs = a.get("attrs", {})
        qa = attrs.get("data-qa")
        tag = a.get("tag")
        d = a.get("depth")
        cls = a.get("className", "")
        txt = a.get("text", "").replace("\n", " | ")[:60]
        html = a.get("html", "")
        print(f"  d={d} tag={tag} qa={qa} cls={cls[:30]} txt={txt}")
