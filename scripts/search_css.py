with open(r'c:\Users\ialve\Downloads\GatilhoBR-Extensao\dashboard-app\dist\assets\index-CE0z2sp7.css', 'r', encoding='utf-8') as f:
    css = f.read()

print("CSS length:", len(css))
# Let's search for odd button styles or height / overflow / line-height
for term in ['overflow', 'line-height', 'font-mono', 'h-', 'text-sm', 'text-xs', 'leading-']:
    print(f"'{term}' count: {css.count(term)}")
