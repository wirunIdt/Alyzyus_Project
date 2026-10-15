"""Allowlist shareable source, never credentials or archived customer records."""
import base64
import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('deployment_package', ROOT/'scripts/package-vercel.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
allowed = module.files()
for name in ('.env.example','.gitignore','.vercelignore','README.md','CODE_GUIDE.md','ASSETS.md'):
    allowed[name] = ROOT/name
for folder,pattern in (('scripts','*.py'),('tests','*.py'),('tests','*.mjs'),('tests','package*.json'),('supabase','*.md'),('supabase','*.sql'),('supabase/migrations','*.sql'),('docs','*.md'),('.github/workflows','*.yml')):
    for file in (ROOT/folder).glob(pattern):
        allowed[file.relative_to(ROOT).as_posix()] = file
for name in ('Alyzyus_Introduction.pdf','Alyzyus_Presentation.pdf','Alyzyus_Portfolio.pptx'):
    file = ROOT/'artifacts/university/output'/name
    if file.exists(): allowed['portfolio/'+name] = file
for name in ('storefront.jpg','product-journey.jpg','queue-office.jpg'):
    file = ROOT/'artifacts/screenshots'/name
    if file.exists(): allowed['docs/screenshots/'+name] = file

def manifest_item(name,file):
    content = file.read_bytes()
    binary = file.suffix.lower() in ('.jpg','.png','.webp','.pptx','.pdf')
    if not binary and re.search(rb'(?:sb_secret_|sb_publishable_)[A-Za-z0-9_\-]{22,}|sk_live_[A-Za-z0-9]{15,}',content):
        raise SystemExit('Refusing credential-like content in '+name)
    sha = hashlib.sha1(b'blob '+str(len(content)).encode()+b'\0'+content).hexdigest()
    return {'path':name,'size':len(content),'binary':binary,'gitSha':sha}

if len(sys.argv) == 1:
    print(json.dumps([manifest_item(name,file) for name,file in sorted(allowed.items())]))
else:
    name = sys.argv[1]
    if name not in allowed: raise SystemExit('File is not allowlisted')
    item = manifest_item(name,allowed[name])
    content = allowed[name].read_bytes()
    if item['binary']:
        offset = int(sys.argv[2]) if len(sys.argv)>2 else 0
        # Multiples of three let the connector concatenate base64 chunks safely.
        item['data'] = base64.b64encode(content[offset:offset+32766]).decode('ascii')
    else:
        item['content'] = content.decode('utf-8')
    print(json.dumps(item,ensure_ascii=False))
