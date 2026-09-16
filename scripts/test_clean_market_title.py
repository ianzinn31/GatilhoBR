import re

def clean_market_title(raw_title):
    if not raw_title:
        return ""
    # Strip CA / Criar Aposta at start even if glued to next word (e.g. CAResultado -> Resultado)
    cleaned = raw_title.strip()
    cleaned = re.sub(r'^(?:ca|criar aposta|bet builder)[\s:-]*', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'^ca(?=[A-ZÀ-Ú])', '', cleaned, flags=re.IGNORECASE).strip()
    cleaned = re.sub(r'[\s:-]*(?:ca|criar aposta|bet builder)$', '', cleaned, flags=re.IGNORECASE).strip()
    
    # Also strip any trailing chevron or icon text like ^ or v
    cleaned = re.sub(r'[\s\^v\+\-]+$', '', cleaned).strip()
    return cleaned

test_cases = [
    "CAResultado Final",
    "CATotal de Gols",
    "CAPróximo gol (Gol 1)",
    "CAResultado do 1° Tempo",
    "Total de gols - 1° Tempo",
    "CA Criar Aposta - Resultado Final",
    "Resultado Final ^",
    "CA Total de Gols v"
]

for t in test_cases:
    print(f"RAW: '{t}' -> CLEAN: '{clean_market_title(t)}'")
