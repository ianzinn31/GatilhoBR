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
            print("Depth 3 HTML:")
            print(o0['ancestors'][3].get('html'))
