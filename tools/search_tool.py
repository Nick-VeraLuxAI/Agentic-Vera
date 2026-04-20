# Simulated offline search using a local text file as a fake knowledge base

def offline_search(query, kb_path='offline_kb.txt'):
    results = []
    with open(kb_path, 'r') as f:
        for line in f:
            if query.lower() in line.lower():
                results.append(line.strip())
    return results[:5] or ["No offline matches found."]
