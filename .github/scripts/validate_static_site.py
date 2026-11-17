from html.parser import HTMLParser
from pathlib import Path
import re
s=Path('.')
class Checker(HTMLParser):
    pass
html_files=list(s.rglob('*.html'))
if not html_files:
    raise SystemExit('No HTML files found')
for p in html_files:
    parser=Checker(convert_charrefs=True)
    parser.feed(p.read_text(encoding='utf-8'))
    parser.close()
refs=[]
for p in html_files:
    text=p.read_text(encoding='utf-8')
    refs += [(str(p), m.group(0)) for m in re.finditer(r'https://cdn\.jsdelivr\.net/npm/@supabase/supabase-js@[^\"\s]+', text)]
if not refs:
    raise SystemExit('No browser Supabase SDK references found')
for path, ref in refs:
    if not re.search(r'@supabase/supabase-js@\d+\.\d+\.\d+$', ref):
        raise SystemExit(f'Unpinned Supabase SDK reference in {path}: {ref}')
edge=Path('supabase/functions/egybook-hovod-authorize/index.ts')
if edge.exists():
    text=edge.read_text(encoding='utf-8')
    if '@supabase/supabase-js@2.119.0' not in text:
        raise SystemExit('Hovod authorization Edge Function SDK version is not pinned to 2.119.0')
print(f'Validated {len(html_files)} HTML files and {len(refs)} pinned browser Supabase SDK references.')
