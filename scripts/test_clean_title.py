import re

test_titles = [
    "CAResultado Final13.05X2.8522.55",
    "CATotal de GolsMais de 2.52.47Menos de 2.51.50Opções AlternativasMais de 1.51.47Menos de 1.52.55Mais de 3.54.65Menos de 3.51.17",
    "CAPróximo gol (Gol 1)América-MG2.15Sem Gol6.30São Bernardo2.02",
    "CAResultado do 1° TempoAmérica-MG3.80Empate1.82São Bernardo3.40",
    "Total de gols - 1° TempoMais de 0.51.60Menos de 0.52.18",
    "Resultado Final\n1\n1.72\nX\n3.10\n2\n5.40"
]

def clean_betano_title(raw):
    if not raw:
        return ""
    # If there are newlines, inspect lines first
    lines = [l.strip() for l in raw.split('\n') if l.strip()]
    for line in lines:
        # Strip CA / Criar Aposta / Bet Builder at beginning (even without space)
        cleaned = re.sub(r'^(?:ca|criar aposta|bet builder)[\s:-]*', '', line, flags=re.IGNORECASE)
        # In case CA was directly glued to a word with capital letter: e.g. CAResultado -> Resultado
        cleaned = re.sub(r'^ca(?=[A-ZÀ-Ú])', '', cleaned, flags=re.IGNORECASE).strip()
        
        # Strip trailing CA / icons
        cleaned = re.sub(r'[\s:-]*(?:ca|criar aposta|bet builder)$', '', cleaned, flags=re.IGNORECASE).strip()
        
        # If line contains concatenated odds/selections at the end, cut before them!
        # Pattern 1: ends with selection digits like "13.05X2.8522.55" -> cut before "1\d+\.\d+" or "Mais de" or "Menos de"
        # Or before any selection pattern:
        cut_match = re.search(
            r'(?:'
            r'(?<=[a-z0-9\)])(?=[1X2]\d+[.,]\d+)'  # e.g. Final13.05 -> cuts before 13.05
            r'|(?<=[a-z0-9\)])(?=(?:Mais|Menos|Over|Under)\s*(?:de)?\s*\d)' # e.g. GolsMais de -> cuts before Mais de
            r'|(?<=[a-z0-9\)])(?=[A-ZÀ-Ú][a-zà-ú0-9\s\-]+(?:\d+[.,]\d+)(?:Sem Gol|Empate|[A-ZÀ-Ú]))' # team name followed by odds
            r')',
            cleaned,
            flags=re.IGNORECASE
        )
        if cut_match:
            candidate = cleaned[:cut_match.start()].strip()
            if len(candidate) >= 3:
                cleaned = candidate

        # Skip noise / selection names
        if not cleaned or len(cleaned) < 2:
            continue
        if re.match(r'^(?:ca|criar aposta|bet builder|ao vivo|populares|campo|estat[íi]sticas|\^|v|\+|-)$', cleaned, flags=re.IGNORECASE):
            continue
        if re.match(r'^\d+(?:[.,]\d+)?$', cleaned):
            continue
        if re.match(r'^(?:mais(?:\s+de)?|menos(?:\s+de)?|over|under)\s+\d+(?:[.,]\d+)?$', cleaned, flags=re.IGNORECASE):
            continue
        if re.match(r'^(?:1|x|2|sim|n[ãa]o)$', cleaned, flags=re.IGNORECASE):
            continue
            
        return cleaned
    return ""

for t in test_titles:
    cleaned = clean_betano_title(t)
    print(f"RAW:     {t[:60]}")
    print(f"CLEANED: {cleaned}\n")
