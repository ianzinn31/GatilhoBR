import json

path = r'C:\Users\ialve\.gemini\antigravity-ide\brain\6872bf43-4fbb-40be-aca7-cc92da858682\.system_generated\logs\transcript_full.jsonl'
with open(path, 'r', encoding='utf-8', errors='ignore') as f:
    for i, line in enumerate(f):
        if i == 64:
            obj = json.loads(line)
            c = obj.get('content', '')
            start = c.find('{')
            end = c.rfind('}') + 1
            data = json.loads(c[start:end])
            o0 = data['odds'][0]
            for a in o0['ancestors']:
                print(f"\n================ Ancestor Depth {a.get('depth')} ================")
                print("tag:", a.get('tag'))
                print("attrs:", a.get('attrs'))
                print("className:", a.get('className'))
                print("text:", repr(a.get('text')))
                if a.get('html'):
                    print("html:", repr(a.get('html')[:400]))
